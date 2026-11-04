import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-dafeiyu-emotion'
export const inject = ['webServer']

const ANALYZE_ENDPOINT = '/plugins/dsh-dafeiyu-emotion/analyze'
const HEALTH_ENDPOINT = '/plugins/dsh-dafeiyu-emotion/health'

const here = dirname(fileURLToPath(import.meta.url))
const defaultWorker = resolve(here, '..', 'backend', 'voice_worker.py')

const DEFAULTS = Object.freeze({
  enabled: true,
  backendRoot: '',
  pythonPath: '',
  language: 'zh',
  maxAudioBytes: 12 * 1024 * 1024,
  startupTimeoutMs: 180000,
  requestTimeoutMs: 180000,
})

const EMOTION_ZH = Object.freeze({
  happy: '喜悦',
  sad: '低落',
  angry: '生气',
  fear: '紧张担忧',
  surprise: '惊讶',
  disgust: '厌烦',
  neutral: '平静',
})

function isLocalRequest(req) {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress)) return false
  if (req.headers?.host) {
    try {
      const host = new URL(`http://${req.headers.host}`)
      if (host.username || host.password || !['127.0.0.1', 'localhost', '[::1]'].includes(host.hostname)) return false
    } catch {
      return false
    }
  }
  if (!req.headers?.origin) return true
  try {
    const origin = new URL(req.headers.origin)
    return ['http:', 'https:'].includes(origin.protocol) && origin.host === req.headers.host
  } catch {
    return false
  }
}

function jsonResponse(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

async function readJsonBody(req, limit) {
  const chunks = []
  let bytes = 0
  for await (const chunk of req) {
    bytes += chunk.length
    if (bytes > limit) throw new Error('请求体过大，请缩短录音后重试')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function asNumber(value, fallback) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function resolveOptions(raw = {}) {
  return {
    enabled: raw.enabled !== false,
    backendRoot: String(raw.backendRoot || process.env.DSH_DAFEIYU_EMOTION_BACKEND || DEFAULTS.backendRoot).trim()
      ? resolve(String(raw.backendRoot || process.env.DSH_DAFEIYU_EMOTION_BACKEND || DEFAULTS.backendRoot))
      : '',
    pythonPath: String(raw.pythonPath || '').trim(),
    language: ['zh', 'en', 'auto'].includes(raw.language) ? raw.language : DEFAULTS.language,
    maxAudioBytes: Math.min(32 * 1024 * 1024, Math.max(256 * 1024, asNumber(raw.maxAudioBytes, DEFAULTS.maxAudioBytes))),
    startupTimeoutMs: Math.min(600000, Math.max(10000, asNumber(raw.startupTimeoutMs, DEFAULTS.startupTimeoutMs))),
    requestTimeoutMs: Math.min(600000, Math.max(10000, asNumber(raw.requestTimeoutMs, DEFAULTS.requestTimeoutMs))),
  }
}

function locatePython(options) {
  if (options.pythonPath) return options.pythonPath
  const candidates = process.platform === 'win32'
    ? [
        join(options.backendRoot, '.venv-ser', 'Scripts', 'python.exe'),
        join(options.backendRoot, '.venv-gpu', 'Scripts', 'python.exe'),
        'python.exe',
      ]
    : [
        join(options.backendRoot, '.venv-ser', 'bin', 'python'),
        join(options.backendRoot, '.venv-gpu', 'bin', 'python'),
        'python3',
      ]
  return candidates.find((candidate) => candidate === 'python.exe' || candidate === 'python3' || existsSync(candidate)) || candidates.at(-1)
}

function median(values) {
  const clean = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  if (clean.length === 0) return null
  const middle = Math.floor(clean.length / 2)
  return clean.length % 2 === 0 ? (clean[middle - 1] + clean[middle]) / 2 : clean[middle]
}

function numberOrNull(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function buildToneSummary(analysis) {
  const emotion = analysis.emotion || 'neutral'
  const features = analysis.features || {}
  const confidence = numberOrNull(analysis.confidence) ?? 0
  const arousal = numberOrNull(analysis.arousal) ?? 0.5
  const valence = numberOrNull(analysis.valence) ?? 0
  const speechRate = numberOrNull(features.speech_rate)
  const pauseRatio = numberOrNull(features.pause_ratio)
  const pitchRange = numberOrNull(features.f0_range_st)
  const energyVariation = numberOrNull(features.db_std_n)
  const notes = []

  if (confidence < 0.4) notes.push('情绪信号偏弱')
  if (speechRate !== null && speechRate >= 4.8) notes.push('语速偏快')
  else if (speechRate !== null && speechRate <= 2.4) notes.push('语速偏慢')
  if (pauseRatio !== null && pauseRatio >= 0.32) notes.push('停顿较多')
  else if (pauseRatio !== null && pauseRatio <= 0.12) notes.push('停顿少、说得较连贯')
  if (pitchRange !== null && pitchRange >= 9) notes.push('音高起伏明显')
  if (energyVariation !== null && energyVariation >= 0.65) notes.push('音量变化明显')
  if (arousal >= 0.68) notes.push('唤醒度偏高')
  else if (arousal <= 0.32) notes.push('唤醒度偏低')

  const base = emotion === 'neutral'
    ? (valence < -0.15 ? '表面平稳但偏消极' : '语气整体平稳')
    : `${EMOTION_ZH[emotion] || emotion}${confidence < 0.4 ? '倾向' : ''}`
  return [base, ...notes].filter(Boolean).join('，')
}

function buildPrompt(analysis) {
  const transcript = String(analysis.transcript || '').trim()
  const confidence = numberOrNull(analysis.confidence)
  const confidenceText = confidence === null ? '未知' : `${Math.round(Math.max(0, Math.min(1, confidence)) * 100)}%`
  const tone = analysis.toneSummary || buildToneSummary(analysis)
  const timeline = Array.isArray(analysis.segments) && analysis.segments.length > 1
    ? `\n情绪走向：${analysis.segments.map((item) => `${EMOTION_ZH[item.emotion] || item.emotion}（${item.text}）`).join(' → ')}`
    : ''
  return [
    '【语音输入】',
    transcript,
    '',
    '【语音情绪参考｜只用来调整回复方式，不要逐字复述，也不要声称能读心】',
    `主要情绪：${EMOTION_ZH[analysis.emotion] || analysis.emotion || '平静'}（置信度 ${confidenceText}）`,
    `语气特征：${tone}${timeline}`,
    '回复要求：先自然承接对方的情绪状态，再回答问题；情绪明显时先共情、后给建议，避免机械说教或过度热情。',
  ].join('\n')
}

function clamp01(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.min(1, Math.max(0, numeric)) : 0.5
}

const TEXT_EMOTION_TERMS = Object.freeze({
  happy: ['开心', '高兴', '喜欢', '太好了', '好呀', '哈哈', '谢谢', '期待', '幸福', '爱', 'happy', 'glad', 'great', 'love', 'thanks', 'yay'],
  sad: ['难过', '伤心', '失落', '累', '疲惫', '想哭', '孤独', '算了', '没意思', 'sad', 'tired', 'lonely', 'upset', 'down'],
  angry: ['生气', '气死', '烦', '讨厌', '过分', '凭什么', '别管', '滚', '受够', '怎么能这样', '为什么这样', 'angry', 'annoyed', 'hate', 'unfair', 'stop it'],
  fear: ['害怕', '担心', '紧张', '焦虑', '不安', '怎么办', '怕', '不敢', 'worry', 'afraid', 'anxious', 'nervous', 'scared'],
  surprise: ['惊讶', '没想到', '居然', '真的吗', '天啊', '哇', '意外', 'surprised', 'wow', 'really', 'unexpected'],
  disgust: ['恶心', '反感', '厌恶', '受不了', '嫌弃', 'disgusting', 'gross', 'yuck'],
})

const PROSODY_PROTOTYPES = Object.freeze({
  angry: [0.85, 0.68, 0.8, 0.78],
  happy: [0.75, 0.76, 0.55, 0.72],
  sad: [0.18, 0.22, 0.2, 0.18],
  fear: [0.55, 0.85, 0.85, 0.7],
  surprise: [0.62, 0.9, 0.35, 0.6],
  disgust: [0.42, 0.45, 0.5, 0.42],
  neutral: [0.5, 0.5, 0.35, 0.45],
})

function normalizeScores(scores) {
  const entries = Object.entries(scores).map(([key, value]) => [key, Math.max(0, Number(value) || 0)])
  const total = entries.reduce((sum, [, value]) => sum + value, 0) || 1
  return Object.fromEntries(entries.map(([key, value]) => [key, value / total]))
}

function textEmotionScores(text) {
  const lower = String(text || '').toLowerCase()
  const scores = { happy: 0.02, sad: 0.02, angry: 0.02, fear: 0.02, surprise: 0.02, disgust: 0.02, neutral: 0.12 }
  for (const [emotion, terms] of Object.entries(TEXT_EMOTION_TERMS)) {
    for (const term of terms) {
      if (lower.includes(term)) scores[emotion] += term.length >= 4 ? 0.55 : 0.35
    }
  }
  return normalizeScores(scores)
}

function speechUnits(text) {
  const value = String(text || '')
  const cjk = value.match(/[\u3400-\u9fff]/g)?.length || 0
  const words = value.replace(/[\u3400-\u9fff]/g, ' ').match(/[A-Za-z0-9]+/g)?.length || 0
  return cjk + words
}

function buildFallbackAnalysis(transcript, prosody = {}) {
  const text = String(transcript || '').trim()
  if (!text) throw new Error('没有识别到清晰的语音')
  const duration = Math.max(0.1, numberOrNull(prosody.duration) ?? 0.1)
  const speechRate = speechUnits(text) / duration
  const energyN = clamp01(prosody.energy_n ?? 0.5)
  const pitchN = clamp01(prosody.pitch_n ?? 0.5)
  const varN = clamp01(prosody.var_n ?? 0.35)
  const rateN = clamp01((speechRate - 1.2) / 4.5)
  const pauseRatio = clamp01(prosody.pause_ratio ?? 0.2)
  const voicedRatio = clamp01(prosody.voiced_ratio ?? 0)
  const arousal = clamp01(
    0.30 * energyN
    + 0.22 * varN
    + 0.18 * rateN
    + 0.14 * (1 - pauseRatio)
    + 0.16 * Math.min(1, voicedRatio * 1.2),
  )

  const audioScores = {}
  let audioTotal = 0
  for (const [emotion, prototype] of Object.entries(PROSODY_PROTOTYPES)) {
    const distance = (energyN - prototype[0]) ** 2
      + (pitchN - prototype[1]) ** 2
      + (varN - prototype[2]) ** 2
      + (rateN - prototype[3]) ** 2
    const score = Math.exp(-2.4 * distance)
    audioScores[emotion] = score
    audioTotal += score
  }
  if (voicedRatio < 0.06) audioScores.neutral += 0.4
  const normalizedAudio = normalizeScores(audioScores)
  const textScores = textEmotionScores(text)
  const hasTextSignal = Object.entries(TEXT_EMOTION_TERMS)
    .some(([, terms]) => terms.some((term) => text.toLowerCase().includes(term)))
  const textWeight = hasTextSignal ? 0.5 : 0.12
  const scores = normalizeScores(Object.fromEntries(
    Object.keys(PROSODY_PROTOTYPES).map((emotion) => [
      emotion,
      normalizedAudio[emotion] * (1 - textWeight) + textScores[emotion] * textWeight,
    ]),
  ))
  const ranked = Object.entries(scores).sort((left, right) => right[1] - left[1])
  const margin = ranked[0][1] - ranked[1][1]
  const valence = Math.max(-1, Math.min(1,
    scores.happy - scores.sad - scores.angry - scores.fear - scores.disgust + 0.1 * scores.surprise,
  ))
  const features = {
    speech_rate: Math.round(speechRate * 1000) / 1000,
    pause_ratio: Math.round(pauseRatio * 1000) / 1000,
    voiced_ratio: Math.round(voicedRatio * 1000) / 1000,
    f0_median: numberOrNull(prosody.f0_median),
    f0_range_st: numberOrNull(prosody.f0_range_st),
    f0_std_st: numberOrNull(prosody.f0_std_st),
    energy_n: Math.round(energyN * 1000) / 1000,
    pitch_n: Math.round(pitchN * 1000) / 1000,
    var_n: Math.round(varN * 1000) / 1000,
    rate_n: Math.round(rateN * 1000) / 1000,
  }
  for (const key of Object.keys(features)) {
    if (features[key] === null) delete features[key]
  }
  const confidence = Math.min(0.86, Math.max(0.18, 0.20 + 0.7 * margin + 0.15 * voicedRatio))
  return {
    transcript: text,
    emotion: ranked[0][0],
    confidence: Math.round(confidence * 1000) / 1000,
    valence: Math.round(valence * 10000) / 10000,
    arousal: Math.round(arousal * 1000) / 1000,
    scores,
    source: hasTextSignal ? 'prosody+text' : 'prosody',
    features,
    segments: [{
      text,
      start: 0,
      end: Math.round(duration * 1000) / 1000,
      emotion: ranked[0][0],
      confidence: Math.round(confidence * 1000) / 1000,
    }],
    duration: Math.round(duration * 1000) / 1000,
    engine: 'DSH Speech + prosody',
  }
}

function decorateAnalysis(raw) {
  const analysis = {
    ...raw,
    emotion: raw.emotion || 'neutral',
    emotionZh: EMOTION_ZH[raw.emotion] || raw.emotion || '平静',
    confidence: numberOrNull(raw.confidence) ?? 0,
    valence: numberOrNull(raw.valence) ?? 0,
    arousal: numberOrNull(raw.arousal) ?? 0.5,
    segments: Array.isArray(raw.segments) ? raw.segments : [],
    features: raw.features && typeof raw.features === 'object' ? raw.features : {},
  }
  analysis.toneSummary = buildToneSummary(analysis)
  analysis.prompt = buildPrompt(analysis)
  return analysis
}

class VoiceBackend {
  constructor(options, logger) {
    this.options = options
    this.logger = logger
    this.python = locatePython(options)
    this.proc = null
    this.ready = null
    this.startup = null
    this.pending = new Map()
    this.nextId = 0
    this.queue = Promise.resolve()
    this.stderr = []
    this.lastError = null
  }

  status() {
    return {
      state: this.proc && !this.proc.killed ? (this.ready ? 'ready' : 'starting') : 'sleeping',
      pid: this.proc?.pid ?? null,
      python: this.python,
      backendRoot: this.options.backendRoot,
      lastError: this.lastError,
    }
  }

  ensureStarted() {
    if (this.proc && !this.proc.killed && this.ready) return Promise.resolve()
    if (this.startup) return this.startup
    this.startup = new Promise((resolvePromise, rejectPromise) => {
      if (!existsSync(this.options.backendRoot)) {
        rejectPromise(new Error(`语音后端目录不存在：${this.options.backendRoot}`))
        return
      }
      if (!existsSync(defaultWorker)) {
        rejectPromise(new Error(`插件自带 worker 缺失：${defaultWorker}`))
        return
      }
      const proc = spawn(this.python, [defaultWorker, this.options.backendRoot], {
        cwd: this.options.backendRoot,
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONUTF8: '1',
          PYTHONIOENCODING: 'utf-8',
          PYTHONUNBUFFERED: '1',
          MODELSCOPE_LOG_LEVEL: '30',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      this.proc = proc
      this.ready = false
      this.stderr = []

      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        this.lastError = '语音模型加载超时'
        proc.kill()
        rejectPromise(new Error(`${this.lastError}（>${Math.round(this.options.startupTimeoutMs / 1000)} 秒）`))
      }, this.options.startupTimeoutMs)

      const finishReady = (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) {
          this.lastError = error.message
          proc.kill()
          rejectPromise(error)
          return
        }
        this.ready = true
        this.lastError = null
        resolvePromise()
      }

      const lines = createInterface({ input: proc.stdout })
      lines.on('line', (line) => {
        const text = line.trim()
        if (!text) return
        if (!text.startsWith('{')) {
          this.logger?.debug?.(`[dsh-dafeiyu-emotion] ${text}`)
          return
        }
        let message
        try {
          message = JSON.parse(text)
        } catch {
          return
        }
        if (message.ready === true) {
          finishReady()
          return
        }
        if (message.ready === false) {
          finishReady(new Error(String(message.error || '语音模型加载失败')))
          return
        }
        const requestId = Number(message.id)
        const slot = this.pending.get(requestId)
        if (!slot) return
        this.pending.delete(requestId)
        clearTimeout(slot.timer)
        if (message.ok) slot.resolve(message)
        else slot.reject(new Error(String(message.error || '语音分析失败')))
      })

      proc.stderr.on('data', (chunk) => {
        const text = chunk.toString('utf8')
        for (const line of text.split(/\r?\n/)) {
          if (!line.trim()) continue
          this.stderr.push(line)
          if (this.stderr.length > 60) this.stderr.shift()
        }
      })

      const fail = (error) => {
        this.ready = false
        this.lastError = error.message
        if (!settled) finishReady(error)
        for (const slot of this.pending.values()) {
          clearTimeout(slot.timer)
          slot.reject(error)
        }
        this.pending.clear()
        this.proc = null
        this.startup = null
      }
      proc.on('error', fail)
      proc.on('exit', (code) => {
        if (!settled) finishReady(new Error(`语音后端退出（code=${code}）`))
        else if (this.proc === proc) {
          const detail = this.stderr.slice(-6).join('\n')
          fail(new Error(`语音后端意外退出（code=${code}）${detail ? `\n${detail}` : ''}`))
        }
      })
      proc.stdin.on('error', () => {})
    }).finally(() => {
      this.startup = null
    })
    return this.startup
  }

  request(wavPath) {
    const run = async () => {
      await this.ensureStarted()
      const proc = this.proc
      if (!proc || proc.killed || !proc.stdin) throw new Error('语音后端不可用')
      const id = ++this.nextId
      const result = new Promise((resolvePromise, rejectPromise) => {
        const timer = setTimeout(() => {
          this.pending.delete(id)
          this.lastError = '语音分析超时'
          proc.kill()
          rejectPromise(new Error(`${this.lastError}（>${Math.round(this.options.requestTimeoutMs / 1000)} 秒）`))
        }, this.options.requestTimeoutMs)
        this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timer })
      })
      proc.stdin.write(`${JSON.stringify({ id, wav: wavPath, language: this.options.language })}\n`)
      return result
    }
    const task = this.queue.then(run, run)
    this.queue = task.catch(() => {})
    return task
  }

  async analyze(wavPath) {
    return decorateAnalysis(await this.request(wavPath))
  }

  async close() {
    const proc = this.proc
    this.proc = null
    this.ready = false
    this.startup = null
    for (const slot of this.pending.values()) {
      clearTimeout(slot.timer)
      slot.reject(new Error('语音后端已关闭'))
    }
    this.pending.clear()
    if (!proc || proc.killed) return
    try {
      proc.stdin?.write('{"type":"shutdown"}\n')
      proc.stdin?.end()
    } catch {}
    const wait = new Promise((resolvePromise) => proc.once('exit', resolvePromise))
    const timeout = new Promise((resolvePromise) => setTimeout(resolvePromise, 2500))
    await Promise.race([wait, timeout])
    if (!proc.killed) proc.kill()
  }
}

function speechProviderReady(provider) {
  const phase = provider?.preparation?.phase
  return phase === undefined || ['ready', 'standby', 'waking'].includes(phase)
}

async function transcribeWithSpeech(audio, options, service) {
  if (!service) {
    throw new Error('DSH 自带语音输入未启用：请先在 插件 → Voice Input 中启用并准备本地模型，或配置 VoiceSense backendRoot')
  }
  const snapshot = service.snapshot?.() ?? { providers: [], selection: {} }
  const selected = snapshot.providers?.find((provider) => provider.id === snapshot.selection?.providerId)
    ?? snapshot.providers?.[0]
  if (!selected || !speechProviderReady(selected)) {
    throw new Error('DSH 语音模型尚未准备完成：请在 插件 → Voice Input 中下载/准备 SenseVoice 模型')
  }
  const spec = service.resolve({
    audio,
    language: options.language || 'auto',
  })
  const result = await service.transcribe(spec, AbortSignal.timeout(options.requestTimeoutMs))
  const text = String(result?.text || '').trim()
  if (!text) throw new Error('DSH 语音输入没有返回文字')
  return text
}

function createAnalyzeHandler(options, backend, getSpeechToText) {
  return async (req, res) => {
    if (!isLocalRequest(req)) {
      jsonResponse(res, 403, { error: '只允许本机访问' })
      return
    }
    if (req.method !== 'POST') {
      jsonResponse(res, 405, { error: 'method not allowed' })
      return
    }
    let tempDir
    try {
      const body = await readJsonBody(req, options.maxAudioBytes + 64 * 1024)
      const base64 = String(body.audioBase64 || '').replace(/^data:[^,]+,/, '')
      if (!base64) throw new Error('缺少录音数据')
      const buffer = Buffer.from(base64, 'base64')
      if (buffer.length < 400) throw new Error('录音太短，没有听清')
      if (buffer.length > options.maxAudioBytes) throw new Error('录音太长，请控制在 30 秒以内')
      if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
        throw new Error('录音格式不是 WAV')
      }
      tempDir = await mkdtemp(join(tmpdir(), 'dsh-dafeiyu-emotion-'))
      const wavPath = join(tempDir, 'voice.wav')
      await writeFile(wavPath, buffer)
      let analysis
      let localError
      if (options.backendRoot && existsSync(options.backendRoot)) {
        try {
          analysis = await backend.analyze(wavPath.replaceAll('\\', '/'))
        } catch (error) {
          localError = error instanceof Error ? error.message : String(error)
        }
      }
      if (!analysis) {
        try {
          const transcript = await transcribeWithSpeech(buffer, options, getSpeechToText())
          analysis = decorateAnalysis(buildFallbackAnalysis(transcript, body.prosody || {}))
        } catch (speechError) {
          const parts = []
          if (localError) parts.push(`本地增强后端：${localError}`)
          parts.push('轻量语音转写：' + (speechError instanceof Error ? speechError.message : String(speechError)))
          throw new Error(parts.join('\n'))
        }
      }
      jsonResponse(res, 200, analysis)
    } catch (error) {
      jsonResponse(res, 500, {
        error: error instanceof Error ? error.message : String(error),
        detail: backend.stderr?.slice(-8).join('\n') || undefined,
      })
    } finally {
      if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}

export function apply(ctx, rawConfig = {}) {
  const options = resolveOptions(rawConfig)
  if (!options.enabled) return
  const logger = ctx.logger ?? console
  const backend = new VoiceBackend(options, logger)
  let speechToText
  ctx.inject(['speechToText'], (speechCtx) => {
    speechToText = speechCtx.speechToText
    speechCtx.effect(() => () => {
      if (speechToText === speechCtx.speechToText) speechToText = undefined
    })
  })
  ctx.effect(() => () => backend.close())

  ctx.inject(['webServer'], (httpCtx) => {
    httpCtx.effect(
      () => httpCtx.webServer.register({
        kind: 'exact',
        path: HEALTH_ENDPOINT,
        handler(req, res) {
          if (!isLocalRequest(req)) {
            jsonResponse(res, 403, { error: '只允许本机访问' })
            return
          }
          jsonResponse(res, 200, {
            ok: true,
            enabled: options.enabled,
            language: options.language,
            engine: 'SenseVoice + emotion2vec',
            mode: options.backendRoot ? 'enhanced-local-backend' : 'dsh-speech-prosody',
            dshSpeechReady: Boolean(speechToText),
            ...backend.status(),
          })
        },
      }),
      'dsh-dafeiyu-emotion: 健康检查',
    )
    httpCtx.effect(
      () => httpCtx.webServer.register({
        kind: 'exact',
        path: ANALYZE_ENDPOINT,
        handler: createAnalyzeHandler(options, backend, () => speechToText),
      }),
      'dsh-dafeiyu-emotion: 本地语音情绪分析',
    )
  })

}

export { buildFallbackAnalysis, decorateAnalysis, transcribeWithSpeech }

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Schema from '@deepseek-ai/schemastery'

export const name = 'dsh-dafeiyu-emotion'
export const inject = ['webServer']

const ANALYZE_ENDPOINT = '/plugins/dsh-dafeiyu-emotion/analyze'
const HEALTH_ENDPOINT = '/plugins/dsh-dafeiyu-emotion/health'
const CONFIG_ENDPOINT = '/plugins/dsh-dafeiyu-emotion/config'
const CONTEXT_ENDPOINT = '/plugins/dsh-dafeiyu-emotion/context'
const TTS_ENDPOINT = '/plugins/dsh-dafeiyu-emotion/tts'
const EVENTS_ENDPOINT = '/plugins/dsh-dafeiyu-emotion/events'
const SETTINGS_NAMESPACE = 'dsh-dafeiyu-emotion'

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
  empathyStyle: 'gentle',
  ttsEnabled: true,
  ttsOnlyAfterVoice: true,
  ttsEngine: 'piper',
  ttsVoice: 'zh-CN-XiaoyiNeural',
  ttsRate: '+6%',
  ttsPitch: '+12Hz',
  ttsCommand: '',
  ttsPiperModel: '',
  ttsPiperCommand: '',
})

const CONFIG_FIELDS = new Set(Object.keys(DEFAULTS))
const LANGUAGES = new Set(['zh', 'en', 'auto'])

export const Config = Schema.object({
  enabled: Schema.boolean().default(true).description('启用情绪耳朵').volatile(),
  backendRoot: Schema.string().default('').description('VoiceSense 项目目录').volatile(),
  pythonPath: Schema.string().default('').description('Python 解释器路径').volatile(),
  language: Schema.union([
    Schema.const('zh').description('中文'),
    Schema.const('en').description('English'),
    Schema.const('auto').description('自动'),
  ]).default('zh').description('识别语言').volatile(),
  // Avoid step(): DSH validates numbers against (value - min) / step, and
  // the old 1 MiB step rejected the 12 MiB default. The custom settings card
  // already enforces its own input granularity.
  maxAudioBytes: Schema.number()
    .min(256 * 1024)
    .max(32 * 1024 * 1024)
    .default(12 * 1024 * 1024)
    .description('单次录音上限（字节）')
    .volatile(),
  startupTimeoutMs: Schema.number()
    .min(10000)
    .max(600000)
    .default(180000)
    .description('后端启动超时（毫秒）')
    .volatile(),
  requestTimeoutMs: Schema.number()
    .min(10000)
    .max(600000)
    .default(180000)
    .description('单次分析超时（毫秒）')
    .volatile(),
  empathyStyle: Schema.union([
    Schema.const('gentle').description('温柔'),
    Schema.const('direct').description('直接'),
    Schema.const('humorous').description('幽默'),
    Schema.const('concise').description('简洁'),
  ]).default('gentle').description('共情策略').volatile(),
  ttsEnabled: Schema.boolean().default(true).description('朗读大肥鱼回复').volatile(),
  ttsOnlyAfterVoice: Schema.boolean().default(true).description('只朗读语音触发的回复').volatile(),
  ttsEngine: Schema.union([
    Schema.const('piper').description('Piper 本地模型（推荐）'),
    Schema.const('edge').description('Edge TTS（更好听，需要网络）'),
    Schema.const('browser').description('浏览器本地语音'),
  ]).default('piper').description('语音合成引擎').volatile(),
  ttsVoice: Schema.string().default('zh-CN-XiaoyiNeural').description('Edge TTS 音色').volatile(),
  ttsRate: Schema.string().default('+6%').description('语速').volatile(),
  ttsPitch: Schema.string().default('+12Hz').description('音调').volatile(),
  ttsCommand: Schema.string().default('').description('edge-tts 可执行文件路径').volatile(),
  ttsPiperModel: Schema.string().default('').description('Piper 模型路径').volatile(),
  ttsPiperCommand: Schema.string().default('').description('Piper 可执行文件路径').volatile(),
}).description('大肥鱼语音情绪耳朵')

const EMOTION_ZH = Object.freeze({
  happy: '喜悦',
  sad: '低落',
  angry: '生气',
  fear: '紧张担忧',
  surprise: '惊讶',
  disgust: '厌烦',
  neutral: '平静',
})

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

function createAbortError() {
  const error = new Error('已取消')
  error.name = 'AbortError'
  return error
}

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
  if (res.writableEnded || res.destroyed) return
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function resolveEdgeTts(options) {
  const explicit = String(options?.ttsCommand || '').trim()
  if (explicit) return explicit
  const fromEnv = String(process.env.EDGE_TTS_PATH || '').trim()
  if (fromEnv) return fromEnv
  const local = process.env.LOCALAPPDATA
  const roaming = process.env.APPDATA
  const candidates = [
    local && join(local, 'Programs', 'Python', 'Python313', 'Scripts', 'edge-tts.exe'),
    local && join(local, 'Programs', 'Python', 'Python312', 'Scripts', 'edge-tts.exe'),
    roaming && join(roaming, 'Python', 'Python313', 'Scripts', 'edge-tts.exe'),
    'edge-tts',
  ].filter(Boolean)
  return candidates.find((candidate) => candidate === 'edge-tts' || existsSync(candidate)) || 'edge-tts'
}

function defaultPiperModel() {
  const home = process.env.USERPROFILE || process.env.HOME || ''
  return join(home, '.dsh', 'dafeiyu-emotion', 'tts', 'piper', 'zh_CN-huayan-medium.onnx')
}

function resolvePiperModel(options) {
  return String(options?.ttsPiperModel || process.env.DSH_DAFEIYU_PIPER_MODEL || defaultPiperModel()).trim()
}

function resolvePiperCommand(options) {
  const explicit = String(options?.ttsPiperCommand || process.env.PIPER_PATH || '').trim()
  if (explicit) return explicit
  const local = process.env.LOCALAPPDATA
  const candidates = [
    local && join(local, 'Programs', 'Python', 'Python313', 'Scripts', 'piper.exe'),
    local && join(local, 'Programs', 'Python', 'Python312', 'Scripts', 'piper.exe'),
    'piper',
  ].filter(Boolean)
  return candidates.find((candidate) => candidate === 'piper' || existsSync(candidate)) || 'piper'
}

async function synthesizePiper(text, options) {
  const model = resolvePiperModel(options)
  const command = resolvePiperCommand(options)
  if (!existsSync(model)) throw new Error(`Piper 模型不存在：${model}`)
  const config = `${model}.json`
  if (!existsSync(config)) throw new Error(`Piper 模型配置不存在：${config}`)
  const dir = await mkdtemp(join(tmpdir(), 'dsh-dafeiyu-tts-'))
  const input = join(dir, 'input.txt')
  const out = join(dir, 'reply.wav')
  try {
    await writeFile(input, text, 'utf8')
    const speed = Number.parseFloat(String(options.ttsRate || '+0%').replace('%', ''))
    const lengthScale = Number.isFinite(speed) && speed !== 0 ? 1 / (1 + speed / 100) : 1
    await new Promise((resolvePromise, rejectPromise) => {
      const proc = spawn(command, [
        '-m', model,
        '-c', config,
        '-i', input,
        '-f', out,
        '--length-scale', String(Math.max(0.7, Math.min(1.4, lengthScale))),
      ], {
        windowsHide: true,
        env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      })
      let stderr = ''
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        try { proc.kill() } catch {}
        rejectPromise(new Error('Piper 合成超时'))
      }, 30000)
      proc.stderr?.on('data', (chunk) => { stderr += chunk.toString('utf8') })
      proc.on('error', (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        rejectPromise(error)
      })
      proc.on('exit', (code) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (code === 0) resolvePromise()
        else rejectPromise(new Error(stderr.trim() || `piper 退出（code=${code}）`))
      })
    })
    return await readFile(out)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

function ttsReady(options) {
  if (!options.ttsEnabled) return false
  if (options.ttsEngine === 'browser') return true
  if (options.ttsEngine === 'piper') return existsSync(resolvePiperModel(options))
  return existsSync(resolveEdgeTts(options))
}

function assistantTextFromEvent(event) {
  const content = event?.data?.message?.content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
}

function cleanForSpeech(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~>#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 800)
}

async function synthesizeEdge(text, options) {
  const command = resolveEdgeTts(options)
  const dir = await mkdtemp(join(tmpdir(), 'dsh-dafeiyu-tts-'))
  const out = join(dir, 'reply.mp3')
  try {
    await new Promise((resolvePromise, rejectPromise) => {
      const proc = spawn(command, [
        '--voice', options.ttsVoice,
        '--rate', options.ttsRate,
        '--pitch', options.ttsPitch,
        '--text', text,
        '--write-media', out,
      ], { windowsHide: true })
      let stderr = ''
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        try { proc.kill() } catch {}
        rejectPromise(new Error('TTS 合成超时'))
      }, 25000)
      proc.stderr?.on('data', (chunk) => { stderr += chunk.toString('utf8') })
      proc.on('error', (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        rejectPromise(error)
      })
      proc.on('exit', (code) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (code === 0) resolvePromise()
        else rejectPromise(new Error(stderr.trim() || `edge-tts 退出（code=${code}）`))
      })
    })
    return await readFile(out)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

function createTtsHandler(runtime) {
  return async (req, res) => {
    if (!isLocalRequest(req)) {
      jsonResponse(res, 403, { error: '只允许本机访问' })
      return
    }
    if (req.method !== 'POST') {
      jsonResponse(res, 405, { error: 'method not allowed' })
      return
    }
    if (!runtime.options.ttsEnabled) {
      jsonResponse(res, 503, { error: '语音回复已关闭' })
      return
    }
    try {
      const body = await readJsonBody(req, 16 * 1024)
      const text = cleanForSpeech(body?.text)
      if (!text) throw new HttpError(400, '没有可朗读的文本')
      if (runtime.options.ttsEngine === 'browser') {
        throw new HttpError(400, '浏览器语音引擎在客户端本地运行，不需要调用 Host TTS')
      }
      const voice = String(body?.voice || runtime.options.ttsVoice)
      const rate = String(body?.rate || runtime.options.ttsRate)
      const pitch = String(body?.pitch || runtime.options.ttsPitch)
      if (!/^[+-]\d{1,3}%$/.test(rate)) throw new HttpError(400, '语速格式不合法')
      let audio
      let contentType
      if (runtime.options.ttsEngine === 'piper') {
        audio = await synthesizePiper(text, { ...runtime.options, ttsRate: rate })
        contentType = 'audio/wav'
      } else {
        if (!/^[A-Za-z]{2,3}-[A-Za-z0-9-]+Neural$/.test(voice)) throw new HttpError(400, '音色不合法')
        if (!/^[+-]\d{1,3}Hz$/.test(pitch)) throw new HttpError(400, '音调格式不合法')
        audio = await synthesizeEdge(text, {
          ...runtime.options,
          ttsVoice: voice,
          ttsRate: rate,
          ttsPitch: pitch,
        })
        contentType = 'audio/mpeg'
      }
      res.writeHead(200, {
        'content-type': contentType,
        'cache-control': 'no-store',
        'content-length': audio.length,
      })
      res.end(audio)
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 502
      jsonResponse(res, status, {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

function createSpeechStream() {
  const clients = new Set()
  return {
    add(res) {
      clients.add(res)
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      })
      res.write(': connected\n\n')
      const timer = setInterval(() => {
        try {
          res.write(': ping\n\n')
        } catch {
          clearInterval(timer)
          clients.delete(res)
        }
      }, 15000)
      res.on('close', () => {
        clearInterval(timer)
        clients.delete(res)
      })
    },
    broadcast(message) {
      const payload = `data: ${JSON.stringify(message)}\n\n`
      for (const res of clients) {
        try {
          res.write(payload)
        } catch {
          clients.delete(res)
        }
      }
    },
    close() {
      for (const res of clients) {
        try { res.end() } catch {}
      }
      clients.clear()
    },
  }
}

async function readJsonBody(req, limit) {
  const chunks = []
  let bytes = 0
  for await (const chunk of req) {
    bytes += chunk.length
    if (bytes > limit) throw new HttpError(413, '请求体过大，请缩短录音后重试')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, '请求体不是合法的 JSON')
  }
}

function asNumber(value, fallback) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

/**
 * DSH settings projects volatile Config fields as live refs (`{ get() }`).
 * Unwrap them before path/string/number handling, otherwise String(ref)
 * becomes "[object Object]" and a path is resolved into the profile cwd.
 */
function plainConfig(value, stack = new WeakSet(), depth = 0) {
  if (depth > 20) return undefined
  if (value && typeof value === 'object') {
    if (stack.has(value)) return undefined
    stack.add(value)
    try {
      if (typeof value.get === 'function') return plainConfig(value.get(), stack, depth + 1)
      if (Array.isArray(value)) return value.map((child) => plainConfig(child, stack, depth + 1))
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, plainConfig(child, stack, depth + 1)]))
    } finally {
      stack.delete(value)
    }
  }
  return value
}

function resolveOptions(raw = {}) {
  const value = plainConfig(raw)
  const backendSource = value.backendRoot === undefined
    ? process.env.DSH_DAFEIYU_EMOTION_BACKEND
    : value.backendRoot
  return {
    enabled: value.enabled !== false,
    backendRoot: String(backendSource || DEFAULTS.backendRoot).trim()
      ? resolve(String(backendSource || DEFAULTS.backendRoot))
      : '',
    pythonPath: String(value.pythonPath || '').trim(),
    language: ['zh', 'en', 'auto'].includes(value.language) ? value.language : DEFAULTS.language,
    empathyStyle: ['gentle', 'direct', 'humorous', 'concise'].includes(value.empathyStyle)
      ? value.empathyStyle
      : DEFAULTS.empathyStyle,
    ttsEnabled: value.ttsEnabled === true,
    ttsOnlyAfterVoice: value.ttsOnlyAfterVoice !== false,
    ttsEngine: ['piper', 'edge', 'browser'].includes(value.ttsEngine) ? value.ttsEngine : DEFAULTS.ttsEngine,
    ttsVoice: String(value.ttsVoice || DEFAULTS.ttsVoice).trim(),
    ttsRate: String(value.ttsRate || DEFAULTS.ttsRate).trim(),
    ttsPitch: String(value.ttsPitch || DEFAULTS.ttsPitch).trim(),
    ttsCommand: String(value.ttsCommand || '').trim(),
    ttsPiperModel: String(value.ttsPiperModel || '').trim(),
    ttsPiperCommand: String(value.ttsPiperCommand || '').trim(),
    maxAudioBytes: Math.min(32 * 1024 * 1024, Math.max(256 * 1024, asNumber(value.maxAudioBytes, DEFAULTS.maxAudioBytes))),
    startupTimeoutMs: Math.min(600000, Math.max(10000, asNumber(value.startupTimeoutMs, DEFAULTS.startupTimeoutMs))),
    requestTimeoutMs: Math.min(600000, Math.max(10000, asNumber(value.requestTimeoutMs, DEFAULTS.requestTimeoutMs))),
  }
}

function publicConfig(options, writable = false) {
  return {
    enabled: options.enabled !== false,
    backendRoot: options.backendRoot || '',
    pythonPath: options.pythonPath || '',
    language: options.language || DEFAULTS.language,
    empathyStyle: options.empathyStyle || DEFAULTS.empathyStyle,
    ttsEnabled: options.ttsEnabled === true,
    ttsOnlyAfterVoice: options.ttsOnlyAfterVoice !== false,
    ttsEngine: options.ttsEngine || DEFAULTS.ttsEngine,
    ttsVoice: options.ttsVoice || DEFAULTS.ttsVoice,
    ttsRate: options.ttsRate || DEFAULTS.ttsRate,
    ttsPitch: options.ttsPitch || DEFAULTS.ttsPitch,
    ttsCommand: options.ttsCommand || '',
    ttsPiperModel: options.ttsPiperModel || '',
    ttsPiperCommand: options.ttsPiperCommand || '',
    maxAudioBytes: options.maxAudioBytes,
    startupTimeoutMs: options.startupTimeoutMs,
    requestTimeoutMs: options.requestTimeoutMs,
    writable,
  }
}

function normalizeConfigPatch(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, '配置必须是一个对象')
  }
  const patch = {}
  for (const [key, next] of Object.entries(value)) {
    if (!CONFIG_FIELDS.has(key)) throw new HttpError(400, `未知配置项：${key}`)
    if (key === 'enabled') {
      if (typeof next !== 'boolean') throw new HttpError(400, 'enabled 必须是布尔值')
      patch.enabled = next
      continue
    }
    if (key === 'language') {
      const language = String(next || '').trim().toLowerCase()
      if (!LANGUAGES.has(language)) throw new HttpError(400, 'language 只能是 zh、en 或 auto')
      patch.language = language
      continue
    }
    if (key === 'empathyStyle') {
      const style = String(next || '').trim().toLowerCase()
      if (!['gentle', 'direct', 'humorous', 'concise'].includes(style)) {
        throw new HttpError(400, 'empathyStyle 只能是 gentle、direct、humorous 或 concise')
      }
      patch.empathyStyle = style
      continue
    }
    if (key === 'ttsEnabled') {
      if (typeof next !== 'boolean') throw new HttpError(400, 'ttsEnabled 必须是布尔值')
      patch.ttsEnabled = next
      continue
    }
    if (key === 'ttsOnlyAfterVoice') {
      if (typeof next !== 'boolean') throw new HttpError(400, 'ttsOnlyAfterVoice 必须是布尔值')
      patch.ttsOnlyAfterVoice = next
      continue
    }
    if (key === 'ttsEngine') {
      const engine = String(next || '').trim().toLowerCase()
      if (!['piper', 'edge', 'browser'].includes(engine)) {
        throw new HttpError(400, 'ttsEngine 只能是 piper、edge 或 browser')
      }
      patch.ttsEngine = engine
      continue
    }
    if (key === 'ttsVoice') {
      const voice = String(next || '').trim()
      if (!/^[A-Za-z]{2,3}-[A-Za-z0-9-]+Neural$/.test(voice)) {
        throw new HttpError(400, 'ttsVoice 不是合法的 Edge TTS 音色')
      }
      patch.ttsVoice = voice
      continue
    }
    if (key === 'ttsRate' || key === 'ttsPitch') {
      const value = String(next || '').trim()
      const pattern = key === 'ttsRate' ? /^[+-]\d{1,3}%$/ : /^[+-]\d{1,3}Hz$/
      if (!pattern.test(value)) {
        throw new HttpError(400, `${key} 格式应为 ${key === 'ttsRate' ? '+6%' : '+12Hz'}`)
      }
      patch[key] = value
      continue
    }
    if (key === 'ttsCommand') {
      if (typeof next !== 'string') throw new HttpError(400, 'ttsCommand 必须是字符串')
      const text = next.trim()
      if (text.length > 500 || /[\u0000-\u001f]/.test(text)) {
        throw new HttpError(400, 'ttsCommand 不是合法的路径')
      }
      patch.ttsCommand = text
      continue
    }
    if (key === 'ttsPiperModel' || key === 'ttsPiperCommand') {
      if (typeof next !== 'string') throw new HttpError(400, `${key} 必须是字符串`)
      const text = next.trim()
      if (text.length > 500 || /[\u0000-\u001f]/.test(text)) {
        throw new HttpError(400, `${key} 不是合法的路径`)
      }
      patch[key] = text
      continue
    }
    if (key === 'backendRoot' || key === 'pythonPath') {
      if (typeof next !== 'string') throw new HttpError(400, `${key} 必须是字符串`)
      const text = next.trim()
      if (text.length > 500 || /[\u0000-\u001f]/.test(text)) {
        throw new HttpError(400, `${key} 不是合法的本地路径`)
      }
      patch[key] = text
      continue
    }
    if (typeof next !== 'number' || !Number.isFinite(next) || !Number.isInteger(next)) {
      throw new HttpError(400, `${key} 必须是整数`)
    }
    const numeric = next
    if (key === 'maxAudioBytes') {
      patch.maxAudioBytes = Math.round(Math.min(32 * 1024 * 1024, Math.max(256 * 1024, numeric)))
    } else {
      patch[key] = Math.round(Math.min(600000, Math.max(10000, numeric)))
    }
  }
  return patch
}

function resolveSettings(service) {
  if (typeof service?.describe !== 'function') return null
  try {
    const entries = service.describe()
    const entry = entries.find((row) => row?.ns === SETTINGS_NAMESPACE)
      ?? entries.find((row) => row?.value && ('backendRoot' in row.value || 'maxAudioBytes' in row.value))
    if (!entry) return null
    return {
      ns: entry.ns,
      revision: Number.isInteger(entry.revision) ? entry.revision : null,
      value: plainConfig({ ...(entry.value || {}), ...(entry.user || {}) }),
    }
  } catch {
    return null
  }
}

function createConfigHandler({ runtime, backend, getSettings }) {
  return async (req, res) => {
    if (!isLocalRequest(req)) {
      jsonResponse(res, 403, { error: '只允许本机访问' })
      return
    }
    const settings = getSettings()
    const stored = resolveSettings(settings)
    const writable = Boolean(stored?.ns && typeof settings?.update === 'function')
    if (req.method === 'GET') {
      const options = stored ? resolveOptions({ ...runtime.options, ...stored.value }) : runtime.options
      jsonResponse(res, 200, {
        ...publicConfig(options, writable),
        revision: stored?.revision ?? null,
      })
      return
    }
    if (req.method !== 'PATCH') {
      jsonResponse(res, 405, { error: 'method not allowed' })
      return
    }
    if (!writable) {
      jsonResponse(res, 503, {
        error: '当前 DSH 版本不支持在设置页写入插件配置，请修改 profile 的 cordis.patch.yml 后重启',
      })
      return
    }
    try {
      const body = await readJsonBody(req, 16 * 1024)
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        throw new HttpError(400, '配置必须是一个对象')
      }
      const expectedRevision = Number.isInteger(body?.expectedRevision) ? body.expectedRevision : undefined
      const { expectedRevision: _expectedRevision, ...configBody } = body
      const patch = normalizeConfigPatch(configBody)
      const before = { ...runtime.options }
      await settings.update(stored.ns, patch, expectedRevision)
      const next = resolveOptions({ ...runtime.options, ...patch })
      Object.assign(runtime.options, next)
      backend.syncOptions(before)
      const nextStored = resolveSettings(settings)
      jsonResponse(res, 200, {
        ...publicConfig(runtime.options, true),
        revision: nextStored?.revision ?? null,
      })
    } catch (error) {
      const conflict = error?.name === 'SettingsConflictError'
        || /changed since it was read/.test(error?.message || '')
      const status = conflict ? 409 : error instanceof HttpError ? error.status : 500
      jsonResponse(res, status, {
        error: error instanceof Error ? error.message : String(error),
      })
    }
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

const EMPATHY_STYLES = Object.freeze({
  gentle: '先自然承接对方的情绪，再回答问题；语气柔和，情绪明显时先共情、后给建议，避免机械说教或过度热情。',
  direct: '先用一句话确认你听到的重点，再给出清晰结论和下一步；直接但不冷漠，不绕弯。',
  humorous: '可以先轻轻接住情绪，再用一点轻松的幽默缓和气氛；不要拿对方的情绪开玩笑，也不要在严肃问题上强行搞笑。',
  concise: '用一两句话承接情绪，然后直接回答；不展开分析，不复述情绪标签，保持简短。',
})

function buildPrompt(analysis, style = 'gentle') {
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
    `回复要求：${EMPATHY_STYLES[style] || EMPATHY_STYLES.gentle}`,
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

function decorateAnalysis(raw, style = 'gentle') {
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
  analysis.prompt = buildPrompt(analysis, style)
  return analysis
}

class VoiceBackend {
  constructor(options, logger) {
    this.options = options
    this.logger = logger
    this.python = options.pythonPath || null
    this.startedAt = null
    this.readyAt = null
    this.proc = null
    this.ready = null
    this.startup = null
    this.startupAbort = null
    this.pending = new Map()
    this.nextId = 0
    this.nextQueueId = 0
    this.activeRequestId = null
    this.queue = Promise.resolve()
    this.closed = false
    this.generation = 0
    this.stderr = []
    this.lastError = null
  }

  noteError(message) {
    this.lastError = message
  }

  /**
   * Stop one worker deliberately. Unlike an unexpected exit this keeps the
   * existing lastError (a timeout/cancel reason) instead of overwriting it
   * with a generic "worker exited" message.
   */
  stopProcess(proc, { error, preserveLastError = false } = {}) {
    if (this.proc !== proc) return
    this.startupAbort?.()
    this.proc = null
    this.ready = false
    if (!preserveLastError && error) this.lastError = error.message
    const pending = [...this.pending.entries()]
    this.pending.clear()
    for (const [, slot] of pending) {
      clearTimeout(slot.timer)
      slot.reject(error || new Error('语音后端已停止'))
    }
    try {
      proc.kill()
    } catch {}
  }

  /**
   * Abort one request. A queued request that has not reached the worker yet
   * must not kill the worker serving the active request; its own AbortSignal
   * will make it exit before it writes anything.
   */
  cancel(requestId) {
    if (requestId !== undefined && this.activeRequestId !== requestId) return
    const proc = this.proc
    if (!proc) return
    this.stopProcess(proc, { error: createAbortError(), preserveLastError: true })
  }

  /**
   * Adopt a new runtime configuration. A changed interpreter, backend root or
   * timeout invalidates the live worker, so stop it once; the next request
   * starts a fresh one with the new settings. Language changes are cheap and
   * are read from the shared options object on the next request.
   */
  syncOptions(previous = {}) {
    const next = this.options
    this.python = next.pythonPath || null
    this.startedAt = null
    this.readyAt = null
    this.closed = !next.enabled
    const restart = previous.backendRoot !== next.backendRoot
      || previous.pythonPath !== next.pythonPath
      || previous.startupTimeoutMs !== next.startupTimeoutMs
      || previous.requestTimeoutMs !== next.requestTimeoutMs
    if (!next.enabled) {
      void this.close()
      return
    }
    if (restart) {
      const proc = this.proc
      if (proc) {
        this.stopProcess(proc, {
          error: new Error('配置已更新，语音后端将在下次请求时重新启动'),
          preserveLastError: true,
        })
      }
    }
  }

  status() {
    return {
      state: this.proc && !this.proc.killed ? (this.ready ? 'ready' : 'starting') : 'sleeping',
      pid: this.proc?.pid ?? null,
      python: this.python,
      backendRoot: this.options.backendRoot,
      modelLoadMs: this.startedAt && this.readyAt ? this.readyAt - this.startedAt : null,
      lastError: this.lastError,
    }
  }

  ensureStarted() {
    if (this.closed || !this.options.enabled) {
      return Promise.reject(new Error('情绪耳朵已关闭'))
    }
    if (this.proc && !this.proc.killed && this.ready) return Promise.resolve()
    if (this.startup) return this.startup
    this.startup = new Promise((resolvePromise, rejectPromise) => {
      if (!existsSync(this.options.backendRoot)) {
        this.lastError = `语音后端目录不存在：${this.options.backendRoot}`
        rejectPromise(new Error(this.lastError))
        return
      }
      if (!existsSync(defaultWorker)) {
        this.lastError = `插件自带 worker 缺失：${defaultWorker}`
        rejectPromise(new Error(this.lastError))
        return
      }
      if (!this.python) this.python = locatePython(this.options)
      this.startedAt = Date.now()
      this.readyAt = null
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
        const error = new Error(`语音模型加载超时（>${Math.round(this.options.startupTimeoutMs / 1000)} 秒）`)
        this.lastError = '语音模型加载超时'
        this.stopProcess(proc, { error, preserveLastError: true })
        rejectPromise(error)
      }, this.options.startupTimeoutMs)

      const finishReady = (error) => {
        if (this.proc !== proc) return
        if (settled) return
        settled = true
        this.startupAbort = null
        clearTimeout(timer)
        if (error) {
          this.lastError = error.message
          this.stopProcess(proc, { error, preserveLastError: true })
          rejectPromise(error)
          return
        }
        this.ready = true
        this.readyAt = Date.now()
        this.lastError = null
        resolvePromise()
      }

      this.startupAbort = () => {
        if (settled) return
        settled = true
        this.startupAbort = null
        clearTimeout(timer)
        rejectPromise(createAbortError())
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
        if (this.proc !== proc) return
        if (!settled) {
          finishReady(error)
          return
        }
        this.lastError = error.message
        this.stopProcess(proc, { error, preserveLastError: true })
      }
      proc.on('error', fail)
      proc.on('exit', (code) => {
        if (this.proc !== proc) return
        if (!settled) {
          finishReady(new Error(`语音后端退出（code=${code}）`))
          return
        }
        const detail = this.stderr.slice(-6).join('\n')
        const error = new Error(`语音后端意外退出（code=${code}）${detail ? `\n${detail}` : ''}`)
        this.lastError = error.message
        this.stopProcess(proc, { error, preserveLastError: true })
      })
      proc.stdin.on('error', (error) => {
        if (this.proc !== proc) return
        const wrapped = error instanceof Error ? error : new Error(String(error))
        this.lastError = `语音后端写入失败：${wrapped.message}`
        this.stopProcess(proc, { error: wrapped, preserveLastError: true })
      })
    }).finally(() => {
      this.startup = null
      this.startupAbort = null
    })
    return this.startup
  }

  request(wavPath, signal) {
    const requestId = ++this.nextQueueId
    const generation = this.generation
    const run = async () => {
      if (this.closed || generation !== this.generation) throw new Error('语音后端已关闭')
      if (signal?.aborted) throw createAbortError()
      await this.ensureStarted()
      if (this.closed || generation !== this.generation) throw new Error('语音后端已关闭')
      if (signal?.aborted) throw createAbortError()
      const proc = this.proc
      if (!proc || proc.killed || !proc.stdin) throw new Error('语音后端不可用')
      this.activeRequestId = requestId
      const id = ++this.nextId
      let settled = false
      let timer
      const onAbort = () => {
        if (this.activeRequestId === requestId) this.cancel(requestId)
      }
      signal?.addEventListener?.('abort', onAbort, { once: true })
      const result = new Promise((resolvePromise, rejectPromise) => {
        const finish = (callback, value) => {
          if (settled) return
          settled = true
          if (timer) clearTimeout(timer)
          this.pending.delete(id)
          callback(value)
        }
        timer = setTimeout(() => {
          const error = new Error(`语音分析超时（>${Math.round(this.options.requestTimeoutMs / 1000)} 秒）`)
          this.lastError = '语音分析超时'
          this.stopProcess(proc, { error, preserveLastError: true })
        }, this.options.requestTimeoutMs)
        this.pending.set(id, {
          resolve: (message) => finish(resolvePromise, message),
          reject: (error) => finish(rejectPromise, error),
          timer,
        })
      })
      try {
        proc.stdin.write(`${JSON.stringify({ id, wav: wavPath, language: this.options.language })}\n`)
      } catch (error) {
        const wrapped = error instanceof Error ? error : new Error(String(error))
        this.lastError = `语音后端写入失败：${wrapped.message}`
        this.stopProcess(proc, { error: wrapped, preserveLastError: true })
        result.catch(() => {})
        signal?.removeEventListener?.('abort', onAbort)
        if (this.activeRequestId === requestId) this.activeRequestId = null
        throw wrapped
      }
      try {
        return await result
      } finally {
        signal?.removeEventListener?.('abort', onAbort)
        if (this.activeRequestId === requestId) this.activeRequestId = null
      }
    }
    const task = this.queue.then(run, run)
    this.queue = task.catch(() => {})
    return task
  }

  async analyze(wavPath, signal, style = 'gentle') {
    return decorateAnalysis(await this.request(wavPath, signal), style)
  }

  async close() {
    this.closed = true
    this.generation += 1
    this.activeRequestId = null
    const proc = this.proc
    this.startupAbort?.()
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

async function transcribeWithSpeech(audio, options, service, signal) {
  if (signal?.aborted) throw createAbortError()
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
    providerId: selected.id,
  })
  const timeout = AbortSignal.timeout(options.requestTimeoutMs)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  const result = await service.transcribe(spec, combined)
  const text = String(result?.text || '').trim()
  if (!text) throw new Error('DSH 语音输入没有返回文字')
  return text
}

function speechStatus(service) {
  if (!service) return { ready: false, provider: null, phase: null }
  try {
    const snapshot = service.snapshot?.() ?? { providers: [], selection: {} }
    const selected = snapshot.providers?.find((provider) => provider.id === snapshot.selection?.providerId)
      ?? snapshot.providers?.[0]
    return {
      ready: Boolean(selected && speechProviderReady(selected)),
      provider: selected?.id ?? null,
      phase: selected?.preparation?.phase ?? null,
    }
  } catch {
    return { ready: false, provider: null, phase: null }
  }
}

function createAnalyzeHandler(runtime, backend, getSpeechToText) {
  return async (req, res) => {
    const options = runtime.options
    if (!isLocalRequest(req)) {
      jsonResponse(res, 403, { error: '只允许本机访问' })
      return
    }
    if (req.method !== 'POST') {
      jsonResponse(res, 405, { error: 'method not allowed' })
      return
    }
    if (!options.enabled) {
      jsonResponse(res, 503, { error: '情绪耳朵已在设置中关闭' })
      return
    }
    let tempDir
    let controller
    const onClose = () => {
      if (res.writableEnded) return
      controller?.abort()
    }
    try {
      controller = new AbortController()
      req.once?.('aborted', onClose)
      res.once?.('close', onClose)
      const bodyLimit = Math.ceil(options.maxAudioBytes / 3) * 4 + 64 * 1024
      const body = await readJsonBody(req, bodyLimit)
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new HttpError(400, '请求体必须是 JSON 对象')
      }
      const base64 = String(body.audioBase64 || '').replace(/^data:[^,]+,/, '')
      if (!base64) throw new HttpError(400, '缺少录音数据')
      const buffer = Buffer.from(base64, 'base64')
      if (buffer.length < 400) throw new HttpError(400, '录音太短，没有听清')
      if (buffer.length > options.maxAudioBytes) throw new HttpError(413, '录音太大，请缩短录音后重试')
      if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
        throw new HttpError(400, '录音格式不是 WAV')
      }
      tempDir = await mkdtemp(join(tmpdir(), 'dsh-dafeiyu-emotion-'))
      const wavPath = join(tempDir, 'voice.wav')
      await writeFile(wavPath, buffer)
      let analysis
      let localError
      if (options.backendRoot && !existsSync(options.backendRoot)) {
        localError = `语音后端目录不存在：${options.backendRoot}`
      }
      if (options.backendRoot && existsSync(options.backendRoot)) {
        try {
          analysis = await backend.analyze(wavPath.replaceAll('\\', '/'), controller.signal, options.empathyStyle)
        } catch (error) {
          localError = error instanceof Error ? error.message : String(error)
        }
      }
      if (controller.signal.aborted) return
      if (!analysis) {
        try {
          const transcript = await transcribeWithSpeech(buffer, options, getSpeechToText(), controller.signal)
          analysis = decorateAnalysis(buildFallbackAnalysis(transcript, body.prosody || {}), options.empathyStyle)
        } catch (speechError) {
          const parts = []
          if (localError) parts.push(`本地增强后端：${localError}`)
          parts.push('轻量语音转写：' + (speechError instanceof Error ? speechError.message : String(speechError)))
          throw new Error(parts.join('\n'))
        }
      }
      if (controller.signal.aborted || res.writableEnded) return
      runtime.lastAnalysis = {
        emotion: analysis.emotion,
        emotionZh: analysis.emotionZh,
        confidence: analysis.confidence,
        toneSummary: analysis.toneSummary,
        source: analysis.source,
        at: new Date().toISOString(),
      }
      runtime.lastAudioBytes = buffer.length
      runtime.lastAnalysisAt = runtime.lastAnalysis.at
      runtime.lastVoiceAt = Date.now()
      jsonResponse(res, 200, analysis)
    } catch (error) {
      if (controller?.signal.aborted || res.writableEnded) return
      const status = error instanceof HttpError ? error.status : 500
      jsonResponse(res, status, {
        error: error instanceof Error ? error.message : String(error),
        detail: status >= 500 ? backend.stderr?.slice(-8).join('\n') || undefined : undefined,
      })
    } finally {
      req.off?.('aborted', onClose)
      res.off?.('close', onClose)
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {})
        runtime.lastCleanupAt = new Date().toISOString()
      }
    }
  }
}

export function apply(ctx, rawConfig = {}) {
  const logger = ctx.logger ?? console
  // Resolve settings through ctx.inject below instead of a hard dependency.
  // A hard `settings` inject can deadlock host startup while the settings
  // service is still building the plugin Config projections.
  let settingsService
  const runtime = {
    // Do not call settings.describe() here: this runs inside the host's
    // startup transaction and describing every plugin can deadlock the host.
    // The patch config is authoritative at mount time; PATCH updates the
    // shared runtime object and settings.update persists it for the next boot.
    options: resolveOptions(rawConfig),
    lastAnalysis: null,
    lastVoiceAt: null,
    lastAudioBytes: 0,
    lastAnalysisAt: null,
    lastCleanupAt: null,
  }
  const backend = new VoiceBackend(runtime.options, logger)
  const speechStream = createSpeechStream()
  let speechToText
  ctx.inject(['settings'], (settingsCtx) => {
    settingsService = settingsCtx.settings
  })
  ctx.inject(['speechToText'], (speechCtx) => {
    speechToText = speechCtx.speechToText
    speechCtx.effect(() => () => {
      if (speechToText === speechCtx.speechToText) speechToText = undefined
    })
  })
  ctx.effect(() => () => backend.close())
  ctx.effect(() => () => speechStream.close())

  ctx.inject(['sessions'], (sessionCtx) => {
    try {
      const off = sessionCtx.on?.('session/event', (session, event) => {
        if (event?.type !== 'assistant/message' || !runtime.options.ttsEnabled) return
        if (runtime.options.ttsOnlyAfterVoice
          && (!runtime.lastVoiceAt || Date.now() - runtime.lastVoiceAt > 120000)) return
        const text = cleanForSpeech(assistantTextFromEvent(event))
        if (!text) return
        speechStream.broadcast({
          kind: 'assistant',
          sessionId: String(session?.header?.id ?? session?.id ?? ''),
          text,
        })
      })
      if (typeof off === 'function') ctx.effect(() => off)
    } catch (error) {
      logger.warn?.('[dsh-dafeiyu-emotion] failed to subscribe to session events:', error)
    }
  })

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
          const options = runtime.options
          const speech = speechStatus(speechToText)
          const backendConfigured = Boolean(options.backendRoot)
          const backendAvailable = backendConfigured && existsSync(options.backendRoot)
          if (backendAvailable && backend.lastError?.startsWith('语音后端目录不存在：')) {
            backend.noteError(null)
          } else if (backendConfigured && !backendAvailable && !backend.lastError) {
            backend.noteError(`语音后端目录不存在：${options.backendRoot}`)
          }
          const backendStatus = backend.status()
          jsonResponse(res, 200, {
            ok: true,
            enabled: options.enabled,
            language: options.language,
            empathyStyle: options.empathyStyle,
            ttsEnabled: options.ttsEnabled,
            ttsOnlyAfterVoice: options.ttsOnlyAfterVoice,
            ttsEngine: options.ttsEngine,
            ttsVoice: options.ttsVoice,
            ttsReady: ttsReady(options),
            engine: backendAvailable ? 'SenseVoice + emotion2vec' : 'DSH Speech + prosody',
            mode: !backendConfigured
              ? 'dsh-speech-prosody'
              : backendAvailable
                ? 'enhanced-local-backend'
                : 'enhanced-backend-missing',
            dshSpeechReady: speech.ready,
            speechProvider: speech.provider,
            speechPhase: speech.phase,
            backendConfigured,
            backendAvailable,
            lastAnalysis: runtime.lastAnalysis,
            privacy: {
              lastAudioBytes: runtime.lastAudioBytes,
              lastAnalysisAt: runtime.lastAnalysisAt,
              lastVoiceAt: runtime.lastVoiceAt,
              lastCleanupAt: runtime.lastCleanupAt,
              workerPid: backendStatus.pid,
              modelLoadMs: backendStatus.modelLoadMs,
            },
            ...backendStatus,
          })
        },
      }),
      'dsh-dafeiyu-emotion: 健康检查',
    )
    httpCtx.effect(
      () => httpCtx.webServer.register({
        kind: 'exact',
        path: ANALYZE_ENDPOINT,
        handler: createAnalyzeHandler(runtime, backend, () => speechToText),
      }),
      'dsh-dafeiyu-emotion: 本地语音情绪分析',
    )
    httpCtx.effect(
      () => httpCtx.webServer.register({
        kind: 'exact',
        path: CONFIG_ENDPOINT,
        handler: createConfigHandler({
          runtime,
          backend,
          getSettings: () => settingsService,
        }),
      }),
      'dsh-dafeiyu-emotion: 设置读写',
    )
    httpCtx.effect(
      () => httpCtx.webServer.register({
        kind: 'exact',
        path: CONTEXT_ENDPOINT,
        handler(req, res) {
          if (!isLocalRequest(req)) {
            jsonResponse(res, 403, { error: '只允许本机访问' })
            return
          }
          if (req.method !== 'GET') {
            jsonResponse(res, 405, { error: 'method not allowed' })
            return
          }
          jsonResponse(res, 200, {
            ok: true,
            lastAnalysis: runtime.lastAnalysis,
            empathyStyle: runtime.options.empathyStyle,
            language: runtime.options.language,
          })
        },
      }),
      'dsh-dafeiyu-emotion: 最近情绪上下文',
    )
    httpCtx.effect(
      () => httpCtx.webServer.register({
        kind: 'exact',
        path: TTS_ENDPOINT,
        handler: createTtsHandler(runtime),
      }),
      'dsh-dafeiyu-emotion: 语音合成',
    )
    httpCtx.effect(
      () => httpCtx.webServer.register({
        kind: 'exact',
        path: EVENTS_ENDPOINT,
        handler(req, res) {
          if (!isLocalRequest(req)) {
            jsonResponse(res, 403, { error: '只允许本机访问' })
            return
          }
          if (req.method !== 'GET') {
            jsonResponse(res, 405, { error: 'method not allowed' })
            return
          }
          speechStream.add(res)
        },
      }),
      'dsh-dafeiyu-emotion: 回复语音事件',
    )
  })

}

export {
  VoiceBackend,
  assistantTextFromEvent,
  buildFallbackAnalysis,
  buildPrompt,
  cleanForSpeech,
  createConfigHandler,
  decorateAnalysis,
  normalizeConfigPatch,
  plainConfig,
  publicConfig,
  resolveEdgeTts,
  resolvePiperCommand,
  resolvePiperModel,
  resolveOptions,
  synthesizePiper,
  ttsReady,
  transcribeWithSpeech,
}

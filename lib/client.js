window.__ModuleLoader__.load({
  id: 'dsh-dafeiyu-emotion',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const { useEffect, useLayoutEffect, useRef, useState } = React
    const h = React.createElement

    const ANALYZE_ENDPOINT = '/plugins/dsh-dafeiyu-emotion/analyze'
    const MAX_RECORDING_MS = 30000
    const EMOTION_LABELS = {
      happy: '喜悦',
      sad: '低落',
      angry: '生气',
      fear: '紧张',
      surprise: '惊讶',
      disgust: '厌烦',
      neutral: '平静',
    }
    const EMOTION_COLORS = {
      happy: '#f2b84b',
      sad: '#6ea7d9',
      angry: '#e36b62',
      fear: '#a68bd8',
      surprise: '#54b8a8',
      disgust: '#b38b62',
      neutral: '#8a98a8',
    }

    const S = {
      trigger: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        minWidth: 34,
        height: 30,
        padding: '0 9px',
        border: '1px solid color-mix(in srgb, currentColor 18%, transparent)',
        borderRadius: 999,
        background: 'color-mix(in srgb, #4b9fe5 10%, transparent)',
        color: 'inherit',
        cursor: 'pointer',
        font: 'inherit',
        fontSize: 13,
        lineHeight: 1,
      },
      row: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        minHeight: 30,
        padding: '0 4px',
        flex: '1 1 auto',
        minWidth: 0,
      },
      message: {
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        minWidth: 0,
        flex: '1 1 auto',
        fontSize: 12.5,
        color: 'inherit',
        opacity: 0.9,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      },
      round: {
        width: 28,
        height: 28,
        borderRadius: 999,
        border: '1px solid color-mix(in srgb, currentColor 16%, transparent)',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        fontSize: 13,
        lineHeight: 1,
        padding: 0,
        flex: '0 0 auto',
      },
      pill: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        height: 22,
        padding: '0 8px',
        borderRadius: 999,
        background: 'color-mix(in srgb, currentColor 9%, transparent)',
        fontSize: 11.5,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      },
      bars: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        height: 20,
        width: 66,
        flex: '0 0 auto',
      },
      bar: {
        width: 3,
        minHeight: 3,
        borderRadius: 99,
        background: 'currentColor',
        opacity: 0.75,
        transition: 'height 80ms linear',
      },
      hint: {
        fontSize: 11,
        opacity: 0.6,
      },
    }

    function sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms))
    }

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value))
    }

    function resample(samples, inputRate, outputRate) {
      if (inputRate === outputRate) return samples
      const ratio = inputRate / outputRate
      const length = Math.max(1, Math.floor(samples.length / ratio))
      const result = new Float32Array(length)
      for (let index = 0; index < length; index += 1) {
        const position = index * ratio
        const left = Math.floor(position)
        const right = Math.min(samples.length - 1, left + 1)
        const fraction = position - left
        result[index] = samples[left] * (1 - fraction) + samples[right] * fraction
      }
      return result
    }

    function encodeWav(samples, sampleRate) {
      const buffer = new ArrayBuffer(44 + samples.length * 2)
      const view = new DataView(buffer)
      const writeText = (offset, text) => {
        for (let index = 0; index < text.length; index += 1) {
          view.setUint8(offset + index, text.charCodeAt(index))
        }
      }
      writeText(0, 'RIFF')
      view.setUint32(4, 36 + samples.length * 2, true)
      writeText(8, 'WAVE')
      writeText(12, 'fmt ')
      view.setUint32(16, 16, true)
      view.setUint16(20, 1, true)
      view.setUint16(22, 1, true)
      view.setUint32(24, sampleRate, true)
      view.setUint32(28, sampleRate * 2, true)
      view.setUint16(32, 2, true)
      view.setUint16(34, 16, true)
      writeText(36, 'data')
      view.setUint32(40, samples.length * 2, true)
      for (let index = 0; index < samples.length; index += 1) {
        const sample = clamp(samples[index], -1, 1)
        view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      }
      return new Uint8Array(buffer)
    }

    function bytesToBase64(bytes) {
      const chunk = 0x8000
      let binary = ''
      for (let index = 0; index < bytes.length; index += chunk) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
      }
      return btoa(binary)
    }

    function percentile(sorted, ratio) {
      if (!sorted.length) return 0
      const position = (sorted.length - 1) * ratio
      const lower = Math.floor(position)
      const upper = Math.ceil(position)
      return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
    }

    function standardDeviation(values, center) {
      if (!values.length) return 0
      const mean = center ?? values.reduce((sum, value) => sum + value, 0) / values.length
      return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length)
    }

    function computeProsody(samples, sampleRate) {
      const duration = samples.length / sampleRate
      if (samples.length < Math.round(sampleRate * 0.3)) {
        return { duration, voiced_ratio: 0, pause_ratio: 1, energy_n: 0.1, pitch_n: 0.5, var_n: 0.2 }
      }
      const frameLength = Math.max(64, Math.round(sampleRate * 0.025))
      const hop = Math.max(16, Math.round(sampleRate * 0.01))
      const minLag = Math.max(2, Math.floor(sampleRate / 400))
      const maxLag = Math.min(frameLength - 1, Math.floor(sampleRate / 60))
      const dbs = []
      const f0s = []
      const zcrs = []
      let frameIndex = 0
      let pitchFrames = 0
      for (let start = 0; start + frameLength <= samples.length; start += hop, frameIndex += 1) {
        let energy = 0
        let crossings = 0
        let previous = samples[start] >= 0
        for (let index = 0; index < frameLength; index += 1) {
          const value = samples[start + index]
          energy += value * value
          const positive = value >= 0
          if (positive !== previous) crossings += 1
          previous = positive
        }
        const rms = Math.sqrt(energy / frameLength + 1e-12)
        dbs.push(20 * Math.log10(rms + 1e-8))
        zcrs.push(crossings / frameLength)
        if (frameIndex % 2 !== 0) continue
        pitchFrames += 1
        if (rms < 0.006) continue
        let best = 0
        let bestLag = 0
        for (let lag = minLag; lag <= maxLag; lag += 1) {
          let correlation = 0
          let leftEnergy = 0
          let rightEnergy = 0
          for (let index = 0; index < frameLength - lag; index += 1) {
            const left = samples[start + index]
            const right = samples[start + index + lag]
            correlation += left * right
            leftEnergy += left * left
            rightEnergy += right * right
          }
          const normalized = correlation / (Math.sqrt(leftEnergy * rightEnergy) + 1e-12)
          if (normalized > best) {
            best = normalized
            bestLag = lag
          }
        }
        if (best >= 0.32 && bestLag > 0) f0s.push(sampleRate / bestLag)
      }
      const dbSorted = [...dbs].sort((left, right) => left - right)
      const dbMean = dbs.length ? dbs.reduce((sum, value) => sum + value, 0) / dbs.length : -60
      const dbP10 = percentile(dbSorted, 0.1)
      const dbP90 = percentile(dbSorted, 0.9)
      const dynamic = Math.max(0, dbP90 - dbP10)
      const speechThreshold = Math.max(dbP10 + 0.12 * dynamic, dbMean - 14)
      const pauseRatio = dbs.length ? dbs.filter((value) => value < speechThreshold).length / dbs.length : 1
      const voicedRatio = pitchFrames ? Math.min(1, f0s.length / pitchFrames) : 0
      const voiced = [...f0s].sort((left, right) => left - right)
      const f0Median = voiced.length ? percentile(voiced, 0.5) : 0
      const f0P10 = voiced.length ? percentile(voiced, 0.1) : 0
      const f0P90 = voiced.length ? percentile(voiced, 0.9) : 0
      const semitones = voiced.map((value) => 12 * Math.log2(Math.max(1e-6, value) / Math.max(1e-6, f0Median || value)))
      const f0StdSt = standardDeviation(semitones)
      const f0RangeSt = f0P10 > 0 && f0P90 > 0 ? 12 * Math.log2(f0P90 / f0P10) : 0
      const energyN = clamp((dbMean + 48) / 30, 0, 1)
      const pitchN = f0Median > 0 ? clamp((f0Median - 85) / 170, 0, 1) : 0.5
      const varN = clamp(f0StdSt / 5, 0, 1)
      const zcrMean = zcrs.length ? zcrs.reduce((sum, value) => sum + value, 0) / zcrs.length : 0
      return {
        duration: Math.round(duration * 1000) / 1000,
        voiced_ratio: Math.round(voicedRatio * 1000) / 1000,
        pause_ratio: Math.round(pauseRatio * 1000) / 1000,
        energy_n: Math.round(energyN * 1000) / 1000,
        pitch_n: Math.round(pitchN * 1000) / 1000,
        var_n: Math.round(varN * 1000) / 1000,
        f0_median: Math.round(f0Median * 10) / 10,
        f0_std_st: Math.round(f0StdSt * 1000) / 1000,
        f0_range_st: Math.round(f0RangeSt * 1000) / 1000,
        db_mean: Math.round(dbMean * 100) / 100,
        db_std: Math.round(standardDeviation(dbs, dbMean) * 100) / 100,
        zcr: Math.round(zcrMean * 1000) / 1000,
        frame_count: dbs.length,
      }
    }

    function formatSeconds(ms) {
      const seconds = Math.max(0, ms) / 1000
      return `${seconds.toFixed(1)}s`
    }

    class Recorder {
      constructor() {
        this.context = null
        this.stream = null
        this.source = null
        this.processor = null
        this.silentGain = null
        this.chunks = []
        this.sampleRate = 48000
        this.startedAt = 0
        this.active = false
      }

      async start(onLevel) {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('当前客户端不支持麦克风录音')
        }
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: false,
          },
        })
        this.context = new AudioContext()
        if (this.context.state === 'suspended') await this.context.resume()
        this.sampleRate = this.context.sampleRate
        this.source = this.context.createMediaStreamSource(this.stream)
        this.processor = this.context.createScriptProcessor(4096, 1, 1)
        this.silentGain = this.context.createGain()
        this.silentGain.gain.value = 0
        this.chunks = []
        this.startedAt = performance.now()
        this.active = true

        let lastPaint = 0
        this.processor.onaudioprocess = (event) => {
          if (!this.active) return
          const input = event.inputBuffer.getChannelData(0)
          this.chunks.push(new Float32Array(input))
          const now = performance.now()
          if (onLevel && now - lastPaint >= 80) {
            lastPaint = now
            let sum = 0
            for (let index = 0; index < input.length; index += 1) sum += input[index] * input[index]
            onLevel(clamp(Math.sqrt(sum / input.length) * 8, 0.04, 1))
          }
        }
        this.source.connect(this.processor)
        this.processor.connect(this.silentGain)
        this.silentGain.connect(this.context.destination)
      }

      async stop() {
        if (!this.active) return { wav: new Uint8Array(), prosody: {} }
        this.active = false
        const inputRate = this.sampleRate
        const chunks = this.chunks
        const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
        const merged = new Float32Array(total)
        let offset = 0
        for (const chunk of chunks) {
          merged.set(chunk, offset)
          offset += chunk.length
        }
        await this.dispose()
        const resampled = resample(merged, inputRate, 16000)
        return {
          wav: encodeWav(resampled, 16000),
          prosody: computeProsody(resampled, 16000),
        }
      }

      async dispose() {
        this.active = false
        try {
          if (this.processor) this.processor.disconnect()
          if (this.source) this.source.disconnect()
          if (this.silentGain) this.silentGain.disconnect()
        } catch {}
        try {
          this.stream?.getTracks?.().forEach((track) => track.stop())
        } catch {}
        try {
          await this.context?.close?.()
        } catch {}
        this.context = null
        this.stream = null
        this.source = null
        this.processor = null
        this.silentGain = null
        this.chunks = []
      }
    }

    function bars(level, levels) {
      const history = levels.length ? levels : [level]
      return h('span', { style: S.bars, 'aria-hidden': true },
        ...Array.from({ length: 14 }, (_, index) => {
          const value = history[Math.min(history.length - 1, Math.floor(index * history.length / 14))] || 0
          return h('i', {
            key: index,
            style: {
              ...S.bar,
              height: `${Math.round(3 + clamp(value, 0, 1) * 17)}px`,
              opacity: 0.35 + clamp(value, 0, 1) * 0.55,
            },
          })
        }),
      )
    }

    function VoiceFish({ sessionId, inputActions, locked, onActiveChange }) {
      const [phase, setPhase] = useState('idle')
      const [level, setLevel] = useState(0)
      const [levels, setLevels] = useState([])
      const [elapsed, setElapsed] = useState(0)
      const [message, setMessage] = useState('')
      const [analysis, setAnalysis] = useState(null)
      const [sent, setSent] = useState(false)
      const recorder = useRef(null)
      const abort = useRef(null)
      const timer = useRef(null)
      const ticker = useRef(null)
      const generation = useRef(0)
      const levelsRef = useRef([])
      const expanded = phase !== 'idle'

      useLayoutEffect(() => {
        try {
          onActiveChange(expanded)
        } catch {}
        return () => {
          try {
            onActiveChange(false)
          } catch {}
        }
      }, [expanded, onActiveChange])

      const clearTimers = () => {
        if (timer.current) clearTimeout(timer.current)
        if (ticker.current) clearInterval(ticker.current)
        timer.current = null
        ticker.current = null
      }

      const reset = async () => {
        generation.current += 1
        clearTimers()
        abort.current?.abort?.()
        abort.current = null
        const active = recorder.current
        recorder.current = null
        if (active) await active.dispose().catch(() => {})
        setPhase('idle')
        setLevel(0)
        setLevels([])
        levelsRef.current = []
        setElapsed(0)
        setMessage('')
        setAnalysis(null)
        setSent(false)
      }

      useEffect(() => {
        return () => {
          generation.current += 1
          clearTimers()
          abort.current?.abort?.()
          const active = recorder.current
          recorder.current = null
          if (active) active.dispose().catch(() => {})
        }
      }, [])

      useEffect(() => {
        void reset()
      }, [sessionId])

      const onLevel = (value) => {
        setLevel(value)
        const next = [...levelsRef.current.slice(-20), value]
        levelsRef.current = next
        setLevels(next)
      }

      const start = async () => {
        if (locked || recorder.current) return
        const run = ++generation.current
        setMessage('')
        setAnalysis(null)
        setSent(false)
        setPhase('requesting')
        const active = new Recorder()
        recorder.current = active
        try {
          await active.start(onLevel)
          if (run !== generation.current) {
            await active.dispose()
            return
          }
          setPhase('recording')
          setElapsed(0)
          ticker.current = setInterval(() => {
            if (!recorder.current?.startedAt) return
            setElapsed(performance.now() - recorder.current.startedAt)
          }, 100)
          timer.current = setTimeout(() => {
            void finish()
          }, MAX_RECORDING_MS)
        } catch (error) {
          recorder.current = null
          await active.dispose().catch(() => {})
          setPhase('error')
          setMessage(error instanceof Error ? error.message : String(error))
        }
      }

      const finish = async () => {
        const active = recorder.current
        if (!active) return
        const run = generation.current
        recorder.current = null
        clearTimers()
        setPhase('analyzing')
        setMessage('大肥鱼正在听语气…')
        try {
          const capture = await active.stop()
          const wav = capture.wav
          if (run !== generation.current) return
          if (wav.length < 12000) {
            setPhase('error')
            setMessage('说得太短了，再说一句吧')
            return
          }
          abort.current = new AbortController()
          const response = await fetch(ANALYZE_ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              audioBase64: bytesToBase64(wav),
              sampleRate: 16000,
              language: 'zh',
              prosody: capture.prosody,
            }),
            signal: abort.current.signal,
          })
          const payload = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(payload.error || `分析失败（${response.status}）`)
          if (run !== generation.current) return
          setAnalysis(payload)
          setPhase('result')
          setMessage('')
          await deliver(payload)
        } catch (error) {
          if (error?.name === 'AbortError') return
          if (run !== generation.current) return
          setPhase('error')
          setMessage(error instanceof Error ? error.message : String(error))
        } finally {
          abort.current = null
        }
      }

      const deliver = async (payload) => {
        const prompt = String(payload.prompt || '').trim()
        if (!prompt) {
          setPhase('error')
          setMessage('没有生成可发送的语音内容')
          return
        }
        try {
          let inserted = false
          try {
            inserted = inputActions?.insertText?.(prompt, inputActions.captureInsertion()) === true
          } catch {}
          if (!inserted) inputActions?.setDraft?.(prompt)
          await sleep(120)
          inputActions?.submit?.()
          setSent(true)
          setMessage(`听出${payload.emotionZh || '你的情绪'}，已交给大肥鱼回复`)
          await sleep(1350)
          await reset()
        } catch (error) {
          setPhase('error')
          setMessage(`已识别，但发送失败：${error instanceof Error ? error.message : String(error)}`)
        }
      }

      const retry = () => {
        setPhase('idle')
        setMessage('')
        setAnalysis(null)
        setSent(false)
        void start()
      }

      if (phase === 'idle') {
        return h('button', {
          type: 'button',
          style: { ...S.trigger, opacity: locked ? 0.45 : 1, cursor: locked ? 'not-allowed' : 'pointer' },
          title: '大肥鱼听你说：读语音、分析语气，再自动回复',
          'aria-label': '大肥鱼听你说',
          disabled: locked,
          onMouseDown: (event) => event.preventDefault(),
          onClick: () => void start(),
        }, h('span', { style: { fontSize: 15, lineHeight: 1 } }, '🐋'), h('span', null, '鱼耳'))
      }

      const emotion = analysis?.emotion || 'neutral'
      const color = EMOTION_COLORS[emotion] || EMOTION_COLORS.neutral
      const emotionText = analysis?.emotionZh || EMOTION_LABELS[emotion] || '分析中'
      return h('div', { style: S.row, 'data-voice-emotion': phase },
        phase === 'recording'
          ? bars(level, levels)
          : h('span', { style: { ...S.pill, color: phase === 'result' ? color : 'inherit' } },
              phase === 'result' ? '🐋' : phase === 'analyzing' ? '…' : '!',
              phase === 'recording'
                ? formatSeconds(elapsed)
                : phase === 'requesting'
                  ? '等麦克风'
                  : phase === 'analyzing'
                    ? '分析中'
                    : phase === 'result'
                      ? emotionText
                      : '出错',
            ),
        h('span', { style: S.message, title: message || '正在录音' },
          phase === 'recording'
            ? h(React.Fragment, null,
                h('span', null, '正在听你说…'),
                h('span', { style: S.hint }, `${formatSeconds(MAX_RECORDING_MS - elapsed)} 后自动结束`),
              )
            : message || (phase === 'requesting' ? '允许麦克风后开始说话' : ''),
          phase === 'result' && analysis
            ? h('span', { style: { ...S.hint, marginLeft: 4 } },
                `${Math.round((Number(analysis.confidence) || 0) * 100)}% · ${analysis.toneSummary || ''}`)
            : null,
        ),
        phase === 'recording' && h('button', {
          type: 'button',
          style: S.round,
          title: '取消录音',
          'aria-label': '取消录音',
          onClick: () => void reset(),
        }, '×'),
        phase === 'recording' && h('button', {
          type: 'button',
          style: { ...S.round, background: '#d95c54', color: '#fff', borderColor: 'transparent' },
          title: '结束并分析',
          'aria-label': '结束并分析',
          onClick: () => void finish(),
        }, '■'),
        (phase === 'error' || phase === 'result') && h('button', {
          type: 'button',
          style: S.round,
          title: phase === 'error' ? '重试' : '关闭',
          'aria-label': phase === 'error' ? '重试' : '关闭',
          onClick: phase === 'error' ? retry : () => void reset(),
        }, phase === 'error' ? '↻' : '×'),
        phase === 'analyzing' && h('button', {
          type: 'button',
          style: S.round,
          title: '取消分析',
          'aria-label': '取消分析',
          onClick: () => void reset(),
        }, '×'),
        phase === 'result' && !sent && h('button', {
          type: 'button',
          style: { ...S.trigger, height: 26, fontSize: 12 },
          onClick: () => void deliver(analysis),
        }, '发送'),
      )
    }

    function apply(ctx) {
      const register = () => {
        try {
          return ctx.slots.register({
            name: 'conversation.input.activity',
            id: 'dsh-dafeiyu-emotion',
            order: 35,
            inject: () => ({}),
          }, VoiceFish)
        } catch (error) {
          console.error('[dsh-dafeiyu-emotion] failed to register voice activity:', error)
          return () => {}
        }
      }
      try {
        ctx.slots.inject('conversation.input.activity', register)
      } catch (error) {
        console.error('[dsh-dafeiyu-emotion] failed to inject voice activity:', error)
      }
    }

    module.exports = {
      name: 'dsh-dafeiyu-emotion-client',
      inject: ['slots'],
      apply,
    }
    return module.exports
  },
})

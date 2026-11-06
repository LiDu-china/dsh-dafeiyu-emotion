window.__ModuleLoader__.load({
  id: 'dsh-dafeiyu-emotion',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const { useEffect, useLayoutEffect, useRef, useState } = React
    const h = React.createElement

    const ANALYZE_ENDPOINT = '/plugins/dsh-dafeiyu-emotion/analyze'
    const CONFIG_ENDPOINT = '/plugins/dsh-dafeiyu-emotion/config'
    const HEALTH_ENDPOINT = '/plugins/dsh-dafeiyu-emotion/health'
    const MAX_RECORDING_MS = 30000
    const PERMISSION_TIMEOUT_MS = 20000
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
    const voiceShortcutHandlers = []

    function useNoInput() {
      return null
    }

    function registerVoiceShortcut(handler) {
      voiceShortcutHandlers.push(handler)
      return () => {
        const index = voiceShortcutHandlers.lastIndexOf(handler)
        if (index >= 0) voiceShortcutHandlers.splice(index, 1)
      }
    }

    function canUseVoiceShortcut(phase, locked) {
      return !locked && (phase === 'idle' || phase === 'recording' || phase === 'error')
    }

    function canInvokeVoiceShortcut() {
      const handler = voiceShortcutHandlers.at(-1)
      if (!handler) return false
      try {
        return handler.canHandle?.() === true
      } catch {
        return false
      }
    }

    function invokeVoiceShortcut() {
      const handler = voiceShortcutHandlers.at(-1)
      if (!handler) return false
      try {
        return handler.run?.() === true
      } catch (error) {
        console.error('[dsh-dafeiyu-emotion] voice shortcut failed:', error)
        return false
      }
    }

    function createDeliveryGate() {
      let active = false
      return {
        begin() {
          if (active) return false
          active = true
          return true
        },
        end() {
          active = false
        },
        get active() {
          return active
        },
      }
    }

    function isRunCurrent(run, generation) {
      return run === generation.current
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

    const T = {
      text: 'var(--dsw-alias-label-primary, var(--text-color, #1f2328))',
      sub: 'var(--dsw-alias-label-secondary, var(--text-color, #5c6570))',
      faint: 'var(--dsw-alias-label-tertiary, var(--text-color, #8b93a1))',
      card: 'var(--dsw-alias-bg-layer-1, var(--background-color, #ffffff))',
      layer: 'var(--dsw-alias-bg-layer-2, var(--background-color, #f7f8fa))',
      border: 'var(--dsw-alias-border-l2, var(--border-color, #e5e7eb))',
      borderStrong: 'var(--dsw-alias-border-l3, var(--border-color, #d9dde3))',
      brand: 'var(--dsw-alias-brand-primary, #3e7cb1)',
      brandSoft: 'color-mix(in srgb, var(--dsw-alias-brand-primary, #3e7cb1) 12%, transparent)',
      success: 'var(--dsw-alias-state-success-primary, #16a34a)',
      warn: 'var(--dsw-alias-state-warn-primary, #b45309)',
      error: 'var(--dsw-alias-state-error-primary, #dc2626)',
      radius: 14,
      font: 'var(--ds-font-family-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif)',
    }

    function SvgIcon({ size = 16, path, viewBox = '0 0 24 24', strokeWidth = 1.8 }) {
      return h('svg', {
        width: size,
        height: size,
        viewBox,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
        focusable: 'false',
        style: { flex: '0 0 auto', display: 'block' },
      }, path)
    }

    function WhaleMark({ size = 24 }) {
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 32 32',
        fill: 'none',
        'aria-hidden': 'true',
        focusable: 'false',
      },
        h('path', {
          d: 'M4.5 20.2c0-6.1 4.9-11.1 11-11.1 4.2 0 7.7 2.3 9.5 5.8.4.8 1.2 1.3 2.1 1.3h1.6c-.7 2.3-2 4.3-3.9 5.7-2 1.5-4.9 2.2-8.2 2.2-4.2 0-8-1.4-10.7-3.8l-1.4-.1Z',
          fill: 'currentColor',
        }),
        h('circle', { cx: '12.4', cy: '15.6', r: '1.15', fill: '#fff' }),
        h('path', { d: 'M17.2 24.1c1.5 2 3.8 3.2 6.5 3.2-.4-1.9-1.5-3.5-3-4.5', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round' }),
        h('path', { d: 'M4.5 20.2c1.2-.5 2.5-.8 3.9-.8', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round' }),
      )
    }

    const ICONS = {
      mic: h('path', { d: 'M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm7-4a7 7 0 0 1-14 0m7 7v3m-4 0h8' }),
      sliders: h('path', { d: 'M4 7h9m4 0h3M4 17h3m4 0h9M9 4v6m6 4v6' }),
      refresh: h('path', { d: 'M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6' }),
      check: h('path', { d: 'm20 6-11 11-5-5' }),
      alert: h('path', { d: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z' }),
      folder: h('path', { d: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z' }),
      code: h('path', { d: 'm8 9-3 3 3 3m8-6 3 3-3 3' }),
      chevron: h('path', { d: 'm6 9 6 6 6-6' }),
      spark: h('path', { d: 'M12 3v4m0 10v4M3 12h4m10 0h4M5.6 5.6l2.8 2.8m7.2 7.2 2.8 2.8m0-12.8-2.8 2.8M8.4 15.6l-2.8 2.8' }),
      external: h('path', { d: 'M14 4h6v6m0-6-9 9M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5' }),
    }

    function Icon({ name, size = 16 }) {
      return h(SvgIcon, { size, path: ICONS[name] || ICONS.spark })
    }

    function ensureEmotionStyles() {
      if (typeof document === 'undefined' || document.getElementById('dsh-dafeiyu-emotion-styles')) return
      const style = document.createElement('style')
      style.id = 'dsh-dafeiyu-emotion-styles'
      style.textContent = [
        '@keyframes dsh-emotion-spin{to{transform:rotate(360deg)}}',
        '@media (prefers-reduced-motion: reduce){[data-dsh-emotion-spinner]{animation:none!important}}',
      ].join('')
      document.head.appendChild(style)
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

    async function computeProsody(samples, sampleRate, shouldStop) {
      if (shouldStop?.()) return {}
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
        if ((frameIndex & 127) === 0) {
          if (shouldStop?.()) return {}
          await new Promise((resolve) => setTimeout(resolve, 0))
        }
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

      async stop(isCancelled = () => false) {
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
        if (isCancelled()) return { wav: new Uint8Array(), prosody: {} }
        const resampled = resample(merged, inputRate, 16000)
        return {
          wav: encodeWav(resampled, 16000),
          prosody: await computeProsody(resampled, 16000, isCancelled),
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

    function toneColor(tone) {
      if (tone === 'success') return T.success
      if (tone === 'warn') return T.warn
      if (tone === 'error') return T.error
      if (tone === 'info') return T.brand
      return T.faint
    }

    function statusCopy(health, config) {
      if (config?.enabled === false || health?.enabled === false) {
        return {
          label: '已停用',
          tone: 'muted',
          detail: '在设置里重新启用后，鱼耳和语音快捷键会恢复。',
        }
      }
      if (!health) {
        return {
          label: '正在检测',
          tone: 'muted',
          detail: '读取本地语音服务与 Voice Input 状态…',
        }
      }
      if (health.mode === 'enhanced-backend-missing') {
        return {
          label: '后端目录不存在',
          tone: 'error',
          detail: health.lastError || config?.backendRoot || '请检查 VoiceSense 目录路径',
        }
      }
      if (health.mode === 'enhanced-local-backend') {
        if (health.state === 'ready') {
          return { label: '增强模式 · 已就绪', tone: 'success', detail: health.engine || 'SenseVoice + emotion2vec' }
        }
        if (health.state === 'starting') {
          return { label: '增强模式 · 加载中', tone: 'info', detail: '首次加载模型可能需要几十秒，之后会常驻。' }
        }
        return { label: '增强模式 · 待启动', tone: 'info', detail: '下次录音时自动加载本地模型。' }
      }
      if (health.dshSpeechReady) {
        return {
          label: '轻量模式 · 已就绪',
          tone: 'info',
          detail: health.speechProvider ? `DSH Voice Input · ${health.speechProvider}` : 'DSH Voice Input + 本地韵律分析',
        }
      }
      return {
        label: '等待 Voice Input',
        tone: 'warn',
        detail: '请在 插件 → Voice Input 中启用并准备本地模型，或配置增强后端目录。',
      }
    }

    function SettingsField({ icon, label, hint, children, wide = false }) {
      return h('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: wide ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) auto',
          gap: wide ? 7 : 12,
          alignItems: 'center',
          padding: '11px 0',
          borderBottom: `1px solid ${T.border}`,
        },
      },
        h('div', { style: { minWidth: 0 } },
          h('div', {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              fontSize: 13,
              fontWeight: 550,
              lineHeight: 1.35,
              color: T.text,
            },
          },
            icon ? h('span', { style: { color: T.sub, display: 'inline-flex' } }, h(Icon, { name: icon, size: 14 })) : null,
            label,
          ),
          hint
            ? h('div', {
                style: {
                  marginTop: 3,
                  paddingLeft: icon ? 21 : 0,
                  color: T.sub,
                  fontSize: 11.5,
                  lineHeight: 1.45,
                  wordBreak: 'break-word',
                },
              }, hint)
            : null,
        ),
        children,
      )
    }

    function SettingsSwitch({ checked, disabled, label, onChange }) {
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': checked === true,
        'aria-label': label,
        disabled,
        onClick: () => onChange(!checked),
        style: {
          position: 'relative',
          width: 38,
          height: 22,
          flex: '0 0 auto',
          padding: 0,
          border: `1px solid ${checked ? T.brand : T.borderStrong}`,
          borderRadius: 999,
          background: checked ? T.brand : T.layer,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          transition: 'background 160ms ease, border-color 160ms ease',
        },
      }, h('span', {
        style: {
          position: 'absolute',
          top: 2,
          left: checked ? 18 : 2,
          width: 16,
          height: 16,
          borderRadius: 999,
          background: '#fff',
          boxShadow: '0 1px 3px rgba(15, 23, 42, .22)',
          transition: 'left 160ms cubic-bezier(.2, .8, .2, 1)',
        },
      }))
    }

    function SettingsSegmented({ value, options, label, disabled, onChange }) {
      return h('div', {
        role: 'group',
        'aria-label': label,
        style: {
          display: 'inline-flex',
          flexWrap: 'wrap',
          maxWidth: '100%',
          gap: 2,
          padding: 3,
          border: `1px solid ${T.border}`,
          borderRadius: 10,
          background: T.layer,
          opacity: disabled ? 0.55 : 1,
        },
      }, ...options.map((option) => h('button', {
        key: option.value,
        type: 'button',
        disabled,
        'aria-pressed': value === option.value,
        onClick: () => onChange(option.value),
        style: {
          height: 26,
          padding: '0 9px',
          border: 'none',
          borderRadius: 7,
          background: value === option.value ? T.card : 'transparent',
          color: value === option.value ? T.text : T.sub,
          boxShadow: value === option.value ? '0 1px 3px rgba(15, 23, 42, .10)' : 'none',
          font: 'inherit',
          fontSize: 12,
          fontWeight: value === option.value ? 600 : 500,
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'background 150ms ease, color 150ms ease',
        },
      }, option.label)))
    }

    function SettingsSection({ title, hint, children }) {
      return h('section', { style: { display: 'flex', flexDirection: 'column', gap: 0 } },
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, padding: '2px 0 4px' } },
          h('h3', {
            style: {
              margin: 0,
              color: T.faint,
              fontSize: 10.5,
              fontWeight: 650,
              letterSpacing: '.08em',
              textTransform: 'uppercase',
            },
          }, title),
          hint ? h('span', { style: { color: T.faint, fontSize: 11 } }, hint) : null,
        ),
        children,
      )
    }

    function EmotionSettingsCard({ view = 'settings', sessionId } = {}) {
      const [config, setConfig] = useState(null)
      const [draft, setDraft] = useState(null)
      const [health, setHealth] = useState(null)
      const [phase, setPhase] = useState('loading')
      const [saving, setSaving] = useState(false)
      const [notice, setNotice] = useState(null)
      const isSidebar = view === 'sidebar'
      const Root = view === 'page' ? 'section' : view === 'item' ? 'li' : 'div'

      const load = async () => {
        setPhase('loading')
        setNotice(null)
        try {
          const [configResponse, healthResponse] = await Promise.all([
            fetch(CONFIG_ENDPOINT, { cache: 'no-store' }),
            fetch(HEALTH_ENDPOINT, { cache: 'no-store' }),
          ])
          if (!configResponse.ok) throw new Error(`读取设置失败（${configResponse.status}）`)
          const next = await configResponse.json()
          setConfig(next)
          setDraft(next)
          if (healthResponse.ok) setHealth(await healthResponse.json())
          setPhase(next.writable === false ? 'readOnly' : 'ready')
        } catch (error) {
          setPhase('unreachable')
          setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
        }
      }

      const refreshHealth = async () => {
        try {
          const response = await fetch(HEALTH_ENDPOINT, { cache: 'no-store' })
          if (response.ok) setHealth(await response.json())
        } catch {}
      }

      useEffect(() => {
        void load()
      }, [sessionId])

      useEffect(() => {
        if (notice?.kind !== 'success') return undefined
        const timer = setTimeout(() => setNotice(null), 3200)
        return () => clearTimeout(timer)
      }, [notice])

      const update = (key, value) => {
        setDraft((previous) => (previous ? { ...previous, [key]: value } : previous))
        setNotice(null)
      }

      const dirty = Boolean(config && draft && (
        draft.enabled !== config.enabled
        || draft.backendRoot !== config.backendRoot
        || draft.pythonPath !== config.pythonPath
        || draft.language !== config.language
        || draft.maxAudioBytes !== config.maxAudioBytes
        || draft.startupTimeoutMs !== config.startupTimeoutMs
        || draft.requestTimeoutMs !== config.requestTimeoutMs
      ))

      const save = async () => {
        if (!config || !draft || saving) return
        const patch = {}
        for (const key of ['enabled', 'backendRoot', 'pythonPath', 'language', 'maxAudioBytes', 'startupTimeoutMs', 'requestTimeoutMs']) {
          if (draft[key] !== config[key]) patch[key] = draft[key]
        }
        if (Object.keys(patch).length === 0) return
        setSaving(true)
        setNotice(null)
        try {
          const response = await fetch(CONFIG_ENDPOINT, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(patch),
          })
          const payload = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(payload.error || `保存失败（${response.status}）`)
          setConfig(payload)
          setDraft(payload)
          setNotice({ kind: 'success', text: '设置已保存' })
          try {
            window.dispatchEvent(new CustomEvent('dsh-dafeiyu-emotion:config', { detail: payload }))
          } catch {}
          await refreshHealth()
        } catch (error) {
          setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
        } finally {
          setSaving(false)
        }
      }

      if (phase === 'loading') {
        return h(Root, {
          'data-testid': 'dsh-dafeiyu-emotion-settings',
          'aria-label': '大肥鱼情绪耳朵设置',
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: isSidebar ? 16 : 20,
            color: T.sub,
            fontFamily: T.font,
            fontSize: 13,
          },
        },
          h('span', {
            'data-dsh-emotion-spinner': 'true',
            style: {
              width: 16,
              height: 16,
              borderRadius: 999,
              border: `2px solid ${T.border}`,
              borderTopColor: T.brand,
              animation: 'dsh-emotion-spin 900ms linear infinite',
            },
          }),
          '正在读取情绪耳朵设置…',
        )
      }

      if (phase === 'unreachable' || !config || !draft) {
        return h(Root, {
          'data-testid': 'dsh-dafeiyu-emotion-settings',
          'aria-label': '大肥鱼情绪耳朵设置',
          style: {
            padding: isSidebar ? 16 : 20,
            color: T.text,
            fontFamily: T.font,
            fontSize: 13,
          },
        },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 } },
            h('span', { style: { color: T.error, display: 'inline-flex' } }, h(Icon, { name: 'alert', size: 16 })),
            '设置暂时不可用',
          ),
          h('p', { style: { margin: '8px 0 12px', color: T.sub, fontSize: 12, lineHeight: 1.5 } },
            notice?.text || '无法连接插件 Host，请确认 DSH 已加载 dsh-dafeiyu-emotion。'),
          h('button', {
            type: 'button',
            onClick: () => void load(),
            style: {
              height: 32,
              padding: '0 12px',
              border: `1px solid ${T.border}`,
              borderRadius: 8,
              background: T.card,
              color: T.text,
              font: 'inherit',
              fontSize: 12,
              cursor: 'pointer',
            },
          }, '重试'),
        )
      }

      const info = statusCopy(health, config)
      const color = toneColor(info.tone)
      const disabled = phase === 'readOnly' || saving
      const inputStyle = {
        width: isSidebar ? '100%' : 280,
        maxWidth: '100%',
        height: 34,
        padding: '0 10px',
        border: `1px solid ${T.border}`,
        borderRadius: 9,
        background: T.card,
        color: T.text,
        font: 'inherit',
        fontSize: 12.5,
        outline: '2px solid transparent',
        outlineOffset: 1,
        boxSizing: 'border-box',
        transition: 'border-color 150ms ease, outline-color 150ms ease',
      }
      const focusRing = (event) => {
        event.currentTarget.style.outlineColor = `color-mix(in srgb, ${T.brand} 28%, transparent)`
        event.currentTarget.style.borderColor = T.brand
      }
      const blurRing = (event) => {
        event.currentTarget.style.outlineColor = 'transparent'
        event.currentTarget.style.borderColor = T.border
      }
      const numberStyle = { ...inputStyle, width: 96, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
      const secondaryButton = {
        height: 32,
        padding: '0 11px',
        border: `1px solid ${T.border}`,
        borderRadius: 8,
        background: T.card,
        color: T.sub,
        font: 'inherit',
        fontSize: 12,
        cursor: saving ? 'not-allowed' : 'pointer',
        opacity: saving ? 0.6 : 1,
      }
      const primaryButton = {
        height: 32,
        padding: '0 13px',
        border: '1px solid transparent',
        borderRadius: 8,
        background: T.brand,
        color: '#fff',
        font: 'inherit',
        fontSize: 12,
        fontWeight: 600,
        cursor: dirty && !saving ? 'pointer' : 'not-allowed',
        opacity: dirty && !saving ? 1 : 0.45,
      }

      return h(Root, {
        'data-testid': 'dsh-dafeiyu-emotion-settings',
        'aria-label': '大肥鱼情绪耳朵设置',
        style: {
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          minWidth: 0,
          color: T.text,
          fontFamily: T.font,
          background: isSidebar ? 'transparent' : T.card,
          border: isSidebar ? 'none' : `1px solid ${T.border}`,
          borderRadius: isSidebar ? 0 : T.radius + 2,
          overflow: 'hidden',
          boxSizing: 'border-box',
        },
      },
        h('header', {
          style: {
            padding: isSidebar ? '6px 2px 16px' : '18px 18px 14px',
            background: isSidebar
              ? 'transparent'
              : 'linear-gradient(135deg, color-mix(in srgb, #3e7cb1 10%, transparent), transparent 62%)',
          },
        },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' } },
            h('div', {
              style: {
                width: 44,
                height: 44,
                flex: '0 0 auto',
                display: 'grid',
                placeItems: 'center',
                borderRadius: 14,
                color: '#fff',
                background: 'linear-gradient(145deg, #5aa7d6, #326b9d)',
                boxShadow: '0 6px 16px rgba(50, 107, 157, .22), inset 0 1px 0 rgba(255, 255, 255, .28)',
              },
            }, h(WhaleMark, { size: 28 })),
            h('div', { style: { minWidth: 0, flex: '1 1 auto' } },
              h('h2', {
                style: {
                  margin: 0,
                  fontSize: 16,
                  lineHeight: 1.3,
                  fontWeight: 650,
                  letterSpacing: '-.01em',
                  color: T.text,
                },
              }, '大肥鱼 · 情绪耳朵'),
              h('p', {
                style: {
                  margin: '3px 0 0',
                  fontSize: 12.5,
                  lineHeight: 1.45,
                  color: T.sub,
                },
              }, '听见语气，再回答。音频只在本机处理，分析后删除。'),
            ),
            h('span', {
              style: {
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                height: 24,
                padding: '0 9px',
                flexShrink: 0,
                border: `1px solid color-mix(in srgb, ${color} 24%, transparent)`,
                borderRadius: 999,
                background: `color-mix(in srgb, ${color} 11%, transparent)`,
                color,
                fontSize: 11.5,
                fontWeight: 600,
                whiteSpace: 'nowrap',
              },
            },
              h('span', {
                style: {
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: color,
                  boxShadow: `0 0 0 3px color-mix(in srgb, ${color} 15%, transparent)`,
                },
              }),
              info.label,
            ),
          ),
          h('div', {
            style: {
              display: 'flex',
              alignItems: 'flex-start',
              gap: 9,
              marginTop: 14,
              padding: '10px 12px',
              border: `1px solid ${T.border}`,
              borderRadius: 11,
              background: isSidebar ? T.layer : 'color-mix(in srgb, #3e7cb1 4%, transparent)',
            },
          },
            h('span', { style: { color, marginTop: 1, display: 'inline-flex' } },
              h(Icon, { name: info.tone === 'error' ? 'alert' : info.tone === 'warn' ? 'alert' : 'spark', size: 15 })),
            h('div', { style: { minWidth: 0, flex: '1 1 auto' } },
              h('div', {
                style: {
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 7,
                  flexWrap: 'wrap',
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: T.text,
                },
              },
                info.label,
                health?.speechProvider
                  ? h('span', { style: { color: T.faint, fontSize: 11, fontWeight: 500 } }, health.speechProvider)
                  : null,
              ),
              h('div', {
                style: {
                  marginTop: 2,
                  color: T.sub,
                  fontSize: 11.5,
                  lineHeight: 1.5,
                  wordBreak: 'break-word',
                },
              }, info.detail),
              health?.lastError && health.lastError !== info.detail
                ? h('div', {
                    style: {
                      marginTop: 4,
                      color: T.error,
                      fontSize: 11.5,
                      lineHeight: 1.45,
                      wordBreak: 'break-word',
                    },
                  }, health.lastError)
                : null,
            ),
            h('button', {
              type: 'button',
              onClick: () => void refreshHealth(),
              title: '重新检测语音服务',
              'aria-label': '重新检测语音服务',
              style: {
                width: 28,
                height: 28,
                flex: '0 0 auto',
                display: 'grid',
                placeItems: 'center',
                border: 'none',
                borderRadius: 8,
                background: 'transparent',
                color: T.sub,
                cursor: 'pointer',
              },
            }, h(Icon, { name: 'refresh', size: 14 })),
          ),
          !isSidebar
            ? h('p', {
                style: {
                  margin: '9px 0 0',
                  color: T.faint,
                  fontSize: 11,
                  lineHeight: 1.45,
                },
              }, '若已安装 Better Sidebar，也可以在右侧边栏的 + 菜单中固定「情绪耳朵」。')
            : null,
        ),
        h('div', {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
            padding: isSidebar ? '0 2px 18px' : '4px 18px 18px',
          },
        },
          phase === 'readOnly'
            ? h('div', {
                role: 'status',
                style: {
                  display: 'flex',
                  gap: 8,
                  padding: '9px 11px',
                  border: `1px solid color-mix(in srgb, ${T.warn} 26%, transparent)`,
                  borderRadius: 10,
                  background: `color-mix(in srgb, ${T.warn} 8%, transparent)`,
                  color: T.warn,
                  fontSize: 11.5,
                  lineHeight: 1.45,
                },
              },
                h(Icon, { name: 'alert', size: 14 }),
                '当前 DSH 版本不支持从设置页写入配置。你仍可以查看状态；修改请编辑 profile 的 cordis.patch.yml 后重启。',
              )
            : null,
          h(SettingsSection, { title: '基础' },
            h(SettingsField, {
              icon: 'mic',
              label: '启用情绪耳朵',
              hint: '关闭后隐藏输入框里的鱼耳按钮，并停止语音快捷键。',
            }, h(SettingsSwitch, {
              checked: draft.enabled !== false,
              disabled,
              label: '启用情绪耳朵',
              onChange: (value) => update('enabled', value),
            })),
            h(SettingsField, {
              icon: 'spark',
              label: '识别语言',
              hint: '「自动」会交给 DSH Voice Input 判断，混合中英文时更稳。',
            }, h(SettingsSegmented, {
              value: draft.language,
              label: '识别语言',
              disabled,
              options: [
                { value: 'zh', label: '中文' },
                { value: 'en', label: 'EN' },
                { value: 'auto', label: '自动' },
              ],
              onChange: (value) => update('language', value),
            })),
          ),
          h(SettingsSection, { title: '增强后端', hint: '可选' },
            h(SettingsField, {
              icon: 'folder',
              label: 'VoiceSense 目录',
              hint: '留空则使用 DSH 自带 Voice Input 的轻量模式；填写后启用 SenseVoice + emotion2vec。',
              wide: true,
            }, h('input', {
              type: 'text',
              value: draft.backendRoot,
              disabled,
              spellCheck: false,
              placeholder: 'D:/path/to/voice-sense',
              'aria-label': 'VoiceSense 目录',
              onChange: (event) => update('backendRoot', event.target.value),
              onFocus: (event) => { event.currentTarget.style.borderColor = T.brand; event.currentTarget.style.outlineColor = `color-mix(in srgb, ${T.brand} 28%, transparent)` },
              onBlur: (event) => { event.currentTarget.style.borderColor = T.border; event.currentTarget.style.outlineColor = 'transparent' },
              style: { ...inputStyle, width: '100%' },
            })),
            h(SettingsField, {
              icon: 'code',
              label: 'Python 路径',
              hint: '留空自动寻找 .venv-ser / .venv-gpu；只有多环境冲突时才需要手动指定。',
              wide: true,
            }, h('input', {
              type: 'text',
              value: draft.pythonPath,
              disabled,
              spellCheck: false,
              placeholder: '留空自动寻找',
              'aria-label': 'Python 路径',
              onChange: (event) => update('pythonPath', event.target.value),
              onFocus: (event) => { event.currentTarget.style.borderColor = T.brand; event.currentTarget.style.outlineColor = `color-mix(in srgb, ${T.brand} 28%, transparent)` },
              onBlur: (event) => { event.currentTarget.style.borderColor = T.border; event.currentTarget.style.outlineColor = 'transparent' },
              style: { ...inputStyle, width: '100%' },
            })),
          ),
          h('details', {
            onToggle: (event) => {
              const marker = event.currentTarget.querySelector('[data-chevron]')
              if (marker) marker.style.transform = event.currentTarget.open ? 'rotate(180deg)' : 'none'
            },
            style: { borderTop: `1px solid ${T.border}`, paddingTop: 2 },
          },
            h('summary', {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '10px 0 3px',
                color: T.sub,
                fontSize: 11.5,
                fontWeight: 600,
                cursor: 'pointer',
                listStyle: 'none',
              },
            },
              h('span', {
                'data-chevron': 'true',
                style: { display: 'inline-flex', transition: 'transform 160ms ease' },
              }, h(Icon, { name: 'chevron', size: 13 })),
              '高级设置',
            ),
            h(SettingsField, {
              label: '单次录音上限',
              hint: '超过上限会自动停止并提示。',
            }, h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
              h('input', {
                type: 'number',
                min: 1,
                max: 32,
                step: 1,
                value: Math.round((draft.maxAudioBytes || 0) / 1024 / 1024),
                disabled,
                'aria-label': '单次录音上限（MB）',
                onChange: (event) => update('maxAudioBytes', Math.round(clamp(Number(event.target.value) || 1, 1, 32)) * 1024 * 1024),
                onFocus: focusRing,
                onBlur: blurRing,
                style: numberStyle,
              }),
              h('span', { style: { color: T.faint, fontSize: 11.5 } }, 'MB'),
            )),
            h(SettingsField, {
              label: '后端启动超时',
              hint: '首次加载 SenseVoice / emotion2vec 的最长等待。',
            }, h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
              h('input', {
                type: 'number',
                min: 10,
                max: 600,
                step: 5,
                value: Math.round((draft.startupTimeoutMs || 0) / 1000),
                disabled,
                'aria-label': '后端启动超时（秒）',
                onChange: (event) => update('startupTimeoutMs', Math.round(clamp(Number(event.target.value) || 10, 10, 600)) * 1000),
                onFocus: focusRing,
                onBlur: blurRing,
                style: numberStyle,
              }),
              h('span', { style: { color: T.faint, fontSize: 11.5 } }, '秒'),
            )),
            h(SettingsField, {
              label: '单次分析超时',
              hint: '包含转写与情绪融合；超时会停止当前 worker。',
            }, h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
              h('input', {
                type: 'number',
                min: 10,
                max: 600,
                step: 5,
                value: Math.round((draft.requestTimeoutMs || 0) / 1000),
                disabled,
                'aria-label': '单次分析超时（秒）',
                onChange: (event) => update('requestTimeoutMs', Math.round(clamp(Number(event.target.value) || 10, 10, 600)) * 1000),
                onFocus: focusRing,
                onBlur: blurRing,
                style: numberStyle,
              }),
              h('span', { style: { color: T.faint, fontSize: 11.5 } }, '秒'),
            )),
          ),
        ),
        h('footer', {
          style: {
            position: 'sticky',
            bottom: 0,
            zIndex: 2,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: isSidebar ? '10px 2px 2px' : '11px 18px',
            borderTop: `1px solid ${T.border}`,
            background: isSidebar ? T.card : T.card,
          },
        },
          notice
            ? h('span', {
                role: notice.kind === 'error' ? 'alert' : 'status',
                style: {
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  marginRight: 'auto',
                  color: notice.kind === 'error' ? T.error : T.success,
                  fontSize: 11.5,
                  lineHeight: 1.35,
                },
              },
                h(Icon, { name: notice.kind === 'error' ? 'alert' : 'check', size: 13 }),
                notice.text,
              )
            : h('span', {
                style: {
                  marginRight: 'auto',
                  color: dirty ? T.warn : T.faint,
                  fontSize: 11.5,
                },
              }, dirty ? '有未保存的更改' : '所有更改已保存'),
          h('button', {
            type: 'button',
            onClick: () => void load(),
            disabled: saving,
            style: secondaryButton,
          }, '重新读取'),
          h('button', {
            type: 'button',
            onClick: () => void save(),
            disabled: !dirty || saving || phase === 'readOnly',
            style: primaryButton,
          }, saving ? '保存中…' : '保存更改'),
        ),
      )
    }

    function VoiceFish({ sessionId, inputActions, useInput, locked, onActiveChange }) {
      const [phase, setPhase] = useState('idle')
      const [level, setLevel] = useState(0)
      const [levels, setLevels] = useState([])
      const [elapsed, setElapsed] = useState(0)
      const [message, setMessage] = useState('')
      const [analysis, setAnalysis] = useState(null)
      const [sent, setSent] = useState(false)
      const [sending, setSending] = useState(false)
      const [pluginEnabled, setPluginEnabled] = useState(null)
      const [language, setLanguage] = useState('zh')
      const recorder = useRef(null)
      const abort = useRef(null)
      const timer = useRef(null)
      const ticker = useRef(null)
      const permissionTimer = useRef(null)
      const generation = useRef(0)
      const levelsRef = useRef([])
      const shortcutAction = useRef(null)
      const deliveryGate = useRef(null)
      if (!deliveryGate.current) deliveryGate.current = createDeliveryGate()
      const useInputSnapshot = typeof useInput === 'function' ? useInput : useNoInput
      const input = useInputSnapshot((snapshot) => snapshot)
      const inputRef = useRef(input)
      inputRef.current = input
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
        if (permissionTimer.current) clearTimeout(permissionTimer.current)
        timer.current = null
        ticker.current = null
        permissionTimer.current = null
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
        setSending(false)
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
        if (pluginEnabled !== true || locked || recorder.current) return
        const run = ++generation.current
        clearTimers()
        setMessage('')
        setAnalysis(null)
        setSent(false)
        setSending(false)
        setPhase('requesting')
        const active = new Recorder()
        recorder.current = active
        permissionTimer.current = setTimeout(() => {
          permissionTimer.current = null
          if (run !== generation.current) return
          generation.current += 1
          const pending = recorder.current
          recorder.current = null
          if (pending) pending.dispose().catch(() => {})
          setPhase('error')
          setMessage('麦克风授权超时，请检查浏览器权限后重试')
        }, PERMISSION_TIMEOUT_MS)
        try {
          await active.start(onLevel)
          if (permissionTimer.current) {
            clearTimeout(permissionTimer.current)
            permissionTimer.current = null
          }
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
          if (permissionTimer.current) {
            clearTimeout(permissionTimer.current)
            permissionTimer.current = null
          }
          recorder.current = null
          await active.dispose().catch(() => {})
          if (run !== generation.current) return
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
          const capture = await active.stop(() => run !== generation.current)
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
              language,
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
          await deliver(payload, run)
        } catch (error) {
          if (error?.name === 'AbortError') return
          if (run !== generation.current) return
          setPhase('error')
          setMessage(error instanceof Error ? error.message : String(error))
        } finally {
          abort.current = null
        }
      }

      const deliver = async (payload, run = generation.current) => {
        if (!isRunCurrent(run, generation)) return false
        const prompt = String(payload.prompt || '').trim()
        if (!prompt) {
          if (isRunCurrent(run, generation)) {
            setPhase('error')
            setMessage('没有生成可发送的语音内容')
          }
          return false
        }
        const gate = deliveryGate.current
        if (!gate.begin()) return false
        setSending(true)
        try {
          if (!isRunCurrent(run, generation)) return false
          const inputPhase = inputRef.current?.phase
          if (inputPhase === 'adjudicating' || inputPhase === 'submitting') {
            throw new Error('输入框正在提交，请稍后再试')
          }
          if (typeof inputActions?.insertText === 'function') {
            if (typeof inputActions.captureInsertion !== 'function') {
              throw new Error('当前 DSH 版本缺少输入位置接口')
            }
            const inserted = inputActions.insertText(prompt, inputActions.captureInsertion()) === true
            if (!inserted) throw new Error('输入框正忙，请稍后再试')
          } else if (typeof inputActions?.setDraft === 'function') {
            inputActions.setDraft(prompt)
          } else {
            throw new Error('当前 DSH 版本不支持自动填入')
          }
          if (!isRunCurrent(run, generation)) return false
          await sleep(120)
          if (!isRunCurrent(run, generation)) return false
          if (typeof inputActions?.submit !== 'function') {
            throw new Error('当前 DSH 版本不支持自动发送')
          }
          inputActions.submit()
          if (!isRunCurrent(run, generation)) return false
          setSent(true)
          setMessage(`听出${payload.emotionZh || '你的情绪'}，已填入并提交；若未出现请重试`)
          await sleep(1350)
          if (isRunCurrent(run, generation)) await reset()
          return true
        } catch (error) {
          if (isRunCurrent(run, generation)) {
            setPhase('error')
            setMessage(`已识别，但发送失败：${error instanceof Error ? error.message : String(error)}`)
          }
          return false
        } finally {
          gate.end()
          if (isRunCurrent(run, generation)) setSending(false)
        }
      }

      const retry = () => {
        setPhase('idle')
        setMessage('')
        setAnalysis(null)
        setSent(false)
        void start()
      }

      const retrySend = () => {
        if (!analysis) return
        setPhase('result')
        setMessage('')
        void deliver(analysis, generation.current)
      }

      useEffect(() => {
        shortcutAction.current = {
          canHandle: () => pluginEnabled === true && canUseVoiceShortcut(phase, locked),
          run: () => {
            if (pluginEnabled !== true || locked) return false
            if (phase === 'idle') {
              void start()
              return true
            }
            if (phase === 'recording') {
              void finish()
              return true
            }
            if (phase === 'error') {
              retry()
              return true
            }
            return false
          },
        }
      }, [locked, phase, sessionId, pluginEnabled])

      useEffect(() => registerVoiceShortcut({
        canHandle: () => shortcutAction.current?.canHandle?.() === true,
        run: () => shortcutAction.current?.run?.() === true,
      }), [])

      useEffect(() => {
        let active = true
        const applyConfig = (next) => {
          if (!active || !next) return
          setPluginEnabled(next.enabled !== false)
          if (next.language) setLanguage(next.language)
        }
        fetch(CONFIG_ENDPOINT, { cache: 'no-store' })
          .then((response) => (response.ok ? response.json() : null))
          .then((next) => {
            if (!next) {
              if (active) setPluginEnabled(true)
              return
            }
            applyConfig(next)
          })
          .catch(() => {
            // An older host may not expose /config yet. Keep the fish-ear
            // visible rather than silently removing the entry point.
            if (active) setPluginEnabled(true)
          })
        const onConfig = (event) => applyConfig(event.detail)
        window.addEventListener?.('dsh-dafeiyu-emotion:config', onConfig)
        return () => {
          active = false
          window.removeEventListener?.('dsh-dafeiyu-emotion:config', onConfig)
        }
      }, [])

      if (pluginEnabled !== true) return null

      if (phase === 'idle') {
        return h('button', {
          type: 'button',
          style: {
            ...S.trigger,
            gap: 5,
            padding: '0 10px',
            borderColor: 'color-mix(in srgb, #3e7cb1 24%, transparent)',
            background: 'linear-gradient(135deg, color-mix(in srgb, #3e7cb1 14%, transparent), color-mix(in srgb, #5aa7d6 7%, transparent))',
            boxShadow: '0 1px 2px rgba(15, 23, 42, .06), inset 0 1px 0 rgba(255, 255, 255, .2)',
            opacity: locked ? 0.45 : 1,
            cursor: locked ? 'not-allowed' : 'pointer',
            transition: 'background 160ms ease, border-color 160ms ease, transform 120ms ease',
          },
          title: '大肥鱼听你说：读语音、分析语气，再自动回复',
          'aria-label': '大肥鱼听你说',
          disabled: locked,
          onMouseEnter: (event) => {
            if (!locked) event.currentTarget.style.transform = 'translateY(-1px)'
          },
          onMouseLeave: (event) => {
            event.currentTarget.style.transform = 'none'
          },
          onMouseDown: (event) => {
            event.preventDefault()
            event.currentTarget.style.transform = 'translateY(0)'
          },
          onClick: () => void start(),
        },
          h('span', { style: { display: 'inline-flex', color: '#3e7cb1' } }, h(WhaleMark, { size: 16 })),
          h('span', null, '鱼耳'),
        )
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
        phase === 'requesting' && h('button', {
          type: 'button',
          style: S.round,
          title: '取消等待麦克风',
          'aria-label': '取消等待麦克风',
          onClick: () => void reset(),
        }, '×'),
        phase === 'error' && h('button', {
          type: 'button',
          style: S.round,
          title: analysis ? '重试发送' : '重试录音',
          'aria-label': analysis ? '重试发送' : '重试录音',
          onClick: analysis ? retrySend : retry,
        }, analysis ? '↺' : '↻'),
        phase === 'result' && h('button', {
          type: 'button',
          style: S.round,
          title: '关闭',
          'aria-label': '关闭',
          onClick: () => void reset(),
        }, '×'),
        phase === 'analyzing' && h('button', {
          type: 'button',
          style: S.round,
          title: '取消分析',
          'aria-label': '取消分析',
          onClick: () => void reset(),
        }, '×'),
        phase === 'result' && !sent && !sending && h('button', {
          type: 'button',
          style: { ...S.trigger, height: 26, fontSize: 12 },
          disabled: sending,
          onClick: () => void deliver(analysis, generation.current),
        }, '发送'),
      )
    }

    function apply(ctx) {
      ensureEmotionStyles()

      const registerSettingsCard = (slot) => () => {
        try {
          return ctx.slots.register({
            name: slot,
            key: 'dsh-dafeiyu-emotion',
            id: 'dsh-dafeiyu-emotion',
            order: 31,
            label: () => '大肥鱼情绪耳朵',
            inject: () => ({}),
          }, EmotionSettingsCard)
        } catch (error) {
          console.error(`[dsh-dafeiyu-emotion] failed to register settings card for ${slot}:`, error)
          return () => {}
        }
      }
      for (const slot of ['plugins.bundle.config', 'settings.plugins.tab']) {
        try {
          ctx.slots.inject(slot, registerSettingsCard(slot))
        } catch (error) {
          console.error(`[dsh-dafeiyu-emotion] failed to inject settings slot ${slot}:`, error)
        }
      }

      try {
        ctx.inject(['betterSidebar'], (sidebarCtx) => {
          sidebarCtx.effect(() => {
            try {
              return sidebarCtx.betterSidebar.registerTab({
                id: 'dsh-dafeiyu-emotion:settings',
                title: () => '情绪耳朵',
                description: () => '调整大肥鱼语音情绪插件的识别、后端与录音设置',
                icon: (size) => h(WhaleMark, { size: size || 18 }),
                order: 64,
                single: true,
                component: ({ scope }) => h(EmotionSettingsCard, {
                  view: 'sidebar',
                  sessionId: scope?.sessionId,
                }),
              })
            } catch (error) {
              console.error('[dsh-dafeiyu-emotion] betterSidebar registerTab failed:', error)
              return () => {}
            }
          })
        })
      } catch (error) {
        console.error('[dsh-dafeiyu-emotion] failed to register sidebar tab:', error)
      }

      ctx.inject(['shortcuts'], (shortcutCtx) => {
        shortcutCtx.effect(() => shortcutCtx.shortcuts.register({
          id: 'dafeiyu.emotion.voice',
          label: () => '大肥鱼语音：开始 / 停止',
          aliases: ['bigfish voice', 'fish ear', '语音输入', '大肥鱼'],
          defaults: {
            'desktop:macos': { code: 'KeyV', modifiers: ['alt'] },
            'desktop:windows': { code: 'KeyV', modifiers: ['alt'] },
            'desktop:linux': { code: 'KeyV', modifiers: ['alt'] },
            'web:macos': { code: 'KeyV', modifiers: ['primary', 'alt'] },
            'web:windows': { code: 'KeyV', modifiers: ['primary', 'alt'] },
          },
          regions: ['page', 'editable'],
          modals: [],
          resolve: () => canInvokeVoiceShortcut()
            ? {
                status: 'handled',
                run: () => {
                  invokeVoiceShortcut()
                },
              }
            : { status: 'pass' },
        }), 'dsh-dafeiyu-emotion: native voice shortcut')
      })
      const register = () => {
        try {
          return ctx.slots.register({
            name: 'conversation.input.activity',
            id: 'dsh-dafeiyu-emotion',
            order: 35,
            inject: (sessionId) => ({ sessionId }),
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
      __test: {
        createDeliveryGate,
        canUseVoiceShortcut,
        isRunCurrent,
      },
    }
    return module.exports
  },
})

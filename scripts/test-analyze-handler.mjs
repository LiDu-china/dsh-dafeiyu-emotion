import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'

import { apply, inject } from '../src/index.js'

assert.ok(inject.includes('webServer'), 'webServer must be a declared dependency')
assert.equal(inject.includes('settings'), false, 'settings must be resolved dynamically, not as a hard dependency')

const ANALYZE = '/plugins/dsh-dafeiyu-emotion/analyze'
const HEALTH = '/plugins/dsh-dafeiyu-emotion/health'

function makeCtx(speechToText) {
  const handlers = new Map()
  const ctx = {
    logger: { debug() {}, info() {}, error() {} },
    settings: {
      async update() {},
      describe() {
        throw new Error('settings.describe must not run during host startup')
      },
    },
    effect(run) {
      const dispose = run()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    inject(dependencies, callback) {
      if (dependencies.includes('webServer')) {
        callback({
          effect(run) {
            const dispose = run()
            return typeof dispose === 'function' ? dispose : () => {}
          },
          webServer: {
            register(spec) {
              handlers.set(spec.path, spec.handler)
              return () => {}
            },
          },
        })
      } else if (dependencies.includes('speechToText')) {
        callback({
          speechToText,
          effect(run) {
            const dispose = run()
            return typeof dispose === 'function' ? dispose : () => {}
          },
        })
      } else if (dependencies.includes('settings')) {
        callback({
          settings: ctx.settings,
          effect(run) {
            const dispose = run()
            return typeof dispose === 'function' ? dispose : () => {}
          },
        })
      }
    },
  }
  return { ctx, handlers }
}

function makeReq({ body, method = 'POST', remoteAddress = '127.0.0.1' } = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const req = Readable.from([Buffer.from(payload)])
  req.method = method
  req.socket = { remoteAddress }
  req.headers = { host: '127.0.0.1:13344' }
  return req
}

function makeRes() {
  const res = new EventEmitter()
  res.writableEnded = false
  res.status = 0
  res.headers = null
  res.payload = null
  res.writeHead = (status, headers) => {
    res.status = status
    res.headers = headers
  }
  res.end = (payload) => {
    res.payload = payload
    res.writableEnded = true
    res.emit('finish')
  }
  return res
}

function json(res) {
  return JSON.parse(res.payload)
}

function validWav() {
  const wav = Buffer.alloc(500)
  wav.write('RIFF', 0, 'ascii')
  wav.write('WAVE', 8, 'ascii')
  return wav
}

async function call(handler, req) {
  const res = makeRes()
  await handler(req, res)
  return res
}

// Non-local requests are refused before the body is read.
{
  const { ctx, handlers } = makeCtx(undefined)
  apply(ctx, { enabled: true, backendRoot: '' })
  const res = await call(handlers.get(ANALYZE), makeReq({
    body: { audioBase64: 'AA==' },
    remoteAddress: '10.0.0.5',
  }))
  assert.equal(res.status, 403)
  assert.equal(json(res).error, '只允许本机访问')
}

// Disabling the plugin must stop analysis even if the route stays mounted.
{
  const { ctx, handlers } = makeCtx(undefined)
  apply(ctx, { enabled: false, backendRoot: '' })
  const res = await call(handlers.get(ANALYZE), makeReq({
    body: { audioBase64: 'AA==' },
  }))
  assert.equal(res.status, 503)
  assert.match(json(res).error, /已.*关闭/)
}

// Wrong method is rejected.
{
  const { ctx, handlers } = makeCtx(undefined)
  apply(ctx, { enabled: true, backendRoot: '' })
  const res = await call(handlers.get(ANALYZE), makeReq({ method: 'GET' }))
  assert.equal(res.status, 405)
}

// Body too large is 413, not 500.
{
  const { ctx, handlers } = makeCtx(undefined)
  apply(ctx, { enabled: true, backendRoot: '', maxAudioBytes: 256 * 1024 })
  const res = await call(handlers.get(ANALYZE), makeReq({
    body: { audioBase64: 'A'.repeat(500000) },
  }))
  assert.equal(res.status, 413)
  assert.match(json(res).error, /请求体过大/)
}

// Invalid JSON and invalid WAV are 400.
{
  const { ctx, handlers } = makeCtx(undefined)
  apply(ctx, { enabled: true, backendRoot: '' })
  const invalidJson = await call(handlers.get(ANALYZE), makeReq({ body: undefined }))
  assert.equal(invalidJson.status, 400)
  const invalidWav = await call(handlers.get(ANALYZE), makeReq({
    body: { audioBase64: Buffer.alloc(500).toString('base64') },
  }))
  assert.equal(invalidWav.status, 400)
  assert.match(json(invalidWav).error, /WAV/)
}

// The readiness check and resolve must use the selected provider.
{
  let resolveArgs
  const speechToText = {
    snapshot: () => ({
      providers: [
        { id: 'first', preparation: { phase: 'ready' } },
        { id: 'second', preparation: { phase: 'ready' } },
      ],
      selection: { providerId: 'second' },
    }),
    resolve(args) {
      resolveArgs = args
      return { provider: { id: args.providerId }, audio: args.audio, language: args.language }
    },
    async transcribe() {
      return { text: '你好' }
    },
  }
  const { ctx, handlers } = makeCtx(speechToText)
  apply(ctx, { enabled: true, backendRoot: '' })
  const res = await call(handlers.get(ANALYZE), makeReq({
    body: { audioBase64: validWav().toString('base64'), prosody: {} },
  }))
  assert.equal(res.status, 200)
  assert.equal(resolveArgs.providerId, 'second')
  assert.equal(json(res).transcript, '你好')
}

// A configured but missing backend is visible in both analyze and health.
{
  const missing = 'Z:/dsh-dafeiyu-emotion-missing-backend'
  const speechToText = {
    snapshot: () => ({ providers: [], selection: {} }),
    resolve() {
      throw new Error('should not resolve')
    },
    async transcribe() {
      throw new Error('speech unavailable')
    },
  }
  const { ctx, handlers } = makeCtx(speechToText)
  apply(ctx, { enabled: true, backendRoot: missing })
  const analyze = await call(handlers.get(ANALYZE), makeReq({
    body: { audioBase64: validWav().toString('base64'), prosody: {} },
  }))
  assert.equal(analyze.status, 500)
  assert.match(json(analyze).error, /语音后端目录不存在/)

  const health = await call(handlers.get(HEALTH), makeReq({ method: 'GET' }))
  const payload = json(health)
  assert.equal(payload.mode, 'enhanced-backend-missing')
  assert.equal(payload.backendConfigured, true)
  assert.equal(payload.backendAvailable, false)
  assert.match(payload.lastError, /语音后端目录不存在/)
}

// Health reflects real provider readiness, not just service presence.
{
  const speechToText = {
    snapshot: () => ({
      providers: [{ id: 'sensevoice', preparation: { phase: 'ready' } }],
      selection: { providerId: 'sensevoice' },
    }),
  }
  const { ctx, handlers } = makeCtx(speechToText)
  apply(ctx, { enabled: true, backendRoot: '' })
  const health = await call(handlers.get(HEALTH), makeReq({ method: 'GET' }))
  const payload = json(health)
  assert.equal(payload.mode, 'dsh-speech-prosody')
  assert.equal(payload.dshSpeechReady, true)
  assert.equal(payload.speechProvider, 'sensevoice')
  assert.equal(payload.speechPhase, 'ready')
}

console.log('analyze handler ok')

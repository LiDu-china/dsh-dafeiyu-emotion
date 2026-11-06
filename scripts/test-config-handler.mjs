import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'

import {
  createConfigHandler,
  normalizeConfigPatch,
  publicConfig,
} from '../src/index.js'

const NAMESPACE = 'dsh-dafeiyu-emotion'

function baseOptions(overrides = {}) {
  return {
    enabled: true,
    backendRoot: '',
    pythonPath: '',
    language: 'zh',
    maxAudioBytes: 12 * 1024 * 1024,
    startupTimeoutMs: 180000,
    requestTimeoutMs: 180000,
    ...overrides,
  }
}

function writableSettings(update = async () => {}) {
  return {
    describe: () => [{ ns: NAMESPACE, revision: 7, value: {}, user: {} }],
    update,
  }
}

function makeReq({ body, method = 'GET', remoteAddress = '127.0.0.1' } = {}) {
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

async function call(handler, req) {
  const res = makeRes()
  await handler(req, res)
  return res
}

// The public projection never returns secrets; it only exposes local settings.
{
  const value = publicConfig(baseOptions(), true)
  assert.equal(value.enabled, true)
  assert.equal(value.language, 'zh')
  assert.equal(value.writable, true)
  assert.equal('token' in value, false)
}

// Known fields are normalized and clamped.
{
  const patch = normalizeConfigPatch({
    enabled: false,
    language: 'EN',
    empathyStyle: 'DIRECT',
    ttsEnabled: true,
    ttsOnlyAfterVoice: false,
    ttsEngine: 'BROWSER',
    ttsVoice: 'zh-CN-XiaoxiaoNeural',
    ttsRate: '+10%',
    ttsPitch: '+20Hz',
    maxAudioBytes: 1,
    startupTimeoutMs: 1,
    requestTimeoutMs: 999999,
    backendRoot: ' D:/voice ',
    pythonPath: '',
  })
  assert.equal(patch.enabled, false)
  assert.equal(patch.language, 'en')
  assert.equal(patch.empathyStyle, 'direct')
  assert.equal(patch.ttsEnabled, true)
  assert.equal(patch.ttsOnlyAfterVoice, false)
  assert.equal(patch.ttsEngine, 'browser')
  assert.equal(patch.ttsVoice, 'zh-CN-XiaoxiaoNeural')
  assert.equal(patch.ttsRate, '+10%')
  assert.equal(patch.ttsPitch, '+20Hz')
  assert.equal(patch.maxAudioBytes, 256 * 1024)
  assert.equal(patch.startupTimeoutMs, 10000)
  assert.equal(patch.requestTimeoutMs, 600000)
  assert.equal(patch.backendRoot, 'D:/voice')
  assert.equal(patch.pythonPath, '')
}

// Unknown fields, bad types and control characters are rejected.
{
  assert.throws(() => normalizeConfigPatch({ nope: true }), /未知配置项/)
  assert.throws(() => normalizeConfigPatch({ enabled: 'yes' }), /布尔值/)
  assert.throws(() => normalizeConfigPatch({ language: 'fr' }), /language/)
  assert.throws(() => normalizeConfigPatch({ empathyStyle: 'sarcastic' }), /empathyStyle/)
  assert.throws(() => normalizeConfigPatch({ ttsEngine: 'cloud' }), /ttsEngine/)
  assert.throws(() => normalizeConfigPatch({ ttsVoice: 'bad' }), /ttsVoice/)
  assert.throws(() => normalizeConfigPatch({ ttsRate: '6%' }), /ttsRate/)
  assert.throws(() => normalizeConfigPatch({ backendRoot: 'C:\\bad\u0000path' }), /本地路径/)
  assert.throws(() => normalizeConfigPatch(null), /对象/)
  assert.throws(() => normalizeConfigPatch({ maxAudioBytes: true }), /整数/)
  assert.throws(() => normalizeConfigPatch({ maxAudioBytes: 1024.5 }), /整数/)
  assert.throws(() => normalizeConfigPatch({ startupTimeoutMs: '12000' }), /整数/)
}

// GET returns the current runtime values.
{
  const runtime = { options: baseOptions({ language: 'en' }) }
  const handler = createConfigHandler({
    runtime,
    backend: { syncOptions() {} },
    getSettings: () => writableSettings(),
  })
  const res = await call(handler, makeReq())
  assert.equal(res.status, 200)
  assert.equal(json(res).language, 'en')
  assert.equal(json(res).writable, true)
  assert.equal(json(res).revision, 7)
}

// PATCH writes the settings namespace and updates the shared runtime object.
{
  const runtime = { options: baseOptions() }
  const updates = []
  const backend = {
    syncOptions(previous) {
      this.previous = previous
    },
  }
  const handler = createConfigHandler({
    runtime,
    backend,
    getSettings: () => writableSettings(async (namespace, patch, revision) => {
        updates.push({ namespace, patch, revision })
      }),
  })
  const res = await call(handler, makeReq({
    method: 'PATCH',
    body: { language: 'en', maxAudioBytes: 1024 * 1024, expectedRevision: 7 },
  }))
  assert.equal(res.status, 200)
  assert.equal(updates.length, 1)
  assert.equal(updates[0].namespace, NAMESPACE)
  assert.deepEqual(updates[0].patch, { language: 'en', maxAudioBytes: 1024 * 1024 })
  assert.equal(updates[0].revision, 7)
  assert.equal(runtime.options.language, 'en')
  assert.equal(runtime.options.maxAudioBytes, 1024 * 1024)
  assert.equal(backend.previous.maxAudioBytes, 12 * 1024 * 1024)
}

// A read-only host returns 503 instead of pretending the write succeeded.
{
  const runtime = { options: baseOptions() }
  const handler = createConfigHandler({
    runtime,
    backend: { syncOptions() {} },
    getSettings: () => ({}),
  })
  const res = await call(handler, makeReq({
    method: 'PATCH',
    body: { language: 'en' },
  }))
  assert.equal(res.status, 503)
  assert.match(json(res).error, /不支持/)
}

// Non-local requests and wrong methods are rejected before parsing.
{
  const runtime = { options: baseOptions() }
  const handler = createConfigHandler({
    runtime,
    backend: { syncOptions() {} },
    getSettings: () => writableSettings(),
  })
  const forbidden = await call(handler, makeReq({ remoteAddress: '10.0.0.5' }))
  assert.equal(forbidden.status, 403)
  const wrongMethod = await call(handler, makeReq({ method: 'POST' }))
  assert.equal(wrongMethod.status, 405)
}

// Invalid JSON and a too-large patch are rejected as 400/413.
{
  const runtime = { options: baseOptions() }
  const handler = createConfigHandler({
    runtime,
    backend: { syncOptions() {} },
    getSettings: () => writableSettings(),
  })
  const invalid = await call(handler, makeReq({ method: 'PATCH', body: undefined }))
  assert.equal(invalid.status, 400)
  const tooLarge = await call(handler, makeReq({
    method: 'PATCH',
    body: { backendRoot: 'x'.repeat(20000) },
  }))
  assert.equal(tooLarge.status, 413)
}

console.log('config handler tests passed')

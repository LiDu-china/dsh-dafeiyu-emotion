import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { Readable } from 'node:stream'

import { HelperProcess } from 'dsh-dafeiyu'

import { createPetReactionHandler } from '../src/index.js'

assert.equal(
  HelperProcess?.prototype?.__dafeiyuEmotionBridgePatched,
  true,
  'the emotion bridge must patch HelperProcess.start to capture the pet bridge',
)

{
  const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.ok(
    patch.indexOf('id: dsh-dafeiyu-emotion') < patch.indexOf('    - id: dsh-dafeiyu\n'),
    'the emotion plugin must mount before dsh-dafeiyu so the bridge hook is installed',
  )
}

function makeReq({ body, method = 'POST', remoteAddress = '127.0.0.1' } = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const req = Readable.from([Buffer.from(payload)])
  req.method = method
  req.url = '/plugins/dsh-dafeiyu-emotion/pet/reaction'
  req.socket = { remoteAddress }
  req.headers = { host: '127.0.0.1:13344' }
  return req
}

function makeRes() {
  const res = new EventEmitter()
  res.writableEnded = false
  res.destroyed = false
  res.status = 0
  res.payload = null
  res.writeHead = (status) => { res.status = status }
  res.end = (payload) => {
    res.payload = payload
    res.writableEnded = true
  }
  return res
}

async function call(handler, req) {
  const res = makeRes()
  await handler(req, res)
  return res
}

function json(res) {
  return JSON.parse(res.payload)
}

const runtime = {
  options: {
    enabled: true,
    petReactionEnabled: true,
    petSayEnabled: true,
  },
  petReactionActive: new Map(),
  petReactionTimers: new Map(),
  petSayTimers: new Map(),
}
const sent = []
const bridge = {
  send(message) {
    sent.push(message)
  },
}
const handler = createPetReactionHandler(runtime, () => bridge)

function clearTimers() {
  for (const timer of runtime.petReactionTimers.values()) clearTimeout(timer)
  runtime.petReactionTimers.clear()
  for (const state of runtime.petSayTimers.values()) {
    state.active = false
    if (state.timer) clearTimeout(state.timer)
  }
  runtime.petSayTimers.clear()
  runtime.petReactionActive.clear()
}

// A spoken reply sends a thinking state, grows the reply into the pet bubble,
// and ends with the success pulse.
{
  const start = await call(handler, makeReq({
    body: { phase: 'start', sessionId: 's1', text: '你好呀，我在呢。' },
  }))
  assert.equal(start.status, 200)
  assert.equal(json(start).reacted, true)
  assert.equal(json(start).transport, 'bridge')

  const state = sent.find((message) => message.kind === 'state' && message.state === 'THINKING')
  assert.ok(state, 'start must put the pet into THINKING')
  const bubble = sent.find((message) => message.kind === 'task' && message.message.includes('你好'))
  assert.ok(bubble, 'the reply text must reach the pet task bubble')
  assert.match(bubble.message, /正在说：/)

  const end = await call(handler, makeReq({ body: { phase: 'end', sessionId: 's1' } }))
  assert.equal(end.status, 200)
  assert.equal(json(end).reacted, true)
  const pulse = sent.find((message) => message.kind === 'pulse' && message.state === 'SUCCESS')
  assert.ok(pulse, 'end must send the success pulse')
  assert.equal(runtime.petReactionActive.size, 0)
  clearTimers()
}

// Bubble text can be disabled without losing the thinking/success reaction.
{
  sent.length = 0
  runtime.options.petSayEnabled = false
  await call(handler, makeReq({
    body: { phase: 'start', sessionId: 's2', text: '不该显示。' },
  }))
  assert.ok(sent.some((message) => message.kind === 'state'))
  assert.equal(sent.some((message) => message.kind === 'task'), false)
  await call(handler, makeReq({ body: { phase: 'end', sessionId: 's2' } }))
  runtime.options.petSayEnabled = true
  clearTimers()
}

// Disabling mid-speech must still allow the end cleanup.
{
  sent.length = 0
  await call(handler, makeReq({ body: { phase: 'start', sessionId: 's3' } }))
  runtime.options.petReactionEnabled = false
  const end = await call(handler, makeReq({ body: { phase: 'end', sessionId: 's3' } }))
  assert.equal(json(end).reacted, true)
  assert.ok(sent.some((message) => message.kind === 'pulse' && message.state === 'SUCCESS'))
  runtime.options.petReactionEnabled = true
  clearTimers()
}

// Start is refused when the feature is off. A missing bridge is a clear no-op.
{
  sent.length = 0
  runtime.options.petReactionEnabled = false
  const disabled = await call(handler, makeReq({ body: { phase: 'start', sessionId: 's4' } }))
  assert.equal(json(disabled).reacted, false)
  assert.equal(json(disabled).reason, 'disabled')
  runtime.options.petReactionEnabled = true

  const noBridgeHandler = createPetReactionHandler(runtime, () => null)
  const missing = await call(noBridgeHandler, makeReq({ body: { phase: 'start', sessionId: 's4' } }))
  assert.equal(json(missing).reacted, false)
  assert.equal(json(missing).reason, 'pet-bridge-unavailable')
}

// Duplicate end is idempotent, and non-local/wrong-method requests are rejected.
{
  sent.length = 0
  await call(handler, makeReq({ body: { phase: 'start', sessionId: 's5' } }))
  await call(handler, makeReq({ body: { phase: 'end', sessionId: 's5' } }))
  const pulses = sent.filter((message) => message.kind === 'pulse' && message.state === 'SUCCESS')
  assert.equal(pulses.length, 1)
  const duplicate = await call(handler, makeReq({ body: { phase: 'end', sessionId: 's5' } }))
  assert.equal(json(duplicate).reacted, false)
  assert.equal(json(duplicate).reason, 'not-active')

  const forbidden = await call(handler, makeReq({
    body: { phase: 'start', sessionId: 's5' },
    remoteAddress: '10.0.0.5',
  }))
  assert.equal(forbidden.status, 403)
  const wrongMethod = await call(handler, makeReq({ method: 'GET' }))
  assert.equal(wrongMethod.status, 405)
  clearTimers()
}

// End must use the bridge captured at start even if the pet bridge getter is
// no longer available (for example the pet was disabled mid-speech).
{
  sent.length = 0
  await call(handler, makeReq({ body: { phase: 'start', sessionId: 's6' } }))
  const noBridgeHandler = createPetReactionHandler(runtime, () => null)
  const end = await call(noBridgeHandler, makeReq({ body: { phase: 'end', sessionId: 's6' } }))
  assert.equal(json(end).reacted, true)
  assert.ok(sent.some((message) => message.kind === 'pulse' && message.state === 'SUCCESS'))
  clearTimers()
}

console.log('pet reaction tests passed')

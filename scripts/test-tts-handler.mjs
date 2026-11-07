import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'

import {
  apply,
  assistantTextFromEvent,
  cleanForSpeech,
  ttsReady,
} from '../src/index.js'

const TTS = '/plugins/dsh-dafeiyu-emotion/tts'
const EVENTS = '/plugins/dsh-dafeiyu-emotion/events'

function makeCtx() {
  const handlers = new Map()
  let sessionHandler
  const ctx = {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
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
      } else if (dependencies.includes('sessions')) {
        callback({
          on(name, handler) {
            if (name === 'session/event') sessionHandler = handler
            return () => {}
          },
        })
      }
    },
  }
  return {
    ctx,
    handlers,
    emitSession(session, event) {
      sessionHandler?.(session, event)
    },
  }
}

function makeReq({ body, method = 'POST' } = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const req = Readable.from([Buffer.from(payload)])
  req.method = method
  req.socket = { remoteAddress: '127.0.0.1' }
  req.headers = { host: '127.0.0.1:13344' }
  return req
}

function makeRes() {
  const res = new EventEmitter()
  res.writableEnded = false
  res.destroyed = false
  res.status = 0
  res.headers = null
  res.payload = null
  res.chunks = []
  res.writeHead = (status, headers) => {
    res.status = status
    res.headers = headers
  }
  res.write = (chunk) => {
    res.chunks.push(String(chunk))
    return true
  }
  res.end = (payload = '') => {
    res.payload = String(payload)
    res.writableEnded = true
  }
  return res
}

function json(res) {
  return JSON.parse(res.payload)
}

// Assistant messages contribute text blocks only.
{
  const text = assistantTextFromEvent({
    type: 'assistant/message',
    data: {
      message: {
        content: [
          { type: 'text', text: '第一段' },
          { type: 'tool-call', name: 'search' },
          { type: 'text', text: '第二段' },
        ],
      },
    },
  })
  assert.equal(text, '第一段\n第二段')
}

// Markdown noise is removed before it reaches TTS.
{
  const cleaned = cleanForSpeech('# 标题\n请看 [文档](https://example.com)\n```js\nconst a = 1\n```\n**重点**')
  assert.equal(cleaned.includes('```'), false)
  assert.equal(cleaned.includes('https://example.com'), false)
  assert.match(cleaned, /标题/)
  assert.match(cleaned, /文档/)
  assert.match(cleaned, /重点/)
}

// An explicitly disabled TTS reports a clear 503.
{
  const { ctx, handlers } = makeCtx()
  apply(ctx, { enabled: true, backendRoot: '', ttsEnabled: false })
  const res = makeRes()
  await handlers.get(TTS)(makeReq({ body: { text: '你好' } }), res)
  assert.equal(res.status, 503)
  assert.match(json(res).error, /语音回复已关闭/)
}

// A bare command name is resolved through PATH; existsSync alone would call it
// unavailable even though edge-tts is installed.
{
  assert.equal(
    ttsReady({ ttsEnabled: true, ttsEngine: 'edge', ttsCommand: 'node' }),
    true,
    'a real PATH command must count as ready',
  )
  assert.equal(
    ttsReady({ ttsEnabled: true, ttsEngine: 'edge', ttsCommand: 'definitely-not-a-real-command-xyz' }),
    false,
    'a missing PATH command must not count as ready',
  )
  assert.equal(
    ttsReady({ ttsEnabled: true, ttsEngine: 'piper', ttsPiperModel: 'D:/missing-piper-model.onnx' }),
    false,
    'a missing Piper model must count as unavailable',
  )
}

// Invalid voice/text is rejected before spawning edge-tts.
{
  const { ctx, handlers } = makeCtx()
  apply(ctx, { enabled: true, backendRoot: '', ttsEnabled: true, ttsEngine: 'edge', ttsVoice: 'bad' })
  const invalidVoice = makeRes()
  await handlers.get(TTS)(makeReq({ body: { text: '你好' } }), invalidVoice)
  assert.equal(invalidVoice.status, 400)
  assert.match(json(invalidVoice).error, /音色/)

  const empty = makeRes()
  await handlers.get(TTS)(makeReq({ body: { text: '```\ncode\n```' } }), empty)
  assert.equal(empty.status, 400)
  assert.match(json(empty).error, /没有可朗读/)

  const missingModel = makeRes()
  apply(ctx, {
    enabled: true,
    backendRoot: '',
    ttsEnabled: true,
    ttsEngine: 'piper',
    ttsPiperModel: 'D:/missing-piper-model.onnx',
  })
  await handlers.get(TTS)(makeReq({ body: { text: '你好' } }), missingModel)
  assert.equal(missingModel.status, 502)
  assert.match(json(missingModel).error, /Piper 模型不存在/)
}

// The SSE endpoint keeps the connection open and emits the connected frame.
{
  const { ctx, handlers } = makeCtx()
  apply(ctx, { enabled: true, backendRoot: '' })
  const res = makeRes()
  await handlers.get(EVENTS)(makeReq({ method: 'GET' }), res)
  assert.equal(res.status, 200)
  assert.match(res.headers['content-type'], /text\/event-stream/)
  assert.ok(res.chunks.some((chunk) => chunk.includes('connected')))
  res.emit('close')
}

// An assistant message is broadcast to the SSE client with its text.
{
  const { ctx, handlers, emitSession } = makeCtx()
  apply(ctx, {
    enabled: true,
    backendRoot: '',
    ttsEnabled: true,
    ttsOnlyAfterVoice: false,
    ttsEngine: 'browser',
  })
  const res = makeRes()
  await handlers.get(EVENTS)(makeReq({ method: 'GET' }), res)
  emitSession(
    { header: { id: 'session-1' } },
    {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: '你好，我是大肥鱼。' }] } },
    },
  )
  assert.ok(res.chunks.some((chunk) => chunk.includes('"kind":"assistant"')))
  assert.ok(res.chunks.some((chunk) => chunk.includes('你好，我是大肥鱼。')))
  res.emit('close')
}

// Disabling the plugin stops the spoken-reply stream even when TTS is on.
{
  const { ctx, handlers, emitSession } = makeCtx()
  apply(ctx, {
    enabled: false,
    backendRoot: '',
    ttsEnabled: true,
    ttsOnlyAfterVoice: false,
    ttsEngine: 'browser',
  })
  const res = makeRes()
  await handlers.get(EVENTS)(makeReq({ method: 'GET' }), res)
  emitSession(
    { header: { id: 'session-1' } },
    {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: '停用后不该朗读。' }] } },
    },
  )
  assert.equal(
    res.chunks.some((chunk) => chunk.includes('停用后不该朗读')),
    false,
    'a disabled plugin must not broadcast assistant text',
  )
  res.emit('close')
}

// An event with no session id must not leak into every open window.
{
  const { ctx, handlers, emitSession } = makeCtx()
  apply(ctx, {
    enabled: true,
    backendRoot: '',
    ttsEnabled: true,
    ttsOnlyAfterVoice: false,
    ttsEngine: 'browser',
  })
  const res = makeRes()
  await handlers.get(EVENTS)(makeReq({ method: 'GET' }), res)
  emitSession(
    {},
    {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: '没有会话 id 的回复。' }] } },
    },
  )
  assert.equal(
    res.chunks.some((chunk) => chunk.includes('没有会话 id 的回复')),
    false,
    'an unscoped assistant event must stay out of the shared stream',
  )
  res.emit('close')
}

console.log('tts handler tests passed')

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { cleanupTempArtifacts, createPrivacyCleanupHandler } from '../src/index.js'

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

const root = await mkdtemp(join(tmpdir(), 'dsh-dafeiyu-cleanup-test-'))
const oldDir = join(root, 'dsh-dafeiyu-emotion-old')
const newDir = join(root, 'dsh-dafeiyu-emotion-new')
const ttsOld = join(root, 'dsh-dafeiyu-tts-old')
const broadDir = join(root, 'dsh-dafeiyu-other')
const otherDir = join(root, 'other-plugin-cache')
const prefixedFile = join(root, 'dsh-dafeiyu-emotion-file.txt')

try {
  await mkdir(oldDir)
  await writeFile(join(oldDir, 'voice.wav'), 'old')
  await mkdir(newDir)
  await writeFile(join(newDir, 'voice.wav'), 'new')
  await mkdir(ttsOld)
  await writeFile(join(ttsOld, 'reply.wav'), 'old')
  await mkdir(broadDir)
  await mkdir(otherDir)
  await writeFile(prefixedFile, 'not a directory')

  const tenMinutesAgo = new Date(Date.now() - 10 * 60_000)
  await utimes(oldDir, tenMinutesAgo, tenMinutesAgo)
  await utimes(ttsOld, tenMinutesAgo, tenMinutesAgo)
  await utimes(broadDir, tenMinutesAgo, tenMinutesAgo)

  const result = await cleanupTempArtifacts(root, {
    prefix: 'dsh-dafeiyu-emotion-',
    minAgeMs: 60_000,
    now: Date.now(),
  })

  assert.deepEqual(result.removed, ['dsh-dafeiyu-emotion-old'])
  assert.equal(result.scanned, 2, 'only prefixed directories are candidates')
  await assert.rejects(() => stat(oldDir), /ENOENT/)
  assert.ok((await stat(newDir)).isDirectory(), 'a fresh request directory must be kept')
  assert.ok((await stat(otherDir)).isDirectory(), 'an unrelated directory must be kept')
  assert.ok((await stat(prefixedFile)).isFile(), 'a prefixed file must be kept')

  const cleanupHandler = createPrivacyCleanupHandler({ lastCleanupAt: null }, () => root)
  const cleanupResponse = await call(cleanupHandler, makeReq({ body: {} }))
  assert.equal(cleanupResponse.status, 200)
  const cleanupJson = JSON.parse(cleanupResponse.payload)
  assert.equal(cleanupJson.removed, 1, 'only the old TTS directory should be removed')
  await assert.rejects(() => stat(ttsOld), /ENOENT/)
  assert.ok((await stat(newDir)).isDirectory(), 'fresh emotion dirs must be kept')
  assert.ok((await stat(broadDir)).isDirectory(), 'unrelated dsh-dafeiyu dirs must be kept')

  const missing = await cleanupTempArtifacts(join(root, 'missing'), {
    prefix: 'dsh-dafeiyu-',
    minAgeMs: 0,
  })
  assert.deepEqual(missing, { removed: [], scanned: 0 }, 'a missing root is a no-op')

  const handler = createPrivacyCleanupHandler({ lastCleanupAt: null })
  const forbidden = {
    method: 'POST',
    socket: { remoteAddress: '10.0.0.5' },
    headers: { host: '127.0.0.1:13344' },
  }
  const forbiddenRes = {
    writableEnded: false,
    destroyed: false,
    writeHead(status) { this.status = status },
    end(payload) { this.payload = payload; this.writableEnded = true },
  }
  await handler(forbidden, forbiddenRes)
  assert.equal(forbiddenRes.status, 403)

  const wrongMethod = {
    method: 'GET',
    socket: { remoteAddress: '127.0.0.1' },
    headers: { host: '127.0.0.1:13344' },
  }
  const wrongMethodRes = {
    writableEnded: false,
    destroyed: false,
    writeHead(status) { this.status = status },
    end(payload) { this.payload = payload; this.writableEnded = true },
  }
  await handler(wrongMethod, wrongMethodRes)
  assert.equal(wrongMethodRes.status, 405)
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('privacy cleanup ok')

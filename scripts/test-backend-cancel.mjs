import assert from 'node:assert/strict'

import { VoiceBackend } from '../src/index.js'

function makeBackend() {
  return new VoiceBackend({
    enabled: true,
    backendRoot: '',
    pythonPath: '',
    language: 'zh',
    maxAudioBytes: 12 * 1024 * 1024,
    startupTimeoutMs: 180000,
    requestTimeoutMs: 180000,
  }, { debug() {} })
}

// Cancelling a queued request must not kill the worker serving another one.
{
  const backend = makeBackend()
  let killed = 0
  backend.proc = {
    killed: false,
    kill() {
      killed += 1
      this.killed = true
    },
  }
  backend.activeRequestId = 7
  backend.cancel(8)
  assert.equal(killed, 0, 'a non-active request must not kill the worker')
  backend.cancel(7)
  assert.equal(killed, 1, 'the active request may stop its own worker')
}

// close() invalidates queued work and records the generation boundary.
{
  const backend = makeBackend()
  const generation = backend.generation
  await backend.close()
  assert.equal(backend.closed, true)
  assert.equal(backend.generation, generation + 1)
  await assert.rejects(() => backend.ensureStarted(), /已关闭/)
}

// Re-enabling through syncOptions clears the closed latch without starting a
// worker immediately; the next request starts it on demand.
{
  const backend = makeBackend()
  backend.closed = true
  backend.options.enabled = true
  backend.syncOptions({ ...backend.options, enabled: false })
  assert.equal(backend.closed, false)
  assert.equal(backend.proc, null)
}

console.log('backend cancellation tests passed')

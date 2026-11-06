import assert from 'node:assert/strict'

import { Config } from '../src/index.js'

// The DSH settings service parses the schema with its defaults before a plugin
// row can become configurable. A default that violates its own step/min/max
// makes the whole plugin fail to activate, not just the settings card.
assert.doesNotThrow(() => Config({}), 'empty config must validate')
assert.doesNotThrow(
  () => Config({ maxAudioBytes: 12 * 1024 * 1024 }),
  'the shipped 12 MiB default must validate',
)
assert.doesNotThrow(
  () => Config({ startupTimeoutMs: 12000, requestTimeoutMs: 12000 }),
  'non-five-second timeouts must validate',
)
assert.doesNotThrow(
  () => Config({
    enabled: false,
    backendRoot: 'D:/voice-sense',
    pythonPath: 'D:/voice-sense/.venv-ser/Scripts/python.exe',
    language: 'auto',
    maxAudioBytes: 8 * 1024 * 1024,
    startupTimeoutMs: 180000,
    requestTimeoutMs: 180000,
  }),
  'a full settings payload must validate',
)

for (const key of [
  'enabled',
  'backendRoot',
  'pythonPath',
  'language',
  'maxAudioBytes',
  'startupTimeoutMs',
  'requestTimeoutMs',
]) {
  assert.equal(Config.dict[key]?.meta?.volatile, true, `${key} must be volatile`)
}

assert.throws(
  () => Config({ maxAudioBytes: 1 }),
  /maxAudioBytes/,
  'below-min values must be rejected by the schema',
)
assert.throws(
  () => Config({ language: 'fr' }),
  /language/,
  'unknown languages must be rejected by the schema',
)

console.log('config schema tests passed')

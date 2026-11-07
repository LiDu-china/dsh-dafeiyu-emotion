import assert from 'node:assert/strict'

let clientModule

globalThis.window = {
  __ModuleLoader__: {
    load({ factory }) {
      clientModule = factory((id) => {
        assert.equal(id, 'react')
        return {
          createElement() {},
          Fragment: {},
          useEffect() {},
          useLayoutEffect() {},
          useRef() {},
          useState() {},
        }
      })
    },
  },
}

await import(new URL('../lib/client.js', import.meta.url).href)
assert.ok(clientModule?.__test, 'client bundle should expose delivery test helpers')

const {
  createDeliveryGate,
  canUseVoiceShortcut,
  isRunCurrent,
  submitAccepted,
  emotionVoiceProfile,
  effectiveEmotion,
  evidenceItems,
  loadBaseline,
  saveBaseline,
  clearBaseline,
} = clientModule.__test

const gate = createDeliveryGate()
assert.equal(gate.begin(), true, 'first delivery should acquire the gate')
assert.equal(gate.begin(), false, 'a concurrent delivery must be rejected')
gate.end()
assert.equal(gate.begin(), true, 'the gate should reopen after settlement')
gate.end()

assert.equal(canUseVoiceShortcut('idle', false), true)
assert.equal(canUseVoiceShortcut('recording', false), true)
assert.equal(canUseVoiceShortcut('error', false), true)
assert.equal(canUseVoiceShortcut('requesting', false), false)
assert.equal(canUseVoiceShortcut('analyzing', false), false)
assert.equal(canUseVoiceShortcut('result', false), false)
assert.equal(canUseVoiceShortcut('idle', true), false)

assert.equal(isRunCurrent(2, { current: 2 }), true)
assert.equal(isRunCurrent(2, { current: 3 }), false)

assert.equal(submitAccepted(false), false, 'a refused submit must not count as sent')
assert.equal(submitAccepted(undefined), true, 'hosts that return nothing still accept submit')
assert.equal(submitAccepted(true), true)

assert.deepEqual(
  emotionVoiceProfile('happy', '+6%', '+12Hz', true),
  { rate: '+10%', pitch: '+20Hz' },
  'happy speech should lift rate and pitch',
)
assert.deepEqual(
  emotionVoiceProfile('sad', '+6%', '+12Hz', true),
  { rate: '+1%', pitch: '+9Hz' },
  'sad speech should slow down and lower pitch',
)
assert.deepEqual(
  emotionVoiceProfile('happy', '+6%', '+12Hz', false),
  { rate: '+6%', pitch: '+12Hz' },
  'disabled adaptation must keep the user values',
)
assert.deepEqual(
  emotionVoiceProfile('neutral', '+6%', '+12Hz', true),
  { rate: '+6%', pitch: '+12Hz' },
  'neutral speech should keep the user values',
)
assert.deepEqual(
  emotionVoiceProfile('happy', '+40%', '+30Hz', true),
  { rate: '+44%', pitch: '+38Hz' },
  'emotion adaptation must add to the configured value, not clamp it down',
)

assert.equal(effectiveEmotion('happy', { emotion: 'sad', at: 0 }, 1000), 'happy')
assert.equal(effectiveEmotion(null, { emotion: 'sad', at: 1000 }, 2000), 'sad')
assert.equal(effectiveEmotion(null, { emotion: 'sad', at: 1000 }, 200000), 'neutral')

const evidence = evidenceItems({
  confidence: 0.7,
  source: 'prosody+text',
  features: {
    speech_rate: 5.2,
    pause_ratio: 0.18,
    f0_range_st: 6.4,
    energy_n: 0.6,
  },
})
assert.ok(evidence.some((item) => item.label === '语速' && item.value.includes('5.2')))
assert.ok(evidence.some((item) => item.label === '依据' && item.value.includes('文本')))
assert.equal(
  evidenceItems({ features: { speech_rate: null, pause_ratio: null } }).some((item) => item.label === '语速'),
  false,
  'null features must not render as zero',
)

const store = new Map()
globalThis.localStorage = {
  getItem: (key) => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
}
const saved = saveBaseline({
  f0_median: 180,
  energy_n: 0.5,
  pause_ratio: 0.2,
  f0_std_st: 2,
})
assert.equal(saved.f0_median, 180)
assert.equal(loadBaseline().f0_median, 180)
clearBaseline()
assert.equal(loadBaseline(), null)
delete globalThis.localStorage

delete globalThis.window
console.log('delivery policy ok')

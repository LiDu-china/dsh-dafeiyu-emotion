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

const { createDeliveryGate, canUseVoiceShortcut, isRunCurrent } = clientModule.__test

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

delete globalThis.window
console.log('delivery policy ok')

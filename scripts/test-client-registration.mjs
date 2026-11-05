import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const source = readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8')

const fakeReact = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  Fragment: 'Fragment',
  useEffect() {},
  useLayoutEffect() {},
  useRef(value) {
    return { current: value }
  },
  useState(value) {
    return [value, () => {}]
  },
}

const fakeDocument = {
  getElementById() {
    return null
  },
  createElement() {
    return { id: '', textContent: '' }
  },
  head: {
    appendChild() {},
  },
}

let definition
const sandbox = {
  console,
  document: fakeDocument,
  window: {
    __ModuleLoader__: {
      load(next) {
        definition = next
      },
    },
  },
  navigator: {},
  performance: { now: () => 0 },
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  fetch: async () => ({ ok: false }),
  AudioContext: class {},
  btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
  Uint8Array,
  Float32Array,
  ArrayBuffer,
  DataView,
  Intl,
}

vm.runInNewContext(source, sandbox, { filename: 'lib/client.js' })
assert.ok(definition, 'client module definition was captured')

const client = definition.factory((name) => {
  if (name === 'react') return fakeReact
  throw new Error(`unexpected require: ${name}`)
})
assert.equal(typeof client.apply, 'function')
assert.equal(client.name, 'dsh-dafeiyu-emotion-client')

const registrations = []
const injected = []
let sidebarTab = null

const ctx = {
  slots: {
    inject(name, callback) {
      injected.push(name)
      callback()
    },
    register(spec, component) {
      registrations.push({ spec, component })
      return () => {}
    },
  },
  inject(dependencies, callback) {
    if (dependencies.includes('shortcuts')) {
      callback({
        effect(run) {
          run()
        },
        shortcuts: {
          register() {
            return () => {}
          },
        },
      })
      return
    }
    if (dependencies.includes('betterSidebar')) {
      callback({
        effect(run) {
          run()
        },
        betterSidebar: {
          registerTab(spec) {
            sidebarTab = spec
            return () => {}
          },
        },
      })
    }
  },
}

client.apply(ctx)

assert.ok(injected.includes('conversation.input.activity'), 'voice activity slot is injected')
assert.ok(injected.includes('plugins.bundle.config'), 'bundle config slot is injected')
assert.ok(injected.includes('settings.plugins.tab'), 'settings tab slot is injected')
assert.ok(injected.includes('settings.plugin.item'), 'settings item slot is injected')

const names = registrations.map((entry) => entry.spec.name)
assert.ok(names.includes('conversation.input.activity'))
assert.ok(names.includes('plugins.bundle.config'))
assert.ok(names.includes('settings.plugins.tab'))
assert.ok(names.includes('settings.plugin.item'))

for (const entry of registrations) {
  assert.equal(entry.spec.id, 'dsh-dafeiyu-emotion')
  assert.equal(typeof entry.component, 'function')
}

assert.ok(sidebarTab, 'betterSidebar tab is registered')
assert.equal(sidebarTab.id, 'dsh-dafeiyu-emotion:settings')
assert.equal(sidebarTab.single, true)
assert.equal(typeof sidebarTab.component, 'function')
assert.equal(typeof sidebarTab.title(), 'string')
assert.equal(typeof sidebarTab.description(), 'string')

console.log('client registration tests passed')

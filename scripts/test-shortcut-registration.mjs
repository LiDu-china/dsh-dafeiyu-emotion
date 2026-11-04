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
assert.ok(clientModule, 'client bundle should register through the module loader')

let registeredCommand
const shortcutScope = {
  effect(run) {
    return run()
  },
  shortcuts: {
    register(command) {
      registeredCommand = command
      return () => {}
    },
  },
}

const ctx = {
  effect() {},
  inject(dependencies, callback) {
    if (dependencies.includes('shortcuts')) callback(shortcutScope)
  },
  slots: {
    inject() {},
  },
}

clientModule.apply(ctx)

assert.equal(registeredCommand?.id, 'dafeiyu.emotion.voice')
assert.deepEqual(registeredCommand?.regions, ['page', 'editable'])
assert.deepEqual(registeredCommand?.modals, [])
assert.deepEqual(registeredCommand?.defaults['desktop:windows'], {
  code: 'KeyV',
  modifiers: ['alt'],
})
assert.deepEqual(registeredCommand?.defaults['web:windows'], {
  code: 'KeyV',
  modifiers: ['primary', 'alt'],
})
assert.deepEqual(registeredCommand?.resolve(), { status: 'pass' })

delete globalThis.window
console.log('shortcut registration ok')

import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

assert.equal(typeof pkg.icon, 'string', 'package.json must declare an icon')
const iconPath = resolve(root, pkg.icon)
const icon = statSync(iconPath)
assert.ok(icon.isFile(), `package icon does not exist: ${pkg.icon}`)
assert.ok(
  icon.size <= 256 * 1024,
  `package icon exceeds 256 KiB: ${icon.size} bytes (${pkg.icon})`,
)

console.log(`package metadata icon ok: ${icon.size} bytes`)

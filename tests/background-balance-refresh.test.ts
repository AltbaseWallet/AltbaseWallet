import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('incoming balance commit cannot wait forever for a hidden renderer frame', () => {
  const source = fs.readFileSync(path.join(root, 'src/store/coinStore.ts'), 'utf8')
  const helper = source.match(/const waitForRendererTick = \(\) =>[\s\S]*?\n\s*\}\)\n/)?.[0] ?? ''

  assert.match(helper, /requestAnimationFrame\(finish\)/)
  assert.match(helper, /setTimeout\(finish, 50\)/)
  assert.match(helper, /if \(settled\) return/)
})

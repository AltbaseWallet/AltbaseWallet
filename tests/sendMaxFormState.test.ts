import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const source = fs.readFileSync(new URL('../src/pages/Send/Send.tsx', import.meta.url), 'utf8')
const handleMax = source.match(/const handleMax = async \(\) => \{[\s\S]*?\n  const onSubmit =/)?.[0] ?? ''

test('every successful MAX branch clears stale amount errors before preserving MAX intent', () => {
  const valueThenClear = handleMax.match(
    /setValue\('amount', [^\n]+\)\s*\n\s*clearErrors\('amount'\)/g,
  ) ?? []
  const clearThenIntent = handleMax.match(
    /clearErrors\('amount'\)[\s\S]{0,400}?setMaxIntent\(/g,
  ) ?? []
  assert.equal(valueThenClear.length, 4)
  assert.equal(clearThenIntent.length, 4)
})

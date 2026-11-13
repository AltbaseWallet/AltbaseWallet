'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const braces = require('braces')
test('the vendored glob guard preserves ordinary expansion and rejects excessive AST nesting before recursion', () => {
  assert.equal(require('braces/package.json').version, '3.0.3+altbase.1')
  assert.deepEqual(braces.expand('src/{components,pages}/**/*.{ts,tsx}'), [
    'src/components/**/*.ts', 'src/components/**/*.tsx', 'src/pages/**/*.ts', 'src/pages/**/*.tsx',
  ])
  assert.equal(braces.compile('file-{1..3}.js'), 'file-([1-3]).js')
  assert.equal(braces.stringify(braces.parse('a/{b,c}/d')), 'a/{b,c}/d')
  // Small boundary fixtures, not an upstream crash reproduction.
  for (const [left, right] of [['{', '}'], ['(', ')']]) {
    assert.throws(() => braces.parse(left.repeat(65) + 'a,b' + right.repeat(65)), SyntaxError)
  }
  let ast = { type: 'text', value: 'x' }
  for (let i = 0; i < 66; i++) ast = { type: 'root', nodes: [ast] }
  for (const method of ['compile', 'expand', 'stringify']) assert.throws(() => braces[method](ast), SyntaxError)
  const cycle = { type: 'root', nodes: [] }; cycle.nodes.push(cycle)
  for (const method of ['compile', 'expand', 'stringify']) assert.throws(() => braces[method](cycle), SyntaxError)
})
test('patched Zod rejects oversized constrained collections before walking their elements', () => {
  const { z } = require('zod')
  for (const type of ['array', 'set', 'map']) {
    let visited = 0
    const item = z.string().superRefine(() => { visited++ })
    const schema = type === 'array' ? z.array(item).max(2) : type === 'set' ? z.set(item).max(2) : z.map(item, item).max(2)
    const values = Array.from({ length: 100 }, (_, i) => String(i))
    const input = type === 'array' ? values : type === 'set' ? new Set(values) : new Map(values.map(v => [v, v]))
    const result = schema.safeParse(input)
    assert.equal(result.success, false); assert.equal(result.error.issues.length, 1); assert.equal(visited, 0, type)
  }
})
test('the JoyID ABI schema API remains compatible with the pinned Zod override', () => {
  const path = require('node:path')
  const schema = require(require.resolve('abitype/zod', { paths: [path.dirname(require.resolve('@joyid/common'))] }))
  const abi = [
    { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
    { type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
    { type: 'function', name: 'tupleInput', stateMutability: 'view', inputs: [{ type: 'tuple[]', components: [{ type: 'bytes32' }, { type: 'uint64' }] }], outputs: [] },
    { type: 'event', name: 'Transfer', inputs: [{ name: 'from', type: 'address', indexed: true }] },
    { type: 'error', name: 'Failure', inputs: [{ type: 'string' }] },
    { type: 'fallback', stateMutability: 'payable' },
    { type: 'receive', stateMutability: 'payable' },
  ]
  assert.deepEqual(schema.Abi.parse(abi), abi)
  assert.equal(schema.Address.safeParse('0x' + '12'.repeat(20)).success, true)
  assert.equal(schema.Address.safeParse('invalid-address').success, false)
  assert.equal(schema.AbiParameter.safeParse({ type: 'uint257' }).success, false)
  assert.equal(schema.AbiParameter.safeParse({ type: 'tuple', components: [{ type: 'address' }] }).success, true)
})

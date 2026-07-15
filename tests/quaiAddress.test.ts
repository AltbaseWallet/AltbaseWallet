import assert from 'node:assert/strict'
import test from 'node:test'
import { isValidQuaiAddress } from '../src/utils/quaiAddress.ts'

test('wallet-derived Quai addresses remain valid recipients', () => {
  assert.equal(isValidQuaiAddress('0x002Da0B1D433097352d9d7A46ac94f245b1d97a3'), true)
  assert.equal(isValidQuaiAddress('0x00140968737E9137426d448C0b5fdcc24A84A28e'), true)
})

test('malformed Quai recipients are rejected locally', () => {
  assert.equal(isValidQuaiAddress('0x1234'), false)
  assert.equal(isValidQuaiAddress('not-an-address'), false)
})

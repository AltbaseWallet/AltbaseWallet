import assert from 'node:assert/strict'
import test from 'node:test'
import { withPreflightTimeout } from '../src/utils/preflightTimeout.ts'

test('MAX deadline accepts a slow response within the configured CKB budget', async t => {
  t.mock.timers.enable({apis:['setTimeout']})
  let finish!: (value: number) => void
  const pending = withPreflightTimeout(new Promise<number>(resolve => {finish=resolve}), 'MAX calculation', 180_000)
  t.mock.timers.tick(125_000)
  finish(42)
  assert.equal(await pending, 42)
})

test('MAX deadline settles a hung lookup and ignores its late result', async t => {
  t.mock.timers.enable({apis:['setTimeout']})
  let finish!: (value: number) => void
  const pending = withPreflightTimeout(new Promise<number>(resolve => {finish=resolve}), 'MAX calculation', 180_000)
  const rejected = assert.rejects(pending, /MAX calculation timed out/)
  t.mock.timers.tick(180_001)
  await rejected
  finish(42)
})

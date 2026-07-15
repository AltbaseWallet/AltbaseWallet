import assert from 'node:assert/strict'
import test from 'node:test'
import { hasLoadedHistoryPage } from '../src/utils/historyPagination.ts'

test('history pagination does not enter an empty page during background loading', () => {
  assert.equal(hasLoadedHistoryPage(12, 1, 12), false)
  assert.equal(hasLoadedHistoryPage(13, 1, 12), true)
  assert.equal(hasLoadedHistoryPage(24, 2, 12), false)
  assert.equal(hasLoadedHistoryPage(25, 2, 12), true)
})

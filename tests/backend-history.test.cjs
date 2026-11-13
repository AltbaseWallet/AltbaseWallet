'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const ts = require('typescript')
const source = fs.readFileSync(path.join(__dirname, '../src/services/coinApiService.ts'), 'utf8')
const start = source.indexOf('  async getAddressHistory(')
const end = source.indexOf('  async getAddressMempool(', start)
assert.ok(start > 0 && end > start)
const code = ts.transpileModule('module.exports = {' + source.slice(start, end) + '}', {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
function fixture(postJson) {
  const context = { module: { exports: {} }, postJson, isLocalWalletCoin: () => false,
    INTERACTIVE_BALANCE_TIMEOUT_MS: 1000, mapHistoryResponseToTransactions: history => history.txids }
  vm.runInNewContext(code, context)
  return context.module.exports
}
test('history read failures reject instead of replacing saved history with an empty list', async () => {
  const error = Error('Fixture network timeout')
  await assert.rejects(fixture(async () => { throw error }).getAddressHistory('bitcoin', 'fixture', 1e8), error)
})
test('partial history rejects while a verified empty history remains empty', async () => {
  await assert.rejects(fixture(async () => ({ partial: true, txids: ['a'] })).getAddressHistory('bitcoin', 'fixture', 1e8), /incomplete/)
  const rows = []
  assert.equal(await fixture(async () => ({ txids: rows })).getAddressHistory('bitcoin', 'fixture', 1e8), rows)
})
test('successful history still preserves returned rows', async () => {
  const rows = ['a', 'b']
  assert.equal(await fixture(async () => ({ txids: rows })).getAddressHistory('bitcoin', 'fixture', 1e8), rows)
})

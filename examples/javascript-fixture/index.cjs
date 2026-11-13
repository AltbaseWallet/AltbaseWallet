'use strict'
// Local fixture only: no network, transaction construction or cryptography.
const fs = require('node:fs'), path = require('node:path')
exports.createPlugin = async ({ dataDirectory }) => {
  const publicState = path.join(dataDirectory, 'fixture-public-state.json')
  let sends = fs.existsSync(publicState) ? JSON.parse(fs.readFileSync(publicState, 'utf8')).sends : 0
  const network = { ok: true, coin: 'fixture-javascript', chain: 'local-fixture', blocks: 100, headers: 100, initialBlockDownload: false }
  const balance = { balance: '125000000', balance_spendable: '125000000', received: '125000000', immature: '0' }
  return {
    async request(method, params) {
      if (params.testError) throw Error('Do not expose this input: ' + String(params.mnemonic))
      if (params.testCrash) process.exit(78)
      if (params.testTimeout) await new Promise(resolve => setTimeout(resolve, 30000))
      if (method === 'derive') return 'ALTBASE_JS_FIXTURE_ADDRESS'
      if (method === 'validate') return params.address === 'ALTBASE_JS_FIXTURE_ADDRESS'
      if (method === 'snapshot') return { coin: 'fixture-javascript', network, walletBalance: balance, balances: { ALTBASE_JS_FIXTURE_ADDRESS: balance }, histories: {} }
      if (method === 'estimateFee') return { satoshis: 50000, coin: '0.0005', exact: true }
      if (method === 'estimateMax') return { amountCoin: '1.2495', feeCoin: '0.0005', feeSatoshis: 50000 }
      if (method === 'nodeRequest' && params.path === '/network') return network
      if (method === 'send') {
        sends++
        fs.writeFileSync(publicState + '.tmp', JSON.stringify({ sends }))
        fs.renameSync(publicState + '.tmp', publicState)
        if (params.testFailAfterWrite) throw Error('Simulated uncertain send result')
        return { txid: `fixture-only-${sends}`, amountCoin: '1', feeCoin: '0.0005' }
      }
      throw Error('Unsupported fixture operation')
    },
  }
}

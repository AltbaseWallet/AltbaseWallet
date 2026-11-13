'use strict'
// Exercised from the shipped main process, with actual worker IPC and local
// image protocol. Uses only public burn/system addresses and read operations.
const assert = require('node:assert/strict')
const contracts = {
  ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', bsc: '0x55d398326f99059fF775485246999027B3197955',
  polygon: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', arbitrum: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  solana: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', tron: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
}
module.exports = async function verifyIcons(evaluate) {
  const rows = []
  for (const [coin, asset] of Object.entries(contracts)) {
    const owner = coin === 'solana' ? 'SysvarRent111111111111111111111111111111111' : coin === 'tron' ? 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb' : '0x000000000000000000000000000000000000dEaD'
    const response = await evaluate(`window.altbaseWallet.plugins.request(${JSON.stringify({ coin, method: 'importAsset', params: { owner, asset } })})`)
    console.log(JSON.stringify({ stage: 'packaged token import', coin, ipcOk: response.ok,
      importOk: response.ok && !response.result?.error, error: response.error || response.result?.error || null, code: response.result?.code || null }))
    assert.equal(response.ok, true, coin + ' IPC: ' + (response.error || 'no diagnostic')); assert.equal(response.result.error, undefined, coin + ' import')
    let token = response.result.tokens.find(t => t.id.toLowerCase() === asset.toLowerCase())
    // Images are independent of token verification; slow downloads must not
    // keep the balance/import IPC open. Poll the public inventory as the UI does.
    const deadline = Date.now() + 60000
    while (token?.icon?.status !== 'cached' && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      const inventory = await evaluate(`window.altbaseWallet.plugins.request(${JSON.stringify({ coin, method: 'assets', params: { owner } })})`)
      assert.equal(inventory.ok, true, coin + ' inventory IPC')
      token = inventory.result.tokens.find(t => t.id.toLowerCase() === asset.toLowerCase())
    }
    console.log(JSON.stringify({ stage: 'packaged token cache', coin, status: token?.icon?.status || 'absent' }))
    assert.equal(token?.icon?.status, 'cached', coin + ' cached logo')
    const rendered = await evaluate(`(async()=>{
      const urls=['altbase-coin://icons/${coin}','altbase-coin://tokens/${coin}/${token.icon.key}'];
      const container=document.createElement('div');container.dataset.iconCheck=${JSON.stringify(coin)};container.style.cssText='display:flex;gap:12px;padding:12px;background:#172030;color:white';
      const title=document.createElement('span');title.textContent=${JSON.stringify(coin+' '+token.symbol)};container.append(title);document.body.append(container);
      return Promise.all(urls.map(src=>new Promise(resolve=>{const img=document.createElement('img');img.width=64;img.height=64;img.onload=()=>resolve({src,width:img.naturalWidth,height:img.naturalHeight});img.onerror=()=>resolve({src,error:true});img.src=src;container.append(img)})));
    })()`)
    assert.ok(rendered.every(x => !x.error && x.width > 0 && x.height > 0), coin + ' actual image protocol')
    rows.push({ coin, asset, symbol: token.symbol, status: token.status, nativeLogo: rendered[0], tokenLogo: rendered[1] })
    console.log(JSON.stringify({ stage: 'packaged real icons', coin, passed: true }))
  }
  return { passed: true, realWorkerIpc: true, productionImageProtocol: true, noWalletPrivateInputs: true, transactions: 0, checks: rows }
}

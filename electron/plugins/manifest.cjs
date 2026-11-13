'use strict'
const fs = require('node:fs')
const path = require('node:path')
const METHODS = new Set(['derive', 'variants', 'validate', 'estimateFee', 'estimateMax', 'send', 'export', 'nodeRequest', 'snapshot', 'assets', 'importAsset', 'setAssetVisibility', 'prepareTransfer'])
const LEGACY_ENGINES = new Set(['bitcoin-utxo', 'pearl-utxo', 'zcash-utxo', 'nexa-utxo', 'xelis-local', 'mwc-local', 'zano-light', 'epic-light', 'monero-light', 'quai-account', 'xgr-account', 'qubic-account', 'kaspa-utxo', 'nonsense-utxo', 'ckb-cell'])
const ID = /^[a-z][a-z0-9-]{1,63}$/
const protectedName = value => /wallet[ _-]?secret/i.test(value)
function inside(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes('\\') || protectedName(relative)) throw Error('Invalid module resource path')
  const base = fs.realpathSync(root), target = fs.realpathSync(path.resolve(base, relative))
  if (protectedName(target)) throw Error('Protected source is not a module resource')
  if (!target.startsWith(base + path.sep)) throw Error('Module resource escapes its directory')
  if (!fs.statSync(target).isFile()) throw Error('Module resource is not a regular file')
  return target
}
function manifest(input, { legacy = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid module manifest')
  if (input.schemaVersion !== 1 || input.abiVersion !== 1) throw Error('Unsupported module ABI or manifest version')
  if (!ID.test(input.id || '') || protectedName(input.id)) throw Error('Invalid module ID')
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9]|constructor|prototype)$/i.test(input.id)) throw Error('Reserved module ID')
  if (!/^[A-Z0-9]{1,16}$/.test(input.ticker || '')) throw Error('Invalid module ticker')
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80) throw Error('Invalid module name')
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(input.version || '')) throw Error('Invalid module version')
  if (!['utxo', 'account', 'privacy', 'cell'].includes(input.kind)) throw Error('Invalid module kind')
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,127}$/.test(input.networkId || '')) throw Error('Invalid network ID')
  if (!Number.isInteger(input.decimals) || input.decimals < 0 || input.decimals > 18) throw Error('Invalid module decimals')
  if (!Array.isArray(input.capabilities) || input.capabilities.some(x => !METHODS.has(x)) || new Set(input.capabilities).size !== input.capabilities.length) throw Error('Invalid module capabilities')
  if (!legacy && !['derive', 'validate', 'snapshot', 'nodeRequest'].every(x => input.capabilities.includes(x))) throw Error('Module is missing required wallet capabilities')
  if (input.explorerUrl && (!/^https?:\/\//.test(input.explorerUrl) || new URL(input.explorerUrl).username || new URL(input.explorerUrl).password)) throw Error('Invalid explorer URL')
  if (input.iconDataUrl && (input.iconDataUrl.length > 384 * 1024 || !/^data:image\/(?:png|jpeg|webp|svg\+xml);base64,[a-zA-Z0-9+/=]+$/.test(input.iconDataUrl))) throw Error('Invalid embedded icon')
  let coin
  if (legacy) {
    if (input.runtime?.type !== 'legacy' || input.coin?.id !== input.id || input.coin.ticker !== input.ticker) throw Error('Invalid compatibility module')
    if (input.coin.walletEngine && !LEGACY_ENGINES.has(input.coin.walletEngine)) throw Error('Unsupported compatibility engine')
    if (typeof input.nativeRoute !== 'string' || input.nativeRoute.length > 80) throw Error('Invalid compatibility route')
    coin = { ...input.coin, balance: '0', address: '', status: 'preparing', enabled: true, favorite: false }
  } else {
    coin = { id: input.id, name: input.name, ticker: input.ticker, networkId: input.networkId,
      satsPerCoin: 10 ** input.decimals, walletEngine: 'plugin', supportsMemo: input.supportsMemo === true,
      explorerUrl: input.explorerUrl, balance: '0', address: '', status: 'preparing', enabled: true, favorite: false }
  }
  if (input.iconDataUrl) coin.iconUrl = input.iconDataUrl
  return { schemaVersion: 1, abiVersion: 1, id: input.id, name: input.name, ticker: input.ticker,
    version: input.version, kind: input.kind, networkId: input.networkId, decimals: input.decimals,
    capabilities: [...input.capabilities], testOnly: input.testOnly === true,
    coin, nativeRoute: legacy ? input.nativeRoute : `${input.id}-sdk`, runtimeType: legacy ? 'legacy' : 'plugin' }
}
module.exports = { manifest, inside, protectedName, METHODS }

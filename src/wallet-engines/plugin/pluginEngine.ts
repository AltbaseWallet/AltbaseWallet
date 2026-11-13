import type { WalletEngine } from '../types'
import type { Coin } from '../../types/coin'
import { pluginService } from '../../services/pluginService'
import { coinModuleRegistry } from '../../coin-modules'
import { pluginAddress, pluginBoolean, pluginAmount, pluginFee, pluginMax, pluginSendResult } from './pluginResults'
import { toBaseUnits } from '../../utils/decimalAmount'

const decimals = (coin: Coin) => coinModuleRegistry.descriptor(coin.id)?.decimals ?? 8

function request<T>(coin: Coin, method: string, params: Record<string, unknown> = {}): Promise<T> {
  const descriptor = coinModuleRegistry.descriptor(coin.id)
  if (!descriptor?.capabilities.includes(method)) return Promise.reject(new Error(`${coin.name} module does not support ${method}`))
  return pluginService.request<T>(coin.id, method, params)
}
export const pluginEngine: WalletEngine = {
  id: 'plugin',
  // Complete balances come from the plugin; legacy UTXO selection and privacy
  // scanning must not run on a newly installed, otherwise unknown chain.
  kind: 'account',
  deriveAddress: async (coin, mnemonic) => pluginAddress(await request(coin, 'derive', { mnemonic })),
  getAddressVariants: async (coin, address) => coinModuleRegistry.descriptor(coin.id)?.capabilities.includes('variants')
    ? request(coin, 'variants', { address })
    : [{ id: 'legacy', label: coin.ticker, address, scriptKind: 'account' }],
  validateAddress: async (coin, address) => pluginBoolean(await request(coin, 'validate', { address })),
  estimateFee: async (coin, options) => pluginFee(await request(coin, 'estimateFee', { ...options }), decimals(coin)),
  estimateMinimumFee: async (coin, options) => pluginFee(await request(coin, 'estimateFee', { ...options, minimum: true }), decimals(coin)),
  estimateMaxSend: async (coin, address, feeCoin, toAddress, mnemonic) => pluginMax(await request(coin, 'estimateMax', { address, feeCoin, toAddress, mnemonic }), decimals(coin)),
  send: async ({ coin, ...params }) => {
    const precision = decimals(coin)
    pluginAddress(params.toAddress)
    pluginAmount(params.amountCoin, precision)
    if (toBaseUnits(params.amountCoin, precision) <= 0n) throw new Error('Send amount must be positive')
    if (params.feeCoin !== undefined) pluginAmount(params.feeCoin, precision)
    if (params.maxFeeCoin !== undefined) pluginAmount(params.maxFeeCoin, precision)
    return pluginSendResult(await request(coin, 'send', params), precision)
  },
  exportSecret: (coin, mnemonic) => request(coin, 'export', { mnemonic }),
}

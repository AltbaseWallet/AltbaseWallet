import type { TranslationKey } from '../utils/i18n'

export type WalletLoadStepId =
  | 'password'
  | 'secureSeed'
  | 'addresses'
  | 'statuses'
  | 'balances'
  | 'privacy'
  | 'utxos'
  | 'history'
  | 'ready'

export type WalletLoadStepStatus = 'pending' | 'active' | 'done'

export type WalletLoadStep = {
  id: WalletLoadStepId
  labelKey: TranslationKey
  status: WalletLoadStepStatus
}

export type WalletLoadProgress = {
  activeId: WalletLoadStepId
  activeKey: TranslationKey
  steps: WalletLoadStep[]
}

export type WalletLoadProgressHandler = (progress: WalletLoadProgress) => void

const walletLoadStepOrder: WalletLoadStepId[] = [
  'password',
  'secureSeed',
  'addresses',
  'statuses',
  'balances',
  'privacy',
  'utxos',
  'history',
  'ready',
]

const walletLoadStepLabels: Record<WalletLoadStepId, TranslationKey> = {
  password: 'walletLoadPassword',
  secureSeed: 'walletLoadSecureSeed',
  addresses: 'walletLoadAddresses',
  statuses: 'walletLoadStatuses',
  balances: 'walletLoadBalances',
  privacy: 'walletLoadPrivacy',
  utxos: 'walletLoadUtxosFees',
  history: 'walletLoadHistory',
  ready: 'walletLoadReady',
}

export const buildWalletLoadProgress = (activeId: WalletLoadStepId): WalletLoadProgress => {
  const activeIndex = walletLoadStepOrder.indexOf(activeId)

  return {
    activeId,
    activeKey: walletLoadStepLabels[activeId],
    steps: walletLoadStepOrder.map((id, index) => ({
      id,
      labelKey: walletLoadStepLabels[id],
      status: index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'pending',
    })),
  }
}

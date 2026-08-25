import type { CoinStatus } from '../types/coin'

/**
 * Keep a verified, spend-capable privacy wallet visually active while a
 * background snapshot catches up. Real network failures and explicit
 * recovery/rescan transitions remain visible.
 */
export const preserveVerifiedPrivacyStatus = (
  currentStatus: CoinStatus,
  proposedStatus: CoinStatus,
  displayReady: boolean,
  recoveryPending: boolean,
): CoinStatus => {
  if (proposedStatus === 'maintenance' || proposedStatus === 'offline') return proposedStatus
  if (currentStatus === 'active' && displayReady && !recoveryPending) return 'active'
  return proposedStatus
}

type PrivacyRuntimeState = {
  status: CoinStatus
  balance: string
  spendableBalance?: string
  recoveryProgress?: unknown
  priceUsd?: number
  fiatValue?: number
}

/**
 * Reconcile a delayed async commit with the state that is already visible.
 * A startup/status request may have captured `syncing` before the native
 * wallet became ready and finish afterwards. In that case it must not put the
 * verified wallet (or its visible balance) back into the pending state.
 */
export const reconcileVerifiedPrivacyRuntime = <T extends PrivacyRuntimeState>(
  candidate: T,
  current: PrivacyRuntimeState,
  displayReady: boolean,
  recoveryPending: boolean,
): T => {
  const status = preserveVerifiedPrivacyStatus(
    current.status,
    candidate.status,
    displayReady,
    recoveryPending,
  )
  if (status === candidate.status) return candidate

  const balance = current.balance
  const balanceNumber = Number.parseFloat(balance || '0')
  const fiatValue = typeof candidate.priceUsd === 'number' && Number.isFinite(balanceNumber)
    ? candidate.priceUsd * balanceNumber
    : (current.fiatValue ?? candidate.fiatValue)

  return {
    ...candidate,
    status,
    balance,
    spendableBalance: current.spendableBalance,
    recoveryProgress: status === 'active' ? undefined : current.recoveryProgress,
    fiatValue,
  }
}

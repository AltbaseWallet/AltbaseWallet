import type { Transaction } from '../types/transaction'

/** These engines exclude recorded outpoints during native coin selection. */
export const canUseUnreservedUtxos = (tx: Transaction, engineId?: string) => {
  if (engineId !== 'bitcoin-utxo' && engineId !== 'pearl-utxo') return false
  const inputs = tx.spentOutpoints
  return Boolean(inputs?.length
    && inputs.every(input => /^[0-9a-f]{64}$/i.test(input.txid)
      && Number.isSafeInteger(input.vout) && input.vout >= 0)
    && new Set(inputs.map(input => `${input.txid.toLowerCase()}:${input.vout}`)).size === inputs.length)
}

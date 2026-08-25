export const shouldPreferUtxoTotal = (
  snapshotUnits: bigint | null,
  utxoUnits: bigint,
  hasServerPending = false,
) => {
  if (utxoUnits <= 0n) return false
  if (hasServerPending && snapshotUnits !== null && snapshotUnits > 0n) return false
  return snapshotUnits === null || utxoUnits > snapshotUnits
}

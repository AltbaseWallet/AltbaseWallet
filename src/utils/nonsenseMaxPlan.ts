// A sweep may exceed the network's transaction mass limit. Keep one transaction
// per approval and report the untouched inputs explicitly to the form.
export const planNonsenseMax = <E extends { amount: bigint }, P>(
  entries: E[],
  createSweep: (selected: E[]) => P,
) => {
  if (entries.length === 0) throw new Error('No spendable Nonsense UTXOs')
  const sorted = entries.map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.amount === b.entry.amount ? a.index - b.index : a.entry.amount > b.entry.amount ? -1 : 1)
    .map(({ entry }) => entry)
  const attempt = (count: number) => {
    try { return createSweep(sorted.slice(0, count)) } catch (error) {
      if (!String(error instanceof Error ? error.message : error).includes('too many UTXOs')) throw error
      return null
    }
  }
  let plan = attempt(sorted.length)
  let count = sorted.length
  if (plan === null) {
    // The sorted prefix with the largest inputs maximizes the amount within
    // the input-mass bound. Every accepted candidate is checked by the SDK.
    let low = 1
    let high = sorted.length - 1
    count = 0
    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      const candidate = attempt(middle)
      if (candidate === null) high = middle - 1
      else { plan = candidate; count = middle; low = middle + 1 }
    }
  }
  if (plan === null || count === 0) throw new Error('No Nonsense inputs fit in one transaction')
  return {
    plan,
    entries: sorted.slice(0, count),
    remainingInputCount: sorted.length - count,
    remainingAmount: sorted.slice(count).reduce((sum, entry) => sum + entry.amount, 0n),
  }
}

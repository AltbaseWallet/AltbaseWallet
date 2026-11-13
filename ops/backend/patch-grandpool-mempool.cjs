'use strict'
// Add complete pending reads to the existing deployed bundle without rebuilding
// or changing its cryptographic dependencies or broadcast implementations.
function patchGrandpoolMempool(source) {
  const replace = (before, after) => {
    if (source.split(before).length !== 2) throw Error('Unsupported adapter source layout')
    source = source.replace(before, after)
  }
  replace('history: (address) => call("blockchain.scripthash.get_history", [scriptHash(address)]),',
    'history: (address) => call("blockchain.scripthash.get_history", [scriptHash(address)]),\n\t\t\tmempool: (address) => call("blockchain.scripthash.get_mempool", [scriptHash(address)]),')
  replace('\t\t\tasync history(address, limit, offset) {', `\t\t\tasync mempool(address) {
                const state = await read("");
                if (state.blockbook?.inSyncMempool !== true) throw new Error("Remote mempool index is not verified");
                const result = await read("/address/" + encodeURIComponent(address) + "?details=txids&page=1&pageSize=1000");
                const count = result.unconfirmedTxs;
                if (!Number.isSafeInteger(count) || count < 0 || count > 1000) throw new Error("Remote pending transaction count is unavailable or too large");
                if (count === 0) return [];
                if (!Array.isArray(result.txids) || result.txids.length < count) throw new Error("Remote pending history is incomplete");
                return result.txids.slice(0, count).map(tx_hash => ({tx_hash, height: 0}));
            },
\t\t\tasync history(address, limit, offset) {`)
  const remoteStart = source.indexOf('const createRemoteUtxoAdapter = ')
  const remoteEnd = source.indexOf('//#endregion', remoteStart)
  if (remoteStart < 0 || remoteEnd < 0) throw Error('Remote adapter not found')
  let region = source.slice(remoteStart, remoteEnd)
  const edit = (a, b) => { if (region.split(a).length !== 2) throw Error('Unsupported remote adapter'); region = region.replace(a, b) }
  edit('async getHistory(address, { limit = 25, offset = 0 } = {}) {', 'async getHistory(address, { limit = 25, offset = 0, pendingOnly = false } = {}) {')
  edit('const history = await provider.history(address, limit, offset);', 'const history = pendingOnly ? await provider.mempool(address) : await provider.history(address, limit, offset);\n                if (pendingOnly && (!Array.isArray(history) || history.length > 1000)) throw new Error("Pending history is incomplete or too large");')
  edit('const rows = provider.blockbook ? history : history.slice().reverse().slice(offset, offset + limit);', 'const rows = pendingOnly || provider.blockbook ? history : history.slice().reverse().slice(offset, offset + limit);')
  edit('const tx = await transaction(row.tx_hash);\n\t\t\t\t\tconst ownScript', 'const tx = await transaction(row.tx_hash);\n                    if (pendingOnly && provider.blockbook && tx.confirmations !== 0) throw new Error("Pending index changed during verification");\n\t\t\t\t\tconst ownScript')
  edit('\t\t\tasync estimateFee(blocks = 6) {', `            async getMempool(address) {
                const history = await this.getHistory(address, {pendingOnly: true});
                const pending = history.mempool.filter(row => atoms(row.satoshis) < 0n).map(row => ({txid: row.txid, type: "outgoing", from: address, amount: coinText(-atoms(row.satoshis), decimals)}));
                return {address, hasPendingOutgoing: pending.length > 0, pending};
            },
\t\t\tasync estimateFee(blocks = 6) {`)
  source = source.slice(0, remoteStart) + region + source.slice(remoteEnd)
  const nexaStart = source.indexOf('const createNexaRemoteAdapter = ')
  const nexaEnd = source.indexOf('//#endregion', nexaStart)
  if (nexaStart < 0 || nexaEnd < 0) throw Error('Nexa adapter not found')
  region = source.slice(nexaStart, nexaEnd)
  edit('async getHistory(address, { limit = 25, offset = 0 } = {}) {', 'async getHistory(address, { limit = 25, offset = 0, pendingOnly = false } = {}) {')
  edit('const rows = history.slice().reverse().slice(offset, offset + limit), deltas = [];', 'if (pendingOnly && history.some(row => !Number.isSafeInteger(row.height))) throw new Error("Nexa pending history is incomplete");\n                const pendingRows = pendingOnly ? history.filter(row => row.height <= 0) : null;\n                if (pendingOnly && pendingRows.length > 1000) throw new Error("Nexa pending history is too large");\n                const rows = pendingOnly ? pendingRows : history.slice().reverse().slice(offset, offset + limit), deltas = [];')
  edit('\t\t\tasync estimateFee(blocks = 6) {', `            async getMempool(address) {
                const history = await this.getHistory(address, {pendingOnly: true});
                const pending = history.mempool.filter(row => atoms(row.satoshis) < 0n).map(row => ({txid: row.txid, type: "outgoing", from: address, amount: (-atoms(row.satoshis) / 100n).toString() + "." + (-atoms(row.satoshis) % 100n).toString().padStart(2, "0")}));
                return {address, hasPendingOutgoing: pending.length > 0, pending};
            },
\t\t\tasync estimateFee(blocks = 6) {`)
  return source.slice(0, nexaStart) + region + source.slice(nexaEnd)
}
module.exports = { patchGrandpoolMempool }

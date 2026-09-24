'use strict'

const { RpcError, httpRequest } = require('../lib/rpc.cjs')

const unsupportedWalletCall = (method) => {
  throw new RpcError(`Epic ${method} requires a local Epic wallet scanner`, { status: 501 })
}

const getJson = async (baseUrl, path) => {
  const response = await httpRequest(new URL(`${String(baseUrl).replace(/\/+$/, '')}${path}`), {
    method: 'GET',
    timeoutMs: 30_000,
  })

  let data
  try {
    data = JSON.parse(response.body || '{}')
  } catch {
    throw new RpcError(`Epic node returned non-JSON response (${response.status})`, { status: 502 })
  }

  if (response.status >= 400) {
    throw new RpcError(data.error || data.message || `Epic node HTTP ${response.status}`, { status: response.status })
  }
  return data
}

const createEpicNodeAdapter = ({ coin = 'epic', apiUrl }) => {
  if (!apiUrl) throw new Error(`epicNode adapter (${coin}): missing apiUrl`)

  return {
    coin,

    async getNetwork() {
      const status = await getJson(apiUrl, '/v1/status')
      const tip = status.tip ?? {}
      const height = Number(tip.height ?? 0)
      const syncInfo = status.sync_info ?? {}
      const currentHeight = Number(syncInfo.current_height ?? height)
      const highestHeight = Number(syncInfo.highest_height ?? height)
      const behindTip = highestHeight > 0 && currentHeight + 2 < highestHeight
      const syncing = behindTip || Boolean(status.sync_status && status.sync_status !== 'no_sync')
      return {
        coin,
        chain: 'main',
        blocks: height,
        headers: Math.max(height, highestHeight),
        bestBlockHash: tip.last_block_pushed,
        difficulty: tip.total_difficulty,
        initialBlockDownload: syncing,
        verificationProgress: syncing && highestHeight > 0 ? Math.max(0, Math.min(1, currentHeight / highestHeight)) : 1,
        connections: Number(status.connections ?? 0),
        version: status.protocol_version,
        subversion: status.user_agent,
        relayFee: 0,
        mempoolSize: undefined,
      }
    },

    async getBalance() {
      return unsupportedWalletCall('balance')
    },
    async getUtxos() {
      return unsupportedWalletCall('utxos')
    },
    async getHistory() {
      return unsupportedWalletCall('history')
    },
    async getMempool(address) {
      return { address, hasPendingOutgoing: false, pending: [] }
    },
    async broadcastTx() {
      return unsupportedWalletCall('broadcast')
    },
    async validateAddress(address) {
      const value = String(address || '').trim()
      return { isvalid: value.length > 20 }
    },
    async estimateFee() {
      return { coin, targetBlocks: 1, feerate: 0, relayFee: 0, source: 'epic-wallet' }
    },
    async getPrivacyScanInfo() {
      const network = await this.getNetwork()
      return {
        coin,
        chain: 'epic-mainnet',
        scanModel: 'local-mimblewimble-wallet-scan',
        nativeClient: 'altbase_epic_core',
        serverRole: 'node-status-relay-and-wallet-scan-source',
        blocks: network.blocks,
        headers: network.headers,
        bestBlockHash: network.bestBlockHash,
        ready: !network.initialBlockDownload,
        requiredClientWork: [
          'wallet-seed-derivation',
          'output-scanning',
          'slate-creation',
          'slate-finalization',
          'transaction-posting',
        ],
      }
    },
    async getPrivacyScanChunk({ fromHeight = 0, toHeight = 0 } = {}) {
      return {
        coin,
        fromHeight: Number(fromHeight) || 0,
        toHeight: Number(toHeight) || 0,
        outputs: [],
        ready: false,
        message: 'Epic compact output scan endpoint is not implemented on this server yet.',
      }
    },
    async broadcastPrivacyTx() {
      return unsupportedWalletCall('privacy broadcast')
    },
  }
}

module.exports = { createEpicNodeAdapter }

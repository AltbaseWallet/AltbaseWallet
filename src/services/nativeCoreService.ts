import type { AddressVariant, CoinCryptoParams } from '../types/crypto'

export type NativeAddressValidation = {
  isValid: boolean
  format?: string
  scriptKind?: string
  scriptPubKey?: string
  error?: string
}

export type NativeTransactionPlan = {
  amountSatoshis: bigint
  feeSatoshis: number
  inputCount: number
  selectedInputs: Array<{ txid: string; vout: number; satoshis: number; script: string }>
  outputs: Array<{ satoshis: bigint; script: string }>
}

export type NativeEncryptedSecret = {
  cipherText: string
  iv: string
  salt: string
}

export type NativeWalletSecret = {
  verifyHash: string
  verifySalt: string
  encryptedMnemonic: NativeEncryptedSecret
}

export type NativeWalletSecretOptions = {
  requireSeedSafetyAcknowledgement?: boolean
  seedSafetyAcknowledged?: boolean
}

export type NativePrivacyWalletSecret = {
  enginePassword: string
  scope: string
  seed: string
}

export type NativePrivacyLightWalletResponse = {
  ok: boolean
  address?: string
  balance?: string
  spendable?: string
  transactions?: unknown[]
  restoreStartHeight?: number
  lastScannedHeight?: number
  scanState?: string
  nativeWalletFileName?: string
  nativeWalletFileBlob?: string
  nativeWalletFileSize?: number
  txid?: string
  amount?: string
  fee?: string
  serverStatus?: string
  error?: string
  code?: string
}

export type NativePrivacyRecoveryProgress = {
  type: 'privacyRecovery'
  progressToken: string
  coin: 'zano' | 'epic'
  fromHeight: number
  currentHeight: number
  tipHeight: number
  totalBlocks: number
  scannedBlocks: number
  blocksRemaining: number
  percent: number
}

const isPrivacyRecoveryProgress = (value: unknown): value is NativePrivacyRecoveryProgress => {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<NativePrivacyRecoveryProgress>
  return item.type === 'privacyRecovery'
    && typeof item.progressToken === 'string'
    && (item.coin === 'zano' || item.coin === 'epic')
}

const parsePrivacyTransactions = (value?: string): unknown[] | undefined => {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) return parsed
    if (Array.isArray(parsed?.result?.transfers)) return parsed.result.transfers
    if (Array.isArray(parsed?.transfers)) return parsed.transfers
    return []
  } catch {
    return []
  }
}

const numericHeight = (...values: unknown[]) => {
  for (const value of values) {
    const height = Number(value ?? 0)
    if (Number.isFinite(height) && height > 0) return Math.floor(height)
  }
  return 0
}

const transactionTipHeight = (transactions: unknown[] | undefined) => {
  let best = 0
  for (const raw of transactions ?? []) {
    const tx = raw as { height?: unknown; blockHeight?: unknown; block_height?: unknown; tipHeight?: unknown; tip_height?: unknown }
    best = Math.max(best, numericHeight(tx.tipHeight, tx.tip_height, tx.height, tx.blockHeight, tx.block_height))
  }
  return best
}

const parsePrivacyScanHeight = (value?: string) => {
  if (!value) return 0
  try {
    const parsed = JSON.parse(value)
    const pi = parsed?.result?.pi ?? parsed?.pi
    const direct = numericHeight(
      parsed?.lastScannedHeight,
      parsed?.last_scanned_height,
      parsed?.indexedHeight,
      parsed?.indexed_height,
      parsed?.headers,
      parsed?.blocks,
      pi?.curent_height,
      pi?.current_height,
      pi?.height,
    )
    if (direct > 0) return direct
    return transactionTipHeight(parsePrivacyTransactions(value))
  } catch {
    return 0
  }
}

const parseAddressVariants = (value?: string): AddressVariant[] => {
  if (!value) return []
  return value.split('|').filter(Boolean).map((row) => {
    const [id, label, address, scriptKind, alias] = row.split(',')
    return {
      id: id as AddressVariant['id'],
      label,
      address,
      scriptKind: scriptKind as AddressVariant['scriptKind'],
      aliasOfLegacy: alias === 'true' ? true : undefined,
    }
  })
}

const encodeUtxos = (utxos: Array<{ txid: string; vout: number; satoshis: number; script: string }>) =>
  utxos.map((utxo) => `${utxo.txid}:${utxo.vout}:${utxo.satoshis}:${utxo.script}`).join('|')

const parseInputs = (value?: string): NativeTransactionPlan['selectedInputs'] =>
  (value ?? '').split('|').filter(Boolean).map((row) => {
    const [txid, vout, satoshis, script] = row.split(':')
    return { txid, vout: Number(vout), satoshis: Number(satoshis), script }
  })

const parseOutputs = (value?: string): NativeTransactionPlan['outputs'] =>
  (value ?? '').split('|').filter(Boolean).map((row) => {
    const [satoshis, script] = row.split(':')
    return { satoshis: BigInt(satoshis), script }
  })

export const nativeCoreService = {
  async health() {
    const bridge = window.altbaseWallet?.core
    if (!bridge) return { ok: false, error: 'Native core bridge is not available' }
    return bridge({ method: 'health', params: {} })
  },

  async listWalletModules(): Promise<{ utxo: string[]; privacy: string[]; account: string[]; node: string[] }> {
    const bridge = window.altbaseWallet?.core
    if (!bridge) throw new Error('Native core bridge is not available')
    const response = await bridge({ method: 'listWalletModules', params: {} })
    if (!response.ok || !response.result) throw new Error(response.error ?? 'Native module discovery failed')
    const parseList = (value?: string) => (value ?? '').split(',').map((item) => item.trim()).filter(Boolean)
    return {
      utxo: parseList(response.result.utxo),
      privacy: parseList(response.result.privacy),
      account: parseList(response.result.account),
      node: parseList(response.result.node),
    }
  },

  async coinNodeRequest(params: {
    coinId: string
    method: 'GET' | 'POST'
    path: string
    body?: string
    timeoutMs?: number
  }): Promise<{ status: number; body: string }> {
    const bridge = window.altbaseWallet?.core
    if (!bridge) throw new Error('Native core bridge is not available')
    const response = await bridge({
      method: 'coinNodeRequest',
      params: {
        coin: params.coinId,
        httpMethod: params.method,
        path: params.path,
        body: params.body ?? '',
        timeoutMs: String(params.timeoutMs ?? 10_000),
      },
    })
    if (!response.ok || !response.result) throw new Error(response.error ?? 'Native node request failed')
    return {
      status: Number(response.result.status ?? 0),
      body: response.result.body ?? '',
    }
  },

  async validateAddress(
    coinId: string,
    address: string,
    params: CoinCryptoParams,
  ): Promise<NativeAddressValidation> {
    const bridge = window.altbaseWallet?.core
    if (!bridge) return { isValid: false, error: 'Native core bridge is not available' }

    const response = await bridge({
      method: 'validateAddress',
      params: {
        coin: coinId,
        address,
        p2pkhPrefix: params.p2pkhPrefix,
        p2shPrefix: params.p2shPrefix,
        bech32Hrp: params.bech32Hrp,
        cashaddrPrefix: params.cashaddrPrefix,
        addressType: params.addressType,
      },
    })

    if (!response.ok) return { isValid: false, error: response.error ?? 'Native validation failed' }

    return {
      isValid: response.result?.isValid === 'true',
      format: response.result?.format,
      scriptKind: response.result?.scriptKind,
      scriptPubKey: response.result?.scriptPubKey,
      error: response.result?.error,
    }
  },

  async generateMnemonic(): Promise<string> {
    const bridge = window.altbaseWallet?.core
    if (!bridge) throw new Error('Native core bridge is not available')
    const response = await bridge({ method: 'generatePhrase', params: {} })
    const phrase = response.result?.phrase
    if (!response.ok || !phrase) {
      throw new Error(response.error ?? 'Native wallet phrase generation failed')
    }
    return phrase
  },

  async validateMnemonic(mnemonic: string): Promise<boolean> {
    const bridge = window.altbaseWallet?.core
    if (!bridge) return false
    const response = await bridge({ method: 'validatePhrase', params: { phrase: mnemonic } })
    return response.ok && response.result?.isValid === 'true'
  },

  async createWalletSecret(
    mnemonic: string,
    password: string,
    options: NativeWalletSecretOptions = {},
  ): Promise<NativeWalletSecret> {
    const bridge = window.altbaseWallet?.core
    if (!bridge) throw new Error('Native core bridge is not available')
    const response = await bridge({
      method: 'createWalletSecret',
      params: {
        phrase: mnemonic,
        password,
        requirePhraseAcknowledgement: options.requireSeedSafetyAcknowledgement ? 'true' : 'false',
        phraseAcknowledged: options.seedSafetyAcknowledged ? 'true' : 'false',
      },
    })
    const result = response.result
    if (!response.ok || !result?.verifyHash || !result.verifySalt || !result.cipherText || !result.iv || !result.salt) {
      throw new Error(response.error ?? 'Native wallet encryption failed')
    }
    return {
      verifyHash: result.verifyHash,
      verifySalt: result.verifySalt,
      encryptedMnemonic: {
        cipherText: result.cipherText,
        iv: result.iv,
        salt: result.salt,
      },
    }
  },

  async verifyWalletPassword(password: string, verifySalt: string, verifyHash: string): Promise<boolean> {
    const bridge = window.altbaseWallet?.core
    if (!bridge) return false
    const response = await bridge({
      method: 'verifyWalletPassword',
      params: { password, verifySalt, verifyHash },
    })
    return response.ok && response.result?.isValid === 'true'
  },

  async decryptWalletSecret(secret: NativeEncryptedSecret, password: string): Promise<string> {
    const bridge = window.altbaseWallet?.core
    if (!bridge) throw new Error('Native core bridge is not available')
    const response = await bridge({
      method: 'decryptWalletSecret',
      params: {
        password,
        cipherText: secret.cipherText,
        iv: secret.iv,
        salt: secret.salt,
      },
    })
    const phrase = response.result?.phrase
    if (!response.ok || !phrase) {
      throw new Error(response.error ?? 'Native wallet decryption failed')
    }
    return phrase
  },

  async privacyWalletSecret(coin: 'zano' | 'epic', mnemonic: string): Promise<NativePrivacyWalletSecret> {
    const bridge = window.altbaseWallet?.core
    if (!bridge) throw new Error('Native core bridge is not available')
    const response = await bridge({
      method: 'privacyScope',
      params: { coin, phrase: mnemonic },
    })
    const result = response.result
    if (!response.ok || !result?.enginePassword || !result.scope || !result.payload) {
      throw new Error(response.error ?? 'Native privacy scope derivation failed')
    }
    return {
      enginePassword: result.enginePassword,
      scope: result.scope,
      seed: result.payload,
    }
  },

  async privacyLightWallet(params: {
    action: 'ensure' | 'warm' | 'snapshot' | 'send'
    coin: 'zano' | 'epic'
    mnemonic?: string
    restoreStartHeight?: number | string
    restoreTimestamp?: string
    expectedSpendable?: string
    scanState?: string
    fastCompact?: string
    compactOnly?: string
    forceRescan?: string
    verifyCompact?: string
    cachedWalletName?: string
    cachedWalletState?: string
    to?: string
    amount?: string
    fee?: string
    sendMax?: string
    memo?: string
  }, onProgress?: (progress: NativePrivacyRecoveryProgress) => void): Promise<NativePrivacyLightWalletResponse> {
    const bridge = window.altbaseWallet?.core
    if (!bridge) {
      return { ok: false, code: 'native-core-unavailable', error: 'Native core bridge is not available' }
    }
    const progressToken = onProgress ? `privacy-${Date.now()}-${Math.random().toString(16).slice(2)}` : undefined
    const unsubscribe = progressToken
      ? window.altbaseWallet?.onCoreProgress?.((payload) => {
          if (!isPrivacyRecoveryProgress(payload) || payload.progressToken !== progressToken) return
          onProgress?.({
            ...payload,
            fromHeight: Number(payload.fromHeight) || 0,
            currentHeight: Number(payload.currentHeight) || 0,
            tipHeight: Number(payload.tipHeight) || 0,
            totalBlocks: Number(payload.totalBlocks) || 0,
            scannedBlocks: Number(payload.scannedBlocks) || 0,
            blocksRemaining: Number(payload.blocksRemaining) || 0,
            percent: Number(payload.percent) || 0,
          })
        })
      : undefined
    const { mnemonic, ...privacyParams } = params
    const nativeParams = progressToken
      ? { ...privacyParams, phrase: mnemonic, progressToken }
      : { ...privacyParams, phrase: mnemonic }
    const response = await bridge({
      method: 'privacyLightWallet',
      params: nativeParams,
    }).finally(() => unsubscribe?.())
    if (!response.ok || !response.result) {
      return { ok: false, code: 'native-core-error', error: response.error ?? 'Native privacy light wallet failed' }
    }
    const transactions = parsePrivacyTransactions(response.result.transactions)
    const explicitHeight = numericHeight(response.result.lastScannedHeight, response.result.last_scanned_height)
    const transactionHeight = parsePrivacyScanHeight(response.result.transactions)
    const nativeComplete = response.result.code === `${params.coin}-native-wallet`
    const serverHeight = nativeComplete ? parsePrivacyScanHeight(response.result.serverStatus) : 0
    return {
      ok: response.result.ok === 'true',
      code: response.result.code || undefined,
      error: response.result.error || undefined,
      address: response.result.address || undefined,
      balance: response.result.balance || undefined,
      spendable: response.result.spendable || undefined,
      txid: response.result.txid || undefined,
      amount: response.result.amount || undefined,
      fee: response.result.fee || undefined,
      serverStatus: response.result.serverStatus || undefined,
      transactions,
      scanState: response.result.scanState || undefined,
      nativeWalletFileName: response.result.nativeWalletFileName || undefined,
      nativeWalletFileBlob: response.result.nativeWalletFileBlob || undefined,
      nativeWalletFileSize: Number(response.result.nativeWalletFileSize || 0) || undefined,
      lastScannedHeight: explicitHeight || transactionHeight || serverHeight || undefined,
    }
  },

  async addressToScript(coinId: string, address: string, params: CoinCryptoParams): Promise<string> {
    const bridge = window.altbaseWallet?.core
    if (!bridge) throw new Error('Native core bridge is not available')

    const response = await bridge({
      method: 'addressToScript',
      params: {
        coin: coinId,
        address,
        p2pkhPrefix: params.p2pkhPrefix,
        p2shPrefix: params.p2shPrefix,
        bech32Hrp: params.bech32Hrp,
        cashaddrPrefix: params.cashaddrPrefix,
        addressType: params.addressType,
      },
    })

    if (!response.ok || !response.result?.scriptPubKey) {
      throw new Error(response.error ?? 'Native script conversion failed')
    }

    return response.result.scriptPubKey
  },

  async addressVariantsFromLegacy(coinId: string, address: string, params: CoinCryptoParams): Promise<AddressVariant[]> {
    const bridge = window.altbaseWallet?.core
    if (!bridge) throw new Error('Native core bridge is not available')

    const response = await bridge({
      method: 'addressVariantsFromLegacy',
      params: {
        coin: coinId,
        address,
        p2pkhPrefix: params.p2pkhPrefix,
        p2shPrefix: params.p2shPrefix,
        bech32Hrp: params.bech32Hrp,
        cashaddrPrefix: params.cashaddrPrefix,
        addressType: params.addressType,
      },
    })

    if (!response.ok) throw new Error(response.error ?? 'Native address variants failed')
    return parseAddressVariants(response.result?.variants)
  },

  async deriveAddress(coinId: string, mnemonic: string, params: CoinCryptoParams): Promise<string> {
    const bridge = window.altbaseWallet?.core
    if (!bridge) throw new Error('Native core bridge is not available')

    const response = await bridge({
      method: 'deriveAddress',
      params: {
        coin: coinId,
        phrase: mnemonic,
        derivationPath: params.derivationPath,
        p2pkhPrefix: params.p2pkhPrefix,
        wifPrefix: params.wifPrefix,
        bech32Hrp: params.bech32Hrp,
        addressType: params.addressType,
      },
    })

    if (!response.ok || !response.result?.address) {
      throw new Error(response.error ?? 'Native address derivation failed')
    }

    return response.result.address
  },

  async derivePrivateKeyWif(coinId: string, mnemonic: string, params: CoinCryptoParams): Promise<string> {
    const bridge = window.altbaseWallet?.core
    if (!bridge) throw new Error('Native core bridge is not available')

    const response = await bridge({
      method: 'deriveWif',
      params: {
        coin: coinId,
        phrase: mnemonic,
        derivationPath: params.derivationPath,
        p2pkhPrefix: params.p2pkhPrefix,
        wifPrefix: params.wifPrefix,
        bech32Hrp: params.bech32Hrp,
        addressType: params.addressType,
      },
    })

    const wif = response.result?.wif
    if (!response.ok || !wif) {
      throw new Error(response.error ?? 'Native export derivation failed')
    }

    return wif
  },

  async signTransaction(params: {
    coinId: string
    mnemonic: string
    cryptoParams: CoinCryptoParams
    inputs: Array<{ txid: string; vout: number; satoshis: number; script: string }>
    outputs: Array<{ satoshis: bigint; script: string }>
    txVersion?: number
  }): Promise<{ txHex: string; txid: string }> {
    const bridge = window.altbaseWallet?.core
    if (!bridge) throw new Error('Native core bridge is not available')

    const inputs = params.inputs
      .map((input) => `${input.txid}:${input.vout}:${input.satoshis}:${input.script}`)
      .join('|')
    const outputs = params.outputs
      .map((output) => `${output.satoshis.toString()}:${output.script}`)
      .join('|')

    const response = await bridge({
      method: 'signTransaction',
      params: {
        coin: params.coinId,
        phrase: params.mnemonic,
        derivationPath: params.cryptoParams.derivationPath,
        txVersion: String(params.txVersion ?? params.cryptoParams.txVersion ?? 1),
        sighashStyle: params.cryptoParams.sighashStyle ?? 'legacy',
        addressType: params.cryptoParams.addressType,
        inputs,
        outputs,
      },
    })

    if (!response.ok || !response.result?.txHex || !response.result.txid) {
      throw new Error(response.error ?? 'Native transaction signing failed')
    }

    return { txHex: response.result.txHex, txid: response.result.txid }
  },

  async estimateFee(params: {
    feeRatePerKb: number
    satsPerCoin: number
    nIn: number
    nOut: number
  }): Promise<number> {
    const bridge = window.altbaseWallet?.core
    if (!bridge) throw new Error('Native core bridge is not available')
    const response = await bridge({ method: 'estimateFee', params })
    if (!response.ok || !response.result?.feeSatoshis) {
      throw new Error(response.error ?? 'Native fee estimate failed')
    }
    return Number(response.result.feeSatoshis)
  },

  async planTransaction(params: {
    mode: 'send' | 'max'
    utxos: Array<{ txid: string; vout: number; satoshis: number; script: string }>
    satsPerCoin: number
    feeRatePerKb: number
    amountSats?: bigint
    manualFeeSats?: bigint
    toScript?: string
    changeScript?: string
  }): Promise<NativeTransactionPlan> {
    const bridge = window.altbaseWallet?.core
    if (!bridge) throw new Error('Native core bridge is not available')
    const response = await bridge({
      method: 'planTransaction',
      params: {
        mode: params.mode,
        utxos: encodeUtxos(params.utxos),
        satsPerCoin: params.satsPerCoin,
        feeRatePerKb: params.feeRatePerKb,
        amountSats: params.amountSats?.toString(),
        manualFeeSats: params.manualFeeSats?.toString(),
        toScript: params.toScript,
        changeScript: params.changeScript,
      },
    })
    if (!response.ok || !response.result) {
      throw new Error(response.error ?? 'Native transaction planning failed')
    }
    return {
      amountSatoshis: BigInt(response.result.amountSatoshis ?? '0'),
      feeSatoshis: Number(response.result.feeSatoshis ?? '0'),
      inputCount: Number(response.result.inputCount ?? '0'),
      selectedInputs: parseInputs(response.result.selectedInputs),
      outputs: parseOutputs(response.result.outputs),
    }
  },
}

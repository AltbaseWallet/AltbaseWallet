export type CoinCryptoParams = {
  p2pkhPrefix: number
  p2shPrefix: number
  wifPrefix: number
  derivationPath: string
  txVersion?: number
  sighashStyle?: 'legacy' | 'bip143-forkid' | 'taproot'
  cashaddrPrefix?: string
  bech32Hrp?: string
  addressType?: 'p2pkh' | 'p2wpkh' | 'p2tr'
}

export type AddressVariant = {
  id: 'legacy' | 'cashaddr' | 'cashaddr-plain' | 'bech32' | 'privacy' | 'account' | 'dag' | 'cell'
  label: string
  address: string
  scriptKind: 'p2pkh' | 'p2sh' | 'p2wpkh' | 'p2tr' | 'privacy' | 'account' | 'dag' | 'cell'
  aliasOfLegacy?: boolean
}

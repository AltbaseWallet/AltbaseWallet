import type { AddressVariant, CoinCryptoParams } from '../types/crypto'

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const CASH32 = BECH32
const CASHADDR_GENERATORS = [
  0x98f2bc8e61n,
  0x79b76d99e2n,
  0xf33e5fb3c4n,
  0xae2eabe2a8n,
  0x1e4f43e470n,
]

const doubleSha256 = async (bytes: Uint8Array) => {
  const input = Uint8Array.from(bytes).buffer as ArrayBuffer
  const first = await crypto.subtle.digest('SHA-256', input)
  const second = await crypto.subtle.digest('SHA-256', first)
  return new Uint8Array(second)
}

const base58Decode = (value: string) => {
  let num = 0n
  for (const char of value) {
    const digit = BASE58.indexOf(char)
    if (digit < 0) throw new Error('invalid base58 character')
    num = num * 58n + BigInt(digit)
  }

  const bytes: number[] = []
  while (num > 0n) {
    bytes.unshift(Number(num & 0xffn))
    num >>= 8n
  }
  for (const char of value) {
    if (char !== '1') break
    bytes.unshift(0)
  }
  return Uint8Array.from(bytes)
}

const base58Encode = (bytes: Uint8Array) => {
  let num = 0n
  for (const byte of bytes) num = (num << 8n) + BigInt(byte)
  let out = ''
  while (num > 0n) {
    const mod = Number(num % 58n)
    out = BASE58[mod] + out
    num /= 58n
  }
  for (const byte of bytes) {
    if (byte === 0) out = BASE58[0] + out
    else break
  }
  return out || BASE58[0]
}

const base58CheckPayload = async (address: string) => {
  const decoded = base58Decode(address)
  if (decoded.length < 5) throw new Error('address too short')
  const payload = decoded.slice(0, -4)
  const checksum = decoded.slice(-4)
  const expected = await doubleSha256(payload)
  for (let index = 0; index < 4; index += 1) {
    if (checksum[index] !== expected[index]) throw new Error('invalid base58 checksum')
  }
  return payload
}

const base58CheckAddress = async (version: number, hash: Uint8Array) => {
  const payload = Uint8Array.from([version, ...hash])
  const checksum = (await doubleSha256(payload)).slice(0, 4)
  return base58Encode(Uint8Array.from([...payload, ...checksum]))
}

const convertBits = (data: number[], fromBits: number, toBits: number, pad: boolean) => {
  let acc = 0
  let bits = 0
  const maxv = (1 << toBits) - 1
  const result: number[] = []

  for (const value of data) {
    if (value < 0 || value >> fromBits) throw new Error('invalid bit group')
    acc = (acc << fromBits) | value
    bits += fromBits
    while (bits >= toBits) {
      bits -= toBits
      result.push((acc >> bits) & maxv)
    }
  }

  if (pad) {
    if (bits > 0) result.push((acc << (toBits - bits)) & maxv)
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv) !== 0) {
    throw new Error('invalid padding')
  }
  return result
}

const bech32Polymod = (values: number[]) => {
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
  let chk = 1
  for (const value of values) {
    const top = chk >> 25
    chk = ((chk & 0x1ffffff) << 5) ^ value
    for (let index = 0; index < 5; index += 1) {
      if ((top >> index) & 1) chk ^= generators[index]
    }
  }
  return chk
}

const bech32HrpExpand = (hrp: string) => [
  ...Array.from(hrp, (char) => char.charCodeAt(0) >> 5),
  0,
  ...Array.from(hrp, (char) => char.charCodeAt(0) & 31),
]

const bech32Encode = (hrp: string, program: Uint8Array) => {
  const normalizedHrp = hrp.toLowerCase()
  const data = [0, ...convertBits(Array.from(program), 8, 5, true)]
  const polymod = bech32Polymod([...bech32HrpExpand(normalizedHrp), ...data, 0, 0, 0, 0, 0, 0]) ^ 1
  const checksum = Array.from({ length: 6 }, (_, index) => (polymod >> (5 * (5 - index))) & 31)
  return `${normalizedHrp}1${[...data, ...checksum].map((value) => BECH32[value]).join('')}`
}

const cashaddrPrefixExpand = (prefix: string) => [
  ...Array.from(prefix.toLowerCase(), (char) => char.charCodeAt(0) & 31),
  0,
]

const cashaddrPolymod = (values: number[]) => {
  let checksum = 1n
  for (const value of values) {
    const top = checksum >> 35n
    checksum = ((checksum & 0x07ffffffffn) << 5n) ^ BigInt(value)
    for (let index = 0; index < CASHADDR_GENERATORS.length; index += 1) {
      if (((top >> BigInt(index)) & 1n) !== 0n) checksum ^= CASHADDR_GENERATORS[index]
    }
  }
  return checksum ^ 1n
}

const cashaddrEncode = (prefix: string, type: 0 | 1, hash: Uint8Array) => {
  if (hash.length !== 20) throw new Error('unsupported cashaddr hash length')
  const normalizedPrefix = prefix.toLowerCase()
  const version = type << 3
  const payload = convertBits([version, ...Array.from(hash)], 8, 5, true)
  const checksumValue = cashaddrPolymod([...cashaddrPrefixExpand(normalizedPrefix), ...payload, 0, 0, 0, 0, 0, 0, 0, 0])
  const checksum = Array.from({ length: 8 }, (_, index) =>
    Number((checksumValue >> BigInt(5 * (7 - index))) & 31n),
  )
  return `${normalizedPrefix}:${[...payload, ...checksum].map((value) => CASH32[value]).join('')}`
}

const cashaddrDecode = (address: string, fallbackPrefix: string) => {
  const normalized = address.trim().toLowerCase()
  const parts = normalized.includes(':') ? normalized.split(':') : [fallbackPrefix.toLowerCase(), normalized]
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error('invalid cashaddr')
  const [prefix, payloadText] = parts
  const values = Array.from(payloadText, (char) => {
    const value = CASH32.indexOf(char)
    if (value < 0) throw new Error('invalid cashaddr character')
    return value
  })
  if (values.length < 9) throw new Error('cashaddr payload too short')
  if (cashaddrPolymod([...cashaddrPrefixExpand(prefix), ...values]) !== 0n) throw new Error('invalid cashaddr checksum')
  const decoded = Uint8Array.from(convertBits(values.slice(0, -8), 5, 8, false))
  const version = decoded[0]
  const type = version >> 3
  const hash = decoded.slice(1)
  if (hash.length !== 20) throw new Error('unsupported cashaddr hash length')
  return { prefix, type, hash }
}

export const addressVariantsFromLegacyAddress = async (
  address: string,
  params: CoinCryptoParams,
): Promise<AddressVariant[]> => {
  let version: number
  let hash: Uint8Array
  try {
    const payload = await base58CheckPayload(address.trim())
    if (payload.length !== 21) throw new Error('invalid legacy address')
    version = payload[0]
    if (version !== params.p2pkhPrefix && version !== params.p2shPrefix) throw new Error('wrong address prefix')
    hash = payload.slice(1)
  } catch (error) {
    if (!params.cashaddrPrefix) throw error
    const decoded = cashaddrDecode(address, params.cashaddrPrefix)
    if (decoded.prefix !== params.cashaddrPrefix || (decoded.type !== 0 && decoded.type !== 1)) throw error
    version = decoded.type === 1 ? params.p2shPrefix : params.p2pkhPrefix
    hash = decoded.hash
  }
  const scriptKind = version === params.p2shPrefix ? 'p2sh' : 'p2pkh'
  const legacyAddress = await base58CheckAddress(version, hash)
  const variants: AddressVariant[] = [{
    id: 'legacy',
    label: 'Legacy',
    address: legacyAddress,
    scriptKind,
  }]

  if (params.cashaddrPrefix) {
    const full = cashaddrEncode(params.cashaddrPrefix, version === params.p2shPrefix ? 1 : 0, hash)
    variants.push({
      id: 'cashaddr',
      label: 'CashAddr',
      address: full,
      scriptKind,
      aliasOfLegacy: true,
    })
  }

  if (params.bech32Hrp && version === params.p2pkhPrefix) {
    variants.push({
      id: 'bech32',
      label: 'Bech32',
      address: bech32Encode(params.bech32Hrp, hash),
      scriptKind: 'p2wpkh',
    })
  }

  return variants
}

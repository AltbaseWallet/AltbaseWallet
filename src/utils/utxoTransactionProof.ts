import { getBytes, hexlify, sha256 } from 'ethers'

export type ProvenTxOutput = { satoshis: bigint; script: string }

/** Read outputs only after binding the complete previous transaction to its txid. */
export const verifiedTransactionOutputs = (hex: string, expectedTxid: string): ProvenTxOutput[] => {
  if (!/^[0-9a-f]{64}$/i.test(expectedTxid) || !/^(?:[0-9a-f]{2})+$/i.test(hex) || hex.length > 8_000_000) {
    throw new Error('Invalid previous transaction proof')
  }
  const bytes = getBytes(`0x${hex}`)
  let offset = 4
  const take = (length: number) => {
    if (!Number.isSafeInteger(length) || length < 0 || offset + length > bytes.length) {
      throw new Error('Truncated previous transaction proof')
    }
    const value = bytes.slice(offset, offset + length)
    offset += length
    return value
  }
  const integer = (size: number) => {
    const value = take(size)
    return value.reduceRight((sum, byte) => (sum << 8n) | BigInt(byte), 0n)
  }
  const count = () => {
    const prefix = Number(integer(1))
    const value = prefix < 253 ? BigInt(prefix) : integer(prefix === 253 ? 2 : prefix === 254 ? 4 : 8)
    if (value > BigInt(bytes.length)) throw new Error('Invalid previous transaction length')
    return Number(value)
  }
  const witness = bytes[4] === 0 && bytes[5] === 1
  if (witness) offset = 6
  const inputs = count()
  if (inputs === 0) throw new Error('Previous transaction has no inputs')
  for (let i = 0; i < inputs; i += 1) {
    take(36)
    take(count())
    take(4)
  }
  const outputCount = count()
  const outputs: ProvenTxOutput[] = []
  for (let i = 0; i < outputCount; i += 1) {
    const satoshis = integer(8)
    outputs.push({ satoshis, script: hexlify(take(count())).slice(2) })
  }
  const witnessStart = offset
  if (witness) {
    for (let i = 0; i < inputs; i += 1) {
      const items = count()
      for (let j = 0; j < items; j += 1) take(count())
    }
  }
  const locktimeStart = offset
  take(4)
  // Some supported forks append an extra payload after locktime. It is part
  // of the txid too; retain it while removing only SegWit marker/witnesses.
  const committed = witness
    ? new Uint8Array([...bytes.slice(0, 4), ...bytes.slice(6, witnessStart), ...bytes.slice(locktimeStart)])
    : bytes
  const txid = hexlify(getBytes(sha256(sha256(committed))).reverse()).slice(2)
  if (txid.toLowerCase() !== expectedTxid.toLowerCase()) throw new Error('Previous transaction hash does not match the input')
  return outputs
}

export const assertProvenUtxo = (output: ProvenTxOutput | undefined, input: { satoshis: string | number | bigint; script: string }) => {
  if (!output || output.satoshis !== BigInt(input.satoshis) || output.script !== input.script.toLowerCase()) {
    throw new Error('The node returned an input amount or script that does not match its transaction')
  }
}

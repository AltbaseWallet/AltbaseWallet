import { QubicHelper } from '@qubic-lib/qubic-ts-library/dist/qubicHelper'
import qubicCrypto from '@qubic-lib/qubic-ts-library/dist/crypto'

const helper = new QubicHelper()

/** The SDK hashes the complete signed wire bytes before encoding the ID. */
export async function qubicTransactionId(signed: Uint8Array): Promise<string> {
  if (!(signed instanceof Uint8Array) || signed.length < 144 || signed.length > 1024 * 1024) throw new Error('Invalid Qubic transaction bytes')
  const { K12 } = await qubicCrypto
  const digest = new Uint8Array(32)
  K12(signed, digest, 32)
  return helper.getHumanReadableBytes(digest)
}

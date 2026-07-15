import assert from 'node:assert/strict'
import test from 'node:test'
import { ClientPublicMainnet, SignerCkbPrivateKey } from '@ckb-ccc/core'
import { QubicHelper } from '@qubic-lib/qubic-ts-library/dist/qubicHelper.js'
import { HDNodeWallet } from 'ethers'

const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const SECOND_TEST_MNEMONIC = 'legal winner thank year wave sausage worth useful legal winner thank yellow'

const qubicSeedFromMnemonic = async (mnemonic: string) => {
  const normalized = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ')
  const material = new TextEncoder().encode(`altbase-qubic-v1\0${normalized}`)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', material))
  let value = 0n
  for (const byte of digest) value = (value << 8n) | BigInt(byte)
  let seed = ''
  while (value > 0n) {
    seed = String.fromCharCode(97 + Number(value % 26n)) + seed
    value /= 26n
  }
  return seed.padStart(55, 'a').slice(-55)
}

test('Qubic wallet vector is deterministic and checksum-valid', async () => {
  const helper = new QubicHelper()
  const identity = (await helper.createIdPackage(await qubicSeedFromMnemonic(TEST_MNEMONIC))).publicId
  assert.equal(identity.length, 60)
  assert.equal(await helper.verifyIdentity(identity), true)
  assert.equal(identity, 'FTQVRHUXUUFEIBFRGUZQYAERYBDDUQVKRRPWFUJPDALHFVMNMDXISHDBDWIH')
  const secondIdentity = (await helper.createIdPackage(await qubicSeedFromMnemonic(SECOND_TEST_MNEMONIC))).publicId
  assert.equal(await helper.verifyIdentity(secondIdentity), true)
  assert.equal(secondIdentity, 'WOXSSXUDMPWMUDXHGVMHMPUSQFDATHRJABFFLPGVQFPWHCSHXRRWOXSFSKNM')
})

test('CKB wallet vector uses the standard mainnet BIP44 path', async () => {
  const privateKey = HDNodeWallet.fromPhrase(TEST_MNEMONIC, undefined, "m/44'/309'/0'/0/0").privateKey
  const signer = new SignerCkbPrivateKey(new ClientPublicMainnet(), privateKey)
  const address = (await signer.getRecommendedAddressObj()).toString()
  assert.equal(address, 'ckb1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqgedakp7g0hm0cdlq298xuyqpvl4ja0cfqhp5jft')
  const secondPrivateKey = HDNodeWallet.fromPhrase(SECOND_TEST_MNEMONIC, undefined, "m/44'/309'/0'/0/0").privateKey
  const secondSigner = new SignerCkbPrivateKey(new ClientPublicMainnet(), secondPrivateKey)
  assert.equal(
    (await secondSigner.getRecommendedAddressObj()).toString(),
    'ckb1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqg9n8sn6jglr3t2y9x83erg4nmcel7ju8ce2vyl0',
  )
})

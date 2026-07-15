import assert from 'node:assert/strict'
import test from 'node:test'
import { addressVariantsFromLegacyAddress, legacyAddressForNativeScript } from '../src/utils/addressVariants.ts'
import type { CoinCryptoParams } from '../src/types/crypto.ts'

const bch2Params: CoinCryptoParams = {
  p2pkhPrefix: 0,
  p2shPrefix: 5,
  wifPrefix: 128,
  derivationPath: "m/44'/145'/0'/0/0",
  sighashStyle: 'bip143-forkid',
  cashaddrPrefix: 'bitcoincashii',
}

test('BCH2 receive cashaddr converts into a native legacy script address', async () => {
  const cashaddr = 'bitcoincashii:qrvm8sh9cxp8e6mv7nyfpxxdff59hflv8vv47x8hke'
  const legacy = await legacyAddressForNativeScript(cashaddr, bch2Params)
  assert.match(legacy, /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/)

  const variants = await addressVariantsFromLegacyAddress(legacy, bch2Params)
  assert.equal(variants.find((variant) => variant.id === 'cashaddr')?.address, cashaddr)
})

test('BCH2 cashaddr with an invalid checksum is rejected', async () => {
  await assert.rejects(
    legacyAddressForNativeScript(
      'bitcoincashii:qrvm8sh9cxp8e6mv7nyfpxxdff59hflv8vv47x8hka',
      bch2Params,
    ),
    /checksum/i,
  )
})

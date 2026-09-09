'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const { pathToFileURL } = require('node:url')

const vendorRoot = path.resolve(__dirname, '../vendor/nonsense-wasm-v0.1.7')
let sdkPromise
const sdk = async () => {
  sdkPromise ??= Promise.all([
    import(pathToFileURL(path.join(vendorRoot, 'nonsense.js')).href),
    import(pathToFileURL(path.join(vendorRoot, 'nonsense_bg.base64.js')).href),
  ]).then(async ([walletSdk, embedded]) => {
    await walletSdk.default({ module_or_path: Uint8Array.from(Buffer.from(embedded.default, 'base64')) })
    return walletSdk
  })
  return sdkPromise
}

test('Nonsense wallet restore matches the official daemon first-address vector', async () => {
  const walletSdk = await sdk()
  const wallet = walletSdk.deriveNonsenseWallet(
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  )
  assert.equal(
    wallet.address,
    'nonsense:qr8jdslgp7k5jhcz2uq8fxnpdpr4hghth8kp32t693gmhtc2usvjgkj7su3c8',
  )
  assert.equal(walletSdk.validateNonsenseAddress(wallet.address), true)
  assert.equal(walletSdk.validateNonsenseAddress(wallet.address.replace('nonsense:', 'kaspa:')), false)
})

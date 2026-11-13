'use strict'
// Run with ELECTRON_RUN_AS_NODE=1 and the packaged Electron executable.
// Loads cryptography from app.asar, never a user wallet or source-tree dependency.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const crypto = require('node:crypto'), net = require('node:net'), { createRequire } = require('node:module')
const archive = path.join(path.dirname(process.execPath), 'resources/app.asar')
const appRequire = createRequire(path.join(archive, 'package.json'))
const root = path.resolve(__dirname, '..')
const fixture = name => JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/crypto', name + '.json'), 'utf8'))
const bytes = hex => Buffer.from(hex.replace(/^0x/, ''), 'hex')
const hex = data => Buffer.from(data).toString('hex')
const hash = data => crypto.createHash('sha256').update(data).digest('hex')
const rejectNetwork = () => { throw Error('Network access forbidden in packaged cryptography check') }
net.Socket.prototype.connect = rejectNetwork
globalThis.fetch = rejectNetwork
async function main() {
  const version = appRequire('./package.json').version
  assert.equal(version, require('../package.json').version)
  assert.equal(appRequire('elliptic/package.json').version, '6.6.1+altbase.1')
  const elliptic = appRequire('elliptic'), hashes = appRequire('hash.js')
  const rfc = fixture('rfc6979-nist')
  for (const v of rfc) {
    const ec = new elliptic.ec({ curve: elliptic.curves[v.curve], hash: hashes[v.hash] })
    const sig = ec.sign(crypto.createHash(v.hash).update(v.message).digest(), v.privateKey)
    assert.equal(sig.r.toString(16), BigInt('0x' + v.r).toString(16))
    assert.equal(sig.s.toString(16), BigInt('0x' + v.s).toString(16))
  }
  const p521 = new elliptic.ec({ curve: elliptic.curves.p521, hash: hashes.sha512 })
  for (const v of fixture('p521-leading-zero-baseline')) {
    const sig = p521.sign(bytes(v.digest), rfc.find(row => row.curve === 'p521').privateKey)
    assert.equal(sig.r.toString(16, 132) + sig.s.toString(16, 132), v.nobleSignature)
  }
  const u = appRequire('@bitgo/utxo-lib'), c = appRequire('@ckb-ccc/core')
  assert.equal(appRequire('@ckb-ccc/core/package.json').version, '1.16.1+altbase.1')
  const fallback = appRequire('secp256k1/elliptic')
  const native = appRequire('secp256k1/bindings')
  assert.equal(typeof native.publicKeyVerify, 'function')
  let nativeNonceVariants = 0
  const order = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141')
  for (const v of fixture('ecdsa').valid) {
    const message = bytes(v.m), key = bytes(v.d)
    assert.equal(hex(u.ecc.sign(message, key)), v.signature)
    const sig = await new c.SignerCkbPrivateKey({}, '0x' + v.d)._signMessage('0x' + v.m)
    assert.equal(sig, '0x' + v.signature + v.recoveryId.toString(16).padStart(2, '0'))
    assert.equal(hex(fallback.ecdsaSign(message, key).signature), v.signature)
    const nativeSignature = native.ecdsaSign(message, key).signature
    assert.equal(u.ecc.verify(message, native.publicKeyCreate(key), nativeSignature), true)
    if (hex(nativeSignature) !== v.signature) {
      // This bundled libsecp binding seeds its nonce with the unreduced digest.
      // Two published MAX-hash cases therefore differ, but remain valid ECDSA.
      // Prove that explicit bits2octets normalization explains the difference.
      const value = BigInt('0x' + v.m)
      assert.ok(value >= order)
      const reduced = bytes((value % order).toString(16).padStart(64, '0'))
      assert.equal(hex(native.ecdsaSign(reduced, key).signature), v.signature)
      nativeNonceVariants++
    }
  }
  const { p256 } = appRequire('@noble/curves/nist'), sha256 = data => crypto.createHash('sha256').update(data).digest()
  const key = bytes(rfc.find(v => v.curve === 'p256').privateKey), challenge = 'Altbase public offline fixture'
  const auth = Buffer.alloc(37), client = Buffer.from(JSON.stringify({ challenge: Buffer.from(challenge).toString('base64url') }))
  const publicKey = hex(p256.getPublicKey(key, false).subarray(1))
  const identity = JSON.stringify({ publicKey, keyType: 'main_key' })
  const envelope = { message: Buffer.concat([auth, client]).toString('base64url'), alg: -7,
    signature: Buffer.from(p256.sign(sha256(Buffer.concat([auth, sha256(client)])), key).toDERRawBytes()).toString('base64url') }
  const verifyJoyId = (message, fields, who = identity) => c.Signer.verifyMessage(message,
    { signType: c.SignerSignType.JoyId, signature: JSON.stringify(fields), identity: who })
  assert.equal(await verifyJoyId(challenge, envelope), true)
  assert.equal(await verifyJoyId('wrong caller challenge', { ...envelope, challenge }), false)
  const otherIdentity = JSON.stringify({ publicKey: hex(p256.getPublicKey(bytes('02'.padStart(64, '0')), false).subarray(1)), keyType: 'main_key' })
  assert.equal(await verifyJoyId(challenge, { ...envelope, pubkey: publicKey }, otherIdentity), false)
  const sdkHashes = {}
  const sdkDirectory = path.join(path.dirname(process.execPath), 'resources/coin-plugins')
  for (const coin of ['zcash', 'nexa']) {
    const shipped = fs.readFileSync(path.join(sdkDirectory, coin, 'runtime.cjs'))
    assert.equal(hash(shipped), hash(fs.readFileSync(path.join(root, 'electron/coin-sdks', coin + '.cjs'))))
    assert.ok(shipped.includes(Buffer.from('drbg.generate(this.n.byteLength());')))
    assert.ok(!/new BN\w*\(drbg.generate\(this.n.byteLength\(\)\)\)/.test(shipped.toString()))
    sdkHashes[coin] = hash(shipped)
  }
  const { entropyToMnemonic } = appRequire('@scure/bip39'), { wordlist } = appRequire('@scure/bip39/wordlists/english')
  const mnemonic = entropyToMnemonic(new Uint8Array(16), wordlist)
  const z = require(path.join(sdkDirectory, 'zcash/runtime.cjs')), n = appRequire('libnexa-ts'), nx = require(path.join(sdkDirectory, 'nexa/runtime.cjs'))
  const from = z.derive({ mnemonic }).address, address = nx.derive({ mnemonic }).address
  const zcash = z.sign({ mnemonic, fromAddress: from, toAddress: from, amountCoin: '0.001', height: 3428143,
    utxos: [{ txid: '11'.repeat(32), outputIndex: 0, satoshis: 1000000, script: hex(u.address.toOutputScript(from, u.networks.zcash)) }] })
  const nexa = nx.sign({ mnemonic, fromAddress: address, toAddress: address, amountCoin: '100', feeRate: 3,
    utxos: [{ outpoint: '00'.repeat(32), satoshis: 100000, script: n.ScriptFactory.buildOutFromAddress(n.Address.fromString(address)).toHex() }] })
  // Only fingerprints of fabricated signatures are emitted, no phrases or keys.
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), version, platform: process.platform, arch: process.arch,
    ellipticVersion: '6.6.1+altbase.1', rfcVectors: rfc.length, nonceRegressions: 3,
    cccVersion: '1.16.1+altbase.1', joyIdCallerMessageAndIdentityBound: true,
    ecdsaVectorsPerImplementation: fixture('ecdsa').valid.length, implementations: ['BitGo', 'CKB CCC', 'secp JS fallback', 'native secp binding'],
    nativeNonceVariants, nativeSignaturesIndependentlyVerified: fixture('ecdsa').valid.length,
    sdkHashes, fixtureTransactionHashes: { zcash: hash(bytes(zcash.hex)), nexa: hash(bytes(nexa.hex)) },
    networkBlocked: true, userProfilesUsed: false, passed: true }, null, 2))
}
main().catch(error => { console.error(error); process.exitCode = 1 })

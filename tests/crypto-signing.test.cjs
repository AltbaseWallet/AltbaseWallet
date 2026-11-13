'use strict'
// Public standard vectors and fabricated, nonexistent inputs only. No profile access.
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module')
const crypto = require('node:crypto'), net = require('node:net')
const elliptic = require('elliptic'), hash = require('hash.js')
const { secp256k1 } = require('@noble/curves/secp256k1')
const { p256, p521 } = require('@noble/curves/nist')
const u = require('@bitgo/utxo-lib'), c = require('@ckb-ccc/core'), n = require('libnexa-ts')
const NervosECPair = require('@nervosnetwork/ckb-sdk-utils').ECPair
const fixture = name => require(`./fixtures/crypto/${name}.json`)
const vectors = fixture('ecdsa'), rfc = fixture('rfc6979-nist')
const bytes = hex => Buffer.from(hex.replace(/^0x/, ''), 'hex')
const hex = value => Buffer.from(value).toString('hex')
const digest = (algorithm, message) => crypto.createHash(algorithm).update(message).digest()
const compact = (sig, size = 64) => sig.r.toString(16, size) + sig.s.toString(16, size)
const rejectNetwork = () => { throw Error('Network access is forbidden in offline signing tests') }
const originalConnect = net.Socket.prototype.connect, originalFetch = globalThis.fetch
net.Socket.prototype.connect = rejectNetwork
globalThis.fetch = rejectNetwork
after(() => { net.Socket.prototype.connect = originalConnect; globalThis.fetch = originalFetch })

test('elliptic matches all 50 RFC 6979 NIST prime-curve signatures', () => {
  for (const v of rfc) {
    const ec = new elliptic.ec({ curve: elliptic.curves[v.curve], hash: hash[v.hash] })
    const sig = ec.sign(digest(v.hash, v.message), v.privateKey)
    assert.equal(sig.r.toString(16), BigInt('0x' + v.r).toString(16), `${v.curve}/${v.hash}/${v.message}: r`)
    assert.equal(sig.s.toString(16), BigInt('0x' + v.s).toString(16), `${v.curve}/${v.hash}/${v.message}: s`)
    assert.equal(ec.verify(digest(v.hash, v.message), sig, ec.keyFromPrivate(v.privateKey)), true)
  }
})

test('the advisory reference issue P-224/SHA-256 invalid signature is rejected by elliptic and OpenSSL', () => {
  const v = fixture('elliptic-issue-321'), message = bytes(v.msg)
  const ec = new elliptic.ec('p224'), h = digest('sha256', message)
  assert.equal(h[0], 0, 'reference case has a leading-zero digest')
  assert.equal(ec.verify(h, bytes(v.sig), v.publicKeyUncompressed, 'hex'), false)
  // SPKI: id-ecPublicKey + secp224r1 OID + uncompressed reference public key.
  const key = crypto.createPublicKey({ key: bytes('304e301006072a8648ce3d020106052b81040021033a00' + v.publicKeyUncompressed), format: 'der', type: 'spki' })
  assert.equal(crypto.verify('sha256', message, key, bytes(v.sig)), false)
})

test('P-521 leading-zero nonce regressions reproduce upstream failure and match independent Noble after patch', () => {
  const filename = require.resolve('elliptic/lib/elliptic/ec/index.js')
  const patched = fs.readFileSync(filename, 'utf8')
  assert.equal(patched.split('drbg.generate(this.n.byteLength());').length, 2)
  const old = new Module(filename, module)
  old.filename = filename; old.paths = Module._nodeModulePaths(path.dirname(filename))
  old._compile(patched.replace('drbg.generate(this.n.byteLength());', 'new BN(drbg.generate(this.n.byteLength()));'), filename)
  const ec = new elliptic.ec({ curve: elliptic.curves.p521, hash: hash.sha512 })
  const previous = new old.exports({ curve: elliptic.curves.p521, hash: hash.sha512 })
  const key = bytes(rfc.find(v => v.curve === 'p521').privateKey.padStart(132, '0'))
  for (const v of fixture('p521-leading-zero-baseline')) {
    const message = digest('sha512', v.message)
    assert.equal(hex(message), v.digest)
    const expected = p521.sign(message, key, { lowS: false }).toCompactHex()
    assert.equal(expected, v.nobleSignature)
    assert.equal(previous.sign(message, key).toDER('hex'), v.oldSignature)
    assert.notEqual(compact(previous.sign(message, key), 132), expected)
    assert.equal(compact(ec.sign(message, key), 132), expected)
    // The original signature is mathematically valid; this test proves a nonce
    // derivation discrepancy, not private-key recovery or invalid signatures.
    assert.equal(p521.verify(bytes(v.oldSignature), message, p521.getPublicKey(key), { lowS: false }), true)
  }
})

test('2020 BitcoinJS secp256k1 vectors remain byte-identical through elliptic, BitGo and legacy Nervos', () => {
  const ec = new elliptic.ec('secp256k1')
  for (const [i, v] of vectors.valid.entries()) {
    const h = bytes(v.m), d = bytes(v.d), expected = v.signature.toLowerCase()
    const sig = ec.sign(h, d, { canonical: true })
    assert.equal(compact(sig), expected, `elliptic vector ${i}`)
    assert.equal(sig.recoveryParam, v.recoveryId, `elliptic recovery ${i}`)
    assert.equal(hex(u.ecc.sign(h, d)), expected, `BitGo vector ${i}`)
    assert.equal(new NervosECPair(d).signRecoverable(h), '0x' + expected + v.recoveryId.toString(16).padStart(2, '0'), `Nervos vector ${i}`)
    assert.equal(secp256k1.verify(bytes(expected), h, secp256k1.getPublicKey(d)), true, `independent verify ${i}`)
  }
})

test('2020 CKB CCC signatures retain low-S, compact serialization and final recovery byte', async () => {
  for (const [i, v] of vectors.valid.entries()) {
    const signer = new c.SignerCkbPrivateKey({}, '0x' + v.d)
    const signature = await signer._signMessage('0x' + v.m)
    assert.equal(signature, '0x' + v.signature.toLowerCase() + v.recoveryId.toString(16).padStart(2, '0'), `CKB vector ${i}`)
    assert.equal(c.recoverMessageSecp256k1('0x' + v.m, signature), signer.publicKey, `CKB recovery ${i}`)
  }
})

test('BitGo rejects the four published invalid private-key signing vectors', () => {
  for (const v of vectors.invalid.sign) assert.throws(() => u.ecc.sign(bytes(v.m), bytes(v.d)))
})

test('the transitive secp256k1 JS fallback matches all 2020 standard signatures and rejects invalid keys', () => {
  const fallback = require('secp256k1/elliptic')
  for (const [i, v] of vectors.valid.entries()) {
    const result = fallback.ecdsaSign(bytes(v.m), bytes(v.d))
    assert.equal(hex(result.signature), v.signature, `JS fallback ${i}`)
    assert.equal(result.recid, v.recoveryId)
  }
  for (const v of vectors.invalid.sign) assert.throws(() => fallback.ecdsaSign(bytes(v.m), bytes(v.d)))
})

test('BIP32 standard vectors, including leading zeros, agree across BitGo, Nexa and ethers', () => {
  const { HDNodeWallet } = require('ethers')
  const base58check = require('@scure/base').base58check(data => digest('sha256', data))
  for (const v of fixture('bip32')) {
    const seed = bytes(v.seedHex)
    const bitgo = u.bip32.fromSeed(seed), nexa = n.HDPrivateKey.fromSeed(seed, 'mainnet'), ckb = HDNodeWallet.fromSeed(seed)
    for (const chain of v.chains) {
      const a = chain.path === 'm' ? bitgo : bitgo.derivePath(chain.path)
      const b = chain.path === 'm' ? nexa : nexa.deriveChild(chain.path)
      const e = chain.path === 'm' ? ckb : ckb.derivePath(chain.path)
      assert.equal(a.toBase58(), chain.private, `${v.name}/${chain.path}/BitGo`)
      assert.equal(a.neutered().toBase58(), chain.public)
      // Nexa uses different network version bytes; compare all BIP32 payload
      // bytes after the four-byte network prefix, not Bitcoin's xprv spelling.
      assert.deepEqual(base58check.decode(b.toString()).subarray(4), base58check.decode(chain.private).subarray(4), `${v.name}/${chain.path}/Nexa`)
      assert.deepEqual(base58check.decode(b.xpubkey).subarray(4), base58check.decode(chain.public).subarray(4))
      assert.equal(e.extendedKey, chain.private, `${v.name}/${chain.path}/ethers`)
      assert.equal(e.neuter().extendedKey, chain.public)
    }
  }
})

// Independent test verifier for the BCH/Nexa algorithm, NOT BIP340. Production
// continues to use libnexa-ts; no new cryptographic implementation is shipped.
function verifyBchSchnorr(message, signature, publicKey) {
  try {
    if (signature.length !== 64 || message.length !== 32) return false
    const P = secp256k1.ProjectivePoint.fromHex(publicKey), field = secp256k1.CURVE.Fp.ORDER, order = secp256k1.CURVE.n
    const r = BigInt('0x' + hex(signature.subarray(0, 32))), s = BigInt('0x' + hex(signature.subarray(32)))
    if (r >= field || s >= order) return false
    const e = BigInt('0x' + hex(digest('sha256', Buffer.concat([signature.subarray(0, 32), Buffer.from(P.toRawBytes(true)), message])))) % order
    const R = secp256k1.ProjectivePoint.BASE.multiplyUnsafe(s).subtract(P.multiplyUnsafe(e))
    if (R.equals(secp256k1.ProjectivePoint.ZERO)) return false
    const { x, y } = R.toAffine()
    let result = 1n, base = y, exponent = (field - 1n) / 2n
    while (exponent) { if (exponent & 1n) result = result * base % field; base = base * base % field; exponent >>= 1n }
    return x === r && result === 1n
  } catch { return false }
}

test('Nexa and independent verifier accept/reject all 12 BCH Schnorr standard vectors', () => {
  for (const v of fixture('bch-schnorr')) {
    let actual = false
    try { actual = n.Schnorr.verify(bytes(v.message), n.Signature.fromString(v.signature), n.PublicKey.fromString(v.publicKey), 'big') } catch { /* invalid curve points must fail */ }
    assert.equal(actual, v.valid, v.name)
    assert.equal(verifyBchSchnorr(bytes(v.message), bytes(v.signature), bytes(v.publicKey)), v.valid, 'independent ' + v.name)
  }
})

test('Nexa preserves zero-padded Schnorr r and little-endian transaction hash semantics', () => {
  const v = fixture('nexa-padding'), message = digest('sha256', v.message)
  const key = n.PrivateKey.from(bytes(v.privateKey), 'mainnet')
  const sig = n.Schnorr.sign(message, key, 'big')
  assert.equal(hex(sig.toBuffer(true)), v.signature)
  assert.equal(hex(n.Schnorr.sign(Buffer.from(message).reverse(), key, 'little').toBuffer(true)), v.signature)
  assert.equal(verifyBchSchnorr(message, bytes(v.signature), bytes(key.publicKey.toString())), true)
  const corrupt = bytes(v.signature); corrupt[63] ^= 1
  assert.equal(verifyBchSchnorr(message, corrupt, bytes(key.publicKey.toString())), false)
})

async function withoutEllipticSign(callback) {
  const saved = elliptic.ec.prototype.sign
  elliptic.ec.prototype.sign = () => { throw Error('Unexpected elliptic ECDSA signing path') }
  try { return await callback() } finally { elliptic.ec.prototype.sign = saved }
}

function bundleWithEcdsaDisabled(coin) {
  const filename = path.resolve(__dirname, `../electron/coin-sdks/${coin}.cjs`)
  const code = fs.readFileSync(filename, 'utf8')
  assert.ok(code.includes('drbg.generate(this.n.byteLength());'), 'bundled nonce correction')
  assert.ok(!/new BN\w*\(drbg.generate\(this.n.byteLength\(\)\)\)/.test(code), 'no old bundled nonce expression')
  const marker = 'EC.prototype.sign = function sign(msg, key, enc, options) {'
  assert.equal(code.split(marker).length, 2, 'exactly one bundled elliptic ECDSA entry point')
  const instrumented = new Module(filename, module)
  instrumented.filename = filename; instrumented.paths = Module._nodeModulePaths(path.dirname(filename))
  instrumented._compile(code.replace(marker, marker + '\nthrow Error("Bundled elliptic ECDSA reached");'), filename)
  return instrumented.exports
}

test('actual Zcash and Nexa runtime sign calls are offline and do not invoke elliptic ECDSA', async () => withoutEllipticSign(async () => {
  const { entropyToMnemonic } = require('@scure/bip39'), { wordlist } = require('@scure/bip39/wordlists/english')
  // Public all-zero test entropy; phrase exists only in process memory.
  const mnemonic = entropyToMnemonic(new Uint8Array(16), wordlist)
  const z = require('../modules/zcash/runtime/index.cjs'), nexa = require('../modules/nexa/runtime/index.cjs')
  let bitgoCalls = 0, nexaCalls = 0
  const bitgoSign = u.ecc.sign, nexaSign = n.Schnorr.sign
  u.ecc.sign = (...args) => { bitgoCalls++; return bitgoSign(...args) }
  n.Schnorr.sign = function (message, key, endian) {
    nexaCalls++
    const signature = nexaSign.call(this, message, key, endian)
    const h = endian === 'little' ? Buffer.from(message).reverse() : Buffer.from(message)
    assert.equal(verifyBchSchnorr(h, Buffer.from(signature.toBuffer(true)), bytes(key.publicKey.toString())), true)
    return signature
  }
  try {
    const fromAddress = z.derive({ mnemonic }).address
    const script = u.address.toOutputScript(fromAddress, u.networks.zcash)
    const zp = { mnemonic, fromAddress, toAddress: fromAddress, amountCoin: '0.001', height: 3428143,
      utxos: [{ txid: '11'.repeat(32), outputIndex: 0, satoshis: 1000000, script: hex(script) }] }
    const result = z.sign(zp)
    const tx = u.bitgo.createTransactionFromHex(result.hex, u.networks.zcash)
    const [signature, pubkey] = u.script.decompile(tx.ins[0].script)
    const raw = u.script.signature.decode(signature).signature
    const message = require('../modules/zcash/runtime/zip244.cjs').signatureDigest(tx, 0, [{ value: 1000000n, script }])
    assert.equal(secp256k1.verify(raw, message, pubkey), true)
    assert.equal(require('../electron/coin-sdks/zcash.cjs').sign(zp).hex, result.hex, 'bundled Zcash output')
    assert.equal(bundleWithEcdsaDisabled('zcash').sign(zp).hex, result.hex, 'bundled Zcash elliptic reachability')
    const address = nexa.derive({ mnemonic }).address
    const np = { mnemonic, fromAddress: address, toAddress: address, amountCoin: '100', feeRate: 3,
      utxos: [{ outpoint: '00'.repeat(32), satoshis: 100000, script: n.ScriptFactory.buildOutFromAddress(n.Address.fromString(address)).toHex() }] }
    const ns = nexa.sign(np)
    assert.match(ns.hex, /^[0-9a-f]+$/)
    assert.equal(require('../electron/coin-sdks/nexa.cjs').sign(np).hex, ns.hex, 'bundled Nexa output')
    assert.equal(bundleWithEcdsaDisabled('nexa').sign(np).hex, ns.hex, 'bundled Nexa elliptic reachability')
    assert.equal(bitgoCalls, 1, 'one BitGo Noble ECDSA call')
    assert.equal(nexaCalls, 1, 'one Nexa Schnorr call')
  } finally { u.ecc.sign = bitgoSign; n.Schnorr.sign = nexaSign }
}))

test('CKB signOnlyTransaction signs a synthetic cached cell with elliptic ECDSA disabled', async () => withoutEllipticSign(async () => {
  const client = new c.ClientPublicMainnet({ url: 'http://127.0.0.1:1', fallbacks: [] })
  const signer = new c.SignerCkbPrivateKey(client, '0x' + vectors.valid[0].d)
  const { script } = await signer.getAddressObjSecp256k1()
  const outPoint = { txHash: '0x' + '00'.repeat(32), index: 0 }
  const cell = c.Cell.from({ outPoint, cellOutput: { capacity: 10000000000n, lock: script }, outputData: '0x' })
  await client.cache.recordCells([cell])
  const tx = c.Transaction.from({ inputs: [{ previousOutput: outPoint }], outputs: [{ capacity: 9999990000n, lock: script }], outputsData: ['0x'] })
  await tx.prepareSighashAllWitness(script, 65, client)
  const info = await tx.getSignHashInfo(script, client)
  assert.equal(info.position, 0)
  const originalHash = tx.hash()
  const signed = await signer.signOnlyTransaction(tx)
  const signature = signed.getWitnessArgsAt(0).lock
  assert.equal(bytes(signature).length, 65)
  assert.equal(signed.hash(), originalHash)
  assert.equal(c.recoverMessageSecp256k1(info.message, signature), signer.publicKey)
  assert.equal(secp256k1.verify(bytes(signature).subarray(0, 64), bytes(info.message), bytes(signer.publicKey)), true)
}))

test('JoyID verifies WebAuthn ES256 offline and rejects wrong challenge/signature with elliptic ECDSA disabled', async () => withoutEllipticSign(async () => {
  const joy = require('@joyid/ckb'), { SigningAlg } = require('@joyid/common')
  const key = bytes(rfc.find(v => v.curve === 'p256').privateKey)
  const challenge = 'Altbase public offline fixture', auth = Buffer.alloc(37)
  const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: Buffer.from(challenge).toString('base64url'), origin: 'https://fixture.invalid' }))
  const base = Buffer.concat([auth, digest('sha256', clientData)])
  const signature = p256.sign(digest('sha256', base), key).toDERRawBytes()
  const data = { message: Buffer.concat([auth, clientData]).toString('base64url'), signature: Buffer.from(signature).toString('base64url'),
    pubkey: hex(p256.getPublicKey(key, false).subarray(1)), challenge, alg: SigningAlg.ES256, keyType: 'main_key' }
  assert.equal(await joy.verifySignature(data), true)
  assert.equal(await joy.verifySignature({ ...data, keyType: 'sub_key' }), true)
  assert.equal(await joy.verifySignature({ ...data, challenge: 'wrong challenge' }), false)
  const corrupted = Buffer.from(signature); corrupted[corrupted.length - 1] ^= 1
  assert.equal(await joy.verifySignature({ ...data, signature: corrupted.toString('base64url') }), false)
  // CCC's generic verifier must bind to its caller's message and identity.
  // Signature JSON is untrusted even when the embedded WebAuthn signature is valid.
  const identity = JSON.stringify({ publicKey: data.pubkey, keyType: data.keyType })
  const otherKey = hex(p256.getPublicKey(bytes('02'.padStart(64, '0')), false).subarray(1))
  const otherIdentity = JSON.stringify({ publicKey: otherKey, keyType: data.keyType })
  const envelope = { message: data.message, signature: data.signature, alg: data.alg }
  for (const sdk of [c, await import('@ckb-ccc/core')]) {
    const verify = (message, signature, who = identity) => sdk.Signer.verifyMessage(message,
      { signType: sdk.SignerSignType.JoyId, signature: JSON.stringify(signature), identity: who })
    assert.equal(await verify(challenge, envelope), true)
    assert.equal(await verify('wrong caller challenge', { ...envelope, challenge }), false, 'signature cannot replace caller challenge')
    assert.equal(await verify(challenge, { ...envelope, pubkey: data.pubkey }, otherIdentity), false, 'signature cannot replace caller public key')
    assert.equal(await verify(challenge, { ...envelope, challenge: 'untrusted override', pubkey: otherKey }), true, 'caller values take precedence')
  }
}))

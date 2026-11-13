# Altbase FullNode 0.1.2 — cryptographic audit follow-up

This completes the elliptic and BitGo/CKB/JoyID/Nexa investigation left open in
the [0.1.1 audit](AUDIT-2026-09-24.md). Two reproducible dependency defects were
corrected locally, signature compatibility was checked offline, and the affected
Linux and Windows applications were rebuilt. Nothing was published.

Exact final UTC verification times, artifact hashes and results are recorded in
[summary.json](verification/crypto-0.1.2/summary.json). All compilation took place
on Linux, pinned to one CPU with serial worker limits. The original Altbase
project, existing profiles and scans were not modified. Protected wallet source
and its copies were not opened. No real transaction was signed, sent or confirmed.

## Confirmed defects and corrections

### elliptic: generated nonce loses its original octet length

The exact affected expression was
`new BN(drbg.generate(this.n.byteLength()))` in
`elliptic/lib/elliptic/ec/index.js`, inside `EC.prototype.sign`, immediately before
`this._truncateToN(k, true)`. Converting to a BN removes leading zero bytes before
RFC 6979 `bits2int` can determine the correct shift. For P-521, the generated
66-byte nonce must be shifted by seven bits even when the first byte is zero.
Three deterministic public-test-key cases reproduced a disagreement with Noble.
Their original signatures still verified mathematically: the experiment does
**not** establish private-key recovery or an invalid signature on an Altbase chain.

The local `elliptic@6.6.1+altbase.1` keeps the generated octet array until the
existing `_truncateToN` array branch processes it. Custom `options.k`, point
arithmetic, DER encoding and recovery APIs are unchanged. The original npm
tarball's integrity was verified; comparison of all 15 library files found only
this one runtime expression changed. [Exact patch](verification/crypto-0.1.2/elliptic.patch),
[dependency provenance](verification/crypto-0.1.2/dependency-changes.json).

All 50 RFC 6979 prime-curve examples pass, as do the three independently computed
P-521 regressions. The suite reconstructs the original expression and reproduces
the original discrepancies before checking the correction. The P-224/SHA-256
invalid signature from upstream issue 321 is rejected by both elliptic and
OpenSSL; message-array length handling for that older example was already present
in 6.6.1. [RFC 6979](https://www.rfc-editor.org/rfc/rfc6979.html),
[upstream issue 321](https://github.com/indutny/elliptic/issues/321).

### CCC/JoyID: signature JSON overrides the caller's verification context

`@ckb-ccc/core/src/signer/ckb/verifyJoyId.ts::verifyMessageJoyId` passed trusted
`challenge`, `pubkey` and `keyType` first, then spread `JSON.parse(signature)`
over them. An offline ES256 fixture was accepted even when the caller supplied
both a different expected message and a different public key, because the
signature envelope replaced those values. [Baseline reproduction](verification/crypto-0.1.2/joyid-baseline.json).

The local `@ckb-ccc/core@1.16.1+altbase.1` assigns parsed signature fields first
and caller-derived fields last. The correction is applied to the source and the
published CommonJS/ESM distributions; source-map embedded source content is
updated. Both entry points now accept valid envelopes and reject replacement of
the expected challenge or identity. CKB signing math and transaction serialization
are unchanged. [Exact source patch](verification/crypto-0.1.2/ccc-joyid.patch),
[tarball provenance](verification/crypto-0.1.2/ccc-patch-provenance.json).

The current wallet does **not** call this generic JoyID message verifier. This is
a reproduced dependency verification-boundary defect, not a claim of an exposed
Altbase login or spending route. No vulnerability report was sent externally.

### Build process: SDK bundles must follow dependency changes

`npm run build` now regenerates `electron/coin-sdks` before TypeScript/Vite.
Previously those checked-in bundles could retain old dependencies after an
installation or update. The standalone SDK build command now also selects one
CPU. Source, regenerated SDKs and packaged SDK hashes are checked together.

Only the project root, elliptic and CCC entries changed in `package-lock.json`;
all other dependency entries remain identical to the pre-audit lockfile. Both
local tarballs and their source are in `vendor/`. They are reproducible local
patches with explicit build metadata, not claimed upstream releases.

## Reachability from the wallet

| Path | Actual primitive / exact call | elliptic ECDSA reachability and evidence |
| --- | --- | --- |
| BitGo / Zcash | Registry → `sdkUtxoEngine` → `coinSdk` IPC → `modules/zcash/runtime/index.cjs::sign` → `key.sign(signatureDigest(...))` → `@bitgo/secp256k1` `ecc.sign` → Noble `signSync` | The active transaction path does not call elliptic ECDSA. A fabricated transaction signs and independently verifies with elliptic `EC.sign` set to throw. The generated SDK passes the same test with its internal elliptic function instrumented to throw. |
| BitGo's transitive message helper | `bip32utils.signMessage` → `bitcoinjs-message` → native `secp256k1` or its elliptic fallback | Present as an exported dependency helper, not called by the wallet's Zcash engine. The JS fallback is tested explicitly against all 2,020 ECDSA vectors; native interoperability is checked in both packaged runtimes. |
| CKB transaction signing | `src/services/ckbWalletService.ts::send` → `SignerCkbPrivateKey.signOnlyTransaction` → `_signMessage` → `signMessageSecp256k1` → Noble secp256k1 `sign(..., {format:'recovered', prehash:false})` | No elliptic ECDSA call. The real CCC signer signs a fabricated cached cell with networking blocked and elliptic signing disabled; the 65-byte witness signature independently verifies and recovers the expected public key. |
| JoyID verification | CCC `Signer.verifyMessage`, only for `SignerSignType.JoyId`, → `verifyMessageJoyId` → `@joyid/ckb.verifySignature` → WebCrypto P-256 / RSA verification | No source application call to `Signer.verifyMessage` or JoyID was found. The offline ES256 envelope succeeds with elliptic signing disabled; tampered signatures and wrong challenges fail. Caller-context override tests cover both CCC distributions. JoyID popup/hardware signing is not an enabled wallet path. |
| Legacy Nervos ECPair | `@nervosnetwork/ckb-sdk-utils` `ECPair.sign` / `signRecoverable` → elliptic secp256k1 `key.sign(...,{canonical:true})` | This exact elliptic ECDSA call exists transitively, but neither the CCC private-key transaction signer nor JoyID's verification path calls it. Its recoverable signatures match all 2,020 standard vectors after the patch. |
| Nexa | `modules/nexa/runtime/index.cjs::sign` → `TransactionBuilder.sign` → `TxSigner.sign` → `Schnorr.sign(hashbuf,key,'little')` | Uses libnexa-ts BCH/Nexa Schnorr, its own domain-separated RFC 6979 nonce function and elliptic **point arithmetic**. It does not call elliptic ECDSA nonce generation. Source and generated SDK transactions still sign when elliptic ECDSA is disabled. |

The P-521 failure is not reproduced by the wallet's 32-byte secp256k1 signing
paths: removing leading zero bytes cannot introduce a positive truncation shift
for this byte-aligned order. Nexa's custom nonce inputs are explicitly padded to
32 bytes and include its Schnorr domain separator. Replacing its signer with
Noble's BIP340 implementation would change the protocol. The compatible point
API is retained and tested against the actual BCH/Nexa algorithm.
[Nexa Schnorr specification](https://spec.nexa.org/forks/2019-05-15-schnorr/).

## Verification and evidence

- **75 project tests passed, zero failures/skips**, including 13 cryptographic
  test groups and the previous 62 wallet/module regressions.
  [Test log](verification/crypto-0.1.2/tests.log),
  [test source](../tests/crypto-signing.test.cjs).
- **2,020 secp256k1 standard vectors** match expected deterministic signature
  bytes through elliptic, BitGo, legacy Nervos, the secp JS fallback and CCC.
  Recovery IDs, CCC's final recovery byte, low-S behavior and four invalid
  private-key inputs are covered. Independent Noble verification is included.
- **17 BIP32 derivations** cover all paths of vectors 1–4, including leading
  zeros, across BitGo, Nexa and ethers (used by CKB). Nexa's network prefix is
  accounted for explicitly; the remaining extended-key payload is compared.
- **12 official BCH Schnorr vectors**, five valid and seven invalid, agree in
  Nexa and an independent test verifier based on Noble point arithmetic. Nexa's
  official leading-zero signature vector and little-endian transaction-hash
  convention also pass. This does not substitute BIP340 for BCH Schnorr.
- Fake Zcash/Nexa transactions, a cached CKB cell and JoyID WebAuthn envelopes
  exercise the real dependency calls with network sockets/fetch blocked. These
  are local protocol fixtures, not claims of live consensus acceptance. Public
  standard scalars and all-zero test entropy are used; no user wallet is loaded.
- The shipped Linux and Windows Electron runtimes load dependencies **from
  `app.asar`** and repeat all 50 RFC vectors, three nonce regressions, 2,020
  vectors through BitGo/CCC/JS fallback, and native secp verification. They also
  check the JoyID correction and sign the same fabricated SDK inputs. SDK and
  fake-transaction fingerprints match across platforms.
  [Linux](verification/crypto-0.1.2/packaged-linux-crypto.json),
  [Windows/Wine](verification/crypto-0.1.2/packaged-windows-crypto.json).
- **Native secp detail:** two published MAX-hash vectors produce different
  deterministic bytes because the bundled native implementation seeds its nonce
  with the unreduced digest. All 2,020 signatures independently verify; explicit
  reduction of those two hashes reproduces the standard expected signatures.
  These are valid nonce variants in the unused native message-helper route,
  not an observed BitGo wallet-signing failure. No native binary was changed.
- TypeScript/Vite production build passed. ESLint checked **207 files, zero
  errors/warnings**. The existing large-chunk build warning remains.
  [Build log](verification/crypto-0.1.2/build.log),
  [lint summary](verification/crypto-0.1.2/lint-summary.json).
- Linux GUI and packaged application checks passed: module discovery, balance,
  fee/MAX and preserving an unavailable balance as unverified. Windows EXE under
  Wine passed DLL discovery/update without rebuilding the wallet, bad ABI
  rejection and preserving the test scan marker. GUI transfer confirmations
  were never pressed. [Linux GUI](verification/crypto-0.1.2/gui-result.json),
  [packaged Linux](verification/crypto-0.1.2/packaged-linux-result.json),
  [Windows](verification/crypto-0.1.2/windows-result.json).
- **79 Windows PE binaries** validated; 70 staged compatibility resources match
  their recorded release hashes. The native secp binding loads directly.
  [Package evidence](verification/crypto-0.1.2/windows-package-check.json).

Fixture provenance, pinned upstream commits, hashes and licensing notices are in
[tests/fixtures/crypto](../tests/fixtures/crypto/README.md). Source inputs for this
delivery are identified by [SHA-256 manifest](verification/crypto-0.1.2/source-inputs.sha256).

## Current deliverables and explicit limits

- Linux x64: `artifacts/linux-unpacked/altbase-fullnode`, with its full directory.
- Windows x64: `artifacts/Altbase-FullNode-Windows-x64-v0.1.2.zip`, containing the
  full portable application. ZIP CRC and every archived file hash were checked.
  [ZIP metadata](verification/crypto-0.1.2/windows-zip.json).
- Checksums: `artifacts/SHA256SUMS` and the machine-readable summary.

`npm audit --omit=dev` still reports **nine low entries, zero moderate/high/critical**
rooted in GHSA-848j-6mx2-7j84. The upstream advisory lists no patched release;
semver build metadata intentionally does not disguise the dependency's identity.
The scanner does not recognize this local source correction. This is an explicit
scanner limitation, not a claim that no compatible fix could be made.
[Current npm report](verification/crypto-0.1.2/dependencies.json),
[GitHub advisory](https://github.com/advisories/GHSA-848j-6mx2-7j84).

Native Windows desktop validation remains externally blocked because the user
confirmed the Windows machine is powered off. Wine checks the actual EXE but
does not certify native drivers, desktop integration or all filesystem behavior.
macOS remains unbuilt: matching staged compatibility runtimes and a macOS test
environment are absent. The protected native source remains outside this audit;
no claim is made about unseen native signing implementations or all 33 live chains.
All prior operating-system sandbox and trusted-module boundaries still apply.

Reproduce the main checks sequentially:

```sh
npm test
npm run build
npm run dist:linux
npm run dist:win
node scripts/verify-windows-package.cjs
ELECTRON_RUN_AS_NODE=1 taskset -c 0 artifacts/linux-unpacked/altbase-fullnode scripts/qa-packaged-crypto.cjs
xvfb-run -a node_modules/.bin/electron --no-sandbox scripts/qa-plugin-gui.cjs
xvfb-run -a node scripts/qa-packaged-smoke.cjs
xvfb-run -a -s '-screen 0 1440x1000x24' node scripts/qa-windows-app.cjs
```

The Windows cryptographic check runs the same `qa-packaged-crypto.cjs` with the
packaged Windows EXE, `ELECTRON_RUN_AS_NODE=1` and the isolated Wine prefix created
by the Windows GUI check. It does not use the default Wine prefix or a real profile.

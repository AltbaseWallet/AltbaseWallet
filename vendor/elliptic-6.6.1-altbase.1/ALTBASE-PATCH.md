# Local RFC 6979 correction

Upstream: elliptic 6.6.1, MIT license. Local package version: `6.6.1+altbase.1` (build metadata, not an upstream release).

In `lib/elliptic/ec/index.js`, the generated nonce remains an octet array until `_truncateToN` performs RFC 6979 `bits2int`. Constructing a BN first discards leading zero bytes, so `msg.byteLength()` no longer represents the generated bit string. This causes deterministic-signature mismatches for P-521. The existing `_truncateToN` array branch already preserves the correct length; no new cryptographic algorithm is introduced. User-supplied `options.k` retains its existing behavior.

Only that generated-nonce argument changes. The secp256k1 paths used by Altbase have a byte-aligned 256-bit order and 32-byte digests. Their expected signatures must remain byte-for-byte identical. Tests also cover non-byte-aligned P-521 and the complete RFC 6979 prime-curve examples.

Sources: [RFC 6979 §2.3.2 and §3.2](https://www.rfc-editor.org/rfc/rfc6979.html), [GHSA-848j-6mx2-7j84](https://github.com/advisories/GHSA-848j-6mx2-7j84), [upstream issue](https://github.com/indutny/elliptic/issues/321).

The original upstream version remains recognizable to dependency auditing. Do not claim that an npm advisory disappeared simply because this local fix is installed. The project audit documents the exact patch, source/tarball hashes, reachability and regression results. No changes were published upstream.

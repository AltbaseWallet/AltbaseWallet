# Local JoyID verification boundary correction

Based on the published `@ckb-ccc/core@1.16.1` tarball, with its registry integrity
verified against the original project lockfile. Local version:
`1.16.1+altbase.1`. This is not an upstream release.

`verifyMessageJoyId` constructed its verification request with caller-supplied
`challenge`, `pubkey` and `keyType` first and then spread `JSON.parse(signature)`
over them. An untrusted signature envelope could therefore replace the expected
message and identity with its own values. The local offline fixture reproduced
acceptance with both the wrong caller challenge and the wrong caller identity.

The correction moves the parsed signature fields first and assigns the trusted
caller values last. Legitimate envelopes retain their behavior. Cryptographic
algorithms, CKB transaction signing and serialization are unchanged.

The same one-expression correction is applied to the TypeScript source and both
published CommonJS/ESM distributions. Source-map source content is updated; the
minified replacement has the same length, preserving offsets after the expression.
No other runtime expression is changed. The application currently does not call
the generic JoyID message-verification path; its CKB signer uses Noble secp256k1.

Regression tests cover both entry points, valid WebAuthn ES256 verification and
rejection of attempts to override the expected challenge or public key. The
standard CKB/secp256k1 vectors are rerun to check unchanged signing behavior.

Source provenance, patch and test results are recorded in the project audit.
Nothing was published or reported to an external service by this task.

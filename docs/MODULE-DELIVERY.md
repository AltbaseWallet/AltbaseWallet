# Backend-driven coin module delivery

Altbase Wallet 0.1.10 can install new modules and update existing modules from an owner-controlled HTTPS catalog. The implementation is enabled by configuration, independently of the chain RPC provider. PublicNode is used for account-chain data. No production catalog or backend service was published during this work.

## Configure once

Generate an owner Ed25519 catalog key with the offline helper. Keep the private key on the publishing machine; do not put it in wallet builds or module archives.

```sh
node scripts/module-catalog.cjs keygen /path/to/private-publisher https://your-backend.example/coin-modules/catalog.json
```

This creates `catalog-signing-private.pem` and a **public** `module-catalog.json` containing the catalog URL and public verification key. Install only the public configuration in the wallet profile directory, next to `coin-plugins/`. Restart the wallet after changing this configuration. The application checks the catalog at startup and every 15 minutes, and the Modules page provides a manual check. Automatic activation is deferred during active module writes and the send screen.

## Add a package to the backend catalog

`npm run build` produces three portable packages in `artifacts/account-modules-0.1.3/`: EVM (four network descriptors), SOL and TRX. `packages.json` contains their exact sizes and SHA-256 digests. These archives include module code, manifests and native-network icons; **no token logo catalog or downloaded token images** is bundled.

Create a publisher input file with a `modules` array:

```json
{
  "modules": [{
    "id": "evm",
    "name": "EVM networks",
    "version": "0.1.3",
    "minimumWalletVersion": "0.1.10",
    "coins": ["ethereum", "bsc", "polygon", "arbitrum"],
    "enabled": true,
    "packages": {
      "any": {
        "url": "https://your-download-host.example/evm-0.1.3.tar.gz",
        "sha256": "REPLACE_WITH_THE_64_CHARACTER_SHA256_FROM_PACKAGES_JSON",
        "size": 123
      }
    }
  }]
}
```

Replace both digest and size with actual build values. Native modules use platform keys such as `linux-x64`, `win32-x64`, `darwin-arm64` or `darwin-x64` instead of `any`. Every descriptor in a package must have the package version. New module IDs appear automatically; newer semantic versions replace their prior package without recompiling the wallet. Disabled catalog entries are not installed or updated; this flag does not delete existing modules or their data.

Sign the complete catalog:

```sh
node scripts/module-catalog.cjs sign /path/to/modules.json /path/to/private-publisher/catalog-signing-private.pem /path/to/catalog.json
```

Serve `catalog.json` at the configured URL and the archives at their catalog URLs. The helper itself does not upload anything. Signed catalogs expire after six days; the publisher must regenerate them before expiration. Failed or expired checks leave the installed modules available. No GitHub API key or wallet secret belongs in this workflow.

## Installation guarantees and limits

Downloads require HTTPS; at most four validated redirects share one deadline. The catalog signature, freshness, identities, semantic versions, archive size and SHA-256 are checked before extraction. Archives reject traversal, symlinks, hard links and protected source names. A temporary worker probes package startup before activation. One atomic activation file selects complete packages; activation failure restores the previous selection. Failed/deferred staging is removed. Coin data stays in the same profile-scoped `coin-plugin-data/<coin-id>/` directory. Token holdings and visibility are additionally scoped by the public wallet address.

Manual installations retain ownership of their module IDs; the updater does not silently overwrite them or replace legacy compatibility engines. Modules execute trusted code, as with manual DLL installation. Catalog signing authenticates their publisher; it does not make arbitrary module code safe.

The production URL/key are deliberately unconfigured in this unpublished build. Installation, upgrade, rollback rejection, damaged packages, broken factories, active-write deferral and preservation of scan state were verified with local fixtures.

The 0.1.3 packages include the account transfer/MAX corrections, parallel metadata reads, multi-account Solana token transfers, the PublicNode address-family timing correction and bounded HTTP 529 overload retries. Existing token state stays in place. See the [October 4 audit](AUDIT-2026-10-04.md) for the current verification and the [September 30 checks](FIXES-2026-09-30.md) for earlier logo recovery changes. No 0.1.3 catalog has been published.

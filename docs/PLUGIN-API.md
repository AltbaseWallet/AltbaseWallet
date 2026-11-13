# Coin module API v1

## Native ABI

Use [`plugin-sdk/altbase_plugin.h`](../plugin-sdk/altbase_plugin.h). Export these unmangled C symbols:

```c
uint32_t altbase_plugin_abi_version(void);
const char* altbase_plugin_manifest(void);
char* altbase_plugin_request(const char* method, const char* params_json);
void altbase_plugin_free(char* response);
```

The ABI version is `1`. Windows uses `__cdecl`. The manifest is a static UTF-8 JSON string. Each request receives a method name and JSON object; its response is plugin-allocated memory released by `altbase_plugin_free`. No exception or C++ object may cross the ABI boundary.

Return a compact, single-line envelope:

```json
{"ok":true,"result":{"example":"value"}}
```

Errors use `{"ok":false,"error":"description"}`. The host deliberately substitutes a generic method error before passing it to the GUI, so plugin error text cannot accidentally echo wallet inputs. Do not log private inputs or write to stdout; stdout is reserved for the host protocol. Stderr is discarded.

The host serializes requests. Startup has a 5-second timeout and operations a 60-second timeout. Long-running synchronization belongs in a background scan that returns current state promptly, not a blocking snapshot call. Timeout terminates the worker and rejects queued work. There is no automatic operation replay. A subsequent explicit request can create a new worker.

Request frames are limited to 2 MiB, responses to 8 MiB and the native embedded manifest to 512 KiB. `ALTBASE_PLUGIN_DATA_DIR` identifies the persistent directory for this profile and coin. A metadata probe may load the library without that variable: exporting the manifest must not start scans, sign transactions or require private data.

## Manifest

```json
{
  "schemaVersion": 1,
  "abiVersion": 1,
  "id": "example-coin",
  "name": "Example Coin",
  "ticker": "EXAMPLE",
  "version": "1.0.0",
  "kind": "account",
  "networkId": "example-mainnet",
  "decimals": 8,
  "capabilities": ["derive", "validate", "snapshot", "nodeRequest", "estimateFee", "estimateMax", "send"],
  "testOnly": false
}
```

`id` is a stable lowercase identifier, 2–64 characters, beginning with a letter. `kind` is `utxo`, `privacy`, `account` or `cell`. Precision is read from `decimals` (0–18). `networkId` identifies the expected network and must match snapshot `network.chain`. Required methods are `derive`, `validate`, `snapshot` and `nodeRequest`; advertise optional methods only when implemented. `send` controls whether the coin is offered for sending. Optional fields include `supportsMemo`, `explorerUrl` and base64 `iconDataUrl` for PNG/JPEG/WebP/SVG.

Bare native libraries embed this manifest. A directory package can instead provide `manifest.json` with the same identity/version plus:

```json
{
  "runtime": {
    "type": "native",
    "platforms": {
      "win32-x64": "bin/windows/coin.dll",
      "linux-x64": "bin/linux/coin.so",
      "darwin-arm64": "bin/macos/coin.dylib"
    }
  },
  "icon": "icon.svg"
}
```

Use `runtime.entry` for a single platform. Paths are relative to the package and cannot escape it. Native embedded identity and version must match the package manifest. Changing only metadata in a sidecar cannot change the library's identity.

## Wallet requests

The result column is the `result` value inside the native response envelope. JavaScript modules return this value directly. Coin-denominated amounts are decimal strings. Atomic balance amounts should be unsigned decimal integer strings; numbers are accepted only when safe integers.

The wallet rejects negative amounts, nonzero digits below the coin precision, non-boolean validation results, and inconsistent fee representations. The atomic fee must exactly match the decimal fee. Address strings must be nonempty, without whitespace/control characters; transaction IDs use 1–256 ASCII letters, digits, underscores or hyphens and retain case. Do not return a JavaScript number for a large atomic amount. Module IDs cannot be reserved Windows device names or `constructor`/`prototype`.

| Method | Parameters | Result |
| --- | --- | --- |
| `derive` | `mnemonic` | Public address string. Initialize wallet/scan context if needed. |
| `variants` | `address` | Array of `{id,label,address,scriptKind,aliasOfLegacy?}`. Defaults to one account-style address when omitted. |
| `validate` | `address` | Boolean. |
| `estimateFee` | `fromAddress?`, `toAddress?`, `amountCoin?`, `force?`, `minimum?` | `{satoshis,coin,exact?}`; `satoshis` is a safe integer and `coin` a decimal string. |
| `estimateMax` | `address`, `feeCoin?`, `toAddress?`, `mnemonic?` | `{amountCoin,feeCoin,feeSatoshis?,inputCount?,remainingInputCount?,remainingAmountCoin?}`. No signing or broadcast. |
| `send` | `mnemonic`, `fromAddress?`, `toAddress`, `amountCoin`, `feeCoin?`, `maxFeeCoin?`, `sendMax?`, `memo?` | `{txid,amountCoin?,feeCoin?}`. Called only by the wallet's explicit send flow; do not auto-retry uncertain submissions. |
| `export` | `mnemonic` | Export string for this coin. Optional. |
| `snapshot` | `addresses`, `includeNetwork?`, `includeBalances?`, `includeHistory?`, `historyLimit?`, `historyOffset?`, `forceBalances?`, `historyUtxoOverlay?`, `expandAddresses?` | Snapshot described below. |
| `nodeRequest` | `path`, `method`, `body?` | Read-only gateway response compatible with the route in `src/services/coinApiService.ts`. |

The general UI reuses the account-style orchestration for new plugins regardless of their chain kind. A UTXO/privacy module implements selection, scanning, planning and chain-specific operations itself. It must not depend on the legacy wallet having compiled-in knowledge of its ID.

Allowed `nodeRequest` paths: `/network`, `/address/balance`, `/address/utxos`, `/address/history`, `/address/mempool`, `/address/validate`, `/fee/estimate`, `/tx/raw`, `/account/tx-context`, `/privacy/scan-info`, `/privacy/scan-chunk`. Only GET/POST read calls are accepted here. Sending belongs exclusively to the `send` operation. Routes not relevant to the chain may report unsupported operations.

## Snapshot and unavailable state

```json
{
  "coin": "example-coin",
  "network": {
    "ok": true,
    "coin": "example-coin",
    "chain": "example-mainnet",
    "blocks": 100,
    "headers": 100,
    "initialBlockDownload": false,
    "walletScanPercent": 100
  },
  "walletBalance": {
    "balance": "125000000",
    "balance_spendable": "125000000",
    "received": "125000000",
    "immature": "0"
  },
  "balances": {},
  "histories": {}
}
```

`walletBalance` supplies the total; alternatively return complete entries in `balances` for every requested address. Each balance must include all four amounts above, and spendable cannot exceed total. History entries use the `HistoryResponse` type in `src/services/coinApiService.ts`.

Successful balances require explicit network state. Initial download, a block/header gap, or `walletScanPercent < 100` means synchronization is incomplete; the wallet withholds these balance results. An unavailable network/balance should be represented by `network: null`, `walletBalance: null`, empty maps and optional `errors`, or by failing the operation. Never substitute zero for a timeout or unfinished scan. A complete verified zero is valid.

The GUI retains the previous amount with an unverified indicator when reads fail, and blocks MAX/send preparation until balance readiness returns. Wallet lock invalidates late results from the preceding session and closes workers.

## JavaScript packages

Use `runtime: {"type":"javascript","entry":"index.cjs"}` in `manifest.json`. The CommonJS entry exports:

```js
exports.createPlugin = async ({ dataDirectory, moduleDirectory }) => ({
  async request(method, params) {
    // Return the result value, or throw without including private inputs.
  },
  async close() {
    // Flush public scan state and stop background activity.
  }
})
```

Each package runs in a child process. Ship its dependencies inside the package. `examples/javascript-fixture` and `examples/native-fixture/plugin.cpp` are local fixtures with invented addresses and balances, no network and no transaction signing. They demonstrate the transport, not a production coin implementation.

## Account assets extension (Altbase Wallet)

The optional `assets` capability enables the generic token interface and exact account transfer flow. The network occupies one ordinary coin row with a downward disclosure arrow. Its token list is collapsed initially and expands inside that row. The extension does not require adding network IDs to the wallet UI. Its requests use these parameters instead of the legacy `send` signature above:

| Method | Parameters | Result |
| --- | --- | --- |
| `assets` | `owner`, `force?` | Inventory with `tokens`, `discovery`, `updating` and local `receipts`. |
| `importAsset` | `owner`, `asset` | Updated inventory after an explicit contract/mint import. Only this operation may download a token logo. |
| `setAssetVisibility` | `owner`, `asset`, `visibility: "show" or "hide"` | Updated inventory with a persisted local override. |
| `prepareTransfer` | `owner`, `to`, `asset?`, `amount?`, `max?` | Public preview: `planId`, `expiresAt`, `network`, `owner`, `to`, `asset`, `symbol`, `amount`, `fee`, `rent`, `nativeRequired`, `feeSymbol`. No key material, signing or broadcast. |
| `send` | `mnemonic`, `planId`, `confirmed: true` | Result for the one-use reviewed plan. Unknown broadcasts retain their local transaction ID and are never automatically retried. |

Amounts and fees are decimal strings, with unsigned integer strings for atomic token balances. `asset` is omitted for the native coin. Plans expire after 45 seconds and live only in the module worker. Preparing another session or refreshing a module cannot preserve an old plan. These operations are guarded against concurrent module activation.

Inventory tokens include their full identity, `amount`, `atomic`, `decimals`, `standard`, `status`, `verifiedAt`, `assessment`, `visible`, optional override and icon cache key. Partial owner enumeration must retain `discovery.complete: false`. `status: "partial"` and `"unavailable"` are distinct from a verified zero. Icons are public display data and never imply token trust. The supplied modules cache sanitized PNGs locally (PNG and JPEG inputs are decoded) only after explicit import; background discovery, expansion of a row and balance polling do not request logos.

Backend package installation/update uses the signed catalog described in [MODULE-DELIVERY.md](MODULE-DELIVERY.md). A production URL and verification key must be configured explicitly; no new backend is deployed by the application.

## Data and updates

Keep the same module ID when updating. Data remains in `<profile>/coin-plugin-data/<id>` and is not deleted when the module is temporarily removed. Handle your own state migrations. Refresh is rejected while a derive/export/send call is active. Native libraries with unchanged fingerprints retain their worker; changed libraries and refreshed JavaScript packages start new sessions. Duplicate IDs are disabled rather than selected by search order.

This loader runs trusted code; process separation does not restrict filesystem or network access. A module owns its node/backend connection and key handling. No credentials, node daemons or new server endpoints are supplied automatically by installing a library.

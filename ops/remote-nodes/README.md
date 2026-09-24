# Remote node maintenance sources

This directory contains the backend adapters and patch helpers used by the
Altbase remote node services. It is an operations source collection, not a
standalone backend distribution: the deployed service supplies its gateway,
adapter registry, configuration and shared RPC transport.

## September 24, 2026 corrections

- Junkcoin reads use a complete, validated UTXO scan instead of a bounded
  history backfill. They apply the 70-block coinbase maturity rule, account for
  pending spends and change, and preserve unavailable results on incomplete
  scans or RPC errors. Mature outputs do not each require a separate RPC.
- Both gateways preserve authoritative Junkcoin balances and reject partial
  balance fallbacks. Mempool amounts are applied once.
- EPIC retains the daemon's target height and stays unready during nonterminal
  synchronization stages, including snapshot validation and awaiting peers.
- The node2 health timer skips the local Zano daemon only when that service is
  explicitly disabled and inactive. Other local daemon checks remain active.

These changes preserve the existing transaction signing and broadcast paths.
No wallet binary or mining module update is required for these server fixes.

## Files and integration

| File | Purpose |
| --- | --- |
| `adapters/junkcoinUtxo.cjs` | Junkcoin balance, UTXO and mempool read overrides |
| `junkcoin-read-patch.cjs` | Gateway source transformer; accepts `primary` or `node2` |
| `adapters/epicNode.node2.cjs` | Snapshot of the corrected node2 EPIC adapter |
| `epic-sync-status-patch.cjs` | Transformer for the preceding EPIC adapter layout |
| `node2-health.sh` | Health timer script for the existing node2 service layout |

The Junkcoin adapter requires the deployed `lib/rpc.cjs` exports
`createBitcoinRpc` and `RpcError`, plus the included `lib/mapConcurrent.cjs`.
The EPIC adapter uses the same transport's `httpRequest` and `RpcError` exports.
Runtime RPC URLs and credentials come from the existing service configuration;
they are not included here.

Back up the deployed source and configuration before integration. Install the
Junkcoin module alongside the existing adapters, then apply
`patchJunkcoinReadGateway(source, role)` to each gateway's source. The primary
gateway must already contain the authoritative balance guards from
`authoritative-balance-patch.cjs`. For EPIC, apply
`patchEpicSyncStatus(source)` to the deployed adapter, or compare it with the
corrected snapshot. The transformers reject unsupported source layouts and
return already patched sources unchanged. Review the resulting diff and run
syntax and fixture checks before restarting the affected API services.

`node2-health.sh` contains host-specific service names and paths. It can restart
services after repeated failures, so it is intended for the existing node2
timer, not for execution as a local test. Its local Zano exception does not
establish the health of the configured remote Zano source; that source is
checked separately through the public network and privacy scan-info routes.

The accompanying [maintenance report](../../docs/MAINTENANCE-2026-09-24.md)
records daemon upgrades, RPC port configuration, systemd startup corrections,
production verification timestamps and remaining limits. Those host changes
are not performed by these source transformers.

## Local verification

From the repository root, run the read-only fixtures on one CPU:

```sh
taskset -c 0 node --test tests/junkcoinUtxo.test.cjs tests/epicNodeSync.test.cjs
bash -n ops/remote-nodes/node2-health.sh
```

The suite contains 17 Junkcoin cases and five EPIC scenarios. The Node test
runner reports 18 entries because the five EPIC scenarios share one test file.
RPC and HTTP transports are mocked; no credentials, live wallet profiles or
transactions are used.

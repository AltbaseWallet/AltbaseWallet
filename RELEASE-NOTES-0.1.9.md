# Altbase Wallet 0.1.9

## 0.1.9 — GrandPool coins and remote-node integration

- Add separate BCH, DGB, PPC, ZEC, NEXA, XEL and MWC wallet modules. Together with BTC and PRL, Altbase covers all nine coins listed by GrandPool on 2026-09-23. The wallet now has 33 coin modules.
- Route public blockchain requests through the Altbase backend. Keys and signing stay in local wallet engines. Xelis and MWC use pinned official reference wallets and preserve encrypted local scan profiles.
- Add BCH ForkID, DigiByte witness and Peercoin v3 transaction support; verify legacy Peercoin previous transactions with their timestamp field. Add Zcash NU6.3 v5/ZIP-244 transparent transactions and Nexa outpoint-aware planning with exact integer amounts.
- Keep unfinished scans and failed balance reads unverified. Fix Electron compatibility for Xelis key derivation and MWC encrypted Owner API; both complete real read-only synchronization in the Linux GUI.
- Improve Nexa large-UTXO reads with persistent Rostrum connections, bounded concurrency and shared caches. Never replace a failed authoritative balance with a spendable-only UTXO total that omits immature rewards.
- Bundle signed Mining 0.1.13: GrandPool defaults, 54 pool/solo regional presets, Rigel XelisHash v3/NexaPow support and external ASIC setup. Existing saved job endpoints and Nonsense solo mining are preserved.
- Ship Linux x86_64 AppImage, Windows x64 MSI inside ZIP and universal Intel/Apple Silicon macOS ZIP. Compilation was pinned to one CPU.

### Verification and limits

169 wallet/backend tests and 27 Mining runtime/update tests passed. Native fixture signatures were independently checked; official Zcash ZIP-244 vectors and Electron runtime fixtures passed. All seven added coins reached Active in an isolated Linux GUI, including complete Xelis/MWC scans. All nine GrandPool defaults passed an Electron GUI check. No real wallet transaction was signed or broadcast, and no pool share was submitted.

Zcash currently supports transparent t1/t3 addresses; shielded/unified sends are unavailable. Nexa token outputs and Xelis token/contract operations are not supported. MWC sends require an online compatible MQS recipient. The first privacy scan can take several minutes. Very large exchange/pool histories can exceed the upstream Electrum history limit and remain explicitly unavailable. A cold Nexa address with over 1,000 UTXOs took about 27 seconds; subsequent reads took less than a second.

Windows MSI payload extraction passed. macOS architecture and ad-hoc code/resource signatures passed. Physical Windows/macOS runtime testing was unavailable; macOS is not Apple-notarized. Rigel GPU mining requires supported NVIDIA Windows/Linux hardware; ASIC mining requires an external device.

Three of four known servers were reachable. Both Nonsense nodes were synchronized and indexed; the secondary node's repeated OOM restarts were corrected with a memory budget and swap. Server `188.137.235.140` remained unreachable over SSH and API from both the workstation and primary backend, so Neoxa, Terracoin, Raptoreum, Zano, EPIC and Junkcoin availability could not be confirmed. These failures are not zero balances.

See [detailed verification](docs/VERIFICATION-0.1.9.md). See CHANGELOG.md for the retained changes from 0.1.7.


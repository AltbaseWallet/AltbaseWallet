import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('privacy wallet lifecycle state is owned by one service per coin', () => {
  const services = {
    zano: read('src/services/privacy/zanoPrivacyWalletService.ts'),
    epic: read('src/services/privacy/epicPrivacyWalletService.ts'),
    monero: read('src/services/privacy/moneroPrivacyWalletService.ts'),
  }

  for (const [coin, source] of Object.entries(services)) {
    for (const otherCoin of Object.keys(services)) {
      if (coin === otherCoin) continue
      assert.doesNotMatch(source, new RegExp(`['"]${otherCoin}['"]`), `${coin} service contains ${otherCoin} state`)
    }
    assert.match(source, /snapshotInFlight/)
    assert.match(source, /nativeCallQueue/)
    assert.match(source, /nativeReadiness/)
    assert.match(source, /resetNativeReadiness/)
  }
})

test('privacy wallet facade only routes to isolated coin services', () => {
  const facade = read('src/services/privacyWalletService.ts')
  assert.match(facade, /zanoPrivacyWalletService/)
  assert.match(facade, /epicPrivacyWalletService/)
  assert.match(facade, /moneroPrivacyWalletService/)
  assert.doesNotMatch(facade, /snapshotInFlight|nativeCallQueue|checkpointSaveQueue/)
})

test('monero keeps one live snapshot and promotes completed checkpoints', () => {
  const source = read('src/services/privacy/moneroPrivacyWalletService.ts')

  assert.match(source, /const getOrStartSnapshot =/)
  assert.match(source, /snapshotInFlight\?\.mnemonic === mnemonic/)
  assert.match(source, /getOrStartSnapshot\(mnemonic, undefined, 'warm:snapshot'\)/)
  assert.match(source, /getOrStartSnapshot\(mnemonic, onProgress, 'snapshot'\)/)
  assert.match(source, /progress\.blocksRemaining <= 0[\s\S]*?'monero-native-wallet'[\s\S]*?'monero-native-wallet-syncing'/)
  assert.match(source, /async ensureWallet[\s\S]*?updateNativeReadiness\(response\)/)
})

test('epic fee seed matches the standard one-input two-output transaction', () => {
  const source = read('src/wallet-engines/privacy/privacyEngine.ts')

  assert.match(source, /epic:\s*['"]0\.007['"]/)
})

test('epic max send obtains the exact native fee before confirmation', () => {
  const sendPage = read('src/pages/Send/Send.tsx')
  const engine = read('src/wallet-engines/privacy/privacyEngine.ts')
  const service = read('src/services/privacy/epicPrivacyWalletService.ts')
  const rust = read('native/epic_core/src/lib.rs')

  assert.match(sendPage, /liveCoin\.id === 'epic'[\s\S]*?estimateMaxSend/)
  assert.match(engine, /async estimateMaxSend\([\s\S]*?privacyWalletService\.estimateMaxSend/)
  assert.match(service, /callNativeLightWallet\('estimateMax'/)
  assert.match(rust, /fn estimate_max_send_values/)
  assert.match(rust, /EpicWalletError::NotEnoughFunds/)
  assert.match(rust, /"estimatemax"\s*=>\s*estimate_max_send/)
})

test('manual Epic rescan unlocks stale unconfirmed outputs', () => {
  const service = read('src/services/privacy/epicPrivacyWalletService.ts')
  const bridge = read('native/core/src/epic_light_wallet_impl.cpp')
  const rust = read('native/epic_core/src/lib.rs')
  const epicOwner = read('native/vendor/epic_wallet_src/libwallet/src/api_impl/owner.rs')
  const epicbox = read('native/vendor/epic_wallet_src/impls/src/adapters/epicbox.rs')

  assert.match(service, /manual-rescan[\s\S]*?forceRescan:\s*['"]true['"]/)
  assert.match(bridge, /forceRescan[\s\S]*?forceRescan\\\":true/)
  assert.match(rust, /force_rescan:\s*Option<bool>/)
  assert.match(rust, /\.scan\(mask, Some\(start_height\), force_rescan\)/)
  assert.match(rust, /marker\.exists\(\) && !force_rescan/)
  assert.match(rust, /let scan_floor = restore_start\.max\(start_height\)/)
  assert.match(rust, /\.filter\(\|height\| \*height > scan_floor\)[\s\S]*?\.unwrap_or\(scan_floor\)[\s\S]*?\.max\(scan_floor\)/)
  assert.match(rust, /ensure_recent_restore_scan\([\s\S]*?retrieve_summary_info\(mask_ref, true, 1\)/)
  assert.match(epicOwner, /tx\.confirmation_height = Some\(k\.1\)/)
  assert.match(epicOwner, /TxSentCreated[\s\S]*?tx\.tx_type = TxLogEntryType::TxSent/)
  assert.match(epicOwner, /stored_kernel_excess[\s\S]*?w\.get_stored_tx\(tx\)[\s\S]*?candidates\.push\(excess\)/)
  assert.match(epicOwner, /tx\.kernel_excess = Some\(confirmed_excess\)/)
  assert.match(epicbox, /\*slate = finalized_slate;[\s\S]*?Ok\(true\)/)
  assert.match(rust, /fn estimate_max_send[\s\S]*?retrieve_summary_info\(mask_ref, false, 1\)/)
  assert.match(rust, /fn start_epicbox_listener[\s\S]*?loop \{[\s\S]*?listener\.listen\([\s\S]*?Duration::from_secs\(2\)/)
  const cache = read('src/services/privacyCacheService.ts')
  assert.match(cache, /const epicNativeArchiveIsAhead = Boolean\([\s\S]*?coin === 'epic'[\s\S]*?snapshotLastScannedHeight[\s\S]*?> existingLastScannedHeight/)
  assert.match(cache, /preserveNativeArchiveForOutgoingHistory[\s\S]*?nativeWalletFileBlob:/)
  assert.doesNotMatch(rust, /owner\.start_updater/)
})

test('Epic priority operations cannot overlap an in-flight wallet scan', () => {
  const service = read('src/services/privacy/epicPrivacyWalletService.ts')

  assert.match(service, /runPriorityExclusive[\s\S]*?const previous = nativeCallQueue \?\? Promise\.resolve\(\)/)
  assert.match(service, /runPriorityExclusive[\s\S]*?readinessEpoch \+= 1[\s\S]*?previous\.catch\(\(\) => undefined\)\.then/)
})

test('desktop wallet keeps native listeners alive while its window is backgrounded', () => {
  const main = read('electron/main.cjs')
  assert.match(main, /webPreferences:\s*\{[\s\S]*?backgroundThrottling:\s*false/)
})

test('Windows packaging rebuilds every Epic native module', () => {
  const entrypoint = read('build-windows.sh')
  const sender = read('scripts/build-windows-epic-sender.cjs')
  const build = read('scripts/build-windows-native-incremental.cjs')

  assert.match(entrypoint, /node scripts\/build-windows-epic-sender\.cjs[\s\S]*?node scripts\/build-windows-native-incremental\.cjs/)
  assert.match(sender, /native['], ['"]epic_transport['], ['"]Cargo\.toml/)
  assert.match(sender, /native['], ['"]epic_state['], ['"]Cargo\.toml/)
  assert.match(sender, /native['], ['"]epic_sender['], ['"]Cargo\.toml/)
  assert.match(sender, /x86_64-pc-windows-msvc/)
  assert.match(sender, /expectedSenderExports/)
  assert.match(sender, /verifyAndStageModule\('transport'/)
  assert.match(sender, /verifyAndStageModule\('state'/)
  assert.match(sender, /altbase_epic_sender\.dll/)
  assert.match(build, /epic_light_wallet_impl\.cpp/)
  assert.match(build, /altbase_epic_sender\.dll/)
  assert.match(build, /altbase_epic_wallet\.dll/)
  assert.match(build, /expectedEpicWalletExports/)
})

test('Linux packaging rebuilds and verifies every Epic native module', () => {
  const build = read('build-linux.sh')
  for (const module of ['transport', 'state', 'sender']) {
    assert.match(build, new RegExp(`epic_${module}/Cargo\\.toml`))
    assert.match(build, new RegExp(`libaltbase_epic_\\$\\{epic_module\\}\\.so`))
    assert.match(build, new RegExp(`embedded_epic_${module}`))
  }
})

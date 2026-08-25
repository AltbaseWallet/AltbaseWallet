'use strict'

const WebSocket = require('ws')

const port = Number(process.argv[2] || process.env.ALTBASE_CDP_PORT || 19347)
const endpoint = `http://127.0.0.1:${port}`
const password = 'Altbase-E2E-Password-2026!'
const requestedRouteCoinIds = new Set(
  String(process.env.ALTBASE_E2E_COIN_FILTER || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
)
const expectedCoinIds = [
  'bitcoin', 'bitcoin2', 'bitcoincashii', 'firo', 'btgs', 'capstash', 'hypercoin',
  'mydogecoin', 'pepecoin', 'kerrigan', 'scash', 'litecoinii', 'monero', 'neoxa',
  'terracoin', 'junkcoin', 'raptoreum', 'zano', 'epic', 'quai', 'xgr', 'pearl',
  'qubic', 'kaspa', 'ckb',
]
const requiredAddressCoinIds = requestedRouteCoinIds.size > 0
  ? requestedRouteCoinIds
  : new Set(expectedCoinIds)
const requireActiveRoutes = process.env.ALTBASE_E2E_REQUIRE_ACTIVE === '1'
const requireExternalRecipients = process.env.ALTBASE_E2E_REQUIRE_EXTERNAL_RECIPIENTS === '1'
const testXgrMax = process.env.ALTBASE_E2E_TEST_XGR_MAX === '1'
const xgrAmount = String(process.env.ALTBASE_E2E_XGR_AMOUNT || '3').trim()
const walletPhrase = String(process.env.ALTBASE_E2E_WALLET_PHRASE || '').trim()
const recipientAddresses = (() => {
  const raw = String(process.env.ALTBASE_E2E_RECIPIENT_ADDRESSES_JSON || '').trim()
  if (!raw) return {}
  const parsed = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('ALTBASE_E2E_RECIPIENT_ADDRESSES_JSON must be an object')
  }
  return parsed
})()

if (process.env.ALTBASE_E2E_DISPOSABLE_PROFILE !== '1') {
  throw new Error('Refusing to exercise wallet controls outside an explicitly disposable E2E profile')
}
if (!walletPhrase) throw new Error('ALTBASE_E2E_WALLET_PHRASE is required for native phrase validation')

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const connect = async () => {
  const listResponse = await fetch(`${endpoint}/json/list`)
  if (!listResponse.ok) throw new Error(`CDP target list returned HTTP ${listResponse.status}`)
  const targets = await listResponse.json()
  const target = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl)
  if (!target) throw new Error('Altbase renderer CDP target is missing')

  const socket = new WebSocket(target.webSocketDebuggerUrl)
  const pending = new Map()
  let nextId = 0
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString())
    const slot = pending.get(message.id)
    if (!slot) return
    pending.delete(message.id)
    if (message.error) slot.reject(new Error(JSON.stringify(message.error)))
    else slot.resolve(message.result)
  })
  socket.on('close', () => {
    for (const slot of pending.values()) slot.reject(new Error('CDP socket closed'))
    pending.clear()
  })
  await new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }), (error) => {
      if (!error) return
      pending.delete(id)
      reject(error)
    })
  })
  await call('Runtime.enable')
  const evaluate = async (expression) => {
    const response = await call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || 'Renderer evaluation failed')
    }
    return response.result?.value
  }
  return { socket, evaluate }
}

const run = async () => {
  const { socket, evaluate } = await connect()
  const report = {
    routes: {},
    coins: [],
    core: {},
    network: [],
    nativeAddressChecks: [],
    sendPreflight: [],
    mining: {},
  }
  const fatalPattern = /native core exited|sanity check failed|non-monotonic output distribution|node rejected the transaction|failed to fetch fee|native core (?:timeout during|restarted after) coinNodeRequest/i
  const bodyText = () => evaluate('document.body?.innerText || ""')
  const waitFor = async (predicate, label, timeoutMs = 45_000) => {
    const started = Date.now()
    let last
    while (Date.now() - started < timeoutMs) {
      last = await predicate()
      if (last) return last
      await delay(250)
    }
    throw new Error(`Timed out waiting for ${label}. Last value: ${JSON.stringify(last)}\n${await bodyText()}`)
  }
  const navigate = async (route) => {
    await evaluate(`window.dispatchEvent(new Event('altbase:user-activity')); location.hash = ${JSON.stringify(route)}; true`)
    await waitFor(
      () => evaluate(`location.hash === ${JSON.stringify(route)}`),
      `route ${route}`,
      20_000,
    )
    await delay(350)
    const screen = await bodyText()
    if (fatalPattern.test(screen)) throw new Error(`Fatal wallet message on ${route}:\n${screen}`)
    return screen
  }
  const setValue = (selector, value) => evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)})
    if (!input) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, ${JSON.stringify(value)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)

  try {
    await evaluate(`window.__altbaseE2eActivityTimer = window.setInterval(() => window.dispatchEvent(new Event('altbase:user-activity')), 30000); true`)
    await evaluate(`location.hash = '#/app'; true`)
    await waitFor(
      () => evaluate(`location.hash === '#/app' && document.body?.innerText.includes('Coins')`),
      'fully restored dashboard',
      180_000,
    )
    const readDashboardCoins = () => evaluate(`(() => {
      const found = new Map()
      for (const anchor of [...document.querySelectorAll('a')].filter((item) => (item.getAttribute('href') || '').includes('/app/coin/'))) {
        const key = Object.keys(anchor).find((item) => item.startsWith('__reactFiber$'))
        let fiber = key ? anchor[key] : null
        while (fiber) {
          const coin = fiber.memoizedProps?.coin
          if (coin?.id) {
            found.set(coin.id, {
              id: coin.id,
              name: coin.name,
              ticker: coin.ticker,
              walletEngine: coin.walletEngine,
              status: coin.status,
              balance: coin.balance,
              spendableBalance: coin.spendableBalance,
              address: coin.address,
              enabled: coin.enabled,
              cryptoParams: coin.cryptoParams,
            })
            break
          }
          fiber = fiber.return
        }
      }
      return [...found.values()]
    })()`)
    report.coins = await waitFor(async () => {
      const coins = await readDashboardCoins()
      const byId = new Map(Array.isArray(coins) ? coins.map((coin) => [coin.id, coin]) : [])
      return Array.isArray(coins)
        && coins.length === expectedCoinIds.length
        && [...requiredAddressCoinIds].every((id) => {
          const coin = byId.get(id)
          return Boolean(coin?.address) && (!requireActiveRoutes || coin.status === 'active')
        })
        ? coins
        : null
    }, 'required wallet addresses', 180_000)
    process.stdout.write('windows_functions_dashboard=ready\n')
    if (!Array.isArray(report.coins) || report.coins.length !== expectedCoinIds.length) {
      const links = await evaluate(`[...document.querySelectorAll('a')].map((item) => item.getAttribute('href')).filter(Boolean)`)
      throw new Error(`Dashboard exposed ${report.coins?.length ?? 0} coins, expected ${expectedCoinIds.length}; links=${JSON.stringify(links)}`)
    }
    const byId = new Map(report.coins.map((coin) => [coin.id, coin]))
    for (const id of expectedCoinIds) {
      const coin = byId.get(id)
      if (!coin) throw new Error(`Coin is missing from dashboard: ${id}`)
      if (requiredAddressCoinIds.has(id) && !coin.address) throw new Error(`Wallet address is missing: ${id}`)
    }

    report.core = await evaluate(`(async () => {
      const core = window.altbaseWallet?.core
      if (!core) throw new Error('Native core bridge is unavailable')
      return {
        health: await core({ method: 'health', params: {} }),
        modules: await core({ method: 'listWalletModules', params: {} }),
        validPhrase: await core({ method: 'validatePhrase', params: { phrase: ${JSON.stringify(walletPhrase)} } }),
        invalidPhrase: await core({ method: 'validatePhrase', params: { phrase: 'captain captain captain captain captain captain captain captain captain captain captain captain' } }),
        fee: await core({ method: 'estimateFee', params: { feeRatePerKb: 1000, satsPerCoin: 100000000, nIn: 1, nOut: 2 } }),
      }
    })()`)
    if (!report.core.health?.ok || !report.core.modules?.ok || !report.core.fee?.ok) {
      throw new Error(`Native core smoke test failed: ${JSON.stringify(report.core)}`)
    }
    process.stdout.write('windows_functions_native_core=passed\n')
    if (report.core.validPhrase?.result?.isValid !== 'true' || report.core.invalidPhrase?.result?.isValid !== 'false') {
      throw new Error('Native BIP39 validation returned an unexpected result')
    }

    const standardUtxoCoins = report.coins.filter((coin) =>
      coin.address
      && coin.cryptoParams
      && (!coin.walletEngine || ['bitcoin-utxo', 'pearl-utxo'].includes(coin.walletEngine)))
    for (const coin of standardUtxoCoins) {
      const result = await evaluate(`(async () => {
        const coin = ${JSON.stringify(coin)}
        const params = {
          coin: coin.id,
          address: coin.address,
          p2pkhPrefix: coin.cryptoParams.p2pkhPrefix,
          p2shPrefix: coin.cryptoParams.p2shPrefix,
          bech32Hrp: coin.cryptoParams.bech32Hrp,
          cashaddrPrefix: coin.cryptoParams.cashaddrPrefix,
          addressType: coin.cryptoParams.addressType,
        }
        const valid = await window.altbaseWallet.core({ method: 'validateAddress', params })
        const invalid = await window.altbaseWallet.core({ method: 'validateAddress', params: { ...params, address: 'not-an-address' } })
        const script = await window.altbaseWallet.core({ method: 'addressToScript', params })
        return { valid, invalid, script }
      })()`)
      report.nativeAddressChecks.push({ coin: coin.id, ...result })
      if (result.valid?.result?.isValid !== 'true') throw new Error(`Native address validation failed: ${coin.id}`)
      if (result.invalid?.result?.isValid !== 'false') throw new Error(`Native invalid-address rejection failed: ${coin.id}`)
      if (!result.script?.ok || !result.script?.result?.scriptPubKey) throw new Error(`Native script conversion failed: ${coin.id}`)
    }

    if (process.env.ALTBASE_E2E_SKIP_NETWORK !== '1') {
    report.network = await evaluate(`(async () => {
      const ids = ${JSON.stringify(expectedCoinIds)}
      const results = []
      let index = 0
      const worker = async () => {
        while (index < ids.length) {
          const coin = ids[index++]
          let result = null
          for (let attempt = 0; attempt < 5; attempt += 1) {
            try {
              const response = await fetch('https://api.altbase.io/api/v1/' + coin + '/network', { signal: AbortSignal.timeout(15000) })
              const body = await response.json().catch(() => ({}))
              result = { coin, status: response.status, ok: response.ok && body.ok === true, blocks: body.blocks, headers: body.headers, chainId: body.chainId }
              if (result.ok || !(response.status === 429 || response.status >= 500)) break
            } catch (error) {
              result = { coin, status: 0, ok: false, error: error instanceof Error ? error.message : String(error) }
            }
            await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)))
          }
          results.push(result)
        }
      }
      await Promise.all(Array.from({ length: 4 }, worker))
      return results.sort((a, b) => a.coin.localeCompare(b.coin))
    })()`)
    const failedNetworks = report.network.filter((item) =>
      !item?.ok && byId.get(item?.coin)?.status !== 'maintenance')
    const maintenanceNetworks = report.network.filter((item) =>
      !item?.ok && byId.get(item?.coin)?.status === 'maintenance')
    if (maintenanceNetworks.length > 0) {
      process.stdout.write(`windows_functions_network_maintenance=${JSON.stringify(maintenanceNetworks)}\n`)
    }
    if (failedNetworks.length > 0) {
      throw new Error(`Network endpoints failed after retries: ${JSON.stringify(failedNetworks)}`)
    }

    const snapshot = await evaluate(`(async () => {
      const items = ${JSON.stringify(report.coins.filter(({ address }) => Boolean(address)).map(({ id, address }) => ({ coin: id, addresses: [address] })))}
      const results = []
      let index = 0
      const worker = async () => {
        while (index < items.length) {
          const item = items[index++]
          let result = null
          for (let attempt = 0; attempt < 5; attempt += 1) {
            try {
              const response = await fetch('https://api.altbase.io/api/v1/wallet/snapshot', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ coins: [item], includeNetwork: true, includeBalances: true, includeHistory: true, historyLimit: 2, historyOffset: 0, expandAddresses: true }),
                signal: AbortSignal.timeout(30000),
              })
              const body = await response.json().catch(() => ({}))
              const errors = body.coins?.[item.coin]?.errors || {}
              result = {
                coin: item.coin,
                status: response.status,
                ok: response.ok && body.ok === true && Boolean(body.coins?.[item.coin]),
                errors,
              }
              if (result.ok && Object.keys(errors).length === 0) break
              if (!result.ok && !(response.status === 429 || response.status >= 500)) break
            } catch (error) {
              result = { coin: item.coin, status: 0, ok: false, error: error instanceof Error ? error.message : String(error) }
            }
            await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)))
          }
          results.push(result)
        }
      }
      await Promise.all(Array.from({ length: 4 }, worker))
      const failed = results.filter((item) => !item?.ok)
      return { ok: failed.length === 0, coinIds: results.filter((item) => item?.ok).map((item) => item.coin), results: results.sort((a, b) => a.coin.localeCompare(b.coin)), failed }
    })()`)
    report.snapshot = snapshot
    if (snapshot.coinIds.length < expectedCoinIds.length - 2) {
      throw new Error(`Wallet snapshot did not cover every coin: ${JSON.stringify(snapshot)}`)
    }
    const remoteSnapshotErrors = snapshot.results.filter((item) =>
      !['zano', 'epic', 'monero'].includes(item?.coin)
      && Object.keys(item?.errors || {}).length > 0)
    if (remoteSnapshotErrors.length > 0) {
      throw new Error(`Remote wallet snapshot returned coin errors: ${JSON.stringify(remoteSnapshotErrors)}`)
    }
    if (!snapshot.ok) process.stdout.write(`windows_functions_snapshot_warnings=${JSON.stringify(snapshot.failed)}\n`)
    process.stdout.write('windows_functions_network_snapshot=passed\n')
    } else {
      report.network = []
      report.snapshot = { ok: true, coinIds: expectedCoinIds, results: [], failed: [], skipped: true }
      process.stdout.write('windows_functions_network_snapshot=skipped\n')
    }

    if (process.env.ALTBASE_E2E_SKIP_COIN_ROUTES !== '1') {
    const routeCoins = requestedRouteCoinIds.size > 0
      ? report.coins.filter((coin) => requestedRouteCoinIds.has(coin.id))
      : report.coins
    if (requestedRouteCoinIds.size > 0 && routeCoins.length !== requestedRouteCoinIds.size) {
      throw new Error(`Requested coin routes are missing: ${JSON.stringify([...requestedRouteCoinIds])}`)
    }
    for (const coin of routeCoins) {
      await evaluate(`window.dispatchEvent(new Event('altbase:user-activity')); true`)
      let screen = await navigate(`#/app/coin/${coin.id}`)
      if (!screen.includes(coin.name) || !screen.includes(coin.address)) {
        throw new Error(`Coin details are incomplete: ${coin.id}`)
      }

      screen = await navigate(`#/app/receive?coin=${coin.id}`)
      await waitFor(async () => (await bodyText()).includes(coin.address), `receive address for ${coin.id}`, 25_000)
      if (!(await bodyText()).includes(coin.name)) throw new Error(`Receive screen selected the wrong coin: ${coin.id}`)

      screen = await navigate(`#/app/send?coin=${coin.id}`)
      if (!screen.includes(coin.name)) throw new Error(`Send screen selected the wrong coin: ${coin.id}`)
      const controls = await evaluate(`({
        recipient: Boolean(document.querySelector('input[name=to]')),
        amount: Boolean(document.querySelector('input[name=amount]')),
        feeModeButtons: [...document.querySelectorAll('button')].filter((button) => ['Auto', 'Manual'].includes(button.textContent.trim())).length,
      })`)
      if (!controls.recipient || !controls.amount || controls.feeModeButtons !== 2) {
        throw new Error(`Send controls are incomplete: ${coin.id} ${JSON.stringify(controls)}`)
      }

      const preflight = { coin: coin.id, status: coin.status, outcome: 'rendered' }
      if (coin.status === 'active') {
        const recipient = String(recipientAddresses[coin.id] || coin.address)
        if (requireExternalRecipients && (!recipientAddresses[coin.id] || recipient === coin.address)) {
          throw new Error(`External recipient is missing: ${coin.id}`)
        }
        if (!await setValue('input[name=to]', recipient)) throw new Error(`Recipient input disappeared: ${coin.id}`)

        if (coin.id === 'xgr' && testXgrMax) {
          const clicked = await evaluate(`(() => {
            const button = document.querySelector('button[title="MAX"]')
            if (!button || button.disabled) return false
            button.click()
            return true
          })()`)
          if (!clicked) throw new Error('XGR MAX control is unavailable')
          const maxResult = await waitFor(async () => evaluate(`(() => {
            const body = document.body?.innerText || ''
            const error = body.match(/Failed to fetch fee:[^\\n]*/i)?.[0]
            if (error) return { error, amount: '', validation: '' }
            const validation = [...document.querySelectorAll('.text-rose-300')]
              .map((node) => node.textContent.trim())
              .find(Boolean) || ''
            if (validation) return { error: '', amount: '', validation }
            const amount = document.querySelector('input[name=amount]')?.value || ''
            return /^\\d+(\\.\\d+)?$/.test(amount) && Number(amount) > 0
              ? { error: '', amount, validation: '' }
              : null
          })()`), 'XGR MAX amount without a fee error', 45_000)
          if (maxResult.error) throw new Error(maxResult.error)
          if (Number(coin.spendableBalance || coin.balance || 0) > 0 && !maxResult.amount) {
            throw new Error(`XGR MAX did not produce an amount for a funded wallet: ${maxResult.validation}`)
          }
          if (Number(coin.spendableBalance || coin.balance || 0) <= 0 && !maxResult.validation) {
            throw new Error('XGR MAX did not reject an empty wallet locally')
          }
          process.stdout.write('windows_functions_xgr_max=passed\n')
        }

        const useKaspaMax = coin.id === 'kaspa' && Number(coin.spendableBalance || coin.balance || 0) > 0
        const amount = coin.id === 'xgr' && testXgrMax
          ? xgrAmount
          : coin.id === 'qubic' || coin.id === 'ckb'
            ? '1'
            : '0.00000001'
        let outcome = { kind: 'rendered', text: '' }
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          if (!await setValue('input[name=to]', recipient)) throw new Error(`Recipient input disappeared: ${coin.id}`)
          if (useKaspaMax) {
            const clicked = await evaluate(`(() => {
              const button = document.querySelector('button[title="MAX"]')
              if (!button || button.disabled) return false
              button.click()
              return true
            })()`)
            if (!clicked) throw new Error('Kaspa MAX control is unavailable')
            await waitFor(async () => evaluate(`(() => {
              const amount = document.querySelector('input[name=amount]')?.value || ''
              const body = document.body?.innerText || ''
              if (/Failed to fetch fee:/i.test(body)) return false
              return /^\\d+(\\.\\d+)?$/.test(amount) && Number(amount) > 0
            })()`), 'Kaspa MAX amount without a fee error', 45_000)
          } else if (!await setValue('input[name=amount]', amount)) {
            throw new Error(`Amount input disappeared: ${coin.id}`)
          }
          await delay(1800)
          const submitState = await evaluate(`(() => {
            const form = document.querySelector('form')
            const submit = form?.querySelector('button[type=submit], input[type=submit]')
            return { exists: Boolean(submit), disabled: Boolean(submit?.disabled) }
          })()`)
          if (submitState.exists && submitState.disabled && Number(coin.spendableBalance || 0) <= 0) {
            outcome = { kind: 'validation', text: 'submit disabled for zero spendable balance' }
          } else {
            await evaluate(`document.querySelector('form')?.requestSubmit(); true`)
            outcome = await waitFor(async () => evaluate(`(() => {
              const dialog = [...document.querySelectorAll('h2')]
                .find((node) => /confirm/i.test(node.textContent || ''))
                ?.parentElement?.parentElement
              const errors = [...document.querySelectorAll('.text-rose-300')].map((node) => node.textContent.trim()).filter(Boolean)
              if (dialog) return { kind: 'confirmation', text: dialog.innerText }
              if (errors.length) return { kind: 'validation', text: errors.join(' | ') }
              return null
            })()`), `safe send preflight for ${coin.id}`, 35_000).catch(async () => ({ kind: 'rendered', text: (await bodyText()).slice(-500) }))
          }
          if (outcome.kind !== 'rendered' || attempt === 2) break
          await navigate('#/app')
          await navigate(`#/app/send?coin=${coin.id}`)
        }
        const outcomeText = outcome.text || ''
        const hasCoreFailure = /native core (?:timeout during|restarted after) coinNodeRequest/i.test(outcomeText)
        const hasFeeFailure = /failed to fetch fee/i.test(outcomeText)
        const emptyWalletRejection = Number(coin.spendableBalance || 0) <= 0
          && /insufficient balance|no spendable .*utxo|balance is 0|zero spendable balance/i.test(outcomeText)
        if (hasCoreFailure || (hasFeeFailure && !emptyWalletRejection)) {
          throw new Error(`Fee request failed for ${coin.id}: ${outcome.text}`)
        }
        if (/invalid.*address|address.*invalid/i.test(outcome.text || '')) {
          throw new Error(`The wallet rejected its own ${coin.id} address: ${outcome.text}`)
        }
        preflight.outcome = outcome.kind
        preflight.message = outcome.text
        if (requireActiveRoutes && outcome.kind === 'rendered') {
          throw new Error(`Safe send preflight produced no result for active ${coin.id}: ${outcome.text}`)
        }
      }
      report.sendPreflight.push(preflight)
      process.stdout.write(`windows_functions_coin=${coin.id}:${preflight.outcome}\n`)
    }
    } else {
      process.stdout.write('windows_functions_coin_routes=skipped\n')
    }

    let screen = await navigate('#/app/history')
    const historyControls = await evaluate(`({ selects: [...document.querySelectorAll('select')].map((select) => select.options.length), body: document.body.innerText })`)
    if (historyControls.selects.length !== 3 || historyControls.selects[0] !== expectedCoinIds.length + 1) {
      throw new Error(`History filters are incomplete: ${JSON.stringify(historyControls.selects)}`)
    }
    report.routes.history = true

    for (const section of ['security', 'keys', 'seed', 'coins', 'display', 'language', 'about']) {
      screen = await navigate(`#/app/settings/${section}`)
      if (screen.length < 80) throw new Error(`Settings section is empty: ${section}`)
      report.routes[`settings:${section}`] = true
    }

    screen = await navigate('#/app/mining')
    const frameReady = await waitFor(() => evaluate(`(() => {
      const frame = document.querySelector('iframe[title="Altbase Mining"]')
      return frame ? { src: frame.src, loaded: Boolean(frame.contentWindow) } : null
    })()`), 'mining module frame', 20_000)
    report.mining.frame = frameReady
    report.mining.status = await evaluate(`window.altbaseWallet.mining.request({ method: 'status', params: {} })`)
    report.mining.verify = await evaluate(`window.altbaseWallet.mining.request({ method: 'verify', params: {} })`)
    report.mining.manifest = await evaluate(`window.altbaseWallet.mining.request({ method: 'manifest', params: {} })`)
    report.mining.catalog = await evaluate(`window.altbaseWallet.mining.request({ method: 'catalog', params: {} })`)
    report.mining.hardware = await evaluate(`window.altbaseWallet.mining.request({ method: 'hardware', params: {} })`)
    report.mining.jobs = await evaluate(`window.altbaseWallet.mining.request({ method: 'listJobs', params: {} })`)
    report.mining.installed = await evaluate(`window.altbaseWallet.mining.request({ method: 'installedMiners', params: {} })`)
    report.mining.settings = await evaluate(`window.altbaseWallet.mining.request({ method: 'settings', params: {} })`)
    for (const name of ['status', 'hardware', 'jobs', 'installed', 'settings']) {
      const value = report.mining[name]
      if (!value?.ok) throw new Error(`Mining read-only method failed: ${name} ${JSON.stringify(value)}`)
    }
    for (const name of ['verify', 'manifest', 'catalog']) {
      const value = report.mining[name]
      if (!value?.ok && !/not installed/i.test(value?.error || '')) {
        throw new Error(`Mining module state check failed: ${name} ${JSON.stringify(value)}`)
      }
    }

    await navigate('#/app')
    const locked = await evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find((item) => /lock wallet/i.test(item.textContent))
      if (!button) return false
      button.click()
      return true
    })()`)
    if (!locked) throw new Error('Lock-wallet control is missing')
    await waitFor(() => evaluate(`location.hash === '#/unlock' && Boolean(document.querySelector('input[type=password]'))`), 'rendered lock screen', 20_000)
    if (!await setValue('input[type=password]', password)) throw new Error('Unlock password input is missing')
    await evaluate(`document.querySelector('form')?.requestSubmit(); true`)
    await waitFor(() => evaluate(`location.hash === '#/app'`), 'unlock after full audit', 120_000)
    report.routes.lockUnlock = true

    const statusSummary = Object.fromEntries(report.coins.map((coin) => [coin.id, coin.status]))
    const compact = {
      coinCount: report.coins.length,
      statusSummary,
      nativeAddressChecks: report.nativeAddressChecks.map((item) => item.coin),
      network: report.network,
      snapshot: report.snapshot,
      sendPreflight: report.sendPreflight.map(({ coin, status, outcome }) => ({ coin, status, outcome })),
      routes: report.routes,
      mining: {
        frame: report.mining.frame,
        status: report.mining.status,
        verify: report.mining.verify,
        catalogCount: Array.isArray(report.mining.catalog?.result) ? report.mining.catalog.result.length : undefined,
        installedCount: Array.isArray(report.mining.installed?.result) ? report.mining.installed.result.length : undefined,
      },
      moduleLists: report.core.modules?.result,
    }
    process.stdout.write(`${JSON.stringify(compact, null, 2)}\nwindows_all_functions=passed\n`)
  } finally {
    await evaluate(`if (window.__altbaseE2eActivityTimer) window.clearInterval(window.__altbaseE2eActivityTimer); true`).catch(() => undefined)
    socket.close()
  }
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})

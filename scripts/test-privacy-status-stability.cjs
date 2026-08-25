'use strict'

const WebSocket = require('ws')

const port = Number(process.argv[2] || process.env.ALTBASE_CDP_PORT || 19498)
const endpoint = `http://127.0.0.1:${port}`
const warmupMs = Number(process.env.ALTBASE_E2E_PRIVACY_WARMUP_MS || 15 * 60_000)
const durationMs = Number(process.env.ALTBASE_E2E_PRIVACY_DURATION_MS || 10 * 60_000)
const sampleMs = Number(process.env.ALTBASE_E2E_PRIVACY_SAMPLE_MS || 5_000)
const privacyCoins = ['zano', 'epic', 'monero']
const routes = ['#/app', '#/app/send', '#/app/history']

if (process.env.ALTBASE_E2E_DISPOSABLE_PROFILE !== '1') {
  throw new Error('Refusing to monitor wallet controls outside an explicitly disposable E2E profile')
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const connect = async () => {
  const response = await fetch(`${endpoint}/json/list`)
  if (!response.ok) throw new Error(`CDP target list returned HTTP ${response.status}`)
  const targets = await response.json()
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
  const lastStatus = new Map()
  const activeSince = new Map()
  const transitions = []
  let routeIndex = 0

  const navigate = async (route) => {
    await evaluate(`(() => {
      window.dispatchEvent(new Event('altbase:user-activity'))
      location.hash = ${JSON.stringify(route)}
      return true
    })()`)
    await delay(800)
  }

  const readDashboard = async () => {
    await navigate('#/app')
    return evaluate(`(() => {
      const found = {}
      for (const anchor of [...document.querySelectorAll('a')].filter((item) => (item.getAttribute('href') || '').includes('/app/coin/'))) {
        const key = Object.keys(anchor).find((item) => item.startsWith('__reactFiber$'))
        let fiber = key ? anchor[key] : null
        while (fiber) {
          const coin = fiber.memoizedProps?.coin
          if (coin?.id && ${JSON.stringify(privacyCoins)}.includes(coin.id)) {
            found[coin.id] = {
              status: coin.status || '',
              balance: String(coin.balance ?? ''),
              spendableBalance: String(coin.spendableBalance ?? ''),
            }
            break
          }
          fiber = fiber.return
        }
      }
      return {
        coins: found,
        body: document.body?.innerText || '',
        hash: location.hash,
      }
    })()`)
  }

  const sample = async (phase) => {
    const state = await readDashboard()
    if (/native core exited|sanity check failed|non-monotonic output distribution|node rejected the transaction/i.test(state.body)) {
      throw new Error(`Fatal wallet message during privacy monitor:\n${state.body}`)
    }
    for (const coin of privacyCoins) {
      const status = state.coins?.[coin]?.status || 'missing'
      if (lastStatus.get(coin) !== status) {
        const entry = { at: new Date().toISOString(), phase, coin, from: lastStatus.get(coin) || null, to: status }
        transitions.push(entry)
        process.stdout.write(`privacy_transition=${JSON.stringify(entry)}\n`)
        lastStatus.set(coin, status)
      }
      if (status === 'active' && !activeSince.has(coin)) activeSince.set(coin, Date.now())
      if (activeSince.has(coin) && status !== 'active') {
        throw new Error(`${coin} regressed from active to ${status}`)
      }
    }
    return state
  }

  try {
    await evaluate(`(() => {
      if (window.__altbasePrivacyMonitorActivity) window.clearInterval(window.__altbasePrivacyMonitorActivity)
      window.__altbasePrivacyMonitorActivity = window.setInterval(
        () => window.dispatchEvent(new Event('altbase:user-activity')),
        30_000,
      )
      return true
    })()`)

    const warmupStarted = Date.now()
    while (activeSince.size !== privacyCoins.length && Date.now() - warmupStarted < warmupMs) {
      await sample('warmup')
      await delay(sampleMs)
    }
    if (activeSince.size !== privacyCoins.length) {
      const missing = privacyCoins.filter((coin) => !activeSince.has(coin))
      throw new Error(`Privacy coins did not become active during warmup: ${missing.join(', ')}`)
    }
    process.stdout.write(`privacy_warmup=passed elapsedMs=${Date.now() - warmupStarted}\n`)

    const stabilityStarted = Date.now()
    let samples = 0
    while (Date.now() - stabilityStarted < durationMs) {
      const route = routes[routeIndex % routes.length]
      routeIndex += 1
      await navigate(route)
      await delay(Math.min(2_000, sampleMs))
      await sample('stability')
      samples += 1
      await delay(sampleMs)
    }
    process.stdout.write(`${JSON.stringify({
      privacyStatusStability: 'passed',
      durationMs: Date.now() - stabilityStarted,
      samples,
      transitions,
      final: Object.fromEntries(lastStatus),
    }, null, 2)}\n`)
  } finally {
    try {
      await evaluate(`(() => {
        if (window.__altbasePrivacyMonitorActivity) window.clearInterval(window.__altbasePrivacyMonitorActivity)
        return true
      })()`)
    } catch {
      // The application may already have closed during a failed run.
    }
    socket.close()
  }
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})

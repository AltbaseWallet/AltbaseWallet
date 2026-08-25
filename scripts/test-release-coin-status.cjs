'use strict'

const WebSocket = require('ws')

const port = Number(process.argv[2] || process.env.ALTBASE_CDP_PORT || 19497)
const endpoint = `http://127.0.0.1:${port}`
const expectedCoins = ['zano', 'epic', 'monero', 'neoxa']

if (process.env.ALTBASE_E2E_DISPOSABLE_PROFILE !== '1') {
  throw new Error('Refusing to inspect wallet controls outside an explicitly disposable E2E profile')
}

const run = async () => {
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
  await call('Runtime.evaluate', {
    expression: `(() => {
      location.hash = '#/app'
      window.dispatchEvent(new Event('altbase:user-activity'))
      return true
    })()`,
    returnByValue: true,
  })
  await new Promise((resolve) => setTimeout(resolve, 1_000))
  const evaluated = await call('Runtime.evaluate', {
    expression: `(() => {
      const expected = ${JSON.stringify(expectedCoins)}
      const coins = {}
      for (const anchor of [...document.querySelectorAll('a')].filter((item) => (item.getAttribute('href') || '').includes('/app/coin/'))) {
        const key = Object.keys(anchor).find((item) => item.startsWith('__reactFiber$'))
        let fiber = key ? anchor[key] : null
        while (fiber) {
          const coin = fiber.memoizedProps?.coin
          if (coin?.id && expected.includes(coin.id)) {
            coins[coin.id] = {
              address: coin.address || '',
              status: coin.status || '',
              balance: String(coin.balance ?? ''),
              spendableBalance: String(coin.spendableBalance ?? ''),
              recoveryProgress: coin.recoveryProgress || null,
            }
            break
          }
          fiber = fiber.return
        }
      }
      const body = document.body?.innerText || ''
      return {
        hash: location.hash,
        coins,
        fatalMessage: (body.match(/native core exited|sanity check failed|non-monotonic output distribution|node rejected the transaction/i) || [])[0] || '',
      }
    })()`,
    awaitPromise: true,
    returnByValue: true,
  })
  socket.close()
  if (evaluated.exceptionDetails) {
    throw new Error(evaluated.exceptionDetails.exception?.description || 'Renderer evaluation failed')
  }
  const state = evaluated.result?.value
  const missing = expectedCoins.filter((coin) => !state?.coins?.[coin])
  if (missing.length) throw new Error(`Missing release coins at ${state?.hash || 'unknown route'}: ${missing.join(', ')}`)
  if (state.fatalMessage) throw new Error(`Fatal wallet message: ${state.fatalMessage}`)
  process.stdout.write(`${JSON.stringify(state)}\n`)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})

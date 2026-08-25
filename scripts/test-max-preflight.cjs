'use strict'

const WebSocket = require('ws')

if (process.env.ALTBASE_E2E_DISPOSABLE_PROFILE !== '1') {
  throw new Error('Refusing to inspect wallet controls outside an explicitly disposable E2E profile')
}

const port = Number(process.argv[2])
const coin = String(process.argv[3] || '').trim().toLowerCase()
const recipient = String(process.argv[4] || '').trim()
const expectation = String(process.argv[5] || 'amount').trim().toLowerCase()
if (!Number.isInteger(port) || !coin || !recipient || !['amount', 'insufficient'].includes(expectation)) {
  throw new Error('Usage: test-max-preflight.cjs <port> <coin> <recipient> <amount|insufficient>')
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const run = async () => {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const target = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl)
  if (!target) throw new Error('Altbase renderer target is missing')
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  let nextId = 0
  const pending = new Map()
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString())
    const slot = pending.get(message.id)
    if (!slot) return
    pending.delete(message.id)
    if (message.error) slot.reject(new Error(JSON.stringify(message.error)))
    else slot.resolve(message.result)
  })
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }), (error) => error ? reject(error) : undefined)
  })
  const evaluate = async (expression) => {
    const response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || 'Renderer evaluation failed')
    return response.result?.value
  }
  const waitFor = async (probe, label, timeoutMs) => {
    const startedAt = Date.now()
    let value
    while (Date.now() - startedAt < timeoutMs) {
      value = await probe()
      if (value) return value
      await delay(250)
    }
    throw new Error(`Timed out waiting for ${label}. Last value: ${JSON.stringify(value)}`)
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
    await call('Runtime.enable')
    await evaluate(`location.hash = '#/app'; true`)
    await waitFor(() => evaluate(`location.hash === '#/app'`), 'dashboard', 30_000)
    await evaluate(`location.hash = ${JSON.stringify(`#/app/send?coin=${coin}`)}; true`)
    await waitFor(
      () => evaluate(`location.hash === ${JSON.stringify(`#/app/send?coin=${coin}`)} && Boolean(document.querySelector('input[name=to]'))`),
      `${coin} send form`,
      30_000,
    )
    await waitFor(() => evaluate(`(() => {
      const head = (document.body?.innerText || '').split('\\n').slice(0, 30).join('\\n')
      return /Preparing|Syncing|Maintenance|Offline/i.test(head) ? false : true
    })()`), `${coin} active send state`, 180_000)
    if (!await setValue('input[name=to]', recipient)) throw new Error('Recipient input is missing')
    const clicked = await evaluate(`(() => {
      const button = document.querySelector('button[title="MAX"]')
        || [...document.querySelectorAll('button')].find((item) => /^max$/i.test((item.textContent || '').trim()))
      if (!button || button.disabled) return false
      button.click()
      return true
    })()`)
    if (!clicked) throw new Error('MAX button is unavailable')

    const result = await waitFor(() => evaluate(`(() => {
      const body = document.body?.innerText || ''
      const head = body.split('\\n').slice(0, 30).join('\\n')
      const amount = document.querySelector('input[name=amount]')?.value?.trim() || ''
      const validations = [...document.querySelectorAll('.text-rose-300')]
        .map((node) => (node.textContent || '').trim())
        .filter(Boolean)
      const validation = validations.join(' | ')
      if (/Preparing|Syncing|Maintenance|Offline/i.test(head)) return { pending: head, amount, validation }
      if (/^\\d+(\\.\\d+)?$/.test(amount) && Number(amount) > 0) return { pending: '', amount, validation }
      if (validation) return { pending: '', amount, validation }
      return null
    })()`), `${coin} MAX result`, 120_000)

    if (result.pending) throw new Error(`${coin} regressed to a pending status during MAX: ${result.pending}`)
    if (expectation === 'amount' && (!result.amount || Number(result.amount) <= 0)) {
      throw new Error(`${coin} MAX did not calculate a positive amount: ${result.validation}`)
    }
    if (expectation === 'insufficient' && !/insufficient|balance|network fee|funds/i.test(result.validation)) {
      throw new Error(`${coin} MAX did not reject a fee-only balance locally: ${JSON.stringify(result)}`)
    }
    process.stdout.write(`${JSON.stringify({ coin, expectation, ...result })}\n`)
  } finally {
    socket.close()
  }
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})

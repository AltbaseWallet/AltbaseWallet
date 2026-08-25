'use strict'

const WebSocket = require('ws')

const port = Number(process.argv[2] || process.env.ALTBASE_CDP_PORT || 9348)
const endpoint = `http://127.0.0.1:${port}`
const password = 'Altbase-E2E-Password-2026!'
const restorePhrase = String(process.env.ALTBASE_E2E_RESTORE_PHRASE || '').trim()
const preserveProfile = process.env.ALTBASE_E2E_PRESERVE_PROFILE === '1'

if (process.env.ALTBASE_E2E_DISPOSABLE_PROFILE !== '1') {
  throw new Error('Refusing to clear wallet data outside an explicitly disposable E2E profile')
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const connectTarget = async (target) => {
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  const pending = new Map()
  let nextId = 0
  const rejectPending = (error) => {
    for (const slot of pending.values()) slot.reject(error)
    pending.clear()
  }
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString())
    const slot = pending.get(message.id)
    if (!slot) return
    pending.delete(message.id)
    if (message.error) slot.reject(new Error(JSON.stringify(message.error)))
    else slot.resolve(message.result)
  })
  await new Promise((resolve, reject) => {
    const opened = () => {
      socket.off('error', failed)
      socket.off('close', closed)
      resolve()
    }
    const failed = (error) => {
      socket.off('open', opened)
      socket.off('close', closed)
      reject(error)
    }
    const closed = () => {
      socket.off('open', opened)
      socket.off('error', failed)
      reject(new Error('CDP socket closed before opening'))
    }
    socket.once('open', opened)
    socket.once('error', failed)
    socket.once('close', closed)
  })
  socket.on('close', () => rejectPending(new Error('CDP socket closed')))
  socket.on('error', (error) => rejectPending(error))

  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId
    if (socket.readyState !== WebSocket.OPEN) {
      reject(new Error('CDP WebSocket is not open'))
      return
    }
    pending.set(id, { resolve, reject })
    try {
      socket.send(JSON.stringify({ id, method, params }), (error) => {
        if (!error) return
        const slot = pending.get(id)
        if (!slot) return
        pending.delete(id)
        slot.reject(error)
      })
    } catch (error) {
      pending.delete(id)
      reject(error)
    }
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

const connect = async () => {
  const response = await fetch(`${endpoint}/json/list`)
  if (!response.ok) throw new Error(`CDP target list returned HTTP ${response.status}`)
  const targets = await response.json()
  const candidates = targets.filter((item) => item.type === 'page' && item.webSocketDebuggerUrl)
  if (candidates.length === 0) throw new Error('Altbase renderer CDP target is missing')

  let lastError
  for (const target of candidates) {
    try {
      return await connectTarget(target)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError ?? new Error('Altbase renderer CDP connection failed')
}

const connectWithRetry = async (timeoutMs = 20_000) => {
  const started = Date.now()
  let lastError
  while (Date.now() - started < timeoutMs) {
    try {
      return await connect()
    } catch (error) {
      lastError = error
      await delay(200)
    }
  }
  throw new Error(`Timed out reconnecting to Altbase renderer: ${lastError?.message ?? 'unknown error'}`)
}

const run = async () => {
  let session = await connectWithRetry()
  const transientCdpError = (error) => /Inspected target navigated or closed|Target closed|CDP socket|WebSocket is not open|ECONNREFUSED|fetch failed|renderer CDP target is missing/i.test(error?.message ?? '')
  const reconnect = async () => {
    try {
      session.socket.close()
    } catch {
      // The renderer may already have closed the old target during navigation.
    }
    session = await connectWithRetry()
  }
  const evaluate = async (expression) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await session.evaluate(expression)
      } catch (error) {
        if (!transientCdpError(error) || attempt === 2) throw error
        await reconnect()
      }
    }
    throw new Error('Renderer evaluation retry limit was reached')
  }
  const resetToWelcome = async () => {
    try {
      // Reload immediately after clearing storage. Delaying the navigation can
      // let the mounted application persist the in-memory wallet again.
      await session.evaluate(`localStorage.clear(); location.hash = '#/welcome'; location.reload(); true`)
    } catch (error) {
      if (!transientCdpError(error)) throw error
    }
    await delay(100)
    await reconnect()
  }
  const bodyText = () => evaluate('document.body?.innerText || ""')
  const waitFor = async (predicate, label, timeoutMs = 30_000) => {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      const value = await predicate()
      if (value) return value
      await delay(200)
    }
    throw new Error(`Timed out waiting for ${label}. Last screen:\n${await bodyText()}`)
  }
  const waitForText = (text, timeoutMs) => waitFor(
    async () => (await bodyText()).includes(text),
    JSON.stringify(text),
    timeoutMs,
  )
  const clickText = async (text) => {
    const clicked = await evaluate(`(() => {
      const target = [...document.querySelectorAll('button, a')]
        .find((item) => item.textContent.trim() === ${JSON.stringify(text)})
      if (!target) return false
      target.click()
      return true
    })()`)
    if (!clicked) throw new Error(`Clickable element is missing: ${text}`)
  }
  const setInputs = (selector, values) => evaluate(`(() => {
    const inputs = [...document.querySelectorAll(${JSON.stringify(selector)})]
    const values = ${JSON.stringify(values)}
    if (inputs.length !== values.length) return { found: inputs.length, expected: values.length }
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    inputs.forEach((input, index) => {
      setter.call(input, values[index])
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    return { found: inputs.length, expected: values.length }
  })()`)
  const submitForm = () => evaluate('document.querySelector("form")?.requestSubmit()')
  const storedWallet = () => evaluate(`(() => {
    const raw = localStorage.getItem('altbase_wallet:wallet-meta')
    return raw ? JSON.parse(raw) : null
  })()`)

  try {
    await evaluate(`(() => {
      if (window.__altbaseE2eActivityTimer) window.clearInterval(window.__altbaseE2eActivityTimer)
      window.__altbaseE2eActivityTimer = window.setInterval(
        () => window.dispatchEvent(new Event('altbase:user-activity')),
        30000,
      )
      return true
    })()`)
    if (process.env.ALTBASE_E2E_EPIC_CACHE_DIAGNOSTIC === '1') {
      if (!restorePhrase) throw new Error('ALTBASE_E2E_RESTORE_PHRASE is required for Epic cache diagnostics')
      const diagnostic = await evaluate(`(async () => {
        const phrase = ${JSON.stringify(restorePhrase.trim().toLowerCase())}
        const encoder = new TextEncoder()
        const toBase64Url = (bytes) => btoa(String.fromCharCode(...bytes))
          .replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/g, '')
        const fromBase64Url = (value) => {
          const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
          return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
        }
        const digest = new Uint8Array(await crypto.subtle.digest(
          'SHA-256',
          encoder.encode('altbase-privacy-cache-id-v1|epic|' + phrase),
        ))
        const backupId = toBase64Url(digest)
        const caches = JSON.parse(localStorage.getItem('altbase_wallet:privacy-wallet-cache:v1') || '{}')
        const envelope = caches['epic:' + backupId]
        if (!envelope?.encryptedBlob) throw new Error('Encrypted Epic cache is missing')
        const packed = fromBase64Url(envelope.encryptedBlob)
        const nonce = envelope.nonce ? fromBase64Url(envelope.nonce) : packed.subarray(0, 12)
        const cipherText = envelope.nonce ? packed : packed.subarray(12)
        const material = await crypto.subtle.importKey('raw', encoder.encode(phrase), 'HKDF', false, ['deriveKey'])
        const key = await crypto.subtle.deriveKey({
          name: 'HKDF',
          hash: 'SHA-256',
          salt: encoder.encode('altbase-privacy-cache-salt-v1|epic'),
          info: encoder.encode('altbase-wallet-cache-backup-v1'),
        }, material, { name: 'AES-GCM', length: 256 }, false, ['decrypt'])
        const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, cipherText)
        const state = JSON.parse(new TextDecoder().decode(clear))
        const transactions = Array.isArray(state.transactions) ? state.transactions : []
        const incoming = transactions.filter((tx) => String(tx?.type || tx?.direction || '').toLowerCase().includes('incoming'))
        const unspent = incoming.filter((tx) => tx?.spent !== true)
        const archiveText = state.nativeWalletFileBlob
          ? atob(state.nativeWalletFileBlob.replace(/-/g, '+').replace(/_/g, '/'))
          : ''
        const files = []
        for (const line of archiveText.split(/\\r?\\n/).slice(1)) {
          if (!line) continue
          const fields = line.split('\\t')
          if (fields.length !== 4 || fields[0] !== 'FILE') continue
          const bytes = atob(fields[3])
          files.push({
            key: fields[1],
            size: Number(fields[2]),
            sentTokens: (bytes.match(/\"tx_type\":\"TxSent/g) || []).length,
            receivedTokens: (bytes.match(/\"tx_type\":\"TxReceived/g) || []).length,
            marker: fields[1] === 'altbase.restore-scan.done' ? bytes : undefined,
          })
        }
        return {
          version: state.version,
          balance: state.balance,
          spendable: state.spendable,
          transactionCount: transactions.length,
          incomingCount: incoming.length,
          unspentIncomingCount: unspent.length,
          unspentIncomingTotal: unspent.reduce((sum, tx) => sum + Number(tx?.amount || 0), 0),
          unspentIncoming: unspent.map((tx) => ({
            txid: String(tx?.txid || tx?.id || ''),
            amount: String(tx?.amount || '0'),
            height: Number(tx?.height || 0),
            confirmations: Number(tx?.confirmations || 0),
            status: String(tx?.status || ''),
          })),
          lastScannedHeight: state.lastScannedHeight,
          nativeWalletFileSize: state.nativeWalletFileSize,
          archiveMagicValid: archiveText.startsWith('ALTBASE_EPIC_WALLET_ARCHIVE_V1\\n'),
          files,
        }
      })()`)
      process.stdout.write(`${JSON.stringify(diagnostic, null, 2)}\n`)
      return
    }
    if (process.env.ALTBASE_E2E_PUBLIC_STATE === '1') {
      // A raw Monero snapshot without the wallet service's encrypted restore
      // checkpoint would intentionally scan from height zero. Keep this probe
      // limited to engines whose snapshot is safe without cached state.
      const privacyProbeCoin = ['zano', 'epic'].includes(process.env.ALTBASE_E2E_PRIVACY_PROBE)
        ? process.env.ALTBASE_E2E_PRIVACY_PROBE
        : ''
      const state = await evaluate(`(async () => {
        const raw = localStorage.getItem('altbase_wallet:wallet-addresses')
        const addresses = raw ? JSON.parse(raw) : {}
        const dashboardCoins = []
        for (const anchor of [...document.querySelectorAll('a')].filter((item) => (item.getAttribute('href') || '').includes('/app/coin/'))) {
          const key = Object.keys(anchor).find((item) => item.startsWith('__reactFiber$'))
          let fiber = key ? anchor[key] : null
          while (fiber) {
            const coin = fiber.memoizedProps?.coin
            if (coin?.id) {
              dashboardCoins.push({
                id: coin.id,
                address: coin.address || '',
                status: coin.status || '',
                balance: String(coin.balance ?? ''),
                spendableBalance: String(coin.spendableBalance ?? ''),
                recoveryProgress: coin.recoveryProgress || null,
              })
              break
            }
            fiber = fiber.return
          }
        }
        let privacyProbe = null
        const probeCoin = ${JSON.stringify(privacyProbeCoin)}
        if (probeCoin) {
          const phrase = ${JSON.stringify(restorePhrase)}
          if (!phrase) throw new Error('ALTBASE_E2E_RESTORE_PHRASE is required for a privacy probe')
          const response = await window.altbaseWallet?.core?.({
            method: 'privacyLightWallet',
            params: {
              action: 'snapshot',
              coin: probeCoin,
              phrase,
              debugZanoStatus: probeCoin === 'zano' && ${JSON.stringify(process.env.ALTBASE_E2E_ZANO_DEBUG === '1')}
                ? 'true'
                : undefined,
            },
          })
          privacyProbe = {
            ok: response?.ok ?? false,
            error: response?.error || '',
            result: response?.result ? {
              ok: response.result.ok || '',
              code: response.result.code || '',
              error: response.result.error || '',
              address: response.result.address || '',
              balance: response.result.balance || '',
              spendable: response.result.spendable || '',
              lastScannedHeight: response.result.lastScannedHeight || response.result.last_scanned_height || '',
            } : null,
          }
        }
        return { hash: location.hash, addresses, dashboardCoins, privacyProbe }
      })()`)
      process.stdout.write(`${JSON.stringify(state, null, 2)}\n`)
      return
    }

    if (process.env.ALTBASE_E2E_INSPECT_ONLY === '1') {
      process.stdout.write(`${await bodyText()}\n`)
      return
    }

    if (process.env.ALTBASE_E2E_UNLOCK_ONLY === '1') {
      const unlockScreenPattern = /unlock (?:wallet|altbase)/i
      await waitFor(async () => unlockScreenPattern.test(await bodyText()), 'unlock screen', 20_000)
      const unlockInputs = await setInputs('input[type=password]', [password])
      if (unlockInputs.found !== unlockInputs.expected) {
        throw new Error(`Unlock password inputs: ${JSON.stringify(unlockInputs)}`)
      }
      await delay(300)
      await submitForm()
      await waitFor(async () => !unlockScreenPattern.test(await bodyText()), 'unlocked wallet', 45_000)
      if (process.env.ALTBASE_E2E_KEEP_ACTIVE === '1') {
        await evaluate(`(() => {
          if (window.__altbaseE2eActivityTimer) window.clearInterval(window.__altbaseE2eActivityTimer)
          window.__altbaseE2eActivityTimer = window.setInterval(
            () => window.dispatchEvent(new Event('altbase:user-activity')),
            30000,
          )
          return true
        })()`)
      }
      process.stdout.write('windows_ui_unlock_wallet=passed\n')
      return
    }

    // This harness is only run against an explicitly disposable E2E profile.
    const restoreOnly = process.env.ALTBASE_E2E_RESTORE_ONLY === '1'
    if (restoreOnly && !restorePhrase) {
      throw new Error('ALTBASE_E2E_RESTORE_PHRASE is required for restore verification')
    }
    if (!preserveProfile) await resetToWelcome()
    if (!restoreOnly) {
      await waitForText('Create new wallet')
    await clickText('Create new wallet')
    await waitFor(async () => (await evaluate('document.querySelectorAll("input[type=password]").length')) === 2, 'create password inputs')
    const createInputs = await setInputs('input[type=password]', [password, password])
    if (createInputs.found !== createInputs.expected) throw new Error(`Create password inputs: ${JSON.stringify(createInputs)}`)
    await delay(300)
    await submitForm()
    await waitForText('Save your seed phrase', 30_000)
    const createScreen = await bodyText()
    if (/native core exited|Seed phrase must contain/i.test(createScreen)) throw new Error(createScreen)

    const generatedWords = await evaluate(`[...document.querySelectorAll('span.font-medium.text-slate-100')]
      .map((item) => item.textContent.trim())
      .filter((word) => /^[a-z]+$/.test(word))`)
    if (!Array.isArray(generatedWords) || generatedWords.length !== 12) {
      throw new Error(`Generated seed has ${generatedWords?.length ?? 0} visible words`)
    }
    const checked = await evaluate(`(() => {
      const boxes = [...document.querySelectorAll('input[type=checkbox]')]
      boxes.forEach((box) => { if (!box.checked) box.click() })
      return boxes.length
    })()`)
    if (checked !== 2) throw new Error(`Seed safety checkbox count is ${checked}`)
    await clickText('Continue')
    await waitForText('Confirm your seed phrase')
    const confirmation = await evaluate(`(() => {
      const words = ${JSON.stringify(generatedWords)}
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      const labels = [...document.querySelectorAll('label')].filter((label) => label.querySelector('input'))
      let completed = 0
      for (const label of labels) {
        const match = label.textContent.match(/(\\d+)/)
        if (!match) continue
        const position = Number(match[1])
        const input = label.querySelector('input')
        setter.call(input, words[position - 1])
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
        completed += 1
      }
      return completed
    })()`)
    if (confirmation !== 3) throw new Error(`Seed confirmation input count is ${confirmation}`)
    await delay(500)
    await clickText('Finish creation')
    const createdMeta = await waitFor(storedWallet, 'created wallet metadata', 45_000)
    if (createdMeta.version !== 2 || !createdMeta.encryptedMnemonic?.cipherText) {
      throw new Error('Created wallet metadata is incomplete')
    }
      process.stdout.write('windows_ui_create_wallet=passed\n')
      if (!restorePhrase) return
      await resetToWelcome()
    }
    if (preserveProfile) {
      await evaluate(`location.hash = '#/restore'; true`)
    } else {
      const restoreEntryText = await waitFor(async () => {
        const screen = await bodyText()
        return ['Restore from seed phrase', 'Restore wallet from seed phrase']
          .find((label) => screen.includes(label))
      }, 'restore-wallet entry', 20_000)
      await clickText(restoreEntryText)
    }
    await waitForText('Restore wallet')
    await waitFor(
      async () => (await evaluate('document.querySelectorAll("input:not([type=password]):not([type=checkbox])").length')) === 12,
      'restore seed inputs',
      20_000,
    )
    const walletBeforeRestore = await storedWallet()
    const seedWords = restorePhrase.split(' ')
    const seedInputs = await setInputs('input:not([type=password]):not([type=checkbox])', seedWords)
    if (seedInputs.found !== seedInputs.expected) throw new Error(`Restore seed inputs: ${JSON.stringify(seedInputs)}`)
    const restorePasswords = await setInputs('input[type=password]', [password, password])
    if (restorePasswords.found !== restorePasswords.expected) throw new Error(`Restore password inputs: ${JSON.stringify(restorePasswords)}`)
    const restoreChecks = await evaluate(`(() => {
      const boxes = [...document.querySelectorAll('input[type=checkbox]')]
      boxes.forEach((box) => { if (!box.checked) box.click() })
      return boxes.length
    })()`)
    if (restoreChecks !== 1) throw new Error(`Restore safety checkbox count is ${restoreChecks}`)
    await delay(500)
    await submitForm()
    const restoredMeta = await waitFor(async () => {
      const screen = await bodyText()
      if (/native core exited|Seed phrase must contain 12 valid BIP39 words/i.test(screen)) throw new Error(screen)
      const current = await storedWallet()
      if (!current) return null
      if (!walletBeforeRestore) return current
      return current.walletFingerprint !== walletBeforeRestore.walletFingerprint
        || current.encryptedMnemonic?.cipherText !== walletBeforeRestore.encryptedMnemonic?.cipherText
        ? current
        : null
    }, 'restored wallet metadata', 90_000)
    if (restoredMeta.version !== 2 || !restoredMeta.encryptedMnemonic?.cipherText) {
      throw new Error('Restored wallet metadata is incomplete')
    }
    await waitFor(async () => {
      const screen = await bodyText()
      return (await evaluate('location.hash')) === '#/app' && screen.includes('Coins')
    }, 'restored wallet dashboard', 180_000)
    process.stdout.write('windows_ui_restore_wallet=passed\n')
  } finally {
    if (process.env.ALTBASE_E2E_KEEP_ACTIVE !== '1') {
      await evaluate(`if (window.__altbaseE2eActivityTimer) window.clearInterval(window.__altbaseE2eActivityTimer); true`).catch(() => undefined)
    }
    session.socket.close()
  }
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})

'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')

const root = path.resolve(__dirname, '..', '..')
const outputArg = process.argv.find((argument) => argument.startsWith('--output='))
const coinsArg = process.argv.find((argument) => argument.startsWith('--coins='))
const outputPath = outputArg
  ? path.resolve(root, outputArg.slice('--output='.length))
  : path.join(root, 'build-logs', 'gui-transaction-qa.json')
const requestedCoins = coinsArg
  ? new Set(coinsArg.slice('--coins='.length).split(',').map((value) => value.trim()).filter(Boolean))
  : null

const coinIds = [
  'bitcoin',
  'bitcoin2',
  'bitcoincashii',
  'firo',
  'btgs',
  'capstash',
  'hypercoin',
  'mydogecoin',
  'pepecoin',
  'kerrigan',
  'scash',
  'litecoinii',
  'neoxa',
  'terracoin',
  'junkcoin',
  'raptoreum',
  'zano',
  'epic',
  'quai',
  'pearl',
  'qubic',
  'kaspa',
  'ckb',
]

const sendMatrix = [
  { id: 'bitcoin', source: 'A', amount: '0.00001', expected: 'zero-balance' },
  { id: 'bitcoin2', source: 'B', amount: '0.01' },
  { id: 'bitcoincashii', source: 'A', amount: '0.01' },
  { id: 'firo', source: 'A', amount: '0.01' },
  { id: 'btgs', source: 'A', amount: '0.01' },
  { id: 'capstash', source: 'A', amount: '0.01' },
  { id: 'hypercoin', source: 'A', amount: '0.01' },
  { id: 'mydogecoin', source: 'A', amount: '0.01' },
  { id: 'pepecoin', source: 'A', amount: '1' },
  { id: 'kerrigan', source: 'A', amount: '0.01' },
  { id: 'scash', source: 'A', amount: '0.01' },
  { id: 'litecoinii', source: 'A', amount: '0.01' },
  { id: 'neoxa', source: 'A', amount: '1' },
  { id: 'terracoin', source: 'A', amount: '0.01' },
  { id: 'junkcoin', source: 'A', amount: '1' },
  { id: 'raptoreum', source: 'A', amount: '1' },
  { id: 'zano', source: 'A', amount: '0.01' },
  { id: 'epic', source: 'A', amount: '0.01' },
  { id: 'quai', source: 'A', amount: '0.01' },
  { id: 'pearl', source: 'A', amount: '0.01' },
  { id: 'qubic', source: 'B', amount: '1' },
  { id: 'kaspa', source: 'B', amount: '1' },
  { id: 'ckb', source: 'A', amount: '61' },
]

const saveReport = (report) => {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

const pageForPort = async (port) => {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  const page = browser.contexts()[0]?.pages()[0]
  if (!page) throw new Error(`No Electron page found on port ${port}`)
  return { browser, page }
}

const readCoinCards = async (page) => {
  await page.evaluate(() => { location.hash = '#/app' })
  await page.waitForTimeout(500)
  return page.locator('a[href*="/app/coin/"]').evaluateAll((nodes) => nodes.map((node) => {
    const id = (node.getAttribute('href') ?? '').split('/').pop()
    const lines = (node.parentElement?.innerText ?? '').split(/\n+/).map((value) => value.trim()).filter(Boolean)
    return {
      id,
      name: lines[0] ?? '',
      market: lines[1] ?? '',
      balance: lines[2] ?? '',
      fiat: lines[3] ?? '',
      status: lines.slice(4).join(' '),
    }
  }))
}

const readReceiveAddresses = async (page) => {
  const rows = []
  for (const id of coinIds) {
    await page.evaluate((coinId) => { location.hash = `#/app/receive?coin=${coinId}` }, id)
    await page.waitForTimeout(120)
    const copyButton = page.getByRole('button', { name: 'Copy address', exact: true })
    try {
      await copyButton.waitFor({ state: 'visible', timeout: 5_000 })
      const cardText = await copyButton.evaluate((node) => node.parentElement?.innerText ?? '')
      const lines = cardText.split(/\n+/).map((value) => value.trim()).filter(Boolean)
      const start = lines.indexOf('Address')
      const warning = lines.findIndex((value) => value.startsWith('Send only'))
      const candidates = lines
        .slice(start + 1, warning > start ? warning : undefined)
        .filter((value) => !value.includes('...'))
        .sort((left, right) => right.length - left.length)
      rows.push({ id, address: candidates[0] ?? '', error: '' })
    } catch (error) {
      rows.push({ id, address: '', error: error instanceof Error ? error.message : String(error) })
    }
  }
  return rows
}

const errorLinesFrom = (text) => text
  .split('\n')
  .map((value) => value.trim())
  .filter((value) => /invalid|unavailable|exceeds|insufficient|preparing|pending outgoing|network is not ready|balance/i.test(value))
  .slice(-10)

const validateSendForm = async (item, pages, addressMaps) => {
  const page = pages[item.source]
  const destinationProfile = item.source === 'A' ? 'B' : 'A'
  const destination = addressMaps[destinationProfile][item.id]
  await page.evaluate((coinId) => { location.hash = `#/app/send?coin=${coinId}` }, item.id)
  await page.waitForTimeout(300)
  await page.locator('input[name="to"]').fill(destination)
  await page.locator('input[name="amount"]').fill(item.amount)

  const continueButton = page.getByRole('button', { name: 'Continue', exact: true })
  const deadline = Date.now() + 25_000
  while (Date.now() < deadline) {
    if (await continueButton.isEnabled().catch(() => false)) break
    const body = await page.locator('body').innerText()
    if (/network is not ready|still preparing|pending outgoing|exceeds your available balance|insufficient balance/i.test(body)) break
    await page.waitForTimeout(350)
  }

  const enabledBeforeClick = await continueButton.isEnabled().catch(() => false)
  let modalText = ''
  if (enabledBeforeClick) {
    await continueButton.click()
    const title = page.getByRole('heading', { name: 'Confirm transaction', exact: true })
    await title.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined)
    if (await title.isVisible().catch(() => false)) {
      modalText = await title.evaluate((node) => node.parentElement?.parentElement?.innerText ?? '')
      await page.getByRole('button', { name: 'Close', exact: true }).click()
      await page.waitForTimeout(100)
    }
  }

  const bodyText = await page.locator('body').innerText()
  return {
    ...item,
    destinationProfile,
    destination,
    enabledBeforeClick,
    modalText,
    errorLines: errorLinesFrom(bodyText),
    checkedAt: new Date().toISOString(),
  }
}

const main = async () => {
  const [{ browser: browserA, page: pageA }, { browser: browserB, page: pageB }] = await Promise.all([
    pageForPort(9224),
    pageForPort(9223),
  ])
  const report = {
    startedAt: new Date().toISOString(),
    ports: { A: 9224, B: 9223 },
    coins: coinIds,
    balances: {},
    addresses: {},
    validations: [],
  }
  try {
    console.log('[gui-qa] reading balances')
    const [balancesA, balancesB] = await Promise.all([readCoinCards(pageA), readCoinCards(pageB)])
    report.balances = { A: balancesA, B: balancesB }
    saveReport(report)

    console.log('[gui-qa] reading receive addresses')
    const [addressesA, addressesB] = await Promise.all([readReceiveAddresses(pageA), readReceiveAddresses(pageB)])
    report.addresses = { A: addressesA, B: addressesB }
    saveReport(report)
    const addressMaps = {
      A: Object.fromEntries(addressesA.map((row) => [row.id, row.address])),
      B: Object.fromEntries(addressesB.map((row) => [row.id, row.address])),
    }

    const pages = { A: pageA, B: pageB }
    for (const item of sendMatrix) {
      if (requestedCoins && !requestedCoins.has(item.id)) continue
      console.log(`[gui-qa] validating ${item.id} from profile ${item.source}`)
      try {
        report.validations.push(await validateSendForm(item, pages, addressMaps))
      } catch (error) {
        report.validations.push({
          ...item,
          error: error instanceof Error ? error.message : String(error),
          checkedAt: new Date().toISOString(),
        })
      }
      saveReport(report)
    }

    await Promise.all([
      pageA.screenshot({ path: path.join(path.dirname(outputPath), 'gui-profile-a.png'), type: 'png' }),
      pageB.screenshot({ path: path.join(path.dirname(outputPath), 'gui-profile-b.png'), type: 'png' }),
    ])
    report.finishedAt = new Date().toISOString()
    saveReport(report)
    console.log(`[gui-qa] report: ${outputPath}`)
  } finally {
    // These are live user-visible Electron processes. Exiting this QA client
    // must only drop the CDP sockets, never close or lock either wallet window.
    void browserA
    void browserB
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exitCode = 1
})

'use strict'
// Creates an ephemeral released-format fixture, never a real user's profile.
const { app, BrowserWindow, session } = require('electron')
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const { NativeCoreClient } = require('../electron/native-core-client.cjs')
const root = process.env.ALTBASE_QA_RUN_DIRECTORY, password = process.env.ALTBASE_QA_PROFILE_PASSWORD
if (!root || !password) throw Error('Isolated fixture configuration is required')
const directory = path.join(root, 'config/Altbase Profiles/qa')
fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
app.setPath('userData', directory); app.disableHardwareAcceleration()
const client = new NativeCoreClient({ isPackaged: false, getPath: () => directory }, 'released-profile-fixture')
app.whenReady().then(async () => {
  let window
  try {
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }))
    const generated = await client.request('generatePhrase', {})
    const sealed = await client.request('createWalletSecret', { phrase: generated.phrase, password, requirePhraseAcknowledgement: 'false' })
    const digest = crypto.createHash('sha256').update(generated.phrase).digest('hex'); generated.phrase = null
    const meta = { isCreated: true, version: 2, verifyHash: sealed.verifyHash, verifySalt: sealed.verifySalt,
      encryptedMnemonic: { cipherText: sealed.cipherText, iv: sealed.iv, salt: sealed.salt } }
    window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
    // Use a different file URL, as an older install would, with the released key.
    const blank = path.join(root, 'old-application-location/index.html'); fs.mkdirSync(path.dirname(blank), { recursive: true })
    fs.writeFileSync(blank, '<!doctype html><title>Offline released-profile fixture</title>')
    await window.loadFile(blank)
    await window.webContents.executeJavaScript(`localStorage.setItem('altbase_wallet:wallet-meta',${JSON.stringify(JSON.stringify(meta))})`)
    session.defaultSession.flushStorageData()
    fs.writeFileSync(path.join(root, 'seed-receipt.json'), JSON.stringify({ releasedNativeEnvelope: true, releasedNamespace: true,
      profileName: 'qa', generatedFixtureOnly: true, digest }) + '\n')
    client.stop(); window.destroy(); app.quit()
  } catch { client.stop(); window?.destroy(); console.error('Released-profile fixture setup failed'); app.exit(1) }
})

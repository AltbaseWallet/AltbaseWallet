'use strict'
// Offline owner tooling. Does not upload, start a server or touch wallet profiles.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const { signCatalog, downloadUrl } = require('../electron/plugins/catalog.cjs')
const protectedPath = value => /wallet[ _-]?secret/i.test(value)
function file(value) { if (!value || protectedPath(value)) throw Error('Invalid catalog file path'); return path.resolve(value) }
const [command, ...args] = process.argv.slice(2)
if (command === 'keygen') {
  const directory = file(args[0]), url = downloadUrl(args[1])
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const privateFile = path.join(directory, 'catalog-signing-private.pem')
  if (fs.existsSync(privateFile)) throw Error('An owner key already exists; refusing to overwrite it')
  const pair = crypto.generateKeyPairSync('ed25519')
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' })
  fs.writeFileSync(privateFile, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 })
  fs.writeFileSync(path.join(directory, 'module-catalog.json'), JSON.stringify({ url, publicKey }, null, 2) + '\n', { flag: 'wx' })
  console.log('Owner signing key and public wallet configuration created. No upload performed.')
} else if (command === 'sign') {
  const [inputFile, keyFile, outputFile] = args.map(file)
  if (!inputFile || !keyFile || !outputFile || new Set([inputFile, keyFile, outputFile]).size !== 3) throw Error('Use distinct input, signing-key and output files')
  const definition = JSON.parse(fs.readFileSync(inputFile, 'utf8'))
  const issuedAt = new Date(), expiresAt = new Date(issuedAt.getTime() + 6 * 86400000)
  const envelope = signCatalog({ schemaVersion: 1, application: 'altbase-wallet', issuedAt: issuedAt.toISOString(), expiresAt: expiresAt.toISOString(), modules: definition.modules }, fs.readFileSync(keyFile, 'utf8'))
  const output = outputFile + '.tmp-' + crypto.randomBytes(8).toString('hex')
  try { fs.writeFileSync(output, JSON.stringify(envelope) + '\n', { flag: 'wx' }); fs.renameSync(output, outputFile) }
  finally { fs.rmSync(output, { force: true }) }
  console.log('Signed module catalog written. No upload performed.')
} else {
  console.log('Usage:\n  node scripts/module-catalog.cjs keygen <owner-directory> <https-catalog-url>\n  node scripts/module-catalog.cjs sign <modules.json> <private-key.pem> <catalog.json>')
  process.exitCode = 1
}

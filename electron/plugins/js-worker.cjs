'use strict'
const fs = require('node:fs')
const readline = require('node:readline')
const path = require('node:path')
const write = value => process.stdout.write(JSON.stringify(value) + '\n')
// Plugin code has the same trust level as an installed native library. Keeping
// it in a child process contains crashes; this is not an OS security sandbox.
for (const key of ['log', 'info', 'warn', 'error', 'debug']) console[key] = () => {}
async function main() {
  const filename = process.argv[2], manifestFile = process.argv[3]
  const definition = JSON.parse(fs.readFileSync(manifestFile, 'utf8').replace(/^\uFEFF/, ''))
  const factory = require(filename)
  const runtime = await factory.createPlugin({ dataDirectory: process.env.ALTBASE_PLUGIN_DATA_DIR, moduleDirectory: path.dirname(manifestFile) })
  if (typeof runtime?.request !== 'function') throw Error('Invalid plugin runtime')
  write(definition)
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
  let method = null, queue = Promise.resolve()
  lines.on('line', line => {
    if (Buffer.byteLength(line) > 2 * 1024 * 1024) process.exit(70)
    if (method === null) { method = line; return }
    const operation = method; method = null
    queue = queue.then(async () => {
      try { write({ ok: true, result: await runtime.request(operation, JSON.parse(line)) }) }
      catch { write({ ok: false, error: 'Module operation failed' }) }
    }).catch(() => process.exit(71))
  })
  lines.on('close', () => { queue.finally(async () => { await runtime.close?.(); process.exit(0) }) })
}
main().catch(() => process.exit(65))

'use strict'
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..'), directory = path.join(root, 'local-checks', 'released-profile-' + Date.now())
fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
const env = { ...process.env, ALTBASE_QA_RUN_DIRECTORY: directory, ALTBASE_QA_PROFILE_PASSWORD: crypto.randomBytes(24).toString('hex'),
  XDG_CONFIG_HOME: path.join(directory, 'config'), UV_THREADPOOL_SIZE: '1', RAYON_NUM_THREADS: '1' }
delete env.ELECTRON_RUN_AS_NODE
const seeded = spawnSync(path.join(root, 'node_modules/electron/dist/electron'), ['--no-sandbox', 'scripts/qa-seed-released-profile.cjs'],
  { cwd: root, env, encoding: 'utf8', timeout: 60000 })
fs.writeFileSync(path.join(directory, 'seeder.log'), (seeded.stdout || '') + (seeded.stderr || ''))
if (seeded.status !== 0) throw Error('Offline released-profile fixture could not be created')
env.ALTBASE_QA_PHRASE_DIGEST = JSON.parse(fs.readFileSync(path.join(directory, 'seed-receipt.json'), 'utf8')).digest
const result = spawnSync(process.execPath, ['scripts/qa-packaged-smoke.cjs', '--existing-profile'], { cwd: root, env, stdio: 'inherit', timeout: 90000 })
if (result.error) throw result.error
process.exitCode = result.status ?? 1

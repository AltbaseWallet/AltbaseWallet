const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const pkg = require(path.join(root, 'package.json'))

const candidates = [
  path.join(root, '.tools', 'InnoSetup', 'ISCC.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
  path.join(process.env['ProgramFiles(x86)'] || '', 'Inno Setup 6', 'ISCC.exe'),
  path.join(process.env.ProgramFiles || '', 'Inno Setup 6', 'ISCC.exe'),
].filter(Boolean)

const iscc = candidates.find((candidate) => fs.existsSync(candidate))
if (!iscc) {
  console.error('Inno Setup compiler was not found. Expected .tools/InnoSetup/ISCC.exe or a normal Inno Setup install.')
  process.exit(1)
}

const sourceDir = path.join(root, 'release', 'win-unpacked')
const outputDir = path.join(root, 'release')
const script = path.join(root, 'installer', 'inno', 'AltbaseWallet.iss')

if (!fs.existsSync(path.join(sourceDir, 'Altbase Wallet.exe'))) {
  console.error(`Missing packaged app: ${path.join(sourceDir, 'Altbase Wallet.exe')}`)
  console.error('Run npm run dist:win:dir before building the Inno installer.')
  process.exit(1)
}

const args = [
  `/DMyAppVersion=${pkg.version}`,
  `/DSourceDir=${sourceDir}`,
  `/DOutputDir=${outputDir}`,
  '/DOutputBaseFilename=Altbase-Wallet-Windows',
  script,
]

const result = spawnSync(iscc, args, { stdio: 'inherit', windowsHide: true })
if (result.status !== 0) process.exit(result.status || 1)

const out = path.join(outputDir, 'Altbase-Wallet-Windows.exe')
if (fs.existsSync(out)) {
  const stat = fs.statSync(out)
  console.log(`Created ${out} (${stat.size} bytes)`)
}

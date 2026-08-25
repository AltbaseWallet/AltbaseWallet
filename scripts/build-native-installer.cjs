'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const zlib = require('node:zlib')

const root = path.resolve(__dirname, '..')
const pkg = require(path.join(root, 'package.json'))
const validateOnly = process.argv.includes('--validate')
const sourceDir = path.join(root, 'release', 'win-unpacked')
const releaseDir = path.join(root, 'release')
const outputPath = path.join(releaseDir, 'Altbase-Wallet-Windows.msi')
const oldExecutableInstaller = path.join(releaseDir, 'Altbase-Wallet-Windows.exe')
const iconPath = path.join(root, 'build', 'icon.ico')
const summaryFixSource = path.join(root, 'scripts', 'set-msi-summary.c')
const electronBuilder = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder')
const crossMsiToolsRoot = process.env.ALTBASE_CROSS_MSI_TOOLS || ''
const crossMsiMode = process.platform !== 'win32' && Boolean(crossMsiToolsRoot)
const crossMsiBackend = process.env.ALTBASE_MSI_BACKEND || 'wix'
const windowsRoot = process.env.SystemRoot || 'C:\\Windows'
const cscript = path.join(windowsRoot, 'System32', 'cscript.exe')
const msiexec = path.join(windowsRoot, 'System32', 'msiexec.exe')

const sdkBinRoot = path.join(
  process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
  'Windows Kits',
  '10',
  'bin',
)

const sdkVersions = fs.existsSync(sdkBinRoot)
  ? fs.readdirSync(sdkBinRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+\.\d+\.\d+\.\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left, 'en', { numeric: true }))
  : []

const findSdkTool = (architecture, name) => {
  for (const version of sdkVersions) {
    const candidate = path.join(sdkBinRoot, version, architecture, name)
    if (fs.existsSync(candidate)) return candidate
  }
  throw new Error(`Windows SDK tool was not found: ${architecture}\\${name}`)
}

const wiImport = crossMsiMode ? '' : findSdkTool('x64', 'wiimport.vbs')
const wiMakeCab = crossMsiMode ? '' : findSdkTool('x64', 'wimakcab.vbs')
const wiSummaryInfo = crossMsiMode ? '' : findSdkTool('x64', 'wisuminf.vbs')

const run = (command, args, label, options = {}) => {
  console.log(`[windows-installer] ${label}`)
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    env: options.env || process.env,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim()
    throw new Error(`${label} failed with exit code ${result.status}${output ? `\n${output}` : ''}`)
  }
  if (options.printOutput) {
    const output = `${result.stdout || ''}${result.stderr || ''}`.trim()
    if (output) console.log(output)
  }
  return result
}

const listPayloadFiles = (directory) => {
  const files = []
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile()) files.push(absolute)
    }
  }
  visit(directory)
  return files.sort((left, right) => left.localeCompare(right, 'en'))
}

const normalizedRelativePath = (absolute) => path.relative(sourceDir, absolute).replaceAll('\\', '/')
const stableHex = (value, length = 32) => crypto.createHash('sha256').update(value).digest('hex').slice(0, length).toUpperCase()

const stableGuid = (value) => {
  const bytes = crypto.createHash('sha1').update(`altbase-wallet:${value}`).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex').toUpperCase()
  return `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}}`
}

const packageIdentityDigest = (files) => {
  const digest = crypto.createHash('sha256')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  const inputs = [__filename, summaryFixSource, ...files]
  for (const file of inputs) {
    const label = file === __filename
      ? 'installer-generator'
      : file === summaryFixSource
        ? 'summary-finalizer'
        : normalizedRelativePath(file)
    digest.update(label).update('\0')
    const descriptor = fs.openSync(file, 'r')
    try {
      let bytesRead
      do {
        bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null)
        if (bytesRead > 0) digest.update(buffer.subarray(0, bytesRead))
      } while (bytesRead > 0)
    } finally {
      fs.closeSync(descriptor)
    }
    digest.update('\0')
  }
  return digest.digest('hex')
}

const cleanIdtField = (value) => String(value ?? '').replace(/[\t\r\n]/g, ' ')

const writeIdt = (directory, name, columns, types, primaryKeys, rows) => {
  const lines = [
    columns.join('\t'),
    types.join('\t'),
    [name, ...primaryKeys].join('\t'),
    ...rows.map((row) => row.map(cleanIdtField).join('\t')),
  ]
  fs.writeFileSync(path.join(directory, `${name}.idt`), `${lines.join('\r\n')}\r\n`, 'utf8')
}

const createInstallerBackdrop = (workDir) => {
  const width = 500
  const height = 350
  const rowStride = Math.ceil((width * 3) / 4) * 4
  const pixelBytes = rowStride * height
  const bitmap = Buffer.alloc(54 + pixelBytes)

  bitmap.write('BM', 0, 2, 'ascii')
  bitmap.writeUInt32LE(bitmap.length, 2)
  bitmap.writeUInt32LE(54, 10)
  bitmap.writeUInt32LE(40, 14)
  bitmap.writeInt32LE(width, 18)
  bitmap.writeInt32LE(height, 22)
  bitmap.writeUInt16LE(1, 26)
  bitmap.writeUInt16LE(24, 28)
  bitmap.writeUInt32LE(pixelBytes, 34)
  bitmap.writeInt32LE(3780, 38)
  bitmap.writeInt32LE(3780, 42)

  const colorAt = (x, y) => {
    if (y < 142) return [12, 18, 34]
    if (y < 146) return x < 360 ? [38, 113, 255] : [22, 190, 181]
    if (y >= 296) return [239, 243, 248]
    return [249, 250, 252]
  }

  for (let y = 0; y < height; y += 1) {
    const targetRow = height - 1 - y
    for (let x = 0; x < width; x += 1) {
      const [red, green, blue] = colorAt(x, y)
      const offset = 54 + (targetRow * rowStride) + (x * 3)
      bitmap[offset] = blue
      bitmap[offset + 1] = green
      bitmap[offset + 2] = red
    }
  }

  const backdropPath = path.join(workDir, 'altbase-installer-backdrop.bmp')
  fs.writeFileSync(backdropPath, bitmap)
  return backdropPath
}

const decodeRgbaPng = (png) => {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (!png.subarray(0, signature.length).equals(signature)) throw new Error('Altbase icon does not contain a PNG frame')

  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const imageChunks = []
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset)
    const type = png.toString('ascii', offset + 4, offset + 8)
    const data = png.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') {
      imageChunks.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }

  if (!width || !height || bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
    throw new Error('Altbase icon PNG must be non-interlaced 8-bit RGBA')
  }

  const packed = zlib.inflateSync(Buffer.concat(imageChunks))
  const stride = width * 4
  const pixels = Buffer.alloc(stride * height)
  const paeth = (left, above, upperLeft) => {
    const prediction = left + above - upperLeft
    const leftDistance = Math.abs(prediction - left)
    const aboveDistance = Math.abs(prediction - above)
    const upperLeftDistance = Math.abs(prediction - upperLeft)
    if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left
    return aboveDistance <= upperLeftDistance ? above : upperLeft
  }

  let sourceOffset = 0
  for (let y = 0; y < height; y += 1) {
    const filter = packed[sourceOffset]
    sourceOffset += 1
    const rowOffset = y * stride
    const previousRowOffset = rowOffset - stride
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 4 ? pixels[rowOffset + x - 4] : 0
      const above = y > 0 ? pixels[previousRowOffset + x] : 0
      const upperLeft = y > 0 && x >= 4 ? pixels[previousRowOffset + x - 4] : 0
      let predictor = 0
      if (filter === 1) predictor = left
      else if (filter === 2) predictor = above
      else if (filter === 3) predictor = Math.floor((left + above) / 2)
      else if (filter === 4) predictor = paeth(left, above, upperLeft)
      else if (filter !== 0) throw new Error(`Unsupported PNG filter: ${filter}`)
      pixels[rowOffset + x] = (packed[sourceOffset] + predictor) & 0xff
      sourceOffset += 1
    }
  }

  return { width, height, pixels }
}

const readLargestIconPng = () => {
  const icon = fs.readFileSync(iconPath)
  const count = icon.readUInt16LE(4)
  const entries = []
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + (index * 16)
    const width = icon[offset] || 256
    const height = icon[offset + 1] || 256
    const size = icon.readUInt32LE(offset + 8)
    const imageOffset = icon.readUInt32LE(offset + 12)
    const data = icon.subarray(imageOffset, imageOffset + size)
    if (data.length >= 8 && data[0] === 0x89 && data.toString('ascii', 1, 4) === 'PNG') {
      entries.push({ width, height, data })
    }
  }
  entries.sort((left, right) => (right.width * right.height) - (left.width * left.height))
  if (!entries.length) throw new Error('Altbase icon has no PNG frame for the installer UI')
  return entries[0].data
}

const createInstallerLogo = (workDir) => {
  const source = decodeRgbaPng(readLargestIconPng())
  const width = 256
  const height = 256
  const logoSize = 220
  const inset = Math.floor((width - logoSize) / 2)
  const background = [12, 18, 34]
  const rowStride = Math.ceil((width * 3) / 4) * 4
  const bitmap = Buffer.alloc(54 + (rowStride * height))

  bitmap.write('BM', 0, 2, 'ascii')
  bitmap.writeUInt32LE(bitmap.length, 2)
  bitmap.writeUInt32LE(54, 10)
  bitmap.writeUInt32LE(40, 14)
  bitmap.writeInt32LE(width, 18)
  bitmap.writeInt32LE(height, 22)
  bitmap.writeUInt16LE(1, 26)
  bitmap.writeUInt16LE(24, 28)
  bitmap.writeUInt32LE(rowStride * height, 34)
  bitmap.writeInt32LE(3780, 38)
  bitmap.writeInt32LE(3780, 42)

  for (let y = 0; y < height; y += 1) {
    const targetRow = height - 1 - y
    for (let x = 0; x < width; x += 1) {
      let red = background[0]
      let green = background[1]
      let blue = background[2]
      if (x >= inset && x < inset + logoSize && y >= inset && y < inset + logoSize) {
        const sourceX = Math.min(source.width - 1, Math.floor(((x - inset) / logoSize) * source.width))
        const sourceY = Math.min(source.height - 1, Math.floor(((y - inset) / logoSize) * source.height))
        const sourceOffset = ((sourceY * source.width) + sourceX) * 4
        const alpha = source.pixels[sourceOffset + 3] / 255
        red = Math.round((source.pixels[sourceOffset] * alpha) + (red * (1 - alpha)))
        green = Math.round((source.pixels[sourceOffset + 1] * alpha) + (green * (1 - alpha)))
        blue = Math.round((source.pixels[sourceOffset + 2] * alpha) + (blue * (1 - alpha)))
      }
      const targetOffset = 54 + (targetRow * rowStride) + (x * 3)
      bitmap[targetOffset] = blue
      bitmap[targetOffset + 1] = green
      bitmap[targetOffset + 2] = red
    }
  }

  const logoPath = path.join(workDir, 'altbase-installer-logo.bmp')
  fs.writeFileSync(logoPath, bitmap)
  return logoPath
}

const insertInstallerStreams = (msiPath, workDir) => {
  const backdropPath = createInstallerBackdrop(workDir)
  const logoPath = createInstallerLogo(workDir)
  const helperPath = path.join(workDir, 'insert-installer-streams.vbs')
  fs.writeFileSync(helperPath, [
    'Option Explicit',
    'Const msiOpenDatabaseModeTransact = 1',
    'Dim installer : Set installer = CreateObject("WindowsInstaller.Installer")',
    'Dim database : Set database = installer.OpenDatabase(WScript.Arguments(0), msiOpenDatabaseModeTransact)',
    'Sub InsertStream(tableName, streamName, streamPath)',
    '  Dim view : Set view = database.OpenView("INSERT INTO `" & tableName & "` (`Name`, `Data`) VALUES (?, ?)")',
    '  Dim record : Set record = installer.CreateRecord(2)',
    '  record.StringData(1) = streamName',
    '  record.SetStream 2, streamPath',
    '  view.Execute record',
    'End Sub',
    'InsertStream "Icon", WScript.Arguments(1), WScript.Arguments(2)',
    'InsertStream "Binary", WScript.Arguments(3), WScript.Arguments(4)',
    'InsertStream "Binary", WScript.Arguments(5), WScript.Arguments(6)',
    'database.Commit',
  ].join('\r\n'), 'ascii')
  run(cscript, [
    '//nologo',
    helperPath,
    msiPath,
    'AltbaseIcon',
    iconPath,
    'AltbaseUiLogo',
    logoPath,
    'AltbaseBackdrop',
    backdropPath,
  ], 'embed Altbase installer artwork')
}

const crossMsiTool = (name) => path.join(crossMsiToolsRoot, 'usr', 'bin', name)
const crossMsiEnvironment = () => ({
  ...process.env,
  LD_LIBRARY_PATH: [
    path.join(crossMsiToolsRoot, 'usr', 'lib', 'x86_64-linux-gnu'),
    process.env.LD_LIBRARY_PATH || '',
  ].filter(Boolean).join(path.delimiter),
})

const buildCompressedCrossPlatformMsi = (msiPath, tableDir, files, workDir) => {
  const backdropPath = createInstallerBackdrop(workDir)
  const logoPath = createInstallerLogo(workDir)
  const iconStreamDir = path.join(tableDir, 'Icon')
  const binaryStreamDir = path.join(tableDir, 'Binary')
  fs.mkdirSync(iconStreamDir)
  fs.mkdirSync(binaryStreamDir)
  fs.copyFileSync(iconPath, path.join(iconStreamDir, 'AltbaseIcon.ico'))
  fs.copyFileSync(logoPath, path.join(binaryStreamDir, 'AltbaseUiLogo.bmp'))
  fs.copyFileSync(backdropPath, path.join(binaryStreamDir, 'AltbaseBackdrop.bmp'))
  writeIdt(tableDir, 'Icon', ['Name', 'Data'], ['s72', 'v0'], ['Name'], [
    ['AltbaseIcon', '/AltbaseIcon.ico'],
  ])
  writeIdt(tableDir, 'Binary', ['Name', 'Data'], ['s72', 'v0'], ['Name'], [
    ['AltbaseUiLogo', '/AltbaseUiLogo.bmp'],
    ['AltbaseBackdrop', '/AltbaseBackdrop.bmp'],
  ])

  const environment = crossMsiEnvironment()
  const tableFiles = fs.readdirSync(tableDir)
    .filter((name) => name.endsWith('.idt'))
    .sort((left, right) => left.localeCompare(right, 'en'))
  const importArgs = [msiPath]
  for (const name of tableFiles) importArgs.push('-i', name)
  run(crossMsiTool('msibuild'), importArgs, 'create compressed MSI database with libmsi', {
    cwd: tableDir,
    env: environment,
  })

  const cabinetDir = path.join(workDir, 'cabinet-files')
  fs.mkdirSync(cabinetDir)
  const cabinetNames = []
  for (const absolute of files) {
    const relative = normalizedRelativePath(absolute)
    const fileId = `FIL_${stableHex(relative, 28)}`
    const destination = path.join(cabinetDir, fileId)
    try {
      fs.linkSync(absolute, destination)
    } catch {
      fs.copyFileSync(absolute, destination)
    }
    cabinetNames.push(fileId)
  }
  const cabinetPath = path.join(workDir, 'ALTBASE.cab')
  run(crossMsiTool('gcab'), ['-c', '-z', '-n', cabinetPath, ...cabinetNames], 'compress MSI payload', {
    cwd: cabinetDir,
    env: environment,
  })
  run(crossMsiTool('msibuild'), [
    msiPath,
    '-q',
    "UPDATE `Media` SET `Cabinet` = '#ALTBASE' WHERE `DiskId` = 1",
    '-a',
    'ALTBASE',
    cabinetPath,
    '-s',
    'Altbase Wallet',
    'Altbase',
    'x64;1033',
    `{${crypto.randomUUID().toUpperCase()}}`,
  ], 'embed MSI cabinet', { env: environment })

  const helperPath = path.join(workDir, 'set-msi-summary')
  const compilerFlags = run(crossMsiTool('pkg-config'), [
    '--cflags',
    '--libs',
    'libmsi-1.0',
  ], 'resolve libmsi compiler flags', { env: environment }).stdout.trim().split(/\s+/)
  run(process.env.CC || 'cc', [
    '-std=c11',
    '-O2',
    '-Wall',
    '-Wextra',
    '-Werror',
    summaryFixSource,
    '-o',
    helperPath,
    ...compilerFlags,
  ], 'compile MSI summary finalizer', { env: environment })
  run(helperPath, [msiPath], 'finalize MSI 5.0 compressed-package metadata', { env: environment })
}

const buildWixCrossPlatformMsi = (msiPath, workDir) => {
  const configPath = path.join(workDir, 'electron-builder-msi.json')
  const upgradeCode = stableGuid('upgrade-code')
  fs.writeFileSync(configPath, `${JSON.stringify({
    appId: pkg.build?.appId || 'com.altbase.wallet',
    productName: pkg.productName || 'Altbase Wallet',
    // WiX cabinet compression crashes under Wine for the large Electron
    // executable. Build the standards-compliant database first, then replace
    // its stored cabinet streams with gcab-compressed streams below.
    compression: 'store',
    directories: { output: workDir },
    win: {
      icon: iconPath,
      signAndEditExecutable: false,
    },
    msi: {
      oneClick: false,
      perMachine: false,
      runAfterFinish: false,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: 'Altbase Wallet',
      upgradeCode: upgradeCode.slice(1, -1),
      artifactName: path.basename(msiPath),
      additionalLightArgs: ['-ct', '1'],
    },
  }, null, 2)}\n`, 'utf8')

  run(electronBuilder, [
    '--win',
    'msi',
    '--x64',
    '--prepackaged',
    sourceDir,
    '--publish',
    'never',
    '--config',
    configPath,
  ], 'build standards-compliant MSI with WiX', { printOutput: true })

  if (!fs.existsSync(msiPath)) throw new Error(`WiX did not create the expected MSI: ${msiPath}`)
  recompressWixCabinets(msiPath, workDir)
  // Electron can legitimately ship a lower embedded version of a runtime DLL
  // than an earlier release. Windows Installer otherwise rejects the current
  // component during costing, removes the old product, and leaves the shared
  // path without either file. Applying the normal-install overwrite policy
  // before costing makes major upgrades install the package's exact payload.
  enforceReliableFileReplacement(msiPath)
  const result = run(crossMsiTool('msiinfo'), ['export', msiPath, 'Property'], 'read MSI product identity')
  const properties = new Map(
    result.stdout.split(/\r?\n/)
      .slice(3)
      .map((line) => line.split('\t'))
      .filter((fields) => fields.length >= 2),
  )
  const productCode = properties.get('ProductCode') || ''
  const actualUpgradeCode = properties.get('UpgradeCode') || ''
  if (!/^\{[0-9A-F-]{36}\}$/.test(productCode)) throw new Error('WiX MSI has no valid ProductCode')
  if (actualUpgradeCode !== upgradeCode) {
    throw new Error(`WiX MSI UpgradeCode is ${actualUpgradeCode || 'missing'}, expected ${upgradeCode}`)
  }
  return { productCode, upgradeCode: actualUpgradeCode }
}

const parseIdtRows = (raw) => raw
  .replaceAll('\r', '')
  .trimEnd()
  .split('\n')
  .slice(3)
  .filter(Boolean)
  .map((line) => line.split('\t'))

const enforceReliableFileReplacement = (msiPath) => {
  const environment = crossMsiEnvironment()
  const propertyRows = parseIdtRows(run(
    crossMsiTool('msiinfo'),
    ['export', msiPath, 'Property'],
    'read MSI file replacement policy',
    { env: environment },
  ).stdout)
  const hasReinstallMode = propertyRows.some((row) => row[0] === 'REINSTALLMODE')
  const query = hasReinstallMode
    ? "UPDATE `Property` SET `Value` = 'amus' WHERE `Property` = 'REINSTALLMODE'"
    : "INSERT INTO `Property` (`Property`, `Value`) VALUES ('REINSTALLMODE', 'amus')"
  run(crossMsiTool('msibuild'), [
    msiPath,
    '-q',
    query,
  ], 'enforce reliable MSI upgrade file replacement', { env: environment })

  const verifiedRows = parseIdtRows(run(
    crossMsiTool('msiinfo'),
    ['export', msiPath, 'Property'],
    'verify MSI file replacement policy',
    { env: environment },
  ).stdout)
  if (!verifiedRows.some((row) => row[0] === 'REINSTALLMODE' && row[1] === 'amus')) {
    throw new Error('MSI file replacement policy was not persisted')
  }
}

const msiLongName = (value) => String(value || '').split('|').pop()

const recompressWixCabinets = (msiPath, workDir) => {
  const environment = crossMsiEnvironment()
  const exportTable = (table) => parseIdtRows(run(
    crossMsiTool('msiinfo'),
    ['export', msiPath, table],
    `read WiX ${table} table`,
    { env: environment },
  ).stdout)

  const directoryRows = exportTable('Directory')
  const componentRows = exportTable('Component')
  const fileRows = exportTable('File')
  const mediaRows = exportTable('Media')
  const directories = new Map(directoryRows.map((row) => [row[0], {
    parent: row[1],
    name: msiLongName(row[2]),
  }]))
  const componentDirectories = new Map(componentRows.map((row) => [row[0], row[2]]))
  const sourceFiles = new Map(listPayloadFiles(sourceDir).map((file) => [
    normalizedRelativePath(file).toLowerCase(),
    file,
  ]))

  const resolveDirectory = (directoryId) => {
    if (!directoryId || directoryId === 'APPLICATIONFOLDER') return ''
    const parts = []
    const seen = new Set()
    let current = directoryId
    while (current && current !== 'APPLICATIONFOLDER') {
      if (seen.has(current)) throw new Error(`WiX MSI directory cycle at ${current}`)
      seen.add(current)
      const item = directories.get(current)
      if (!item) throw new Error(`WiX MSI directory is missing: ${current}`)
      if (current === 'TARGETDIR' || current === 'ProgramFiles64Folder' || current === 'ProgramFilesFolder') break
      if (item.name && item.name !== '.' && item.name !== 'SourceDir') parts.unshift(item.name)
      current = item.parent
    }
    return parts.join('/')
  }

  const payload = fileRows.map((row) => {
    const id = row[0]
    const directory = resolveDirectory(componentDirectories.get(row[1]))
    const relative = path.posix.join(directory, msiLongName(row[2]))
    const source = sourceFiles.get(relative.toLowerCase())
    if (!source) throw new Error(`WiX MSI source mapping is missing: ${relative}`)
    if (fs.statSync(source).size !== Number(row[3])) throw new Error(`WiX MSI source size changed: ${relative}`)
    return { id, source, sequence: Number(row[7]) }
  }).sort((left, right) => left.sequence - right.sequence)

  if (payload.length !== sourceFiles.size || new Set(payload.map((item) => item.source)).size !== sourceFiles.size) {
    throw new Error(`WiX MSI payload mapping covered ${payload.length} rows for ${sourceFiles.size} source files`)
  }

  const media = mediaRows.map((row) => ({
    diskId: Number(row[0]),
    lastSequence: Number(row[1]),
    cabinet: String(row[3] || '').replace(/^#/, ''),
  })).sort((left, right) => left.diskId - right.diskId)
  const uncompressedSize = fs.statSync(msiPath).size
  let previousSequence = 0
  let assignedFiles = 0
  for (const medium of media) {
    if (!medium.cabinet) throw new Error(`WiX MSI media ${medium.diskId} has no embedded cabinet`)
    const entries = payload.filter((item) => (
      item.sequence > previousSequence && item.sequence <= medium.lastSequence
    ))
    previousSequence = medium.lastSequence
    assignedFiles += entries.length
    if (entries.length === 0) throw new Error(`WiX MSI cabinet ${medium.cabinet} has no files`)

    const cabinetDir = path.join(workDir, `compressed-${medium.cabinet}`)
    const cabinetPath = path.join(workDir, `${medium.cabinet}.compressed`)
    fs.mkdirSync(cabinetDir)
    for (const entry of entries) {
      const destination = path.join(cabinetDir, entry.id)
      try {
        fs.linkSync(entry.source, destination)
      } catch {
        fs.copyFileSync(entry.source, destination)
      }
    }
    run(crossMsiTool('gcab'), [
      '-c', '-z', '-n', cabinetPath, ...entries.map((entry) => entry.id),
    ], `compress WiX cabinet ${medium.cabinet}`, { cwd: cabinetDir, env: environment })
    run(crossMsiTool('msibuild'), [
      msiPath, '-a', medium.cabinet, cabinetPath,
    ], `replace WiX cabinet ${medium.cabinet}`, { env: environment })
  }
  if (assignedFiles !== payload.length) {
    throw new Error(`WiX MSI media covered ${assignedFiles} of ${payload.length} files`)
  }
  const compressedSize = fs.statSync(msiPath).size
  if (compressedSize >= uncompressedSize || compressedSize > 300 * 1024 * 1024) {
    throw new Error(`WiX MSI recompression was ineffective: ${uncompressedSize} -> ${compressedSize} bytes`)
  }
  console.log(`[windows-installer] recompressed WiX MSI: ${uncompressedSize} -> ${compressedSize} bytes`)
}

const shortDirectoryName = (relative) => `D${stableHex(relative, 7)}|${path.basename(relative)}`
const shortFileName = (relative) => {
  const extension = path.extname(relative).slice(1).replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || 'BIN'
  return `F${stableHex(relative, 7)}.${extension}|${path.basename(relative)}`
}

const buildTables = (tableDir, files) => {
  const productCode = stableGuid(`product:${pkg.version}:${packageIdentityDigest(files)}`)
  const upgradeCode = stableGuid('upgrade-code')
  const directoryRows = [
    ['TARGETDIR', '', 'SourceDir'],
    ['LocalAppDataFolder', 'TARGETDIR', '.'],
    ['ALTBASEPROGRAMS', 'LocalAppDataFolder', 'Programs:.'],
    ['INSTALLFOLDER', 'ALTBASEPROGRAMS', 'ALTBASE|Altbase Wallet:.'],
    ['ProgramMenuFolder', 'TARGETDIR', '.'],
    ['DesktopFolder', 'TARGETDIR', '.'],
    ['APPMENUDIR', 'ProgramMenuFolder', 'ALTBASE|Altbase Wallet'],
  ]
  const directoryIds = new Map([['', 'INSTALLFOLDER']])
  const payloadDirectorySet = new Set()
  for (const file of files) {
    let relative = path.dirname(normalizedRelativePath(file)).replaceAll('\\', '/')
    while (relative && relative !== '.') {
      payloadDirectorySet.add(relative)
      relative = path.posix.dirname(relative)
    }
  }
  const payloadDirectories = [...payloadDirectorySet]
    .sort((left, right) => {
      const depth = left.split('/').length - right.split('/').length
      return depth || left.localeCompare(right, 'en')
    })

  for (const relative of payloadDirectories) {
    const id = `DIR_${stableHex(relative, 28)}`
    const parentRelative = path.posix.dirname(relative)
    const parent = parentRelative === '.' ? 'INSTALLFOLDER' : directoryIds.get(parentRelative)
    if (!parent) throw new Error(`MSI directory parent was not generated: ${relative}`)
    directoryIds.set(relative, id)
    directoryRows.push([id, parent, shortDirectoryName(relative)])
  }

  const componentRows = []
  const featureComponentRows = []
  const fileRows = []
  const firstComponentByDirectory = new Map()
  let mainExecutableFileId = ''

  files.forEach((absolute, index) => {
    const relative = normalizedRelativePath(absolute)
    const relativeDirectory = path.posix.dirname(relative) === '.' ? '' : path.posix.dirname(relative)
    const directoryId = directoryIds.get(relativeDirectory)
    const fileId = `FIL_${stableHex(relative, 28)}`
    const componentId = `CMP_${stableHex(relative, 28)}`
    componentRows.push([componentId, stableGuid(`component:${relative.toLowerCase()}`), directoryId, 256, '', fileId])
    featureComponentRows.push(['MainFeature', componentId])
    fileRows.push([
      fileId,
      componentId,
      shortFileName(relative),
      fs.statSync(absolute).size,
      '',
      '',
      512,
      index + 1,
    ])
    if (!firstComponentByDirectory.has(relativeDirectory)) firstComponentByDirectory.set(relativeDirectory, componentId)
    if (relative.toLowerCase() === 'altbase wallet.exe') mainExecutableFileId = fileId
  })

  if (!mainExecutableFileId) throw new Error('Altbase Wallet.exe is missing from release/win-unpacked')

  const startMenuComponent = 'CMP_StartMenuShortcut'
  const desktopComponent = 'CMP_DesktopShortcut'
  componentRows.push([
    startMenuComponent,
    stableGuid('component:start-menu-shortcut'),
    'INSTALLFOLDER',
    260,
    '',
    'REG_StartMenuShortcut',
  ])
  componentRows.push([
    desktopComponent,
    stableGuid('component:desktop-shortcut'),
    'INSTALLFOLDER',
    260,
    'DESKTOPSHORTCUT=1',
    'REG_DesktopShortcut',
  ])
  featureComponentRows.push(['MainFeature', startMenuComponent], ['MainFeature', desktopComponent])

  writeIdt(tableDir, 'Property',
    ['Property', 'Value'], ['s72', 'l0'], ['Property'], [
      ['ProductCode', productCode],
      ['ProductName', 'Altbase Wallet'],
      ['ProductVersion', pkg.version],
      ['Manufacturer', 'Altbase'],
      ['ProductLanguage', '1033'],
      ['UpgradeCode', upgradeCode],
      ['ALLUSERS', '2'],
      ['MSIINSTALLPERUSER', '1'],
      ['INSTALLLEVEL', '1'],
      ['DESKTOPSHORTCUT', '1'],
      ['LAUNCHAPP', '1'],
      ['REINSTALLMODE', 'amus'],
      ['ARPNOMODIFY', '1'],
      ['ARPNOREPAIR', '1'],
      ['ARPPRODUCTICON', 'AltbaseIcon'],
      ['ARPURLINFOABOUT', 'https://altbase.io'],
      ['DefaultUIFont', 'AltbaseBody'],
      ['ErrorDialog', 'ErrorDlg'],
      ['SecureCustomProperties', 'OLDERVERSIONBEINGUPGRADED;NEWERVERSIONDETECTED'],
    ])

  writeIdt(tableDir, 'Directory',
    ['Directory', 'Directory_Parent', 'DefaultDir'], ['s72', 'S72', 'l255'], ['Directory'], directoryRows)
  writeIdt(tableDir, 'Component',
    ['Component', 'ComponentId', 'Directory_', 'Attributes', 'Condition', 'KeyPath'],
    ['s72', 'S38', 's72', 'i2', 'S255', 'S72'], ['Component'], componentRows)
  writeIdt(tableDir, 'Feature',
    ['Feature', 'Feature_Parent', 'Title', 'Description', 'Display', 'Level', 'Directory_', 'Attributes'],
    ['s38', 'S38', 'L64', 'L255', 'I2', 'i2', 'S72', 'i2'], ['Feature'], [
      ['MainFeature', '', 'Altbase Wallet', 'Altbase Wallet desktop application', 1, 1, 'INSTALLFOLDER', 0],
    ])
  writeIdt(tableDir, 'FeatureComponents',
    ['Feature_', 'Component_'], ['s38', 's72'], ['Feature_', 'Component_'], featureComponentRows)
  writeIdt(tableDir, 'File',
    ['File', 'Component_', 'FileName', 'FileSize', 'Version', 'Language', 'Attributes', 'Sequence'],
    ['s72', 's72', 'l255', 'i4', 'S72', 'S20', 'I2', 'i4'], ['File'], fileRows)
  writeIdt(tableDir, 'Media',
    ['DiskId', 'LastSequence', 'DiskPrompt', 'Cabinet', 'VolumeLabel', 'Source'],
    ['i2', 'i4', 'L64', 'S255', 'S32', 'S72'], ['DiskId'], [[1, files.length, '', '', '', '']])
  writeIdt(tableDir, 'Registry',
    ['Registry', 'Root', 'Key', 'Name', 'Value', 'Component_'],
    ['s72', 'i2', 'l255', 'L255', 'L0', 's72'], ['Registry'], [
      ['REG_StartMenuShortcut', 1, 'Software\\Altbase\\Altbase Wallet', 'StartMenuShortcut', '1', startMenuComponent],
      ['REG_DesktopShortcut', 1, 'Software\\Altbase\\Altbase Wallet', 'DesktopShortcut', '1', desktopComponent],
    ])
  writeIdt(tableDir, 'Shortcut',
    ['Shortcut', 'Directory_', 'Name', 'Component_', 'Target', 'Arguments', 'Description', 'Hotkey', 'Icon_', 'IconIndex', 'ShowCmd', 'WkDir'],
    ['s72', 's72', 'l128', 's72', 'l0', 'L255', 'L255', 'I2', 'S72', 'I2', 'I2', 'S72'], ['Shortcut'], [
      ['StartMenuShortcut', 'APPMENUDIR', 'ALTBASE|Altbase Wallet', startMenuComponent, `[#${mainExecutableFileId}]`, '', 'Altbase Wallet', '', 'AltbaseIcon', 0, 1, 'INSTALLFOLDER'],
      ['DesktopShortcut', 'DesktopFolder', 'ALTBASE|Altbase Wallet', desktopComponent, `[#${mainExecutableFileId}]`, '', 'Altbase Wallet', '', 'AltbaseIcon', 0, 1, 'INSTALLFOLDER'],
    ])
  writeIdt(tableDir, 'CustomAction',
    ['Action', 'Type', 'Source', 'Target'], ['s72', 'i2', 'S64', 'L0'], ['Action'], [
      ['LaunchAltbaseWallet', 210, mainExecutableFileId, ''],
    ])
  writeIdt(tableDir, 'RemoveFile',
    ['FileKey', 'Component_', 'FileName', 'DirProperty', 'InstallMode'],
    ['s72', 's72', 'L255', 's72', 'i2'], ['FileKey'], [
      ['RemoveAppMenuFolder', startMenuComponent, '', 'APPMENUDIR', 2],
      ...[...firstComponentByDirectory.entries()].map(([relative, componentId]) => [
        `RM_${stableHex(relative || 'root', 28)}`,
        componentId,
        '',
        directoryIds.get(relative),
        2,
      ]),
    ])
  writeIdt(tableDir, 'Icon', ['Name', 'Data'], ['s72', 'v0'], ['Name'], [])
  writeIdt(tableDir, 'Binary', ['Name', 'Data'], ['s72', 'v0'], ['Name'], [])

  writeIdt(tableDir, 'Upgrade',
    ['UpgradeCode', 'VersionMin', 'VersionMax', 'Language', 'Attributes', 'Remove', 'ActionProperty'],
    ['s38', 'S20', 'S20', 'S255', 'i4', 'S255', 's72'], ['UpgradeCode', 'VersionMin', 'VersionMax', 'Language', 'Attributes'], [
      [upgradeCode, '', pkg.version, '', 513, '', 'OLDERVERSIONBEINGUPGRADED'],
      [upgradeCode, pkg.version, '', '', 2, '', 'NEWERVERSIONDETECTED'],
    ])
  writeIdt(tableDir, 'LaunchCondition',
    ['Condition', 'Description'], ['s255', 'l255'], ['Condition'], [
      ['Installed OR VersionNT64', 'Altbase Wallet requires 64-bit Windows.'],
      ['NOT NEWERVERSIONDETECTED', 'A newer version of Altbase Wallet is already installed.'],
    ])

  const executeSequence = [
    ['FindRelatedProducts', '', 25],
    ['LaunchConditions', '', 100],
    ['ValidateProductID', '', 700],
    ['CostInitialize', '', 800],
    ['FileCost', '', 900],
    ['CostFinalize', '', 1000],
    ['MigrateFeatureStates', '', 1200],
    ['InstallValidate', '', 1400],
    ['RemoveExistingProducts', 'OLDERVERSIONBEINGUPGRADED', 1450],
    ['InstallInitialize', '', 1500],
    ['ProcessComponents', '', 1600],
    ['UnpublishFeatures', '', 1800],
    ['RemoveRegistryValues', '', 2600],
    ['RemoveShortcuts', '', 3200],
    ['RemoveFiles', '', 3500],
    ['InstallFiles', '', 4000],
    ['CreateShortcuts', '', 4500],
    ['WriteRegistryValues', '', 5000],
    ['RegisterUser', '', 6000],
    ['RegisterProduct', '', 6100],
    ['PublishFeatures', '', 6300],
    ['PublishProduct', '', 6400],
    ['InstallFinalize', '', 6600],
  ]
  writeIdt(tableDir, 'InstallExecuteSequence',
    ['Action', 'Condition', 'Sequence'], ['s72', 'S255', 'I2'], ['Action'], executeSequence)
  writeIdt(tableDir, 'AdminExecuteSequence',
    ['Action', 'Condition', 'Sequence'], ['s72', 'S255', 'I2'], ['Action'], [
      ['CostInitialize', '', 800],
      ['FileCost', '', 900],
      ['CostFinalize', '', 1000],
      ['InstallValidate', '', 1400],
      ['InstallInitialize', '', 1500],
      ['InstallFiles', '', 4000],
      ['InstallFinalize', '', 6600],
    ])

  writeIdt(tableDir, 'TextStyle',
    ['TextStyle', 'FaceName', 'Size', 'Color', 'StyleBits'],
    ['s72', 's32', 'i2', 'I4', 'I2'], ['TextStyle'], [
      ['AltbaseBody', 'Segoe UI', 9, 3351579, 0],
      ['AltbaseTitle', 'Segoe UI', 20, 2758415, 1],
      ['AltbaseSubtitle', 'Segoe UI', 10, 8745062, 0],
      ['AltbaseLabel', 'Segoe UI', 8, 8745062, 1],
      ['AltbaseHeader', 'Segoe UI', 9, 16777215, 1],
      ['AltbaseMuted', 'Segoe UI', 8, 8745062, 0],
    ])
  writeIdt(tableDir, 'Dialog',
    ['Dialog', 'HCentering', 'VCentering', 'Width', 'Height', 'Attributes', 'Title', 'Control_First', 'Control_Default', 'Control_Cancel'],
    ['s72', 'i2', 'i2', 'i2', 'i2', 'I4', 'L128', 's50', 'S50', 'S50'], ['Dialog'], [
      ['WelcomeDlg', 50, 50, 500, 350, 7, 'Altbase Wallet Setup', 'Backdrop', 'Install', 'Cancel'],
      ['ProgressDlg', 50, 50, 500, 350, 5, 'Altbase Wallet Setup', 'Backdrop', '', ''],
      ['ExitDialog', 50, 50, 500, 350, 7, 'Altbase Wallet Setup', 'Backdrop', 'Finish', 'Finish'],
      ['ErrorDlg', 50, 50, 500, 350, 65543, 'Altbase Wallet Setup', 'Backdrop', '', ''],
      ['FatalError', 50, 50, 500, 350, 7, 'Altbase Wallet Setup', 'Backdrop', 'Finish', 'Finish'],
      ['UserExit', 50, 50, 500, 350, 7, 'Altbase Wallet Setup', 'Backdrop', 'Finish', 'Finish'],
    ])
  writeIdt(tableDir, 'Control',
    ['Dialog_', 'Control', 'Type', 'X', 'Y', 'Width', 'Height', 'Attributes', 'Property', 'Text', 'Control_Next', 'Help'],
    ['s72', 's50', 's20', 'i2', 'i2', 'i2', 'i2', 'I4', 'S72', 'L0', 'S50', 'L50'], ['Dialog_', 'Control'], [
      ['WelcomeDlg', 'Backdrop', 'Bitmap', 0, 0, 500, 350, 1, '', 'AltbaseBackdrop', 'Logo', ''],
      ['WelcomeDlg', 'Logo', 'Bitmap', 202, 20, 96, 96, 1, '', 'AltbaseUiLogo', 'Brand', ''],
      ['WelcomeDlg', 'Brand', 'Text', 214, 116, 120, 16, 196611, '', '{\\AltbaseHeader}ALTBASE WALLET', 'Title', ''],
      ['WelcomeDlg', 'Title', 'Text', 42, 160, 416, 30, 196611, '', '{\\AltbaseTitle}Install Altbase Wallet', 'Subtitle', ''],
      ['WelcomeDlg', 'Subtitle', 'Text', 42, 193, 416, 20, 196611, '', '{\\AltbaseSubtitle}Private, modular desktop wallet for Windows', 'LocationLabel', ''],
      ['WelcomeDlg', 'LocationLabel', 'Text', 42, 222, 416, 13, 196611, '', '{\\AltbaseLabel}INSTALL LOCATION', 'Location', ''],
      ['WelcomeDlg', 'Location', 'Text', 42, 237, 416, 18, 196611, '', '{\\AltbaseMuted}[LocalAppDataFolder]Programs\\Altbase Wallet', 'DesktopShortcut', ''],
      ['WelcomeDlg', 'DesktopShortcut', 'CheckBox', 42, 263, 416, 20, 3, 'DESKTOPSHORTCUT', 'Create a desktop shortcut', 'Cancel', ''],
      ['WelcomeDlg', 'Cancel', 'PushButton', 310, 310, 68, 26, 3, '', 'Cancel', 'Install', ''],
      ['WelcomeDlg', 'Install', 'PushButton', 388, 310, 70, 26, 3, '', 'Install', 'Backdrop', ''],

      ['ProgressDlg', 'Backdrop', 'Bitmap', 0, 0, 500, 350, 1, '', 'AltbaseBackdrop', 'Logo', ''],
      ['ProgressDlg', 'Logo', 'Bitmap', 202, 20, 96, 96, 1, '', 'AltbaseUiLogo', 'Brand', ''],
      ['ProgressDlg', 'Brand', 'Text', 214, 116, 120, 16, 196611, '', '{\\AltbaseHeader}ALTBASE WALLET', 'Title', ''],
      ['ProgressDlg', 'Title', 'Text', 42, 164, 416, 30, 196611, '', '{\\AltbaseTitle}Installing Altbase Wallet', 'ActionText', ''],
      ['ProgressDlg', 'ActionText', 'Text', 42, 207, 416, 18, 196611, '', '{\\AltbaseSubtitle}Preparing files...', 'ProgressBar', ''],
      ['ProgressDlg', 'ProgressBar', 'ProgressBar', 42, 241, 416, 12, 65537, '', 'Progress done', 'Status', ''],
      ['ProgressDlg', 'Status', 'Text', 42, 266, 416, 18, 196611, '', '{\\AltbaseMuted}This usually takes less than a minute.', 'Backdrop', ''],

      ['ExitDialog', 'Backdrop', 'Bitmap', 0, 0, 500, 350, 1, '', 'AltbaseBackdrop', 'Logo', ''],
      ['ExitDialog', 'Logo', 'Bitmap', 202, 20, 96, 96, 1, '', 'AltbaseUiLogo', 'Brand', ''],
      ['ExitDialog', 'Brand', 'Text', 214, 116, 120, 16, 196611, '', '{\\AltbaseHeader}ALTBASE WALLET', 'Title', ''],
      ['ExitDialog', 'Title', 'Text', 42, 164, 416, 30, 196611, '', '{\\AltbaseTitle}Altbase Wallet is ready', 'Description', ''],
      ['ExitDialog', 'Description', 'Text', 42, 204, 416, 22, 196611, '', '{\\AltbaseSubtitle}Installation completed successfully.', 'LaunchApp', ''],
      ['ExitDialog', 'LaunchApp', 'CheckBox', 42, 238, 300, 20, 3, 'LAUNCHAPP', 'Launch Altbase Wallet', 'Finish', ''],
      ['ExitDialog', 'Finish', 'PushButton', 388, 310, 70, 26, 3, '', 'Finish', 'Backdrop', ''],

      ['ErrorDlg', 'Backdrop', 'Bitmap', 0, 0, 500, 350, 1, '', 'AltbaseBackdrop', 'Logo', ''],
      ['ErrorDlg', 'Logo', 'Bitmap', 202, 20, 96, 96, 1, '', 'AltbaseUiLogo', 'Brand', ''],
      ['ErrorDlg', 'Brand', 'Text', 214, 116, 120, 16, 196611, '', '{\\AltbaseHeader}ALTBASE WALLET', 'ErrorText', ''],
      ['ErrorDlg', 'ErrorText', 'Text', 42, 164, 416, 92, 196611, '', '[ErrorText]', 'Backdrop', ''],

      ['FatalError', 'Backdrop', 'Bitmap', 0, 0, 500, 350, 1, '', 'AltbaseBackdrop', 'Logo', ''],
      ['FatalError', 'Logo', 'Bitmap', 202, 20, 96, 96, 1, '', 'AltbaseUiLogo', 'Brand', ''],
      ['FatalError', 'Brand', 'Text', 214, 116, 120, 16, 196611, '', '{\\AltbaseHeader}ALTBASE WALLET', 'Title', ''],
      ['FatalError', 'Title', 'Text', 42, 164, 416, 30, 196611, '', '{\\AltbaseTitle}Setup could not finish', 'Description', ''],
      ['FatalError', 'Description', 'Text', 42, 204, 416, 48, 196611, '', '{\\AltbaseSubtitle}No wallet files were changed after the failed operation.', 'Finish', ''],
      ['FatalError', 'Finish', 'PushButton', 388, 310, 70, 26, 3, '', 'Close', 'Backdrop', ''],

      ['UserExit', 'Backdrop', 'Bitmap', 0, 0, 500, 350, 1, '', 'AltbaseBackdrop', 'Logo', ''],
      ['UserExit', 'Logo', 'Bitmap', 202, 20, 96, 96, 1, '', 'AltbaseUiLogo', 'Brand', ''],
      ['UserExit', 'Brand', 'Text', 214, 116, 120, 16, 196611, '', '{\\AltbaseHeader}ALTBASE WALLET', 'Title', ''],
      ['UserExit', 'Title', 'Text', 42, 164, 416, 30, 196611, '', '{\\AltbaseTitle}Setup cancelled', 'Description', ''],
      ['UserExit', 'Description', 'Text', 42, 204, 416, 36, 196611, '', '{\\AltbaseSubtitle}Altbase Wallet was not installed.', 'Finish', ''],
      ['UserExit', 'Finish', 'PushButton', 388, 310, 70, 26, 3, '', 'Close', 'Backdrop', ''],
    ])
  writeIdt(tableDir, 'ControlEvent',
    ['Dialog_', 'Control_', 'Event', 'Argument', 'Condition', 'Ordering'],
    ['s72', 's50', 's50', 's255', 'S255', 'I2'], ['Dialog_', 'Control_', 'Event', 'Argument', 'Condition'], [
      ['WelcomeDlg', 'Install', 'EndDialog', 'Return', '1', 1],
      ['WelcomeDlg', 'Cancel', 'EndDialog', 'Exit', '1', 1],
      ['ExitDialog', 'Finish', 'DoAction', 'LaunchAltbaseWallet', 'LAUNCHAPP = 1 AND NOT Installed', 1],
      ['ExitDialog', 'Finish', 'EndDialog', 'Return', '1', 2],
      ['FatalError', 'Finish', 'EndDialog', 'Return', '1', 1],
      ['UserExit', 'Finish', 'EndDialog', 'Return', '1', 1],
    ])
  writeIdt(tableDir, 'EventMapping',
    ['Dialog_', 'Control_', 'Event', 'Attribute'],
    ['s72', 's50', 's50', 's50'], ['Dialog_', 'Control_', 'Event'], [
      ['ProgressDlg', 'ActionText', 'ActionText', 'Text'],
      ['ProgressDlg', 'ProgressBar', 'SetProgress', 'Progress'],
    ])
  writeIdt(tableDir, 'InstallUISequence',
    ['Action', 'Condition', 'Sequence'], ['s72', 'S255', 'I2'], ['Action'], [
      ['FindRelatedProducts', '', 25],
      ['LaunchConditions', '', 100],
      ['CostInitialize', '', 800],
      ['FileCost', '', 900],
      ['CostFinalize', '', 1000],
      ['MigrateFeatureStates', '', 1200],
      ['WelcomeDlg', 'NOT Installed AND NOT PATCH', 1298],
      ['ProgressDlg', '', 1299],
      ['ExecuteAction', '', 1300],
      ['ExitDialog', '', -1],
      ['UserExit', '', -2],
      ['FatalError', '', -3],
    ])
  writeIdt(tableDir, 'AdminUISequence',
    ['Action', 'Condition', 'Sequence'], ['s72', 'S255', 'I2'], ['Action'], [
      ['CostInitialize', '', 800],
      ['FileCost', '', 900],
      ['CostFinalize', '', 1000],
      ['ExecuteAction', '', 1300],
    ])

  return { productCode, upgradeCode }
}

const verifyAdministrativeImage = (msiPath, sourceFiles, workDir) => {
  const targetDir = path.join(workDir, 'administrative-image')
  const logPath = path.join(workDir, 'administrative-install.log')
  fs.mkdirSync(targetDir, { recursive: true })
  try {
    run(msiexec, ['/a', msiPath, '/qn', `TARGETDIR=${targetDir}`, '/l*v', logPath], 'verify MSI administrative extraction')
  } catch (error) {
    const logTail = fs.existsSync(logPath)
      ? fs.readFileSync(logPath, 'utf16le').split(/\r?\n/).slice(-80).join('\n').trim()
      : ''
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}${logTail ? `\nMSI log tail:\n${logTail}` : ''}`,
      { cause: error },
    )
  }
  const extracted = listPayloadFiles(targetDir)
  const expectedNames = new Set(sourceFiles.map((file) => normalizedRelativePath(file).toLowerCase()))
  const extractedRelative = extracted.map((file) => path.relative(targetDir, file).replaceAll('\\', '/').toLowerCase())
  const missing = [...expectedNames].filter((expected) => !extractedRelative.some((actual) => actual.endsWith(expected)))
  if (missing.length > 0) {
    throw new Error(`MSI administrative image is missing ${missing.length} payload files (first: ${missing[0]})`)
  }
  console.log(`[windows-installer] verified ${sourceFiles.length} payload files in administrative image`)
}

const verifyCrossPlatformImage = (msiPath, sourceFiles, workDir) => {
  const targetDir = path.join(workDir, 'extracted-msi')
  fs.mkdirSync(targetDir)
  run(crossMsiTool('msiextract'), ['-C', targetDir, msiPath], 'verify MSI payload extraction')

  const extracted = listPayloadFiles(targetDir)
  const extractedByRelativePath = new Map(extracted.map((file) => {
    const relative = path.relative(targetDir, file).replaceAll('\\', '/')
    const normalized = relative.startsWith('Altbase Wallet/')
      ? relative.slice('Altbase Wallet/'.length)
      : relative
    return [normalized.toLowerCase(), file]
  }))
  for (const sourceFile of sourceFiles) {
    const relative = normalizedRelativePath(sourceFile).toLowerCase()
    const extractedFile = extractedByRelativePath.get(relative) || [...extractedByRelativePath.entries()]
      .find(([extractedRelative]) => extractedRelative.endsWith(`/${relative}`))?.[1]
    if (!extractedFile) {
      const sample = [...extractedByRelativePath.keys()].slice(0, 8).join(', ')
      throw new Error(`MSI payload is missing ${relative} (first extracted paths: ${sample})`)
    }
    if (fs.statSync(extractedFile).size !== fs.statSync(sourceFile).size) {
      throw new Error(`MSI payload size mismatch for ${relative}`)
    }
  }
  if (extractedByRelativePath.size !== sourceFiles.length) {
    throw new Error(`MSI contains ${extractedByRelativePath.size} files, expected ${sourceFiles.length}`)
  }
  console.log(`[windows-installer] verified ${sourceFiles.length} files in the MSI payload`)
}

const validateEnvironment = () => {
  if (crossMsiMode) {
    if (!['libmsi', 'wix'].includes(crossMsiBackend)) {
      throw new Error(`Unsupported ALTBASE_MSI_BACKEND: ${crossMsiBackend}`)
    }
    const files = crossMsiBackend === 'libmsi'
      ? [
          crossMsiTool('msibuild'),
          crossMsiTool('gcab'),
          crossMsiTool('msiinfo'),
          crossMsiTool('msiextract'),
          crossMsiTool('pkg-config'),
          summaryFixSource,
          iconPath,
        ]
      : [
          electronBuilder,
          crossMsiTool('msibuild'),
          crossMsiTool('gcab'),
          crossMsiTool('msiinfo'),
          crossMsiTool('msiextract'),
          iconPath,
        ]
    for (const file of files) {
      if (!fs.existsSync(file)) throw new Error(`Required cross-platform MSI build input is missing: ${file}`)
    }
    if (crossMsiBackend === 'libmsi') {
      run(crossMsiTool('pkg-config'), ['--exists', 'libmsi-1.0'], 'validate libmsi development files')
    }
    console.log(`Cross-platform ${crossMsiBackend} MSI build environment validated.`)
    return
  }
  for (const file of [cscript, msiexec, wiImport, wiMakeCab, wiSummaryInfo, iconPath]) {
    if (!fs.existsSync(file)) throw new Error(`Required Windows Installer build input is missing: ${file}`)
  }
  const artworkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'altbase-msi-artwork-'))
  try {
    for (const artwork of [createInstallerBackdrop(artworkDir), createInstallerLogo(artworkDir)]) {
      if (fs.statSync(artwork).size <= 54) throw new Error(`Generated installer artwork is empty: ${artwork}`)
    }
  } finally {
    fs.rmSync(artworkDir, { recursive: true, force: true })
  }
  console.log(`Windows Installer build environment validated with SDK ${path.basename(path.dirname(path.dirname(wiImport)))}.`)
}

try {
  validateEnvironment()
  if (validateOnly) process.exit(0)
  if (!fs.existsSync(sourceDir)) throw new Error(`Packaged wallet directory is missing: ${sourceDir}`)

  const files = listPayloadFiles(sourceDir)
  if (files.length === 0) throw new Error('release/win-unpacked is empty')
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'altbase-msi-'))
  const tableDir = path.join(workDir, 'tables')
  const temporaryMsi = path.join(workDir, 'Altbase-Wallet-Windows.msi')
  fs.mkdirSync(tableDir, { recursive: true })

  try {
    let identity
    if (crossMsiMode) {
      if (crossMsiBackend === 'libmsi') {
        identity = buildTables(tableDir, files)
        buildCompressedCrossPlatformMsi(temporaryMsi, tableDir, files, workDir)
      } else {
        identity = buildWixCrossPlatformMsi(temporaryMsi, workDir)
      }
      verifyCrossPlatformImage(temporaryMsi, files, workDir)
    } else {
      identity = buildTables(tableDir, files)
      run(cscript, ['//nologo', wiImport, '/c', temporaryMsi, tableDir, '*.idt'], 'create Windows Installer database')
      insertInstallerStreams(temporaryMsi, workDir)
      run(cscript, [
        '//nologo',
        wiSummaryInfo,
        temporaryMsi,
        'Title=Installation Database',
        'Subject=Altbase Wallet',
        'Author=Altbase',
        'Keywords=Installer;Wallet;Altbase',
        'Comments=Altbase Wallet 0.1.7 Windows Installer package',
        'Template=x64;1033',
        `Revision={${crypto.randomUUID().toUpperCase()}}`,
        'Pages=500',
        'Words=8',
        'Application=Windows Installer',
        'Security=2',
      ], 'write Windows Installer summary information')
      run(cscript, ['//nologo', wiMakeCab, temporaryMsi, 'ALTBASE', sourceDir, '/C', '/L', '/U', '/E', '/S'], 'embed compressed wallet payload', { cwd: workDir })
      run(cscript, ['//nologo', wiSummaryInfo, temporaryMsi, 'Words=10', 'Security=2'], 'finalize compressed package metadata')
      verifyAdministrativeImage(temporaryMsi, files, workDir)
    }
    fs.mkdirSync(releaseDir, { recursive: true })
    fs.copyFileSync(temporaryMsi, outputPath)
    if (fs.existsSync(oldExecutableInstaller)) fs.rmSync(oldExecutableInstaller, { force: true })

    const hash = crypto.createHash('sha256').update(fs.readFileSync(outputPath)).digest('hex')
    console.log(`Created ${outputPath}`)
    console.log(`  ProductCode: ${identity.productCode}`)
    console.log(`  UpgradeCode: ${identity.upgradeCode}`)
    console.log(`  files: ${files.length}`)
    console.log(`  size: ${fs.statSync(outputPath).size} bytes`)
    console.log(`  SHA-256: ${hash}`)
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true })
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

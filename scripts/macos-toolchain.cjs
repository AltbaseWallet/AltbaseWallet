'use strict'
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
function macosToolchain(target) {
  if (!['darwin-x64', 'darwin-arm64'].includes(target)) throw Error('Unsupported Darwin target')
  const cache = path.join(os.homedir(), '.cache/altbase-build')
  const root = process.env.ALTBASE_OSXCROSS_ROOT || path.join(cache, 'osxcross/target')
  const compiler = path.join(root, 'bin', target === 'darwin-arm64' ? 'oa64-clang++' : 'o64-clang++')
  const sdks = path.join(root, 'SDK')
  const sdk = process.env.ALTBASE_MACOS_SDK || path.join(sdks, fs.readdirSync(sdks).filter(n => /^MacOSX.*\.sdk$/.test(n)).sort().at(-1) || '')
  const openssl = path.join(process.env.ALTBASE_MACOS_DEPS_ROOT || path.join(cache, 'macos-deps/stage'), target === 'darwin-arm64' ? 'openssl-3.5.9-arm64' : 'openssl-3.5.9-x86_64')
  const lipo = path.join(root, 'bin', fs.readdirSync(path.join(root, 'bin')).filter(n => /^x86_64-apple-darwin[\d.]+-lipo$/.test(n)).sort().at(-1) || 'lipo')
  const codesign = process.env.ALTBASE_RCODESIGN || path.join(cache, 'apple-codesign/apple-codesign-0.22.0-x86_64-unknown-linux-musl/rcodesign')
  for (const file of [compiler, sdk]) if (!fs.existsSync(file)) throw Error('Missing Darwin build dependency: ' + file)
  return { compiler, sdk, openssl, lipo, codesign, flags: ['-mmacosx-version-min=12.0'], arch: target === 'darwin-arm64' ? 'arm64' : 'x86_64',
    environment: { PATH: path.join(root, 'bin') + path.delimiter + process.env.PATH, MACOSX_DEPLOYMENT_TARGET: '12.0',
      PKG_CONFIG_LIBDIR: path.join(openssl, 'lib/pkgconfig'), PKG_CONFIG_PATH: path.join(openssl, 'lib/pkgconfig'), PKG_CONFIG_SYSROOT_DIR: '',
      LD_LIBRARY_PATH: path.join(root, 'lib') + path.delimiter + (process.env.ALTBASE_OSXCROSS_COMPAT_LIBS || path.join(cache, 'macos-host-libs')) + (process.env.LD_LIBRARY_PATH ? path.delimiter + process.env.LD_LIBRARY_PATH : '') } }
}
module.exports = { macosToolchain }

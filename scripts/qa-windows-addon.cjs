'use strict'
// Execute with the packaged Windows EXE and ELECTRON_RUN_AS_NODE=1.
// Requiring bindings directly prevents the JS fallback from hiding a wrong addon.
const path = require('node:path')
if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('This check requires the packaged x64 Windows Electron runtime')
const binding = require(path.join(path.dirname(process.execPath), 'resources/app.asar/node_modules/secp256k1/bindings'))
if (typeof binding.publicKeyVerify !== 'function') throw Error('Native secp256k1 binding did not load')
console.log(JSON.stringify({ platform: process.platform, arch: process.arch, secpNativeBindingLoaded: true }))

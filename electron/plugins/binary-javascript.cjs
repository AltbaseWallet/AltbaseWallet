'use strict'
const path = require('node:path')
const { createRequire } = require('node:module')
// process.dlopen accepts the platform's .so/.dll/.dylib suffix. The binary
// exports the stable Node-API v8 registration function, not a V8 ABI binding.
function loadBinaryJavascript(filename) {
  const binary = { exports: {} }
  process.dlopen(binary, filename)
  if (typeof binary.exports !== 'function') throw Error('Invalid compiled JavaScript module')
  const loaded = { exports: {} }
  binary.exports(loaded.exports, createRequire(filename), loaded, filename, path.dirname(filename))
  if (typeof loaded.exports.createPlugin !== 'function') throw Error('Compiled module has no plugin factory')
  return loaded.exports
}
module.exports = { loadBinaryJavascript }

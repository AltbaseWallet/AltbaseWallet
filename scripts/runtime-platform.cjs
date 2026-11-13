'use strict'
const fs = require('node:fs')
function requireBinary(file, target) {
  if (!fs.existsSync(file)) throw Error(`Missing ${target} runtime: ${file}`)
  const fd = fs.openSync(file, 'r'), bytes = Buffer.alloc(64)
  let valid = false
  try {
    const count = fs.readSync(fd, bytes, 0, bytes.length, 0)
    if (count !== bytes.length) throw Error('Truncated executable header')
    if (target === 'win32-x64' && bytes.toString('ascii', 0, 2) === 'MZ') {
      const offset = bytes.readUInt32LE(60), pe = Buffer.alloc(26)
      if (offset >= 64 && offset < fs.fstatSync(fd).size - pe.length && fs.readSync(fd, pe, 0, pe.length, offset) === pe.length) {
        valid = pe.readUInt32LE(0) === 0x4550 && pe.readUInt16LE(4) === 0x8664 && pe.readUInt16LE(24) === 0x20b
      }
    } else if (target === 'linux-x64') {
      valid = bytes.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70])) && bytes[4] === 2 && bytes[5] === 1 && bytes.readUInt16LE(18) === 62
    } else if (target.startsWith('darwin-')) {
      valid = bytes.readUInt32LE(0) === 0xfeedfacf && bytes.readUInt32LE(4) === (target.endsWith('arm64') ? 0x100000c : 0x1000007)
    }
  } finally { fs.closeSync(fd) }
  if (!valid) throw Error(`Runtime does not match ${target}: ${file}`)
}
module.exports = { requireBinary }

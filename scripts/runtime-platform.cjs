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
      const cpu = target.endsWith('arm64') ? 0x100000c : 0x1000007
      valid = bytes.readUInt32LE(0) === 0xfeedfacf && bytes.readUInt32LE(4) === cpu
      const magic = bytes.readUInt32BE(0), wide = magic === 0xcafebabf
      if (!valid && (magic === 0xcafebabe || wide)) {
        const count = bytes.readUInt32BE(4), stride = wide ? 32 : 20, size = fs.fstatSync(fd).size
        if (count >= 1 && count <= 8 && 8 + count * stride <= size) {
          const table = Buffer.alloc(count * stride)
          if (fs.readSync(fd, table, 0, table.length, 8) === table.length) {
            for (let i = 0; i < count; i++) {
              const at = i * stride
              if (table.readUInt32BE(at) !== cpu) continue
              const offset = wide ? Number(table.readBigUInt64BE(at + 8)) : table.readUInt32BE(at + 8)
              const length = wide ? Number(table.readBigUInt64BE(at + 16)) : table.readUInt32BE(at + 12)
              if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 8 + table.length || length < 32 || offset > size - length) continue
              const header = Buffer.alloc(8)
              if (fs.readSync(fd, header, 0, 8, offset) === 8 && header.readUInt32LE(0) === 0xfeedfacf && header.readUInt32LE(4) === cpu) valid = true
            }
          }
        }
      }
    }
  } finally { fs.closeSync(fd) }
  if (!valid) throw Error(`Runtime does not match ${target}: ${file}`)
}
module.exports = { requireBinary }

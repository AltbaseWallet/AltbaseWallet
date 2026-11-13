'use strict'
const cpu = process.env.ALTBASE_BUILD_CPU || '0'
if (!/^\d+$/.test(cpu)) throw Error('ALTBASE_BUILD_CPU must select exactly one CPU')
module.exports = { cpu }

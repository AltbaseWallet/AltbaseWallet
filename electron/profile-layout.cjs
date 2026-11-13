'use strict'
const path = require('node:path')
const fs = require('node:fs')

const hasProfileStorage = directory => ['Local State', 'Preferences', 'Local Storage', 'Session Storage']
  .some(name => fs.existsSync(path.join(directory, name)))

function profileLayout(appData, name = '', previousStorage = false) {
  if (name && !/^[a-z0-9_-]{1,32}$/i.test(name)) throw Error('Invalid wallet profile name')
  const product = previousStorage ? 'AltbaseFullNode' : 'Altbase'
  return {
    userData: name ? path.join(appData, product + ' Profiles', name.toLowerCase()) : path.join(appData, product),
    modules: path.join(appData, 'Altbase', 'modules'),
  }
}
module.exports = { profileLayout, hasProfileStorage }

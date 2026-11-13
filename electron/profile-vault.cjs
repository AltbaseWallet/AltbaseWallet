'use strict'
const vault = require('./vault.cjs')
const localFormat = value => typeof value === 'string' && value.startsWith('fullnode-scrypt-v1:')

// Retain the released native envelope for new profiles, and support the prior
// working copy's envelopes without changing their authenticated format or AAD.
async function requestProfileVault(method, params, nativeRequest) {
  const previousEnvelope = method === 'verifyWalletPassword' && localFormat(params.verifySalt)
    || method === 'decryptWalletSecret' && localFormat(params.salt)
  if (!previousEnvelope) {
    try { return await nativeRequest(method, params) }
    catch {
      if (method === 'verifyWalletPassword') return { isValid: 'false' }
      throw Error(method === 'decryptWalletSecret' ? 'Wrong password or damaged encrypted profile' : 'Wallet profile encryption failed')
    }
  }
  return vault.request(method, params)
}
module.exports = { requestProfileVault, localFormat }

'use strict'
const tls = require('node:tls')
const net = require('node:net')

// One bounded JSON-lines request per connection. Notifications may arrive before
// the matching response; they must not be mistaken for a failed/empty balance.
const requestEndpoint = (endpoint, method, params, timeoutMs = 7000) => new Promise((resolve, reject) => {
  const secure = endpoint.tls !== false
  const socket = (secure ? tls : net).connect({ host: endpoint.host, port: endpoint.port,
    ...(secure ? { servername: endpoint.host, rejectUnauthorized: true } : {}) })
  let pending = '', bytes = 0, settled = false, identified = false
  const deadline = setTimeout(() => finish(new Error('Remote node request timed out')), timeoutMs)
  const finish = (error, result) => {
    if (settled) return
    settled = true; clearTimeout(deadline); socket.destroy()
    if (error) reject(error); else resolve(result)
  }
  socket.setTimeout(timeoutMs, () => finish(new Error('Remote node request timed out')))
  socket.on('error', error => finish(error))
  socket.on('close', () => finish(new Error('Remote node closed before replying')))
  socket.once(secure ? 'secureConnect' : 'connect', () => socket.write(JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'server.version', params: ['Altbase/0.1.9', '1.4'] })+'\n'))
  socket.on('data', chunk => {
    bytes += chunk.length
    if (bytes > 16 * 1024 * 1024) return finish(new Error('Remote node response too large'))
    pending += chunk.toString('utf8')
    for (;;) {
      const end = pending.indexOf('\n')
      if (end < 0) break
      const line = pending.slice(0, end).trim(); pending = pending.slice(end + 1)
      if (!line) continue
      let message
      try { message = JSON.parse(line) } catch { return finish(new Error('Invalid remote node JSON')) }
      if (message.id === 0 && !identified) {
        if (message.error) return finish(new Error('Remote node protocol negotiation failed'))
        identified = true
        socket.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })+'\n')
        continue
      }
      if (message.id !== 1 || !identified) continue
      if (message.error) return finish(new Error(message.error.message || 'Remote node RPC error'))
      if (!Object.hasOwn(message, 'result')) return finish(new Error('Remote node omitted result'))
      return finish(null, message.result)
    }
  })
})

const createElectrumClient = (endpoints, request = requestEndpoint) => {
  if (!Array.isArray(endpoints) || endpoints.length === 0) throw new Error('Remote node endpoints required')
  let preferred = 0
  return async (method, params = [], { write = false } = {}) => {
    // Never automatically retry a broadcast: its outcome may be unknown.
    const start = preferred
    let lastError
    for (let attempt = 0; attempt < (write ? 1 : endpoints.length); attempt++) {
      const index = (start + attempt) % endpoints.length
      try { const result = await request(endpoints[index], method, params); preferred = index; return result }
      catch (error) { lastError = error }
    }
    throw lastError
  }
}
module.exports = { createElectrumClient, requestEndpoint }

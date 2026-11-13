'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http')
const { download } = require('../electron/plugins/updater.cjs')
test('module downloads follow bounded validated redirects and reject size, redirect loops and stalls', async t => {
  const server = http.createServer((request, response) => {
    if (request.url === '/redirect') { response.writeHead(302, { Location: '/file' }); response.end(); return }
    if (request.url === '/loop') { response.writeHead(302, { Location: '/loop' }); response.end(); return }
    if (request.url === '/file') { response.end('verified archive fixture'); return }
    if (request.url === '/large') { response.writeHead(200, { 'Content-Length': '1000000' }); response.end('x'); return }
    if (request.url === '/protocol') { response.writeHead(302, { Location: 'file:///etc/passwd' }); response.end(); return }
    if (request.url === '/stall') return
    response.writeHead(503); response.end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const base = `http://127.0.0.1:${server.address().port}`, options = { allowLocalHttp: true, timeoutMs: 1000 }
  assert.equal((await download(base + '/redirect', 100, options)).toString(), 'verified archive fixture')
  await assert.rejects(download(base + '/loop', 100, options), /redirect limit/)
  await assert.rejects(download(base + '/large', 100, options), /oversized/)
  await assert.rejects(download(base + '/protocol', 100, options), /HTTPS/)
  await assert.rejects(download(base + '/stall', 100, { ...options, timeoutMs: 20 }), /failed/)
  await assert.rejects(download(base + '/file', 100), /HTTPS/)
})

'use strict'
const { spawn } = require('node:child_process')
const MAX_FRAME = 8 * 1024 * 1024
class PluginClient {
  constructor({ executable, args, env, cwd, startupTimeout = 5000, timeout = 60000 }) {
    this.options = { executable, args, env, cwd, startupTimeout, timeout }
    this.queue = Promise.resolve(); this.closed = false; this.child = null; this.current = null
  }
  start() {
    if (this.ready) return this.ready
    this.ready = new Promise((resolve, reject) => {
      if (this.closed) return reject(Error('Module session is closed'))
      const o = this.options
      const child = spawn(o.executable, o.args, { env: o.env, cwd: o.cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
      this.child = child
      let buffer = '', receivedManifest = false
      const startup = setTimeout(() => this.fail('Module startup timed out'), o.startupTimeout)
      this.startReject = error => { clearTimeout(startup); reject(error) }
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', chunk => {
        if (this.closed) return
        buffer += chunk
        if (Buffer.byteLength(buffer) > MAX_FRAME) return this.fail('Module response exceeds the limit')
        for (;;) {
          const newline = buffer.indexOf('\n')
          if (newline < 0) break
          const raw = buffer.slice(0, newline); buffer = buffer.slice(newline + 1)
          let data
          try { data = JSON.parse(raw) } catch { return this.fail('Module returned invalid JSON') }
          if (!receivedManifest) {
            receivedManifest = true; clearTimeout(startup); this.startReject = null; resolve(data)
          } else {
            const current = this.current
            if (!current || !data || typeof data.ok !== 'boolean') return this.fail('Module protocol violation')
            this.current = null; clearTimeout(current.timer)
            // Never propagate plugin-provided text: it may contain input secrets.
            if (data.ok) current.resolve(data.result)
            else current.reject(Error(`Module operation failed: ${current.method}`))
          }
        }
      })
      child.stderr.resume() // Do not retain or print potential key material.
      child.stdin.on('error', () => this.fail('Module connection closed'))
      child.on('error', () => this.fail('Module could not start'))
      // stdout may still contain the final response after the exit event.
      child.on('close', () => this.fail('Module process exited'))
    })
    return this.ready
  }
  request(method, params) {
    const data = JSON.stringify(params)
    if (Buffer.byteLength(data) > 2 * 1024 * 1024) return Promise.reject(Error('Module request exceeds the limit'))
    const operation = this.queue.then(async () => {
      await this.start()
      if (this.closed) throw Error('Module session is closed')
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => this.fail('Module request timed out'), this.options.timeout)
        this.current = { method, resolve, reject, timer }
        this.child.stdin.write(`${method}\n${data}\n`)
      })
    })
    this.queue = operation.catch(() => {})
    return operation
  }
  fail(message, graceful = false) {
    if (this.closed) return
    this.closed = true
    const error = Error(message)
    this.startReject?.(error); this.startReject = null
    if (this.current) { clearTimeout(this.current.timer); this.current.reject(error); this.current = null }
    const child = this.child
    if (child && child.exitCode === null) {
      if (graceful) child.stdin.end()
      else child.kill()
      const timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }, 1000)
      timer.unref()
    }
  }
  close() { this.fail('Module session is closed', true) }
}
module.exports = { PluginClient }

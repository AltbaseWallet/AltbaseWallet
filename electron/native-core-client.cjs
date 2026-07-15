const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const CORE_EXE = process.platform === 'win32' ? 'altbase_core_bridge.exe' : 'altbase_core_bridge'
const CORE_BRIDGE_ARG = '--altbase-wallet-bridge'

class NativeCoreClient {
  constructor(app) {
    this.app = app
    this.child = null
    this.nextId = 1
    this.pending = new Map()
    this.buffer = ''
  }

  corePath() {
    const packaged = path.join(process.resourcesPath, 'native-core', CORE_EXE)
    if (this.app.isPackaged) return packaged

    const release = path.join(__dirname, '..', 'native', 'core', 'build', 'vs2022-x64-release', 'bin', 'Release', CORE_EXE)
    const debug = path.join(__dirname, '..', 'native', 'core', 'build', 'vs2022-x64-debug', 'bin', 'Debug', CORE_EXE)
    const macosRelease = path.join(__dirname, '..', 'native', 'core', 'build', 'macos-x64-release', 'bin', CORE_EXE)
    const linuxRelease = path.join(__dirname, '..', 'native', 'core', 'build', 'linux-x64-release', 'bin', CORE_EXE)
    const singleConfig = path.join(__dirname, '..', 'native', 'core', 'build', 'bin', CORE_EXE)
    return [release, debug, macosRelease, linuxRelease, singleConfig].find((candidate) => fs.existsSync(candidate)) ?? release
  }

  start() {
    if (this.child) return
    const exe = this.corePath()
    if (!fs.existsSync(exe)) {
      throw new Error(`Altbase native core is not built: ${exe}`)
    }
    const nativeCoreDir = path.dirname(exe)
    const env = {
      ...process.env,
      ALTBASE_CORE_BRIDGE: '1',
    }
    if (process.platform === 'darwin') {
      env.DYLD_LIBRARY_PATH = [
        nativeCoreDir,
        process.env.DYLD_LIBRARY_PATH,
      ].filter(Boolean).join(':')
    } else if (process.platform !== 'win32') {
      env.LD_LIBRARY_PATH = [
        nativeCoreDir,
        process.env.LD_LIBRARY_PATH,
      ].filter(Boolean).join(':')
    }

    const child = spawn(exe, [CORE_BRIDGE_ARG], {
      env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.child = child
    child.stdout.on('data', (chunk) => {
      if (this.child !== child) return
      this.onData(chunk.toString('utf8'))
    })
    child.stderr.on('data', () => undefined)
    child.on('exit', () => {
      if (this.child !== child) return
      this.rejectAll('native core exited')
    })
    child.on('error', (error) => {
      if (this.child !== child) return
      this.rejectAll(error.message)
    })
  }

  onData(text) {
    this.buffer += text
    for (;;) {
      const idx = this.buffer.indexOf('\n')
      if (idx < 0) return
      const line = this.buffer.slice(0, idx).trim()
      this.buffer = this.buffer.slice(idx + 1)
      if (!line) continue

      let message
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      const slot = this.pending.get(String(message.id ?? ''))
      if (!slot) continue
      if (message.event === 'progress') {
        slot.onProgress?.(message.payload ?? {})
        continue
      }
      this.pending.delete(String(message.id))
      if (message.ok) slot.resolve(message.result ?? {})
      else slot.reject(new Error(message.error?.message ?? 'native core error'))
    }
  }

  rejectAll(message) {
    const pending = Array.from(this.pending.values())
    this.pending.clear()
    this.child = null
    for (const slot of pending) slot.reject(new Error(message))
  }

  timeoutFor(method, params = {}) {
    if (method === 'coinNodeRequest') {
      const requested = Number(params.timeoutMs)
      const requestTimeout = Number.isFinite(requested) && requested > 0 ? requested : 10_000
      return Math.min(Math.max(requestTimeout + 5_000, 6_000), 65_000)
    }
    if (method === 'privacyLightWallet') {
      if (params.action === 'send') return params.coin === 'epic' ? 240_000 : 120_000
      return 10 * 60_000
    }
    if (method === 'signTransaction') return 60_000
    return 30_000
  }

  hasPendingEpicSend() {
    return Array.from(this.pending.values()).some((slot) => (
      slot.method === 'privacyLightWallet'
      && slot.params?.coin === 'epic'
      && slot.params?.action === 'send'
    ))
  }

  waitForEpicSend(timeoutMs = 250_000) {
    if (!this.hasPendingEpicSend()) return Promise.resolve()
    return new Promise((resolve) => {
      const startedAt = Date.now()
      const timer = setInterval(() => {
        if (!this.hasPendingEpicSend() || Date.now() - startedAt >= timeoutMs) {
          clearInterval(timer)
          resolve()
        }
      }, 100)
    })
  }

  restartAfterTimeout(message) {
    const child = this.child
    this.rejectAll(message)
    this.buffer = ''
    if (child) {
      try {
        child.kill()
      } catch {
        // Best effort only.
      }
    }
  }

  request(method, params = {}, onProgress) {
    const nativeParams = {
      ...params,
      userDataDir: this.app.getPath('userData'),
    }
    if (
      method === 'privacyLightWallet'
      && nativeParams.coin === 'epic'
      && nativeParams.action === 'send'
      && this.pending.size > 0
    ) {
      this.restartAfterTimeout('native core restarted before priority epic send')
    }

    this.start()
    const id = String(this.nextId++)
    const payload = JSON.stringify({ id, method, params: nativeParams }) + '\n'
    return new Promise((resolve, reject) => {
      const timeoutMs = this.timeoutFor(method, nativeParams)
      const timer = setTimeout(() => {
        this.pending.delete(id)
        const details = method === 'privacyLightWallet'
          ? `${nativeParams.coin || 'privacy'} ${nativeParams.action || 'request'}`
          : method
        reject(new Error(`native core timeout during ${details} after ${Math.round(timeoutMs / 1000)}s`))
        this.restartAfterTimeout(`native core restarted after ${details} timeout`)
      }, timeoutMs)
      this.pending.set(id, {
        method,
        params: nativeParams,
        onProgress,
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      const failWrite = (error) => {
        const slot = this.pending.get(id)
        if (!slot) return
        this.pending.delete(id)
        slot.reject(error instanceof Error ? error : new Error(String(error)))
        this.restartAfterTimeout('native core restarted after request write failure')
      }
      try {
        this.child.stdin.write(payload, (error) => {
          if (error) failWrite(error)
        })
      } catch (error) {
        failWrite(error)
      }
    })
  }

  stop() {
    if (!this.child) return
    const child = this.child
    this.rejectAll('native core stopped')
    child.kill()
    this.child = null
  }
}

module.exports = { NativeCoreClient }

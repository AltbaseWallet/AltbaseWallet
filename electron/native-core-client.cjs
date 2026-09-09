const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const CORE_EXE = process.platform === 'win32' ? 'altbase_core_bridge.exe' : 'altbase_core_bridge'
const CORE_BRIDGE_ARG = '--altbase-wallet-bridge'
const activeNativeCoreChildren = new Set()
const traceNativeCore = (event, child, detail = '') => {
  if (process.env.ALTBASE_CORE_TRACE !== '1') return
  const label = child?.altbaseCoreLabel || 'core'
  process.stderr.write(`[native-core] ${event} label=${label} pid=${child?.pid || 0}${detail ? ` ${detail}` : ''}\n`)
}

const terminateNativeCoreChild = (child, forceAfterMs = 1_500) => {
  if (!child) return
  let exited = child.exitCode !== null
  const markExited = () => { exited = true }
  child.once?.('exit', markExited)
  try {
    traceNativeCore('terminate', child)
    child.kill()
  } catch {
    child.off?.('exit', markExited)
    return
  }
  // A helper may be blocked inside synchronous native code. Escalate after a
  // short grace period, but only while this exact ChildProcess is still alive.
  const timer = setTimeout(() => {
    child.off?.('exit', markExited)
    if (exited) return
    try {
      traceNativeCore('force-terminate', child)
      child.kill('SIGKILL')
    } catch {
      // The process may have exited between the status check and kill.
    }
  }, forceAfterMs)
  timer.unref?.()
}

const stopAllNativeCoreChildren = () => {
  for (const child of activeNativeCoreChildren) terminateNativeCoreChild(child)
}

class NativeCoreClient {
  constructor(app, label = 'core') {
    this.app = app
    this.label = label
    this.child = null
    this.children = new Set()
    this.nextId = 1
    this.pending = new Map()
    this.coinNodeQueue = Promise.resolve()
    this.buffer = ''
    this.stderrBuffer = ''
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
      cwd: nativeCoreDir,
      env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.child = child
    this.children.add(child)
    activeNativeCoreChildren.add(child)
    this.stderrBuffer = ''
    child.stdout.on('data', (chunk) => {
      if (this.child !== child) return
      this.onData(chunk.toString('utf8'))
    })
    child.stderr.on('data', (chunk) => {
      if (this.child !== child) return
      this.stderrBuffer = `${this.stderrBuffer}${chunk.toString('utf8')}`.slice(-8_192)
    })
    child.altbaseCoreLabel = this.label
    traceNativeCore('start', child)
    child.on('exit', (code, signal) => {
      traceNativeCore('exit', child, `code=${code ?? ''} signal=${signal ?? ''}`)
      this.children.delete(child)
      activeNativeCoreChildren.delete(child)
      if (this.child !== child) return
      const message = this.exitMessage(code, signal)
      this.buffer = ''
      this.stderrBuffer = ''
      this.rejectAll(message)
    })
    child.on('error', (error) => {
      traceNativeCore('error', child, `message=${String(error?.message || error).replace(/\s+/g, ' ').slice(0, 300)}`)
      if (this.child !== child) return
      this.rejectAll(error.message)
      this.terminateChild(child)
    })
    child.on('close', () => {
      this.children.delete(child)
      activeNativeCoreChildren.delete(child)
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
        slot.refreshTimeout?.()
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
      // The native HTTP layer owns the actual network deadline. Its response
      // can arrive noticeably later while DNS/TLS cleanup unwinds on a poor
      // connection, so the process watchdog must be a generous last resort,
      // not a second competing request timeout that churns helper processes.
      return Math.min(Math.max(requestTimeout + 15_000, 30_000), 90_000)
    }
    if (method === 'privacyLightWallet') {
      if (params.action === 'send') {
        // Monero refreshes the wallet before constructing a transfer. On a
        // slow connection that refresh alone can consume most of two minutes.
        // Leave time for construction and relay, with a finite overall limit.
        if (params.coin === 'monero') return 300_000
        return params.coin === 'epic' ? 240_000 : 120_000
      }
      // Initial Epic and Monero restores can legitimately spend longer than
      // ten minutes inside a native scan. Restarting the bridge at that exact
      // boundary discards the in-memory progress and creates an endless retry
      // loop. Native progress events continue to refresh this watchdog.
      return 60 * 60_000
    }
    if (method === 'signTransaction') return 60_000
    return 30_000
  }

  refreshTimeoutOnProgress(method, params = {}) {
    return method === 'privacyLightWallet' && params.action !== 'send'
  }

  exitMessage(code, signal) {
    const status = Number.isInteger(code)
      ? `code ${code}`
      : signal
        ? `signal ${signal}`
        : 'unknown status'
    const detail = this.stderrBuffer.trim().replace(/\s+/g, ' ').slice(-2_000)
    return `native core exited (${status})${detail ? `: ${detail}` : ''}`
  }

  hasPendingEpicSend() {
    if (this.epicCloseGrace) return true
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

  terminateChild(child, forceAfterMs = 1_500) {
    terminateNativeCoreChild(child, forceAfterMs)
  }

  restartAfterTimeout(message) {
    const children = Array.from(this.children)
    this.rejectAll(message)
    this.buffer = ''
    for (const child of children) this.terminateChild(child)
  }

  request(method, params = {}, onProgress) {
    if (method !== 'coinNodeRequest') return this.requestNow(method, params, onProgress)
    // Coin modules execute one blocking HTTP request at a time. Queueing here
    // starts each timeout only when its native request is actually dispatched;
    // concurrent balance, fee and context reads can no longer expire while
    // waiting behind an earlier request and restart the next request with it.
    const run = () => this.requestNow(method, params, onProgress)
    const queued = this.coinNodeQueue.then(run, run)
    this.coinNodeQueue = queued.catch(() => undefined)
    return queued
  }

  requestNow(method, params = {}, onProgress) {
    if (this.sessionClosed) return Promise.reject(new Error('Native wallet session is closed'))
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
      let timer
      const expire = () => {
        const slot = this.pending.get(id)
        this.pending.delete(id)
        const details = method === 'privacyLightWallet'
          ? `${nativeParams.coin || 'privacy'} ${nativeParams.action || 'request'}`
          : method
        const error = new Error(`native core timeout during ${details} after ${Math.round(timeoutMs / 1000)}s`)
        if (slot) slot.reject(error)
        else reject(error)
        this.restartAfterTimeout(`native core restarted after ${details} timeout`)
      }
      const armTimeout = () => {
        clearTimeout(timer)
        timer = setTimeout(expire, timeoutMs)
      }
      armTimeout()
      this.pending.set(id, {
        method,
        params: nativeParams,
        onProgress,
        refreshTimeout: this.refreshTimeoutOnProgress(method, nativeParams) ? armTimeout : undefined,
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

  closeSession(onClosed = () => undefined) {
    this.sessionClosed = true
    const sends = Array.from(this.pending.values()).filter((slot) => (
      slot.method === 'privacyLightWallet' && slot.params?.action === 'send'
    ))
    if (sends.length === 0) {
      this.stop()
      onClosed()
      return
    }
    // An already submitted transfer must settle before its helper is stopped.
    // Revoke new/queued requests immediately while retaining those send results.
    let remaining = sends.length
    const needsEpicGrace = sends.some((slot) => slot.params?.coin === 'epic')
    const settled = () => {
      if (--remaining === 0) {
        const finish = () => {
          this.epicCloseGrace = false
          this.stop()
          onClosed()
        }
        if (needsEpicGrace) {
          // Keep the same post-send flush window used by the app quit guard.
          this.epicCloseGrace = true
          setTimeout(finish, 3_000)
        } else finish()
      }
    }
    for (const slot of sends) {
      for (const key of ['resolve', 'reject']) {
        const original = slot[key]
        slot[key] = (value) => { try { original(value) } finally { settled() } }
      }
    }
  }

  stop() {
    const children = Array.from(this.children)
    if (!this.child && children.length === 0) return
    this.rejectAll('native core stopped')
    this.child = null
    for (const child of children) this.terminateChild(child)
  }
}

module.exports = { NativeCoreClient, stopAllNativeCoreChildren }

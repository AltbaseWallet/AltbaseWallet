const UPDATE_ENDPOINT = 'https://api.altbase.io/api/v1/app/update'
const DOWNLOAD_URL = 'https://altbase.io/download'
const DISMISSED_KEY = 'altbase.update.dismissed'

export type AppUpdateInfo = {
  latestVersion: string
  currentVersion: string
  downloadUrl: string
  releaseNotesUrl?: string
  message?: string
  required?: boolean
}

// The release feed advertises stable three-component application versions.
const parseVersion = (value: unknown): number[] | null => {
  if (typeof value !== 'string' || value.length > 48 || !/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) return null
  const parts = value.replace(/^v/, '').split('.').map(Number)
  return parts.every(Number.isSafeInteger) ? parts : null
}

export const compareVersions = (left: string, right: string) => {
  const a = parseVersion(left), b = parseVersion(right)
  if (!a || !b) throw new TypeError('Invalid application version')
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1
  return 0
}

const today = () => {
  const date = new Date()
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

export const dismissUpdateForToday = (version: string) => {
  if (!parseVersion(version)) return
  try { window.localStorage.setItem(DISMISSED_KEY, JSON.stringify({ version: version.replace(/^v/, ''), day: today() })) }
  catch { /* Storage restrictions must not prevent closing an optional notice. */ }
}

const dismissedToday = (version: string) => {
  try {
    const value = JSON.parse(window.localStorage.getItem(DISMISSED_KEY) || 'null')
    return value?.version === version && value.day === today()
  } catch { return false }
}

const platform = () => {
  const value = navigator.platform.toLowerCase()
  return value.includes('win') ? 'windows' : value.includes('mac') ? 'macos' : value.includes('linux') ? 'linux' : 'unknown'
}

const officialLink = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 2048) return DOWNLOAD_URL
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return DOWNLOAD_URL
    if (url.hostname === 'altbase.io' || url.hostname === 'www.altbase.io') return url.href
    if (url.hostname === 'github.com' && url.pathname.startsWith('/AltbaseWallet/AltbaseWallet/releases/')) return url.href
  } catch { /* Invalid feed links fall back to the official download page. */ }
  return DOWNLOAD_URL
}

export const checkAppUpdate = async (): Promise<AppUpdateInfo | null> => {
  const currentVersion = __APP_VERSION__
  if (!parseVersion(currentVersion)) return null
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 5_000)
  try {
    const url = new URL(UPDATE_ENDPOINT)
    url.searchParams.set('version', currentVersion)
    url.searchParams.set('platform', platform())
    url.searchParams.set('arch', 'x64')
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal })
    if (!response.ok) return null
    const data: unknown = await response.json()
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null
    const info = data as Record<string, unknown>
    if (info.ok === false || !parseVersion(info.latestVersion)) return null
    const latestVersion = (info.latestVersion as string).replace(/^v/, '')
    // An inconsistent server flag cannot offer the same version or a downgrade.
    if (compareVersions(latestVersion, currentVersion) <= 0) return null
    const required = info.required === true
    if (!required && dismissedToday(latestVersion)) return null
    return {
      latestVersion, currentVersion, required,
      downloadUrl: officialLink(info.downloadUrl),
      releaseNotesUrl: officialLink(info.releaseNotesUrl),
      message: typeof info.message === 'string' && info.message.length <= 500 ? info.message : undefined,
    }
  } catch { return null }
  finally { window.clearTimeout(timer) }
}

const API_BASE = 'https://api.altbase.io/api/v1'
const DISMISSED_KEY = 'altbase.update.dismissed'
const OFFICIAL_DOWNLOAD_URL = 'https://altbase.io/download'

export type AppUpdateInfo = {
  latestVersion: string
  currentVersion: string
  downloadUrl: string
  releaseNotesUrl?: string
  message?: string
  required?: boolean
}

type DismissedUpdate = {
  version: string
  day: string
}

const todayKey = () => new Date().toISOString().slice(0, 10)

const parseVersion = (version: string) =>
  String(version || '')
    .split(/[.+-]/)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0))

export const compareVersions = (left: string, right: string) => {
  const a = parseVersion(left)
  const b = parseVersion(right)
  const length = Math.max(a.length, b.length, 3)
  for (let i = 0; i < length; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

const platform = () => {
  const value = navigator.platform.toLowerCase()
  if (value.includes('win')) return 'windows'
  if (value.includes('mac')) return 'macos'
  if (value.includes('linux')) return 'linux'
  return 'unknown'
}

const readDismissed = (): DismissedUpdate | null => {
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DismissedUpdate
    return parsed && typeof parsed.version === 'string' && typeof parsed.day === 'string' ? parsed : null
  } catch {
    return null
  }
}

export const dismissUpdateForToday = (version: string) => {
  window.localStorage.setItem(DISMISSED_KEY, JSON.stringify({ version, day: todayKey() }))
}

const isDismissedToday = (version: string) => {
  const dismissed = readDismissed()
  return dismissed?.version === version && dismissed.day === todayKey()
}

export const checkAppUpdate = async (): Promise<AppUpdateInfo | null> => {
  const currentVersion = __APP_VERSION__
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 5_000)

  try {
    const url = new URL(`${API_BASE}/app/update`)
    url.searchParams.set('platform', platform())
    url.searchParams.set('arch', 'x64')
    url.searchParams.set('version', currentVersion)

    const response = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!response.ok) return null

    const data = await response.json() as Partial<AppUpdateInfo> & { ok?: boolean; updateAvailable?: boolean }
    const latestVersion = String(data.latestVersion || '').trim()
    if (!latestVersion) return null

    const updateAvailable = data.updateAvailable === true || compareVersions(latestVersion, currentVersion) > 0
    if (!updateAvailable || (!data.required && isDismissedToday(latestVersion))) return null

    return {
      latestVersion,
      currentVersion,
      downloadUrl: OFFICIAL_DOWNLOAD_URL,
      releaseNotesUrl: data.releaseNotesUrl || OFFICIAL_DOWNLOAD_URL,
      message: data.message,
      required: data.required === true,
    }
  } catch {
    return null
  } finally {
    window.clearTimeout(timeout)
  }
}

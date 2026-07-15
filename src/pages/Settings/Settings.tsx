import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Brush, Check, Clock3, Coins, Copy, EyeOff, FileDown, Globe2, Home, Info, KeyRound, List, Lock, Monitor, Moon, Shield, Sun, Trash2 } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { PasswordInput } from '../../components/ui/PasswordInput'
import { SeedWordCard } from '../../components/ui/SeedWordCard'
import { Toast } from '../../components/ui/Toast'
import { CoinRow } from '../../components/wallet/CoinRow'
import { PrivateKeyModal } from '../../components/wallet/PrivateKeyModal'
import { SeedPhraseWarning } from '../../components/wallet/SeedPhraseWarning'
import { walletService } from '../../services/walletService'
import { storageService } from '../../services/storageService'
import { useAuthStore } from '../../store/authStore'
import { useCoinStore } from '../../store/coinStore'
import { useSettingsStore } from '../../store/settingsStore'
import type { Coin } from '../../types/coin'
import type { AddressVariant } from '../../types/crypto'
import type { Language } from '../../types/settings'
import { copyToClipboard } from '../../utils/clipboard'
import { passwordSchema, passwordValidationKeys } from '../../utils/validatePassword'
import { SUPPORTED_LANGUAGES, useT, type TranslationKey } from '../../utils/i18n'
import { walletEngineRegistry } from '../../wallet-engines/registry'

const sectionConfig: { id: string; labelKey: TranslationKey; icon: typeof Shield }[] = [
  { id: 'security', labelKey: 'settingsSecurity', icon: Shield },
  { id: 'keys', labelKey: 'settingsPrivateKeys', icon: KeyRound },
  { id: 'seed', labelKey: 'settingsSeedPhrase', icon: Lock },
  { id: 'coins', labelKey: 'settingsCoinsManagement', icon: Coins },
  { id: 'display', labelKey: 'settingsAppearance', icon: Brush },
  { id: 'language', labelKey: 'settingsLanguage', icon: Globe2 },
  { id: 'about', labelKey: 'settingsAbout', icon: Info },
]

const LAST_SETTINGS_SECTION_KEY = 'last-settings-section'
const rememberableSettings = new Set(['main', 'security', 'keys', 'seed', 'coins', 'display', 'language', 'about'])

export default function Settings() {
  const t = useT()
  const { section } = useParams()
  const active = section && rememberableSettings.has(section) ? section : 'main'
  const content = (
    <>
      {active === 'main' && <SettingsMain />}
      {active === 'security' && <SecuritySettings />}
      {active === 'seed' && <RevealSeed />}
      {active === 'keys' && <PrivateKeys />}
      {active === 'coins' && <CoinsManagement />}
      {active === 'display' && <Appearance />}
      {active === 'language' && <Language />}
      {active === 'about' && <About />}
    </>
  )

  useEffect(() => {
    if (section && rememberableSettings.has(section)) storageService.set(LAST_SETTINGS_SECTION_KEY, section)
  }, [section])

  return (
    <div className="grid min-h-0 gap-6 xl:h-full xl:grid-cols-[300px_minmax(0,1fr)] xl:items-start xl:overflow-hidden">
      <Card className="hidden self-start xl:sticky xl:top-0 xl:block">
        <h1 className="mb-4 text-xl font-bold text-white">{t('settingsTitle')}</h1>
        <div className="space-y-1">
          <Link
            className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm ${active === 'main' ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/7'}`}
            to="/app/settings"
            onClick={() => storageService.set(LAST_SETTINGS_SECTION_KEY, 'main')}
          >
            <Home size={17} />
            {t('settingsMain')}
          </Link>
          {sectionConfig.map(({ id, labelKey, icon: Icon }) => (
            <Link
              key={id}
              className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm ${active === id ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/7'}`}
              to={`/app/settings/${id}`}
              onClick={() => {
                if (rememberableSettings.has(id)) storageService.set(LAST_SETTINGS_SECTION_KEY, id)
              }}
            >
              <Icon size={17} />
              {t(labelKey)}
            </Link>
          ))}
        </div>
      </Card>
      <div className="min-h-0 xl:h-full xl:overflow-y-auto xl:pr-1">
        {content}
      </div>
    </div>
  )
}

function SettingsMain() {
  const t = useT()
  return (
    <Card>
      <h2 className="text-lg font-semibold text-white">{t('settingsMainSections')}</h2>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {sectionConfig.map(({ id, labelKey, icon: Icon }) => (
          <Link
            key={id}
            to={`/app/settings/${id}`}
            onClick={() => {
              if (rememberableSettings.has(id)) storageService.set(LAST_SETTINGS_SECTION_KEY, id)
            }}
            className="flex items-center gap-3 rounded-[18px] border border-white/10 bg-white/7 p-4 text-slate-100 transition hover:bg-white/10"
          >
            <Icon size={20} />
            <span>{t(labelKey)}</span>
          </Link>
        ))}
      </div>
    </Card>
  )
}

function SecuritySettings() {
  const t = useT()
  const { settings, updateSettings } = useSettingsStore()
  const { lock, clearWallet } = useAuthStore()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)

  const changePassword = async () => {
    setError('')
    const ok = await walletService.unlockWallet(current)
    if (!ok) {
      setError(t('currentPasswordWrong'))
      return
    }
    const parsed = passwordSchema.safeParse(next)
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message
      setError(message && passwordValidationKeys.has(message) ? t(message as TranslationKey) : t('passwordTooShort'))
      return
    }
    if (next !== repeat) {
      setError(t('passwordsMustMatch'))
      return
    }
    await walletService.changePassword(current, next)
    setMessage(t('passwordChanged'))
    setCurrent('')
    setNext('')
    setRepeat('')
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-start gap-4 border-b border-white/10 p-5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/8 text-slate-100">
          <Shield size={20} />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-white">{t('settingsSecurity')}</h2>
          <p className="mt-1 text-sm text-slate-500">{t('securityNote')}</p>
        </div>
      </div>

      <div className="divide-y divide-white/10">
        <section className="p-5">
          <div className="mb-4 flex items-center gap-3">
            <KeyRound size={18} className="text-slate-400" />
            <h3 className="text-sm font-semibold text-slate-100">{t('changePassword')}</h3>
          </div>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
            <div className="grid gap-3 md:grid-cols-3">
              <PasswordInput autoComplete="current-password" label={t('currentPassword')} value={current} onChange={(event) => setCurrent(event.target.value)} />
              <PasswordInput autoComplete="new-password" label={t('newPasswordLabel')} value={next} onChange={(event) => setNext(event.target.value)} />
              <PasswordInput autoComplete="new-password" label={t('repeatNewPassword')} value={repeat} onChange={(event) => setRepeat(event.target.value)} error={error} />
            </div>
            <Button className="xl:min-w-44" onClick={changePassword} disabled={!current || !next || !repeat} icon={<KeyRound size={17} />}>
              {t('changePassword')}
            </Button>
          </div>
          {message && (
            <p className="mt-4 rounded-2xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-300">
              {message}
            </p>
          )}
        </section>

        <section className="grid gap-3 p-5 md:grid-cols-2">
          <label className="flex min-h-[76px] items-center gap-4 rounded-2xl border border-white/10 bg-white/6 p-4 transition hover:bg-white/8">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/8 text-slate-300">
              <Clock3 size={18} />
            </span>
            <span className="min-w-0 flex-1 space-y-2">
              <span className="block text-sm font-medium text-slate-200">{t('autoLock')}</span>
              <select
                className="h-11 w-full rounded-2xl border border-white/10 bg-[#101827] px-4 text-sm text-slate-100 outline-none transition focus:border-[var(--accent)]"
                value={settings.autoLockMinutes ?? 'never'}
                onChange={(event) => updateSettings({ autoLockMinutes: event.target.value === 'never' ? null : Number(event.target.value) })}
              >
                <option value="1">{t('oneMinute')}</option>
                <option value="5">{t('fiveMinutes')}</option>
                <option value="15">{t('fifteenMinutes')}</option>
                <option value="60">{t('oneHour')}</option>
                <option value="never">{t('never')}</option>
              </select>
            </span>
          </label>

          <label className="flex min-h-[76px] cursor-pointer items-center gap-4 rounded-2xl border border-white/10 bg-white/6 p-4 transition hover:bg-white/8">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/8 text-slate-300">
              <EyeOff size={18} />
            </span>
            <span className="min-w-0 flex-1 text-sm font-medium text-slate-200">{t('hideBalanceCheckbox')}</span>
            <input
              className="peer sr-only"
              type="checkbox"
              checked={settings.hideBalances}
              onChange={(event) => updateSettings({ hideBalances: event.target.checked })}
            />
            <span className="flex h-7 w-12 shrink-0 items-center rounded-full border border-white/10 bg-white/10 p-1 transition peer-checked:border-[var(--accent)] peer-checked:bg-[rgba(var(--accent-rgb),0.35)]">
              <span className={`h-5 w-5 rounded-full transition ${settings.hideBalances ? 'translate-x-5 bg-[#f8fafc]' : 'bg-slate-400'}`} />
            </span>
          </label>
        </section>

        <section className="flex flex-wrap gap-2 p-5">
          <Button variant="secondary" onClick={lock} icon={<Lock size={17} />}>{t('lockWallet')}</Button>
          <Button variant="danger" onClick={() => setClearConfirmOpen(true)} icon={<Trash2 size={17} />}>{t('clearLocalData')}</Button>
        </section>
      </div>
      <ConfirmDialog
        open={clearConfirmOpen}
        title={t('clearLocalData')}
        confirmText={t('clearLocalData')}
        danger
        onCancel={() => setClearConfirmOpen(false)}
        onConfirm={() => {
          setClearConfirmOpen(false)
          clearWallet()
        }}
      >
        {t('clearLocalDataConfirm')}
      </ConfirmDialog>
    </Card>
  )
}

function RevealSeed() {
  const t = useT()
  const [password, setPassword] = useState('')
  const [seed, setSeed] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [copyConfirmOpen, setCopyConfirmOpen] = useState(false)

  useEffect(() => () => setSeed(null), [])

  const reveal = async () => {
    try {
      setSeed(await walletService.getSeedPhrase(password))
      setError('')
    } catch (error) {
      setError(error instanceof Error && error.message.includes('not stored') ? t('seedNotStored') : t('wrongPassword'))
    }
  }

  const copy = async () => {
    if (!seed) return
    setCopyConfirmOpen(false)
    await copyToClipboard(seed)
    setToast(t('seedCopied'))
    window.setTimeout(() => setToast(null), 2200)
  }

  return (
    <Card className="space-y-5">
      <h2 className="text-lg font-semibold text-white">{t('settingsSeedPhrase')}</h2>
      <SeedPhraseWarning />
      {!seed ? (
        <div className="max-w-md space-y-4">
          <PasswordInput label={t('password')} value={password} onChange={(event) => setPassword(event.target.value)} error={error} />
          <Button onClick={reveal}>{t('showSeedBtn')}</Button>
        </div>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {seed.split(' ').map((word, index) => <SeedWordCard key={`${word}-${index}`} index={index + 1} word={word} />)}
          </div>
          <Button variant="secondary" onClick={() => setCopyConfirmOpen(true)}>{t('copyWithConfirm')}</Button>
        </>
      )}
      <Toast message={toast} />
      <ConfirmDialog
        open={copyConfirmOpen}
        title={t('copyConfirmTitle')}
        confirmText={t('copy')}
        danger
        onCancel={() => setCopyConfirmOpen(false)}
        onConfirm={copy}
      >
        {t('copyConfirmTitle')}
      </ConfirmDialog>
    </Card>
  )
}

function PrivateKeys() {
  const t = useT()
  const { coins, loadCoins } = useCoinStore()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Coin | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    loadCoins()
  }, [loadCoins])

  const filtered = useMemo(() => coins.filter((coin) => `${coin.name} ${coin.ticker}`.toLowerCase().includes(query.toLowerCase())), [coins, query])

  return (
    <Card>
      <h2 className="text-lg font-semibold text-white">{t('settingsPrivateKeys')}</h2>
      <p className="mt-1 text-sm text-slate-500">{t('privateKeysNote')}</p>
      <Input className="mt-5" label={t('searchLabel')} value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className="mt-4 space-y-2">
        {filtered.map((coin) => {
          const supported = Boolean(walletEngineRegistry.get(coin).exportSecret)
          return (
            <div key={coin.id} className="flex items-center justify-between gap-3 rounded-[18px] border border-white/10 bg-white/7 p-3">
              <div>
                <p className="font-semibold text-white">{coin.name}</p>
                <p className="text-sm text-slate-500">
                  {coin.ticker}
                  {!supported && <span className="ml-2 text-amber-300">· {t('coinNotSupportedShort')}</span>}
                </p>
              </div>
              <Button
                variant="secondary"
                disabled={!supported}
                title={supported ? undefined : t('coinKeyNotSupported', { coin: coin.ticker })}
                onClick={() => supported && setSelected(coin)}
              >
                {t('showPrivateKey')}
              </Button>
            </div>
          )
        })}
      </div>
      <PrivateKeyModal coin={selected} onClose={() => setSelected(null)} onToast={(message) => { setToast(message); window.setTimeout(() => setToast(null), 2200) }} />
      <Toast message={toast} />
    </Card>
  )
}

type AddressExportRow = {
  coinName: string
  ticker: string
  type: string
  address: string
}

const addressExportTypeLabel = (variant: AddressVariant) => {
  if (variant.id === 'legacy') return 'Legacy'
  if (variant.id === 'bech32') return 'bech32'
  if (variant.id === 'cashaddr') return 'CashAddr'
  if (variant.id === 'cashaddr-plain') return 'CashAddr short'
  return variant.label || 'Address'
}

const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`

const rowsToCsv = (rows: AddressExportRow[]) => [
  ['Coin', 'Ticker', 'Address Type', 'Address'].map(csvCell).join(','),
  ...rows.map((row) => [
    row.coinName,
    row.ticker,
    row.type,
    row.address,
  ].map(csvCell).join(',')),
].join('\n')

const downloadTextFile = (filename: string, text: string) => {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

const buildAddressExportRows = async (coins: Coin[]) => {
  const walletAddresses = walletService.getWalletAddresses()
  const rows: AddressExportRow[] = []

  for (const coin of coins) {
    const address = walletAddresses[coin.id] ?? coin.address
    if (!address) continue

    try {
      const variants = await walletEngineRegistry.get(coin).getAddressVariants(coin, address)
      for (const variant of variants) {
        rows.push({
          coinName: coin.name,
          ticker: coin.ticker,
          type: addressExportTypeLabel(variant),
          address: variant.address,
        })
      }
      if (variants.length > 0) continue
    } catch {
      // Fall back to the base address below.
    }

    rows.push({
      coinName: coin.name,
      ticker: coin.ticker,
      type: 'Address',
      address,
    })
  }

  return rows
}

function CoinsManagement() {
  const t = useT()
  const { coins, loadCoins, toggleFavorite, toggleEnabled, resetVisibility } = useCoinStore()
  const hiddenCount = coins.filter((c) => !c.enabled).length
  const [exportOpen, setExportOpen] = useState(false)
  const [selectedExportIds, setSelectedExportIds] = useState<string[]>([])
  const [exportLoading, setExportLoading] = useState(false)
  const [exportError, setExportError] = useState('')
  const [exportCsv, setExportCsv] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const walletAddresses = walletService.getWalletAddresses()
  const exportableCoins = useMemo(
    () => coins.filter((coin) => Boolean(walletAddresses[coin.id] ?? coin.address)),
    [coins, walletAddresses],
  )
  const selectedExportCoins = useMemo(
    () => coins.filter((coin) => selectedExportIds.includes(coin.id)),
    [coins, selectedExportIds],
  )

  useEffect(() => {
    loadCoins()
  }, [loadCoins])

  useEffect(() => {
    if (!exportOpen || selectedExportCoins.length === 0) return undefined

    let cancelled = false
    buildAddressExportRows(selectedExportCoins)
      .then((rows) => {
        if (cancelled) return
        setExportCsv(rows.length > 0 ? rowsToCsv(rows) : '')
      })
      .catch(() => {
        if (!cancelled) setExportCsv('')
      })
      .finally(() => {
        if (!cancelled) setExportLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [exportOpen, selectedExportCoins])

  const openExport = () => {
    const ids = exportableCoins.map((coin) => coin.id)
    setExportCsv(null)
    setExportLoading(ids.length > 0)
    setSelectedExportIds(ids)
    setExportError('')
    setExportOpen(true)
  }

  const closeExport = () => {
    setExportOpen(false)
    setExportCsv(null)
    setExportLoading(false)
    setExportError('')
  }

  const showToast = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(null), 2200)
  }

  const readyAddressExportCsv = async () => {
    setExportError('')
    if (exportCsv) return exportCsv
    if (selectedExportCoins.length === 0) {
      setExportError(t('exportAddressesEmpty'))
      return null
    }
    setExportLoading(true)
    try {
      const rows = await buildAddressExportRows(selectedExportCoins)
      const csv = rows.length > 0 ? rowsToCsv(rows) : ''
      setExportCsv(csv)
      if (!csv) {
        setExportError(t('exportAddressesEmpty'))
        return null
      }
      return csv
    } catch {
      setExportCsv('')
      setExportError(t('exportAddressesEmpty'))
      return null
    } finally {
      setExportLoading(false)
    }
  }

  const copyAddressExport = async () => {
    const csv = await readyAddressExportCsv()
    if (!csv) return
    await copyToClipboard(csv)
    showToast(t('exportAddressesCopied'))
  }

  const downloadAddressExport = async () => {
    const csv = await readyAddressExportCsv()
    if (!csv) return
    downloadTextFile(`altbase-addresses-${new Date().toISOString().slice(0, 10)}.csv`, csv)
    showToast(t('exportAddressesSaved'))
  }

  const setAddressExportSelection = (ids: string[]) => {
    setExportCsv(null)
    setExportError('')
    setExportLoading(ids.length > 0)
    setSelectedExportIds(ids)
  }

  const toggleExportCoin = (coinId: string) => {
    const next = selectedExportIds.includes(coinId)
      ? selectedExportIds.filter((id) => id !== coinId)
      : [...selectedExportIds, coinId]
    setAddressExportSelection(next)
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-white">{t('settingsCoinsManagement')}</h2>
          <p className="mt-1 text-sm text-slate-500">{t('coinsManagementNote')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={hiddenCount === 0}
            onClick={() => { void resetVisibility() }}
            title={t('resetCoinsDescription')}
          >
            {t('resetCoinsBtn')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={exportableCoins.length === 0}
            onClick={openExport}
            icon={<FileDown size={16} />}
          >
            {t('exportAddressesBtn')}
          </Button>
        </div>
      </div>
      <div className="mt-5 space-y-2">
        {coins.map((coin) => (
          <div key={coin.id} className="rounded-[18px] border border-white/10 bg-white/5 p-3">
            <CoinRow coin={coin} onFavorite={toggleFavorite} onHide={toggleEnabled} />
          </div>
        ))}
      </div>
      <Modal open={exportOpen} title={t('exportAddressesTitle')} placement="top" onClose={closeExport}>
        <div className="space-y-4">
          <p className="text-sm text-slate-400">{t('exportAddressesNote')}</p>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const ids = exportableCoins.map((coin) => coin.id)
                setAddressExportSelection(ids)
              }}
              disabled={selectedExportIds.length === exportableCoins.length}
            >
              {t('exportSelectAll')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setAddressExportSelection([])
              }}
              disabled={selectedExportIds.length === 0}
            >
              {t('exportClearSelection')}
            </Button>
            <span className="inline-flex h-9 items-center rounded-2xl border border-white/10 bg-white/7 px-3 text-sm text-slate-300">
              {t('exportSelectedCount', { n: selectedExportIds.length })}
            </span>
          </div>

          <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
            {coins.map((coin) => {
              const address = walletAddresses[coin.id] ?? coin.address
              const exportable = Boolean(address)
              const checked = selectedExportIds.includes(coin.id)
              return (
                <button
                  key={coin.id}
                  type="button"
                  disabled={!exportable}
                  onClick={() => exportable && toggleExportCoin(coin.id)}
                  className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition ${
                    checked
                      ? 'border-[var(--accent)] bg-[rgba(var(--accent-rgb),0.15)]'
                      : 'border-white/10 bg-white/6 hover:bg-white/8'
                  } disabled:cursor-not-allowed disabled:opacity-45`}
                >
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition ${
                    checked ? 'border-[var(--accent)] bg-[var(--accent)] text-white' : 'border-white/15 bg-white/7 text-transparent'
                  }`}>
                    <Check size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-white">{coin.name}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {coin.ticker} · {address ? address : t('exportNoAddress')}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>

          {exportError && (
            <div className="rounded-2xl border border-rose-400/30 bg-rose-400/10 p-3 text-sm text-rose-300">
              {exportError}
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              variant="secondary"
              disabled={selectedExportIds.length === 0}
              onClick={() => { void copyAddressExport() }}
              icon={<Copy size={16} />}
            >
              {t('exportCopyCsv')}
            </Button>
            <Button
              disabled={selectedExportIds.length === 0}
              onClick={() => { void downloadAddressExport() }}
              icon={<FileDown size={16} />}
            >
              {t('exportDownloadCsv')}
            </Button>
          </div>
          {exportLoading && <p className="text-xs text-slate-500">{t('loading')}</p>}
        </div>
      </Modal>
      <Toast message={toast} />
    </Card>
  )
}

function Appearance() {
  const t = useT()
  const { settings, updateSettings } = useSettingsStore()
  const themeOptions = [
    { value: 'dark', label: t('themeDark'), icon: Moon },
    { value: 'light', label: t('themeLight'), icon: Sun },
    { value: 'system', label: t('themeSystem'), icon: Monitor },
  ] as const

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-start gap-4 border-b border-white/10 p-5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/8 text-slate-100">
          <Brush size={20} />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-white">{t('settingsAppearance')}</h2>
          <p className="mt-1 text-sm text-slate-500">{t('themeLabel')}</p>
        </div>
      </div>

      <div className="divide-y divide-white/10">
        <section className="p-5">
          <div className="grid gap-3 md:grid-cols-3">
            {themeOptions.map(({ value, label, icon: Icon }) => {
              const active = settings.theme === value
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => updateSettings({ theme: value })}
                  className={`flex min-h-[74px] items-center justify-between gap-3 rounded-2xl border p-4 text-left transition ${
                    active
                      ? 'border-[var(--accent)] bg-[rgba(var(--accent-rgb),0.16)] text-white shadow-[0_10px_28px_-18px_rgba(var(--accent-rgb),0.9)]'
                      : 'border-white/10 bg-white/6 text-slate-300 hover:bg-white/8'
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/8">
                      <Icon size={18} />
                    </span>
                    <span className="text-sm font-semibold capitalize">{label}</span>
                  </span>
                  {active && <Check size={18} className="text-[var(--accent)]" />}
                </button>
              )
            })}
          </div>
        </section>

        <section className="grid gap-3 p-5 md:grid-cols-2">
          <label className="flex min-h-[76px] cursor-pointer items-center gap-4 rounded-2xl border border-white/10 bg-white/6 p-4 transition hover:bg-white/8">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/8 text-slate-300">
              <EyeOff size={18} />
            </span>
            <span className="min-w-0 flex-1 text-sm font-medium text-slate-200">{t('balanceHidden')}</span>
            <input
              className="peer sr-only"
              type="checkbox"
              checked={settings.hideBalances}
              onChange={(event) => updateSettings({ hideBalances: event.target.checked })}
            />
            <span className="flex h-7 w-12 shrink-0 items-center rounded-full border border-white/10 bg-white/10 p-1 transition peer-checked:border-[var(--accent)] peer-checked:bg-[rgba(var(--accent-rgb),0.35)]">
              <span className={`h-5 w-5 rounded-full transition ${settings.hideBalances ? 'translate-x-5 bg-[#f8fafc]' : 'bg-slate-400'}`} />
            </span>
          </label>

          <label className="flex min-h-[76px] cursor-pointer items-center gap-4 rounded-2xl border border-white/10 bg-white/6 p-4 transition hover:bg-white/8">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/8 text-slate-300">
              <List size={18} />
            </span>
            <span className="min-w-0 flex-1 text-sm font-medium text-slate-200">{t('compactCoinList')}</span>
            <input
              className="peer sr-only"
              type="checkbox"
              checked={settings.compactCoinList}
              onChange={(event) => updateSettings({ compactCoinList: event.target.checked })}
            />
            <span className="flex h-7 w-12 shrink-0 items-center rounded-full border border-white/10 bg-white/10 p-1 transition peer-checked:border-[var(--accent)] peer-checked:bg-[rgba(var(--accent-rgb),0.35)]">
              <span className={`h-5 w-5 rounded-full transition ${settings.compactCoinList ? 'translate-x-5 bg-[#f8fafc]' : 'bg-slate-400'}`} />
            </span>
          </label>
        </section>
      </div>
    </Card>
  )
}

function Language() {
  const t = useT()
  const { settings, updateSettings } = useSettingsStore()

  return (
    <Card>
      <h2 className="text-lg font-semibold text-white">{t('settingsLanguage')}</h2>
      <p className="mt-1 text-sm text-slate-500">{t('chooseLanguageNote')}</p>
      <div className="mt-5 grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {SUPPORTED_LANGUAGES.map(({ code, native }) => (
          <Button
            key={code}
            variant={settings.language === code ? 'primary' : 'secondary'}
            onClick={() => updateSettings({ language: code as Language })}
          >
            {native}
          </Button>
        ))}
      </div>
      <p className="mt-4 text-sm text-slate-500">{t('languageNote')}</p>
    </Card>
  )
}

function About() {
  const t = useT()
  return (
    <Card className="space-y-4">
      <h2 className="text-lg font-semibold text-white">Altbase Wallet</h2>
      <p className="text-slate-400">{t('walletVersion')} {__APP_VERSION__}</p>
      <div className="grid gap-2 text-sm text-slate-300">
        <a href="https://altbase.io" target="_blank" rel="noreferrer" className="hover:text-white">{t('websiteLink')}</a>
        <a href="https://altbase.io/support" target="_blank" rel="noreferrer" className="hover:text-white">{t('supportLink')}</a>
        <a href="https://altbase.io/terms" target="_blank" rel="noreferrer" className="hover:text-white">{t('termsLink')}</a>
      </div>
      <SeedPhraseWarning text={t('noServerSeedNote')} />
    </Card>
  )
}

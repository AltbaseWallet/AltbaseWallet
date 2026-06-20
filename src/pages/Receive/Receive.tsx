import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Check, Copy, Search } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { QRCodeBox } from '../../components/ui/QRCodeBox'
import { CoinIcon } from '../../components/wallet/CoinIcon'
import { CoinStatusBadge } from '../../components/wallet/CoinStatusBadge'
import { useCoinStatusLabel } from '../../components/wallet/useCoinStatusLabel'
import { SeedPhraseWarning } from '../../components/wallet/SeedPhraseWarning'
import { Toast } from '../../components/ui/Toast'
import type { AddressVariant } from '../../types/crypto'
import { walletService } from '../../services/walletService'
import { useCoinStore } from '../../store/coinStore'
import { useSettingsStore } from '../../store/settingsStore'
import { copyToClipboard } from '../../utils/clipboard'
import { formatAmount, formatUsd } from '../../utils/formatAmount'
import { formatAddress } from '../../utils/formatAddress'
import { pickDefaultCoinId, sortCoinsByPortfolioValue } from '../../utils/coinSelection'
import { isPrivacyCoin } from '../../utils/privacyCoins'
import { useT } from '../../utils/i18n'
import { walletEngineRegistry } from '../../wallet-engines/registry'

const addressVariantLabel = (variant: AddressVariant) => {
  if (variant.id === 'bech32') return 'bech32'
  if (variant.id === 'cashaddr-plain') return 'CashAddr short'
  if (variant.id === 'cashaddr') return 'CashAddr'
  if (variant.id === 'legacy') return 'Legacy'
  return variant.label
}

export default function Receive() {
  const t = useT()
  const statusLabel = useCoinStatusLabel()
  const [params] = useSearchParams()
  const paramCoinId = params.get('coin')
  const { coins, selectedCoinId, loadCoins, selectCoin } = useCoinStore()
  const hideBalances = useSettingsStore((state) => state.settings.hideBalances)
  const [manualSelectedId, setManualSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [addressType, setAddressType] = useState<AddressVariant['id']>('legacy')
  const [addressVariants, setAddressVariants] = useState<AddressVariant[]>([])
  const addressVariantCache = useRef<Record<string, AddressVariant[]>>({})
  const canDeriveAddresses = walletService.hasStoredSeedPhrase()
  const enabledCoins = useMemo(() => coins.filter((item) => item.enabled), [coins])
  const selectedId = useMemo(() => {
    const preferredId = manualSelectedId ?? paramCoinId ?? selectedCoinId
    if (preferredId && enabledCoins.some((item) => item.id === preferredId)) return preferredId
    return pickDefaultCoinId(enabledCoins)
  }, [enabledCoins, manualSelectedId, paramCoinId, selectedCoinId])
  const coin = useMemo(
    () => enabledCoins.find((item) => item.id === selectedId) ?? enabledCoins[0],
    [enabledCoins, selectedId],
  )
  const coinId = coin?.id
  const effectiveAddress = coin ? walletService.getWalletAddresses()[coin.id] ?? coin.address : ''
  const privacyCoin = isPrivacyCoin(coin)
  const filteredCoins = useMemo(
    () =>
      sortCoinsByPortfolioValue(
        enabledCoins.filter((item) => `${item.name} ${item.ticker}`.toLowerCase().includes(query.toLowerCase())),
      ),
    [enabledCoins, query],
  )

  useEffect(() => {
    loadCoins()
  }, [loadCoins])

  useEffect(() => {
    let cancelled = false
    const selectedCoin = coin
    void Promise.resolve().then(async () => {
      if (cancelled) return
      if (!coinId || !effectiveAddress) {
        if (cancelled) return
        setAddressVariants([])
        setAddressType('legacy')
        return
      }
      const cacheKey = `${coinId}:${effectiveAddress}`
      const cached = addressVariantCache.current[cacheKey]
      if (cached?.length) {
        setAddressVariants(cached)
        setAddressType((current) => cached.some((variant) => variant.id === current) ? current : cached[0].id)
        return
      }
      const legacyFallback: AddressVariant = {
        id: 'legacy',
        label: 'Legacy',
        address: effectiveAddress,
        scriptKind: 'p2pkh',
      }
      setAddressVariants((current) => {
        if (current.length > 0 && current.some((variant) => variant.address === effectiveAddress)) return current
        return [legacyFallback]
      })
      setAddressType((current) => current === 'legacy' ? current : 'legacy')
      try {
        const variants = selectedCoin
          ? await walletEngineRegistry.get(selectedCoin).getAddressVariants(selectedCoin, effectiveAddress)
          : [legacyFallback]
        if (cancelled) return
        const nextVariants = variants.length > 0 ? variants : [legacyFallback]
        addressVariantCache.current[cacheKey] = nextVariants
        setAddressVariants(nextVariants)
        setAddressType((current) => nextVariants.some((variant) => variant.id === current) ? current : nextVariants[0]?.id ?? 'legacy')
      } catch {
        if (cancelled) return
        addressVariantCache.current[cacheKey] = [legacyFallback]
        setAddressVariants([legacyFallback])
        setAddressType('legacy')
      }
    })
    return () => { cancelled = true }
  }, [coin, coinId, effectiveAddress])

  const activeAddress = addressVariants.find((variant) => variant.id === addressType)?.address ?? effectiveAddress

  const showToast = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(null), 2200)
  }

  const copy = async () => {
    if (!activeAddress) {
      showToast(t('addressNotReceived'))
      return
    }
    await copyToClipboard(activeAddress)
    showToast(t('addressCopied'))
  }

  if (!coin) return <Card>{t('loadingAddress')}</Card>

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(340px,430px)_minmax(0,1fr)]">
      <Card className="space-y-4">
        <div>
          <h1 className="text-xl font-bold text-white">{t('receiveTitle')}</h1>
          <p className="mt-1 text-sm text-slate-500">{t('receiveCoinHint')}</p>
        </div>

        <Input label={t('searchCoinLabel')} placeholder={t('searchCoinHint')} value={query} onChange={(event) => setQuery(event.target.value)} />

        <div className="max-h-[620px] space-y-2 overflow-y-auto pr-1">
          {filteredCoins.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`grid w-full grid-cols-[1fr_auto] items-center gap-3 rounded-[18px] border px-3 py-3 text-left transition ${
                item.id === coin.id ? 'border-[var(--accent)] bg-[var(--accent)]/10' : 'border-white/10 bg-white/6 hover:bg-white/9'
              }`}
              onClick={() => {
                setManualSelectedId(item.id)
                selectCoin(item.id)
              }}
            >
              <div className="flex min-w-0 items-center gap-3">
                <CoinIcon ticker={item.ticker} />
                <div className="min-w-0">
                  <p className="truncate font-semibold text-white">{item.name}</p>
                  <p className="text-sm text-slate-500">
                    {item.ticker} · {hideBalances ? '••••' : formatAmount(item.balance, item.ticker)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <CoinStatusBadge status={item.status} recoveryProgress={item.recoveryProgress} className="hidden sm:inline-flex" />
                {item.id === coin.id && <Check size={18} className="text-[var(--accent)]" />}
              </div>
            </button>
          ))}

          {filteredCoins.length === 0 && (
            <div className="rounded-[18px] border border-dashed border-white/15 p-6 text-center text-sm text-slate-400">
              <Search className="mx-auto mb-2" size={18} />
              {t('noCoinsFound')}
            </div>
          )}
        </div>
      </Card>

      <Card className="space-y-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex items-center gap-3">
            <CoinIcon ticker={coin.ticker} className="h-12 w-12" />
            <div>
              <h2 className="text-xl font-bold text-white">{coin.name}</h2>
              <p className="text-sm text-slate-500">
                {coin.ticker} · {statusLabel(coin.status)} · {hideBalances ? '••••' : formatUsd(coin.fiatValue)}
              </p>
            </div>
          </div>
          <CoinStatusBadge status={coin.status} recoveryProgress={coin.recoveryProgress} />
        </div>

        <QRCodeBox value={activeAddress} />

        <div className="rounded-2xl border border-white/10 bg-white/7 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-slate-500">Address</p>
              {addressVariants.length > 1 && (
                <div
                  className="mt-2 inline-flex max-w-full flex-wrap items-center gap-1 rounded-2xl border border-white/10 bg-[#101827]/80 p-1"
                  role="tablist"
                  aria-label="Address type"
                >
                  {addressVariants.map((variant) => (
                    <button
                      key={variant.id}
                      type="button"
                      role="tab"
                      aria-selected={addressType === variant.id}
                      onClick={() => setAddressType(variant.id)}
                      className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                        addressType === variant.id
                          ? 'bg-[var(--accent)] text-white shadow-[0_8px_20px_-14px_rgba(var(--accent-rgb),0.95)]'
                          : 'text-slate-400 hover:bg-white/8 hover:text-white'
                      }`}
                    >
                      {addressVariantLabel(variant)}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <span className="font-mono text-xs text-slate-500">{activeAddress ? formatAddress(activeAddress) : t('addressNotYetShort')}</span>
          </div>
          <p className="break-all font-mono text-sm text-white">{activeAddress || t('addressNotReceived')}</p>
        </div>

        {!effectiveAddress && !privacyCoin && (
          <div className="rounded-2xl border border-amber-400/25 bg-amber-400/10 p-4 text-sm text-amber-100">
            {canDeriveAddresses ? t('addressUnlockHint') : t('addressOldBuildHint')}
          </div>
        )}

        <SeedPhraseWarning text={t('doNotSendOtherCoin')} />

        {activeAddress ? (
          <Button className="w-full" size="lg" onClick={copy} icon={<Copy size={17} />}>
            {t('copyAddress')}
          </Button>
        ) : !privacyCoin ? (
          <Link to="/restore">
            <Button className="w-full" size="lg" variant="secondary">
              {t('restoreFromSeedBtn')}
            </Button>
          </Link>
        ) : (
          <Button className="w-full" size="lg" variant="secondary" disabled>
            {t('addressNotReceived')}
          </Button>
        )}
      </Card>
      <Toast message={toast} />
    </div>
  )
}

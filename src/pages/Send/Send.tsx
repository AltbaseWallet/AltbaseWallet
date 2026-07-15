import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Check, Loader2, RefreshCw, Search, SendHorizontal } from 'lucide-react'
import { z } from 'zod'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { CoinIcon } from '../../components/wallet/CoinIcon'
import { CoinStatusBadge } from '../../components/wallet/CoinStatusBadge'
import { SeedPhraseWarning } from '../../components/wallet/SeedPhraseWarning'
import { useAuthStore } from '../../store/authStore'
import { useCoinStore } from '../../store/coinStore'
import { useSettingsStore } from '../../store/settingsStore'
import { useTransactionStore } from '../../store/transactionStore'
import { formatAmount, formatUsd } from '../../utils/formatAmount'
import { formatAddress } from '../../utils/formatAddress'
import { addAmounts, compareAmounts, fromBaseUnits, toBaseUnits } from '../../utils/decimalAmount'
import { pickDefaultCoinId, sortCoinsByPortfolioValue } from '../../utils/coinSelection'
import { isPrivacyCoin } from '../../utils/privacyCoins'
import { showSystemNotification } from '../../utils/systemNotification'
import { translate, useT } from '../../utils/i18n'
import { privacyFeeForCoin, walletEngineRegistry } from '../../wallet-engines/registry'

const buildSchema = (lang: import('../../types/settings').Language) =>
  z.object({
    coinId: z.string().min(1, translate(lang, 'selectCoinFirst')),
    to: z.string().trim().min(3, translate(lang, 'recipientAddress')),
    amount: z
      .string()
      .min(1, translate(lang, 'amount'))
      .refine(
        (v) => /^\d+(\.\d+)?$/.test(v.trim()) && Number(v) > 0,
        translate(lang, 'amount'),
      ),
    comment: z.string().optional(),
  })

type SendForm = {
  coinId: string
  to: string
  amount: string
  comment?: string
}

type FeeMode = 'auto' | 'manual'
type ConfirmingData = SendForm & {
  estimatedFee: string
  feeMode: FeeMode
  sendMax?: boolean
  lockFee?: boolean
}
type FeeEstimate = { satoshis: number; coin: string; exact?: boolean }

const PENDING_OUTGOING_UI_LOCK_MS = 10 * 60_000
const FORM_PREFLIGHT_TIMEOUT_MS = 20_000
const SAMPLE_RECIPIENT_ADDRESSES: Record<string, string> = {
  bitcoin2: 'B2Qx4m9Vh7Kp2Nf6Rc8Tz5Yw3Ls1Aa9DqE',
  bitcoincashii: 'bch2q9m4n7p2x6r8t5v3w1z0k4s7d2f6h8j3l5c',
  capstash: 'cap1q9x5n2v7r4t8k3m6p0s1d5f9h2j4l7c8w',
  firo: 'a8Yq7pM4nT2vK9rX5sL3cW6hD1eF0gB8jZ',
  kerrigan: 'Kx7mQ2vN9rT4sP6cL1wD8hF5jZ3aB0eYgR',
  litecoinii: 'L2q8m5n1v9r4t7k3p6s0d2f5h8j1c4w7z',
  pepecoin: 'Pp8x4n7m2v9r5t1k6s3d0f8h2j4c7w5zQ',
  scash: 'scash1q8n4m7v2r9t5k1p6s3d0f8h2j4c7w5zq',
  neoxa: 'NQx7m2v9r4t6k1p8s5d3f0h7j2c4w9z5a',
  terracoin: 'TR7x4m9v2r6t1k8p5s3d0f7h2j4c9w5zA',
  junkcoin: 'Jx5m8v2r9t4k7p1s6d3f0h8j2c4w9z5q',
  raptoreum: 'RRx8m4v9t2k7p5s1d6f3h0j8c4w2z9qA',
  pearl: 'prl1q9x4m7v2r8t5k1p6s3d0f9h2j4c7w5z8nq',
  quai: '0x7A19c8E45b2D6f03A91e4C70F58B2d93a6E1F24C',
}

const decimalsForScale = (scale = 100_000_000) => {
  let value = Math.max(1, Math.trunc(scale))
  let decimals = 0
  while (value > 1 && value % 10 === 0) {
    value /= 10
    decimals += 1
  }
  return value === 1 ? decimals : 8
}

const feeTextToSats = (fee: string, scale = 100_000_000) =>
  Number(toBaseUnits(fee, decimalsForScale(scale)))

const subtractAmounts = (amount: string, fee: string, decimals = 8) => {
  const next = toBaseUnits(amount || '0', decimals) - toBaseUnits(fee || '0', decimals)
  return fromBaseUnits(next > 0n ? next : 0n, decimals)
}

const withPreflightTimeout = <T,>(promise: Promise<T>, label: string): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), FORM_PREFLIGHT_TIMEOUT_MS)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })

export default function Send() {
  const t = useT()
  const language = useSettingsStore((s) => s.settings.language)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const paramCoinId = params.get('coin')
  const { coins, selectedCoinId, selectCoin: rememberCoin } = useCoinStore()
  const hideBalances = useSettingsStore((state) => state.settings.hideBalances)
  const sendTransaction = useTransactionStore((state) => state.sendTransaction)
  const transactions = useTransactionStore((state) => state.transactions)
  const sessionMnemonic = useAuthStore((state) => state.sessionMnemonic)

  const [confirming, setConfirming] = useState<ConfirmingData | null>(null)
  const [sendError, setSendError] = useState('')
  const [sending, setSending] = useState(false)
  const [query, setQuery] = useState('')
  const [mobilePane, setMobilePane] = useState<'coins' | 'details'>(() => paramCoinId ? 'details' : 'coins')
  const [maxIntent, setMaxIntent] = useState<{ coinId: string; amount: string; fee: string } | null>(null)
  // Synchronous lock — useRef updates immediately, useState batches.
  // Without this, two rapid clicks within the same React batch could both pass the
  // `sending` check before any of them flips it to true.
  const sendLockRef = useRef(false)

  // Auto-fee state (in the live coin's unit)
  const [feeEstimate, setFeeEstimate] = useState<FeeEstimate | null>(null)
  const [minimumFeeEstimate, setMinimumFeeEstimate] = useState<FeeEstimate | null>(null)
  const [feeLoading, setFeeLoading] = useState(false)
  const [feeRefreshing, setFeeRefreshing] = useState(false)
  const [maxLoading, setMaxLoading] = useState(false)
  const [feeMode, setFeeMode] = useState<FeeMode>('auto')
  const [manualFee, setManualFee] = useState('')
  const [manualFeeError, setManualFeeError] = useState('')
  const [pendingOutgoingNow, setPendingOutgoingNow] = useState(0)
  const feeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const feeRequestSeqRef = useRef(0)
  const minimumFeeRequestSeqRef = useRef(0)
  const maxFeeEstimateRef = useRef<{ coinId: string; amount: string; fee: FeeEstimate } | null>(null)

  const sendSchema = useMemo(() => buildSchema(language), [language])

  const {
    register,
    handleSubmit,
    control,
    setValue,
    setError,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<SendForm>({
    resolver: zodResolver(sendSchema),
    defaultValues: {
      coinId: params.get('coin') ?? '',
      amount: '',
      to: '',
      comment: '',
    },
  })

  const liveCoinId = useWatch({ control, name: 'coinId' })
  const amount = useWatch({ control, name: 'amount' }) ?? ''
  const recipientAddress = useWatch({ control, name: 'to' }) ?? ''

  const enabledCoins = useMemo(() => coins.filter((c) => c.enabled), [coins])
  const pendingOutgoingCoins = useMemo(() => {
    const locked = new Set<string>()
    for (const tx of transactions) {
      if (tx.type !== 'outgoing' || tx.status !== 'pending') continue
      const createdAtMs = Date.parse(tx.createdAt)
      if (
        pendingOutgoingNow > 0
        && Number.isFinite(createdAtMs)
        && pendingOutgoingNow - createdAtMs > PENDING_OUTGOING_UI_LOCK_MS
      ) continue
      // Snapshot-derived privacy pending rows can be stale after a restore, but
      // locally-created privacy sends carry a balance reservation and must lock
      // the form until the local/native spend state catches up.
      if (
        isPrivacyCoin(coins.find((c) => c.id === tx.coinId))
        && !tx.balanceBefore
        && !tx.expectedBalanceAfter
      ) continue
      locked.add(tx.coinId)
    }
    return locked
  }, [transactions, coins, pendingOutgoingNow])
  const liveCoin = enabledCoins.find((c) => c.id === liveCoinId) ?? enabledCoins[0]
  const liveCoinRef = useRef(liveCoin)
  const liveCoinAddress = liveCoin?.address
  const liveCoinLocked = Boolean(liveCoin && pendingOutgoingCoins.has(liveCoin.id))
  const selectedCoin = useMemo(
    () => coins.find((c) => c.id === confirming?.coinId),
    [coins, confirming],
  )
  const filteredCoins = useMemo(
    () =>
      sortCoinsByPortfolioValue(
        enabledCoins.filter((c) =>
          `${c.name} ${c.ticker}`.toLowerCase().includes(query.toLowerCase()),
        ),
      ),
    [enabledCoins, query],
  )

  const feeUnit = liveCoin?.satsPerCoin ?? 100_000_000
  const liveCoinFeeId = liveCoin?.id ?? ''
  const liveCoinSatsPerCoin = liveCoin?.satsPerCoin ?? 100_000_000
  const liveCoinEngine = liveCoin ? walletEngineRegistry.get(liveCoin) : null
  const liveCoinEngineKind = liveCoinEngine?.kind
  const feeSliderStep = Math.max(1, Math.round(feeUnit / 100_000))
  const feeSliderMin = Math.max(feeSliderStep, minimumFeeEstimate?.satoshis ?? 0)
  const feeSliderDefault = Math.max(feeSliderMin, Math.round(feeUnit / 10_000))
  const feeSliderBaseMax = Math.max(feeSliderDefault * 100, feeSliderMin * 10)
  const manualFeeSats = /^\d+(\.\d+)?$/.test(manualFee.trim())
    ? Math.max(feeSliderMin, Math.round(parseFloat(manualFee.trim()) * feeUnit))
    : feeSliderMin
  const feeSliderMax = Math.max(feeSliderBaseMax, manualFeeSats)
  const satsToFeeText = (sats: number) =>
    (sats / feeUnit).toFixed(8).replace(/\.?0+$/, '')

  const showMemo = Boolean(liveCoin?.supportsMemo)
  const liveCoinPrivacy = liveCoinEngineKind === 'privacy'
  const liveCoinSpendableBalance = liveCoinPrivacy
    ? liveCoin?.spendableBalance ?? liveCoin?.balance ?? '0'
    : liveCoin?.spendableBalance ?? liveCoin?.balance ?? '0'
  const privacyAutoFee = liveCoin ? privacyFeeForCoin(liveCoin.id, liveCoin.satsPerCoin ?? 100_000_000)?.coin : undefined
  const recipientPlaceholder = liveCoin
    ? SAMPLE_RECIPIENT_ADDRESSES[liveCoin.id] ?? `${liveCoin.ticker} recipient address`
    : t('recipientAddress')
  const amountLooksValid = /^\d+(\.\d+)?$/.test(amount.trim()) && Number(amount) > 0
  const liveFeeContext = useMemo(() => ({
    fromAddress: liveCoinAddress,
    toAddress: recipientAddress.trim() || undefined,
    amountCoin: amountLooksValid ? amount.trim() : undefined,
  }), [amount, amountLooksValid, liveCoinAddress, recipientAddress])
  const waitingForAutoFee = feeMode === 'auto'
    && !liveCoinPrivacy
    && Boolean(liveCoinEngine)
    && amountLooksValid
    && !feeEstimate
  const maxNeedsAutoFee = feeMode === 'auto'
    && !liveCoinPrivacy
    && Boolean(liveCoinEngine)
    && !liveCoinEngine?.estimateMaxSend
    && !feeEstimate
  const canRefreshAutoFee = feeMode === 'auto'
    && Boolean(liveCoin)
    && !liveCoinPrivacy
    && Boolean(liveCoinEngine)
  const continueBusy = isSubmitting || feeLoading || maxLoading || waitingForAutoFee
  const continueDisabled = isSubmitting
    || feeLoading
    || maxLoading
    || liveCoin?.status !== 'active'
    || liveCoinLocked
    || waitingForAutoFee

  useEffect(() => {
    liveCoinRef.current = liveCoin
  }, [liveCoin])

  useEffect(() => {
    const refreshPendingOutgoingNow = () => setPendingOutgoingNow(Date.now())
    refreshPendingOutgoingNow()
    const interval = window.setInterval(refreshPendingOutgoingNow, 15_000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    if (liveCoinId && enabledCoins.some((coin) => coin.id === liveCoinId)) return
    const nextId = pickDefaultCoinId(enabledCoins, paramCoinId ?? selectedCoinId)
    if (!nextId) return
    if (nextId !== liveCoinId) setValue('coinId', nextId)
    if (nextId !== selectedCoinId) rememberCoin(nextId)
  }, [enabledCoins, liveCoinId, paramCoinId, rememberCoin, selectedCoinId, setValue])

  useEffect(() => {
    if (!maxIntent) maxFeeEstimateRef.current = null
  }, [maxIntent])

  useEffect(() => {
    const requestSeq = ++minimumFeeRequestSeqRef.current
    void Promise.resolve().then(() => {
      if (requestSeq === minimumFeeRequestSeqRef.current) setMinimumFeeEstimate(null)
    })
    const coin = liveCoinRef.current
    if (!coin || !liveCoinFeeId) return
    if (liveCoinPrivacy) {
      const fee = privacyFeeForCoin(liveCoinFeeId, liveCoinSatsPerCoin)?.coin
      if (fee) {
        const minFee = { satoshis: feeTextToSats(fee, liveCoinSatsPerCoin), coin: fee, exact: true }
        void Promise.resolve().then(() => {
          if (requestSeq === minimumFeeRequestSeqRef.current) setMinimumFeeEstimate(minFee)
        })
      }
      return
    }
    const engine = walletEngineRegistry.get(coin)
    const estimateMinimum = engine.estimateMinimumFee ?? engine.estimateFee
    if (!estimateMinimum) return
    void withPreflightTimeout(estimateMinimum(coin), 'Minimum fee request').then((est) => {
      if (!est) return
      if (requestSeq === minimumFeeRequestSeqRef.current) setMinimumFeeEstimate(est)
    }).catch(() => undefined)
  }, [liveCoinAddress, liveCoinEngineKind, liveCoinFeeId, liveCoinPrivacy, liveCoinSatsPerCoin])

  // Keep MAX's exact fee stable. Fee fetching itself is coin-scoped below.
  useEffect(() => {
    if (feeDebounceRef.current) clearTimeout(feeDebounceRef.current)

    const maxFee = maxFeeEstimateRef.current
    if (
      feeMode === 'auto'
      && liveCoinFeeId
      && maxFee
      && maxFee.coinId === liveCoinFeeId
      && maxFee.amount === amount
    ) {
      void Promise.resolve().then(() => {
        if (maxFeeEstimateRef.current === maxFee) {
          setFeeEstimate(maxFee.fee)
          setFeeLoading(false)
        }
      })
      return
    }
  }, [amount, feeMode, liveCoinFeeId])

  useEffect(() => {
    if (feeDebounceRef.current) {
      clearTimeout(feeDebounceRef.current)
      feeDebounceRef.current = null
    }
    const requestSeq = ++feeRequestSeqRef.current
    const setFeeState = (fee: FeeEstimate | null, loading = false) => {
      void Promise.resolve().then(() => {
        if (requestSeq !== feeRequestSeqRef.current) return
        setFeeEstimate((current) => {
          if (current === fee) return current
          if (!current || !fee) return fee
          return current.satoshis === fee.satoshis
            && current.coin === fee.coin
            && current.exact === fee.exact
            ? current
            : fee
        })
        setFeeLoading(loading)
      })
    }
    const coin = liveCoinRef.current
    if (feeMode !== 'auto' || !coin || !liveCoinFeeId) {
      setFeeState(null)
      return
    }
    const maxFee = maxFeeEstimateRef.current
    if (
      maxFee
      && maxFee.coinId === liveCoinFeeId
      && maxFee.amount === amount
    ) {
      setFeeState(maxFee.fee)
      setSendError('')
      return
    }
    if (liveCoinPrivacy) {
      const fee = privacyAutoFee
      setFeeState(fee ? { satoshis: feeTextToSats(fee, liveCoinSatsPerCoin), coin: fee, exact: true } : null)
      return
    }
    const delayMs = amountLooksValid && recipientAddress.trim() ? 450 : 150
    feeDebounceRef.current = setTimeout(() => {
      feeDebounceRef.current = null
      const currentCoin = liveCoinRef.current
      if (!currentCoin || currentCoin.id !== liveCoinFeeId || requestSeq !== feeRequestSeqRef.current) return
      const engine = walletEngineRegistry.get(currentCoin)
      setFeeLoading(true)
      void withPreflightTimeout(engine.estimateFee(currentCoin, liveFeeContext), 'Fee request').then((est) => {
        if (requestSeq === feeRequestSeqRef.current) {
          setFeeEstimate(est)
          setSendError('')
        }
      }).catch((error) => {
        if (requestSeq === feeRequestSeqRef.current && amountLooksValid && recipientAddress.trim()) {
          setSendError(t('feeFetchFailed', { msg: (error as Error).message }))
        }
      }).finally(() => {
        if (requestSeq === feeRequestSeqRef.current) setFeeLoading(false)
      })
    }, delayMs)
    return () => {
      if (feeDebounceRef.current) {
        clearTimeout(feeDebounceRef.current)
        feeDebounceRef.current = null
      }
    }
  }, [amount, amountLooksValid, feeMode, liveCoinAddress, liveCoinEngineKind, liveCoinFeeId, liveCoinPrivacy, liveCoinSatsPerCoin, liveFeeContext, privacyAutoFee, recipientAddress, t])

  const selectCoin = (coinId: string) => {
    const changedCoin = coinId !== liveCoinId
    rememberCoin(coinId)
    setValue('coinId', coinId, { shouldDirty: true, shouldValidate: true })
    if (changedCoin) {
      setValue('to', '', { shouldDirty: true, shouldValidate: false })
      setValue('amount', '', { shouldDirty: true, shouldValidate: false })
      setValue('comment', '', { shouldDirty: true, shouldValidate: false })
      clearErrors(['coinId', 'to', 'amount', 'comment'])
      setConfirming(null)
      setSendError('')
    }
    if (feeDebounceRef.current) clearTimeout(feeDebounceRef.current)
    feeRequestSeqRef.current += 1
    maxFeeEstimateRef.current = null
    setMaxIntent(null)
    setFeeEstimate(null)
    setFeeLoading(false)
    setFeeRefreshing(false)
    setManualFee('')
    setManualFeeError('')
    setMobilePane('details')
  }

  const refreshAutoFee = async () => {
    if (!liveCoin || !liveCoinEngine || !canRefreshAutoFee) return

    const requestSeq = ++feeRequestSeqRef.current
    setFeeRefreshing(true)
    setFeeLoading(true)
    setSendError('')
    maxFeeEstimateRef.current = null
    setMaxIntent(null)

    try {
      const est = await withPreflightTimeout(
        liveCoinEngine.estimateFee(liveCoin, { ...liveFeeContext, force: true }),
        'Fee refresh',
      )
      if (requestSeq === feeRequestSeqRef.current) setFeeEstimate(est)

      const estimateMinimum = liveCoinEngine.estimateMinimumFee
      if (estimateMinimum) {
        const minSeq = ++minimumFeeRequestSeqRef.current
        void estimateMinimum(liveCoin, { force: true }).then((min) => {
          if (!min) return
          if (minSeq === minimumFeeRequestSeqRef.current) setMinimumFeeEstimate(min)
        }).catch(() => undefined)
      }
    } catch (error) {
      if (requestSeq === feeRequestSeqRef.current) {
        setFeeEstimate(null)
        setSendError(t('feeFetchFailed', { msg: (error as Error).message }))
      }
    } finally {
      if (requestSeq === feeRequestSeqRef.current) {
        setFeeLoading(false)
        setFeeRefreshing(false)
      }
    }
  }

  const resolveFee = async (coin: typeof liveCoin, options: { force?: boolean } = {}): Promise<FeeEstimate | null> => {
    if (feeMode === 'manual') {
      const feeText = manualFee.trim()
      const parsedFeeSats = /^\d+(\.\d+)?$/.test(feeText)
        ? Math.round(parseFloat(feeText) * (coin?.satsPerCoin ?? 100_000_000))
        : 0
      if (minimumFeeEstimate && parsedFeeSats < minimumFeeEstimate.satoshis) {
        setManualFeeError(t('manualFeeBelowMinimum', {
          fee: minimumFeeEstimate.coin,
          ticker: coin?.ticker ?? '',
        }))
        return null
      }
      return { satoshis: parsedFeeSats, coin: feeText, exact: true }
    }
    if (maxIntent && maxIntent.coinId === coin?.id && maxIntent.amount === amount) {
      return {
        satoshis: feeTextToSats(maxIntent.fee, coin?.satsPerCoin ?? 100_000_000),
        coin: maxIntent.fee,
        exact: true,
      }
    }
    if (coin && isPrivacyCoin(coin)) {
      const fee = feeEstimate?.coin ?? privacyFeeForCoin(coin.id, coin.satsPerCoin ?? 100_000_000)?.coin ?? '0'
      if (!feeEstimate && fee !== '0') {
        setFeeEstimate({ satoshis: feeTextToSats(fee, coin.satsPerCoin ?? 100_000_000), coin: fee, exact: true })
      }
      return {
        satoshis: feeTextToSats(fee, coin.satsPerCoin ?? 100_000_000),
        coin: fee,
        exact: true,
      }
    }
    if (feeEstimate && !options.force) return feeEstimate
    if (!coin) return null

    setFeeLoading(true)
    try {
      const est = await withPreflightTimeout(walletEngineRegistry.get(coin).estimateFee(coin, {
        force: options.force,
        fromAddress: coin.address,
        toAddress: recipientAddress.trim() || undefined,
        amountCoin: amountLooksValid ? amount.trim() : undefined,
      }), 'Fee request')
      if (!est) return null
      setFeeEstimate(est)
      return est
    } catch (error) {
      setSendError(t('feeFetchFailed', { msg: (error as Error).message }))
      return null
    } finally {
      setFeeLoading(false)
    }
  }

  const handleMax = async () => {
    if (!liveCoin) return
    if (liveCoinLocked) {
      setError('amount', { message: t('pendingOutgoingLocked') })
      setValue('amount', '0', { shouldValidate: true })
      return
    }

    const feeText = feeMode === 'manual'
      ? manualFee.trim()
      : feeEstimate?.coin ?? privacyAutoFee ?? ''
    const hasExactMaxEstimator = Boolean(liveCoinEngine?.estimateMaxSend && liveCoin.address)
    if (feeMode === 'auto' && !feeText && !hasExactMaxEstimator) {
      setError('amount', { message: t('feeFetchFailed', { msg: t('autoFee') }) })
      return
    }
    if (feeMode === 'manual' && (!/^\d+(\.\d+)?$/.test(feeText) || parseFloat(feeText) <= 0)) {
      setManualFeeError(t('manualFeeGreaterThanZero'))
      return
    }

    if (liveCoinPrivacy) {
      const decimals = decimalsForScale(liveCoin.satsPerCoin ?? 100_000_000)
      const maxAmount = subtractAmounts(liveCoinSpendableBalance, feeText || '0', decimals)
      if (compareAmounts(maxAmount, '0', decimals) <= 0) {
        setError('amount', { message: t('balanceLessFee') })
        return
      }
      if (feeMode === 'auto' && feeText !== '0') {
        const fee = { satoshis: feeTextToSats(feeText, liveCoin.satsPerCoin ?? 100_000_000), coin: feeText }
        maxFeeEstimateRef.current = { coinId: liveCoin.id, amount: maxAmount, fee }
        setFeeEstimate(fee)
      }
      setSendError('')
      setMaxIntent({ coinId: liveCoin.id, amount: maxAmount, fee: feeText })
      setValue('amount', maxAmount, { shouldValidate: true, shouldDirty: true })
      return
    }

    setMaxLoading(true)
    setSendError('')
    try {
      if (liveCoinEngine?.estimateMaxSend && liveCoin.address) {
        const result = await liveCoinEngine.estimateMaxSend(
          liveCoin,
          liveCoin.address,
          feeMode === 'manual' ? feeText : undefined,
          recipientAddress.trim(),
        )
        const fee = {
          satoshis: result.feeSatoshis ?? feeTextToSats(result.feeCoin, liveCoin.satsPerCoin ?? 100_000_000),
          coin: result.feeCoin,
        }
        if (compareAmounts(result.amountCoin, '0', decimalsForScale(liveCoin.satsPerCoin ?? 100_000_000)) <= 0) {
          setError('amount', { message: t('balanceLessFee') })
          return
        }
        maxFeeEstimateRef.current = { coinId: liveCoin.id, amount: result.amountCoin, fee }
        if (feeMode === 'auto') setFeeEstimate(fee)
        setMaxIntent({ coinId: liveCoin.id, amount: result.amountCoin, fee: result.feeCoin })
        setValue('amount', result.amountCoin, { shouldValidate: true, shouldDirty: true })
        return
      }

      const decimals = decimalsForScale(liveCoin.satsPerCoin ?? 100_000_000)
      const maxAmount = subtractAmounts(liveCoinSpendableBalance, feeText, decimals)
      if (compareAmounts(maxAmount, '0', decimals) <= 0) {
        setError('amount', { message: t('balanceLessFee') })
        return
      }

      if (feeMode === 'auto' && feeText !== '0') {
        const fee = { satoshis: feeTextToSats(feeText, liveCoin.satsPerCoin ?? 100_000_000), coin: feeText }
        maxFeeEstimateRef.current = { coinId: liveCoin.id, amount: maxAmount, fee }
        if (!feeEstimate) {
          setFeeEstimate(fee)
        }
      }
      setMaxIntent({ coinId: liveCoin.id, amount: maxAmount, fee: feeText })
      setValue('amount', maxAmount, { shouldValidate: true, shouldDirty: true })
    } catch (error) {
      setError('amount', { message: t('feeFetchFailed', { msg: (error as Error).message }) })
    } finally {
      setMaxLoading(false)
    }
  }

  const onSubmit = async (values: SendForm) => {
    const coin = coins.find((c) => c.id === values.coinId)
    if (!coin) return

    if (pendingOutgoingCoins.has(coin.id)) {
      setError('amount', { message: t('pendingOutgoingLocked') })
      return
    }

    const decimals = decimalsForScale(coin.satsPerCoin ?? 100_000_000)

    const availableBalance = isPrivacyCoin(coin)
      ? coin.spendableBalance ?? coin.balance
      : coin.spendableBalance ?? coin.balance

    if (compareAmounts(availableBalance || '0', '0', decimals) <= 0) {
      setError('amount', { message: t('balanceLessFee') })
      return
    }

    if (coin.status !== 'active') {
      setError('coinId', { message: t('networkUnavailable') })
      return
    }

    const to = values.to.trim()
    const coinEngine = walletEngineRegistry.get(coin)
    let validAddress: boolean
    try {
      validAddress = await withPreflightTimeout(coinEngine.validateAddress(coin, to), 'Address validation')
    } catch (error) {
      setSendError((error as Error).message)
      return
    }
    if (!validAddress) {
      setError('to', { message: t('invalidAddressLooks') })
      return
    }

    setManualFeeError('')
    const resolvedFee = await resolveFee(coin, { force: feeMode === 'auto' })
    if (!resolvedFee) return
    const feeCoin = resolvedFee.coin
    if (feeMode === 'manual' && (!/^\d+(\.\d+)?$/.test(feeCoin) || parseFloat(feeCoin) <= 0)) {
      setManualFeeError(t('manualFeeGreaterThanZero'))
      return
    }
    const isMaxIntent = Boolean(maxIntent && maxIntent.coinId === coin.id && maxIntent.amount === values.amount)
    const sendAmount = values.amount
    if (compareAmounts(sendAmount, '0', decimals) <= 0) {
      setError('amount', { message: t('balanceLessFee') })
      return
    }
    const total = addAmounts(sendAmount, feeCoin, decimals)

    if (!isMaxIntent && compareAmounts(total, availableBalance, decimals) > 0) {
      setError('amount', { message: t('totalExceedsBalance', { fee: feeCoin, ticker: coin.ticker }) })
      return
    }

    setConfirming({
      ...values,
      amount: sendAmount,
      estimatedFee: feeCoin,
      feeMode,
      sendMax: isMaxIntent,
      lockFee: feeMode === 'manual'
        || isMaxIntent
        || isPrivacyCoin(coin)
        || (coinEngine.id === 'bitcoin-utxo' && resolvedFee.exact === true),
    })
  }

  const onInvalid = () => {
    if (liveCoin && compareAmounts(liveCoin.balance || '0', '0', decimalsForScale(liveCoin.satsPerCoin ?? 100_000_000)) <= 0) {
      setError('amount', { message: t('balanceLessFee') })
    }
  }

  const confirmSend = async () => {
    // Synchronous double-click guard — runs before React schedules a re-render
    if (sendLockRef.current) return
    if (!confirming) return
    if (pendingOutgoingCoins.has(confirming.coinId)) {
      setSendError(t('pendingOutgoingLocked'))
      return
    }
    if (!sessionMnemonic) {
      setSendError(t('sessionExpired'))
      return
    }
    sendLockRef.current = true
    setSendError('')
    setSending(true)
    try {
      const tx = await sendTransaction({
        coinId: confirming.coinId,
        to: confirming.to,
        amount: confirming.amount,
        fee: confirming.lockFee ? confirming.estimatedFee : undefined,
        comment: confirming.comment,
        sendMax: confirming.sendMax,
        mnemonic: sessionMnemonic,
      })
      setConfirming(null)
      const ticker = liveCoin?.ticker ?? ''
      showSystemNotification(t('sentToast', { amount: confirming.amount, ticker }))
      navigate(`/app/tx/${tx.txHash}`, { state: { transaction: tx } })
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('sendUnknownError')
      if (msg.startsWith('manualFeeBelowMinimum:')) {
        const minFee = msg.split(':').slice(1).join(':')
        setSendError(t('manualFeeBelowMinimum', { fee: minFee, ticker: liveCoin?.ticker ?? '' }))
      } else {
        setSendError(msg === 'pendingOutgoingLocked' ? t('pendingOutgoingLocked') : msg)
      }
    } finally {
      // Note: lock stays released even on success, but the store's lastSentAt
      // cooldown prevents another broadcast within 5s.
      sendLockRef.current = false
      setSending(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 rounded-lg border border-white/10 bg-white/6 p-1 lg:hidden" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mobilePane === 'coins'}
          className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition ${mobilePane === 'coins' ? 'bg-[var(--accent)] text-white' : 'text-slate-400'}`}
          onClick={() => setMobilePane('coins')}
        >
          {mobilePane === 'details' && <ArrowLeft size={17} />}
          {t('coins')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobilePane === 'details'}
          className={`h-10 rounded-lg px-3 text-sm font-semibold transition ${mobilePane === 'details' ? 'bg-[var(--accent)] text-white' : 'text-slate-400'}`}
          onClick={() => setMobilePane('details')}
        >
          {t('send')}
        </button>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(340px,430px)_minmax(0,1fr)]">
      {/* coin selector */}
      <Card className={`${mobilePane === 'coins' ? 'block' : 'hidden'} space-y-4 lg:block`}>
        <div>
          <h1 className="text-xl font-bold text-white">{t('sendCoins')}</h1>
          <p className="mt-1 text-sm text-slate-500">{t('selectCoinHint')}</p>
        </div>

        <Input
          label={t('searchCoinLabel')}
          placeholder={t('searchCoinPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div className="max-h-[660px] space-y-2 overflow-y-auto pr-1">
          {filteredCoins.map((coin) => {
            const selected = coin.id === liveCoin?.id
            return (
              <button
                key={coin.id}
                type="button"
                className={`grid w-full grid-cols-[1fr_auto] items-center gap-3 rounded-[18px] border px-3 py-3 text-left transition ${
                  selected
                    ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                    : 'border-white/10 bg-white/6 hover:bg-white/9'
                }`}
                onClick={() => selectCoin(coin.id)}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <CoinIcon ticker={coin.ticker} />
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-white">{coin.name}</p>
                    <p className="text-sm text-slate-500">
                      {hideBalances ? '••••' : formatAmount(coin.balance, coin.ticker)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <CoinStatusBadge status={coin.status} recoveryProgress={coin.recoveryProgress} className="hidden sm:inline-flex" />
                  {selected && <Check size={18} className="text-[var(--accent)]" />}
                </div>
              </button>
            )
          })}

          {filteredCoins.length === 0 && (
            <div className="rounded-[18px] border border-dashed border-white/15 p-6 text-center text-sm text-slate-400">
              <Search className="mx-auto mb-2" size={18} />
              {t('noCoinsFound')}
            </div>
          )}
        </div>
      </Card>

      {/* send form */}
      <div className={`${mobilePane === 'details' ? 'block' : 'hidden'} space-y-6 lg:block`}>
        <Card>
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              {liveCoin && <CoinIcon ticker={liveCoin.ticker} className="h-12 w-12" />}
              <div className="min-w-0">
                <h2 className="truncate text-xl font-bold text-white">
                  {liveCoin?.name ?? t('selectCoinFirst')}
                </h2>
                <p className="truncate text-sm text-slate-500">
                  {liveCoin
                    ? `${liveCoin.ticker} · ${hideBalances ? '••••' : formatUsd(liveCoin.fiatValue)} · ${formatAddress(liveCoin.address)}`
                    : t('noCoinSelected')}
                </p>
              </div>
            </div>
            {liveCoin && <CoinStatusBadge status={liveCoin.status} recoveryProgress={liveCoin.recoveryProgress} />}
          </div>

          {liveCoin?.status !== 'active' && (
            <div className="mt-5 flex gap-3 rounded-2xl border border-amber-400/25 bg-amber-400/10 p-4 text-sm text-amber-100">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              {t('networkUnavailableSoft')}
            </div>
          )}

          {liveCoinLocked && (
            <div className="mt-5 flex gap-3 rounded-2xl border border-amber-400/25 bg-amber-400/10 p-4 text-sm text-amber-100">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              {t('pendingOutgoingLocked')}
            </div>
          )}

          <form className="mt-6 space-y-5" onSubmit={handleSubmit(onSubmit, onInvalid)}>
            <input type="hidden" {...register('coinId')} />
            {errors.coinId?.message && (
              <p className="text-sm text-rose-300">{errors.coinId.message}</p>
            )}

            <Input
              label={t('recipientAddress')}
              placeholder={recipientPlaceholder}
              {...register('to')}
              error={errors.to?.message}
            />

            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-300">{t('amount')}</span>
              <div className="relative">
                <input
                  type="text"
                  inputMode="decimal"
                  {...register('amount', {
                    onChange: () => {
                      setMaxIntent(null)
                    },
                  })}
                  className={`h-12 w-full rounded-2xl border bg-white/7 px-4 pr-24 text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-[var(--accent)] disabled:opacity-50 ${
                    errors.amount?.message ? 'border-rose-400' : 'border-white/10'
                  }`}
                />
                <button
                  type="button"
                  onClick={handleMax}
                  disabled={!liveCoin || liveCoin.status !== 'active' || liveCoinLocked || maxNeedsAutoFee || maxLoading}
                  className="absolute right-2 top-1/2 inline-flex h-8 min-w-[64px] -translate-y-1/2 items-center justify-center rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/12 px-3 text-[11px] font-bold uppercase tracking-wide text-[var(--accent)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition hover:bg-[var(--accent)]/20 hover:text-white disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/6 disabled:text-slate-500"
                  title="MAX"
                >
                  {maxLoading ? <Loader2 size={14} className="animate-spin" /> : 'MAX'}
                </button>
              </div>
              {errors.amount?.message && <span className="text-xs text-rose-300">{errors.amount.message}</span>}
            </label>

            <div className="rounded-2xl border border-white/10 bg-white/6 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate-200">{t('fee')}</p>
                <div className="grid grid-cols-2 rounded-2xl border border-white/10 bg-white/7 p-1 text-xs font-semibold">
                  {(['auto', 'manual'] as FeeMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        setFeeMode(mode)
                        setMaxIntent(null)
                        setManualFeeError('')
                        if (mode === 'manual') {
                          setManualFee((current) => current || feeEstimate?.coin || minimumFeeEstimate?.coin || satsToFeeText(feeSliderDefault))
                        }
                      }}
                      className={`rounded-xl px-3 py-2 transition ${
                        feeMode === mode
                          ? 'bg-[var(--accent)] text-white shadow-[0_8px_20px_-12px_rgba(var(--accent-rgb),0.9)]'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {mode === 'auto' ? t('feeModeAuto') : t('feeModeManual')}
                    </button>
                  ))}
                </div>
              </div>

              {feeMode === 'manual' ? (
                <div className="space-y-4 rounded-2xl border border-white/10 bg-white/7 p-4">
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px] sm:items-end">
                    <Input
                      label={t('manualFeeLabel', { ticker: liveCoin?.ticker ?? '' })}
                      type="text"
                      inputMode="decimal"
                      value={manualFee}
                      onChange={(event) => {
                        setManualFee(event.target.value)
                        setMaxIntent(null)
                        setManualFeeError('')
                      }}
                      placeholder={feeEstimate?.coin ?? satsToFeeText(feeSliderDefault)}
                      error={manualFeeError}
                    />
                    <div className="rounded-2xl border border-white/10 bg-[#101827]/70 px-4 py-3">
                      <p className="text-xs font-medium text-slate-500">
                        {t('manualFeeInSats')}
                      </p>
                      <p className="mt-1 truncate text-sm font-semibold text-white">
                        {manualFeeSats.toLocaleString('en-US')}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <input
                      type="range"
                      min={feeSliderMin}
                      max={feeSliderMax}
                      step={feeSliderStep}
                      value={manualFeeSats}
                      onChange={(event) => {
                        setManualFee(satsToFeeText(Number(event.target.value)))
                        setMaxIntent(null)
                        setManualFeeError('')
                      }}
                      className="h-2 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-[var(--accent)]"
                      aria-label={t('manualFeeAria')}
                    />
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>{satsToFeeText(feeSliderMin)} {liveCoin?.ticker}</span>
                      <span>{satsToFeeText(feeSliderMax)} {liveCoin?.ticker}</span>
                    </div>
                  </div>
                </div>
              ) : liveCoinPrivacy ? (
                <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/7 px-4 py-3 text-sm">
                  <span className="text-slate-400">{t('automaticNetworkFee')}</span>
                  <span className="font-semibold text-white">
                    {feeEstimate && liveCoin
                      ? formatAmount(feeEstimate.coin, liveCoin.ticker)
                      : privacyAutoFee && liveCoin
                        ? formatAmount(privacyAutoFee, liveCoin.ticker)
                        : t('autoFee')}
                  </span>
                </div>
              ) : (
                <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/7 px-4 py-3 text-sm">
                  <span className="text-slate-400">{t('automaticNetworkFee')}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white">
                      {feeLoading ? (
                        <Loader2 size={14} className="inline animate-spin" />
                      ) : feeEstimate && liveCoin ? (
                        formatAmount(feeEstimate.coin, liveCoin.ticker)
                      ) : (
                        t('autoFee')
                      )}
                    </span>
                    {canRefreshAutoFee && (
                      <button
                        type="button"
                        onClick={refreshAutoFee}
                        disabled={feeRefreshing || feeLoading}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-white/8 text-slate-300 transition hover:bg-white/12 hover:text-white disabled:opacity-45"
                        title={t('refreshFee')}
                        aria-label={t('refreshFee')}
                      >
                        <RefreshCw size={14} className={feeRefreshing ? 'animate-spin' : ''} />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {showMemo && (
              <Input
                label={t('comment')}
                placeholder={t('optional')}
                {...register('comment')}
              />
            )}

            <div className="rounded-2xl border border-white/10 bg-white/7 p-4">
              <div className="grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <p className="text-slate-500">{t('balance')}</p>
                  <p className="mt-1 font-semibold text-white">
                    {liveCoin
                      ? hideBalances
                        ? '••••'
                        : formatAmount(liveCoin.balance, liveCoin.ticker)
                      : t('na')}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">{t('toSend')}</p>
                  <p className="mt-1 font-semibold text-white">
                    {liveCoin ? formatAmount(amount || '0', liveCoin.ticker) : t('na')}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">{t('fee')}</p>
                  <p className="mt-1 font-semibold text-white">
                    {feeMode === 'manual' && liveCoin ? (
                      manualFee ? formatAmount(manualFee, liveCoin.ticker) : <span className="text-slate-500">—</span>
                    ) : feeLoading ? (
                      <Loader2 size={14} className="inline animate-spin" />
                    ) : feeEstimate && liveCoin ? (
                      formatAmount(feeEstimate.coin, liveCoin.ticker)
                    ) : (
                      <span className="text-slate-500">{t('autoFee')}</span>
                    )}
                  </p>
                </div>
              </div>
            </div>

            <SeedPhraseWarning text={t('irreversibleNote')} />

            {sendError && !confirming && (
              <div className="rounded-2xl border border-rose-400/30 bg-rose-400/10 p-3 text-sm text-rose-300">
                {sendError}
              </div>
            )}

            <Button
              size="lg"
              className="w-full"
              disabled={continueDisabled}
              icon={continueBusy ? <Loader2 size={18} className="animate-spin" /> : <SendHorizontal size={18} />}
            >
              {t('continue')}
            </Button>
          </form>
        </Card>
      </div>
      </div>

      <Modal
        open={Boolean(confirming)}
        title={t('confirmTitle')}
        closable={!sending}
        onClose={() => {
          if (sending) return
          setConfirming(null)
          setSendError('')
        }}
      >
        {confirming && selectedCoin && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/7 p-4 text-sm">
              <p className="text-slate-500">{t('coins')}</p>
              <p className="text-white">
                {selectedCoin.name} · {selectedCoin.ticker}
              </p>

              <p className="mt-3 text-slate-500">{t('recipient')}</p>
              <p className="break-all font-mono text-white">{confirming.to}</p>

              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div>
                  <p className="text-slate-500">{t('amount')}</p>
                  <p className="text-white">
                    {confirming.amount} {selectedCoin.ticker}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">{t('fee')}</p>
                  <p className="text-white">
                    {confirming.feeMode === 'auto' && !confirming.lockFee ? '~' : ''}{confirming.estimatedFee} {selectedCoin.ticker}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">{t('totalMax')}</p>
                  <p className="text-white">
                    {confirming.feeMode === 'auto' ? '~' : ''}
                    {addAmounts(
                      confirming.amount,
                      confirming.estimatedFee,
                      decimalsForScale(selectedCoin.satsPerCoin ?? 100_000_000),
                    )} {selectedCoin.ticker}
                  </p>
                </div>
              </div>

              {confirming.comment && showMemo && (
                <>
                  <p className="mt-3 text-slate-500">{t('comment')}</p>
                  <p className="text-white">{confirming.comment}</p>
                </>
              )}
            </div>

            <SeedPhraseWarning text={t('willBroadcastNote')} />

            {sendError && (
              <div className="rounded-2xl border border-rose-400/30 bg-rose-400/10 p-3 text-sm text-rose-300">
                {sendError}
              </div>
            )}

            <Button
              className="w-full"
              onClick={confirmSend}
              disabled={sending || !sessionMnemonic}
              icon={sending ? <Loader2 size={16} className="animate-spin" /> : <SendHorizontal size={16} />}
            >
              {sending ? t('sendingNow') : t('confirmAndSend')}
            </Button>
          </div>
        )}
      </Modal>

    </div>
  )
}

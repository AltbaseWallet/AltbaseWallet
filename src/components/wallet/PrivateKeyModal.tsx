import { useEffect, useState } from 'react'
import { Copy, Eye, EyeOff, Loader2 } from 'lucide-react'
import type { Coin } from '../../types/coin'
import { walletService } from '../../services/walletService'
import { copyToClipboard } from '../../utils/clipboard'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { SeedPhraseWarning } from './SeedPhraseWarning'
import { useT } from '../../utils/i18n'

type PrivateKeyModalProps = {
  coin: Coin | null
  onClose: () => void
  onToast: (message: string) => void
}

export function PrivateKeyModal({ coin, onClose, onToast }: PrivateKeyModalProps) {
  const t = useT()
  const [password, setPassword] = useState('')
  const [privateKey, setPrivateKey] = useState<string | null>(null)
  const [masked, setMasked] = useState(true)
  const [error, setError] = useState('')
  const [copyConfirmOpen, setCopyConfirmOpen] = useState(false)
  const [revealing, setRevealing] = useState(false)
  const isPrivacySeed = coin?.walletEngine === 'zano-light' || coin?.walletEngine === 'epic-light'
  const title = isPrivacySeed ? t('privacySeedTitle') : t('privateKeyTitle')
  const warning = isPrivacySeed ? t('privacySeedWarn') : t('privateKeyWarn')
  const revealLabel = isPrivacySeed ? t('showPrivacySeed') : t('showPrivateKey')
  const copiedLabel = isPrivacySeed ? t('privacySeedCopied') : t('privateKeyCopied')
  const copyConfirmText = isPrivacySeed ? t('copyPrivacySeedConfirm') : t('copyPrivateKeyConfirm')

  useEffect(() => {
    if (!privateKey) return undefined
    const timer = window.setTimeout(() => {
      setPrivateKey(null)
      setMasked(true)
    }, 60_000)
    return () => window.clearTimeout(timer)
  }, [privateKey])

  const close = () => {
    setPrivateKey(null)
    setPassword('')
    setError('')
    setMasked(true)
    setRevealing(false)
    onClose()
  }

  const reveal = async () => {
    if (!coin || revealing) return
    setRevealing(true)
    setError('')
    try {
      const key = await walletService.getPrivateKey(coin.id, password)
      setPrivateKey(key)
      setError('')
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.startsWith('coin-not-supported:')) {
        setError(t('coinKeyNotSupported', { coin: coin.ticker }))
      } else if (msg.includes('not stored')) {
        setError(t('seedNotStored'))
      } else {
        setError(t('wrongPassword'))
      }
    } finally {
      setRevealing(false)
    }
  }

  const copy = async () => {
    if (!privateKey) return
    setCopyConfirmOpen(false)
    await copyToClipboard(privateKey)
    onToast(copiedLabel)
    window.setTimeout(() => {
      copyToClipboard(' ').catch(() => undefined)
    }, 30_000)
  }

  return (
    <Modal open={Boolean(coin)} title={`${title} - ${coin?.ticker ?? ''}`} onClose={close}>
      <div className="space-y-4">
        <SeedPhraseWarning text={warning} />
        {!privateKey ? (
          <>
            <Input
              label={t('password')}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              error={error}
              disabled={revealing}
            />
            <Button
              className="w-full"
              onClick={reveal}
              disabled={revealing || !password}
              icon={revealing ? <Loader2 size={17} className="animate-spin" /> : undefined}
            >
              {revealing ? t('loading') : revealLabel}
            </Button>
          </>
        ) : (
          <>
            <div className="whitespace-pre-wrap rounded-2xl border border-white/10 bg-white/7 p-3 font-mono text-sm text-slate-100 break-all">
              {masked ? privateKey.replace(/./g, '*') : privateKey}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setMasked((value) => !value)} icon={masked ? <Eye size={17} /> : <EyeOff size={17} />}>
                {masked ? t('showLabel') : t('hideLabel')}
              </Button>
              <Button onClick={() => setCopyConfirmOpen(true)} icon={<Copy size={17} />}>
                {t('copy')}
              </Button>
            </div>
          </>
        )}
      </div>
      <ConfirmDialog
        open={copyConfirmOpen}
        title={title}
        confirmText={t('copy')}
        danger
        onCancel={() => setCopyConfirmOpen(false)}
        onConfirm={copy}
      >
        {copyConfirmText}
      </ConfirmDialog>
    </Modal>
  )
}

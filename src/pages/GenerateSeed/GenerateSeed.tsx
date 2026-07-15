import { useEffect, useMemo, useState } from 'react'
import { Copy } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { SeedWordCard } from '../../components/ui/SeedWordCard'
import { SeedConfirmToggle, SeedNoShareConfirm } from '../../components/wallet/SeedConfirmToggle'
import { SeedPhraseWarning } from '../../components/wallet/SeedPhraseWarning'
import { walletService } from '../../services/walletService'
import { useAuthStore } from '../../store/authStore'
import { copyToClipboard } from '../../utils/clipboard'
import { useT } from '../../utils/i18n'

const CLIPBOARD_CLEAR_MS = 30_000

export default function GenerateSeed() {
  const t = useT()
  const navigate = useNavigate()
  const seed = useAuthStore((state) => state.generatedSeed)
  const cancelWalletSetup = useAuthStore((state) => state.cancelWalletSetup)
  const [safe, setSafe] = useState(false)
  const [saved, setSaved] = useState(false)
  const [continuing, setContinuing] = useState(false)
  const [copyConfirmOpen, setCopyConfirmOpen] = useState(false)
  const words = useMemo(() => seed?.split(' ') ?? [], [seed])

  useEffect(() => {
    if (!seed) navigate('/create-password', { replace: true })
  }, [navigate, seed])

  const copySeed = async () => {
    if (!seed) return
    setCopyConfirmOpen(false)
    await copyToClipboard(seed)
    window.setTimeout(() => {
      copyToClipboard(' ').catch(() => undefined)
    }, CLIPBOARD_CLEAR_MS)
  }

  const cancelSetup = () => {
    cancelWalletSetup()
    navigate('/welcome', { replace: true })
  }

  const setSeedSafety = (nextSafe: boolean) => {
    setSafe(nextSafe)
    walletService.setPendingSeedSafetyAcknowledged(seed, nextSafe)
  }

  const continueToConfirm = () => {
    if (continuing) return
    setContinuing(true)
    walletService.setPendingSeedSafetyAcknowledged(seed, safe)
    navigate('/confirm-seed')
  }

  return (
    <div className="grid min-h-screen place-items-center bg-ink p-4">
      <Card className="w-full max-w-3xl">
        <h1 className="text-2xl font-bold text-white">{t('saveSeedTitle')}</h1>
        <p className="mt-2 text-sm text-slate-400">{t('saveSeedNote')}</p>
        <div className="mt-6">
          <SeedPhraseWarning />
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {words.map((word, index) => (
            <SeedWordCard key={`${word}-${index}`} index={index + 1} word={word} />
          ))}
        </div>
        <div className="mt-5 flex flex-col gap-3">
          <Button type="button" variant="secondary" onClick={() => setCopyConfirmOpen(true)} icon={<Copy size={17} />}>
            {t('copy')}
          </Button>
          <div className="grid gap-3 sm:grid-cols-2">
            <SeedNoShareConfirm checked={safe} onChange={setSeedSafety} disabled={continuing} />
            <SeedConfirmToggle checked={saved} onChange={setSaved} label={t('savedSafely')} disabled={continuing} />
          </div>
          <Button size="lg" disabled={!safe || !saved || continuing} onClick={continueToConfirm}>
            {t('continue')}
          </Button>
          <Button type="button" variant="secondary" disabled={continuing} onClick={cancelSetup}>
            {t('back')}
          </Button>
        </div>
      </Card>
      <ConfirmDialog
        open={copyConfirmOpen}
        title={t('copyConfirmTitle')}
        confirmText={t('copy')}
        danger
        onCancel={() => setCopyConfirmOpen(false)}
        onConfirm={copySeed}
      >
        {t('seedCopyConfirm')}
      </ConfirmDialog>
    </div>
  )
}

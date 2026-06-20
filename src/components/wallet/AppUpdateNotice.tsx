import { useEffect, useState } from 'react'
import { Download, ShieldCheck } from 'lucide-react'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { checkAppUpdate, dismissUpdateForToday, type AppUpdateInfo } from '../../services/appUpdateService'
import { useT } from '../../utils/i18n'

export function AppUpdateNotice() {
  const t = useT()
  const [update, setUpdate] = useState<AppUpdateInfo | null>(null)

  useEffect(() => {
    let mounted = true
    void checkAppUpdate().then((result) => {
      if (mounted) setUpdate(result)
    })
    return () => {
      mounted = false
    }
  }, [])

  const close = () => {
    if (!update || update.required) return
    dismissUpdateForToday(update.latestVersion)
    setUpdate(null)
  }

  const download = () => {
    if (!update) return
    void window.altbaseWallet?.openExternal(update.downloadUrl)
    if (!update.required) dismissUpdateForToday(update.latestVersion)
    setUpdate(null)
  }

  if (!update) return null

  return (
    <Modal open title={t('updateAvailableTitle')} onClose={close} closable={!update.required}>
      <div className="space-y-4 text-sm text-slate-300">
        <div className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-4">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--accent)]/20 text-[var(--accent)]">
            <ShieldCheck size={22} />
          </div>
          <div className="space-y-1">
            <p className="font-semibold text-white">{update.message || t('updateAvailableMessage')}</p>
            <p>{t('updateAvailableBody')}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">{t('updateCurrentVersion')}</div>
            <div className="mt-1 font-semibold text-white">{update.currentVersion}</div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">{t('updateLatestVersion')}</div>
            <div className="mt-1 font-semibold text-white">{update.latestVersion}</div>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-1">
          {!update.required && (
            <Button variant="secondary" onClick={close}>
              {t('updateLater')}
            </Button>
          )}
          <Button icon={<Download size={17} />} onClick={download}>
            {t('updateDownload')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

import { AlertTriangle } from 'lucide-react'
import { useT } from '../../utils/i18n'

export function SeedPhraseWarning({ text }: { text?: string }) {
  const t = useT()
  return (
    <div className="flex gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
      <AlertTriangle className="mt-0.5 shrink-0" size={18} />
      <p>{text ?? t('seedWarningDefault')}</p>
    </div>
  )
}

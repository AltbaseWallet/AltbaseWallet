import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from './Button'
import { Modal } from './Modal'
import { useT } from '../../utils/i18n'

type ConfirmDialogProps = {
  open: boolean
  title: string
  children: ReactNode
  confirmText?: string
  danger?: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmText,
  danger,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const t = useT()

  return (
    <Modal open={open} title={title} onClose={onCancel}>
      <div className="space-y-4">
        <div className="flex gap-3 rounded-2xl border border-white/10 bg-white/7 p-4 text-sm text-slate-300">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${danger ? 'bg-rose-400/10 text-rose-300' : 'bg-[rgba(var(--accent-rgb),0.16)] text-[var(--accent)]'}`}>
            <AlertTriangle size={18} />
          </span>
          <div className="min-w-0 leading-relaxed">{children}</div>
        </div>
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onCancel}>
            {t('cancel')}
          </Button>
          <Button type="button" variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmText ?? t('confirm')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

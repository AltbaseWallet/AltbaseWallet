import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { motion } from 'framer-motion'
import { Button } from './Button'
import { useT } from '../../utils/i18n'

type ModalProps = {
  open: boolean
  title: string
  children: ReactNode
  onClose: () => void
  placement?: 'center' | 'top'
  closable?: boolean
}

export function Modal({ open, title, children, onClose, placement = 'center', closable = true }: ModalProps) {
  const t = useT()
  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      className={`fixed inset-0 z-[1000] flex overflow-y-auto bg-black/70 p-4 ${
        placement === 'top' ? 'items-start justify-center pt-6 sm:pt-10' : 'items-center justify-center'
      }`}
    >
      <motion.div
        initial={{ opacity: 0, y: placement === 'top' ? -10 : 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="w-full max-w-lg rounded-[24px] border border-white/10 bg-[#101827] p-5 shadow-soft"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          {closable && (
            <Button variant="ghost" size="sm" className="h-9 w-9 rounded-xl p-0" onClick={onClose} aria-label={t('closeAria')}>
              <X size={18} />
            </Button>
          )}
        </div>
        {children}
      </motion.div>
    </div>,
    document.body,
  )
}

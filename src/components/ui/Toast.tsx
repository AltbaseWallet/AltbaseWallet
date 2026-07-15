import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2 } from 'lucide-react'

type ToastProps = {
  message: string | null
}

export function Toast({ message }: ToastProps) {
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          className="wallet-toast fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-3 right-3 z-50 flex items-start gap-3 rounded-lg border border-[var(--accent)]/45 bg-[#101827]/95 px-4 py-4 text-sm font-semibold leading-snug text-white shadow-[0_28px_90px_rgba(0,0,0,0.55)] backdrop-blur sm:bottom-7 sm:left-auto sm:right-7 sm:max-w-[min(620px,calc(100vw-32px))] sm:gap-4 sm:px-6 sm:py-5 sm:text-base"
        >
          <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[rgba(var(--accent-rgb),0.22)] text-[var(--accent)]">
            <CheckCircle2 size={24} />
          </span>
          <span>{message}</span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

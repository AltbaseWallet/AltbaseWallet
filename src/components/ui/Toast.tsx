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
          className="wallet-toast fixed bottom-7 right-7 z-50 flex max-w-[min(620px,calc(100vw-32px))] items-start gap-4 rounded-[22px] border border-[var(--accent)]/45 bg-[#101827]/95 px-7 py-6 text-lg font-semibold leading-snug text-white shadow-[0_28px_90px_rgba(0,0,0,0.55)] backdrop-blur"
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

import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { clsx } from 'clsx'

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string
  error?: string
  hideErrorText?: boolean
}

export function Input({ label, error, hideErrorText, className, ...props }: InputProps) {
  return (
    <label className="block space-y-2">
      {label && <span className="text-sm font-medium text-slate-300">{label}</span>}
      <input
        className={clsx(
          'h-12 w-full rounded-2xl border border-white/10 bg-white/7 px-4 text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-[var(--accent)] disabled:opacity-50',
          error && 'border-rose-400',
          className,
        )}
        {...props}
      />
      {error && !hideErrorText && <span className="text-xs text-rose-300">{error}</span>}
    </label>
  )
}

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string
  error?: string
}

export function Textarea({ label, error, className, ...props }: TextareaProps) {
  return (
    <label className="block space-y-2">
      {label && <span className="text-sm font-medium text-slate-300">{label}</span>}
      <textarea
        className={clsx(
          'min-h-32 w-full resize-none rounded-2xl border border-white/10 bg-white/7 px-4 py-3 text-slate-50 outline-none transition placeholder:text-slate-500 focus:border-[var(--accent)]',
          error && 'border-rose-400',
          className,
        )}
        {...props}
      />
      {error && <span className="text-xs text-rose-300">{error}</span>}
    </label>
  )
}

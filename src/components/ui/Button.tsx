import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { clsx } from 'clsx'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  icon?: ReactNode
}

/**
 * Wallet buttons:
 *  • Soft fade + slight scale on press (active:scale-[0.97])
 *  • Glass-highlight overlay on hover/active (defined in globals.css via .btn-press)
 *  • Variant-specific glows tinted with the accent color
 */
export function Button({ className, variant = 'primary', size = 'md', icon, children, ...props }: ButtonProps) {
  return (
    <button
      className={clsx(
        'btn-press inline-flex items-center justify-center gap-2 rounded-2xl font-semibold transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
        // Primary: solid accent with a subtle glow shadow tinted with the accent
        variant === 'primary' && 'border border-white/20 bg-[var(--accent)] text-[#f8fafc] shadow-[0_4px_16px_-6px_rgba(var(--accent-rgb),0.8)] hover:bg-[#6f7dff] hover:shadow-[0_6px_22px_-8px_rgba(var(--accent-rgb),0.9)]',
        variant === 'secondary' && 'btn-secondary border border-white/10 bg-white/8 text-slate-50 hover:bg-white/12',
        variant === 'ghost'     && 'btn-ghost text-slate-300 hover:bg-white/8 hover:text-white',
        variant === 'danger'    && 'bg-rose-500 text-white shadow-[0_4px_14px_-4px_rgba(244,63,94,0.45)] hover:bg-rose-400',
        size === 'sm' && 'h-9 px-3 text-sm',
        size === 'md' && 'h-11 px-4 text-sm',
        size === 'lg' && 'h-12 px-5 text-base',
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  )
}

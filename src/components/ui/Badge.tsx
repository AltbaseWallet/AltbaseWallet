import { clsx } from 'clsx'
import type { HTMLAttributes } from 'react'

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={clsx('inline-flex items-center rounded-full border border-white/10 bg-white/8 px-2.5 py-1 text-xs font-medium text-slate-300', className)}
      {...props}
    />
  )
}

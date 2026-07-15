import type { HTMLAttributes } from 'react'
import { clsx } from 'clsx'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx('min-w-0 rounded-lg border border-white/10 bg-panel p-4 shadow-soft sm:p-5', className)} {...props} />
}

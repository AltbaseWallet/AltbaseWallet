import type { HTMLAttributes } from 'react'
import { clsx } from 'clsx'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx('rounded-[22px] border border-white/10 bg-panel p-5 shadow-soft backdrop-blur', className)} {...props} />
}

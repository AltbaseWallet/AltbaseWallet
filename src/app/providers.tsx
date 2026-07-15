import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { useSettingsStore } from '../store/settingsStore'

export function Providers({ children }: { children: ReactNode }) {
  const theme = useSettingsStore((state) => state.settings.theme)

  useEffect(() => {
    const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches
    const light = theme === 'light' || (theme === 'system' && prefersLight)
    document.documentElement.classList.toggle('light-theme', light)
  }, [theme])

  return children
}

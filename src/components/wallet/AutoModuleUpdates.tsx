import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { pluginService } from '../../services/pluginService'
import { reloadInstalledModules } from '../../services/moduleReloadService'
import { useTransactionStore } from '../../store/transactionStore'
export function AutoModuleUpdates() {
  const location = useLocation()
  const route = useRef(location.pathname)
  useEffect(() => { route.current = location.pathname }, [location.pathname])
  useEffect(() => {
    let checking = false, disposed = false
    const check = async () => {
      if (checking || disposed || route.current === '/app/send' || useTransactionStore.getState().sending) return
      checking = true
      try { const status = await pluginService.checkUpdates(); if (status.changed) await reloadInstalledModules() }
      catch { /* Existing modules remain available; the Modules screen exposes update status. */ }
      finally { checking = false }
    }
    void check()
    const timer = window.setInterval(() => { void check() }, 15 * 60000)
    return () => { disposed = true; clearInterval(timer) }
  }, [])
  return null
}

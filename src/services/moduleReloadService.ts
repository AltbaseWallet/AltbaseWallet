import { pluginService } from './pluginService'
import { walletService } from './walletService'
import { coinService } from './coinService'
import { useAuthStore } from '../store/authStore'
import { useCoinStore } from '../store/coinStore'
async function reloadCatalog() {
  const revision = walletService.getSessionRevision(), catalog = await pluginService.load()
  if (useAuthStore.getState().isUnlocked) {
    for (const module of catalog.modules.filter(m => m.runtimeType === 'plugin')) {
      if (revision !== walletService.getSessionRevision()) return
      await walletService.ensurePublicAddress(module.id).catch(() => undefined)
    }
  }
  if (revision !== walletService.getSessionRevision()) return
  const coins = await coinService.getCoins()
  if (revision !== walletService.getSessionRevision()) return
  useCoinStore.setState({ coins, sendReadyLoadedAt: 0 })
  if (useAuthStore.getState().isUnlocked) void useCoinStore.getState().loadCoins({ forceBalances: true }).catch(() => {})
  window.dispatchEvent(new Event('altbase:modules-changed'))
}
let pending: Promise<void> | null = null
let pendingRevision = -1
export function reloadInstalledModules(): Promise<void> {
  const revision = walletService.getSessionRevision()
  if (pending && pendingRevision !== revision) return pending.then(() => reloadInstalledModules(), () => reloadInstalledModules())
  if (!pending) {
    pendingRevision = revision
    pending = reloadCatalog().finally(() => { pending = null })
  }
  return pending
}

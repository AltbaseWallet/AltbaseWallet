import { create } from 'zustand'
import type { Language, Settings } from '../types/settings'
import { storageService } from '../services/storageService'

const SETTINGS_KEY = 'settings'
const supportedLanguages: Language[] = ['en', 'de', 'fr', 'zh', 'ja', 'ru', 'uk']

const normalizeLanguage = (language?: string): Language =>
  supportedLanguages.includes(language as Language) ? (language as Language) : 'en'

const defaultSettings: Settings = {
  theme: 'dark',
  language: 'en',
  hideBalances: false,
  autoLockMinutes: 5,
  compactCoinList: false,
}

type SettingsStore = {
  settings: Settings
  updateSettings: (settings: Partial<Settings>) => void
}

// Strip any legacy fields (e.g. accentColor) that are no longer part of Settings.
const loadStored = (): Settings => {
  const stored = storageService.get<Settings & { accentColor?: string }>(SETTINGS_KEY, defaultSettings)
  const { theme, language, hideBalances, autoLockMinutes, compactCoinList } = stored
  return {
    theme: theme ?? 'dark',
    language: normalizeLanguage(language),
    hideBalances: hideBalances ?? false,
    autoLockMinutes: autoLockMinutes ?? 5,
    compactCoinList: compactCoinList ?? false,
  }
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: loadStored(),

  updateSettings: (patch) => {
    const settings = { ...get().settings, ...patch }
    storageService.set(SETTINGS_KEY, settings)
    set({ settings })
  },
}))

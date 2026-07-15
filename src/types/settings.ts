export type Language = 'en' | 'de' | 'fr' | 'zh' | 'ja' | 'ru' | 'uk'

export type Settings = {
  theme: 'dark' | 'light' | 'system'
  language: Language
  hideBalances: boolean
  autoLockMinutes: number | null
  compactCoinList: boolean
}

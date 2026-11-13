import { useSettingsStore } from '../../store/settingsStore'
const labels = {
  en: ['Coin modules', 'Open modules folder', 'Refresh modules', 'Back', 'Installed', 'Compatibility', 'Native plugin API', 'Local test module', 'No coin modules installed.', 'Built-in and added modules share this folder. Copy a coin module here, then refresh. Wallet recompilation is not required.', 'Unavailable modules'],
  ru: ['Модули монет', 'Открыть папку модулей', 'Обновить список', 'Назад', 'Установлено', 'Совместимость', 'Подключаемый модуль', 'Локальный тестовый модуль', 'Модули монет не установлены.', 'Все встроенные и добавленные модули находятся в этой папке. Скопируй сюда модуль и обнови список. Пересобирать кошелёк не нужно.', 'Недоступные модули'],
  uk: ['Модулі монет', 'Відкрити папку модулів', 'Оновити список', 'Назад', 'Встановлено', 'Сумісність', 'Підключений модуль', 'Локальний тестовий модуль', 'Модулі монет не встановлені.', 'Усі вбудовані та додані модулі розташовані в цій папці. Скопіюй сюди модуль та онови список. Перезбирати гаманець не потрібно.', 'Недоступні модулі'],
  de: ['Coin-Module', 'Modulordner öffnen', 'Module aktualisieren', 'Zurück', 'Installiert', 'Kompatibilität', 'Plugin', 'Lokales Testmodul', 'Keine Coin-Module installiert.', 'Integrierte und hinzugefügte Module liegen in diesem Ordner. Kopiere ein Modul hierher und aktualisiere die Liste. Die Wallet muss nicht neu gebaut werden.', 'Nicht verfügbare Module'],
  fr: ['Modules de monnaies', 'Ouvrir le dossier', 'Actualiser les modules', 'Retour', 'Installés', 'Compatibilité', 'Module externe', 'Module de test local', 'Aucun module installé.', 'Les modules intégrés et ajoutés partagent ce dossier. Copiez un module ici, puis actualisez la liste. Aucune recompilation du portefeuille nécessaire.', 'Modules indisponibles'],
  zh: ['币种模块', '打开模块文件夹', '刷新模块', '返回', '已安装', '兼容模块', '插件', '本地测试模块', '未安装币种模块。', '内置和新增模块均存放在此文件夹中。将模块复制到此处，然后刷新。无需重新编译钱包。', '不可用模块'],
  ja: ['通貨モジュール', 'フォルダーを開く', 'モジュールを更新', '戻る', 'インストール済み', '互換モジュール', 'プラグイン', 'ローカルテスト用', '通貨モジュールがありません。', '組み込みモジュールと追加モジュールは同じフォルダーに保存されます。ここにモジュールをコピーして更新してください。再ビルドは不要です。', '利用できないモジュール'],
}
export function useModuleLabels() {
  const language = useSettingsStore(s => s.settings.language)
  return labels[language] || labels.en
}

import { normalizeSeedPhrase } from '../../utils/validateSeedPhrase'
import { useT } from '../../utils/i18n'

type SeedPhraseGridInputProps = {
  value: string
  onChange: (value: string) => void
  error?: string
}

const WORD_COUNT = 12

export function SeedPhraseGridInput({ value, onChange, error }: SeedPhraseGridInputProps) {
  const t = useT()
  const words = Array.from({ length: WORD_COUNT }, (_, index) => normalizeSeedPhrase(value)[index] ?? '')

  const updateWord = (index: number, word: string) => {
    const next = [...words]
    next[index] = word.trim().toLowerCase()
    onChange(next.join(' ').trim())
  }

  const pasteSeed = (text: string) => {
    const pasted = normalizeSeedPhrase(text)
    if (pasted.length <= 1) return false
    const next = [...words]
    pasted.slice(0, WORD_COUNT).forEach((word, index) => {
      next[index] = word
    })
    onChange(next.join(' ').trim())
    return true
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-slate-300">{t('seedPhrase')}</span>
        <span className="text-xs text-slate-500">{words.filter(Boolean).length}/12</span>
      </div>
      <div className={`grid gap-2 rounded-[20px] border bg-white/6 p-3 ${error ? 'border-rose-400' : 'border-white/10'} sm:grid-cols-2 lg:grid-cols-3`}>
        {words.map((word, index) => (
          <label key={index} className="grid grid-cols-[2rem_1fr] items-center rounded-2xl border border-white/10 bg-[#101827]/70 px-3 py-2 focus-within:border-[var(--accent)]">
            <span className="text-xs font-semibold text-slate-500">{index + 1}</span>
            <input
              className="min-w-0 bg-transparent text-sm font-medium text-slate-50 outline-none placeholder:text-slate-600"
              autoFocus={index === 0}
              autoComplete="off"
              spellCheck={false}
              value={word}
              onChange={(event) => updateWord(index, event.target.value)}
              onPaste={(event) => {
                if (pasteSeed(event.clipboardData.getData('text'))) event.preventDefault()
              }}
            />
          </label>
        ))}
      </div>
      {error && <span className="text-xs text-rose-300">{error}</span>}
    </div>
  )
}

export const normalizeSeedPhrase = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)

export const validateSeedPhrase = (value: string | string[]) => {
  const words = Array.isArray(value) ? value.map((word) => word.trim().toLowerCase()) : normalizeSeedPhrase(value)
  const errors: string[] = []

  if (words.length !== 12) errors.push('seed12Required')
  if (words.some((word) => word.length === 0)) errors.push('seedWordsRequired')
  if (words.some((word) => !/^[a-z]+$/.test(word))) errors.push('seedLowercaseOnly')

  return { ok: errors.length === 0, words, errors }
}

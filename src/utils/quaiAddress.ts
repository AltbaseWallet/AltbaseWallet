import { isAddress, isQuaiAddress } from 'quais'

export const isValidQuaiAddress = (address: string) => {
  const normalized = address.trim()
  return isAddress(normalized) && isQuaiAddress(normalized)
}

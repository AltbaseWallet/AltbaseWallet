export const formatAddress = (address?: string, visible = 6) => {
  if (!address) return ''
  if (address.length <= visible * 2 + 3) return address
  return `${address.slice(0, visible)}...${address.slice(-4)}`
}

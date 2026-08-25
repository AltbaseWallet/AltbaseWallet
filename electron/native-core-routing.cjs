const stablePoolIndex = (value, poolSize) => {
  const normalized = String(value || '').toLowerCase()
  let hash = 0
  for (let index = 0; index < normalized.length; index += 1) {
    hash = ((hash * 31) + normalized.charCodeAt(index)) >>> 0
  }
  return hash % poolSize
}

const priorityNodeLane = (requestPath = '') => {
  const normalizedPath = String(requestPath || '').toLowerCase()
  if (normalizedPath.startsWith('/fee/')) return 'fee'
  return 'transaction'
}

const priorityNodePoolKey = (coin, requestPath, poolSize) => {
  const lane = priorityNodeLane(requestPath)
  return `${lane}:pool-${stablePoolIndex(coin, poolSize)}`
}

module.exports = { priorityNodeLane, priorityNodePoolKey, stablePoolIndex }

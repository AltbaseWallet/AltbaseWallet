'use strict'

// Preserve the node's target height and keep scan readiness false until the
// daemon finishes its synchronization stage, including snapshot validation.
function patchEpicSyncStatus(source) {
  if (source.includes('headers: Math.max(height, highestHeight),')) return source
  const oldStatus = "const syncing = Boolean(status.sync_status && status.sync_status !== 'no_sync' && behindTip)"
  if (!source.includes(oldStatus) || !source.includes('headers: height,')) {
    throw new Error('Unsupported Epic adapter layout')
  }
  return source
    .replace(oldStatus, "const syncing = behindTip || Boolean(status.sync_status && status.sync_status !== 'no_sync')")
    .replace('headers: height,', 'headers: Math.max(height, highestHeight),')
}

module.exports = { patchEpicSyncStatus }

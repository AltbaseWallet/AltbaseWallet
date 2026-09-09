/** Prevent queued work from restarting an invalidated wallet session. */
export class TaskSession {
  private revision = 0

  invalidate() { this.revision += 1 }

  capture() {
    const revision = this.revision
    return {
      isCurrent: () => revision === this.revision,
      assertCurrent: () => {
        if (revision !== this.revision) throw new Error('Wallet session changed; background operation cancelled')
      },
    }
  }
}

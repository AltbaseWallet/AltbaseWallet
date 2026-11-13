import { useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { useT } from '../../utils/i18n'

export function DelistingNotice() {
  const t = useT()
  const [paused, setPaused] = useState(false)
  const message = t('delistingNotice')

  return (
    <aside
      aria-label={t('delistingNoticeTitle')}
      className="flex shrink-0 items-center gap-2 border-b border-amber-400/25 bg-amber-400/10 px-3 py-2 text-sm text-amber-200 sm:px-4"
      data-testid="delisting-notice"
    >
      <p className="sr-only">{message}</p>
      <div className="delisting-marquee min-w-0 flex-1" aria-hidden="true">
        <div className="delisting-track" style={{ animationPlayState: paused ? 'paused' : 'running' }}>
          {[0, 1].map(copy => <span key={copy} className="delisting-copy">{message}</span>)}
        </div>
      </div>
      <button
        type="button"
        className="shrink-0 rounded-lg p-2 transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        onClick={() => setPaused(value => !value)}
        aria-label={t(paused ? 'resumeNotice' : 'pauseNotice')}
        aria-pressed={paused}
        data-testid="delisting-pause"
      >
        {paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
      </button>
    </aside>
  )
}

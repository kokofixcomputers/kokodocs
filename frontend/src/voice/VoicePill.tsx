import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Check, Loader2, X } from 'lucide-react'
import { shortcutLabel, type Voice } from './useVoiceTyping'

const BARS = 30

/** Floating "recording" pill with a live bar waveform. Appears while the dictation key is held. */
export function VoicePill({ voice }: { voice: Voice }) {
  const bars = useRef<(HTMLSpanElement | null)[]>([])
  const history = useRef<number[]>(new Array(BARS).fill(0))
  const listening = voice.phase === 'listening'

  useEffect(() => {
    if (!listening) return
    let raf = 0, last = 0
    history.current = new Array(BARS).fill(0)
    const tick = (t: number) => {
      if (t - last > 45) { // ~22 samples a second scrolls nicely without being frantic
        last = t
        const lvl = voice.recorder.current?.level() ?? 0
        history.current.push(lvl); history.current.shift()
        history.current.forEach((v, i) => {
          const el = bars.current[i]
          if (el) { const s = Math.max(0.12, Math.min(1, v)); el.style.transform = `scaleY(${s})`; el.style.opacity = String(0.45 + s * 0.55) }
        })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [listening, voice.recorder])

  const draftRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => { const el = draftRef.current; if (el) el.scrollTop = el.scrollHeight }, [voice.draft])   // newest words stay in view
  if (voice.phase === 'idle') return null
  if (voice.canDraft) {   // live preview: the words as they come in, with the waveform shrunk to a thin strip below
    return createPortal(
      <div className={`voice-pill live ${voice.phase}`} role="status" aria-live="off">
        <p ref={draftRef} className={`vp-draft ${voice.draft ? '' : 'empty'}`}>{voice.draft || (listening ? 'Listening…' : 'Transcribing…')}</p>
        <div className="vp-row">
          {listening ? (
            <>
              <span className="vp-rec sm" aria-hidden><i /></span>
              <span className="vp-bars" aria-hidden>{Array.from({ length: BARS }, (_, i) => <span key={i} ref={(el) => { bars.current[i] = el }} />)}</span>
              <em className="vp-key">Release {shortcutLabel(voice.shortcut)} to insert</em><em className="vp-tap">Tap the tick to insert</em>
              <span className="vp-actions">
                <button type="button" aria-label="Cancel" onMouseDown={(e) => e.preventDefault()} onClick={voice.cancel}><X size={18} /></button>
                <button type="button" className="ok" aria-label="Insert" onMouseDown={(e) => e.preventDefault()} onClick={voice.toggle}><Check size={18} /></button>
              </span>
            </>
          ) : (<><Loader2 size={15} className="spin" /><em>Polishing the text…</em></>)}
        </div>
      </div>, document.body)
  }
  return createPortal(
    <div className={`voice-pill ${voice.phase}`} role="status" aria-live="polite">
      {listening ? (
        <>
          <span className="vp-rec" aria-hidden><i /></span>
          <span className="vp-bars" aria-hidden>{Array.from({ length: BARS }, (_, i) => <span key={i} ref={(el) => { bars.current[i] = el }} />)}</span>
          <span className="vp-text"><b>Listening</b><em className="vp-key">Release {shortcutLabel(voice.shortcut)} to insert</em><em className="vp-tap">Tap the tick to insert</em></span>
          <span className="vp-actions">
            <button type="button" aria-label="Cancel" onMouseDown={(e) => e.preventDefault()} onClick={voice.cancel}><X size={18} /></button>
            <button type="button" className="ok" aria-label="Insert" onMouseDown={(e) => e.preventDefault()} onClick={voice.toggle}><Check size={18} /></button>
          </span>
        </>
      ) : (
        <>
          <Loader2 size={18} className="spin" />
          <span className="vp-text"><b>Transcribing</b></span>
        </>
      )}
    </div>, document.body)
}

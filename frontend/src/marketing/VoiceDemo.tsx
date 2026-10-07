import { useSearchParams } from 'react-router-dom'
import { Check, Loader2, Mic, X } from 'lucide-react'

/** A looping picture of voice typing, drawn as a pure function of time so the same code makes every frame of the GIF on the website. */
export const VOICE_LOOP = 10000
const SAY = 'Move the launch review to Thursday and invite the support team.'
const T = { press: 900, release: 5200, typeStart: 6300, typeEnd: 8500 }
const BARS = 22

const level = (t: number, i: number) => {
  const talking = Math.sin(t / 430) > -0.55   // short pauses between phrases
  const v = 0.2 + 0.8 * Math.abs(Math.sin(t / 95 + i * 0.85)) * (0.45 + 0.55 * Math.abs(Math.sin(t / 310 + i * 0.4)))
  return talking ? v : 0.14 + 0.08 * Math.abs(Math.sin(t / 70 + i))
}

export function VoiceDemoStage({ t }: { t: number }) {
  const down = t >= T.press && t < T.release
  const trans = t >= T.release && t < T.typeStart
  const typed = t < T.typeStart ? 0 : Math.min(SAY.length, Math.floor(((t - T.typeStart) / (T.typeEnd - T.typeStart)) * SAY.length))
  const showPill = down || trans
  const caret = Math.floor(t / 520) % 2 === 0 || typed > 0 && typed < SAY.length
  return (
    <div className="vd-stage" aria-hidden>
      <div className="vd-doc">
        <div className="vd-doc-head"><span className="vd-logo" /><b>Weekly sync notes</b><span className="vd-saved">Saved</span></div>
        <div className="vd-page">
          <h4>Weekly sync</h4>
          <p className="vd-line">Pricing page signed off by design.</p>
          <p className="vd-line">Beta feedback so far: 4.6 out of 5.</p>
          <p className="vd-next"><b>Next steps</b></p>
          <p className="vd-typed">{SAY.slice(0, typed)}{caret && <i className="vd-caret" />}</p>
        </div>
      </div>
      <div className={`vd-key ${down ? 'down' : ''}`}><span>Right Ctrl</span><em>{down ? 'holding' : 'hold to talk'}</em></div>
      <div className={`vd-pill ${showPill ? 'on' : ''}`}>
        {down ? (
          <>
            <span className="vd-rec" />
            <span className="vd-bars">{Array.from({ length: BARS }, (_, i) => <span key={i} style={{ height: `${Math.round(8 + level(t, i) * 26)}px` }} />)}</span>
            <span className="vd-ptext"><b>Listening</b><em>Release Right Ctrl to insert</em></span>
            <span className="vd-x"><X size={15} /></span><span className="vd-ok"><Check size={15} /></span>
          </>
        ) : (
          <><Loader2 size={17} style={{ transform: `rotate(${(t / 2.2) % 360}deg)` }} /><span className="vd-ptext"><b>Transcribing</b></span></>
        )}
      </div>
      <div className="vd-mic"><Mic size={15} />Your microphone</div>
    </div>
  )
}

/** Development-only page that shows one moment of the demo (/__demo/voice?t=milliseconds): how the website's GIF frames are captured. */
export function VoiceDemoFrame() {
  const [q] = useSearchParams()
  return <div className="vd-capture"><VoiceDemoStage t={Number(q.get('t') ?? 0)} /></div>
}

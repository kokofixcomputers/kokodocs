import { useEffect, useRef, useState } from 'react'
import { Mic, Square } from 'lucide-react'

const BARS = 28
type State = 'idle' | 'asking' | 'live' | 'denied' | 'unsupported'

/** "Test your microphone": shows the sound coming in so you can see dictation would hear you. Nothing is recorded, saved or sent anywhere. */
export function MicTest() {
  const [state, setState] = useState<State>('idle')
  const [level, setLevel] = useState(0)
  const bars = useRef<(HTMLSpanElement | null)[]>([])
  const stop = useRef<() => void>(() => {})

  useEffect(() => () => stop.current(), [])

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia) { setState('unsupported'); return }
    setState('asking')
    let stream: MediaStream
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }) } catch { setState('denied'); return }
    const ctx = new AudioContext()
    const src = ctx.createMediaStreamSource(stream)
    const an = ctx.createAnalyser(); an.fftSize = 128; an.smoothingTimeConstant = 0.6
    src.connect(an)
    const data = new Uint8Array(an.frequencyBinCount)
    let raf = 0, last = 0
    const tick = (now: number) => {
      an.getByteFrequencyData(data)
      let sum = 0
      for (let i = 0; i < BARS; i++) {
        const v = data[Math.min(data.length - 1, Math.floor((i / BARS) * data.length * 0.7))] / 255
        const el = bars.current[i]; if (el) el.style.height = `${6 + v * 34}px`
        sum += v
      }
      if (now - last > 120) { last = now; setLevel(sum / BARS) }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    const timer = window.setTimeout(() => stop.current(), 30000)
    stop.current = () => {
      cancelAnimationFrame(raf); window.clearTimeout(timer)
      stream.getTracks().forEach((t) => t.stop()); void ctx.close()
      bars.current.forEach((el) => { if (el) el.style.height = '' })
      stop.current = () => {}; setState('idle'); setLevel(0)
    }
    setState('live')
  }

  const heard = level > 0.08
  return (
    <div className="mic-test">
      <div className="mic-bars" aria-hidden>{Array.from({ length: BARS }, (_, i) => <span key={i} ref={(el) => { bars.current[i] = el }} />)}</div>
      <div className="mic-row">
        {state === 'live'
          ? <button className="btn btn-pill btn-primary" onClick={() => stop.current()}><Square size={15} />Stop</button>
          : <button className="btn btn-pill btn-soft" onClick={start} disabled={state === 'asking'}><Mic size={16} />{state === 'asking' ? 'Waiting for permission' : 'Test your microphone'}</button>}
        <span className={`mic-msg ${state === 'live' ? (heard ? 'ok' : '') : ''}`} role="status" aria-live="polite">
          {state === 'live' ? (heard ? 'Hearing you.' : 'Say something. Nothing yet.') : state === 'denied' ? 'The browser blocked the microphone. Allow it in the address bar and try again.' : state === 'unsupported' ? 'This browser can’t use a microphone here.' : 'Nothing is recorded or sent anywhere.'}
        </span>
      </div>
    </div>
  )
}

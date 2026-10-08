import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { toast } from '../ui/Toast'
import { Recorder } from './recorder'
import { docKeyOf } from '../zk/session'
import { ensureConsent, hasConsent } from '../zk/consent'

const MAX_SECONDS = 120
const MIN_SECONDS = 0.4

/** A click-to-talk microphone for a plain text box (Koko's message field): click to start, click again to transcribe it. */
export function useComposerMic(docId: string, onText: (text: string) => void) {
  const [phase, setPhase] = useState<'idle' | 'listening' | 'transcribing'>('idle')
  const [available, setAvailable] = useState(false)
  const rec = useRef<Recorder | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const phaseRef = useRef(phase)
  const setP = (p: typeof phase) => { phaseRef.current = p; setPhase(p) }
  const sink = useRef(onText); sink.current = onText

  useEffect(() => { api.sttStatus().then((s) => setAvailable(s.available)).catch(() => setAvailable(false)) }, [])

  const stop = useCallback(async (send: boolean) => {
    const r = rec.current
    if (!r || phaseRef.current !== 'listening') return
    window.clearTimeout(timer.current); rec.current = null
    const secs = r.seconds, peak = r.peak
    if (!send || secs < MIN_SECONDS) { r.cancel(); setP('idle'); return }
    setP('transcribing')
    try {
      const wav = await r.finish()
      if (peak < 0.01) { toast("Didn't hear anything. Check your microphone."); return }
      const text = (await api.transcribe(docId, wav)).trim()
      if (text) sink.current(text); else toast("Didn't catch that. Try speaking a little closer to the mic.")
    } catch (e) { toast((e as Error).message || 'Voice typing failed') }
    finally { setP('idle') }
  }, [docId])

  const start = useCallback(async () => {
    if (phaseRef.current !== 'idle') return
    if (docKeyOf(docId) && !hasConsent('voice')) { void ensureConsent('voice'); return }   // an encrypted document: asked once per session
    setP('listening')
    const r = new Recorder(); rec.current = r
    try {
      await r.start()
      if ((phaseRef.current as string) !== 'listening') { r.cancel(); return }
      timer.current = window.setTimeout(() => { toast('Reached the 2 minute limit'); void stop(true) }, MAX_SECONDS * 1000)
    } catch (e) {
      rec.current = null; r.cancel(); setP('idle')
      const name = (e as DOMException).name
      toast(name === 'NotAllowedError' ? 'Microphone access is blocked. Allow it in your browser’s site settings.' : name === 'NotFoundError' ? 'No microphone found.' : 'Could not start the microphone.')
    }
  }, [stop, docId])

  useEffect(() => () => { window.clearTimeout(timer.current); rec.current?.cancel() }, [])
  const toggle = useCallback(() => { if (phaseRef.current === 'listening') void stop(true); else void start() }, [start, stop])
  const cancel = useCallback(() => void stop(false), [stop])
  return { phase, available, toggle, cancel }
}

import { useEffect, useRef, useState } from 'react'
import { CloudOff, Loader2 } from 'lucide-react'
import type { ConnDetail, MergeDetail } from '../collab'
import { toast } from './Toast'
import './syncNotices.css'

/** Tells people what is happening when the connection drops, and what was merged when it comes back.
 *  Edits made while away are kept in the document and combined with everyone else's on reconnect; this just makes that visible. */
export function SyncNotices() {
  const [c, setC] = useState<ConnDetail | null>(null)
  const [show, setShow] = useState(false)
  const wasShown = useRef(false)
  const merged = useRef(false)
  const bad = !!c && c.everConnected && c.status !== 'connected' && c.status !== 'denied'

  useEffect(() => {
    const conn = (e: Event) => { const d = (e as CustomEvent<ConnDetail>).detail; setC(d.status === 'closed' ? null : d) }
    const merge = (e: Event) => {
      const d = (e as CustomEvent<MergeDetail>).detail
      merged.current = true
      toast(d.local && d.remote ? 'Back online. Your changes were merged with edits made while you were away.'
        : d.remote ? 'Back online. Caught up with edits made while you were away.'
        : 'Back online. Your changes are saved.')
    }
    window.addEventListener('koko:conn', conn); window.addEventListener('koko:merged', merge)
    return () => { window.removeEventListener('koko:conn', conn); window.removeEventListener('koko:merged', merge) }
  }, [])

  // a blip of a second or two isn't worth announcing
  useEffect(() => {
    if (!bad) {
      setShow(false)
      if (wasShown.current) {   // we were showing the notice and now it's over: confirm, unless a merge message is about to say more
        wasShown.current = false
        const t = window.setTimeout(() => { if (!merged.current) toast('Back online. Everything is saved.') }, 1200)   // the merge message may already have arrived: it sets merged.current first
        return () => window.clearTimeout(t)
      }
      return
    }
    const t = window.setTimeout(() => { setShow(true); wasShown.current = true; merged.current = false }, 2000)
    return () => window.clearTimeout(t)
  }, [bad])

  if (!show || !c) return null
  const offline = c.status === 'offline'
  const n = c.pending
  return (
    <div className={`sync-pill ${offline ? 'offline' : ''}`} role="status" aria-live="polite">
      {offline ? <CloudOff size={18} /> : <Loader2 size={18} className="spin" />}
      <span className="sp-text"><b>{offline ? 'You’re offline' : 'Reconnecting…'}</b>
        <em>{n > 0 ? `${n} change${n === 1 ? '' : 's'} will sync when you’re back` : 'Keep working: your changes are kept and will sync'}</em></span>
    </div>
  )
}

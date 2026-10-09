import { useEffect, useState } from 'react'
import { CheckCircle2, CloudOff, Loader2 } from 'lucide-react'
import { isOnline } from '../offline/net'
import { offlineOn, outbox } from '../offline/store'
import { syncState, type SyncState } from '../offline/sync'
import { toast } from './Toast'
import './netStatus.css'

/** Connection and offline-copy state, for the desktop title bar and the little pill on the web. */
export function useNet() {
  const [online, setOnline] = useState(isOnline())
  const [s, setS] = useState<SyncState>(syncState())
  const [queued, setQueued] = useState(0)
  const [app, setApp] = useState<{ done: number; total: number; finished?: boolean } | null>(null)
  useEffect(() => {
    const net = () => setOnline(isOnline()), st = (e: Event) => setS({ ...(e as CustomEvent<SyncState>).detail })
    const ap = (e: Event) => setApp((e as CustomEvent).detail)
    window.addEventListener('koko:appfiles', ap)
    const q = () => void outbox.count().then(setQueued)
    q()
    window.addEventListener('koko:net', net); window.addEventListener('koko:syncstate', st); window.addEventListener('koko:outbox', q); window.addEventListener('koko:syncstate', q)
    return () => { window.removeEventListener('koko:appfiles', ap); window.removeEventListener('koko:net', net); window.removeEventListener('koko:syncstate', st); window.removeEventListener('koko:outbox', q); window.removeEventListener('koko:syncstate', q) }
  }, [])
  return { online, sync: s, queued, app }
}

export function NetChip() {
  const { online, sync, queued, app } = useNet()
  if (!offlineOn() && online) return null
  if (!online) return (
    <span className="net-chip off" role="status" title="No connection. Everything saved on this device can still be opened and edited; changes sync when you're back.">
      <CloudOff size={14} /> Offline{queued ? ` · ${queued} waiting` : ''}
    </span>
  )
  if (app && !app.finished && online) return <span className="net-chip busy" role="status" title="Saving the app itself on this computer so it opens offline"><Loader2 size={14} className="spin" /> Saving app {app.done}/{app.total}</span>
  if (sync.phase === 'copying' && sync.total > 0) return <span className="net-chip busy" role="status" title="Saving a copy of your documents on this device"><Loader2 size={14} className="spin" /> Saving offline copy {sync.done}/{sync.total}</span>
  if (sync.phase === 'sending' || queued) return <span className="net-chip busy" role="status"><Loader2 size={14} className="spin" /> Syncing…</span>
  return <span className="net-chip ok" title="Everything is saved on this device too, so it works with no connection."><CheckCircle2 size={14} /> Available offline</span>
}

/** On the web (the desktop app has this in its title bar): a pill only while offline, and a note when changes made offline have been sent. */
export function NetPill() {
  const { online, queued } = useNet()
  useEffect(() => {
    const sent = (e: Event) => { const n = (e as CustomEvent<{ sent: number }>).detail.sent; toast(`Back online. ${n} change${n === 1 ? '' : 's'} made offline ${n === 1 ? 'was' : 'were'} saved.`) }
    window.addEventListener('koko:outbox-sent', sent)
    return () => window.removeEventListener('koko:outbox-sent', sent)
  }, [])
  if (online || !offlineOn() || document.documentElement.classList.contains('desktop')) return null
  return <div className="net-pill"><CloudOff size={16} /><span><b>You’re offline</b><em>{queued ? `${queued} change${queued === 1 ? '' : 's'} will be saved when you’re back` : 'Documents saved on this device still open and can be edited'}</em></span></div>
}

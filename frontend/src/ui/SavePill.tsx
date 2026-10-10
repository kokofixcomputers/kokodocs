import { useEffect, useState } from 'react'
import { Cloud, CloudOff, Loader2 } from 'lucide-react'
import type { KokoProvider } from '../collab'

const ago = (t: number, now: number) => {
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 10) return 'just now'
  if (s < 60) return `${s} sec ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  return h < 24 ? `${h} hr ago` : new Date(t).toLocaleDateString()
}

/** The connection and save state in the top bar: "Saving…" with a spinner while an edit is on its way, then "Saved 2 min ago" (when your last edit went through). */
export function SavePill({ provider, status, readOnly }: { provider: KokoProvider; status: string; readOnly: boolean }) {
  const [, tick] = useState(0)
  useEffect(() => provider.subscribe(() => tick((n) => n + 1)), [provider])
  useEffect(() => { const t = window.setInterval(() => tick((n) => n + 1), 15_000); return () => window.clearInterval(t) }, [])   // ("2 min ago" keeps counting)
  const ok = status === 'connected'
  const saving = ok && provider.saving
  const label = !ok ? (status === 'denied' ? 'No access' : status === 'offline' ? 'Offline' : 'Reconnecting')
    : readOnly ? 'View only' : saving ? 'Saving…' : provider.lastSaved ? `Saved ${ago(provider.lastSaved, Date.now())}` : 'Saved'
  return (
    <span className={`status-pill ${status} ${saving ? 'saving' : ''}`} role="status" aria-live="polite" title={provider.lastSaved ? `Your last change went through at ${new Date(provider.lastSaved).toLocaleTimeString()}` : undefined}>
      {saving ? <Loader2 size={14} className="spin" /> : ok ? <Cloud size={14} /> : <CloudOff size={14} />}<span className="lbl">{label}</span>
    </span>
  )
}

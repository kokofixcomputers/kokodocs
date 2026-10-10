import { useEffect, useState } from 'react'
import { Download, Loader2, X } from 'lucide-react'
import type { UpdateInfo } from './DesktopBar'
import './desktopUpdate.css'

const mb = (n?: number) => (n ? `${(n / 1048576).toFixed(n > 10 * 1048576 ? 0 : 1)} MB` : '')

/** The desktop app found a newer interface (published when the project changed). Asking first, since the page reloads once it is in. */
export function DesktopUpdate() {
  const [u, setU] = useState<UpdateInfo | null>(null)
  const [p, setP] = useState<number | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    const d = window.kokoDesktop?.update
    if (!d) return
    d.onAvailable((x) => { setU(x); setErr('') })
    d.onProgress((x) => setP(x))
    d.onError((m) => { setErr(m); setP(null) })
  }, [])
  if (!u) return null
  const installing = p !== null
  return (
    <div className="desk-update" role="status">
      <Download size={20} />
      <span className="du-text"><b>A new version of KokoDocs is ready</b>
        <em>{err ? `Couldn't update: ${err}` : installing ? `Downloading… ${Math.round((p ?? 0) * 100)}%` : `Version ${u.commit.slice(0, 7)}${u.size ? ` · ${mb(u.size)}` : ''}. The window reloads when it is in.`}</em></span>
      {installing && !err ? <Loader2 size={18} className="spin" /> : (
        <>
          <button className="btn btn-pill btn-primary btn-sm" onClick={() => { setErr(''); setP(0); void window.kokoDesktop!.update!.install().catch(() => {}) }}>{err ? 'Try again' : 'Update'}</button>
          <button className="icon-btn" aria-label="Later" title="Later" onClick={() => setU(null)}><X size={16} /></button>
        </>)}
    </div>
  )
}

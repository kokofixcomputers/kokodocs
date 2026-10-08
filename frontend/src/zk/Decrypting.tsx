import { Lock } from 'lucide-react'
import { useBusy } from './busy'

/** Covers the whole app while encryption keys are being opened, or documents are being encrypted or decrypted. */
export function DecryptingPage() {
  const b = useBusy()
  if (!b) return null
  const pct = b.total ? Math.min(100, Math.round(((b.done ?? 0) / b.total) * 100)) : null
  return (
    <div className="zk-busy" role="alertdialog" aria-live="polite" aria-busy="true" aria-label={b.title}>
      <div className="zk-busy-card">
        <span className="zk-busy-icon"><Lock size={26} /></span>
        <h2>{b.title}</h2>
        {b.detail && <p className="muted">{b.detail}</p>}
        {pct === null ? <span className="spinner" /> : (
          <div className="zk-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={{ width: `${pct}%` }} /></div>)}
        {b.total ? <p className="muted zk-count">{b.done ?? 0} of {b.total}</p> : null}
        <p className="muted zk-hint">Please keep this page open.</p>
      </div>
    </div>
  )
}

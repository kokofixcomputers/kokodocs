import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { useAuth } from '../auth'

/** Signed in, but this device doesn't have the keys yet (a new browser, or signed in by another way): the password opens them. */
export function UnlockPage() {
  const { user, unlock, logout } = useAuth()
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true)
    try { await unlock(pw); setPw('') } catch (x) { setErr((x as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="zk-unlock">
      <form className="zk-busy-card" onSubmit={submit}>
        <span className="zk-busy-icon"><Lock size={26} /></span>
        <h2>Unlock your encrypted documents</h2>
        <p className="muted">Signed in as {user?.email}. Your password opens the keys on this device; it is never sent to the server.</p>
        <label className="field" style={{ width: '100%' }}>
          <input type="password" autoFocus autoComplete="current-password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} required />
        </label>
        {err && <p className="form-error" role="alert">{err}</p>}
        <button className="btn btn-pill btn-primary" style={{ width: '100%' }} disabled={busy || !pw}>{busy ? <span className="spinner sm" /> : 'Unlock'}</button>
        <p className="muted" style={{ fontSize: 13 }}><Link to="/forgot" onClick={() => logout()}>Forgot your password?</Link> · <button type="button" className="link-btn" onClick={() => logout()}>Sign out</button></p>
      </form>
    </div>
  )
}

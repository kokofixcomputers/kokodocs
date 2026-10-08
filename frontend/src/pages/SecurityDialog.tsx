import { useEffect, useState } from 'react'
import { Check, Copy, KeyRound, Lock, Mail, ShieldCheck, Trash2 } from 'lucide-react'
import { api, getToken } from '../api'
import { useAuth } from '../auth'
import { Modal } from '../ui/Modal'
import { toast } from '../ui/Toast'
import { ProviderMark } from '../ui/ProviderMark'

import { fmtBytes, tier } from '../ui/StorageMeter'
export { fmtBytes }

export function StorageRow() {
  const [st, setSt] = useState<import('../api').Storage | null>(null)
  useEffect(() => { api.myStorage().then(setSt).catch(() => {}) }, [])
  if (!st) return null
  const pct = st.limit ? Math.min(100, (st.used / st.limit) * 100) : 0
  return (
    <div className="storage-row">
      <div className="switch-row" style={{ borderBottom: 0, padding: 0 }}>
        <div><b>Storage</b><span>{fmtBytes(st.used)} {st.limit ? `of ${fmtBytes(st.limit)} used` : 'used (no limit)'}</span></div>
      </div>
      {st.limit > 0 && <div className={`meter ${tier(st.used, st.limit)}`} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct}%` }} /></div>}
      <span className="muted hint">Documents {fmtBytes(st.documents)} · History {fmtBytes(st.versions)} · Images {fmtBytes(st.images)}{st.files ? ` · Form files ${fmtBytes(st.files)}` : ''}</span>
    </div>
  )
}

export function NotifyRow() {
  const { user, acceptToken } = useAuth()
  const [on, setOn] = useState(user?.notify_email !== false)
  const [email, setEmail] = useState(false)
  useEffect(() => { api.authConfig().then((c) => setEmail(c.email)).catch(() => {}) }, [])
  if (!email) return null
  return (
    <div className="switch-row" style={{ borderBottom: 0, padding: 0 }}>
      <div><b>Email me about mentions</b><span>When someone @mentions you in a comment</span></div>
      <button role="switch" aria-checked={on} aria-label="Email me about mentions" className={`toggle ${on ? 'on' : ''}`} onClick={async () => { const v = !on; setOn(v); try { await api.setPrefs({ notify_email: v }); await acceptToken(getToken()!) } catch (e) { setOn(!v); toast((e as Error).message) } }} />
    </div>
  )
}

/** Which sign-in providers (Google, GitHub...) this person has linked, with a button to link or unlink each one the admin has set up. */
export function LinkedAccounts() {
  const [providers, setProviders] = useState<{ id: string; name: string; preset: string }[]>([])
  const [linked, setLinked] = useState<{ provider: string; name: string; label: string }[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const load = () => { api.authConfig().then((c) => setProviders(c.providers)).catch(() => {}); api.ssoIdentities().then(setLinked).catch(() => {}) }
  useEffect(load, [])
  const shown = [...providers.map((p) => ({ id: p.id, name: p.name, preset: p.preset })), ...linked.filter((l) => !providers.some((p) => p.id === l.provider)).map((l) => ({ id: l.provider, name: l.name, preset: 'custom' }))]
  if (!shown.length) return null
  const link = async (id: string) => { setBusy(id); try { location.href = (await api.ssoLink(id)).url } catch (e) { toast((e as Error).message); setBusy(null) } }
  const unlink = async (id: string, name: string) => { setBusy(id); try { await api.ssoUnlink(id); toast(`${name} account unlinked`); load() } catch (e) { toast((e as Error).message) } finally { setBusy(null) } }
  return (
    <div className="st-stack" style={{ gap: 14 }}>
      {shown.map((p) => {
        const l = linked.find((x) => x.provider === p.id)
        return (
          <div key={p.id} className="switch-row" style={{ borderBottom: 0, padding: 0 }}>
            <div><b style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><ProviderMark preset={p.preset} />{p.name}</b><span>{l ? `Linked${l.label ? ` to ${l.label}` : ''}` : `Link a ${p.name} account to sign in with one click`}</span></div>
            {l ? <button className="btn btn-pill btn-ghost btn-sm" disabled={busy === p.id} onClick={() => void unlink(p.id, p.name)}>Unlink</button>
              : providers.some((x) => x.id === p.id) ? <button className="btn btn-pill btn-soft btn-sm" disabled={busy === p.id} onClick={() => void link(p.id)}>Link</button> : null}
          </div>)
      })}
    </div>
  )
}

export function DeleteForm({ hasPassword, totp, onCancel }: { hasPassword: boolean; totp: boolean; onCancel: () => void }) {
  const { user, logout } = useAuth()
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [st, setSt] = useState<import('../api').Storage | null>(null)
  useEffect(() => { api.myStorage().then(setSt).catch(() => {}) }, [])
  const go = async () => {
    setErr(''); setBusy(true)
    try { await api.deleteAccount({ email, password: pw, code }); logout(); toast('Your account was deleted'); location.href = '/signup' } catch (e) { setErr((e as Error).message); setBusy(false) }
  }
  return (
    <>
      <p style={{ margin: 0 }}><b>Delete your account?</b> This permanently deletes your documents, spreadsheets, folders, version history, comments and settings{st ? ` (${fmtBytes(st.used)} of data)` : ''}. Files you shared with others disappear for them too. This can't be undone.</p>
      <label className="field"><Mail size={18} /><input autoComplete="off" placeholder={`Type ${user?.email ?? 'your email'} to confirm`} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      {hasPassword && <label className="field"><Lock size={18} /><input type="password" autoComplete="current-password" placeholder="Your password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>}
      {totp && <label className="field"><ShieldCheck size={18} /><input inputMode="numeric" placeholder="Two-factor code" value={code} onChange={(e) => setCode(e.target.value)} /></label>}
      {err && <p className="form-error">{err}</p>}
      <div className="modal-actions"><button className="btn btn-pill btn-ghost" onClick={onCancel}>Keep my account</button>
        <button className="btn btn-pill btn-danger" disabled={busy || email.trim().toLowerCase() !== user?.email.toLowerCase() || (hasPassword && !pw) || (totp && !code)} onClick={go}>{busy ? <span className="spinner sm" /> : 'Delete forever'}</button></div>
    </>
  )
}

export function PasswordForm({ hasPassword, totp, onDone }: { hasPassword: boolean; totp: boolean; onDone: () => void }) {
  const [cur, setCur] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const { acceptToken } = useAuth()
  const submit = async () => {
    setErr('')
    if (pw.length < 8) { setErr('Use at least 8 characters'); return }
    if (pw !== pw2) { setErr("The new passwords don't match"); return }
    setBusy(true)
    try { await api.changePassword({ current: cur, new: pw, code }); toast('Password changed'); await acceptToken(getToken()!); onDone() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <>
      {!hasPassword && <p className="muted" style={{ margin: 0 }}>You signed up with a single sign-on provider, so you don't have a password yet. Set one to also sign in with your email.</p>}
      {hasPassword && <label className="field"><Lock size={18} /><input type="password" autoComplete="current-password" placeholder="Current password" value={cur} onChange={(e) => setCur(e.target.value)} /></label>}
      <label className="field"><KeyRound size={18} /><input type="password" autoComplete="new-password" placeholder="New password (8+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
      <label className="field"><KeyRound size={18} /><input type="password" autoComplete="new-password" placeholder="Repeat new password" value={pw2} onChange={(e) => setPw2(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !totp && submit()} /></label>
      {totp && <label className="field"><ShieldCheck size={18} /><input inputMode="numeric" placeholder="Two-factor code" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} /></label>}
      {err && <p className="form-error">{err}</p>}
      <div className="modal-actions"><button className="btn btn-pill btn-ghost" onClick={onDone}>Cancel</button><button className="btn btn-pill btn-primary" disabled={busy || !pw} onClick={submit}>{hasPassword ? 'Change password' : 'Set password'}</button></div>
    </>
  )
}

export function SecurityDialog({ onClose, initial = 'main' }: { onClose: () => void; initial?: 'main' | 'password' | 'delete' }) {
  const { user } = useAuth()
  const [view, setView] = useState<'main' | 'password' | 'delete'>(initial)
  const [status, setStatus] = useState<{ enabled: boolean; recovery_left: number } | null>(null)
  const [setup, setSetup] = useState<{ secret: string; uri: string; qr: string } | null>(null)
  const [codes, setCodes] = useState<string[] | null>(null)
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const load = () => api.twofaStatus().then(setStatus).catch((e) => setErr(e.message))
  useEffect(() => { void load() }, [])

  const start = async () => {
    setErr(''); setBusy(true)
    try {
      const s = await api.twofaSetup()
      const QR = await import('qrcode')
      setSetup({ ...s, qr: await QR.toDataURL(s.uri, { margin: 1, width: 360 }) })
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const enable = async () => {
    setErr(''); setBusy(true)
    try { const r = await api.twofaEnable(code); setCodes(r.recovery_codes); setSetup(null); setCode(''); void load() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const disable = async () => {
    setErr(''); setBusy(true)
    try { await api.twofaDisable(code); setCode(''); toast('Two-factor turned off'); void load() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const copy = async (t: string) => { await navigator.clipboard.writeText(t); setCopied(true); setTimeout(() => setCopied(false), 1500) }

  return (
    <Modal title="Account security" onClose={onClose} width={460}>
      <div className="share-body">
        {view === 'delete' ? <DeleteForm hasPassword={user?.has_password !== false} totp={!!status?.enabled} onCancel={() => setView('main')} />
        : view === 'password' ? <PasswordForm hasPassword={user?.has_password !== false} totp={!!status?.enabled} onDone={() => setView('main')} />
        : !status ? <span className="spinner" /> : codes ? (
          <>
            <p><b>Two-factor is on.</b> Save these recovery codes somewhere safe. Each works once if you lose your phone. They won't be shown again.</p>
            <div className="sec-codes">{codes.map((c) => <span key={c}>{c}</span>)}</div>
            <div className="modal-actions"><button className="btn btn-pill btn-ghost" onClick={() => copy(codes.join('\n'))}>{copied ? <Check size={16} /> : <Copy size={16} />}Copy codes</button><button className="btn btn-pill btn-primary" onClick={() => setCodes(null)}>Done</button></div>
          </>
        ) : setup ? (
          <>
            <p className="muted" style={{ margin: 0 }}>Scan this with an authenticator app (Google Authenticator, 1Password, Authy), or type the key in by hand.</p>
            <div className="sec-qr"><img src={setup.qr} alt="Two-factor QR code" />
              <div className="sec-secret"><span>{setup.secret.match(/.{1,4}/g)?.join(' ')}</span><button className="icon-btn sm" aria-label="Copy key" onClick={() => copy(setup.secret)}>{copied ? <Check size={15} /> : <Copy size={15} />}</button></div>
            </div>
            <label className="field"><ShieldCheck size={18} /><input autoFocus inputMode="numeric" placeholder="6-digit code from the app" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && enable()} /></label>
            {err && <p className="form-error">{err}</p>}
            <div className="modal-actions"><button className="btn btn-pill btn-ghost" onClick={() => { setSetup(null); setErr('') }}>Cancel</button><button className="btn btn-pill btn-primary" disabled={busy || code.length < 6} onClick={enable}>Turn on</button></div>
          </>
        ) : status.enabled ? (
          <>
            <button className="btn btn-pill btn-soft" onClick={() => setView('password')}><Lock size={16} />Change password</button>
            <LinkedAccounts />
            <NotifyRow />
            <StorageRow />
            <p style={{ margin: 0 }}><b>Two-factor authentication is on.</b> {status.recovery_left} recovery code{status.recovery_left === 1 ? '' : 's'} left.</p>
            <label className="field"><ShieldCheck size={18} /><input inputMode="numeric" placeholder="Enter a code to turn it off" value={code} onChange={(e) => setCode(e.target.value)} /></label>
            {err && <p className="form-error">{err}</p>}
            <div className="modal-actions"><button className="btn btn-pill btn-ghost" disabled={busy || !code} onClick={disable}>Turn off</button></div>
          </>
        ) : (
          <>
            <button className="btn btn-pill btn-soft" onClick={() => setView('password')}><Lock size={16} />{user?.has_password === false ? 'Set a password' : 'Change password'}</button>
            <LinkedAccounts />
            <NotifyRow />
            <StorageRow />
            <p style={{ margin: 0 }}>Add a second step to signing in with a code from an authenticator app.</p>
            {err && <p className="form-error">{err}</p>}
            <div className="modal-actions"><button className="btn btn-pill btn-primary" disabled={busy} onClick={start}>Set up two-factor</button></div>
          </>
        )}
        {view === 'main' && status && !codes && !setup && <button className="danger-link" onClick={() => setView('delete')}><Trash2 size={15} />Delete account</button>}
      </div>
    </Modal>
  )
}

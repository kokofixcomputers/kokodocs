import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, KeyRound, Lock, Mail, ShieldCheck, User as UserIcon } from 'lucide-react'
import { api } from '../api'
import { useAuth } from '../auth'
import { Logo } from '../ui/Logo'
import { ProviderMark } from '../ui/ProviderMark'
import { hideBusy, showBusy } from '../zk/busy'
import { destroyAndReset, resetWithRecovery, zkApi } from '../zk/flows'
import { RecoveryKey } from '../zk/ZkSettings'


/** Six-digit email code entry with a resend countdown. */
function CodeStep({ email, cooldown, onVerify, onResend, onBack, hint }: { email: string; cooldown: number; onVerify: (code: string) => Promise<void>; onResend: () => Promise<number>; onBack: () => void; hint?: string }) {
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [wait, setWait] = useState(cooldown)
  useEffect(() => { if (wait <= 0) return; const t = setTimeout(() => setWait((w) => w - 1), 1000); return () => clearTimeout(t) }, [wait])
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true)
    try { await onVerify(code) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <form className="auth-form" onSubmit={submit}>
      <p className="muted" style={{ margin: 0 }}>{hint ?? 'We sent a 6-digit code to'} <b style={{ color: 'var(--ink)' }}>{email}</b>. It expires in 10 minutes.</p>
      <label className="field"><ShieldCheck size={18} />
        <input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, '').slice(0, 6))} required />
      </label>
      {err && <p className="form-error" role="alert">{err}</p>}
      <button className="btn btn-primary btn-pill btn-lg" disabled={busy || code.length !== 6}>{busy ? <span className="spinner sm" /> : 'Confirm'}</button>
      <div className="code-links">
        <button type="button" className="cm-link" onClick={onBack}><ArrowLeft size={13} />Back</button>
        <button type="button" className="cm-link" disabled={wait > 0} onClick={async () => { setErr(''); try { setWait(await onResend()) } catch (e) { setErr((e as Error).message) } }}>{wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}</button>
      </div>
    </form>
  )
}

export function MfaForm({ token, onDone }: { token: string; onDone: () => void }) {
  const { completeMfa } = useAuth()
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [recovery, setRecovery] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true)
    try { await completeMfa(token, code); onDone() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <form className="auth-form" onSubmit={submit}>
      <p className="muted" style={{ margin: 0 }}>{recovery ? 'Enter one of your recovery codes.' : 'Enter the 6-digit code from your authenticator app.'}</p>
      <label className="field">{recovery ? <KeyRound size={18} /> : <ShieldCheck size={18} />}
        <input autoFocus inputMode={recovery ? 'text' : 'numeric'} autoComplete="one-time-code" placeholder={recovery ? 'xxxx-xxxx-xxxx' : '123456'} value={code} onChange={(e) => setCode(e.target.value)} required />
      </label>
      {err && <p className="form-error" role="alert">{err}</p>}
      <button className="btn btn-primary btn-pill btn-lg" disabled={busy}>{busy ? <span className="spinner sm" /> : 'Verify'}</button>
      <button type="button" className="cm-link" style={{ alignSelf: 'center' }} onClick={() => { setRecovery((r) => !r); setCode('') }}>{recovery ? 'Use authenticator code' : 'Use a recovery code'}</button>
    </form>
  )
}

export function AuthEmbedded({ mode, onDone, next = '/' }: { mode: 'login' | 'signup'; onDone?: () => void; next?: string }) {
  const { login, signup, completeSignup } = useAuth()
  const [pendingCode, setPendingCode] = useState<{ cooldown: number } | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [mfa, setMfa] = useState<string | null>(null)
  const [cfg, setCfg] = useState<{ signup_enabled: boolean; providers: { id: string; name: string; preset: string }[]; email: boolean } | null>(null)
  const [params] = useSearchParams()
  useEffect(() => { api.authConfig().then(setCfg).catch(() => setCfg({ signup_enabled: true, providers: [], email: false })) }, [])
  useEffect(() => { const e = params.get('error'); if (e) setErr(e) }, [params])

  if (mfa) return <MfaForm token={mfa} onDone={() => onDone?.()} />
  if (pendingCode) return <CodeStep email={email.trim().toLowerCase()} cooldown={pendingCode.cooldown}
    onVerify={async (c) => { await completeSignup(email.trim().toLowerCase(), c); onDone?.() }}
    onResend={async () => (await api.signupResend(email.trim().toLowerCase())).cooldown} onBack={() => setPendingCode(null)} />
  if (mode === 'signup' && cfg && !cfg.signup_enabled) return <p className="muted">Sign-ups are currently closed. Ask the administrator for an account.</p>

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr(''); setBusy(true)
    try {
      if (mode === 'signup' && cfg?.email) { const r = await api.signupStart({ email, name, password }); setPendingCode({ cooldown: r.cooldown }) }
      else if (mode === 'signup') { await signup(email, name, password); onDone?.() }
      else { const r = await login(email, password); if (r) setMfa(r.mfa_token); else onDone?.() }
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <>
      {!!cfg?.providers.length && (
        <>
          {cfg.providers.map((p) => (
            <a key={p.id} className="btn btn-ghost btn-pill btn-lg google-btn" href={`/api/auth/sso/${p.id}/start?next=${encodeURIComponent(next)}`}><ProviderMark preset={p.preset} />Continue with {p.name}</a>))}
          <div className="auth-or"><span>or</span></div>
        </>
      )}
      <form className="auth-form" onSubmit={submit}>
        {mode === 'signup' && (
          <label className="field"><UserIcon size={18} />
            <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} autoComplete="name" />
          </label>
        )}
        <label className="field"><Mail size={18} />
          <input type="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </label>
        <label className="field"><Lock size={18} />
          <input type="password" placeholder={mode === 'signup' ? 'Password (8+ characters)' : 'Password'} value={password}
            onChange={(e) => setPassword(e.target.value)} required minLength={mode === 'signup' ? 8 : 1}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
        </label>
        {err && <p className="form-error" role="alert">{err}</p>}
        {mode === 'login' && cfg?.email && <Link to="/forgot" className="forgot-link">Forgot password?</Link>}
        <button className="btn btn-primary btn-pill btn-lg" disabled={busy}>
          {busy ? <span className="spinner sm" /> : (mode === 'signup' ? (cfg?.email ? 'Continue' : 'Create account') : 'Sign in')}
        </button>
      </form>
    </>
  )
}

export function ForgotPage() {
  const nav = useNavigate()
  const [step, setStep] = useState<'email' | 'code' | 'recovery' | 'destroy' | 'newkey' | 'done'>('email')
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [zkReset, setZkReset] = useState<{ token: string; keys: import('../zk/flows').ServerKeys } | null>(null)
  const [rkey, setRkey] = useState('')
  const [newKey, setNewKey] = useState('')
  const [isZk, setIsZk] = useState(false)
  const [cooldown, setCooldown] = useState(30)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [off, setOff] = useState(false)
  useEffect(() => { api.authConfig().then((c) => setOff(!c.email)).catch(() => {}) }, [])
  const send = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true)
    try { const r = await api.passwordForgot(email); setCooldown(r.cooldown); setIsZk(await zkApi.prelogin(email.trim().toLowerCase()).then((x) => x.zk).catch(() => false)); setStep('code') } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="auth-wrap"><div className="auth-card">
      <div className="auth-brand"><Logo size={30} /><span>KokoDocs</span></div>
      <h2>Reset your password</h2>
      {off ? <p className="muted">Password reset by email isn't set up on this server. Ask your administrator to reset it for you.</p>
        : step === 'email' ? (
          <form className="auth-form" onSubmit={send}>
            <p className="muted" style={{ margin: 0 }}>Enter your account's email and we'll send a 6-digit code.</p>
            <label className="field"><Mail size={18} /><input type="email" autoFocus placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></label>
            {err && <p className="form-error" role="alert">{err}</p>}
            <button className="btn btn-primary btn-pill btn-lg" disabled={busy}>{busy ? <span className="spinner sm" /> : 'Send code'}</button>
          </form>
        ) : step === 'code' ? (
          <div className="auth-form">
            <label className="field"><Lock size={18} /><input type="password" placeholder="New password (8+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} autoComplete="new-password" /></label>
            <CodeStep email={email.trim().toLowerCase()} cooldown={cooldown} hint="If that account exists, we sent a 6-digit code to"
              onVerify={async (c) => {
                if (pw.length < 8) throw new Error('Choose a new password with at least 8 characters')
                const r = await api.passwordReset({ email, code: c, password: isZk ? '' : pw })   // an encrypted account's new password never leaves this browser
                if (r.zk && r.token && r.keys) { setZkReset({ token: r.token, keys: r.keys }); setStep('recovery') } else setStep('done')
              }}
              onResend={async () => (await api.passwordForgot(email)).cooldown} onBack={() => setStep('email')} />
          </div>
        ) : step === 'recovery' && zkReset ? (
          <form className="auth-form" onSubmit={async (e) => {
            e.preventDefault(); setErr(''); setBusy(true)
            try { showBusy('Decrypting…', 'Opening your encryption keys with the recovery key'); setNewKey(await resetWithRecovery(zkReset.token, zkReset.keys, rkey, pw)); setStep('newkey') } catch (x) { setErr((x as Error).message) } finally { hideBusy(); setBusy(false) }
          }}>
            <p style={{ margin: 0 }}>Your account's documents are encrypted, so a new password needs your <b>recovery key</b> (the 52 characters you saved when you turned encryption on).</p>
            <label className="field"><KeyRound size={18} /><input autoFocus spellCheck={false} autoComplete="off" placeholder="XXXX-XXXX-XXXX-…" value={rkey} onChange={(e) => setRkey(e.target.value)} required /></label>
            {err && <p className="form-error" role="alert">{err}</p>}
            <button className="btn btn-primary btn-pill btn-lg" disabled={busy || !rkey.trim()}>{busy ? <span className="spinner sm" /> : 'Set the new password'}</button>
            <button type="button" className="link-btn" onClick={() => setStep('destroy')}>I don't have my recovery key</button>
          </form>
        ) : step === 'destroy' && zkReset ? (
          <form className="auth-form" onSubmit={async (e) => {
            e.preventDefault(); setErr(''); setBusy(true)
            try { await destroyAndReset(zkReset.token, pw); setStep('done') } catch (x) { setErr((x as Error).message) } finally { setBusy(false) }
          }}>
            <p style={{ margin: 0 }}><b>Without the recovery key your encrypted documents can never be opened again, by anyone.</b> You can still get into your account, but its encrypted documents will be deleted, and so will your copy of anything encrypted that was shared with you. Documents that were never encrypted are kept.</p>
            <label className="field"><input autoComplete="off" placeholder="Type DELETE to confirm" value={rkey} onChange={(e) => setRkey(e.target.value)} /></label>
            {err && <p className="form-error" role="alert">{err}</p>}
            <button className="btn btn-danger btn-pill btn-lg" disabled={busy || rkey.trim() !== 'DELETE'}>{busy ? <span className="spinner sm" /> : 'Delete encrypted documents and reset'}</button>
            <button type="button" className="link-btn" onClick={() => { setRkey(''); setStep('recovery') }}>Back: I found my recovery key</button>
          </form>
        ) : step === 'newkey' ? (
          <div className="auth-form">
            <p style={{ margin: 0 }}>Your password was changed and your documents are safe. For safety this made a <b>new recovery key</b> (the old one no longer works). Save it now.</p>
            <RecoveryKey text={newKey} onClose={() => setStep('done')} />
          </div>
        ) : (
          <div className="auth-form"><p style={{ margin: 0 }}>Your password was changed. You can sign in with it now.</p>
            <button className="btn btn-primary btn-pill btn-lg" onClick={() => nav('/login', { replace: true })}>Go to sign in</button></div>
        )}
      <p className="switch"><Link to="/login">Back to sign in</Link></p>
    </div></div>
  )
}

/** Landing page after single sign-on: picks the token (or a 2FA challenge) out of the URL fragment. */
export function AuthCallback() {
  const { acceptToken } = useAuth()
  const nav = useNavigate()
  const [mfa, setMfa] = useState<string | null>(null)
  const frag = new URLSearchParams(location.hash.slice(1))
  const next = frag.get('next') || '/'
  useEffect(() => {
    const t = frag.get('token'), m = frag.get('mfa')
    history.replaceState(null, '', location.pathname)
    if (t) acceptToken(t).then(() => nav(next, { replace: true })).catch(() => nav('/login', { replace: true }))
    else if (m) setMfa(m)
    else nav('/login', { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div className="auth-wrap"><div className="auth-card">
      <div className="auth-brand"><Logo size={30} /><span>KokoDocs</span></div>
      {mfa ? <><h2>Two-factor check</h2><MfaForm token={mfa} onDone={() => nav(next, { replace: true })} /></> : <span className="spinner" />}
    </div></div>
  )
}

export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const { user } = useAuth()
  const nav = useNavigate()
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/'
  if (user) return <Navigate to={from} replace />

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand"><Logo size={30} /><span>KokoDocs</span></div>
        <h2>{mode === 'signup' ? 'Create your account' : 'Sign in'}</h2>
        <AuthEmbedded mode={mode} next={from} onDone={() => nav(from, { replace: true })} />
        <p className="switch">
          {mode === 'signup' ? <>Already have an account? <Link to="/login" state={{ from }}>Sign in</Link></>
            : <>New to KokoDocs? <Link to="/signup" state={{ from }}>Create an account</Link></>}
        </p>
      </div>
    </div>
  )
}

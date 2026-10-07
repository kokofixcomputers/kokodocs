import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, KeyRound, Lock, Mail, ShieldCheck, User as UserIcon } from 'lucide-react'
import { api } from '../api'
import { useAuth } from '../auth'
import { Logo } from '../ui/Logo'

const GoogleMark = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" /><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.1 5.3-4.5 7l7.3 5.7c4.3-4 6.9-9.9 6.9-17.2z" /><path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-2.9-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z" /><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.800l-7.300-5.700c-2 1.400-4.600 2.200-8.600 2.200-6.300 0-11.600-4.100-13.500-9.800l-7.900 6.100C6.500 42.600 14.600 48 24 48z" /></svg>
)

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
  const [cfg, setCfg] = useState<{ signup_enabled: boolean; google: boolean; email: boolean } | null>(null)
  const [params] = useSearchParams()
  useEffect(() => { api.authConfig().then(setCfg).catch(() => setCfg({ signup_enabled: true, google: false, email: false })) }, [])
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
      {cfg?.google && (
        <>
          <a className="btn btn-ghost btn-pill btn-lg google-btn" href={`/api/auth/google/start?next=${encodeURIComponent(next)}`}><GoogleMark />Continue with Google</a>
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
  const [step, setStep] = useState<'email' | 'code' | 'done'>('email')
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [cooldown, setCooldown] = useState(30)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [off, setOff] = useState(false)
  useEffect(() => { api.authConfig().then((c) => setOff(!c.email)).catch(() => {}) }, [])
  const send = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true)
    try { const r = await api.passwordForgot(email); setCooldown(r.cooldown); setStep('code') } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
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
              onVerify={async (c) => { if (pw.length < 8) throw new Error('Choose a new password with at least 8 characters'); await api.passwordReset({ email, code: c, password: pw }); setStep('done') }}
              onResend={async () => (await api.passwordForgot(email)).cooldown} onBack={() => setStep('email')} />
          </div>
        ) : (
          <div className="auth-form"><p style={{ margin: 0 }}>Your password was changed. You can sign in with it now.</p>
            <button className="btn btn-primary btn-pill btn-lg" onClick={() => nav('/login', { replace: true })}>Go to sign in</button></div>
        )}
      <p className="switch"><Link to="/login">Back to sign in</Link></p>
    </div></div>
  )
}

/** Landing page after Google sign-in: picks the token (or a 2FA challenge) out of the URL fragment. */
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

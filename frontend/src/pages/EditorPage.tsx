import { lazy, Suspense, useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { FileQuestion, KeyRound, LogIn, RotateCcw, ShieldX, Trash2 } from 'lucide-react'
import { api, ApiError, setDocToken, type DocInfo } from '../api'
import { useAuth } from '../auth'
import { DocEditor } from '../editor/DocEditor'

const SheetEditor = lazy(() => import('../sheet/SheetEditor'))
const SlidesEditor = lazy(() => import('../slides/SlidesEditor'))
const FormEditor = lazy(() => import('../forms/FormEditor'))
const FormPage = lazy(() => import('../forms/FormPage'))
const WikiEditor = lazy(() => import('../wiki/WikiEditor'))
const BoardEditor = lazy(() => import('../board/BoardEditor'))
import { Logo } from '../ui/Logo'
import { AuthEmbedded } from './AuthPage'
import { setShortcutArea } from '../ui/Shortcuts'

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; info: DocInfo }
  | { kind: 'gate'; code: string; message: string }

export function Gate({ children, icon, title, text }: { children?: React.ReactNode; icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="gate">
      <div className="gate-card">
        <Logo size={40} />
        <div className="gate-ico">{icon}</div>
        <h2>{title}</h2>
        <p className="muted">{text}</p>
        {children}
      </div>
    </div>
  )
}

function PasswordGate({ id, onUnlocked }: { id: string; onUnlocked: () => void }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('')
    try { const r = await api.unlock(id, pw); setDocToken(id, r.token); onUnlocked() }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <form className="auth-form" onSubmit={submit}>
      <label className="field"><KeyRound size={18} />
        <input type="password" autoFocus placeholder="Document password" value={pw} onChange={(e) => setPw(e.target.value)} required />
      </label>
      {err && <p className="form-error" role="alert">{err}</p>}
      <button className="btn btn-primary btn-pill btn-lg" disabled={busy}>{busy ? <span className="spinner sm" /> : 'Unlock'}</button>
    </form>
  )
}

export function EditorPage() {
  const { id = '' } = useParams()
  const { user, loading, logout } = useAuth()
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [mode, setMode] = useState<'login' | 'signup'>('login')

  const load = useCallback(() => {
    api.getDoc(id).then((info) => setState({ kind: 'ready', info }))
      .catch((e: ApiError) => setState({ kind: 'gate', code: e.code ?? 'error', message: e.message }))
  }, [id])

  useEffect(() => { if (!loading) { setState({ kind: 'loading' }); load() } }, [id, loading, user?.id, load])

  const readyKind = state.kind === 'ready' ? state.info.kind : null
  useEffect(() => { setShortcutArea(readyKind === 'wiki' ? 'doc' : readyKind === 'board' ? 'general' : readyKind ?? 'general'); return () => setShortcutArea('general') }, [readyKind])

  if (state.kind === 'loading') return <div className="splash"><span className="spinner" /></div>
  if (state.kind === 'ready') {
    const k = `${state.info.id}:${user?.id ?? 'anon'}:${state.info.role}`
    if (state.info.kind === 'form') return <Suspense fallback={<div className="splash"><span className="spinner" /></div>}>{state.info.role === 'viewer' ? <FormPage key={k} info={state.info} /> : <FormEditor key={k} info={state.info} />}</Suspense>
    if (state.info.kind === 'board') return <Suspense fallback={<div className="splash"><span className="spinner" /></div>}><BoardEditor key={k} info={state.info} /></Suspense>
    if (state.info.kind === 'wiki') return <Suspense fallback={<div className="splash"><span className="spinner" /></div>}><WikiEditor key={k} info={state.info} /></Suspense>
    if (state.info.kind === 'slides') return <Suspense fallback={<div className="splash"><span className="spinner" /></div>}><SlidesEditor key={k} info={state.info} /></Suspense>
    return state.info.kind === 'sheet'
      ? <Suspense fallback={<div className="splash"><span className="spinner" /></div>}><SheetEditor key={k} info={state.info} /></Suspense>
      : <DocEditor key={k} info={state.info} />
  }

  if (state.code === 'password_required') {
    return (
      <Gate icon={<KeyRound size={26} />} title="This document is password protected" text="Enter the password the owner shared with you.">
        <PasswordGate id={id} onUnlocked={load} />
      </Gate>
    )
  }
  if (state.code === 'login_required') {
    return (
      <Gate icon={<LogIn size={26} />} title="Sign in to open this document" text="The owner has restricted access to specific people.">
        <AuthEmbedded mode={mode} />
        <p className="switch">
          {mode === 'login' ? <>New here? <a href="#" onClick={(e) => { e.preventDefault(); setMode('signup') }}>Create an account</a></>
            : <>Have an account? <a href="#" onClick={(e) => { e.preventDefault(); setMode('login') }}>Sign in</a></>}
        </p>
      </Gate>
    )
  }
  if (state.code === 'trashed') {
    return (
      <Gate icon={<Trash2 size={26} />} title="This document is in the recycle bin" text="Restore it to open and edit it again. Anyone you shared it with can't open it while it's in the bin.">
        <div className="gate-actions">
          <Link className="btn btn-pill btn-ghost" to="/">My documents</Link>
          <button className="btn btn-pill btn-primary" onClick={() => api.restoreDoc(id).then(load)}><RotateCcw size={16} />Restore</button>
        </div>
      </Gate>
    )
  }
  if (state.code === 'forbidden') {
    return (
      <Gate icon={<ShieldX size={26} />} title="You don't have access" text={`You're signed in as ${user?.email}. Ask the owner to share this document with that address, or switch accounts.`}>
        <div className="gate-actions">
          <button className="btn btn-pill btn-ghost" onClick={logout}>Switch account</button>
          <Link className="btn btn-pill btn-primary" to="/">My documents</Link>
        </div>
      </Gate>
    )
  }
  return (
    <Gate icon={<FileQuestion size={26} />} title="Document not found" text={state.message || 'This link may be wrong or the document was deleted.'}>
      <Link className="btn btn-pill btn-primary" to="/">Go home</Link>
    </Gate>
  )
}

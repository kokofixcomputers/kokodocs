import { useEffect, useState } from 'react'
import { openSettings } from '../ui/settingsStore'
import { Link } from 'react-router-dom'
import { LogIn, Moon, Sun } from 'lucide-react'
import { api, type ApiError, type DocInfo } from '../api'
import { useAuth } from '../auth'
import { useTheme } from '../theme'
import { Avatar } from '../ui/Avatar'
import { Logo } from '../ui/Logo'
import { Popover } from '../ui/Popover'
import { Fill, type SubmitResult } from './Fill'
import type { Answers, PublicForm } from './model'
import './forms.css'

/** What everyone with view access sees: the form itself, ready to fill out. */
export default function FormPage({ info }: { info: DocInfo }) {
  const { user, logout } = useAuth()
  const { theme, toggle } = useTheme()
  const [form, setForm] = useState<(PublicForm & { submitted: boolean }) | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { api.getForm(info.id).then(setForm).catch((e: ApiError) => setErr(e.message)) }, [info.id, user?.id])
  useEffect(() => { document.title = `${form?.title || info.title || 'Form'} - KokoDocs` }, [form?.title, info.title])
  useEffect(() => {
    const changed = () => location.reload()
    window.addEventListener('koko:access-changed', changed)
    return () => window.removeEventListener('koko:access-changed', changed)
  }, [])

  const submit = async (answers: Answers): Promise<SubmitResult> => {
    try { await api.submitForm(info.id, answers); return { ok: true } }
    catch (e) { const a = e as ApiError; return { ok: false, message: a.message, errors: a.detail?.errors } }
  }

  return (
    <div className="fm-public">
      <header className="fm-public-top">
        {user ? <Link to="/" className="logo-link" title="All documents"><Logo size={30} /></Link> : <span className="logo-link"><Logo size={30} /></span>}
        <span className="fm-spacer" />
        <button className="icon-btn" onClick={toggle} aria-label="Toggle theme">{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
        {user ? (
          <Popover align="end" trigger={({ toggle: t }) => <button className="avatar-btn" onClick={t}><Avatar name={user.name} color={user.color} size={34} /></button>}>
            {(close) => (<div className="menu wide"><div className="menu-head"><strong>{user.name}</strong><span>{user.email}</span></div><Link to="/" className="menu-link" onClick={close}>All documents</Link><button onClick={() => { close(); openSettings() }}>Settings</button><button onClick={() => { close(); logout() }}>Sign out</button></div>)}
          </Popover>
        ) : <Link className="btn btn-pill btn-ghost" to="/login" state={{ from: `/d/${info.id}` }}><LogIn size={16} />Sign in</Link>}
      </header>
      <main className="fm-public-body">
        {err ? <p className="form-error">{err}</p> : !form ? <div className="splash small"><span className="spinner" /></div>
          : <Fill form={form} signedIn={!!user} signInTo={`/d/${info.id}`} submitted={form.submitted} onSubmit={submit} uploadFile={(item, f) => api.uploadFormFile(info.id, item, f)} />}
        <p className="fm-foot muted">Made with KokoDocs. Don't enter passwords or card numbers in forms.</p>
      </main>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ChevronRight, FileText, Folder as FolderIcon, FileQuestion, LogIn, Moon, Sun, Table2, Users } from 'lucide-react'
import { api, ApiError, type SharedFolderView } from '../api'
import { useAuth } from '../auth'
import { useTheme } from '../theme'
import { Avatar } from '../ui/Avatar'
import { KindIcon } from '../ui/KindIcon'
import { Logo } from '../ui/Logo'
import { AuthEmbedded } from './AuthPage'
import { Gate } from './EditorPage'

const ago = (t: number) => {
  const s = Date.now() / 1000 - t
  if (s < 60) return 'Just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`
  return new Date(t * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Public page for a folder shared by link: browse its folders and documents without needing an account. */
export function FolderPage() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const { user, loading } = useAuth()
  const { theme, toggle } = useTheme()
  const [view, setView] = useState<SharedFolderView | null>(null)
  const [error, setError] = useState<{ code: string; message: string } | null>(null)
  const [mode, setMode] = useState<'login' | 'signup'>('login')

  useEffect(() => {
    if (loading) return
    setView(null); setError(null)
    api.openSharedFolder(id).then(setView).catch((e: ApiError) => setError({ code: e.code ?? 'error', message: e.message }))
  }, [id, loading, user?.id])

  if (error?.code === 'login_required') {
    return (
      <Gate icon={<LogIn size={26} />} title="Sign in to open this folder" text="The owner restricted this folder to specific people.">
        <AuthEmbedded mode={mode} />
        <p className="switch">
          {mode === 'login' ? <>New here? <a href="#" onClick={(e) => { e.preventDefault(); setMode('signup') }}>Create an account</a></>
            : <>Have an account? <a href="#" onClick={(e) => { e.preventDefault(); setMode('login') }}>Sign in</a></>}
        </p>
      </Gate>
    )
  }
  if (error) {
    return (
      <Gate icon={<FileQuestion size={26} />} title="Folder not found" text="This link may be wrong, or the owner stopped sharing the folder.">
        <Link className="btn btn-pill btn-primary" to="/">Go home</Link>
      </Gate>
    )
  }

  const roleLabel = view?.role === 'viewer' ? 'View only' : view?.role === 'owner' ? 'Owner' : 'Can edit'
  return (
    <div className="dash">
      <header className="dash-top">
        <Link to="/" className="brand"><Logo size={30} /><span>KokoDocs</span></Link>
        <div className="top-actions">
          <button className="icon-btn" onClick={toggle} aria-label="Toggle theme">{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
          {user ? <Link to="/" className="avatar-btn"><Avatar name={user.name} color={user.color} size={34} /></Link>
            : <Link className="btn btn-pill btn-ghost" to="/login" state={{ from: `/f/${id}` }}><LogIn size={16} />Sign in</Link>}
        </div>
      </header>
      <main className="dash-main">
        {!view ? <div className="splash small"><span className="spinner" /></div> : (
          <>
            <nav className="crumbs" aria-label="Folder path">
              <span className="crumb-static"><Users size={15} />Shared by {view.owner}</span>
              {view.trail.map((c) => (
                <span key={c.id} className="crumb-wrap"><ChevronRight size={15} />
                  <button onClick={() => nav(`/f/${c.id}`)}>{c.name}</button>
                </span>
              ))}
              <span className="role-chip">{roleLabel}</span>
            </nav>
            {view.folders.length + view.docs.length === 0 ? (
              <div className="empty"><p><b>This folder is empty</b></p></div>
            ) : (
              <div className="doc-list">
                <div className="doc-row public head"><span>Name</span><span>Modified</span></div>
                {view.folders.map((f) => (
                  <div key={f.id} className="doc-row public" role="link" tabIndex={0} onClick={() => nav(`/f/${f.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/f/${f.id}`)}>
                    <span className="doc-name"><i className="folder"><FolderIcon size={17} /></i><b>{f.name}</b></span>
                    <span className="muted">{ago(f.created_at)}</span>
                  </div>
                ))}
                {view.docs.map((d) => (
                  <div key={d.id} className="doc-row public" role="link" tabIndex={0} onClick={() => nav(`/d/${d.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/d/${d.id}`)}>
                    <span className="doc-name"><i className={`k-${d.kind}`}><KindIcon kind={d.kind} /></i><b>{d.title}</b></span>
                    <span className="muted">{ago(d.updated_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}

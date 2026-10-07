import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { ArrowRight, Menu, Moon, Sun } from 'lucide-react'
import { api } from '../api'
import { useTheme } from '../theme'
import { Logo } from '../ui/Logo'
import { Popover } from '../ui/Popover'
import './marketing.css'

export const useSignup = () => {
  const [signup, setSignup] = useState(true)
  useEffect(() => { api.authConfig().then((c) => setSignup(c.signup_enabled)).catch(() => {}) }, [])
  return signup
}

const LINKS = [{ to: '/features', label: 'Features' }, { to: '/why', label: 'Why KokoDocs' }, { to: '/self-host', label: 'Self-host' }]

export function Cta({ children = 'Create a free account', ghost = true }: { children?: ReactNode; ghost?: boolean }) {
  const signup = useSignup()
  return (
    <div className="home-cta">
      {signup ? <Link to="/signup" className="btn btn-pill btn-primary btn-lg">{children}<ArrowRight size={18} /></Link> : <Link to="/login" className="btn btn-pill btn-primary btn-lg">Sign in<ArrowRight size={18} /></Link>}
      {ghost && <Link to="/features" className="btn btn-pill btn-ghost btn-lg">See every feature</Link>}
    </div>
  )
}

export function MarketingLayout({ children, title = 'KokoDocs: your whole workspace, on your own terms' }: { children: ReactNode; title?: string }) {
  const { theme, toggle } = useTheme()
  const signup = useSignup()
  const { pathname, hash } = useLocation()
  useEffect(() => { document.title = title }, [title])
  useEffect(() => {
    const root = document.querySelector('.home')
    if (hash) { setTimeout(() => document.querySelector(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); return }
    root?.scrollTo({ top: 0 })
  }, [pathname, hash])
  return (
    <div className="home">
      <header className="home-nav">
        <Link to="/" className="brand"><Logo size={30} /><span>KokoDocs</span></Link>
        <nav>
          {LINKS.map((l) => <NavLink key={l.to} to={l.to} className="hide-sm">{l.label}</NavLink>)}
          <Popover align="end" className="mk-menu" trigger={({ toggle: t }) => <button className="icon-btn show-sm" onClick={t} aria-label="Menu"><Menu size={19} /></button>}>
            {(close) => <div className="menu">{LINKS.map((l) => <Link key={l.to} to={l.to} className="menu-link" onClick={close}>{l.label}</Link>)}</div>}
          </Popover>
          <button className="icon-btn" onClick={toggle} aria-label="Toggle theme">{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
          <Link to="/login" className="btn btn-pill btn-ghost">Sign in</Link>
          {signup && <Link to="/signup" className="btn btn-pill btn-primary hide-xs">Get started</Link>}
        </nav>
      </header>
      <main>{children}</main>
      <footer className="mk-foot">
        <div className="mk-foot-in">
          <div className="mk-foot-brand"><span className="brand"><Logo size={24} /><span>KokoDocs</span></span><p>Documents, spreadsheets, slides, forms and wikis, with an assistant that asks before it edits. Runs on your own server.</p></div>
          <div><h4>Product</h4><Link to="/features">Features</Link><Link to="/features#documents">Documents</Link><Link to="/features#spreadsheets">Spreadsheets</Link><Link to="/features#forms">Forms</Link><Link to="/features#wikis">Wikis</Link></div>
          <div><h4>Learn</h4><Link to="/why">Why KokoDocs</Link><Link to="/self-host">Self-host guide</Link><Link to="/features#assistant">The assistant</Link><Link to="/features#security">Security</Link></div>
          <div><h4>Account</h4><Link to="/login">Sign in</Link>{signup && <Link to="/signup">Create an account</Link>}</div>
        </div>
        <div className="mk-foot-end"><span>Private by default. Your documents stay on your server.</span></div>
      </footer>
    </div>
  )
}

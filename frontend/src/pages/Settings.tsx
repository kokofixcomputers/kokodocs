import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronLeft, Circle, FileQuestion, Copy, Lock, LogOut, Monitor, Mic, Moon, Palette, ShieldCheck, Sparkles, Sun, Trash2, User as UserIcon, Bell, HardDrive, X, Keyboard } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api, getToken, type AiSettings, type Storage, type StorageItems } from '../api'
import { KindIcon } from '../ui/KindIcon'
import { fmtBytes, tier } from '../ui/StorageMeter'
import { useAuth } from '../auth'
import { useTheme, type ThemePref } from '../theme'
import { Avatar } from '../ui/Avatar'
import { toast } from '../ui/Toast'
import { AiSettingsBody } from '../assistant/AiSettings'
import { Capture } from '../voice/VoiceControl'
import { DEFAULT_SHORTCUT, loadLive, loadShortcut, shortcutLabel, type Shortcut } from '../voice/useVoiceTyping'
import { closeSettings, subscribeSettings, type SettingsSection } from '../ui/settingsStore'
import { DeleteForm, LinkedAccounts, NotifyRow, PasswordForm, StorageRow } from './SecurityDialog'
import { ZkCard } from '../zk/ZkSettings'

const NAV: { id: SettingsSection; label: string; icon: ReactNode; group: string }[] = [
  { id: 'account', label: 'My account', icon: <UserIcon size={17} />, group: 'User settings' },
  { id: 'security', label: 'Security', icon: <ShieldCheck size={17} />, group: 'User settings' },
  { id: 'notifications', label: 'Notifications', icon: <Bell size={17} />, group: 'User settings' },
  { id: 'storage', label: 'Storage', icon: <HardDrive size={17} />, group: 'User settings' },
  { id: 'appearance', label: 'Appearance', icon: <Palette size={17} />, group: 'App settings' },
  { id: 'assistant', label: 'AI assistant', icon: <Sparkles size={17} />, group: 'App settings' },
  { id: 'voice', label: 'Voice typing', icon: <Mic size={17} />, group: 'App settings' },
]

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="st-section"><h1>{title}</h1>{children}</section>
}
const Card = ({ children }: { children: ReactNode }) => <div className="st-card">{children}</div>

function Account() {
  const { user, acceptToken, logout } = useAuth()
  const [name, setName] = useState(user?.name ?? '')
  const [busy, setBusy] = useState(false)
  const [del, setDel] = useState(false)
  const [totp, setTotp] = useState(false)
  useEffect(() => { api.twofaStatus().then((s) => setTotp(s.enabled)).catch(() => {}) }, [])
  const save = async () => {
    setBusy(true)
    try { await api.setProfile(name); await acceptToken(getToken() ?? ''); toast('Name updated') } catch (e) { toast((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <Section title="My account">
      <Card>
        <div className="st-profile"><Avatar name={user!.name} color={user!.color} size={64} /><div><b>{user!.name}</b><span>{user!.email}</span></div></div>
        <label className="st-field"><span>Display name</span>
          <span className="st-inline"><span className="field"><input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && name !== user?.name && save()} /></span>
            <button className="btn btn-pill btn-primary btn-sm" disabled={busy || !name.trim() || name.trim() === user?.name} onClick={save}>Save</button></span></label>
        <div className="st-row"><div><b>Email</b><span>{user!.email}</span></div></div>
      </Card>
      <Card>
        <div className="st-row"><div><b>Sign out</b><span>Sign out of KokoDocs on this device</span></div>
          <button className="btn btn-pill btn-ghost btn-sm" onClick={() => { closeSettings(); logout() }}><LogOut size={15} />Sign out</button></div>
      </Card>
      <h2 className="st-danger-h">Danger zone</h2>
      <Card>
        {del ? <div className="st-stack"><DeleteForm hasPassword={user?.has_password !== false} totp={totp} onCancel={() => setDel(false)} /></div>
          : <div className="st-row"><div><b>Delete account</b><span>Permanently delete your account and everything in it</span></div>
            <button className="btn btn-pill btn-danger btn-sm" onClick={() => setDel(true)}><Trash2 size={15} />Delete account</button></div>}
      </Card>
    </Section>
  )
}

function Security() {
  const { user } = useAuth()
  const [status, setStatus] = useState<{ enabled: boolean; recovery_left: number } | null>(null)
  const [setup, setSetup] = useState<{ secret: string; uri: string; qr: string } | null>(null)
  const [codes, setCodes] = useState<string[] | null>(null)
  const [pwOpen, setPwOpen] = useState(false)
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const load = () => api.twofaStatus().then(setStatus).catch((e) => setErr(e.message))
  useEffect(() => { void load() }, [])
  const start = async () => {
    setErr(''); setBusy(true)
    try { const s = await api.twofaSetup(); const QR = await import('qrcode'); setSetup({ ...s, qr: await QR.toDataURL(s.uri, { margin: 1, width: 360 }) }) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
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
    <Section title="Security">
      <Card>
        {pwOpen ? <div className="st-stack"><PasswordForm hasPassword={user?.has_password !== false} totp={!!status?.enabled} onDone={() => setPwOpen(false)} /></div>
          : <div className="st-row"><div><b>Password</b><span>{user?.has_password === false ? 'You signed in with a single sign-on provider and have no password yet' : 'Change the password you sign in with'}</span></div>
            <button className="btn btn-pill btn-soft btn-sm" onClick={() => setPwOpen(true)}><Lock size={15} />{user?.has_password === false ? 'Set a password' : 'Change password'}</button></div>}
      </Card>
      <Card><LinkedAccounts /></Card>
      <Card><ZkCard /></Card>
      <Card>
        {!status ? <span className="spinner" /> : codes ? (
          <div className="st-stack">
            <p style={{ margin: 0 }}><b>Two-factor is on.</b> Save these recovery codes somewhere safe. Each works once if you lose your phone. They won't be shown again.</p>
            <div className="sec-codes">{codes.map((c) => <span key={c}>{c}</span>)}</div>
            <div className="st-actions"><button className="btn btn-pill btn-ghost" onClick={() => copy(codes.join('\n'))}>{copied ? <Check size={16} /> : <Copy size={16} />}Copy codes</button><button className="btn btn-pill btn-primary" onClick={() => setCodes(null)}>Done</button></div>
          </div>
        ) : setup ? (
          <div className="st-stack">
            <p className="muted" style={{ margin: 0 }}>Scan this with an authenticator app (Google Authenticator, 1Password, Authy), or type the key in by hand.</p>
            <div className="sec-qr"><img src={setup.qr} alt="Two-factor QR code" />
              <div className="sec-secret"><span>{setup.secret.match(/.{1,4}/g)?.join(' ')}</span><button className="icon-btn sm" aria-label="Copy key" onClick={() => copy(setup.secret)}>{copied ? <Check size={15} /> : <Copy size={15} />}</button></div></div>
            <label className="field"><ShieldCheck size={18} /><input autoFocus inputMode="numeric" placeholder="6-digit code from the app" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && enable()} /></label>
            {err && <p className="form-error">{err}</p>}
            <div className="st-actions"><button className="btn btn-pill btn-ghost" onClick={() => { setSetup(null); setErr('') }}>Cancel</button><button className="btn btn-pill btn-primary" disabled={busy || code.length < 6} onClick={enable}>Turn on</button></div>
          </div>
        ) : status.enabled ? (
          <div className="st-stack">
            <div className="st-row" style={{ padding: 0 }}><div><b>Two-factor authentication is on</b><span>{status.recovery_left} recovery code{status.recovery_left === 1 ? '' : 's'} left</span></div></div>
            <label className="field"><ShieldCheck size={18} /><input inputMode="numeric" placeholder="Enter a code to turn it off" value={code} onChange={(e) => setCode(e.target.value)} /></label>
            {err && <p className="form-error">{err}</p>}
            <div className="st-actions"><button className="btn btn-pill btn-ghost" disabled={busy || !code} onClick={disable}>Turn off</button></div>
          </div>
        ) : (
          <div className="st-row"><div><b>Two-factor authentication</b><span>Add a second step to signing in with a code from an authenticator app</span>{err && <span className="form-error">{err}</span>}</div>
            <button className="btn btn-pill btn-primary btn-sm" disabled={busy} onClick={start}>Set up</button></div>
        )}
      </Card>
    </Section>
  )
}

function Appearance() {
  const { pref, theme, setPref } = useTheme()
  const opts: { v: ThemePref; label: string; hint: string; icon: ReactNode }[] = [
    { v: 'system', label: 'System', hint: 'Follows your device', icon: <Monitor size={18} /> },
    { v: 'light', label: 'Light', hint: 'Always light', icon: <Sun size={18} /> },
    { v: 'dark', label: 'Dark', hint: 'Always dark', icon: <Moon size={18} /> },
  ]
  return (
    <Section title="Appearance">
      <Card>
        <b className="st-label">Theme</b>
        <div className="st-themes">
          {opts.map((o) => (
            <button key={o.v} className={`st-theme ${pref === o.v ? 'on' : ''}`} data-preview={o.v} onClick={() => setPref(o.v)} aria-pressed={pref === o.v}>
              <span className={`st-swatch ${o.v === 'system' ? 'sys' : ''}`}><i /><i /><i /></span>
              <span className="st-theme-name">{o.icon}{o.label}{pref === o.v && <Check size={15} />}</span>
              <span className="st-theme-hint">{o.v === 'system' ? `${o.hint} (now ${theme})` : o.hint}</span>
            </button>))}
        </div>
      </Card>
      <Card>
        <div className="st-row"><div><b>Keyboard shortcuts</b><span>See every shortcut for documents, sheets, slides and forms</span></div>
          <button className="btn btn-pill btn-soft btn-sm" onClick={() => { closeSettings(); setTimeout(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true })), 50) }}><Keyboard size={15} />Show shortcuts</button></div>
      </Card>
    </Section>
  )
}

function Assistant() {
  const [s, setS] = useState<AiSettings | null>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => { api.aiSettings().then(setS).catch(() => {}).finally(() => setReady(true)) }, [])
  return (
    <Section title="AI assistant">
      <Card>{ready ? <AiSettingsBody settings={s} onSaved={setS} onClose={() => {}} /> : <span className="spinner" />}</Card>
    </Section>
  )
}

function Voice() {
  const [sc, setSc] = useState<Shortcut>(loadShortcut)
  const [cap, setCap] = useState(false)
  const [live, setLive] = useState(loadLive)
  const [canLive, setCanLive] = useState(false)
  useEffect(() => { api.sttStatus().then((s) => setCanLive(!!s.draft)).catch(() => {}) }, [])
  const toggleLive = (v: boolean) => { setLive(v); try { localStorage.setItem('koko.voiceLive', v ? 'on' : 'off') } catch { /* ignore */ } toast(v ? 'Live words are on. They apply the next time you open a document' : 'Live words are off. They apply the next time you open a document') }
  const save = (s: Shortcut) => { setSc(s); try { localStorage.setItem('koko.voiceShortcut', JSON.stringify(s)) } catch { /* ignore */ } setCap(false); toast('Shortcut saved. It applies the next time you open a document') }
  return (
    <Section title="Voice typing">
      <Card>
        {cap ? <Capture onDone={save} onCancel={() => setCap(false)} /> : (
          <div className="st-row"><div><b>Push-to-talk key</b><span>Hold <kbd>{shortcutLabel(sc)}</kbd>, speak, then let go to type what you said</span></div>
            <span className="st-btns">
              {shortcutLabel(sc) !== shortcutLabel(DEFAULT_SHORTCUT) && <button className="btn btn-pill btn-ghost btn-sm" onClick={() => save(DEFAULT_SHORTCUT)}>Reset</button>}
              <button className="btn btn-pill btn-soft btn-sm" onClick={() => setCap(true)}>Change</button></span></div>)}
        {canLive && <div className="st-row"><div><b>Show words while I speak</b><span>A quick preview in the pill as you talk. What gets typed is still the more accurate final version.</span></div>
          <span className="st-btns"><button type="button" role="switch" aria-checked={live} aria-label="Show words while I speak" className={`toggle ${live ? 'on' : ''}`} onClick={() => toggleLive(!live)} /></span></div>}
      </Card>
      <p className="muted hint">On phones, use the microphone button that floats in the editor.</p>
    </Section>
  )
}

const BODY: Record<SettingsSection, () => ReactNode> = {
  account: () => <Account />,
  security: () => <Security />,
  notifications: () => <Section title="Notifications"><Card><NotifyRow /><NotifyHint /></Card></Section>,
  storage: () => <StorageSection />,
  appearance: () => <Appearance />,
  assistant: () => <Assistant />,
  voice: () => <Voice />,
}
const PARTS = [
  { key: 'text', label: 'Text and data', hint: 'What you typed, cells, slides and settings' },
  { key: 'images', label: 'Images', hint: 'Pictures added to files' },
  { key: 'files', label: 'Form uploads', hint: 'Files people attached to forms' },
  { key: 'versions', label: 'Version history', hint: 'Saved earlier versions' },
  { key: 'recordings', label: 'Meeting recordings', hint: 'Meetings you recorded' },
] as const
type PartKey = (typeof PARTS)[number]['key']

/** A bar split into the colours of what is inside; widths are relative to `scale` bytes (the whole bar). */
function Segments({ parts, scale, tall }: { parts: Record<PartKey, number>; scale: number; tall?: boolean }) {
  return (
    <div className={`sg-bar ${tall ? 'tall' : ''}`} role="img" aria-label={PARTS.map((p) => `${p.label} ${fmtBytes(parts[p.key])}`).join(', ')}>
      {PARTS.map((p) => parts[p.key] > 0 && <i key={p.key} className={`sg-${p.key}`} style={{ width: `${(parts[p.key] / Math.max(1, scale)) * 100}%` }} title={`${p.label}: ${fmtBytes(parts[p.key])}`} />)}
    </div>
  )
}

function StorageSection() {
  const [st, setSt] = useState<Storage | null>(null)
  const [list, setList] = useState<StorageItems | null>(null)
  const [err, setErr] = useState('')
  const [showTrashed, setShowTrashed] = useState(true)
  useEffect(() => { api.myStorage().then(setSt).catch(() => {}); api.myStorageItems().then(setList).catch((e) => setErr(e.message)) }, [])
  if (!st) return <Section title="Storage"><span className="spinner" /></Section>
  const parts: Record<PartKey, number> = { text: st.documents, images: st.images, files: st.files ?? 0, versions: st.versions, recordings: st.recordings ?? 0 }
  const scale = st.limit || st.used || 1
  const free = st.limit ? Math.max(0, st.limit - st.used) : 0
  const items = (list?.items ?? []).filter((i) => showTrashed || !i.trashed)
  const biggest = Math.max(1, ...items.map((i) => i.total))
  const trashedBytes = (list?.items ?? []).filter((i) => i.trashed).reduce((n, i) => n + i.total, 0)
  return (
    <Section title="Storage">
      <Card>
        <div className="st-row"><div><b>{fmtBytes(st.used)} {st.limit ? `of ${fmtBytes(st.limit)} used` : 'used (no limit)'}</b><span>{st.limit ? `${fmtBytes(free)} free` : 'Your account has no storage limit'}</span></div></div>
        <div className={st.limit ? `sg-frame ${tier(st.used, st.limit)}` : 'sg-frame'}><Segments parts={parts} scale={scale} tall /></div>
        <div className="sg-legend">
          {PARTS.map((p) => (
            <div key={p.key} title={p.hint}><i className={`sg-dot sg-${p.key}`} /><span>{p.label}</span><b>{fmtBytes(parts[p.key])}</b></div>))}
          {st.limit > 0 && <div><i className="sg-dot sg-free" /><span>Free</span><b>{fmtBytes(free)}</b></div>}
        </div>
        <p className="muted hint" style={{ margin: 0 }}>Counts what you own. Files shared with you count against their owner.</p>
      </Card>

      <Card>
        <div className="st-row"><div><b>By file</b><span>{list ? `${list.items.length} ${list.items.length === 1 ? 'file' : 'files'}, largest first` : 'Loading'}</span></div>
          {trashedBytes > 0 && <label className="sg-check"><input type="checkbox" checked={showTrashed} onChange={(e) => setShowTrashed(e.target.checked)} />Show bin ({fmtBytes(trashedBytes)})</label>}</div>
        {err && <p className="form-error">{err}</p>}
        {!list && !err && <span className="spinner" />}
        <div className="sg-list">
          {items.map((i) => {
            const p: Record<PartKey, number> = { text: i.text, images: i.images, files: i.files, versions: i.versions, recordings: 0 }
            const row = (
              <>
                <span className="sg-top"><KindIcon kind={i.kind} size={16} /><span className="sg-title">{i.title || 'Untitled'}</span>{i.trashed && <em className="sg-tag">In bin</em>}<b>{fmtBytes(i.total)}</b></span>
                <Segments parts={p} scale={biggest} />
                <span className="sg-detail">{PARTS.filter((x) => p[x.key] > 0).map((x) => <span key={x.key}><i className={`sg-dot sg-${x.key}`} />{x.label} {fmtBytes(p[x.key])}</span>)}</span>
              </>)
            return i.trashed ? <div key={i.id} className="sg-item">{row}</div> : <Link key={i.id} to={`/d/${i.id}`} className="sg-item link" onClick={closeSettings}>{row}</Link>
          })}
          {list && list.unattached_images > 0 && (
            <div className="sg-item">
              <span className="sg-top"><FileQuestion size={16} /><span className="sg-title">Pictures not in any file</span><b>{fmtBytes(list.unattached_images)}</b></span>
              <Segments parts={{ text: 0, images: list.unattached_images, files: 0, versions: 0, recordings: 0 }} scale={biggest} />
              <span className="sg-detail"><span><i className="sg-dot sg-images" />Images {fmtBytes(list.unattached_images)}</span></span>
            </div>)}
          {list && (list.recordings ?? 0) > 0 && (
            <Link to="/meetings#recordings" className="sg-item link" onClick={closeSettings}>
              <span className="sg-top"><Circle size={16} /><span className="sg-title">Meeting recordings ({list.recording_count})</span><b>{fmtBytes(list.recordings ?? 0)}</b></span>
              <Segments parts={{ text: 0, images: 0, files: 0, versions: 0, recordings: list.recordings ?? 0 }} scale={biggest} />
            </Link>)}
          {list && !items.length && !list.unattached_images && !(list.recordings ?? 0) && <p className="muted" style={{ margin: 0 }}>You don’t have any files yet.</p>}
        </div>
      </Card>
    </Section>
  )
}

function NotifyHint() {
  const [email, setEmail] = useState<boolean | null>(null)
  useEffect(() => { api.authConfig().then((c) => setEmail(c.email)).catch(() => setEmail(false)) }, [])
  return email === false ? <p className="muted" style={{ margin: 0 }}>Email isn't set up on this server, so you only get notifications inside KokoDocs.</p> : null
}

export function SettingsHost() {
  const { user } = useAuth()
  const [sec, setSec] = useState<SettingsSection | null>(null)
  const [mobileList, setMobileList] = useState(true)
  useEffect(() => subscribeSettings((s) => { setSec(s); setMobileList(true) }), [])
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === ',' && user) { e.preventDefault(); setSec((s) => (s ? null : 'account')); setMobileList(true) } }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [user])
  useEffect(() => {
    if (!sec) return
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.modal-backdrop, .popover, .ctx-menu')) return
      if (document.activeElement instanceof HTMLInputElement && document.activeElement.closest('.vc-capture')) return
      closeSettings()
    }
    window.addEventListener('keydown', k)
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prev }
  }, [sec])
  if (!sec || !user) return null
  const groups = [...new Set(NAV.map((n) => n.group))]
  const cur = NAV.find((n) => n.id === sec)!
  return createPortal(
    <div className={`st-overlay ${mobileList ? 'list' : 'detail'}`} role="dialog" aria-label="Settings">
      <nav className="st-side" aria-label="Settings sections">
        <div className="st-side-inner">
          <div className="st-who"><Avatar name={user.name} color={user.color} size={32} /><div><b>{user.name}</b><span>{user.email}</span></div>
            <button className="icon-btn st-x-m" onClick={closeSettings} aria-label="Close settings"><X size={18} /></button></div>
          {groups.map((g) => (
            <div key={g} className="st-group"><h3>{g}</h3>
              {NAV.filter((n) => n.group === g).map((n) => (
                <button key={n.id} className={`st-nav ${sec === n.id ? 'on' : ''}`} onClick={() => { setSec(n.id); setMobileList(false) }}>{n.icon}{n.label}</button>))}</div>))}
          <div className="st-group">
            {user.is_admin && <Link className="st-nav" to="/admin" onClick={closeSettings}><ShieldCheck size={17} />Admin panel</Link>}
          </div>
        </div>
      </nav>
      <main className="st-main">
        <div className="st-main-inner">
          <button className="st-back" onClick={() => setMobileList(true)}><ChevronLeft size={18} />Settings</button>
          {BODY[sec]()}
        </div>
        <div className="st-close"><button className="st-x" onClick={closeSettings} aria-label="Close settings"><X size={20} /></button><span>ESC</span></div>
      </main>
    </div>, document.body)
}

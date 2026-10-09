import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, Copy, Infinity as Forever, KeyRound, Lock, Plus, Settings2, ShieldCheck, SlidersHorizontal, Star, Trash2, UserPlus, Video, X } from 'lucide-react'
import { api, type MeetInfo, type MeetSettings } from '../api'
import { askConfirm } from '../ui/Dialogs'
import { toast } from '../ui/Toast'
import { AccessSettings, DEFAULT_SETTINGS, InMeetingSettings } from './SettingsForm'
import { inviteText } from './util'
import './meet.css'

type Section = 'general' | 'access' | 'cohosts' | 'meeting' | 'danger'
const SECTIONS: { id: Section; label: string; icon: React.ReactNode; blurb: string }[] = [
  { id: 'general', label: 'General', icon: <Settings2 size={17} />, blurb: 'The name, the link, and whether the meeting stays on your account.' },
  { id: 'access', label: 'Who gets in', icon: <ShieldCheck size={17} />, blurb: 'Approval, passcode, guests and how many people.' },
  { id: 'cohosts', label: 'Co-hosts', icon: <Star size={17} />, blurb: 'People who help run the meeting, even before you arrive.' },
  { id: 'meeting', label: 'In the meeting', icon: <SlidersHorizontal size={17} />, blurb: 'What people start with and what they can do.' },
  { id: 'danger', label: 'End or delete', icon: <Trash2 size={17} />, blurb: 'Close the running session, or remove the meeting.' },
]

const suggest = () => { const a = 'abcdefghjkmnpqrstuvwxyz23456789'; return Array.from({ length: 6 }, () => a[Math.floor(Math.random() * a.length)]).join('') }

interface Draft { title: string; permanent: boolean; passcode: string; settings: MeetSettings; cohosts: string[] }
const fromMeeting = (m: MeetInfo | null): Draft => ({
  title: m?.title ?? '', permanent: m ? m.permanent : true, passcode: m?.passcode ?? '', settings: m?.settings ?? DEFAULT_SETTINGS, cohosts: (m?.cohosts ?? []).map((c) => c.email),
})

/** A meeting's settings as a full page: a navbar of sections, and a bar that saves everything at once. The same page creates a new meeting. */
export function MeetingSettingsPage() {
  const { code = '' } = useParams()
  const isNew = code === 'new'
  const nav = useNavigate()
  const loc = useLocation()
  const [meeting, setMeeting] = useState<MeetInfo | null>(null)
  const [missing, setMissing] = useState(false)
  const [d, setD] = useState<Draft>(fromMeeting(null))
  const [saved, setSaved] = useState<Draft>(fromMeeting(null))
  const [cfg, setCfg] = useState({ guests: true, captions: true, enabled: true })
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')
  const section = (SECTIONS.find((s) => loc.hash === `#${s.id}`)?.id ?? 'general') as Section
  const names = useRef(new Map<string, string>())

  const load = useCallback(() => {
    if (isNew) { const x = fromMeeting(null); setD(x); setSaved(x); return }
    api.meetMine().then((l) => {
      const m = l.find((x) => x.code === code) ?? null
      if (!m || m.role === 'cohost') { setMissing(true); setMeeting(m); return }
      names.current = new Map((m.cohosts ?? []).map((c) => [c.email, c.name]))
      setMeeting(m); const x = fromMeeting(m); setD(x); setSaved(x)
    }).catch(() => setMissing(true))
  }, [code, isNew])
  useEffect(() => { load(); void api.meetConfig().then((c) => setCfg({ guests: c.guests, captions: c.captions, enabled: c.enabled })).catch(() => {}) }, [load])
  useEffect(() => { document.title = isNew ? 'New meeting' : meeting ? `${meeting.title} · Settings` : 'Meeting settings' }, [isNew, meeting])

  const dirty = useMemo(() => JSON.stringify(d) !== JSON.stringify(saved), [d, saved])
  useEffect(() => {
    if (!dirty) return
    const f = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', f)
    return () => window.removeEventListener('beforeunload', f)
  }, [dirty])

  const go = (s: Section) => nav({ hash: `#${s}` }, { replace: true })
  const patch = (p: Partial<MeetSettings>) => setD((x) => ({ ...x, settings: { ...x.settings, ...p } }))
  const back = async () => { if (dirty && !(await askConfirm({ title: 'Leave without saving?', text: 'Your changes to this meeting will be lost.', label: 'Leave', danger: true }))) return; nav('/meetings') }

  const save = async () => {
    setBusy(true); setError('')
    try {
      if (isNew) {
        const m = await api.meetCreate({ title: d.title, permanent: d.permanent, passcode: d.passcode, settings: d.settings, cohosts: d.cohosts })
        toast('Meeting created'); nav(`/meetings/${m.code}`, { replace: true }); setSaved(d)
      } else {
        await api.meetEdit(code, { title: d.title.trim() || meeting?.title, permanent: d.permanent, passcode: d.passcode, settings: d.settings, cohosts: d.cohosts })
        toast('Saved'); load()
      }
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  const addCohost = () => {
    const e = email.trim().toLowerCase()
    if (!e) return
    if (!/^\S+@\S+\.\S+$/.test(e)) { setError('Enter the email of their KokoDocs account.'); return }
    if (d.cohosts.includes(e)) { setEmail(''); return }
    setError(''); setD({ ...d, cohosts: [...d.cohosts, e] }); setEmail('')
  }
  const copy = async (what: 'link' | 'invite') => {
    const link = `${location.origin}/m/${code}`
    try { await navigator.clipboard.writeText(what === 'link' ? link : inviteText(d.title || meeting?.title || 'Meeting', code, d.passcode)); setCopied(what); setTimeout(() => setCopied(''), 1600) } catch { toast(link) }
  }
  const endSession = async () => {
    if (!(await askConfirm({ title: 'End the session?', text: d.permanent ? 'Everyone in it is disconnected. The meeting stays, ready for next time.' : 'Everyone is disconnected and the link stops working.', label: 'End', danger: true }))) return
    try { await api.meetEnd(code); toast('Session ended'); load(); if (!d.permanent) nav('/meetings') } catch (e) { toast((e as Error).message) }
  }
  const remove = async () => {
    if (!(await askConfirm({ title: `Delete "${meeting?.title}"?`, text: 'The link stops working for good and anyone in it is disconnected.', label: 'Delete', danger: true }))) return
    try { await api.meetDelete(code); nav('/meetings') } catch (e) { toast((e as Error).message) }
  }

  if (missing) {
    return <div className="meet-shell"><div className="meet-card rise"><h1>{meeting ? 'Only the host can change this' : "Can't find this meeting"}</h1>
      <p className="muted">{meeting ? `${meeting.host_name} made you a co-host: you can start it and let people in, but its settings are theirs.` : 'It may have been deleted, or it belongs to someone else.'}</p>
      <div className="meet-actions"><Link className="btn btn-primary btn-pill" to="/meetings">Back to meetings</Link></div></div></div>
  }
  if (!isNew && !meeting) return <div className="meet-shell"><span className="spinner" /></div>

  const cur = SECTIONS.find((s) => s.id === section)!
  const shown = isNew ? SECTIONS.filter((s) => s.id !== 'danger') : SECTIONS
  return (
    <div className="ms">
      <header className="ms-top">
        <button className="btn btn-ghost btn-pill btn-sm" onClick={back}><ArrowLeft size={15} />Meetings</button>
        <div className="ms-title"><h1>{isNew ? 'New meeting' : d.title || meeting?.title}</h1>{!isNew && <code>{code}</code>}</div>
        {dirty && <span className="ms-dirty">Unsaved changes</span>}
        {dirty && !isNew && <button className="btn btn-ghost btn-pill btn-sm" onClick={() => setD(saved)}>Discard</button>}
        {!isNew && <button className="btn btn-soft btn-pill btn-sm" onClick={() => nav(`/m/${code}`)}><Video size={15} />{meeting && meeting.live ? 'Join' : 'Start'}</button>}
        <button className="btn btn-primary btn-pill" disabled={busy || (!dirty && !isNew) || !cfg.enabled} onClick={save}>{busy ? <span className="spinner sm" /> : isNew ? 'Create meeting' : 'Save changes'}</button>
      </header>
      <div className="ms-body">
        <nav className="ms-nav" aria-label="Settings sections">
          {shown.map((s) => (
            <button key={s.id} className={section === s.id ? 'on' : ''} onClick={() => go(s.id)} aria-current={section === s.id}>
              {s.icon}<span>{s.label}</span>{s.id === 'cohosts' && d.cohosts.length > 0 && <i>{d.cohosts.length}</i>}
            </button>))}
        </nav>
        <main className="ms-main">
          <div className="ms-head"><h2>{cur.label}</h2><p className="muted">{cur.blurb}</p></div>
          {error && <p className="form-error">{error}</p>}
          {!cfg.enabled && <p className="form-error">Meetings are turned off on this server.</p>}

          {section === 'general' && (
            <div className="ms-card">
              <label className="meet-name"><span>Name</span><span className="field"><input value={d.title} maxLength={100} placeholder="Team sync" autoFocus={isNew} onChange={(e) => setD({ ...d, title: e.target.value })} /></span></label>
              <div className="switch-row"><div><b>Keep this meeting</b><span>Permanent: it stays on your account with the same link, passcode and settings. Ending it only closes the session that is running. Off: it ends for good when you end it, or after a week unused.</span></div>
                <button role="switch" aria-checked={d.permanent} aria-label="Keep this meeting" className={`toggle ${d.permanent ? 'on' : ''}`} onClick={() => setD({ ...d, permanent: !d.permanent })} /></div>
              {!isNew && (
                <div className="ms-link">
                  <span className="muted small">Link</span>
                  <div className="row"><code>{location.origin}/m/{code}</code>
                    <button className="btn btn-soft btn-pill btn-sm" onClick={() => copy('link')}>{copied === 'link' ? <Check size={15} /> : <Copy size={15} />}Copy link</button>
                    <button className="btn btn-ghost btn-pill btn-sm" onClick={() => copy('invite')}>{copied === 'invite' ? <Check size={15} /> : <Copy size={15} />}Copy invite{d.passcode ? ' with passcode' : ''}</button></div>
                </div>)}
            </div>)}

          {section === 'access' && (
            <div className="ms-card">
              <AccessSettings s={d.settings} onChange={patch} guestsAllowed={cfg.guests} captionsAvailable={cfg.captions} />
              <label className="meet-name"><span>Passcode</span>
                <span className="field"><KeyRound size={16} /><input value={d.passcode} maxLength={32} placeholder="No passcode" autoComplete="off" onChange={(e) => setD({ ...d, passcode: e.target.value })} />
                  {d.passcode && <button type="button" className="icon-btn sm" aria-label="Remove the passcode" onClick={() => setD({ ...d, passcode: '' })}><X size={14} /></button>}
                  <button type="button" className="btn btn-soft btn-sm" onClick={() => setD({ ...d, passcode: suggest() })}>Make one</button></span>
                <span className="muted small">Everyone except you must enter it to join. 4 to 32 characters.</span></label>
            </div>)}

          {section === 'cohosts' && (
            <div className="ms-card">
              <p className="muted">A co-host can let people in, mute, remove, spotlight, lock the room, run polls and start captions. Pre-set co-hosts are co-host the moment they arrive signed in, even before you, so they can open the meeting and let people in. You can also make someone co-host during a meeting from the People list.</p>
              <form className="ms-add" onSubmit={(e) => { e.preventDefault(); addCohost() }}>
                <span className="field"><UserPlus size={16} /><input type="email" value={email} placeholder="Their KokoDocs account email" aria-label="Co-host email" autoComplete="off" onChange={(e) => setEmail(e.target.value)} /></span>
                <button className="btn btn-primary btn-pill" disabled={!email.trim()}><Plus size={16} />Add</button>
              </form>
              {d.cohosts.length === 0 ? <p className="muted small">No pre-set co-hosts. Guests can't be pre-set, because they have no account to recognise them by.</p> : (
                <ul className="ms-people">
                  {d.cohosts.map((e) => (
                    <li key={e}><span className="meet-avatar sm" style={{ '--h': [...e].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0) } as React.CSSProperties}>{(names.current.get(e) ?? e)[0]?.toUpperCase()}</span>
                      <span className="who"><b>{names.current.get(e) ?? e.split('@')[0]}</b><small>{e}</small></span>
                      {!saved.cohosts.includes(e) && <i className="tag">not saved yet</i>}
                      <button className="icon-btn sm" aria-label={`Remove ${e}`} onClick={() => setD({ ...d, cohosts: d.cohosts.filter((x) => x !== e) })}><X size={16} /></button></li>))}
                </ul>)}
            </div>)}

          {section === 'meeting' && <div className="ms-card meet-settings"><InMeetingSettings s={d.settings} onChange={patch} guestsAllowed={cfg.guests} captionsAvailable={cfg.captions} /></div>}

          {section === 'danger' && meeting && (
            <div className="ms-card">
              <div className="switch-row"><div><b>End the current session</b><span>{meeting.live > 0 ? `${meeting.live} ${meeting.live === 1 ? 'person is' : 'people are'} in it now.` : 'Nobody is in it right now.'} {d.permanent ? 'The meeting stays, ready for next time.' : 'The link stops working.'}</span></div>
                <button className="btn btn-soft btn-pill btn-sm" disabled={meeting.live === 0 && d.permanent} onClick={endSession}>End session</button></div>
              <div className="switch-row"><div><b>Delete this meeting</b><span>The link stops working for good. This can't be undone.</span></div>
                <button className="btn btn-danger btn-pill btn-sm" onClick={remove}><Trash2 size={15} />Delete</button></div>
            </div>)}
          {isNew && section !== 'danger' && <p className="muted small ms-foot">{d.permanent ? <><Forever size={13} /> This meeting will be kept on your account.</> : <><Lock size={13} /> This meeting ends when you end it.</>}</p>}
        </main>
      </div>
    </div>)
}

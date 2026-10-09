import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, Copy, Infinity as Forever, KeyRound, Lock, MoreHorizontal, Pencil, Plus, Trash2, Video } from 'lucide-react'
import { api, type MeetInfo, type MeetSettings } from '../api'
import { Modal } from '../ui/Modal'
import { Popover } from '../ui/Popover'
import { askConfirm } from '../ui/Dialogs'
import { toast } from '../ui/Toast'
import { DEFAULT_SETTINGS, SettingsForm } from './SettingsForm'
import { inviteText } from './util'
import './meet.css'

const passcodeSuggestion = () => { const a = 'abcdefghjkmnpqrstuvwxyz23456789'; return Array.from({ length: 6 }, () => a[Math.floor(Math.random() * a.length)]).join('') }

/** Create a meeting or change one: its name, whether it stays on your account, a passcode, and every setting. */
function MeetingDialog({ meeting, onClose, onSaved }: { meeting: MeetInfo | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(meeting?.title ?? '')
  const [permanent, setPermanent] = useState(meeting ? meeting.permanent : true)
  const [passcode, setPasscode] = useState(meeting?.passcode ?? '')
  const [settings, setSettings] = useState<MeetSettings>(meeting?.settings ?? DEFAULT_SETTINGS)
  const [cfg, setCfg] = useState({ guests: true, captions: true })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { void api.meetConfig().then(setCfg).catch(() => {}) }, [])
  const save = async () => {
    setBusy(true); setError('')
    try {
      if (meeting) await api.meetEdit(meeting.code, { title: title.trim() || meeting.title, permanent, passcode, settings })
      else await api.meetCreate({ title, permanent, passcode, settings })
      onSaved(); onClose()
    } catch (e) { setError((e as Error).message); setBusy(false) }
  }
  return (
    <Modal title={meeting ? 'Meeting settings' : 'New meeting'} onClose={onClose} width={540}>
      <div className="share-body">
        <label className="meet-name"><span>Name</span><span className="field"><input value={title} maxLength={100} placeholder="Team sync" autoFocus={!meeting} onChange={(e) => setTitle(e.target.value)} /></span></label>
        <div className="switch-row"><div><b>Keep this meeting</b><span>Permanent: it stays on your account with the same link and settings. Ending it only closes the session that is running. Off: it ends when you end it.</span></div>
          <button role="switch" aria-checked={permanent} aria-label="Keep this meeting" className={`toggle ${permanent ? 'on' : ''}`} onClick={() => setPermanent(!permanent)} /></div>
        <label className="meet-name"><span>Passcode (optional)</span>
          <span className="field"><KeyRound size={16} /><input value={passcode} maxLength={32} placeholder="No passcode" autoComplete="off" onChange={(e) => setPasscode(e.target.value)} />
            <button type="button" className="btn btn-soft btn-sm" onClick={() => setPasscode(passcodeSuggestion())}>Make one</button></span>
          <span className="muted small">People who aren't you must enter it to join. 4 to 32 characters.</span></label>
        <SettingsForm s={settings} onChange={(p) => setSettings({ ...settings, ...p })} guestsAllowed={cfg.guests} captionsAvailable={cfg.captions} />
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions"><button className="btn btn-pill btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-pill btn-primary" disabled={busy} onClick={save}>{busy ? <span className="spinner sm" /> : meeting ? 'Save' : 'Create'}</button></div>
      </div>
    </Modal>)
}

function Card({ m, onEdit, onChanged }: { m: MeetInfo; onEdit: () => void; onChanged: () => void }) {
  const nav = useNavigate()
  const [copied, setCopied] = useState(false)
  const copy = async () => { try { await navigator.clipboard.writeText(inviteText(m.title, m.code, m.passcode)); setCopied(true); setTimeout(() => setCopied(false), 1600) } catch { toast(`${location.origin}/m/${m.code}`) } }
  const remove = async () => {
    if (!(await askConfirm({ title: `Delete "${m.title}"?`, text: 'The link stops working for good and anyone in it is disconnected.', label: 'Delete', danger: true }))) return
    try { await api.meetDelete(m.code); onChanged() } catch (e) { toast((e as Error).message) }
  }
  const endSession = async () => {
    if (!(await askConfirm({ title: 'End the session?', text: m.permanent ? 'Everyone is disconnected. The meeting stays, ready for next time.' : 'Everyone is disconnected and the link stops working.', label: 'End', danger: true }))) return
    try { await api.meetEnd(m.code); onChanged() } catch (e) { toast((e as Error).message) }
  }
  const s = m.settings
  return (
    <div className="meet-item">
      <div className="head">
        <span className="ic">{m.permanent ? <Forever size={18} /> : <Video size={18} />}</span>
        <div className="txt"><b>{m.title}</b><code>{m.code}</code></div>
        {m.live > 0 && <span className="live"><i />{m.live} in it</span>}
      </div>
      <div className="tags">
        <span>{m.permanent ? 'Permanent' : 'One-time'}</span>
        {m.has_passcode && <span><Lock size={12} />Passcode</span>}
        {s?.approval && <span>Approval</span>}
        {s?.host_first && <span>Host first</span>}
        {s && !s.guests && <span>Signed-in only</span>}
        {s && s.chat !== 'all' && <span>Chat: {s.chat === 'off' ? 'off' : 'host'}</span>}
      </div>
      <div className="acts">
        <button className="btn btn-primary btn-pill btn-sm" onClick={() => nav(`/m/${m.code}`)}><Video size={15} />{m.live ? 'Join' : 'Start'}</button>
        <button className="btn btn-soft btn-pill btn-sm" onClick={copy}>{copied ? <Check size={15} /> : <Copy size={15} />}Copy invite</button>
        <button className="btn btn-ghost btn-pill btn-sm" onClick={onEdit}><Pencil size={15} />Settings</button>
        <Popover align="end" trigger={({ toggle }) => <button className="icon-btn sm" onClick={toggle} aria-label="More"><MoreHorizontal size={17} /></button>}>
          {(close) => (
            <div className="menu">
              {m.live > 0 && <button onClick={() => { close(); void endSession() }}>End the session</button>}
              <button className="danger" onClick={() => { close(); void remove() }}><Trash2 size={16} />Delete</button>
            </div>)}
        </Popover>
      </div>
    </div>)
}

export function MeetingsPage() {
  const [list, setList] = useState<MeetInfo[] | null>(null)
  const [edit, setEdit] = useState<MeetInfo | 'new' | null>(null)
  const [on, setOn] = useState(true)
  const load = useCallback(() => { api.meetMine().then(setList).catch(() => setList([])) }, [])
  useEffect(() => { load(); void api.meetConfig().then((c) => setOn(c.enabled)); const t = setInterval(load, 10000); return () => clearInterval(t) }, [load])
  useEffect(() => { document.title = 'Meetings' }, [])
  const kept = (list ?? []).filter((m) => m.permanent), once = (list ?? []).filter((m) => !m.permanent)
  return (
    <div className="meet-manage">
      <header className="top">
        <Link to="/" className="btn btn-ghost btn-pill btn-sm"><ArrowLeft size={15} />Documents</Link>
        <h1>Meetings</h1>
        <button className="btn btn-primary btn-pill" onClick={() => setEdit('new')} disabled={!on}><Plus size={17} />New meeting</button>
      </header>
      <main>
        {!on && <p className="form-error">Meetings are turned off on this server.</p>}
        {list === null ? <span className="spinner" /> : list.length === 0 ? (
          <div className="meet-empty"><Video size={34} /><h3>No meetings yet</h3><p className="muted">Make a permanent meeting for the people you meet with often: it keeps its link and settings, and you can end it whenever you like.</p>
            <button className="btn btn-primary btn-pill" onClick={() => setEdit('new')} disabled={!on}><Plus size={17} />New meeting</button></div>
        ) : (<>
          {kept.length > 0 && <section><h2>Permanent</h2><div className="grid">{kept.map((m) => <Card key={m.code} m={m} onEdit={() => setEdit(m)} onChanged={load} />)}</div></section>}
          {once.length > 0 && <section><h2>One-time</h2><div className="grid">{once.map((m) => <Card key={m.code} m={m} onEdit={() => setEdit(m)} onChanged={load} />)}</div></section>}
        </>)}
      </main>
      {edit && <MeetingDialog meeting={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={load} />}
    </div>)
}

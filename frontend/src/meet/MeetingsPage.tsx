import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, Copy, Infinity as Forever, Lock, MoreHorizontal, Pencil, Plus, Star, Trash2, Video } from 'lucide-react'
import { api, type MeetInfo } from '../api'
import { Popover } from '../ui/Popover'
import { askConfirm } from '../ui/Dialogs'
import { toast } from '../ui/Toast'
import { inviteText } from './util'
import './meet.css'

function Card({ m, onEdit, onChanged }: { m: MeetInfo; onEdit: () => void; onChanged: () => void }) {
  const cohost = m.role === 'cohost'
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
        {cohost && <span><Star size={12} />Co-host · {m.host_name}'s meeting</span>}
        {m.has_passcode && <span><Lock size={12} />Passcode</span>}
        {!!m.cohosts?.length && <span><Star size={12} />{m.cohosts.length} co-host{m.cohosts.length === 1 ? '' : 's'}</span>}
        {s?.approval && <span>Approval</span>}
        {s?.host_first && <span>Host first</span>}
        {s && !s.guests && <span>Signed-in only</span>}
        {s && s.chat !== 'all' && <span>Chat: {s.chat === 'off' ? 'off' : 'host'}</span>}
      </div>
      <div className="acts">
        <button className="btn btn-primary btn-pill btn-sm" onClick={() => nav(`/m/${m.code}`)}><Video size={15} />{m.live ? 'Join' : 'Start'}</button>
        <button className="btn btn-soft btn-pill btn-sm" onClick={copy}>{copied ? <Check size={15} /> : <Copy size={15} />}Copy invite</button>
        {!cohost && <button className="btn btn-ghost btn-pill btn-sm" onClick={onEdit}><Pencil size={15} />Settings</button>}
        {!cohost && <Popover align="end" trigger={({ toggle }) => <button className="icon-btn sm" onClick={toggle} aria-label="More"><MoreHorizontal size={17} /></button>}>
          {(close) => (
            <div className="menu">
              {m.live > 0 && <button onClick={() => { close(); void endSession() }}>End the session</button>}
              <button className="danger" onClick={() => { close(); void remove() }}><Trash2 size={16} />Delete</button>
            </div>)}
        </Popover>}
      </div>
    </div>)
}

export function MeetingsPage() {
  const [list, setList] = useState<MeetInfo[] | null>(null)
  const nav = useNavigate()
  const [on, setOn] = useState(true)
  const load = useCallback(() => { api.meetMine().then(setList).catch(() => setList([])) }, [])
  useEffect(() => { load(); void api.meetConfig().then((c) => setOn(c.enabled)); const t = setInterval(load, 10000); return () => clearInterval(t) }, [load])
  useEffect(() => { document.title = 'Meetings' }, [])
  const own = (list ?? []).filter((m) => m.role !== 'cohost')
  const kept = own.filter((m) => m.permanent), once = own.filter((m) => !m.permanent), helping = (list ?? []).filter((m) => m.role === 'cohost')
  return (
    <div className="meet-manage">
      <header className="top">
        <Link to="/" className="btn btn-ghost btn-pill btn-sm"><ArrowLeft size={15} />Documents</Link>
        <h1>Meetings</h1>
        <button className="btn btn-primary btn-pill" onClick={() => nav('/meetings/new')} disabled={!on}><Plus size={17} />New meeting</button>
      </header>
      <main>
        {!on && <p className="form-error">Meetings are turned off on this server.</p>}
        {list === null ? <span className="spinner" /> : list.length === 0 ? (
          <div className="meet-empty"><Video size={34} /><h3>No meetings yet</h3><p className="muted">Make a permanent meeting for the people you meet with often: it keeps its link and settings, and you can end it whenever you like.</p>
            <button className="btn btn-primary btn-pill" onClick={() => nav('/meetings/new')} disabled={!on}><Plus size={17} />New meeting</button></div>
        ) : (<>
          {kept.length > 0 && <section><h2>Permanent</h2><div className="grid">{kept.map((m) => <Card key={m.code} m={m} onEdit={() => nav(`/meetings/${m.code}`)} onChanged={load} />)}</div></section>}
          {helping.length > 0 && <section><h2>Co-hosting</h2><div className="grid">{helping.map((m) => <Card key={m.code} m={m} onEdit={() => {}} onChanged={load} />)}</div></section>}
          {once.length > 0 && <section><h2>One-time</h2><div className="grid">{once.map((m) => <Card key={m.code} m={m} onEdit={() => nav(`/meetings/${m.code}`)} onChanged={load} />)}</div></section>}
        </>)}
      </main>
    </div>)
}

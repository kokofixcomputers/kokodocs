import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Infinity as Forever, Settings2, Video } from 'lucide-react'
import { api, type MeetInfo } from '../api'
import { Popover } from '../ui/Popover'
import { toast } from '../ui/Toast'
import { parseMeetCode } from './util'
import './meet.css'

/** The dashboard's way into meetings: start one, join with a code or link, go back to one of yours, or manage them. */
export function MeetMenu() {
  const nav = useNavigate()
  const [on, setOn] = useState(false)
  const [mine, setMine] = useState<MeetInfo[]>([])
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.meetConfig().then((c) => setOn(c.enabled)).catch(() => {}) }, [])
  if (!on) return null

  const start = async (close: () => void) => {
    setBusy(true)
    try { const m = await api.meetCreate({}); close(); nav(`/m/${m.code}`) } catch (e) { toast((e as Error).message) } finally { setBusy(false) }
  }
  const go = (close: () => void) => {
    const c = parseMeetCode(code)
    if (!c) { toast("That doesn't look like a meeting code, such as abc-defg-hij."); return }
    close(); nav(`/m/${c}`)
  }
  return (
    <Popover align="end" onOpenChange={(o) => { if (o) api.meetMine().then(setMine).catch(() => setMine([])) }}
      trigger={({ toggle }) => <button className="btn btn-ghost btn-pill" onClick={toggle}><Video size={17} />Meet</button>}>
      {(close) => (
        <div className="menu wide meet-menu">
          <button className="meet-new" disabled={busy} onClick={() => void start(close)}><Video size={17} />Start a meeting now</button>
          <form className="meet-join-row" onSubmit={(e) => { e.preventDefault(); go(close) }}>
            <input value={code} placeholder="Enter a code or link" aria-label="Meeting code or link" onChange={(e) => setCode(e.target.value)} />
            <button className="icon-btn" type="submit" aria-label="Join" disabled={!code.trim()}><ArrowRight size={18} /></button>
          </form>
          {mine.length > 0 && (<>
            <div className="menu-sep" />
            <div className="menu-label">Your meetings</div>
            {mine.slice(0, 6).map((m) => (
              <button key={m.code} onClick={() => { close(); nav(`/m/${m.code}`) }}>{m.permanent ? <Forever size={16} /> : <Video size={16} />}
                <span className="meet-mine"><b>{m.title}</b><code>{m.code}</code></span>{m.live > 0 && <i className="live-dot" title={`${m.live} in it`} />}</button>))}
          </>)}
          <div className="menu-sep" />
          <Link to="/meetings" className="menu-link" onClick={close}><Settings2 size={16} />Manage meetings…</Link>
        </div>)}
    </Popover>
  )
}

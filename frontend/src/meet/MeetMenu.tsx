import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Video } from 'lucide-react'
import { api, type MeetInfo } from '../api'
import { Popover } from '../ui/Popover'
import { toast } from '../ui/Toast'
import { parseMeetCode } from './MeetPage'

/** The dashboard's way into meetings: start one, join with a code or link, or go back to one you are hosting. */
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
    try { const m = await api.meetCreate('', true); close(); nav(`/m/${m.code}`) } catch (e) { toast((e as Error).message) } finally { setBusy(false) }
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
          <button className="meet-new" disabled={busy} onClick={() => void start(close)}><Video size={17} />Start a meeting</button>
          <div className="menu-sep" />
          <form className="meet-join-row" onSubmit={(e) => { e.preventDefault(); go(close) }}>
            <span className="field"><input value={code} placeholder="Enter a code or link" aria-label="Meeting code or link" onChange={(e) => setCode(e.target.value)} /></span>
            <button className="icon-btn" type="submit" aria-label="Join" disabled={!code.trim()}><ArrowRight size={18} /></button>
          </form>
          {mine.length > 0 && (<>
            <div className="menu-sep" />
            <div className="menu-label">Your open meetings</div>
            {mine.slice(0, 5).map((m) => <button key={m.code} onClick={() => { close(); nav(`/m/${m.code}`) }}><Video size={16} /><span className="meet-mine"><b>{m.title}</b><code>{m.code}</code></span></button>)}
          </>)}
        </div>)}
    </Popover>
  )
}

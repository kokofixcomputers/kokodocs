import { useCallback, useEffect, useRef, useState } from 'react'
import { Circle, Download, Play, Trash2 } from 'lucide-react'
import { api, type RecordingItem } from '../api'
import { Modal } from '../ui/Modal'
import { askConfirm } from '../ui/Dialogs'
import { toast } from '../ui/Toast'
import { clock } from './util'

const size = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`)

/** A recording from a browser has no length stored in the file, so the player can't seek until it has found the end: jumping there and back fixes it. */
function Player({ id, title, onClose }: { id: string; title: string; onClose: () => void }) {
  const [url, setUrl] = useState('')
  const v = useRef<HTMLVideoElement>(null)
  useEffect(() => { api.recording(id).then((r) => setUrl(r.url)).catch((e) => toast((e as Error).message)) }, [id])
  const fix = () => {
    const el = v.current
    if (!el || el.duration !== Infinity) return
    el.currentTime = 1e101
    el.addEventListener('timeupdate', () => { el.currentTime = 0 }, { once: true })
  }
  return (
    <Modal title={title} onClose={onClose} width={860}>
      <div className="rec-player">{url ? <video ref={v} src={url} controls autoPlay playsInline onLoadedMetadata={fix} /> : <span className="spinner" />}</div>
    </Modal>)
}

/** The host's recordings: they take up the host's storage, so deleting one gives the space back. */
export function Recordings() {
  const [list, setList] = useState<{ items: RecordingItem[]; total: number } | null>(null)
  const [play, setPlay] = useState<RecordingItem | null>(null)
  const load = useCallback(() => { api.recordings().then(setList).catch(() => setList({ items: [], total: 0 })) }, [])
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t) }, [load])
  const download = async (r: RecordingItem) => { try { const x = await api.recording(r.id); const a = document.createElement('a'); a.href = `${x.url}&download=1`; a.click() } catch (e) { toast((e as Error).message) } }
  const remove = async (r: RecordingItem) => {
    if (!(await askConfirm({ title: 'Delete this recording?', text: `It is deleted for good, and its ${size(r.size)} of storage is freed.`, label: 'Delete', danger: true }))) return
    try { await api.deleteRecording(r.id); load() } catch (e) { toast((e as Error).message) }
  }
  if (!list) return <span className="spinner" />
  if (!list.items.length) return <div className="meet-empty"><Circle size={34} /><h3>No recordings</h3><p className="muted">When you record a meeting, the recording is saved here, in your storage. Start one from the meeting's More menu or its record button.</p></div>
  return (
    <div className="rec-list">
      <p className="muted small">{list.items.length} {list.items.length === 1 ? 'recording' : 'recordings'}, {size(list.total)} of your storage.</p>
      {list.items.map((r) => (
        <div key={r.id} className="rec-row">
          <span className="ic"><Circle size={16} fill={r.status === 'recording' ? '#ff4d55' : 'none'} color={r.status === 'recording' ? '#ff4d55' : 'currentColor'} /></span>
          <div className="txt"><b>{r.title || 'Meeting'}</b>
            <small>{new Date(r.created_at * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · {r.status === 'recording' ? 'recording now' : r.duration_ms ? clock(r.duration_ms) : 'length unknown'} · {size(r.size)} · by {r.by}</small></div>
          <button className="btn btn-soft btn-pill btn-sm" onClick={() => setPlay(r)} disabled={!r.size}><Play size={14} />Play</button>
          <button className="icon-btn sm" aria-label="Download" title="Download" onClick={() => void download(r)} disabled={!r.size}><Download size={16} /></button>
          <button className="icon-btn sm" aria-label="Delete" title="Delete" onClick={() => void remove(r)}><Trash2 size={16} /></button>
        </div>))}
      {play && <Player id={play.id} title={play.title || 'Meeting'} onClose={() => setPlay(null)} />}
    </div>)
}

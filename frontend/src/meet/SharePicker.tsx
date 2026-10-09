import { useEffect, useMemo, useState } from 'react'
import { FileText, Presentation, Search, Sheet, Plus } from 'lucide-react'
import { api, type DocSummary } from '../api'
import { Modal } from '../ui/Modal'
import { toast } from '../ui/Toast'
import type { Call } from './types'

type Mode = 'collab' | 'present'
const ICON = { doc: FileText, sheet: Sheet, slides: Presentation } as const
const NEW = [{ kind: 'doc', label: 'New document' }, { kind: 'sheet', label: 'New spreadsheet' }, { kind: 'slides', label: 'New presentation' }] as const

/** Choose what to share in the meeting: one of your documents, spreadsheets or presentations (or a new one), to edit together or to present. */
export function SharePicker({ call, mode: first, onClose }: { call: Call; mode: Mode; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>(first)
  const [docs, setDocs] = useState<DocSummary[] | null>(null)
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState(call.settings().edit_shared)
  const [seek, setSeek] = useState(call.settings().seek)
  const [busy, setBusy] = useState(false)
  const perms = call.perms()
  useEffect(() => { api.listDocs().then((r) => setDocs(r.mine.filter((d) => ['doc', 'sheet', 'slides'].includes(d.kind) && !d.zk))).catch(() => setDocs([])) }, [])
  const list = useMemo(() => (docs ?? []).filter((d) => (mode === 'present' ? d.kind === 'slides' : true) && d.title.toLowerCase().includes(q.toLowerCase())), [docs, mode, q])
  const start = (id: string) => { call.startShare(id, mode, mode === 'collab' ? { edit } : { seek }); onClose() }
  const create = async (kind: 'doc' | 'sheet' | 'slides') => {
    setBusy(true)
    try { const d = await api.createDoc(undefined, null, kind); start(d.id) } catch (e) { toast((e as Error).message); setBusy(false) }
  }
  return (
    <Modal title="Share in the meeting" onClose={onClose} width={560}>
      <div className="share-body meet-picker">
        <div className="seg wide" role="tablist">
          <button role="tab" aria-selected={mode === 'collab'} className={mode === 'collab' ? 'on' : ''} disabled={!perms.collab} onClick={() => setMode('collab')}>Edit together</button>
          <button role="tab" aria-selected={mode === 'present'} className={mode === 'present' ? 'on' : ''} disabled={!perms.present} onClick={() => setMode('present')}>Present slides</button>
        </div>
        <p className="muted small">{mode === 'collab' ? 'Everyone in the meeting opens it here and edits at the same time, with their own cursor. It stays yours; people only get access while it is shared.' : 'Everyone sees the slide you are on, and follows you as you turn the pages.'}</p>
        {mode === 'collab'
          ? <label className="check"><input type="checkbox" checked={edit} onChange={(e) => setEdit(e.target.checked)} />Everyone can edit (otherwise they can only watch)</label>
          : <label className="check"><input type="checkbox" checked={seek} onChange={(e) => setSeek(e.target.checked)} />People can look at other slides on their own</label>}
        <span className="field"><Search size={16} /><input value={q} placeholder="Search your files" onChange={(e) => setQ(e.target.value)} /></span>
        <div className="picker-list">
          {docs === null && <span className="spinner" />}
          {docs && list.length === 0 && <p className="muted small">{mode === 'present' ? 'You have no presentations yet.' : 'Nothing matches.'}</p>}
          {list.map((d) => { const I = ICON[d.kind as 'doc'] ?? FileText; return <button key={d.id} onClick={() => start(d.id)}><I size={18} /><span>{d.title || 'Untitled'}</span><small>{new Date(d.updated_at * 1000).toLocaleDateString()}</small></button> })}
        </div>
        <div className="picker-new">{NEW.filter((n) => mode === 'collab' || n.kind === 'slides').map((n) => <button key={n.kind} className="btn btn-ghost btn-pill btn-sm" disabled={busy} onClick={() => void create(n.kind)}><Plus size={14} />{n.label}</button>)}</div>
      </div>
    </Modal>)
}

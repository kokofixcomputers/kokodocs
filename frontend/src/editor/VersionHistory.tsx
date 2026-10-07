import { useCallback, useEffect, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import Collaboration from '@tiptap/extension-collaboration'
import * as Y from 'yjs'
import { Check, History, Loader2, Pencil, RotateCcw } from 'lucide-react'
import { api, type Version } from '../api'
import { askText } from '../ui/Dialogs'
import { toast } from '../ui/Toast'
import { baseExtensions } from './extensions'
import { VersionDiff, DiffToggle } from './VersionDiff'
import { Pagination, geometry, readPageMeta, sheetVars } from './Pagination'

const dayLabel = (t: number) => {
  const d = new Date(t * 1000), today = new Date()
  const diff = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}
const timeLabel = (t: number) => new Date(t * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
export const fullLabel = (t: number) => new Date(t * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export function VersionHistory({ docId, open, selected, refreshKey, onSelect, unit = 'words' }: {
  docId: string; open: boolean; selected: Version | null; refreshKey: number; onSelect: (v: Version | null) => void; unit?: string
}) {
  const [list, setList] = useState<Version[] | null>(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => api.listVersions(docId).then(setList).catch((e) => toast(e.message)), [docId])
  useEffect(() => { if (open) load() }, [open, load, refreshKey])

  const save = async () => {
    setSaving(true)
    try { await api.createVersion(docId, name.trim() || undefined); setName(''); await load(); toast('Version saved') }
    catch (e) { toast((e as Error).message) } finally { setSaving(false) }
  }
  const rename = async (v: Version) => {
    const t = await askText({ title: 'Name this version', value: v.label ?? '', placeholder: 'e.g. First draft' })
    if (t !== null) { await api.renameVersion(docId, v.id, t); load() }
  }

  const groups: { day: string; items: Version[] }[] = []
  list?.forEach((v) => {
    const day = dayLabel(v.created_at)
    const g = groups[groups.length - 1]
    if (g && g.day === day) g.items.push(v); else groups.push({ day, items: [v] })
  })

  return (
    <div className="side-body">
      <div className="side-title"><History size={18} /><h3>Version history</h3></div>
      <form className="ver-save" onSubmit={(e) => { e.preventDefault(); save() }}>
        <label className="field compact"><input placeholder="Name this version (optional)" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></label>
        <button className="btn btn-primary btn-pill btn-sm" disabled={saving}>{saving ? <Loader2 size={14} className="spin" /> : 'Save'}</button>
      </form>
      <button className={`ver-item current ${selected === null ? 'on' : ''}`} onClick={() => onSelect(null)}>
        <span className="ver-main"><b>Current version</b><span>The live document</span></span>
        {selected === null && <Check size={16} />}
      </button>
      {!list ? <div className="splash small"><span className="spinner" /></div> : list.length === 0 ? (
        <p className="side-empty">No saved versions yet. They're created automatically as you edit, and you can save one yourself above.</p>
      ) : groups.map((g) => (
        <div key={g.day} className="ver-group">
          <div className="ver-day">{g.day}</div>
          {g.items.map((v) => (
            <div key={v.id} className={`ver-item ${selected?.id === v.id ? 'on' : ''}`} role="button" tabIndex={0}
              onClick={() => onSelect(v)} onKeyDown={(e) => e.key === 'Enter' && onSelect(v)}>
              <span className="ver-main">
                <b>{v.label ?? timeLabel(v.created_at)}</b>
                <span>{v.label ? `${timeLabel(v.created_at)} · ` : ''}{v.kind === 'auto' && !v.label ? 'Autosaved · ' : ''}{v.authors.length ? v.authors.join(', ') : 'Edited'}</span>
                <span className="ver-prev">{v.words.toLocaleString()} {unit}{v.preview ? ` · ${v.preview}` : ''}</span>
              </span>
              <button className="icon-btn sm" title="Name this version" aria-label="Name this version" onClick={(e) => { e.stopPropagation(); rename(v) }}><Pencil size={14} /></button>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function PreviewSheet({ snap, zoom, narrow }: { snap: Y.Doc; zoom: number; narrow?: boolean }) {
  const editor = useEditor({
    editable: false,
    editorProps: { attributes: { spellcheck: 'false', class: 'koko-prose' } },
    extensions: [...baseExtensions(), Collaboration.configure({ document: snap }), Pagination.configure({ getMeta: () => readPageMeta(snap.getMap('meta')) })],
  }, [snap])
  return (
    <div className="sheet is-readonly" style={narrow ? { width: '100%', ['--pad-l' as string]: '18px', ['--pad-r' as string]: '18px', ['--bleed' as string]: '10px' } : { width: geometry(readPageMeta(snap.getMap('meta'))).width, zoom, ...sheetVars(geometry(readPageMeta(snap.getMap('meta')))) }}>
      <EditorContent editor={editor} />
    </div>
  )
}

/** Read-only view of an old version with a restore bar. */
export function VersionPreview({ docId, version, zoom, narrow, live, onRestore, onClose }: {
  live: Y.Doc; docId: string; version: Version; zoom: number; narrow?: boolean; onRestore: (snap: Y.Doc, v: Version) => Promise<void>; onClose: () => void
}) {
  const [snap, setSnap] = useState<Y.Doc | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [diff, setDiff] = useState(false)

  useEffect(() => {
    let dead = false
    setSnap(null); setErr('')
    api.versionData(docId, version.id).then((buf) => {
      if (dead) return
      const d = new Y.Doc(); Y.applyUpdate(d, buf); setSnap(d)
    }).catch((e) => setErr(e.message || 'Could not load this version'))
    return () => { dead = true }
  }, [docId, version.id])

  return (
    <>
      <div className="ver-bar">
        <div className="ver-bar-text">
          <b>{version.label ?? 'Earlier version'}</b>
          <span>{fullLabel(version.created_at)}{version.authors.length ? ` · ${version.authors.join(', ')}` : ''}</span>
        </div>
        <div className="ver-bar-actions">
          <DiffToggle on={diff} onClick={() => setDiff((d) => !d)} />
          <button className="btn btn-ghost btn-pill btn-sm" onClick={onClose}>Back to current</button>
          <button className="btn btn-primary btn-pill btn-sm" disabled={!snap || busy}
            onClick={async () => { if (!snap) return; setBusy(true); try { await onRestore(snap, version) } finally { setBusy(false) } }}>
            {busy ? <Loader2 size={14} className="spin" /> : <RotateCcw size={14} />}Restore this version
          </button>
        </div>
      </div>
      {err ? <p className="side-empty ver-err">{err}</p> : diff ? <VersionDiff docId={docId} kind="doc" version={version} live={live} snap={snap} /> : snap ? <PreviewSheet snap={snap} zoom={zoom} narrow={narrow} /> : <div className="splash small"><span className="spinner" /></div>}
    </>
  )
}

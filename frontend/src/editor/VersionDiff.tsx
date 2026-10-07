import { useEffect, useMemo, useState } from 'react'
import * as Y from 'yjs'
import { GitCompareArrows } from 'lucide-react'
import { api, type Version } from '../api'
import { diffDocs, type Diff, type DiffKind, type Row } from './diff'

const load = async (docId: string, id: string) => { const d = new Y.Doc(); Y.applyUpdate(d, await api.versionData(docId, id)); return d }
const noun: Record<DiffKind, [string, string]> = { doc: ['line', 'lines'], sheet: ['cell', 'cells'], slides: ['item', 'items'], wiki: ['line', 'lines'] }

/** Side-by-side-free diff: shows what changed in a version, or what has changed since it. */
export function VersionDiff({ docId, kind, version, live, snap }: { docId: string; kind: DiffKind; version: Version; live: Y.Doc; snap: Y.Doc | null }) {
  const [mode, setMode] = useState<'in' | 'since'>('in')
  const [prev, setPrev] = useState<Y.Doc | null | undefined>(undefined)   // undefined = loading, null = no earlier version
  const [err, setErr] = useState('')
  useEffect(() => {
    let dead = false; setPrev(undefined); setErr('')
    ;(async () => {
      const list = await api.listVersions(docId)
      const older = list.filter((v) => v.created_at < version.created_at).sort((a, b) => b.created_at - a.created_at)[0]
      const d = older ? await load(docId, older.id) : null
      if (!dead) setPrev(d)
    })().catch((e) => { if (!dead) setErr(e.message || 'Could not load the earlier version') })
    return () => { dead = true }
  }, [docId, version.id, version.created_at])
  // a frozen copy of the live file, so the result doesn't shift while you read it
  const now = useMemo(() => { const d = new Y.Doc(); Y.applyUpdate(d, Y.encodeStateAsUpdate(live)); return d }, [live, mode])   // eslint-disable-line react-hooks/exhaustive-deps
  const diff: Diff | null = useMemo(() => {
    if (!snap || prev === undefined) return null
    return mode === 'in' ? diffDocs(kind, prev ?? new Y.Doc(), snap) : diffDocs(kind, snap, now)
  }, [kind, mode, snap, prev, now])
  const [one, many] = noun[kind]

  return (
    <div className="vd">
      <div className="vd-bar">
        <span className="seg" role="group" aria-label="What to compare">
          <button className={mode === 'in' ? 'on' : ''} onClick={() => setMode('in')}>Changes in this version</button>
          <button className={mode === 'since' ? 'on' : ''} onClick={() => setMode('since')}>Changes since</button>
        </span>
        {diff && !diff.same && <span className="vd-stats"><b className="add">+{diff.added}</b><b className="del">−{diff.removed}</b><b className="mod">~{diff.changed}</b><span>{diff.added} added, {diff.removed} removed, {diff.changed} edited</span></span>}
      </div>
      <p className="vd-note muted">{mode === 'in' ? (prev === null ? 'This is the oldest saved version, so everything counts as added.' : 'Compared with the version saved just before this one.') : 'Compared with the file as it is right now.'}</p>
      {err ? <p className="side-empty ver-err">{err}</p> : !diff ? <div className="splash small"><span className="spinner" /></div> : diff.same ? (
        <div className="vd-empty"><GitCompareArrows size={30} /><b>No differences</b><span className="muted">{mode === 'in' ? 'Nothing changed in this version.' : 'The file is the same as this version.'}</span></div>
      ) : (
        <div className="vd-rows" role="list" aria-label={`Changed ${many}`}>{diff.rows.map((r, i) => <DiffRow key={i} r={r} unit={[one, many]} />)}</div>
      )}
    </div>
  )
}

function DiffRow({ r, unit }: { r: Row; unit: [string, string] }) {
  if (r.kind === 'gap') return <div className="vd-gap" role="separator">{r.count} unchanged {r.count === 1 ? unit[0] : unit[1]}</div>
  if (r.kind === 'same') return <div className="vd-row same" role="listitem"><span className="vd-sign" /><span className="vd-text">{r.text}</span></div>
  const label = 'label' in r && r.label ? <span className="vd-label">{r.label}</span> : null
  if (r.kind === 'mod') return (
    <div className="vd-row mod" role="listitem"><span className="vd-sign">~</span>
      <span className="vd-text">{label}{r.parts.map((p, i) => p.t === 'add' ? <ins key={i}>{p.text}</ins> : p.t === 'del' ? <del key={i}>{p.text}</del> : <span key={i}>{p.text}</span>)}</span></div>)
  return <div className={`vd-row ${r.kind}`} role="listitem"><span className="vd-sign">{r.kind === 'add' ? '+' : '−'}</span><span className="vd-text">{label}{r.kind === 'del' ? <del>{r.text}</del> : <ins>{r.text}</ins>}</span><span className="vd-sr">{r.kind === 'add' ? 'added' : 'removed'}</span></div>
}

export const DiffToggle = ({ on, onClick }: { on: boolean; onClick: () => void }) => (
  <button className={`btn btn-pill btn-sm ${on ? 'btn-primary' : 'btn-soft'}`} onClick={onClick} aria-pressed={on}><GitCompareArrows size={14} />{on ? 'Hide changes' : 'Show changes'}</button>
)

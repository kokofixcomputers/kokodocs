import { useEffect, useMemo, useState } from 'react'
import * as Y from 'yjs'
import { Columns2, GitCompareArrows, Rows2 } from 'lucide-react'
import { api, type Version } from '../api'
import { diffDocs, type Diff, type DiffKind, type Part, type Row } from './diff'

const load = async (docId: string, id: string) => { const d = new Y.Doc(); Y.applyUpdate(d, await api.versionData(docId, id)); return d }
const noun: Record<DiffKind, [string, string]> = { doc: ['line', 'lines'], sheet: ['cell', 'cells'], slides: ['item', 'items'], wiki: ['line', 'lines'] }

/** Side-by-side-free diff: shows what changed in a version, or what has changed since it. */
export function VersionDiff({ docId, kind, version, live, snap }: { docId: string; kind: DiffKind; version: Version; live: Y.Doc; snap: Y.Doc | null }) {
  const [mode, setMode] = useState<'in' | 'since'>('in')
  const [side, setSide] = useSideBySide()
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
        <LayoutToggle side={side} onChange={setSide} />
        {diff && !diff.same && <span className="vd-stats"><b className="add">+{diff.added}</b><b className="del">−{diff.removed}</b><b className="mod">~{diff.changed}</b><span>{diff.added} added, {diff.removed} removed, {diff.changed} edited</span></span>}
      </div>
      <p className="vd-note muted">{mode === 'in' ? (prev === null ? 'This is the oldest saved version, so everything counts as added.' : 'Compared with the version saved just before this one.') : 'Compared with the file as it is right now.'}</p>
      {err ? <p className="side-empty ver-err">{err}</p> : !diff ? <div className="splash small"><span className="spinner" /></div> : diff.same ? (
        <div className="vd-empty"><GitCompareArrows size={30} /><b>No differences</b><span className="muted">{mode === 'in' ? 'Nothing changed in this version.' : 'The file is the same as this version.'}</span></div>
      ) : (
        <DiffView diff={diff} unit={[one, many]} side={side} />
      )}
    </div>
  )
}

const SIDE_KEY = 'koko-diff-side'
/** Inline or side-by-side, remembered per browser; side by side is the default when there is room. */
export function useSideBySide(): [boolean, (b: boolean) => void] {
  const [side, set] = useState(() => { try { const v = localStorage.getItem(SIDE_KEY); if (v) return v === '1' } catch { /* private mode */ } return window.innerWidth > 900 })
  return [side, (b) => { set(b); try { localStorage.setItem(SIDE_KEY, b ? '1' : '0') } catch { /* private mode */ } }]
}

export const LayoutToggle = ({ side, onChange }: { side: boolean; onChange: (b: boolean) => void }) => (
  <span className="seg vd-layout" role="group" aria-label="Layout">
    <button className={side ? 'on' : ''} onClick={() => onChange(true)} aria-label="Side by side" title="Side by side"><Columns2 size={15} /></button>
    <button className={!side ? 'on' : ''} onClick={() => onChange(false)} aria-label="Inline" title="Inline"><Rows2 size={15} /></button>
  </span>
)

export function DiffView({ diff, unit, side, left = 'Before', right = 'After' }: { diff: Diff; unit: [string, string]; side: boolean; left?: string; right?: string }) {
  if (!side) return <div className="vd-rows" role="list" aria-label={`Changed ${unit[1]}`}>{diff.rows.map((r, i) => <DiffRow key={i} r={r} unit={unit} />)}</div>
  return (
    <div className="vd-rows vd-side" role="table" aria-label={`Changed ${unit[1]}`}>
      <div className="vd-heads" role="row"><span role="columnheader">{left}</span><span role="columnheader">{right}</span></div>
      {diff.rows.map((r, i) => <SideRow key={i} r={r} unit={unit} />)}
    </div>
  )
}

const partsText = (parts: Part[], skip: 'add' | 'del') => parts.filter((p) => p.t !== skip).map((p, i) => p.t === 'add' ? <ins key={i}>{p.text}</ins> : p.t === 'del' ? <del key={i}>{p.text}</del> : <span key={i}>{p.text}</span>)

function SideRow({ r, unit }: { r: Row; unit: [string, string] }) {
  if (r.kind === 'gap') return <div className="vd-gap" role="separator">{r.count} unchanged {r.count === 1 ? unit[0] : unit[1]}</div>
  const label = 'label' in r && r.label ? <span className="vd-label">{r.label}</span> : null
  const cell = (cls: string, sign: string, body: React.ReactNode) => <div className={`vd-cell ${cls}`} role="cell"><span className="vd-sign">{sign}</span><span className="vd-text">{body}</span></div>
  if (r.kind === 'same') return <div className="vd-pair" role="row">{cell('same', '', r.text)}{cell('same', '', r.text)}</div>
  if (r.kind !== 'mod' && r.kind === 'add') return <div className="vd-pair" role="row">{cell('none', '', null)}{cell('add', '+', <>{label}<ins>{r.text}</ins></>)}</div>
  if (r.kind === 'del') return <div className="vd-pair" role="row">{cell('del', '−', <>{label}<del>{r.text}</del></>)}{cell('none', '', null)}</div>
  if (r.kind !== 'mod') return null
  return <div className="vd-pair" role="row">{cell('mod', '~', <>{label}{partsText(r.parts, 'add')}</>)}{cell('mod', '~', <>{label}{partsText(r.parts, 'del')}</>)}</div>
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

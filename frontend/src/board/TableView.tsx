import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Download, Plus } from 'lucide-react'
import { isEmpty, problem, type BoardModel, type Value } from './model'
import { Chip, type F } from './shared'
import type { OpenTarget } from './views'

type Col = { id: string; name: string; color: string }

function plain(f: F, v: Value | undefined): string {
  if (isEmpty(v)) return ''
  if (f.type === 'single' || f.type === 'multi') return (Array.isArray(v) ? v : [String(v)]).map((id) => f.options?.find((o) => o.id === id)?.label ?? '').filter(Boolean).join(', ')
  if (f.type === 'checkbox') return 'Yes'
  return String(v)
}
const csvCell = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

export function TableView({ model, cols, fields, readOnly, filter, onOpen, title }: { model: BoardModel; cols: Col[]; fields: F[]; readOnly: boolean; filter: string; onOpen: (t: OpenTarget) => void; title: string }) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null)
  const [shut, setShut] = useState<Set<string>>(new Set())   // board columns folded away in this table
  const toggle = (id: string) => setShut((p) => { const n = new Set(p); if (!n.delete(id)) n.add(id); return n })
  const colOf = useMemo(() => new Map(cols.map((c) => [c.id, c])), [cols])
  const q = filter.trim().toLowerCase()
  let rows = cols.flatMap((c) => model.cardsIn(c.id))
  if (q) rows = rows.filter((c) => (c.title + ' ' + (c.desc ?? '')).toLowerCase().includes(q))
  if (sort) {
    const val = (c: (typeof rows)[number]): string | number => {
      if (sort.key === '_title') return c.title.toLowerCase()
      if (sort.key === '_col') return cols.findIndex((x) => x.id === c.col)
      const f = fields.find((x) => x.id === sort.key)!, v = c.v?.[f.id]
      if (isEmpty(v)) return f.type === 'number' ? Infinity : '￿'   // empty values sort last
      if (f.type === 'number') return Number(v)
      if (f.type === 'single' || f.type === 'multi') return f.type === 'single' ? (f.options ?? []).findIndex((o) => o.id === v) : plain(f, v).toLowerCase()
      return String(v).toLowerCase()
    }
    rows = [...rows].sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir })
  }
  const head = (key: string, label: string) => (
    <th key={key} aria-sort={sort?.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button onClick={() => setSort(sort?.key === key ? (sort.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 })}>{label}{sort?.key === key && (sort.dir === 1 ? <ArrowUp size={13} /> : <ArrowDown size={13} />)}</button>
    </th>)
  const download = () => {
    const lines = [['Title', 'Column', ...fields.map((f) => f.name), 'Description'].map(csvCell).join(',')]
    for (const c of rows) lines.push([c.title, colOf.get(c.col)?.name ?? '', ...fields.map((f) => plain(f, c.v?.[f.id])), c.desc ?? ''].map(csvCell).join(','))
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' })); a.download = `${title || 'board'}.csv`; a.click(); URL.revokeObjectURL(a.href)
  }
  return (
    <div className="bd-table-wrap">
      <div className="bd-table-bar"><span>{rows.length} {rows.length === 1 ? 'card' : 'cards'}</span><button className="btn btn-pill btn-ghost" onClick={download}><Download size={15} />Download CSV</button></div>
      <div className="bd-table-scroll">
        <table className="bd-table">
          <thead><tr>{head('_title', 'Title')}{head('_col', 'Column')}{fields.map((f) => head(f.id, f.name))}</tr></thead>
          <tbody>
            {cols.map((col) => {
              const mine = rows.filter((c) => c.col === col.id), closed = shut.has(col.id)
              if (q && !mine.length) return null
              return [
                <tr key={'g' + col.id} className="bd-group" tabIndex={0} aria-expanded={!closed} onClick={() => toggle(col.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(col.id) } }}>
                  <td colSpan={fields.length + 2}>{closed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}<span className="bd-chip" style={{ '--c': col.color } as React.CSSProperties}><i />{col.name}</span><em>{mine.length}</em></td>
                </tr>,
                ...(closed ? [] : mine.map((c) => (
                  <tr key={c.id} tabIndex={0} onClick={() => onOpen({ id: c.id })} onKeyDown={(e) => { if (e.key === 'Enter') onOpen({ id: c.id }) }}>
                    <td className="t-title">{c.title || 'Untitled'}</td>
                    <td><span className="bd-chip" style={{ '--c': colOf.get(c.col)?.color } as React.CSSProperties}><i />{colOf.get(c.col)?.name}</span></td>
                    {fields.map((f) => { const bad = problem(f, c.v?.[f.id]); return <td key={f.id} className={bad ? 'bad' : ''} title={bad ?? undefined}><span className="bd-chips"><Chip f={f} v={c.v?.[f.id]} />{bad && isEmpty(c.v?.[f.id]) && <em>Required</em>}</span></td> })}
                  </tr>))),
              ]
            })}
            {rows.length === 0 && q && <tr><td colSpan={fields.length + 2} className="bd-empty">{q ? 'No matches' : 'No cards yet'}</td></tr>}
          </tbody>
        </table>
      </div>
      {!readOnly && cols[0] && <button className="bd-add bd-table-add" onClick={() => onOpen({ col: cols[0].id })}><Plus size={16} />Add card</button>}
    </div>
  )
}

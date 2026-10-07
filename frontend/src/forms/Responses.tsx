import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, Inbox, Paperclip, RefreshCw, Trash2 } from 'lucide-react'
import { api, type FormFileRef, type FormResponse } from '../api'
import { askConfirm } from '../ui/Dialogs'
import { toast } from '../ui/Toast'
import { ANSWERABLE, TYPE_LABEL, type FormItem } from './model'

const fmt = (t: number) => new Date(t * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
type Ans = string | string[] | FormFileRef | undefined
const isFile = (v: Ans): v is FormFileRef => typeof v === 'object' && v !== null && !Array.isArray(v)
const HEX = /^#[0-9a-f]{6}$/i
const swatch = (v: Ans) => (typeof v === 'string' && HEX.test(v) ? <i className="fm-sw" style={{ background: v }} /> : null)
const text = (v: Ans) => (isFile(v) ? v.name : Array.isArray(v) ? v.join(', ') : v ?? '')
const FORMULA = /^[=+@\t]|^-(?!\d)/   // spreadsheet formula injection: prefix with an apostrophe (negative numbers are left alone)
const csvCell = (s: string) => { const v = FORMULA.test(s) ? "'" + s : s; return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v }

export function exportCsv(title: string, items: FormItem[], rows: FormResponse[]) {
  const qs = items.filter((i) => ANSWERABLE.includes(i.type))
  const lines = [['Submitted', 'Name', 'Email', ...qs.map((q) => q.title)].map(csvCell).join(',')]
  for (const r of [...rows].reverse()) lines.push([fmt(r.created_at), r.name ?? '', r.email ?? '', ...qs.map((q) => text(r.answers[q.id]))].map(csvCell).join(','))
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  a.download = `${(title || 'form').replace(/[^\w\- ]+/g, '').trim() || 'form'} responses.csv`
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

/** A downloadable attachment. The file is fetched with your sign-in and saved, never opened in the browser. */
function FileLink({ docId, f }: { docId: string; f: FormFileRef }) {
  const [busy, setBusy] = useState(false)
  if (!f.id) return <span className="muted">{f.name}</span>
  return <button type="button" className="fm-filelink" disabled={busy} onClick={async () => { setBusy(true); try { await api.downloadFormFile(docId, f.id, f.name) } catch (e) { toast((e as Error).message || 'Download failed') } finally { setBusy(false) } }}><Paperclip size={14} />{f.name}<em>{f.size >= 1048576 ? `${(f.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(f.size / 1024))} KB`}</em></button>
}

export function Responses({ docId, title, onCount }: { docId: string; title: string; onCount: (n: number) => void }) {
  const [data, setData] = useState<{ items: FormItem[]; responses: FormResponse[] } | null>(null)
  const [view, setView] = useState<'summary' | 'individual' | 'table'>('summary')
  const [idx, setIdx] = useState(0)
  const [err, setErr] = useState('')
  const load = useCallback(() => api.formResponses(docId).then((d) => { setData(d); onCount(d.responses.length); setErr('') }).catch((e) => setErr(e.message)), [docId, onCount])
  useEffect(() => { load(); const t = window.setInterval(load, 20000); return () => window.clearInterval(t) }, [load])
  const questions = useMemo(() => (data?.items ?? []).filter((i) => ANSWERABLE.includes(i.type)), [data])

  if (err) return <p className="form-error">{err}</p>
  if (!data) return <div className="splash small"><span className="spinner" /></div>
  const rows = data.responses
  const remove = async (r: FormResponse) => {
    if (!(await askConfirm({ title: 'Delete this response?', text: 'This can’t be undone.', label: 'Delete', danger: true }))) return
    await api.deleteFormResponse(docId, r.id).catch((e) => toast(e.message)); setIdx((i) => Math.max(0, Math.min(i, rows.length - 2))); load()
  }
  const clear = async () => {
    if (!(await askConfirm({ title: `Delete all ${rows.length} responses?`, text: 'Every response to this form will be permanently removed.', label: 'Delete all', danger: true }))) return
    await api.clearFormResponses(docId).catch((e) => toast(e.message)); load()
  }

  return (
    <div className="fm-resp">
      <div className="fm-resp-bar">
        <h2>{rows.length} {rows.length === 1 ? 'response' : 'responses'}</h2>
        <span className="seg">{(['summary', 'individual', 'table'] as const).map((v) => <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{v[0].toUpperCase() + v.slice(1)}</button>)}</span>
        <span className="fm-spacer" />
        <button className="icon-btn" title="Refresh" aria-label="Refresh responses" onClick={load}><RefreshCw size={17} /></button>
        <button className="btn btn-pill btn-soft" disabled={!rows.length} onClick={() => exportCsv(title, data.items, rows)}><Download size={16} /><span className="lbl">Export CSV</span></button>
        <button className="btn btn-pill btn-ghost" disabled={!rows.length} onClick={clear}><Trash2 size={16} /><span className="lbl">Delete all</span></button>
      </div>
      {!rows.length ? (
        <div className="fm-empty"><Inbox size={34} /><h3>No responses yet</h3><p className="muted">Share the form from the Share button. People who can view it, or anyone with the link, can fill it out.</p></div>
      ) : view === 'summary' ? (
        <div className="fm-sum">{questions.map((q) => <Summary key={q.id} q={q} rows={rows} docId={docId} />)}</div>
      ) : view === 'individual' ? (
        <div className="fm-card fm-indiv">
          <div className="fm-indiv-nav">
            <button className="icon-btn" aria-label="Previous response" disabled={idx <= 0} onClick={() => setIdx(idx - 1)}><ChevronLeft size={18} /></button>
            <span>{Math.min(idx, rows.length - 1) + 1} of {rows.length}</span>
            <button className="icon-btn" aria-label="Next response" disabled={idx >= rows.length - 1} onClick={() => setIdx(idx + 1)}><ChevronRight size={18} /></button>
            <span className="fm-spacer" />
            <button className="icon-btn" title="Delete response" aria-label="Delete this response" onClick={() => remove(rows[Math.min(idx, rows.length - 1)])}><Trash2 size={17} /></button>
          </div>
          {(() => { const r = rows[Math.min(idx, rows.length - 1)]; return (
            <>
              <p className="muted fm-who">{r.name ? `${r.name} (${r.email})` : 'Anonymous'} · {fmt(r.created_at)}</p>
              {questions.map((q) => <div key={q.id} className="fm-ans"><b>{q.title}</b>{isFile(r.answers[q.id]) ? <p><FileLink docId={docId} f={r.answers[q.id] as FormFileRef} /></p> : <p className={text(r.answers[q.id]) ? '' : 'muted'}>{swatch(r.answers[q.id])}{text(r.answers[q.id]) || 'No answer'}</p>}</div>)}
            </>) })()}
        </div>
      ) : (
        <div className="fm-table-wrap"><table className="fm-table">
          <thead><tr><th>Submitted</th><th>Respondent</th>{questions.map((q) => <th key={q.id}>{q.title}</th>)}<th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td>{fmt(r.created_at)}</td><td>{r.email ?? 'Anonymous'}</td>{questions.map((q) => <td key={q.id}>{isFile(r.answers[q.id]) ? <FileLink docId={docId} f={r.answers[q.id] as FormFileRef} /> : <>{swatch(r.answers[q.id])}{text(r.answers[q.id])}</>}</td>)}
              <td><button className="icon-btn sm" aria-label="Delete response" title="Delete response" onClick={() => remove(r)}><Trash2 size={15} /></button></td></tr>))}</tbody>
        </table></div>
      )}
    </div>
  )
}

function Summary({ q, rows, docId }: { q: FormItem; rows: FormResponse[]; docId: string }) {
  const vals: Ans[] = rows.map((r) => r.answers[q.id]).filter((v) => v !== undefined && v !== '' && !(Array.isArray(v) && !v.length))
  const choice = q.type === 'radio' || q.type === 'checkbox' || q.type === 'select' || q.type === 'scale'
  let body: React.ReactNode
  if (choice) {
    const base = q.type === 'scale' ? Array.from({ length: Math.max(0, (q.scaleMax ?? 5) - (q.scaleMin ?? 1) + 1) }, (_, i) => String((q.scaleMin ?? 1) + i)) : q.options ?? []
    const counts = new Map<string, number>(base.map((o) => [o, 0]))
    for (const v of vals) for (const o of Array.isArray(v) ? v : [text(v)]) counts.set(o, (counts.get(o) ?? 0) + 1)
    const max = Math.max(1, ...counts.values())
    body = (
      <div className="fm-bars">
        {[...counts].map(([o, n]) => <div key={o} className="fm-bar"><span className="fm-bar-l">{o}</span><span className="fm-bar-t"><i style={{ width: `${(n / max) * 100}%` }} /></span><span className="fm-bar-n">{n}<em>{vals.length ? ` · ${Math.round((n / vals.length) * 100)}%` : ''}</em></span></div>)}
        {q.type === 'scale' && vals.length > 0 && <p className="muted fm-avg">Average {(vals.reduce((a, v) => a + Number(v), 0) / vals.length).toFixed(2)}</p>}
      </div>)
  } else if (q.type === 'color') {
    const counts = new Map<string, number>(); for (const v of vals) { const c = text(v).toLowerCase(); counts.set(c, (counts.get(c) ?? 0) + 1) }
    const top = [...counts].sort((a, b) => b[1] - a[1])
    body = <ul className="fm-list fm-colors">{top.slice(0, 12).map(([c, n]) => <li key={c}>{swatch(c)}<b>{c.toUpperCase()}</b><span className="muted">{n} {n === 1 ? 'person' : 'people'}</span></li>)}{top.length > 12 && <li className="muted">and {top.length - 12} more colours. See the Table view.</li>}{!top.length && <li className="muted">No answers</li>}</ul>
  } else if (q.type === 'file') {
    body = <ul className="fm-list">{vals.slice(0, 8).map((v, i) => <li key={i}>{isFile(v) ? <FileLink docId={docId} f={v} /> : text(v)}</li>)}{vals.length > 8 && <li className="muted">and {vals.length - 8} more. See the Table view.</li>}{!vals.length && <li className="muted">No files</li>}</ul>
  } else if (q.type === 'number' && vals.length) {
    const n = vals.map(Number).filter(Number.isFinite)
    body = <p className="fm-stats"><span>Average <b>{(n.reduce((a, b) => a + b, 0) / n.length).toFixed(2)}</b></span><span>Min <b>{Math.min(...n)}</b></span><span>Max <b>{Math.max(...n)}</b></span><span>Total <b>{n.reduce((a, b) => a + b, 0)}</b></span></p>
  } else {
    body = <ul className="fm-list">{vals.slice(0, 8).map((v, i) => <li key={i}>{text(v)}</li>)}{vals.length > 8 && <li className="muted">and {vals.length - 8} more. See the Table view.</li>}{!vals.length && <li className="muted">No answers</li>}</ul>
  }
  return <div className="fm-card fm-sum-card"><h3>{q.title}</h3><p className="muted fm-sum-meta">{TYPE_LABEL[q.type]} · {vals.length} {vals.length === 1 ? 'answer' : 'answers'}</p>{body}</div>
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { Select } from '../ui/Select'
import type { BoardModel } from './model'
import { fromDay, toDay, today, type F } from './shared'
import type { OpenTarget } from './views'

type Col = { id: string; name: string; color: string }
const ZOOM = { days: 36, weeks: 14, months: 5 } as const
type Zoom = keyof typeof ZOOM
const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' })

/** A timeline: each card with dates is a bar from its start to its end, grouped by column. Drag a bar to move it, or its edges to change the dates. */
export function RoadmapView({ model, cols, fields, readOnly, filter, onOpen }: { model: BoardModel; cols: Col[]; fields: F[]; readOnly: boolean; filter: string; onOpen: (t: OpenTarget) => void }) {
  const dateFields = fields.filter((f) => f.type === 'date')
  const startId = dateFields.find((f) => f.id === model.getMeta('rmStart', ''))?.id ?? dateFields[0]?.id
  const endPref = model.getMeta('rmEnd', '__same')
  const endId = endPref === '__same' && dateFields.length > 1 && !model.meta.has('rmEnd') ? dateFields[1].id : (dateFields.find((f) => f.id === endPref)?.id ?? startId)
  const [zoom, setZoom] = useState<Zoom>(() => (localStorage.getItem('koko.rmzoom') as Zoom) || 'weeks')
  const [drag, setDrag] = useState<{ id: string; s: number; e: number } | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const suppress = useRef(false)
  const ppd = ZOOM[zoom]
  const q = filter.trim().toLowerCase()
  const t0 = toDay(today())!

  const items = useMemo(() => {
    const dated: { id: string; title: string; col: string; s: number; e: number }[] = [], undated: { id: string; title: string }[] = []
    for (const col of cols) for (const c of model.cardsIn(col.id)) {
      if (q && !(c.title + ' ' + (c.desc ?? '')).toLowerCase().includes(q)) continue
      const a = typeof c.v?.[startId ?? ''] === 'string' ? toDay(String(c.v![startId!])) : null
      const b = endId && typeof c.v?.[endId] === 'string' ? toDay(String(c.v![endId])) : null
      if (a === null && b === null) undated.push({ id: c.id, title: c.title })
      else { const s = Math.min(a ?? b!, b ?? a!), e = Math.max(a ?? b!, b ?? a!); dated.push({ id: c.id, title: c.title, col: col.id, s, e }) }
    }
    return { dated, undated }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cols, model.version, q, startId, endId])

  const lo = Math.min(t0 - 14, ...items.dated.map((x) => x.s)) - 7, hi = Math.max(t0 + 60, ...items.dated.map((x) => x.e)) + 21
  const days = hi - lo + 1
  useEffect(() => { const el = scroller.current; if (el) el.scrollLeft = Math.max(0, (t0 - lo) * ppd - 120) }, [zoom]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!startId) return <div className="bd-note"><p>The roadmap draws bars between dates. This board has no date field yet.</p>{!readOnly && <button className="btn btn-pill btn-primary" onClick={() => model.addField('date')}><Plus size={16} />Add a date field</button>}</div>

  const sameField = endId === startId
  const begin = (e: React.PointerEvent, it: (typeof items.dated)[number], mode: 'move' | 'start' | 'end') => {
    if (readOnly || e.button !== 0) return
    e.stopPropagation(); const sx = e.clientX; let moved = false
    const calc = (x: number) => {
      const d = Math.round((x - sx) / ppd)
      if (mode === 'move') return { s: it.s + d, e: it.e + d }
      if (mode === 'start') return { s: Math.min(it.s + d, it.e), e: it.e }
      return { s: it.s, e: Math.max(it.e + d, it.s) }
    }
    const move = (ev: PointerEvent) => { if (!moved && Math.abs(ev.clientX - sx) < 4) return; moved = true; ev.preventDefault(); setDrag({ id: it.id, ...calc(ev.clientX) }) }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up)
      setDrag(null)
      if (!moved || ev.type === 'pointercancel') return
      const n = calc(ev.clientX); suppress.current = true; setTimeout(() => { suppress.current = false }, 0)
      if (n.s === it.s && n.e === it.e) return
      model.setValue(it.id, startId, fromDay(n.s)); if (!sameField && endId) model.setValue(it.id, endId, fromDay(n.e))
    }
    window.addEventListener('pointermove', move, { passive: false }); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up)
  }

  // header ticks: months on top, days (or weeks) below
  const months: { x: number; w: number; label: string }[] = []
  for (let d = lo; d <= hi;) {
    const dt = new Date(d * 86400000), nextMonth = Math.round(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1) / 86400000), end = Math.min(nextMonth, hi + 1)
    months.push({ x: (d - lo) * ppd, w: (end - d) * ppd, label: monthFmt.format(new Date(dt.getUTCFullYear(), dt.getUTCMonth(), 1)) }); d = end
  }
  const ticks: { x: number; label: string; today: boolean; weekend: boolean }[] = []
  for (let d = lo; d <= hi; d++) {
    const dow = new Date(d * 86400000).getUTCDay()
    if (zoom === 'days' || (zoom === 'weeks' && dow === 1) || (zoom === 'months' && new Date(d * 86400000).getUTCDate() === 1))
      ticks.push({ x: (d - lo) * ppd, label: String(new Date(d * 86400000).getUTCDate()), today: d === t0, weekend: dow === 0 || dow === 6 })
  }
  const width = days * ppd
  const rowsByCol = cols.map((c) => ({ c, list: items.dated.filter((x) => x.col === c.id).sort((a, b) => a.s - b.s || a.e - b.e) })).filter((g) => g.list.length)

  return (
    <div className="bd-road">
      <div className="bd-view-bar">
        <label className="bd-pick">Start<Select value={startId} label="Start date field" options={dateFields.map((f) => ({ value: f.id, label: f.name }))} onChange={(v) => model.setMeta('rmStart', v)} /></label>
        <label className="bd-pick">End<Select value={endId === startId ? '__same' : endId!} label="End date field" options={[{ value: '__same', label: 'Same as start' }, ...dateFields.filter((f) => f.id !== startId).map((f) => ({ value: f.id, label: f.name }))]} onChange={(v) => model.setMeta('rmEnd', v)} /></label>
        <span className="bd-grow" />
        <Select value={zoom} label="Zoom" options={[{ value: 'days', label: 'Days' }, { value: 'weeks', label: 'Weeks' }, { value: 'months', label: 'Months' }]} onChange={(v) => { setZoom(v); try { localStorage.setItem('koko.rmzoom', v) } catch { /* ignore */ } }} />
        <button className="btn btn-pill btn-ghost" onClick={() => { const el = scroller.current; if (el) el.scrollTo({ left: Math.max(0, (t0 - lo) * ppd - 120), behavior: 'smooth' }) }}>Today</button>
      </div>
      {sameField && dateFields.length === 1 && !readOnly && <p className="bd-foot">Cards show as single days. Add a second date field (like “Start date”) in <b>Fields</b>, then pick it above to draw bars with a length.</p>}
      <div className="bd-road-scroll" ref={scroller}>
        <div className="bd-road-inner" style={{ width: width + 200 }}>
          <div className="bd-road-head">
            <div className="bd-road-label" />
            <div className="bd-road-track" style={{ width }}>
              {months.map((m) => <div key={m.x} className="bd-road-month" style={{ left: m.x, width: m.w }}>{m.w > 50 ? m.label : ''}</div>)}
              {ticks.map((t) => <div key={t.x} className={`bd-road-tick ${t.today ? 'today' : ''} ${t.weekend && zoom === 'days' ? 'we' : ''}`} style={{ left: t.x, width: zoom === 'days' ? ppd : undefined }}>{t.label}</div>)}
            </div>
          </div>
          {rowsByCol.map(({ c, list }) => (
            <div key={c.id} className="bd-road-group" style={{ '--c': c.color } as React.CSSProperties}>
              <div className="bd-road-ghead"><div className="bd-road-label"><i className="bd-dot" />{c.name}<span className="bd-count">{list.length}</span></div><div className="bd-road-track" style={{ width }} /></div>
              {list.map((it) => {
                const s = drag?.id === it.id ? drag.s : it.s, e = drag?.id === it.id ? drag.e : it.e
                return (
                  <div className="bd-road-row" key={it.id}>
                    <div className="bd-road-label" title={it.title}><button onClick={() => onOpen({ id: it.id })}>{it.title || 'Untitled'}</button></div>
                    <div className="bd-road-track" style={{ width }}>
                      <div className={`bd-bar ${drag?.id === it.id ? 'live' : ''} ${readOnly ? 'ro' : ''}`} style={{ left: (s - lo) * ppd, width: Math.max(ppd, (e - s + 1) * ppd) }} role="button" tabIndex={0}
                        aria-label={`${it.title}, ${fromDay(s)} to ${fromDay(e)}`} onPointerDown={(ev) => begin(ev, it, 'move')} onClick={() => { if (!suppress.current) onOpen({ id: it.id }) }} onKeyDown={(ev) => { if (ev.key === 'Enter') onOpen({ id: it.id }) }}>
                        {!readOnly && !sameField && <span className="bd-h l" onPointerDown={(ev) => begin(ev, it, 'start')} />}
                        <span className="bd-bar-t">{it.title || 'Untitled'}</span>
                        {!readOnly && !sameField && <span className="bd-h r" onPointerDown={(ev) => begin(ev, it, 'end')} />}
                      </div>
                    </div>
                  </div>)
              })}
            </div>))}
          <div className="bd-road-today" style={{ left: 200 + (t0 - lo) * ppd + ppd / 2 }} aria-hidden />
        </div>
      </div>
      {items.undated.length > 0 && (
        <div className="bd-undated"><b>No dates yet</b>{items.undated.map((u) => <button key={u.id} className="bd-chip plain" onClick={() => onOpen({ id: u.id })}>{u.title || 'Untitled'}</button>)}</div>)}
      {rowsByCol.length === 0 && <p className="bd-empty">{q ? 'No matches' : 'No cards have dates yet. Give a card a date to place it on the timeline.'}</p>}
    </div>
  )
}

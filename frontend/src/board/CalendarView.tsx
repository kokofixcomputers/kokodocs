import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { Select } from '../ui/Select'
import type { BoardModel } from './model'
import { fromDay, toDay, today, type F } from './shared'
import type { OpenTarget } from './views'

const WEEKDAYS = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date(2024, 0, 7 + i)))   // Sunday first
type Col = { id: string; name: string; color: string }

export function CalendarView({ model, cols, fields, readOnly, filter, onOpen }: { model: BoardModel; cols: Col[]; fields: F[]; readOnly: boolean; filter: string; onOpen: (t: OpenTarget) => void }) {
  const dateFields = fields.filter((f) => f.type === 'date')
  const saved = model.getMeta<string>('calField', '')
  const field = dateFields.find((f) => f.id === saved) ?? dateFields[0]
  const [month, setMonth] = useState(() => { const t = today(); return t.slice(0, 7) })
  const colOf = useMemo(() => new Map(cols.map((c) => [c.id, c])), [cols])
  const q = filter.trim().toLowerCase()
  if (!field) return <div className="bd-note"><p>The calendar places each card on a date field. This board has none yet.</p>{!readOnly && <button className="btn btn-pill btn-primary" onClick={() => model.addField('date')}><Plus size={16} />Add a date field</button>}</div>

  const [y, m] = month.split('-').map(Number)
  const first = toDay(`${month}-01`)!, startDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay()
  const gridStart = first - startDow, weeks = Math.ceil((startDow + new Date(Date.UTC(y, m, 0)).getUTCDate()) / 7)
  const byDay = new Map<string, ReturnType<BoardModel['cardsIn']>>()
  for (const c of cols.flatMap((x) => model.cardsIn(x.id))) {
    const d = c.v?.[field.id]; if (typeof d !== 'string') continue
    if (q && !(c.title + ' ' + (c.desc ?? '')).toLowerCase().includes(q)) continue
    byDay.set(d, [...(byDay.get(d) ?? []), c])
  }
  const shift = (n: number) => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); setMonth(d.toISOString().slice(0, 7)) }
  const label = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1))
  const t = today()
  const undated = cols.flatMap((x) => model.cardsIn(x.id)).filter((c) => typeof c.v?.[field.id] !== 'string').length

  return (
    <div className="bd-cal">
      <div className="bd-view-bar">
        <button className="icon-btn" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft size={18} /></button>
        <h3 aria-live="polite">{label}</h3>
        <button className="icon-btn" aria-label="Next month" onClick={() => shift(1)}><ChevronRight size={18} /></button>
        <button className="btn btn-pill btn-ghost" onClick={() => setMonth(today().slice(0, 7))}>Today</button>
        <span className="bd-grow" />
        <label className="bd-pick">Show by<Select value={field.id} label="Date field" options={dateFields.map((f) => ({ value: f.id, label: f.name }))} onChange={(v) => model.setMeta('calField', v)} /></label>
      </div>
      <div className="bd-cal-grid" role="grid" aria-label={label}>
        {WEEKDAYS.map((w) => <div key={w} className="bd-cal-dow" role="columnheader">{w}</div>)}
        {Array.from({ length: weeks * 7 }, (_, i) => {
          const day = gridStart + i, s = fromDay(day), inMonth = s.startsWith(month), list = byDay.get(s) ?? []
          return (
            <div key={s} role="gridcell" className={`bd-cal-day ${inMonth ? '' : 'out'} ${s === t ? 'today' : ''}`}>
              <div className="bd-cal-num"><span>{+s.slice(8)}</span>{!readOnly && cols[0] && <button className="icon-btn sm" aria-label={`Add a card on ${s}`} onClick={() => onOpen({ col: cols[0].id, v: { [field.id]: s } })}><Plus size={13} /></button>}</div>
              {list.slice(0, 3).map((c) => <button key={c.id} className="bd-cal-card" style={{ '--c': colOf.get(c.col)?.color } as React.CSSProperties} onClick={() => onOpen({ id: c.id })} title={c.title}><i />{c.title || 'Untitled'}</button>)}
              {list.length > 3 && <span className="bd-more">+{list.length - 3} more</span>}
            </div>)
        })}
      </div>
      {undated > 0 && <p className="bd-foot">{undated} {undated === 1 ? 'card has' : 'cards have'} no “{field.name}” and {undated === 1 ? "isn't" : "aren't"} shown here.</p>}
    </div>
  )
}

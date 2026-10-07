import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { Popover } from './Popover'

const pad = (n: number) => String(n).padStart(2, '0')
export const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`
export function parseIso(s: string | undefined): { y: number; m: number; d: number } | null {
  const r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '')
  if (!r) return null
  const y = +r[1], m = +r[2] - 1, d = +r[3], t = new Date(y, m, d)
  return t.getFullYear() === y && t.getMonth() === m && t.getDate() === d ? { y, m, d } : null
}
const todayIso = () => { const t = new Date(); return iso(t.getFullYear(), t.getMonth(), t.getDate()) }
const monthName = (m: number, style: 'long' | 'short' = 'long') => new Intl.DateTimeFormat(undefined, { month: style }).format(new Date(2024, m, 1))
const WEEKDAYS = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(undefined, { weekday: 'narrow' }).format(new Date(2024, 0, 7 + i)))   // 7 Jan 2024 is a Sunday
const WEEKDAYS_LONG = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(new Date(2024, 0, 7 + i)))
const dow = (s: string) => { const p = parseIso(s)!; return new Date(p.y, p.m, p.d).getDay() }
const label = (s: string) => { const p = parseIso(s); return p ? new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(new Date(p.y, p.m, p.d)) : '' }

/** Styled date picker (replaces the browser's <input type="date">). Values are plain "YYYY-MM-DD" strings. */
export function DatePicker({ value, onChange, min, max, placeholder = 'Pick a date', className = '', id, ariaLabel, onClose }: {
  value: string; onChange: (v: string) => void; min?: string; max?: string; placeholder?: string; className?: string; id?: string; ariaLabel?: string; onClose?: () => void
}) {
  return (
    <Popover className="dp-pop" onOpenChange={(o) => { if (!o) onClose?.() }}
      trigger={({ toggle, open }) => (
        <button type="button" id={id} className={`dp-btn ${className} ${open ? 'open' : ''} ${value ? '' : 'empty'}`} aria-label={ariaLabel ?? placeholder} aria-haspopup="dialog" aria-expanded={open} onClick={toggle}>
          <CalendarDays size={17} /><span>{label(value) || placeholder}</span>
        </button>)}>
      {(close) => <Calendar value={value} min={min} max={max} onPick={(v) => { onChange(v); close() }} onClear={() => { onChange(''); close() }} />}
    </Popover>
  )
}

function Calendar({ value, min, max, onPick, onClear }: { value: string; min?: string; max?: string; onPick: (v: string) => void; onClear: () => void }) {
  const start = parseIso(value) ?? parseIso(todayIso())!
  const [view, setView] = useState<'days' | 'months' | 'years'>('days')
  const [ym, setYm] = useState({ y: start.y, m: start.m })
  const [focus, setFocus] = useState(iso(start.y, start.m, start.d))
  const [yearBase, setYearBase] = useState(Math.floor(start.y / 12) * 12)
  const grid = useRef<HTMLDivElement>(null)
  const moved = useRef(false)
  const today = todayIso()

  const off = (s: string) => (!!min && s < min) || (!!max && s > max)
  const days = useMemo(() => {
    const first = new Date(ym.y, ym.m, 1).getDay(), len = new Date(ym.y, ym.m + 1, 0).getDate()
    return [...Array(first).fill(null), ...Array.from({ length: len }, (_, i) => i + 1)] as (number | null)[]
  }, [ym])
  const shift = (n: number) => setYm(({ y, m }) => { const t = new Date(y, m + n, 1); return { y: t.getFullYear(), m: t.getMonth() } })

  // keep the keyboard-focused day in view and focused after arrow keys
  useEffect(() => { if (moved.current) grid.current?.querySelector<HTMLButtonElement>(`[data-d="${focus}"]`)?.focus() }, [focus, ym])

  const go = (n: number) => {
    const p = parseIso(focus)!; const t = new Date(p.y, p.m, p.d + n)
    moved.current = true; setFocus(iso(t.getFullYear(), t.getMonth(), t.getDate())); setYm({ y: t.getFullYear(), m: t.getMonth() })
  }
  const key = (e: React.KeyboardEvent) => {
    const k = e.key
    if (k === 'ArrowLeft') go(-1); else if (k === 'ArrowRight') go(1); else if (k === 'ArrowUp') go(-7); else if (k === 'ArrowDown') go(7)
    else if (k === 'PageUp' || k === 'PageDown') { const p = parseIso(focus)!; const t = new Date(p.y, p.m + (k === 'PageUp' ? -1 : 1), p.d); moved.current = true; setFocus(iso(t.getFullYear(), t.getMonth(), t.getDate())); setYm({ y: t.getFullYear(), m: t.getMonth() }) }
    else if (k === 'Home') go(-dow(focus))
    else if (k === 'End') go(6 - dow(focus))
    else return
    e.preventDefault()
  }

  return (
    <div className="dp" role="dialog" aria-label="Choose a date">
      <div className="dp-head">
        {view === 'days' && <button type="button" className="icon-btn sm" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft size={18} /></button>}
        {view === 'years' && <button type="button" className="icon-btn sm" aria-label="Previous years" onClick={() => setYearBase((b) => b - 12)}><ChevronLeft size={18} /></button>}
        {view === 'months' && <button type="button" className="icon-btn sm" aria-label="Previous year" onClick={() => setYm((v) => ({ ...v, y: v.y - 1 }))}><ChevronLeft size={18} /></button>}
        <button type="button" className="dp-title" aria-live="polite" onClick={() => { setView(view === 'days' ? 'months' : view === 'months' ? 'years' : 'days'); setYearBase(Math.floor(ym.y / 12) * 12) }}>
          {view === 'days' ? `${monthName(ym.m)} ${ym.y}` : view === 'months' ? String(ym.y) : `${yearBase} – ${yearBase + 11}`}
        </button>
        {view === 'days' && <button type="button" className="icon-btn sm" aria-label="Next month" onClick={() => shift(1)}><ChevronRight size={18} /></button>}
        {view === 'years' && <button type="button" className="icon-btn sm" aria-label="Next years" onClick={() => setYearBase((b) => b + 12)}><ChevronRight size={18} /></button>}
        {view === 'months' && <button type="button" className="icon-btn sm" aria-label="Next year" onClick={() => setYm((v) => ({ ...v, y: v.y + 1 }))}><ChevronRight size={18} /></button>}
      </div>

      {view === 'days' && (
        <>
          <div className="dp-week" aria-hidden="true">{WEEKDAYS.map((w, i) => <span key={i}>{w}</span>)}</div>
          <div className="dp-grid" role="grid" ref={grid} onKeyDown={key}>
            {days.map((d, i) => {
              if (d === null) return <span key={`e${i}`} />
              const s = iso(ym.y, ym.m, d), isOff = off(s)
              const dow = new Date(ym.y, ym.m, d).getDay()
              return (
                <button type="button" key={s} data-d={s} disabled={isOff} tabIndex={s === focus || (!parseIso(focus) && d === 1) ? 0 : -1}
                  aria-label={`${WEEKDAYS_LONG[dow]}, ${label(s)}`} aria-pressed={s === value}
                  className={`${s === value ? 'sel' : ''} ${s === today ? 'today' : ''}`}
                  onClick={() => onPick(s)} onFocus={() => setFocus(s)}>{d}</button>)
            })}
          </div>
        </>
      )}
      {view === 'months' && (
        <div className="dp-pick">{Array.from({ length: 12 }, (_, m) => {
          const lo = iso(ym.y, m, 1), hi = iso(ym.y, m, new Date(ym.y, m + 1, 0).getDate())
          return <button type="button" key={m} disabled={(!!min && hi < min) || (!!max && lo > max)} className={m === start.m && ym.y === start.y ? 'sel' : ''} onClick={() => { setYm({ y: ym.y, m }); setFocus(iso(ym.y, m, 1)); setView('days') }}>{monthName(m, 'short')}</button>
        })}</div>
      )}
      {view === 'years' && (
        <div className="dp-pick">{Array.from({ length: 12 }, (_, i) => yearBase + i).map((y) => (
          <button type="button" key={y} disabled={(!!min && iso(y, 11, 31) < min) || (!!max && iso(y, 0, 1) > max)} className={y === start.y ? 'sel' : ''} onClick={() => { setYm((v) => ({ ...v, y })); setView('months') }}>{y}</button>
        ))}</div>
      )}

      <div className="dp-foot">
        <button type="button" className="btn btn-pill btn-ghost btn-sm" onClick={onClear} disabled={!value}>Clear</button>
        <button type="button" className="btn btn-pill btn-soft btn-sm" disabled={off(today)} onClick={() => onPick(today)}>Today</button>
      </div>
    </div>
  )
}

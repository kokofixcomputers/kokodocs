import { useEffect, useRef } from 'react'
import { Clock } from 'lucide-react'
import { Popover } from './Popover'

const pad = (n: number) => String(n).padStart(2, '0')
const H12 = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12 ?? false
export function parseTime(s: string | undefined): { h: number; m: number } | null {
  const r = /^(\d{2}):(\d{2})$/.exec(s ?? '')
  return r && +r[1] < 24 && +r[2] < 60 ? { h: +r[1], m: +r[2] } : null
}
const label = (s: string) => { const t = parseTime(s); return t ? new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(new Date(2024, 0, 1, t.h, t.m)) : '' }

/** Styled time picker (replaces the browser's <input type="time">). Values are "HH:MM" in 24-hour form; the list follows the visitor's 12/24-hour preference. */
export function TimePicker({ value, onChange, placeholder = 'Pick a time', className = '', id, ariaLabel, onClose }: {
  value: string; onChange: (v: string) => void; placeholder?: string; className?: string; id?: string; ariaLabel?: string; onClose?: () => void
}) {
  return (
    <Popover className="dp-pop tp-pop" onOpenChange={(o) => { if (!o) onClose?.() }}
      trigger={({ toggle, open }) => (
        <button type="button" id={id} className={`dp-btn ${className} ${open ? 'open' : ''} ${value ? '' : 'empty'}`} aria-label={ariaLabel ?? placeholder} aria-haspopup="dialog" aria-expanded={open} onClick={toggle}>
          <Clock size={17} /><span>{label(value) || placeholder}</span>
        </button>)}>
      {(close) => <Wheel value={value} onChange={onChange} onClear={() => { onChange(''); close() }} close={close} />}
    </Popover>
  )
}

function Wheel({ value, onChange, onClear, close }: { value: string; onChange: (v: string) => void; onClear: () => void; close: () => void }) {
  const t = parseTime(value)
  const h = t?.h ?? -1, m = t?.m ?? -1
  const set = (nh: number, nm: number) => onChange(`${pad(nh)}:${pad(nm)}`)
  const hours = H12 ? Array.from({ length: 12 }, (_, i) => (i === 0 ? 12 : i)) : Array.from({ length: 24 }, (_, i) => i)
  const pm = h >= 12
  const hourVal = (display: number) => (H12 ? (display % 12) + (pm ? 12 : 0) : display)
  const shown = (hh: number) => (H12 ? (hh % 12 === 0 ? 12 : hh % 12) : hh)
  const root = useRef<HTMLDivElement>(null)
  // bring the chosen hour and minute into view when the panel opens
  useEffect(() => { root.current?.querySelectorAll<HTMLElement>('.on').forEach((el) => el.scrollIntoView({ block: 'center' })) }, [])
  const now = () => { const d = new Date(); set(d.getHours(), d.getMinutes()) }
  return (
    <div className="tp" role="dialog" aria-label="Choose a time" ref={root}>
      <div className="tp-cols">
        <div className="tp-col" role="listbox" aria-label="Hour">
          {hours.map((d) => <button type="button" key={d} role="option" aria-selected={h >= 0 && shown(h) === d} className={h >= 0 && shown(h) === d ? 'on' : ''} onClick={() => set(hourVal(d), Math.max(m, 0))}>{H12 ? d : pad(d)}</button>)}
        </div>
        <div className="tp-col" role="listbox" aria-label="Minute">
          {Array.from({ length: 60 }, (_, i) => <button type="button" key={i} role="option" aria-selected={m === i} className={m === i ? 'on' : ''} onClick={() => set(h < 0 ? (H12 ? 12 : 0) : h, i)}>{pad(i)}</button>)}
        </div>
        {H12 && (
          <div className="tp-col tp-ampm" role="listbox" aria-label="AM or PM">
            {['AM', 'PM'].map((p) => { const on = h >= 0 && (p === 'PM') === pm; return <button type="button" key={p} role="option" aria-selected={on} className={on ? 'on' : ''} onClick={() => { const base = h < 0 ? 0 : h % 12; set(base + (p === 'PM' ? 12 : 0), Math.max(m, 0)) }}>{p}</button> })}
          </div>
        )}
      </div>
      <div className="dp-foot">
        <button type="button" className="btn btn-pill btn-ghost btn-sm" onClick={onClear} disabled={!value}>Clear</button>
        <span className="tp-right"><button type="button" className="btn btn-pill btn-soft btn-sm" onClick={now}>Now</button><button type="button" className="btn btn-pill btn-primary btn-sm" onClick={close}>Done</button></span>
      </div>
    </div>
  )
}

import { Check, ChevronDown } from 'lucide-react'
import { Popover } from './Popover'

export interface Option<T extends string> { value: T; label: string; color?: string }

/** Styled dropdown (replaces the browser's native <select>). The menu never steals focus from the editor. */
export function Select<T extends string>({ value, options, onChange, label, className = '', tone }: { value: T; options: Option<T>[]; onChange: (v: T) => void; label: string; className?: string; tone?: string }) {
  const cur = options.find((o) => o.value === value) ?? options[0]
  return (
    <Popover className="select-pop" trigger={({ toggle, open }) => (
      <button type="button" className={`select-btn ${open ? 'open' : ''} ${className}`} data-tone={tone} aria-label={label} aria-haspopup="listbox" aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()} onClick={toggle}>
        {cur?.color && <i className="dot" style={{ background: cur.color }} />}<span>{cur?.label}</span><ChevronDown size={14} />
      </button>)}>
      {(close) => (
        <div className="menu select-menu" role="listbox" aria-label={label}>
          {options.map((o) => (
            <button key={o.value} role="option" aria-selected={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => { close(); onChange(o.value) }}>
              {o.color && <i className="dot" style={{ background: o.color }} />}<span>{o.label}</span>{o.value === value && <Check size={14} className="tick" />}
            </button>
          ))}
        </div>
      )}
    </Popover>
  )
}

import { Check } from 'lucide-react'
import { Popover } from './Popover'

/** A text box with a styled list of suggestions (replaces <input list> + <datalist>, which draws the browser's own menu).
 *  Any text can still be typed; the list narrows as you type and clicking a suggestion fills it in. */
export function ComboInput({ value, options, onChange, placeholder, label }: { value: string; options: string[]; onChange: (v: string) => void; placeholder?: string; label?: string }) {
  const q = value.trim().toLowerCase()
  const shown = options.filter((o) => !q || o.toLowerCase().includes(q) || o === value)
  return (
    <Popover className="combo-pop" trigger={({ open, toggle }) => (
      <input value={value} placeholder={placeholder} aria-label={label} spellCheck={false} autoComplete="off" role="combobox" aria-expanded={open} aria-autocomplete="list"
        onFocus={() => { if (!open && options.length) toggle() }} onClick={() => { if (!open && options.length) toggle() }}
        onChange={(e) => { onChange(e.target.value); if (!open && options.length) toggle() }}
        onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); toggle() } }} />)}>
      {(close) => shown.length === 0 ? <div className="menu select-menu combo-menu"><p className="combo-none">No suggestions. Your text is used as it is.</p></div> : (
        <div className="menu select-menu combo-menu" role="listbox">
          {shown.map((o) => (
            <button key={o} type="button" role="option" aria-selected={o === value} className={o === value ? 'on' : ''} onClick={() => { close(); onChange(o) }}>
              <span>{o}</span>{o === value && <Check size={14} className="tick" />}
            </button>))}
        </div>)}
    </Popover>
  )
}

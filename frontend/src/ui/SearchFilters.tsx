import { useState } from 'react'
import { Check, ChevronDown, X } from 'lucide-react'
import type { DocKind } from '../api'
import { KindIcon } from './KindIcon'
import { Popover } from './Popover'

/** Narrow a search by type, by who owns the file, and by when it last changed. */
export interface Filters { kinds: DocKind[]; owner: 'any' | 'me' | 'shared'; days: number }
export const NO_FILTERS: Filters = { kinds: [], owner: 'any', days: 0 }
export const filterCount = (f: Filters) => (f.kinds.length ? 1 : 0) + (f.owner !== 'any' ? 1 : 0) + (f.days ? 1 : 0)

export const KIND_NAMES: Record<DocKind, string> = { doc: 'Documents', sheet: 'Spreadsheets', slides: 'Presentations', form: 'Forms', wiki: 'Wikis', board: 'Boards', whiteboard: 'Whiteboards' }
const KINDS = Object.keys(KIND_NAMES) as DocKind[]
const DAYS = [{ d: 0, t: 'Any time' }, { d: 1, t: 'Today' }, { d: 7, t: 'Last 7 days' }, { d: 30, t: 'Last 30 days' }, { d: 365, t: 'Last year' }]
const OWNERS = [{ o: 'any', t: 'Anyone' }, { o: 'me', t: 'Me' }, { o: 'shared', t: 'Shared with me' }] as const

/** the query-string part for /api/search */
export const filterQuery = (f: Filters) => (f.kinds.length ? `&kind=${f.kinds.join(',')}` : '') + (f.owner !== 'any' ? `&owner=${f.owner}` : '') + (f.days ? `&days=${f.days}` : '')

/** the same test, for lists the page already has (the owner is known from which list the file came from) */
export const passes = (f: Filters, d: { kind: DocKind; updated_at: number }, mine: boolean) =>
  (!f.kinds.length || f.kinds.includes(d.kind)) && (f.owner === 'any' || (f.owner === 'me') === mine) && (!f.days || d.updated_at >= Date.now() / 1000 - f.days * 86400)

export function FilterBar({ value, onChange, compact }: { value: Filters; onChange: (f: Filters) => void; compact?: boolean }) {
  const [openType, setOpenType] = useState(false)
  const toggleKind = (k: DocKind) => onChange({ ...value, kinds: value.kinds.includes(k) ? value.kinds.filter((x) => x !== k) : [...value.kinds, k] })
  const typeLabel = value.kinds.length === 0 ? 'Type' : value.kinds.length === 1 ? KIND_NAMES[value.kinds[0]] : `${value.kinds.length} types`
  const dayLabel = DAYS.find((x) => x.d === value.days)?.t ?? 'Date'
  return (
    <div className={`sf-bar ${compact ? 'compact' : ''}`} role="group" aria-label="Search filters" onMouseDown={(e) => { if (!(e.target as HTMLElement).closest('select, input')) e.preventDefault() }}>
      <Popover align="start" onOpenChange={setOpenType} trigger={({ toggle }) => (
        <button type="button" className={`sf-chip ${value.kinds.length ? 'on' : ''} ${openType ? 'open' : ''}`} aria-haspopup="listbox" onClick={toggle}>{typeLabel}<ChevronDown size={14} /></button>
      )}>
        {() => <div className="sf-pop" role="listbox" aria-label="Type" aria-multiselectable="true">
          {KINDS.map((k) => {
            const on = value.kinds.includes(k)
            return <button key={k} type="button" role="option" aria-selected={on} className={`sf-opt ${on ? 'on' : ''}`} onClick={() => toggleKind(k)}><i className={`k-${k}`}><KindIcon kind={k} size={15} /></i>{KIND_NAMES[k]}{on && <Check size={15} className="sf-check" />}</button>
          })}
        </div>}
      </Popover>
      <span className="seg mini sf-owner" role="radiogroup" aria-label="Owner">
        {OWNERS.map((x) => <button key={x.o} type="button" role="radio" aria-checked={value.owner === x.o} className={value.owner === x.o ? 'on' : ''} onClick={() => onChange({ ...value, owner: x.o })}>{x.t}</button>)}
      </span>
      <label className={`sf-chip sf-date ${value.days ? 'on' : ''}`}>
        <select aria-label="Last changed" value={value.days} onChange={(e) => onChange({ ...value, days: Number(e.target.value) })}>{DAYS.map((x) => <option key={x.d} value={x.d}>{x.d ? `Changed: ${x.t.toLowerCase()}` : 'Any time'}</option>)}</select>
        <span aria-hidden="true">{value.days ? dayLabel : 'Any time'}</span><ChevronDown size={14} />
      </label>
      {filterCount(value) > 0 && <button type="button" className="sf-clear" onClick={() => onChange(NO_FILTERS)}><X size={13} />Clear filters</button>}
    </div>
  )
}

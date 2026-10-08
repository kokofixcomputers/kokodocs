import { Calendar, CheckSquare, Link2 } from 'lucide-react'
import { isEmpty, type FieldDef, type Value } from './model'

export type F = { id: string } & FieldDef
export const fmtDate = (s: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(+m[1], +m[2] - 1, +m[3])) : s }
export const today = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}` }

export function Chip({ f, v }: { f: F; v: Value | undefined }) {
  if (isEmpty(v)) return null
  if (f.type === 'single' || f.type === 'multi') {
    const ids = Array.isArray(v) ? v : [String(v)]
    return <>{ids.map((id) => { const o = f.options?.find((x) => x.id === id); return o ? <span key={id} className="bd-chip" style={{ '--c': o.color } as React.CSSProperties} title={f.name}><i />{o.label}</span> : null })}</>
  }
  if (f.type === 'date') return <span className="bd-chip plain" title={f.name}><Calendar size={12} />{fmtDate(String(v))}</span>
  if (f.type === 'checkbox') return <span className="bd-chip plain" title={f.name}><CheckSquare size={12} />{f.name}</span>
  if (f.type === 'link') return <span className="bd-chip plain" title={f.name}><Link2 size={12} />{String(v).replace(/^https?:\/\//, '').slice(0, 24)}</span>
  return <span className="bd-chip plain" title={f.name}>{f.type === 'number' ? `${f.name}: ` : ''}{String(v)}</span>
}



/** Whole days since 1970 for a YYYY-MM-DD string (no time zones involved), and back. */
export const toDay = (s: string): number | null => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : null }
export const fromDay = (n: number): string => new Date(n * 86400000).toISOString().slice(0, 10)

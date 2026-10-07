import type { CSSProperties } from 'react'
import { X } from 'lucide-react'

/** A tag always gets the same hue, so it is recognisable at a glance anywhere it shows up. */
export const tagHue = (name: string) => { let h = 0; for (const c of name.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) % 360; return h }

/** Same rules the server applies: trimmed, single spaces, no commas, at most 30 characters, no duplicates ignoring case, at most 12. */
export const MAX_TAGS = 12
export function cleanTags(raw: string[]): string[] {
  const out: string[] = [], seen = new Set<string>()
  for (const r of raw) {
    const t = r.replace(/,/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30).trim()
    if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t) }
  }
  return out.slice(0, MAX_TAGS)
}

export function TagChip({ name, onClick, onRemove, active }: { name: string; onClick?: () => void; onRemove?: () => void; active?: boolean }) {
  const style = { '--tc': `hsl(${tagHue(name)} 70% 48%)` } as CSSProperties
  const inner = <><i className="tag-dot" />{name}</>
  return (
    <span className={`tag-chip ${active ? 'on' : ''} ${onClick ? 'click' : ''}`} style={style}>
      {onClick ? <button type="button" className="tag-main" onClick={(e) => { e.stopPropagation(); onClick() }} title={`Show only “${name}”`}>{inner}</button> : <span className="tag-main">{inner}</span>}
      {onRemove && <button type="button" className="tag-x" aria-label={`Remove tag ${name}`} onClick={(e) => { e.stopPropagation(); onRemove() }}><X size={12} /></button>}
    </span>
  )
}

/** The tags on a row: the first few as chips (click one to filter by it), the rest as "+N". */
export function RowTags({ tags, onPick, max = 3 }: { tags?: string[]; onPick: (t: string) => void; max?: number }) {
  if (!tags?.length) return null
  return (
    <span className="row-tags">
      {tags.slice(0, max).map((t) => <TagChip key={t} name={t} onClick={() => onPick(t)} />)}
      {tags.length > max && <span className="tag-more" title={tags.slice(max).join(', ')}>+{tags.length - max}</span>}
    </span>
  )
}

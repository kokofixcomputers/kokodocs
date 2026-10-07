import { useEffect, useState } from 'react'
import { Sigma } from 'lucide-react'
import { addr, parseAddr } from './engine/refs'
import type { Editing, Sel } from './Grid'
import type { Rect } from './model'

export function FormulaBar({ sel, rect, raw, editing, readOnly, startEdit, setText, commit, cancel, goTo }: {
  sel: Sel; rect: Rect; raw: string; editing: Editing | null; readOnly: boolean
  startEdit: (e: Editing) => void; setText: (t: string) => void; commit: (dr: number, dc: number) => void; cancel: () => void
  goTo: (r1: number, c1: number, r2: number, c2: number) => void
}) {
  const label = rect.r1 === rect.r2 && rect.c1 === rect.c2 ? addr(rect.r1, rect.c1) : `${addr(rect.r1, rect.c1)}:${addr(rect.r2, rect.c2)}`
  const [name, setName] = useState(label)
  useEffect(() => setName(label), [label])

  const go = () => {
    const parts = name.split(':').map((s) => parseAddr(s))
    if (parts[0] && (parts.length === 1 || parts[1])) goTo(parts[0].r, parts[0].c, (parts[1] ?? parts[0]).r, (parts[1] ?? parts[0]).c)
    else setName(label)
  }
  return (
    <div className="fbar">
      <input className="fbar-name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); go() } if (e.key === 'Escape') setName(label) }}
        onBlur={() => setName(label)} aria-label="Cell address" spellCheck={false} />
      <span className="fbar-fx" title="Formula"><Sigma size={15} /></span>
      <input className="fbar-input" value={editing ? editing.text : raw} readOnly={readOnly} spellCheck={false} aria-label="Formula bar"
        onFocus={() => { if (!editing && !readOnly) startEdit({ r: sel.ar, c: sel.ac, text: raw, mode: 'edit', from: 'bar' }) }}
        onChange={(e) => { if (!editing) startEdit({ r: sel.ar, c: sel.ac, text: e.target.value, mode: 'edit', from: 'bar' }); else setText(e.target.value) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(1, 0) }
          else if (e.key === 'Escape') { e.preventDefault(); cancel(); (e.target as HTMLElement).blur() }
        }}
        onBlur={(e) => { const rt = e.relatedTarget as HTMLElement | null; if (editing && editing.from === 'bar' && (!rt || !rt.closest('.sheet-shell'))) commit(0, 0) }} />
    </div>
  )
}

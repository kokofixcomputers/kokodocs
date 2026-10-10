import { useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react'

/** Sticky notes: small coloured notes that float over the page and stay in view while the page scrolls. Kept in the shared document, so everyone sees them (viewers read only). */

export const STICKY_COLORS = ['#fff3a3', '#ffd6e0', '#cdeed3', '#cfe6ff', '#e6d9ff'] as const
interface Note { id: string; x: number; y: number; w: number; h: number; color: string; collapsed: boolean; text: string }

const notesMap = (doc: Y.Doc, key: string) => doc.getMap<Y.Map<unknown>>(key)
const read = (id: string, m: Y.Map<unknown>): Note => ({
  id, x: (m.get('x') as number) ?? 40, y: (m.get('y') as number) ?? 40, w: (m.get('w') as number) ?? 220, h: (m.get('h') as number) ?? 170,
  color: (m.get('color') as string) ?? STICKY_COLORS[0], collapsed: !!m.get('collapsed'), text: (m.get('text') as Y.Text | undefined)?.toString() ?? '',
})

export function addSticky(doc: Y.Doc, key: string) {
  const map = notesMap(doc, key), n = map.size
  doc.transact(() => {
    const m = new Y.Map<unknown>()
    map.set(Math.random().toString(36).slice(2, 10), m)
    m.set('x', 60 + (n % 6) * 28); m.set('y', 70 + (n % 6) * 28); m.set('w', 220); m.set('h', 170)
    m.set('color', STICKY_COLORS[n % STICKY_COLORS.length]); m.set('collapsed', false); m.set('text', new Y.Text())
  })
}

/** apply a textarea edit to the shared text as the smallest change (so two people typing in one note merge) */
function setText(t: Y.Text, next: string) {
  const prev = t.toString()
  let a = 0
  while (a < prev.length && a < next.length && prev[a] === next[a]) a++
  let b = 0
  while (b < prev.length - a && b < next.length - a && prev[prev.length - 1 - b] === next[next.length - 1 - b]) b++
  t.doc?.transact(() => { if (prev.length - a - b) t.delete(a, prev.length - a - b); if (next.length - a - b) t.insert(a, next.slice(a, next.length - b)) })
}

export function StickyLayer({ doc, mapKey, readOnly }: { doc: Y.Doc; mapKey: string; readOnly: boolean }) {
  const [notes, setNotes] = useState<Note[]>([])
  const layer = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const map = notesMap(doc, mapKey)
    const f = () => setNotes([...map.entries()].map(([id, m]) => read(id, m)))
    map.observeDeep(f); f()
    return () => map.unobserveDeep(f)
  }, [doc, mapKey])
  if (!notes.length) return null
  return (
    <div className="sticky-layer" ref={layer}>
      {notes.map((n) => <StickyCard key={n.id} note={n} doc={doc} mapKey={mapKey} readOnly={readOnly} layer={layer} />)}
    </div>
  )
}

function StickyCard({ note, doc, mapKey, readOnly, layer }: { note: Note; doc: Y.Doc; mapKey: string; readOnly: boolean; layer: React.RefObject<HTMLDivElement | null> }) {
  const m = () => notesMap(doc, mapKey).get(note.id)
  const [live, setLive] = useState<{ x: number; y: number; w: number; h: number } | null>(null)   // while dragging, only this browser moves it; the shared position is written on release
  const x = live?.x ?? note.x, y = live?.y ?? note.y, w = live?.w ?? note.w, h = live?.h ?? note.h
  const clamp = (v: number, size: number, max: number) => Math.max(0, Math.min(v, Math.max(0, max - size)))
  const box = () => { const r = layer.current?.getBoundingClientRect(); return { W: r?.width ?? 2000, H: r?.height ?? 2000 } }

  const drag = (kind: 'move' | 'size') => (e: React.PointerEvent) => {
    if (readOnly || (e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    const sx = e.clientX, sy = e.clientY, o = { x: note.x, y: note.y, w: note.w, h: note.h }, { W, H } = box()
    let cur = o
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy
      cur = kind === 'move' ? { ...o, x: clamp(o.x + dx, o.w, W), y: clamp(o.y + dy, 34, H) }
        : { ...o, w: Math.max(150, Math.min(o.w + dx, W - o.x)), h: Math.max(90, Math.min(o.h + dy, H - o.y)) }
      setLive(cur)
    }
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      setLive(null)
      const mm = m(); if (!mm) return
      doc.transact(() => { (Object.keys(cur) as (keyof typeof cur)[]).forEach((k) => { if (mm.get(k) !== cur[k]) mm.set(k, Math.round(cur[k])) }) })
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }

  return (
    <div className={`sticky ${note.collapsed ? 'collapsed' : ''} ${live ? 'moving' : ''}`} style={{ left: x, top: y, width: w, height: note.collapsed ? 34 : h, ['--sticky' as string]: note.color }} role="group" aria-label="Sticky note">
      <div className="sticky-head" onPointerDown={drag('move')} style={{ cursor: readOnly ? 'default' : 'grab' }}>
        {!readOnly && !note.collapsed && (
          <span className="sticky-dots">{STICKY_COLORS.map((c) => (
            <button key={c} type="button" className={`sticky-dot ${c === note.color ? 'on' : ''}`} style={{ background: c }} aria-label="Change the note colour" onClick={() => m()?.set('color', c)} />
          ))}</span>
        )}
        {note.collapsed && <span className="sticky-peek">{note.text.split('\n')[0] || 'Note'}</span>}
        <span className="sticky-acts">
          <button type="button" className="sticky-btn" aria-label={note.collapsed ? 'Open the note' : 'Collapse the note'} title={note.collapsed ? 'Open' : 'Collapse'} onClick={() => m()?.set('collapsed', !note.collapsed)}>{note.collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}</button>
          {!readOnly && <button type="button" className="sticky-btn" aria-label="Delete the note" title="Delete" onClick={() => notesMap(doc, mapKey).delete(note.id)}><Trash2 size={13} /></button>}
        </span>
      </div>
      {!note.collapsed && (
        <>
          <textarea className="sticky-text" value={note.text} readOnly={readOnly} placeholder={readOnly ? '' : 'Write a note…'} aria-label="Note text" spellCheck
            onChange={(e) => { const t = (m()?.get('text') as Y.Text | undefined); if (t) setText(t, e.target.value) }} />
          {!readOnly && <span className="sticky-grip" onPointerDown={drag('size')} aria-hidden="true" />}
        </>
      )}
    </div>
  )
}

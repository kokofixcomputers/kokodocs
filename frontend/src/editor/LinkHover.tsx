import { viewBottom, viewRight } from '../ui/viewport'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'
import { Check, Copy, ExternalLink, Link2, Pencil, Unlink, X } from 'lucide-react'
import { toast } from '../ui/Toast'

interface Hit { el: HTMLAnchorElement; href: string; rect: DOMRect }
const normalize = (u: string) => (/^(https?:|mailto:)/i.test(u.trim()) ? u.trim() : `https://${u.trim()}`)
const shown = (href: string) => { const s = href.replace(/^https?:\/\//i, '').replace(/^mailto:/i, '').replace(/\/$/, ''); return s.length > 44 ? s.slice(0, 43) + '…' : s }

/** A small pill that floats under a link when you point at it: the address, plus open, copy, edit and remove. */
export function LinkHover({ editor }: { editor: Editor }) {
  const [hit, setHit] = useState<Hit | null>(null)
  const [editing, setEditing] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const pill = useRef<HTMLDivElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const editingRef = useRef(false)
  editingRef.current = editing

  useEffect(() => {
    const dom = editor.view.dom as HTMLElement
    const cancel = () => window.clearTimeout(timer.current)
    const later = () => { cancel(); timer.current = window.setTimeout(() => { if (!editingRef.current) setHit(null) }, 220) }
    const show = (a: HTMLAnchorElement, e?: MouseEvent) => {
      cancel()
      const rects = Array.from(a.getClientRects())
      const r = (e && rects.find((x) => e.clientY >= x.top - 2 && e.clientY <= x.bottom + 2)) || rects[0] || a.getBoundingClientRect()
      setHit((h) => (h?.el === a && !editingRef.current ? { ...h, rect: r } : h?.el === a ? h : (setEditing(false), { el: a, href: a.getAttribute('href') ?? '', rect: r })))
    }
    const over = (e: MouseEvent) => { const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null; if (a && dom.contains(a)) show(a, e) }
    const out = (e: MouseEvent) => { if ((e.target as HTMLElement | null)?.closest?.('a[href]')) later() }
    const click = (e: MouseEvent) => { const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null; if (a && dom.contains(a)) show(a, e) }   // taps on a phone
    const hide = () => { if (!editingRef.current) setHit(null) }
    const typing = (e: KeyboardEvent) => { if (!editingRef.current && e.key !== 'Shift' && e.key !== 'Control' && e.key !== 'Meta' && e.key !== 'Alt') setHit(null) }
    dom.addEventListener('mouseover', over); dom.addEventListener('mouseout', out); dom.addEventListener('click', click); dom.addEventListener('keydown', typing); dom.addEventListener('contextmenu', hide)
    window.addEventListener('scroll', hide, true); window.addEventListener('resize', hide)
    editor.on('update', hide)
    return () => {
      cancel(); dom.removeEventListener('mouseover', over); dom.removeEventListener('mouseout', out); dom.removeEventListener('click', click); dom.removeEventListener('keydown', typing); dom.removeEventListener('contextmenu', hide)
      window.removeEventListener('scroll', hide, true); window.removeEventListener('resize', hide); editor.off('update', hide)
    }
  }, [editor])

  // sit just under the link, centred, and stay on screen
  useEffect(() => {
    if (!hit || !pill.current) { setPos(null); return }
    const p = pill.current.getBoundingClientRect(), r = hit.rect
    let left = r.left + r.width / 2 - p.width / 2
    left = Math.max(8, Math.min(left, viewRight() - p.width - 8))
    let top = r.bottom + 8
    if (top + p.height > viewBottom() - 8) top = Math.max(8, r.top - p.height - 8)
    setPos((c) => (c && c.left === left && c.top === top ? c : { left, top }))
  }, [hit, editing])

  if (!hit) return null
  const editable = editor.isEditable
  const select = () => {   // select the whole link so the next command applies to all of it
    const at = editor.view.posAtDOM(hit.el, 0)
    editor.chain().focus().setTextSelection(at + 1).extendMarkRange('link').run()
  }
  const apply = (url: string) => {
    if (!url.trim()) { select(); editor.chain().focus().unsetLink().run() }
    else { select(); editor.chain().focus().setLink({ href: normalize(url) }).run() }
    setEditing(false); setHit(null)
  }
  const keep = () => window.clearTimeout(timer.current)
  const later = () => { if (!editing) { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => { if (!editingRef.current) setHit(null) }, 220) } }

  return createPortal(
    <div ref={pill} className={`link-pill ${editing ? 'editing' : ''}`} role="toolbar" aria-label="Link"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, visibility: pos ? 'visible' : 'hidden' }}
      onMouseEnter={keep} onMouseLeave={later} onMouseDown={(e) => { if (!(e.target as HTMLElement).closest('input')) e.preventDefault() }}>
      {editing ? (
        <form className="lp-form" onSubmit={(e) => { e.preventDefault(); apply((e.currentTarget.elements.namedItem('url') as HTMLInputElement).value) }}>
          <Link2 size={16} />
          <input name="url" autoFocus onFocus={(e) => e.currentTarget.select()} spellCheck={false} defaultValue={hit.href} placeholder="Paste a link" aria-label="Link address" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setEditing(false) } }} />
          <button type="submit" className="lp-btn" aria-label="Save link" title="Save"><Check size={16} /></button>
          <button type="button" className="lp-btn" aria-label="Cancel" title="Cancel" onClick={() => setEditing(false)}><X size={16} /></button>
        </form>
      ) : (
        <>
          <a className="lp-url" href={hit.href} target="_blank" rel="noopener noreferrer" title={hit.href}><Link2 size={15} /><span>{shown(hit.href)}</span></a>
          <button type="button" className="lp-btn" aria-label="Open link" title="Open in a new tab" onClick={() => window.open(hit.href, '_blank', 'noopener,noreferrer')}><ExternalLink size={15} /></button>
          <button type="button" className="lp-btn" aria-label="Copy link" title="Copy link" onClick={() => navigator.clipboard.writeText(hit.href).then(() => toast('Link copied'), () => toast(hit.href))}><Copy size={15} /></button>
          {editable && <button type="button" className="lp-btn" aria-label="Edit link" title="Edit link" onClick={() => setEditing(true)}><Pencil size={15} /></button>}
          {editable && <button type="button" className="lp-btn" aria-label="Remove link" title="Remove link" onClick={() => { select(); editor.chain().focus().unsetLink().run(); setHit(null) }}><Unlink size={15} /></button>}
        </>
      )}
    </div>, document.body)
}

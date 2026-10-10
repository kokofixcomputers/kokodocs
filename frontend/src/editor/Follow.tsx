import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as Y from 'yjs'
import type { Editor } from '@tiptap/react'
import { relativePositionToAbsolutePosition, ySyncPluginKey } from 'y-prosemirror'
import { Eye, X } from 'lucide-react'
import { Avatar } from '../ui/Avatar'
import { toast } from '../ui/Toast'
import type { KokoProvider } from '../collab'

/** Follow mode: pick a collaborator's picture at the top and your view stays with their cursor, scrolling as they type or move around (and, in a wiki, going to the page they are on).
 *  Scrolling, clicking or typing yourself stops it. */
export interface Person { id: number; name: string; color: string }

export function useFollow({ provider, editor, scroller, page, goPage }: {
  provider: KokoProvider; editor: Editor | null; scroller: React.RefObject<HTMLElement | null>; page?: string | null; goPage?: (id: string) => void
}) {
  const [target, setTarget] = useState<Person | null>(null)
  const pageRef = useRef(page); pageRef.current = page
  const edRef = useRef(editor); edRef.current = editor
  const goRef = useRef(goPage); goRef.current = goPage
  const stop = useCallback(() => setTarget(null), [])
  const toggle = useCallback((p: Person) => setTarget((t) => (t?.id === p.id ? null : p)), [])

  useEffect(() => {
    if (!target) return
    const aw = provider.awareness
    let busy = 0
    const look = () => {
      const s = aw.getStates().get(target.id) as { user?: { name: string }; cursor?: { head?: unknown }; page?: string } | undefined
      if (!s) { toast(`${target.name} left, so you stopped following`); setTarget(null); return }
      if (s.page && goRef.current && s.page !== pageRef.current) { goRef.current(s.page); return }   // they are on another page of the wiki: go there too
      const ed = edRef.current, box = scroller.current
      if (!ed || !box || !s.cursor?.head) return
      const ys = ySyncPluginKey.getState(ed.state) as { doc: Y.Doc; type: Y.XmlFragment; binding: { mapping: Map<Y.AbstractType<unknown>, unknown> } } | undefined
      if (!ys) return
      try {
        const abs = relativePositionToAbsolutePosition(ys.doc, ys.type, Y.createRelativePositionFromJSON(s.cursor.head), ys.binding.mapping as never)
        if (abs == null) return
        const c = ed.view.coordsAtPos(Math.min(abs, ed.state.doc.content.size)), r = box.getBoundingClientRect()
        if (c.top < r.top + 70 || c.bottom > r.bottom - 90) {
          window.clearTimeout(busy)
          busy = window.setTimeout(() => box.scrollBy({ top: c.top - (r.top + r.height * 0.35), behavior: 'smooth' }), 60)
        }
      } catch { /* their position isn't in this page yet */ }
    }
    aw.on('change', look); look()
    const box = scroller.current, dom = edRef.current?.view.dom
    const off = () => setTarget(null)
    box?.addEventListener('wheel', off, { passive: true }); box?.addEventListener('touchstart', off, { passive: true }); box?.addEventListener('pointerdown', off)
    dom?.addEventListener('keydown', off)
    return () => {
      window.clearTimeout(busy); aw.off('change', look)
      box?.removeEventListener('wheel', off); box?.removeEventListener('touchstart', off); box?.removeEventListener('pointerdown', off); dom?.removeEventListener('keydown', off)
    }
  }, [target, provider, scroller, editor])
  return { target, toggle, stop }
}

export function PresenceStack({ people, followId, onToggle }: { people: Person[]; followId: number | null; onToggle: (p: Person) => void }) {
  return (
    <div className="presence">
      {people.slice(0, 5).map((p) => (
        <button key={p.id} type="button" className={`pres-btn ${followId === p.id ? 'following' : ''}`} aria-pressed={followId === p.id}
          title={followId === p.id ? `Stop following ${p.name}` : `Follow ${p.name}: your view stays with their cursor`} aria-label={followId === p.id ? `Stop following ${p.name}` : `Follow ${p.name}`}
          style={{ ['--pc' as string]: p.color }} onClick={() => onToggle(p)}>
          <Avatar name={p.name} color={p.color} size={32} ring />{followId === p.id && <i className="pres-eye"><Eye size={10} /></i>}
        </button>))}
      {people.length > 5 && <span className="more" data-tip={people.slice(5).map((x) => x.name).join(', ')}>+{people.length - 5}</span>}
    </div>
  )
}

export function FollowPill({ target, onStop }: { target: Person | null; onStop: () => void }) {
  if (!target) return null
  return createPortal(
    <div className="follow-pill" role="status" style={{ ['--pc' as string]: target.color }}>
      <Eye size={15} /><span>Following <b>{target.name}</b></span>
      <button type="button" onClick={onStop} aria-label={`Stop following ${target.name}`}><X size={14} />Stop</button>
    </div>, document.body)
}

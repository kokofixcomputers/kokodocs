import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { arrowBetween } from './flowchart'
import { recognize, type Rec } from './recognize'
import { absPts, boundsOf, center, closed, corners, elbow, hit, inPolygon, pageBox, rot, shapeAt, union, type Box, type Pt } from './geometry'
import { fitText, layout } from './text'
import { ElNode } from './Scene'
import type { WhiteboardModel } from './model'
import { isLinear, isShape, type El, type ShapeKind, type Style, type Tool } from './types'
import { loadFont } from '../fonts'

export interface View { x: number; y: number; z: number }
export interface Remote { id: number; name: string; color: string; cursor?: { x: number; y: number }; sel?: string[] }
export interface BoardHandle { toWorld: (cx: number, cy: number) => Pt; size: () => { w: number; h: number } }

const MIN_Z = 0.05, MAX_Z = 8, HOLD_MS = 700
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
type Handle = (typeof HANDLES)[number]
const DEFAULT_SIZE: Partial<Record<string, [number, number]>> = { triangle: [140, 120], star: [130, 130], cylinder: [130, 150], ellipse: [160, 100], diamond: [160, 110] }

type Session =
  | { k: 'pan'; sx: number; sy: number; v: View }
  | { k: 'move'; start: Pt; ids: string[]; orig: Map<string, El>; moved: boolean; dup?: boolean }
  | { k: 'resize'; handle: Handle; ids: string[]; orig: Map<string, El>; box: Box; single: boolean }
  | { k: 'rotate'; el: El; c: Pt; a0: number }
  | { k: 'pt'; el: El; i: number }
  | { k: 'create'; tool: Tool; start: Pt; id: string }
  | { k: 'pen'; pts: Pt[]; hl: boolean; at: Pt; timer?: number; snapped?: { rec: Rec; el: El } }
  | { k: 'marquee'; start: Pt; keep: string[] }
  | { k: 'lasso'; pts: Pt[]; keep: string[] }
  | { k: 'erase'; hit: Set<string> }
  | { k: 'pinch'; d: number; mid: Pt; v: View }
  | { k: 'connect'; from: El; side: 'n' | 'e' | 's' | 'w' }

const clampZ = (z: number) => Math.max(MIN_Z, Math.min(MAX_Z, z))

interface Props {
  model: WhiteboardModel; els: El[]; readOnly: boolean
  tool: Tool; setTool: (t: Tool) => void; style: Style
  sel: string[]; setSel: (ids: string[]) => void
  view: View; setView: (v: View | ((v: View) => View)) => void
  bg: string; grid: boolean
  remotes: Remote[]; onCursor: (p: Pt | null) => void
  editing: string | null; setEditing: (id: string | null) => void
  draftText: El | null; setDraftText: (e: El | null) => void
  interactive: string | null; setInteractive: (id: string | null) => void
  onContext: (x: number, y: number, id: string | null) => void
  onPickImage: (at: Pt) => void
  onDropFiles?: (files: File[], at: Pt) => void
  holdToSnap?: boolean
  onPenSeen?: () => void
  onBring?: (id: string) => void
}

export const Board = forwardRef<BoardHandle, Props>(function Board(p, ref) {
  const { model, els, readOnly, tool, style, sel, view } = p
  const box = useRef<HTMLDivElement>(null)
  const ses = useRef<Session | null>(null)
  const [live, setLive] = useState<Record<string, Partial<El>>>({})
  const [offs, setOffs] = useState<Record<string, [number, number]>>({})
  const [draft, setDraft] = useState<El | null>(null)
  const [marquee, setMarquee] = useState<Box | null>(null)
  const [lasso, setLasso] = useState<Pt[] | null>(null)
  const [penPts, setPenPts] = useState<Pt[] | null>(null)
  const [erasing, setErasing] = useState<string[]>([])
  const [hover, setHover] = useState<string | null>(null)
  const [snapTo, setSnapTo] = useState<string | null>(null)
  const rt = useRef<{ offs: Record<string, [number, number]>; live: Record<string, Partial<El>>; draft: El | null }>({ offs: {}, live: {}, draft: null })   // the latest values, readable the instant the pointer is released
  const setOffsR = (v: Record<string, [number, number]>) => { rt.current.offs = v; setOffs(v) }
  const setLiveR = (v: Record<string, Partial<El>>) => { rt.current.live = v; setLive(v) }
  const setDraftR = (v: El | null | ((d: El | null) => El | null)) => { const n = typeof v === 'function' ? v(rt.current.draft) : v; rt.current.draft = n; setDraft(n) }
  const [size, setSize] = useState({ w: 800, h: 600 })
  const pointers = useRef(new Map<number, Pt>())
  const space = useRef(false)
  const penSeen = useRef(false)    // a pencil has been used on this board: fingers move the board and are ignored while it draws
  const lastPen = useRef(0)
  const hold = useRef(p.holdToSnap !== false); hold.current = p.holdToSnap !== false
  const viewRef = useRef(view); viewRef.current = view
  const elsRef = useRef(els); elsRef.current = els
  const byId = useMemo(() => new Map(els.map((e) => [e.id, e])), [els])

  const toWorld = useCallback((cx: number, cy: number): Pt => { const r = box.current!.getBoundingClientRect(), v = viewRef.current; return [(cx - r.left - v.x) / v.z, (cy - r.top - v.y) / v.z] }, [])
  useImperativeHandle(ref, () => ({ toWorld, size: () => size }), [toWorld, size])
  useEffect(() => { const el = box.current; if (!el) return; const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight })); ro.observe(el); setSize({ w: el.clientWidth, h: el.clientHeight }); return () => ro.disconnect() }, [])
  const toScreen = (q: Pt): Pt => [q[0] * view.z + view.x, q[1] * view.z + view.y]

  // wheel: pinch / ctrl+wheel zooms around the pointer, plain wheel scrolls the board
  useEffect(() => {
    const el = box.current!
    const wheel = (ev: WheelEvent) => {
      ev.preventDefault()
      const r = el.getBoundingClientRect(), v = viewRef.current
      if (ev.ctrlKey || ev.metaKey) {
        const z = clampZ(v.z * Math.exp(Math.max(-0.3, Math.min(0.3, -ev.deltaY * 0.003)))), px = ev.clientX - r.left, py = ev.clientY - r.top
        p.setView({ z, x: px - ((px - v.x) / v.z) * z, y: py - ((py - v.y) / v.z) * z })
      } else p.setView({ ...v, x: v.x - (ev.shiftKey && !ev.deltaX ? ev.deltaY : ev.deltaX), y: v.y - (ev.shiftKey && !ev.deltaX ? 0 : ev.deltaY) })
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [p])
  useEffect(() => {
    const dn = (e: KeyboardEvent) => { if (e.code === 'Space' && !(e.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]')) { space.current = true; if (box.current) box.current.style.cursor = 'grab' } }
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') { space.current = false; if (box.current) box.current.style.cursor = '' } }
    window.addEventListener('keydown', dn); window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up) }
  }, [])

  const tol = 6 / view.z
  const topHit = (pt: Pt, fillInside = false): El | undefined => {
    for (let i = els.length - 1; i >= 0; i--) { const e = els[i]; if (e.lock && tool !== 'select') continue; if (hit(fillInside && (isShape(e.type) || e.type === 'draw') ? { ...e, fill: '#000' } : e, pt, tol)) return e }
    return undefined
  }
  const expand = (ids: string[]) => { const g = new Set(ids.map((i) => byId.get(i)?.grp).filter(Boolean)); return g.size ? [...new Set([...ids, ...els.filter((e) => e.grp && g.has(e.grp)).map((e) => e.id)])] : ids }
  const selected = els.filter((e) => sel.includes(e.id))

  // ── selection box and handles (in screen pixels) ──
  /** an element as it looks right now, while being dragged, resized or turned */
  const nowEl = (e: El): El => { const o = offs[e.id]; const l = live[e.id]; return o || l ? ({ ...e, ...(l ?? {}), ...(o ? { x: (l?.x ?? e.x) + o[0], y: (l?.y ?? e.y) + o[1] } : {}) } as El) : e }
  const selBox: Box | null = useMemo(() => {
    const mine = els.filter((e) => sel.includes(e.id)).map(nowEl)
    return mine.length ? union(mine.map(pageBox)) : null
  }, [els, sel, live, offs]) // eslint-disable-line react-hooks/exhaustive-deps
  const single = selected.length === 1 ? nowEl(selected[0]) : null
  const handlePts = (): { h: Handle; p: Pt }[] => {
    if (!selBox || readOnly) return []
    if (single && (single.type === 'line' || single.type === 'arrow')) return []
    if (single && !isLinear(single.type)) {
      const c = corners(single), mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      return [{ h: 'nw', p: c[0] }, { h: 'n', p: mid(c[0], c[1]) }, { h: 'ne', p: c[1] }, { h: 'e', p: mid(c[1], c[2]) }, { h: 'se', p: c[2] }, { h: 's', p: mid(c[2], c[3]) }, { h: 'sw', p: c[3] }, { h: 'w', p: mid(c[3], c[0]) }].map((x) => ({ h: x.h as Handle, p: toScreen(x.p) }))
    }
    const b = selBox
    return ([['nw', b.x, b.y], ['n', b.x + b.w / 2, b.y], ['ne', b.x + b.w, b.y], ['e', b.x + b.w, b.y + b.h / 2], ['se', b.x + b.w, b.y + b.h], ['s', b.x + b.w / 2, b.y + b.h], ['sw', b.x, b.y + b.h], ['w', b.x, b.y + b.h / 2]] as [Handle, number, number][]).map(([h, x, y]) => ({ h, p: toScreen([x, y]) }))
  }
  const rotateHandle = (): Pt | null => {
    if (!single || readOnly || isLinear(single.type) || single.lock) return null
    const c = corners(single), top: Pt = [(c[0][0] + c[1][0]) / 2, (c[0][1] + c[1][1]) / 2], cc = center(single)
    const dx = top[0] - cc[0], dy = top[1] - cc[1], l = Math.hypot(dx, dy) || 1
    return toScreen([top[0] + (dx / l) * (28 / view.z), top[1] + (dy / l) * (28 / view.z)])
  }
  const linePts = (): Pt[] => (single && (single.type === 'line' || single.type === 'arrow') && !readOnly ? absPts(single).map(toScreen) : [])

  /** the little plus signs beside a selected shape: drag one to draw the next step of a flowchart */
  const connectPts = (): { side: 'n' | 'e' | 's' | 'w'; p: Pt }[] => {
    if (!single || readOnly || tool !== 'select' || single.lock || !isShape(single.type) || ses.current) return []
    const c = center(single), hw = single.w / 2, hh = single.h / 2, off = 26 / view.z
    return ([['n', 0, -(hh + off)], ['e', hw + off, 0], ['s', 0, hh + off], ['w', -(hw + off), 0]] as ['n' | 'e' | 's' | 'w', number, number][]).map(([side, dx, dy]) => ({ side, p: toScreen(rot([c[0] + dx, c[1] + dy], c, single.a)) }))
  }
  const near = (a: Pt, b: Pt, r = 9) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= r
  const scr = (ev: React.PointerEvent | PointerEvent): Pt => { const r = box.current!.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top] }

  // ── creating ──
  const styleEl = (type: El['type'], extra: Partial<El> = {}): El => model.make(type, extra, style)
  const withText = (e: El): El => (isShape(e.type) ? { ...e, font: style.font, size: style.size, ta: style.ta, tc: style.tc, rad: e.type === 'rect' ? style.rad : 0 } : e)
  const newShape = (kind: ShapeKind, a: Pt, b: Pt, big = false): El => {
    const [dw, dh] = DEFAULT_SIZE[kind] ?? [160, 100]
    let x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]), w = Math.abs(b[0] - a[0]), h = Math.abs(b[1] - a[1])
    if (big && w < 6 && h < 6) { x = a[0] - dw / 2; y = a[1] - dh / 2; w = dw; h = dh }
    return withText(styleEl(kind, { x, y, w, h }))
  }
  const newLinear = (type: 'line' | 'arrow', a: Pt, b: Pt, fromId?: string, toId?: string): El => {
    const e = styleEl(type, { x: a[0], y: a[1], pts: [[0, 0], [b[0] - a[0], b[1] - a[1]]], curve: style.curve, hs: style.hs, he: type === 'arrow' ? style.he : 'none', ...(fromId ? { from: { id: fromId } } : {}), ...(toId ? { to: { id: toId } } : {}), font: style.font, size: Math.min(style.size, 20), tc: style.tc })
    return e
  }
  const constrain = (a: Pt, b: Pt, ev: { shiftKey: boolean }): Pt => {
    if (!ev.shiftKey) return b
    const dx = b[0] - a[0], dy = b[1] - a[1], ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12), l = Math.hypot(dx, dy)
    return [a[0] + Math.cos(ang) * l, a[1] + Math.sin(ang) * l]
  }

  /** a point of a pen stroke: with a pencil it also carries how hard it is pressed */
  const pt3 = (w: Pt, e: { pointerType: string; pressure: number }): Pt => (e.pointerType === 'pen' ? ([w[0], w[1], e.pressure > 0 ? e.pressure : 0.5] as unknown as Pt) : w)
  const recEl = (rec: Rec, hl: boolean): El => {
    if (rec.kind === 'line') {
      const [a, b] = [rec.a, rec.b]
      if (hl) return styleEl('draw', { x: a[0], y: a[1], pts: [[0, 0], [b[0] - a[0], b[1] - a[1]]], hl: true, stroke: style.stroke === '#1e1e2e' ? '#facc15' : style.stroke, op: 45, sw: 6 })
      return styleEl('line', { x: a[0], y: a[1], pts: [[0, 0], [b[0] - a[0], b[1] - a[1]]], curve: 'straight', he: 'none', hs: 'none' })
    }
    if (rec.kind === 'shape') return withText(styleEl(rec.type, { x: rec.x, y: rec.y, w: rec.w, h: rec.h, a: rec.a }))
    const f = rec.pts[0]
    return styleEl('draw', { x: f[0], y: f[1], pts: rec.pts.map((q) => [q[0] - f[0], q[1] - f[1]] as Pt) })
  }
  /** holding the pen still turns the rough stroke into the shape it was meant to be */
  const armHold = (s: Extract<Session, { k: 'pen' }>) => {
    window.clearTimeout(s.timer)
    if (!hold.current) return
    s.timer = window.setTimeout(() => {
      if (ses.current !== s || s.snapped || s.pts.length < 6) return
      const rec = recognize(s.pts.map((q) => [q[0], q[1]] as Pt))
      if (!rec || (s.hl && rec.kind !== 'line')) return
      s.snapped = { rec, el: recEl(rec, s.hl) }
      setPenPts(null); setDraftR(s.snapped.el)
      try { navigator.vibrate?.(14) } catch { /* not on every device */ }
    }, HOLD_MS)
  }
  const onDown = (ev: React.PointerEvent) => {
    if (ev.button === 2) return
    const kind = ev.pointerType
    if (kind === 'pen') { if (!penSeen.current) p.onPenSeen?.(); penSeen.current = true; lastPen.current = Date.now() }
    else if (kind === 'touch' && penSeen.current && (Date.now() - lastPen.current < 1500 || [...pointers.current.keys()].some((id) => id >= 0 && ses.current?.k === 'pen'))) return   // a palm resting while the pencil draws
    ;(ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId)
    pointers.current.set(ev.pointerId, scr(ev))
    if (pointers.current.size === 2) {   // two fingers: pinch to zoom and drag to pan
      const [a, b] = [...pointers.current.values()]
      ses.current = { k: 'pinch', d: Math.hypot(a[0] - b[0], a[1] - b[1]), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], v: viewRef.current }
      setDraftR(null); setLiveR({}); setOffsR({}); return
    }
    if (p.editing || p.draftText) return
    const w = toWorld(ev.clientX, ev.clientY), s = scr(ev)
    if (kind === 'touch' && penSeen.current && tool !== 'text' && pointers.current.size === 1) { ses.current = { k: 'pan', sx: ev.clientX, sy: ev.clientY, v: view }; return }   // with a pencil in use, a finger moves the board
    if (!readOnly && kind === 'pen' && ((ev.buttons & 32) || ev.button === 5)) { ses.current = { k: 'erase', hit: new Set() }; eraseAt(w); return }   // the pencil's other end
    if (ev.button === 1 || space.current || tool === 'hand') { ses.current = { k: 'pan', sx: ev.clientX, sy: ev.clientY, v: view }; return }
    if (p.interactive) p.setInteractive(null)
    if (readOnly) { if (tool === 'select') { const h = topHit(w); p.setSel(h ? expand([h.id]) : []); if (!h) ses.current = { k: 'pan', sx: ev.clientX, sy: ev.clientY, v: view } } else ses.current = { k: 'pan', sx: ev.clientX, sy: ev.clientY, v: view }; return }

    if (tool === 'select') {
      // handles first
      const rh = rotateHandle()
      if (rh && near(s, rh, 10) && single) { const c = center(single); ses.current = { k: 'rotate', el: single, c, a0: single.a }; return }
      const lp = linePts()
      for (let i = 0; i < lp.length; i++) if (near(s, lp[i], 10) && single) { ses.current = { k: 'pt', el: single, i }; return }
      for (const cp of connectPts()) if (near(s, cp.p, 11) && single) { ses.current = { k: 'connect', from: single, side: cp.side }; return }
      for (const hp of handlePts()) if (near(s, hp.p, 9) && selBox) {
        const ids = selected.filter((e) => !e.lock).map((e) => e.id)
        ses.current = { k: 'resize', handle: hp.h, ids, orig: new Map(selected.map((e) => [e.id, e])), box: selBox, single: !!single && !isLinear(single.type) }; return
      }
      const h = topHit(w)
      if (h) {
        let ids = sel.includes(h.id) ? sel : expand([h.id])
        if (ev.shiftKey) { ids = sel.includes(h.id) ? sel.filter((i) => !expand([h.id]).includes(i)) : [...new Set([...sel, ...expand([h.id])])]; p.setSel(ids); if (!ids.includes(h.id)) return } else if (!sel.includes(h.id)) p.setSel(ids)
        const movable = els.filter((e) => ids.includes(e.id) && !e.lock)
        // a frame carries what is inside it
        const carry = movable.filter((e) => e.type === 'frame').flatMap((f) => els.filter((e) => !ids.includes(e.id) && !e.lock && e.type !== 'frame' && e.x >= f.x && e.y >= f.y && e.x + e.w <= f.x + f.w && e.y + e.h <= f.y + f.h))
        const all = [...movable, ...carry]
        ses.current = { k: 'move', start: w, ids: all.map((e) => e.id), orig: new Map(all.map((e) => [e.id, e])), moved: false, dup: ev.altKey }
        return
      }
      if (!ev.shiftKey) p.setSel([])
      ses.current = { k: 'marquee', start: w, keep: ev.shiftKey ? sel : [] }; return
    }
    if (tool === 'lasso') { ses.current = { k: 'lasso', pts: [w], keep: ev.shiftKey ? sel : [] }; setLasso([w]); return }
    if (tool === 'eraser') { ses.current = { k: 'erase', hit: new Set() }; eraseAt(w); return }
    if (tool === 'bucket') { bucket(w); return }
    if (tool === 'draw' || tool === 'highlight') { const first = pt3(w, ev); const sn: Session = { k: 'pen', pts: [first], hl: tool === 'highlight', at: s }; ses.current = sn; setPenPts([first]); armHold(sn); return }
    if (tool === 'text') { const e = styleEl('text', { x: w[0], y: w[1], w: 20, h: style.size * 1.28, text: '', font: style.font, size: style.size, ta: 'left', tc: style.tc }); loadFont(style.font); p.setDraftText(e); return }
    if (tool === 'image') { p.onPickImage(w); return }
    if (tool === 'line' || tool === 'arrow') { const s0 = shapeAt(els, w); ses.current = { k: 'create', tool, start: w, id: s0?.id ?? '' }; setDraftR(newLinear(tool, w, w, s0?.id)); return }
    if (tool === 'frame' || tool === 'aiframe') { ses.current = { k: 'create', tool, start: w, id: '' }; setDraftR(styleEl('frame', { x: w[0], y: w[1], w: 1, h: 1, ai: tool === 'aiframe', name: tool === 'aiframe' ? 'AI frame' : 'Frame', stroke: '#9ca3af', fill: 'transparent' })); return }
    if (isShape(tool as never)) { ses.current = { k: 'create', tool, start: w, id: '' }; setDraftR(newShape(tool as ShapeKind, w, w)); return }
  }

  const eraseAt = (w: Pt) => {
    const s = ses.current; if (!s || s.k !== 'erase') return
    const h = topHit(w); if (h && !h.lock && !s.hit.has(h.id)) { s.hit.add(h.id); setErasing([...s.hit]) }
  }
  const bucket = (w: Pt) => {
    const h = topHit(w, true)
    if (!h) { model.setMeta('bg', style.fill === 'transparent' ? '#ffffff' : style.fill); return }
    if (h.lock) return
    if (h.type === 'text') model.update(h.id, { tc: style.fill === 'transparent' ? style.stroke : style.fill })
    else if (h.type === 'line' || h.type === 'arrow') model.update(h.id, { stroke: style.fill === 'transparent' ? style.stroke : style.fill })
    else if (h.type === 'image' || h.type === 'embed') return
    else model.update(h.id, { fill: style.fill, fs: style.fs })
  }

  const onMove = (ev: React.PointerEvent) => {
    const s0 = scr(ev)
    if (pointers.current.has(ev.pointerId)) pointers.current.set(ev.pointerId, s0)
    const w = toWorld(ev.clientX, ev.clientY)
    p.onCursor(w)
    const s = ses.current
    if (!s) { if (tool === 'select' && !readOnly) { const h = topHit(w); if ((h?.id ?? null) !== hover) setHover(h?.id ?? null) } return }
    if (s.k === 'pinch') {
      if (pointers.current.size < 2) return
      const [a, b] = [...pointers.current.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      const z = clampZ(s.v.z * (d / (s.d || 1)))
      p.setView({ z, x: mid[0] - ((s.mid[0] - s.v.x) / s.v.z) * z, y: mid[1] - ((s.mid[1] - s.v.y) / s.v.z) * z }); return
    }
    if (s.k === 'pan') { p.setView({ ...s.v, x: s.v.x + ev.clientX - s.sx, y: s.v.y + ev.clientY - s.sy }); return }
    if (s.k === 'move') {
      let dx = w[0] - s.start[0], dy = w[1] - s.start[1]
      if (!s.moved && Math.hypot(dx, dy) * view.z < 3) return
      if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0 }
      s.moved = true
      setOffsR(Object.fromEntries(s.ids.map((id) => [id, [dx, dy] as [number, number]]))); return
    }
    if (s.k === 'resize') { setLiveR(resizeTo(s, w, ev)); return }
    if (s.k === 'rotate') {
      let a = Math.atan2(w[1] - s.c[1], w[0] - s.c[0]) + Math.PI / 2
      if (ev.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12)
      setLiveR({ [s.el.id]: { a } }); return
    }
    if (s.k === 'pt') {
      const e = s.el, abs = absPts(e), last = s.i === abs.length - 1, first = s.i === 0
      let q = w; if (ev.shiftKey && abs.length === 2) q = constrain(abs[first ? 1 : 0], w, ev)
      abs[s.i] = q
      const target = (first || last) && e.type === 'arrow' || (first || last) && e.type === 'line' ? shapeAt(els, q, e.id) : undefined
      setSnapTo(target?.id ?? null)
      const n = { ...e, pts: abs.map((a) => [a[0] - e.x, a[1] - e.y] as Pt) } as El
      setLiveR({ [e.id]: { pts: n.pts, ...(e.curve === 'elbow' ? { pts: elbow(abs[0], abs[abs.length - 1], first ? target : e.from ? byId.get(e.from.id) : undefined, last ? target : e.to ? byId.get(e.to.id) : undefined).map((a) => [a[0] - e.x, a[1] - e.y] as Pt) } : {}) } }); return
    }
    if (s.k === 'create') {
      if (s.tool === 'line' || s.tool === 'arrow') {
        const b = constrain(s.start, w, ev), t = shapeAt(els, b)
        setSnapTo(t && t.id !== s.id ? t.id : null)
        const e = newLinear(s.tool, s.start, b, s.id || undefined, t && t.id !== s.id ? t.id : undefined)
        if (style.curve === 'elbow') e.pts = elbow(s.start, b, s.id ? byId.get(s.id) : undefined, t && t.id !== s.id ? t : undefined).map((a) => [a[0] - s.start[0], a[1] - s.start[1]] as Pt)
        setDraftR({ ...e, id: rt.current.draft?.id ?? e.id, seed: rt.current.draft?.seed ?? e.seed }); return
      }
      let b = w; if (ev.shiftKey) { const m = Math.max(Math.abs(w[0] - s.start[0]), Math.abs(w[1] - s.start[1])); b = [s.start[0] + Math.sign(w[0] - s.start[0] || 1) * m, s.start[1] + Math.sign(w[1] - s.start[1] || 1) * m] }
      if (s.tool === 'frame' || s.tool === 'aiframe') setDraftR((d) => d && { ...d, x: Math.min(s.start[0], b[0]), y: Math.min(s.start[1], b[1]), w: Math.abs(b[0] - s.start[0]), h: Math.abs(b[1] - s.start[1]) })
      else setDraftR((d) => { const n = newShape(s.tool as ShapeKind, s.start, b); return { ...n, id: d?.id ?? n.id, seed: d?.seed ?? n.seed } })
      return
    }
    if (s.k === 'connect') {
      const t = shapeAt(els, w, s.from.id); setSnapTo(t?.id ?? null)
      setDraftR(arrowBetween(model, s.from, t, { p1: w, curve: style.curve, he: style.he, clean: style.ro === 0, stroke: style.stroke })); return
    }
    if (s.k === 'pen') {
      if (ev.pointerType === 'pen') lastPen.current = Date.now()
      if (s.snapped) {   // after the shape snapped in: a line follows the pen to wherever it is drawn out to; other shapes stay as they are
        if (s.snapped.rec.kind === 'line') { const a = s.snapped.rec.a, b = constrain(a, w, ev), rec: Rec = { kind: 'line', a, b }; s.snapped = { rec, el: recEl(rec, s.hl) }; setDraftR(s.snapped.el) }
        return
      }
      const native = ev.nativeEvent as PointerEvent, batch = (native.getCoalescedEvents?.() ?? []).length ? native.getCoalescedEvents() : [native]   // every sample the pencil reported, not just the latest
      for (const c of batch) {
        const q = toWorld(c.clientX, c.clientY), last = s.pts[s.pts.length - 1]
        if (Math.hypot(q[0] - last[0], q[1] - last[1]) * view.z < 1.2) continue
        s.pts.push(pt3(q, c))
      }
      setPenPts([...s.pts])
      if (Math.hypot(s0[0] - s.at[0], s0[1] - s.at[1]) > 6) { s.at = s0; armHold(s) }
      return
    }
    if (s.k === 'marquee') { const b: Box = { x: Math.min(s.start[0], w[0]), y: Math.min(s.start[1], w[1]), w: Math.abs(w[0] - s.start[0]), h: Math.abs(w[1] - s.start[1]) }; setMarquee(b)
      const ids = els.filter((e) => !e.hide && !e.lock && inBox(pageBox(e), b)).map((e) => e.id); p.setSel(expand([...new Set([...s.keep, ...ids])])); return }
    if (s.k === 'lasso') { s.pts.push(w); setLasso([...s.pts]); return }
    if (s.k === 'erase') { eraseAt(w); return }
  }
  const inBox = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

  const resizeTo = (s: Extract<Session, { k: 'resize' }>, w: Pt, ev: { shiftKey: boolean }): Record<string, Partial<El>> => {
    const h = s.handle, MIN = 8
    if (s.single) {
      const e = s.orig.get(s.ids[0])!, c = center(e), pl = rot(w, c, -e.a)
      let x0 = e.x, y0 = e.y, x1 = e.x + e.w, y1 = e.y + e.h
      const prop = ev.shiftKey || e.type === 'image' || e.type === 'text' && h.length === 2
      if (h.includes('w')) x0 = Math.min(pl[0], x1 - MIN); if (h.includes('e')) x1 = Math.max(pl[0], x0 + MIN)
      if (h.includes('n')) y0 = Math.min(pl[1], y1 - MIN); if (h.includes('s')) y1 = Math.max(pl[1], y0 + MIN)
      if (prop && h.length === 2) {
        const k = Math.max((x1 - x0) / e.w, (y1 - y0) / e.h), nw = e.w * k, nh = e.h * k
        if (h.includes('w')) x0 = x1 - nw; else x1 = x0 + nw
        if (h.includes('n')) y0 = y1 - nh; else y1 = y0 + nh
      }
      const nw = x1 - x0, nh = y1 - y0, cu: Pt = [(x0 + x1) / 2, (y0 + y1) / 2], cw = rot(cu, c, e.a)
      const patch: Partial<El> = { x: cw[0] - nw / 2, y: cw[1] - nh / 2, w: nw, h: nh }
      if (e.type === 'text') { if (h.length === 2) patch.size = Math.max(6, Math.round((e.size ?? 24) * (nw / e.w))); else patch.wrap = true }
      return { [e.id]: patch }
    }
    // several things (or a pen stroke): scale them all about the opposite corner
    const b = s.box, out: Record<string, Partial<El>> = {}
    let x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h
    if (h.includes('w')) x0 = Math.min(w[0], x1 - MIN); if (h.includes('e')) x1 = Math.max(w[0], x0 + MIN)
    if (h.includes('n')) y0 = Math.min(w[1], y1 - MIN); if (h.includes('s')) y1 = Math.max(w[1], y0 + MIN)
    let sx = (x1 - x0) / (b.w || 1), sy = (y1 - y0) / (b.h || 1)
    if (h.length === 2 && (ev.shiftKey || s.ids.length > 1 || [...s.orig.values()].some((e) => e.type === 'draw' || e.type === 'text'))) { const k = Math.max(sx, sy); sx = k; sy = k; if (h.includes('w')) x0 = x1 - b.w * k; else x1 = x0 + b.w * k; if (h.includes('n')) y0 = y1 - b.h * k; else y1 = y0 + b.h * k }
    for (const id of s.ids) {
      const e = s.orig.get(id)!
      const nx = x0 + (e.x - b.x) * sx, ny = y0 + (e.y - b.y) * sy
      if (isLinear(e.type)) out[id] = { x: nx, y: ny, w: e.w * sx, h: e.h * sy, pts: (e.pts ?? []).map((q) => [q[0] * sx, q[1] * sy, ...q.slice(2)] as unknown as Pt) }
      else out[id] = { x: nx, y: ny, w: e.w * sx, h: e.h * sy, ...(e.type === 'text' ? { size: Math.max(6, Math.round((e.size ?? 24) * Math.min(sx, sy))) } : {}) }
    }
    return out
  }

  const onUp = (ev: React.PointerEvent) => {
    pointers.current.delete(ev.pointerId)
    const s = ses.current
    if (s?.k === 'pinch') { if (pointers.current.size < 2) ses.current = null; return }
    ses.current = null
    if (!s) return
    const w = toWorld(ev.clientX, ev.clientY)
    if (s.k === 'move') {
      if (s.moved) {
        const o = rt.current.offs[s.ids[0]]; setOffsR({})
        if (o) {
          if (s.dup) { const ids = model.duplicate(s.ids, o[0], o[1]); p.setSel(ids) }
          else model.updateMany(Object.fromEntries(s.ids.map((id) => { const e = s.orig.get(id)!; return [id, { x: e.x + o[0], y: e.y + o[1] }] })))
        }
      } else if (!ev.shiftKey && sel.length > 1 && s.ids.length) { /* click on one of several: keep the selection */ }
    } else if (s.k === 'resize' || s.k === 'rotate') { const l = rt.current.live; setLiveR({}); if (Object.keys(l).length) model.updateMany(l) }
    else if (s.k === 'pt') {
      const l = rt.current.live[s.el.id]; setLiveR({}); setSnapTo(null)
      if (l?.pts) {
        const e = s.el, first = s.i === 0, last = s.i === (e.pts?.length ?? 2) - 1, abs = l.pts.map((q) => [q[0] + e.x, q[1] + e.y] as Pt)
        const patch: Partial<El> = { pts: l.pts }
        if (first || last) { const t = shapeAt(els, abs[s.i], e.id); if (first) patch.from = t ? { id: t.id } : undefined; else patch.to = t ? { id: t.id } : undefined }
        model.update(e.id, patch)
      }
    } else if (s.k === 'create') {
      const d = rt.current.draft; setDraftR(null); setSnapTo(null)
      if (!d) return
      if (s.tool === 'line' || s.tool === 'arrow') {
        if (Math.hypot(w[0] - s.start[0], w[1] - s.start[1]) * view.z < 6) return
        const [id] = model.add([d]); p.setSel([id]); p.setTool('select'); return
      }
      if (s.tool === 'frame' || s.tool === 'aiframe') { if (d.w < 20 || d.h < 20) return; const [id] = model.add([d]); p.setSel([id]); p.setTool('select'); return }
      const tiny = d.w < 6 && d.h < 6
      const e = tiny ? newShape(s.tool as ShapeKind, s.start, s.start, true) : d
      const [id] = model.add([{ ...e, id: d.id }]); p.setSel([id]); p.setTool('select')
    } else if (s.k === 'connect') {
      setDraftR(null); setSnapTo(null)
      const f = s.from, dragged = Math.hypot(w[0] - center(f)[0], w[1] - center(f)[1]) > Math.max(f.w, f.h) / 2 + 40 / view.z
      let target = dragged ? shapeAt(els, w, f.id) : undefined
      const made: El[] = []
      if (!target) {
        const GAP = 90, at: Pt = dragged ? [w[0] - f.w / 2, w[1] - f.h / 2] : s.side === 'e' ? [f.x + f.w + GAP, f.y] : s.side === 'w' ? [f.x - GAP - f.w, f.y] : s.side === 's' ? [f.x, f.y + f.h + GAP] : [f.x, f.y - GAP - f.h]
        target = model.make(f.type, { x: at[0], y: at[1], w: f.w, h: f.h, rad: f.rad, stroke: f.stroke, fill: f.fill, fs: f.fs, sw: f.sw, ss: f.ss, ro: f.ro, op: f.op, font: f.font, size: f.size, ta: f.ta, tc: f.tc }, {})
        made.push(target)
      }
      const arrow = arrowBetween(model, f, target, { curve: style.curve, he: style.he, clean: style.ro === 0, stroke: style.stroke })
      const ids = model.add([...made, arrow])
      if (made.length) { p.setSel([ids[0]]); window.setTimeout(() => p.setEditing(ids[0]), 60) } else p.setSel([target.id])
    } else if (s.k === 'pen') {
      window.clearTimeout(s.timer)
      if (s.snapped) { const el = s.snapped.el; setDraftR(null); setPenPts(null); model.add([el]); return }
      const pts = s.pts; setPenPts(null)
      if (pts.length < 1) return
      const first = pts[0], e = styleEl('draw', { x: first[0], y: first[1], pts: pts.map((q) => [q[0] - first[0], q[1] - first[1], ...q.slice(2)] as unknown as Pt), hl: s.hl, ...(s.hl ? { stroke: style.stroke === '#1e1e2e' ? '#facc15' : style.stroke, op: 45, sw: 6 } : {}) })
      model.add([e])
    } else if (s.k === 'marquee') setMarquee(null)
    else if (s.k === 'lasso') {
      const poly = s.pts; setLasso(null)
      if (poly.length < 3) { p.setSel(s.keep); return }
      const picked = els.filter((e) => !e.hide && !e.lock && samples(e).some((q) => inPolygon(q, poly))).map((e) => e.id)
      p.setSel(expand([...new Set([...s.keep, ...picked])]))
    } else if (s.k === 'erase') { const ids = [...s.hit]; setErasing([]); if (ids.length) { model.remove(ids); p.setSel(sel.filter((i) => !ids.includes(i))) } }
  }
  /** points that stand for an element when it is lassoed: its middle and corners, and along a line */
  const samples = (e: El): Pt[] => (isLinear(e.type) ? absPts(e).filter((_, i, a) => i % Math.ceil(a.length / 24) === 0) : [center(e), ...corners(e)])

  const onDouble = (ev: React.MouseEvent) => {
    if (readOnly || p.editing || p.draftText) return
    const w = toWorld(ev.clientX, ev.clientY), h = topHit(w, true)
    if (h?.type === 'embed') { p.setInteractive(h.id); return }
    if (h && (isShape(h.type) || h.type === 'text' || h.type === 'arrow' || h.type === 'line' || h.type === 'frame')) { p.setSel([h.id]); p.setEditing(h.id); return }
    if (!h && tool === 'select') { const e = styleEl('text', { x: w[0], y: w[1], w: 20, h: style.size * 1.28, text: '', font: style.font, size: style.size, ta: 'left', tc: style.tc }); loadFont(style.font); p.setDraftText(e) }
  }
  const onContext = (ev: React.MouseEvent) => { ev.preventDefault(); const w = toWorld(ev.clientX, ev.clientY), h = topHit(w); p.onContext(ev.clientX, ev.clientY, h?.id ?? null) }

  // ── rendering ──
  const shown = useMemo(() => els.map((e) => (live[e.id] ? ({ ...e, ...live[e.id] } as El) : erasing.includes(e.id) ? ({ ...e, op: 25 } as El) : e)), [els, live, erasing])
  const bg = p.bg
  const rawEdit = p.draftText ?? (p.editing ? byId.get(p.editing) ?? null : null)
  const textEdit = rawEdit && rawEdit.type === 'frame' ? ({ ...rawEdit, text: rawEdit.name ?? '' } as El) : rawEdit
  const cursor = readOnly ? 'default' : tool === 'hand' ? 'grab' : tool === 'select' ? (hover ? 'move' : 'default') : tool === 'text' ? 'text' : tool === 'eraser' ? 'cell' : 'crosshair'
  const rh = rotateHandle(), hp = handlePts(), lp = linePts()

  return (
    <div ref={box} className={`wb-board ${p.grid ? 'grid' : ''}`} style={{ backgroundColor: bg, cursor, ['--gz' as string]: view.z, ['--gx' as string]: `${view.x}px`, ['--gy' as string]: `${view.y}px` }}
         onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onDoubleClick={onDouble} onContextMenu={onContext} onDragOver={(ev) => { if (ev.dataTransfer.types.includes('Files')) ev.preventDefault() }} onDrop={(ev) => { const f = [...ev.dataTransfer.files].filter((x) => x.type.startsWith('image/')); if (f.length && p.onDropFiles) { ev.preventDefault(); p.onDropFiles(f, toWorld(ev.clientX, ev.clientY)) } }} onPointerLeave={() => p.onCursor(null)}>
      <svg className="wb-svg" width="100%" height="100%">
        <g transform={`translate(${view.x} ${view.y}) scale(${view.z})`}>
          {shown.map((e) => <ElNode key={e.id} e={e} dx={offs[e.id]?.[0]} dy={offs[e.id]?.[1]} bg={bg} interactive={p.interactive === e.id} />)}
          {draft && <ElNode e={draft} bg={bg} />}
          {penPts && penPts.length > 0 && <ElNode e={{ ...styleEl('draw', { x: penPts[0][0], y: penPts[0][1], pts: penPts.map((q) => [q[0] - penPts[0][0], q[1] - penPts[0][1], ...q.slice(2)] as unknown as Pt), hl: tool === 'highlight', ...(tool === 'highlight' ? { stroke: style.stroke === '#1e1e2e' ? '#facc15' : style.stroke, op: 45, sw: 6 } : {}) }) }} />}
        </g>
      </svg>
      <svg className="wb-over" width="100%" height="100%">
        {/* what other people have selected */}
        {p.remotes.flatMap((r) => (r.sel ?? []).map((id) => { const e = byId.get(id); if (!e) return null; const b = pageBox(e), a = toScreen([b.x, b.y]); return <rect key={r.id + id} x={a[0] - 3} y={a[1] - 3} width={b.w * view.z + 6} height={b.h * view.z + 6} fill="none" stroke={r.color} strokeWidth={1.5} rx={4} /> }))}
        {hover && tool === 'select' && !sel.includes(hover) && !ses.current && (() => { const e = byId.get(hover); if (!e) return null; const b = pageBox(e), a = toScreen([b.x, b.y]); return <rect x={a[0] - 2} y={a[1] - 2} width={b.w * view.z + 4} height={b.h * view.z + 4} fill="none" stroke="#6366f1" strokeOpacity={0.45} strokeWidth={1.5} rx={3} /> })()}
        {snapTo && (() => { const e = byId.get(snapTo); if (!e) return null; const b = pageBox(e), a = toScreen([b.x, b.y]); return <rect x={a[0] - 4} y={a[1] - 4} width={b.w * view.z + 8} height={b.h * view.z + 8} fill="rgba(99,102,241,.08)" stroke="#6366f1" strokeWidth={2} rx={6} /> })()}
        {selBox && !readOnly && (() => {
          const a = toScreen([selBox.x, selBox.y])
          return <>
            {single && !isLinear(single.type) && single.a ? <polygon points={corners(single).map(toScreen).map((q) => q.join(',')).join(' ')} fill="none" stroke="#6366f1" strokeWidth={1.5} /> : <rect x={a[0]} y={a[1]} width={selBox.w * view.z} height={selBox.h * view.z} fill="none" stroke="#6366f1" strokeWidth={1.5} strokeDasharray={single && (single.type === 'line' || single.type === 'arrow') ? '4 3' : undefined} />}
            {rh && single && <><line x1={rh[0]} y1={rh[1]} x2={toScreen([(corners(single)[0][0] + corners(single)[1][0]) / 2, (corners(single)[0][1] + corners(single)[1][1]) / 2])[0]} y2={toScreen([(corners(single)[0][0] + corners(single)[1][0]) / 2, (corners(single)[0][1] + corners(single)[1][1]) / 2])[1]} stroke="#6366f1" /><circle cx={rh[0]} cy={rh[1]} r={6} fill="#fff" stroke="#6366f1" strokeWidth={1.5} /></>}
            {hp.map((x) => <rect key={x.h} x={x.p[0] - 5} y={x.p[1] - 5} width={10} height={10} rx={2} fill="#fff" stroke="#6366f1" strokeWidth={1.5} />)}
            {connectPts().map((c) => <g key={c.side} transform={`translate(${c.p[0]} ${c.p[1]})`}><circle r={10} fill="#fff" stroke="#6366f1" strokeWidth={1.5} /><path d="M-4 0H4M0 -4V4" stroke="#6366f1" strokeWidth={1.8} strokeLinecap="round" /></g>)}
            {lp.map((q, i) => <circle key={i} cx={q[0]} cy={q[1]} r={6} fill="#fff" stroke="#6366f1" strokeWidth={1.5} />)}
          </>
        })()}
        {marquee && (() => { const a = toScreen([marquee.x, marquee.y]); return <rect x={a[0]} y={a[1]} width={marquee.w * view.z} height={marquee.h * view.z} fill="rgba(99,102,241,.08)" stroke="#6366f1" strokeDasharray="5 4" /> })()}
        {lasso && lasso.length > 1 && <polygon points={lasso.map(toScreen).map((q) => q.join(',')).join(' ')} fill="rgba(99,102,241,.08)" stroke="#6366f1" strokeWidth={1.5} strokeDasharray="5 4" />}
        {p.remotes.filter((r) => r.cursor).map((r) => { const q = toScreen([r.cursor!.x, r.cursor!.y]); return (
          <g key={r.id} transform={`translate(${q[0]} ${q[1]})`}><path d="M0 0 L0 15 L4 11.5 L7 18 L9.6 16.9 L6.7 10.4 L12 10.4 Z" fill={r.color} stroke="#fff" strokeWidth={1.2} /><rect x={12} y={14} rx={8} height={18} width={Math.max(26, r.name.length * 7 + 14)} fill={r.color} /><text x={19} y={27} fontSize={11} fill="#fff" fontFamily="Lexend, sans-serif">{r.name}</text></g>) })}
      </svg>
      {textEdit && <TextEditor key={textEdit.id} e={textEdit} view={view} onDone={(txt) => commitText(txt, textEdit)} />}
      {p.interactive && <div className="wb-interact-hint">Interacting with the website. Click outside to go back to editing.</div>}
    </div>
  )

  function commitText(txt: string, e: El) {
    const draftNow = p.draftText
    p.setEditing(null); p.setDraftText(null)
    if (draftNow) { if (!txt.trim()) return; const el = { ...draftNow, text: txt }; Object.assign(el, fitText(el)); const [id] = model.add([el]); p.setSel([id]); p.setTool('select'); return }
    const cur = model.get(e.id); if (!cur) return
    if (cur.type === 'text' && !txt.trim()) { model.remove([cur.id]); p.setSel([]); return }
    if (cur.type === 'frame') { model.update(cur.id, { name: txt.trim() }); return }
    const next = { ...cur, text: txt }
    model.update(cur.id, { text: txt, ...(cur.type === 'text' ? fitText(next) : {}) })
  }
})

/** the box you type in: it sits exactly over the text, at the same size */
function TextEditor({ e, view, onDone }: { e: El; view: View; onDone: (t: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [v, setV] = useState(e.text ?? '')
  const done = useRef(false)
  const shape = isShape(e.type) || e.type === 'frame', line = e.type === 'arrow' || e.type === 'line'
  const size = (e.size ?? 24) * view.z
  useEffect(() => {
    loadFont(e.font ?? 'Caveat')
    const id = window.setTimeout(() => { const t = ref.current; if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length) } }, 40)   // (after the mouse click that opened this has finished moving focus about)
    return () => window.clearTimeout(id)
  }, [e.font])
  const finish = () => { if (done.current) return; done.current = true; onDone(v) }
  const L = layout({ ...e, text: v })
  let x: number, y: number, w: number, h: number
  if (shape) { const wi = Math.max(60, e.w), cx = e.x + e.w / 2, cy = e.y + e.h / 2, hh = Math.max(L.h, e.size ?? 24) + 8; x = cx - wi / 2; y = cy - hh / 2; w = wi; h = hh }
  else if (line) { const pts = absPts(e), m = pts.length ? pts[Math.floor(pts.length / 2)] : [e.x, e.y]; w = Math.max(120, L.w + 30); x = m[0] - w / 2; y = m[1] - L.h / 2 - 4; h = Math.max(L.h, e.size ?? 20) + 8 }
  else { w = e.wrap ? e.w : Math.max(40, L.w + 24); x = e.x; y = e.y; h = Math.max(L.h, e.size ?? 24) + 4 }
  const sx = x * view.z + view.x, sy = y * view.z + view.y
  return (
    <textarea ref={ref} className="wb-text-edit" value={v} spellCheck={false} onChange={(ev) => setV(ev.target.value)} onBlur={finish}
      onKeyDown={(ev) => { ev.stopPropagation(); if (ev.key === 'Escape') { finish() } else if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { finish() } }}
      onPointerDown={(ev) => ev.stopPropagation()}
      style={{ left: sx, top: sy, width: w * view.z, height: h * view.z, fontFamily: `"${e.font ?? 'Caveat'}", cursive`, fontSize: size, lineHeight: 1.28, color: e.tc ?? e.stroke, textAlign: shape || line ? 'center' : (e.ta ?? 'left'), fontWeight: e.bold ? 700 : 400, fontStyle: e.italic ? 'italic' : 'normal', transform: e.a ? `rotate(${e.a}rad)` : undefined }} />
  )
}
void boundsOf; void closed

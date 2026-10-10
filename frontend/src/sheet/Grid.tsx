import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { fontStack } from '../fonts'
import { functionNames } from './engine/functions'
import { addr, colName } from './engine/refs'
import { tokenize } from './engine/tokenizer'
import { CellError } from './engine/values'
import { callAt, SIGNATURES } from './hints'
import { textWidth } from './measure'
import { HEADER_H, HEADER_W, rectHas, rectNorm, type ClipPayload, type Rect, type SheetModel, type Style } from './model'

export interface Sel { ar: number; ac: number; fr: number; fc: number }
export interface Editing { r: number; c: number; text: string; mode: 'enter' | 'edit'; from: 'cell' | 'bar' }
export interface Remote { id: number; name: string; color: string; sel?: Sel; sheet?: string }
export interface Layout { colX: number[]; rowY: number[]; X: (c: number) => number; Y: (r: number) => number; totalW: number; totalH: number }

/** Readable text color for a custom cell fill (so a light fill never gets light text in dark mode). */
function contrastOn(bg: string): string | undefined {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(bg.trim())
  if (!m) return undefined
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#111111' : '#ffffff'
}

export const REF_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#db2777', '#65a30d']
const FN_NAMES = functionNames()
const OVERSCAN = 3

export function expandRect(model: SheetModel, sheet: string, rect: Rect): Rect {
  let R = rectNorm(rect)
  for (let guard = 0; guard < 8; guard++) {
    let grew = false
    for (const m of model.merges(sheet)) {
      if (m.r1 <= R.r2 && m.r2 >= R.r1 && m.c1 <= R.c2 && m.c2 >= R.c1) {
        const n = { r1: Math.min(R.r1, m.r1), c1: Math.min(R.c1, m.c1), r2: Math.max(R.r2, m.r2), c2: Math.max(R.c2, m.c2) }
        if (n.r1 !== R.r1 || n.c1 !== R.c1 || n.r2 !== R.r2 || n.c2 !== R.c2) { R = n; grew = true }
      }
    }
    if (!grew) break
  }
  return R
}
export const selRect = (model: SheetModel, sheet: string, s: Sel) => expandRect(model, sheet, { r1: s.ar, c1: s.ac, r2: s.fr, c2: s.fc })

const idx = (prefix: number[], v: number) => {
  let lo = 0, hi = prefix.length - 2
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (prefix[mid] <= v) lo = mid; else hi = mid - 1 }
  return lo
}

export interface GridHandle { focus(): void; scrollToCell(r: number, c: number): void; scroller(): HTMLDivElement | null }

interface Props {
  model: SheetModel; sheet: string; sheetName: string; version: number
  sel: Sel; setSel: (s: Sel) => void
  editing: Editing | null; startEdit: (e: Editing) => void; setEditingText: (t: string) => void
  commit: (dr: number, dc: number) => void; cancel: () => void
  readOnly: boolean
  clipRef: React.MutableRefObject<ClipPayload | null>
  copyRect: Rect | null; setCopyRect: (r: Rect | null) => void
  remotes: Remote[]
  onContext: (e: { x: number; y: number; kind: 'cell' | 'col' | 'row' }) => void
  onFormat: (action: 'bold' | 'italic' | 'underline') => void
  overlay?: (layout: Layout) => ReactNode
  onPasteDone?: (r: Rect) => void
  /** 1 = normal size. The cells are laid out at normal size and drawn at this zoom, so scroll positions and mouse positions (in screen pixels) are divided by it. */
  zoom?: number
}

export const Grid = forwardRef<GridHandle, Props>(function Grid(p, ref) {
  const { model, sheet, sheetName, sel, editing } = p
  const scroller = useRef<HTMLDivElement>(null)
  const z = p.zoom ?? 1
  const [scroll, setScroll] = useState({ x: 0, y: 0, w: 900, h: 500 })
  const [live, setLive] = useState<{ c?: [number, number]; r?: [number, number] }>({})
  const [fillRect, setFillRect] = useState<Rect | null>(null)
  const [acIdx, setAcIdx] = useState(0)
  const [acTouched, setAcTouched] = useState(false)
  const [caret, setCaret] = useState(0)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const pointRef = useRef<{ start: number; end: number } | null>(null)
  const drag = useRef<null | { type: 'select' | 'col' | 'row' | 'fill' | 'rzc' | 'rzr' | 'point'; src?: Rect; idx?: number; startPos?: number; startSize?: number; anchor?: [number, number] }>(null)
  const lastMouse = useRef<{ x: number; y: number } | null>(null)

  const nRows = model.rowCount(sheet), nCols = model.colCount(sheet)
  const fz = model.freeze(sheet)
  const layout: Layout = useMemo(() => {
    const colX = [0], rowY = [0]
    for (let c = 0; c < nCols; c++) colX.push(colX[c] + (live.c && live.c[0] === c ? live.c[1] : model.colWidth(sheet, c)))
    for (let r = 0; r < nRows; r++) rowY.push(rowY[r] + (live.r && live.r[0] === r ? live.r[1] : model.rowHeight(sheet, r)))
    return { colX, rowY, X: (c: number) => HEADER_W + colX[c], Y: (r: number) => HEADER_H + rowY[r], totalW: HEADER_W + colX[nCols], totalH: HEADER_H + rowY[nRows] }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, sheet, nRows, nCols, live, p.version])
  const { colX, rowY, X, Y } = layout
  const frozenW = colX[Math.min(fz.cols, nCols)], frozenH = rowY[Math.min(fz.rows, nRows)]
  const fr = Math.min(fz.rows, nRows), fc = Math.min(fz.cols, nCols)

  // keep latest values for window-level handlers
  const st = useRef({ ...p, layout, scroll, fr, fc, nRows, nCols, frozenW, frozenH, z })
  st.current = { ...p, layout, scroll, fr, fc, nRows, nCols, frozenW, frozenH, z }

  useEffect(() => {
    const el = scroller.current!
    let raf = 0
    const read = () => { raf = 0; const k = st.current.z; setScroll({ x: el.scrollLeft / k, y: el.scrollTop / k, w: el.clientWidth / k, h: el.clientHeight / k }) }
    const on = () => { if (!raf) raf = requestAnimationFrame(read) }
    read()
    el.addEventListener('scroll', on, { passive: true })
    const ro = new ResizeObserver(on); ro.observe(el)
    return () => { el.removeEventListener('scroll', on); ro.disconnect(); if (raf) cancelAnimationFrame(raf) }
  }, [z])

  const rect = selRect(model, sheet, sel)
  const scrollToCell = useCallback((r: number, c: number) => {
    const el = scroller.current; if (!el) return
    const s = st.current, L = s.layout
    const fW = L.colX[s.fc], fH = L.rowY[s.fr]
    const x0 = L.X(c), x1 = L.X(c + 1), y0 = L.Y(r), y1 = L.Y(r + 1)
    const k = s.z   // (the scroller's positions are screen pixels; the cells' are at normal size)
    if (c >= s.fc) { if (x0 < el.scrollLeft / k + HEADER_W + fW) el.scrollLeft = (x0 - HEADER_W - fW) * k; else if (x1 > (el.scrollLeft + el.clientWidth) / k) el.scrollLeft = x1 * k - el.clientWidth + 4 }
    if (r >= s.fr) { if (y0 < el.scrollTop / k + HEADER_H + fH) el.scrollTop = (y0 - HEADER_H - fH) * k; else if (y1 > (el.scrollTop + el.clientHeight) / k) el.scrollTop = y1 * k - el.clientHeight + 4 }
  }, [])
  useImperativeHandle(ref, () => ({ focus: () => scroller.current?.focus({ preventScroll: true }), scrollToCell, scroller: () => scroller.current }), [scrollToCell])
  useEffect(() => {
    // whole-column / whole-row selections (header clicks) must not jump the view to the far end
    const allRows = Math.min(sel.ar, sel.fr) === 0 && Math.max(sel.ar, sel.fr) >= nRows - 1
    const allCols = Math.min(sel.ac, sel.fc) === 0 && Math.max(sel.ac, sel.fc) >= nCols - 1
    scrollToCell(allRows ? Math.min(sel.ar, 0) : sel.fr, allCols ? 0 : sel.fc)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.fr, sel.fc, scrollToCell])

  // ───────────── hit testing ─────────────
  type Hit = { kind: 'cell' | 'col' | 'row' | 'corner'; r: number; c: number }
  const hitAt = useCallback((clientX: number, clientY: number, clamp = false): Hit | null => {
    const el = scroller.current; if (!el) return null
    const s = st.current, L = s.layout
    const box = el.getBoundingClientRect()
    let vx = clientX - box.left, vy = clientY - box.top
    if (!clamp && (vx > el.clientWidth || vy > el.clientHeight || vx < 0 || vy < 0)) return null
    vx = Math.max(0, Math.min(vx, el.clientWidth)) / s.z; vy = Math.max(0, Math.min(vy, el.clientHeight)) / s.z   // (now at normal size)
    const fW = HEADER_W + L.colX[s.fc], fH = HEADER_H + L.rowY[s.fr]
    const cx = vx < fW ? vx : vx + el.scrollLeft / s.z, cy = vy < fH ? vy : vy + el.scrollTop / s.z
    const onH = cy < HEADER_H, onW = cx < HEADER_W
    const c = onW ? -1 : idx(L.colX, cx - HEADER_W), r = onH ? -1 : idx(L.rowY, cy - HEADER_H)
    if (onH && onW) return { kind: 'corner', r: 0, c: 0 }
    if (onH) return { kind: 'col', r: 0, c }
    if (onW) return { kind: 'row', r, c: 0 }
    return { kind: 'cell', r, c }
  }, [])

  const select = useCallback((ar: number, ac: number, fr2 = ar, fc2 = ac) => p.setSel({ ar, ac, fr: fr2, fc: fc2 }), [p])

  // ───────────── formula pointing ─────────────
  const canPoint = (text: string, pos: number) => {
    if (!text.startsWith('=')) return false
    if (pointRef.current && pos === pointRef.current.end) return true
    const before = text.slice(0, pos).trimEnd()
    return before.length > 0 && /[=+\-*/^&,;(<>:]$/.test(before)
  }
  const insertRef = (r: number, c: number, r2 = r, c2 = c) => {
    const e = st.current.editing; if (!e) return
    const text = e.text
    const a = rectNorm({ r1: r, c1: c, r2, c2 })
    const refText = a.r1 === a.r2 && a.c1 === a.c2 ? addr(a.r1, a.c1) : `${addr(a.r1, a.c1)}:${addr(a.r2, a.c2)}`
    const pos = taRef.current?.selectionStart ?? text.length
    const pr = pointRef.current
    const start = pr ? pr.start : pos, end = pr ? pr.end : pos
    const next = text.slice(0, start) + refText + text.slice(end)
    pointRef.current = { start, end: start + refText.length }
    st.current.setEditingText(next)
    setCaret(start + refText.length)
    requestAnimationFrame(() => { const ta = taRef.current; if (ta) { ta.focus(); ta.setSelectionRange(start + refText.length, start + refText.length) } })
  }

  // ───────────── mouse ─────────────
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    const t = e.target as HTMLElement
    if (t.closest('.sg-editor') || t.closest('.sg-chart')) return
    const s = st.current
    const rz = t.closest('[data-rz]') as HTMLElement | null
    if (rz) {
      const [kind, i] = rz.dataset.rz!.split(':'); const n = Number(i)
      if (s.readOnly) return
      drag.current = kind === 'c' ? { type: 'rzc', idx: n, startPos: e.clientX, startSize: s.layout.colX[n + 1] - s.layout.colX[n] } : { type: 'rzr', idx: n, startPos: e.clientY, startSize: s.layout.rowY[n + 1] - s.layout.rowY[n] }
      e.preventDefault(); startWindowDrag(); return
    }
    if (t.closest('.sg-fill')) {
      if (s.readOnly) return
      drag.current = { type: 'fill', src: selRect(s.model, s.sheet, s.sel) }
      e.preventDefault(); startWindowDrag(); return
    }
    const h = hitAt(e.clientX, e.clientY)
    if (!h) return
    // formula point mode: clicking a cell while typing a formula inserts its reference
    if (s.editing && s.editing.text.startsWith('=') && h.kind === 'cell' && canPoint(s.editing.text, taRef.current?.selectionStart ?? s.editing.text.length) && !(h.r === s.editing.r && h.c === s.editing.c)) {
      e.preventDefault()
      pointRef.current = pointRef.current && taRef.current?.selectionStart === pointRef.current.end ? pointRef.current : null
      insertRef(h.r, h.c)
      drag.current = { type: 'point', anchor: [h.r, h.c] }; startWindowDrag(); return
    }
    if (s.editing) s.commit(0, 0)
    pointRef.current = null
    e.preventDefault()
    scroller.current?.focus({ preventScroll: true })
    if (h.kind === 'corner') { select(0, 0, s.nRows - 1, s.nCols - 1); return }
    if (h.kind === 'col') {
      const a = e.shiftKey ? s.sel.ac : h.c
      select(0, a, s.nRows - 1, h.c); drag.current = { type: 'col', anchor: [0, a] }; startWindowDrag(); return
    }
    if (h.kind === 'row') {
      const a = e.shiftKey ? s.sel.ar : h.r
      select(a, 0, h.r, s.nCols - 1); drag.current = { type: 'row', anchor: [a, 0] }; startWindowDrag(); return
    }
    const mg = s.model.mergeAt(s.sheet, h.r, h.c)
    const r = mg ? mg.r1 : h.r, c = mg ? mg.c1 : h.c
    if (e.shiftKey) select(s.sel.ar, s.sel.ac, h.r, h.c)
    else select(r, c)
    drag.current = { type: 'select', anchor: e.shiftKey ? [s.sel.ar, s.sel.ac] : [r, c] }
    startWindowDrag()
  }

  const startWindowDrag = () => {
    const move = (ev: MouseEvent) => { lastMouse.current = { x: ev.clientX, y: ev.clientY }; applyDrag(ev.clientX, ev.clientY) }
    const up = () => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); clearInterval(timer)
      finishDrag()
    }
    const timer = window.setInterval(() => { // edge auto-scroll while dragging
      const el = scroller.current, m = lastMouse.current; if (!el || !m || !drag.current) return
      const b = el.getBoundingClientRect()
      const dx = m.x > b.right - 20 ? 24 : m.x < b.left + HEADER_W * z + 10 ? -24 : 0, dy = m.y > b.bottom - 20 ? 24 : m.y < b.top + HEADER_H * z + 10 ? -24 : 0
      if (dx || dy) { el.scrollLeft += dx; el.scrollTop += dy; applyDrag(m.x, m.y) }
    }, 40)
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }

  const applyDrag = (clientX: number, clientY: number) => {
    const d = drag.current; if (!d) return
    const s = st.current
    if (d.type === 'rzc') { const w = Math.max(24, d.startSize! + (clientX - d.startPos!) / z); setLive({ c: [d.idx!, w] }); return }
    if (d.type === 'rzr') { const h = Math.max(14, d.startSize! + (clientY - d.startPos!) / z); setLive({ r: [d.idx!, h] }); return }
    const h = hitAt(clientX, clientY, true); if (!h) return
    if (d.type === 'select' && h.kind === 'cell') select(d.anchor![0], d.anchor![1], h.r, h.c)
    else if (d.type === 'col') select(0, d.anchor![1], s.nRows - 1, h.kind === 'cell' || h.kind === 'col' ? h.c : s.sel.fc)
    else if (d.type === 'row') select(d.anchor![0], 0, h.kind === 'cell' || h.kind === 'row' ? h.r : s.sel.fr, s.nCols - 1)
    else if (d.type === 'point' && h.kind === 'cell') { insertRef(d.anchor![0], d.anchor![1], h.r, h.c) }
    else if (d.type === 'fill' && h.kind === 'cell') {
      const S = d.src!
      const dr = h.r > S.r2 ? h.r - S.r2 : h.r < S.r1 ? h.r - S.r1 : 0, dc = h.c > S.c2 ? h.c - S.c2 : h.c < S.c1 ? h.c - S.c1 : 0
      if (!dr && !dc) { setFillRect(null); return }
      if (Math.abs(dr) * (S.c2 - S.c1 + 1) >= Math.abs(dc) * (S.r2 - S.r1 + 1)) setFillRect(dr > 0 ? { r1: S.r2 + 1, c1: S.c1, r2: h.r, c2: S.c2 } : { r1: h.r, c1: S.c1, r2: S.r1 - 1, c2: S.c2 })
      else setFillRect(dc > 0 ? { r1: S.r1, c1: S.c2 + 1, r2: S.r2, c2: h.c } : { r1: S.r1, c1: h.c, r2: S.r2, c2: S.c1 - 1 })
    }
  }

  const finishDrag = () => {
    const d = drag.current; drag.current = null
    const s = st.current
    if (!d) return
    if (d.type === 'rzc') { const w = live.c ? live.c[1] : null; setLive((cur) => { if (cur.c) s.model.setColWidth(s.sheet, cur.c[0], cur.c[1]); return {} }); void w }
    else if (d.type === 'rzr') setLive((cur) => { if (cur.r) s.model.setRowHeight(s.sheet, cur.r[0], cur.r[1]); return {} })
    else if (d.type === 'fill') {
      setFillRect((fRect) => {
        if (fRect && d.src) {
          s.model.fill(s.sheet, d.src, fRect)
          const u = { r1: Math.min(d.src.r1, fRect.r1), c1: Math.min(d.src.c1, fRect.c1), r2: Math.max(d.src.r2, fRect.r2), c2: Math.max(d.src.c2, fRect.c2) }
          s.setSel({ ar: u.r1, ac: u.c1, fr: u.r2, fc: u.c2 })
        }
        return null
      })
    }
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    const s = st.current
    const rz = (e.target as HTMLElement).closest('[data-rz]') as HTMLElement | null
    if (rz && !s.readOnly) { // auto-fit
      const [kind, i] = rz.dataset.rz!.split(':'); const n = Number(i)
      if (kind === 'c') {
        let w = 40
        for (let r = 0; r < Math.min(s.nRows, s.model.used(s.sheet).rows); r++) {
          const d = s.model.display(s.sheet, r, n); if (!d.text) continue
          w = Math.max(w, textWidth(d.text, fontOf(d.style)) + 18)
        }
        s.model.setColWidth(s.sheet, n, Math.min(600, w))
      } else {
        let h = 24
        for (let c = 0; c < Math.min(s.nCols, s.model.used(s.sheet).cols); c++) {
          const d = s.model.display(s.sheet, n, c); if (!d.text) continue
          const w = s.layout.colX[c + 1] - s.layout.colX[c] - 10, size = d.style.fs ?? 13
          const lines = d.style.wrap ? Math.max(1, Math.ceil(textWidth(d.text, fontOf(d.style)) / Math.max(20, w))) + (d.text.match(/\n/g)?.length ?? 0) : 1
          h = Math.max(h, Math.ceil(lines * size * 1.35) + 8)
        }
        s.model.setRowHeight(s.sheet, n, h)
      }
      return
    }
    const h = hitAt(e.clientX, e.clientY)
    if (!h || h.kind !== 'cell' || s.readOnly) return
    if ((e.target as HTMLElement).closest('.sg-editor')) return
    const mg = s.model.mergeAt(s.sheet, h.r, h.c), r = mg ? mg.r1 : h.r, c = mg ? mg.c1 : h.c
    s.startEdit({ r, c, text: s.model.raw(s.sheet, r, c) ?? '', mode: 'edit', from: 'cell' })
  }

  const onContextMenu = (e: React.MouseEvent) => {
    const h = hitAt(e.clientX, e.clientY); if (!h) return
    e.preventDefault()
    const s = st.current, R = selRect(s.model, s.sheet, s.sel)
    if (h.kind === 'cell' && !rectHas(R, h.r, h.c)) select(h.r, h.c)
    if (h.kind === 'col' && !(R.c1 <= h.c && h.c <= R.c2 && R.r1 === 0 && R.r2 >= s.nRows - 1)) select(0, h.c, s.nRows - 1, h.c)
    if (h.kind === 'row' && !(R.r1 <= h.r && h.r <= R.r2 && R.c1 === 0 && R.c2 >= s.nCols - 1)) select(h.r, 0, h.r, s.nCols - 1)
    p.onContext({ x: e.clientX, y: e.clientY, kind: h.kind === 'corner' ? 'cell' : h.kind })
  }

  // ───────────── keyboard (when not editing a cell) ─────────────
  const hasData = (r: number, c: number) => (st.current.model.raw(st.current.sheet, r, c) ?? '') !== '' || st.current.model.engine.isSpilled(st.current.sheet, r, c)
  const jump = (r: number, c: number, dr: number, dc: number): [number, number] => {
    const s = st.current
    const inb = (a: number, b: number) => a >= 0 && b >= 0 && a < s.nRows && b < s.nCols
    let nr = r + dr, nc = c + dc
    if (!inb(nr, nc)) return [r, c]
    if (hasData(r, c) && hasData(nr, nc)) { while (inb(nr + dr, nc + dc) && hasData(nr + dr, nc + dc)) { nr += dr; nc += dc } }
    else { while (inb(nr, nc) && !hasData(nr, nc)) { nr += dr; nc += dc } if (!inb(nr, nc)) { nr -= dr; nc -= dc; while (inb(nr + dr, nc + dc)) { nr += dr; nc += dc } } }
    return [nr, nc]
  }
  const stepFrom = (r: number, c: number, dr: number, dc: number): [number, number] => {
    const s = st.current, mg = s.model.mergeAt(s.sheet, r, c)
    let nr = r, nc = c
    if (mg) { nr = dr > 0 ? mg.r2 : dr < 0 ? mg.r1 : r; nc = dc > 0 ? mg.c2 : dc < 0 ? mg.c1 : c }
    nr = Math.max(0, Math.min(s.nRows - 1, nr + dr)); nc = Math.max(0, Math.min(s.nCols - 1, nc + dc))
    const m2 = s.model.mergeAt(s.sheet, nr, nc)
    return m2 ? [m2.r1, m2.c1] : [nr, nc]
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const s = st.current
    if (s.editing) return
    const mod = e.ctrlKey || e.metaKey
    const R = selRect(s.model, s.sheet, s.sel)
    const move = (dr: number, dc: number) => {
      e.preventDefault()
      if (e.shiftKey) {
        const [fr2, fc2] = mod ? jump(s.sel.fr, s.sel.fc, dr, dc) : [Math.max(0, Math.min(s.nRows - 1, s.sel.fr + dr)), Math.max(0, Math.min(s.nCols - 1, s.sel.fc + dc))]
        select(s.sel.ar, s.sel.ac, fr2, fc2)
      } else {
        const [r, c] = mod ? jump(s.sel.ar, s.sel.ac, dr, dc) : stepFrom(s.sel.ar, s.sel.ac, dr, dc)
        select(r, c)
      }
    }
    switch (e.key) {
      case 'ArrowUp': return move(-1, 0)
      case 'ArrowDown': return move(1, 0)
      case 'ArrowLeft': return move(0, -1)
      case 'ArrowRight': return move(0, 1)
      case 'Tab': e.preventDefault(); { const [r, c] = stepFrom(s.sel.ar, s.sel.ac, 0, e.shiftKey ? -1 : 1); select(r, c) } return
      case 'Enter': e.preventDefault(); if (!s.readOnly && !mod) { s.startEdit({ r: s.sel.ar, c: s.sel.ac, text: s.model.raw(s.sheet, s.sel.ar, s.sel.ac) ?? '', mode: 'edit', from: 'cell' }) } return
      case 'Home': e.preventDefault(); return select(mod ? 0 : s.sel.ar, 0)
      case 'End': e.preventDefault(); { const u = s.model.used(s.sheet); return select(mod ? Math.max(0, u.rows - 1) : s.sel.ar, Math.max(0, u.cols - 1)) }
      case 'PageDown': case 'PageUp': {
        e.preventDefault()
        const n = Math.max(1, Math.floor((s.scroll.h - HEADER_H) / 24) - 1) * (e.key === 'PageDown' ? 1 : -1)
        return select(Math.max(0, Math.min(s.nRows - 1, s.sel.ar + n)), s.sel.ac)
      }
      case 'Delete': case 'Backspace': e.preventDefault(); if (!s.readOnly) s.model.clear(s.sheet, R, 'values'); return
      case 'F2': e.preventDefault(); if (!s.readOnly) s.startEdit({ r: s.sel.ar, c: s.sel.ac, text: s.model.raw(s.sheet, s.sel.ar, s.sel.ac) ?? '', mode: 'edit', from: 'cell' }); return
      case 'Escape': if (s.copyRect) s.setCopyRect(null); return
    }
    if (mod) {
      const k = e.key.toLowerCase()
      if (k === 'a') { e.preventDefault(); const u = s.model.used(s.sheet); return select(0, 0, Math.max(0, u.rows - 1), Math.max(0, u.cols - 1)) }
      if (k === 'z') { e.preventDefault(); if (!s.readOnly) { e.shiftKey ? s.model.redo() : s.model.undo() } return }
      if (k === 'y') { e.preventDefault(); if (!s.readOnly) s.model.redo(); return }
      if (k === 'b' || k === 'i' || k === 'u') { e.preventDefault(); if (!s.readOnly) s.onFormat(k === 'b' ? 'bold' : k === 'i' ? 'italic' : 'underline'); return }
      if (k === 'd' && !s.readOnly) { e.preventDefault(); if (R.r2 > R.r1) s.model.fill(s.sheet, { ...R, r2: R.r1 }, { ...R, r1: R.r1 + 1 }); return }
      if (k === 'r' && !s.readOnly) { e.preventDefault(); if (R.c2 > R.c1) s.model.fill(s.sheet, { ...R, c2: R.c1 }, { ...R, c1: R.c1 + 1 }); return }
      return
    }
    if (!s.readOnly && e.key.length === 1 && !e.altKey) {
      e.preventDefault()
      s.startEdit({ r: s.sel.ar, c: s.sel.ac, text: e.key, mode: 'enter', from: 'cell' })
    }
  }

  // ───────────── clipboard ─────────────
  const onCopy = (e: React.ClipboardEvent, cut: boolean) => {
    const s = st.current
    if (s.editing) return
    e.preventDefault()
    const R = selRect(s.model, s.sheet, s.sel)
    const payload = s.model.copyRange(s.sheet, R, cut && !s.readOnly)
    s.clipRef.current = payload
    e.clipboardData.setData('text/plain', s.model.textOf(s.sheet, R))
    e.clipboardData.setData('application/x-koko-sheet', JSON.stringify(payload))
    s.setCopyRect(R)
  }
  const onPaste = (e: React.ClipboardEvent) => {
    const s = st.current
    if (s.editing || s.readOnly) return
    e.preventDefault()
    const R = selRect(s.model, s.sheet, s.sel)
    const json = e.clipboardData.getData('application/x-koko-sheet')
    const text = e.clipboardData.getData('text/plain')
    let out: Rect
    try {
      if (json) {
        const payload = JSON.parse(json) as ClipPayload
        s.model.paste(s.sheet, R.r1, R.c1, payload)
        out = { r1: R.r1, c1: R.c1, r2: R.r1 + payload.cells.length - 1, c2: R.c1 + (payload.cells[0]?.length ?? 1) - 1 }
        if (payload.cut) { s.clipRef.current = null; s.setCopyRect(null) }
      } else if (text) out = s.model.pasteText(s.sheet, R.r1, R.c1, text)
      else return
    } catch { return }
    s.setSel({ ar: out.r1, ac: out.c1, fr: out.r2, fc: out.c2 })
    s.onPasteDone?.(out)
  }

  // ───────────── editing helpers ─────────────
  const ed = editing
  const edText = ed?.text ?? ''
  useEffect(() => {
    if (!ed || ed.from !== 'cell') return
    const ta = taRef.current
    if (ta && document.activeElement !== ta) { ta.focus(); const n = ta.value.length; ta.setSelectionRange(n, n); setCaret(n) }
    pointRef.current = null
    setAcIdx(0); setAcTouched(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ed?.r, ed?.c, ed?.from])

  const word = useMemo(() => {
    if (!ed || !edText.startsWith('=')) return null
    const before = edText.slice(0, caret)
    const m = /(?:^|[^A-Za-z0-9_.$!'"])([A-Za-z][A-Za-z0-9.]*)$/.exec(before.replace(/^=/, '=').slice(1) === '' ? '' : before.slice(1))
    return m ? m[1] : null
  }, [ed, edText, caret])
  const suggestions = useMemo(() => {
    if (!word || word.length < 1) return []
    const up = word.toUpperCase()
    const starts = FN_NAMES.filter((n) => n.startsWith(up))
    return (starts.length ? starts : FN_NAMES.filter((n) => n.includes(up))).slice(0, 8)
  }, [word])
  const hint = useMemo(() => (ed && edText.startsWith('=') ? callAt(edText, caret) : null), [ed, edText, caret])
  const acceptSuggestion = (name: string) => {
    const ta = taRef.current; if (!ta || !word) return
    const pos = ta.selectionStart
    const start = pos - word.length
    const next = edText.slice(0, start) + name + '(' + edText.slice(pos)
    p.setEditingText(next)
    const np = start + name.length + 1
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(np, np); setCaret(np) })
  }

  const onEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation()
    const s = st.current
    const showAc = suggestions.length > 0
    if (showAc && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setAcTouched(true); setAcIdx((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length); return }
    if (showAc && (e.key === 'Tab' || (e.key === 'Enter' && acTouched))) { e.preventDefault(); acceptSuggestion(suggestions[acIdx] ?? suggestions[0]); return }
    if (e.key === 'Enter') { e.preventDefault(); if (e.altKey) { const ta = e.currentTarget; const a = ta.selectionStart, b = ta.selectionEnd; p.setEditingText(edText.slice(0, a) + '\n' + edText.slice(b)); requestAnimationFrame(() => ta.setSelectionRange(a + 1, a + 1)); return } s.commit(e.shiftKey ? -1 : 1, 0); return }
    if (e.key === 'Tab') { e.preventDefault(); s.commit(0, e.shiftKey ? -1 : 1); return }
    if (e.key === 'Escape') { e.preventDefault(); s.cancel(); scroller.current?.focus({ preventScroll: true }); return }
    if (s.editing?.mode === 'enter' && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && !(edText.startsWith('=') && canPoint(edText, e.currentTarget.selectionStart))) {
      e.preventDefault()
      s.commit(e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0, e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0)
    }
    if (e.key === 'F2') { e.preventDefault(); p.startEdit({ ...s.editing!, mode: 'edit' }) }
  }

  // ───────────── rendering ─────────────
  const fontOf = (sty: Style) => `${sty.i ? 'italic ' : ''}${sty.b ? '700 ' : '400 '}${sty.fs ?? 13}px ${sty.ff ? fontStack(sty.ff) : 'Inter, sans-serif'}`

  const cellEl = (r: number, c: number, key: string, mergeRect?: Rect) => {
    const w = mergeRect ? colX[mergeRect.c2 + 1] - colX[mergeRect.c1] : colX[c + 1] - colX[c]
    const h = mergeRect ? rowY[mergeRect.r2 + 1] - rowY[mergeRect.r1] : rowY[r + 1] - rowY[r]
    const raw = model.cell(sheet, r, c)
    const d = raw || mergeRect ? model.display(sheet, r, c) : model.display(sheet, r, c)
    if (!raw && !d.text) return null
    const sty = d.style
    const v = d.v
    const isNum = typeof v === 'number', isErr = v instanceof CellError
    const ha = sty.ha ?? (isNum ? 'right' : isErr || typeof v === 'boolean' ? 'center' : 'left')
    const font = fontOf(sty)
    let text = d.text
    let width = w
    if (isNum && text && textWidth(text, font) > w - 6) text = '#'.repeat(Math.max(1, Math.floor((w - 6) / 7)))
    if (!mergeRect && ha === 'left' && typeof v === 'string' && !sty.wrap && text && !text.includes('\n')) {
      const need = textWidth(text, font) + 10
      for (let k = c + 1; width < need && k < nCols && k < c + 24; k++) {
        if ((model.raw(sheet, r, k) ?? '') !== '' || model.mergeAt(sheet, r, k) || model.engine.isSpilled(sheet, r, k)) break
        width += colX[k + 1] - colX[k]
      }
    }
    const shadows: string[] = []
    if (sty.bt) shadows.push(`inset 0 1px 0 ${sty.bt}`)
    if (sty.bb) shadows.push(`inset 0 -1px 0 ${sty.bb}`)
    if (sty.bl) shadows.push(`inset 1px 0 0 ${sty.bl}`)
    if (sty.br) shadows.push(`inset -1px 0 0 ${sty.br}`)
    const css: CSSProperties = {
      left: X(mergeRect ? mergeRect.c1 : c), top: Y(mergeRect ? mergeRect.r1 : r), width, height: h,
      font, color: isErr ? 'var(--danger)' : sty.color ?? (sty.bg ? contrastOn(sty.bg) : undefined), background: sty.bg ?? (mergeRect ? 'var(--sheet)' : undefined),
      textDecoration: [sty.u ? 'underline' : '', sty.st ? 'line-through' : ''].filter(Boolean).join(' ') || undefined,
      justifyContent: ha === 'left' ? 'flex-start' : ha === 'right' ? 'flex-end' : 'center', textAlign: ha,
      alignItems: sty.va === 'top' ? 'flex-start' : sty.va === 'middle' ? 'center' : 'flex-end',
      whiteSpace: sty.wrap ? 'pre-wrap' : 'pre', boxShadow: shadows.length ? shadows.join(',') : undefined,
    }
    if (ed && ed.r === r && ed.c === c) return null
    return <div key={key} className={`sg-cell${isErr ? ' err' : ''}`} style={css}><span>{text}</span></div>
  }

  const isEditingCell = (r: number, c: number) => !!ed && ed.r === r && ed.c === c

  const zoneCells = (rows: number[], cols: number[], zone: string) => {
    const out: ReactNode[] = []
    const merged = new Set<string>()
    for (const r of rows) for (const c of cols) {
      const mg = model.mergeAt(sheet, r, c)
      if (mg) { merged.add(`${mg.r1},${mg.c1}`); continue }
      if (isEditingCell(r, c)) continue
      const el = cellEl(r, c, `${zone}${r},${c}`)
      if (el) out.push(el)
    }
    return { out, merged }
  }
  const range = (a: number, b: number) => { const o: number[] = []; for (let i = a; i <= b; i++) o.push(i); return o }
  const c0 = Math.max(fc, idx(colX, scroll.x + frozenW) - OVERSCAN), c1 = Math.min(nCols - 1, idx(colX, scroll.x + scroll.w - HEADER_W) + OVERSCAN)
  const r0 = Math.max(fr, idx(rowY, scroll.y + frozenH) - OVERSCAN), r1 = Math.min(nRows - 1, idx(rowY, scroll.y + scroll.h - HEADER_H) + OVERSCAN)
  const mainCols = range(c0, c1), mainRows = range(r0, r1), topRows = range(0, fr - 1), leftCols = range(0, fc - 1)

  const mergedEls = (zoneRows: number[], zoneCols: number[], zone: string) => {
    const out: ReactNode[] = []
    const rs = new Set(zoneRows), cs = new Set(zoneCols)
    for (const m of model.merges(sheet)) {
      const inZone = (rs.has(m.r1) && cs.has(m.c1))
      if (!inZone) continue
      if (isEditingCell(m.r1, m.c1)) continue
      const el = cellEl(m.r1, m.c1, `${zone}m${m.r1},${m.c1}`, m)
      if (el) out.push(el)
    }
    return out
  }
  // merged cells whose top-left corner is just outside the window but whose body is inside must still be drawn
  const wideRows = range(Math.max(fr, r0 - 40), r1), wideCols = range(Math.max(fc, c0 - 20), c1)

  const lines = (rows: number[], cols: number[], zone: string) => {
    if (!rows.length || !cols.length) return null
    const xa = X(cols[0]), xb = X(cols[cols.length - 1] + 1), ya = Y(rows[0]), yb = Y(rows[rows.length - 1] + 1)
    return (
      <>
        {rows.map((r) => <div key={`${zone}h${r}`} className="sg-line h" style={{ left: xa, width: xb - xa, top: Y(r + 1) - 1 }} />)}
        {cols.map((c) => <div key={`${zone}v${c}`} className="sg-line v" style={{ top: ya, height: yb - ya, left: X(c + 1) - 1 }} />)}
      </>
    )
  }

  const selCols = (c: number) => c >= rect.c1 && c <= rect.c2
  const selRows = (r: number) => r >= rect.r1 && r <= rect.r2
  const fullCols = rect.r1 === 0 && rect.r2 >= nRows - 1, fullRows = rect.c1 === 0 && rect.c2 >= nCols - 1
  const colHeader = (c: number) => (
    <div key={`ch${c}`} className={`sg-ch${selCols(c) ? ' sel' : ''}${selCols(c) && fullCols ? ' full' : ''}`} style={{ left: X(c), width: colX[c + 1] - colX[c], height: HEADER_H }}>
      {colName(c)}<span className="sg-rz c" data-rz={`c:${c}`} />
    </div>
  )
  const rowHeader = (r: number) => (
    <div key={`rh${r}`} className={`sg-rh${selRows(r) ? ' sel' : ''}${selRows(r) && fullRows ? ' full' : ''}`} style={{ top: Y(r), height: rowY[r + 1] - rowY[r], width: HEADER_W }}>
      {r + 1}<span className="sg-rz r" data-rz={`r:${r}`} />
    </div>
  )

  const box = (R: Rect) => ({ left: X(R.c1), top: Y(R.r1), width: X(R.c2 + 1) - X(R.c1), height: Y(R.r2 + 1) - Y(R.r1) })
  const refBoxes = useMemo(() => {
    if (!ed || !edText.startsWith('=')) return []
    try {
      return tokenize(edText.slice(1)).filter((t) => t.t === 'ref' && t.ref && (!t.ref.sheet || t.ref.sheet.toLowerCase() === sheetName.toLowerCase()))
        .map((t, i) => ({ R: { r1: t.ref!.r1, c1: t.ref!.c1, r2: Math.min(t.ref!.r2, nRows - 1), c2: Math.min(t.ref!.c2, nCols - 1) }, color: REF_COLORS[i % REF_COLORS.length] }))
    } catch { return [] }
  }, [ed, edText, sheetName, nRows, nCols])

  const activeBox = box(expandRect(model, sheet, { r1: sel.ar, c1: sel.ac, r2: sel.ar, c2: sel.ac }))
  const selBox = box(rect)
  const multi = rect.r1 !== rect.r2 || rect.c1 !== rect.c2
  const edBox = ed ? box(expandRect(model, sheet, { r1: ed.r, c1: ed.c, r2: ed.r, c2: ed.c })) : null
  const edStyle = ed ? model.style(sheet, ed.r, ed.c) : {}
  const edW = edBox ? Math.max(edBox.width, Math.min(520, Math.max(...edText.split('\n').map((l) => textWidth(l, fontOf(edStyle)))) + 24)) : 0
  const edH = edBox ? Math.max(edBox.height, edText.split('\n').length * ((edStyle.fs ?? 13) * 1.4 + 2) + 6) : 0
  const remoteBoxes = p.remotes.filter((r) => r.sel && r.sheet === sheet).map((r) => ({ r, R: selRect(model, sheet, r.sel!) }))

  const zoneBg = (w: number, h: number, left: number, top: number) => <div className="sg-zonebg" style={{ left, top, width: w, height: h }} />

  const editor = ed && edBox && (
    <div className="sg-editor" style={{ left: edBox.left, top: edBox.top, width: edW, height: edH }}>
      <textarea ref={taRef} value={edText} spellCheck={false} autoCapitalize="off" autoCorrect="off"
        style={{ font: fontOf(edStyle), textAlign: edStyle.ha ?? 'left', color: edStyle.color }}
        onChange={(e) => { pointRef.current = null; p.setEditingText(e.target.value); setCaret(e.target.selectionStart); setAcIdx(0); setAcTouched(false) }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={onEditorKeyDown}
        onBlur={(e) => { const rt = e.relatedTarget as HTMLElement | null; if (!rt || !rt.closest('.sheet-shell')) st.current.commit(0, 0) }} />
      {(suggestions.length > 0 || hint) && (
        <div className="sg-ac" style={{ top: edH + 4 }}>
          {suggestions.length > 0 ? suggestions.map((n, i) => (
            <button key={n} className={i === acIdx ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); acceptSuggestion(n) }}>
              <b>{n}</b><span>{SIGNATURES[n]?.slice(n.length) ?? '(…)'}</span>
            </button>
          )) : hint && SIGNATURES[hint.name] && (
            <div className="sg-hint">{(() => {
              const sig = SIGNATURES[hint.name]; const inner = sig.slice(sig.indexOf('(') + 1, sig.lastIndexOf(')'))
              const args = inner.split(/,\s*/).filter(Boolean)
              return <>{hint.name}({args.map((a, i) => <span key={i} className={i === Math.min(hint.arg, args.length - 1) ? 'cur' : ''}>{a}{i < args.length - 1 ? ', ' : ''}</span>)})</>
            })()}</div>
          )}
        </div>
      )}
    </div>
  )
  const inZone = (r: number, c: number) => (r < fr && c < fc ? 'corner' : r < fr ? 'top' : c < fc ? 'left' : 'main')
  const edZone = ed ? inZone(ed.r, ed.c) : null

  const top = zoneCells(topRows, mainCols, 't'), left = zoneCells(mainRows, leftCols, 'l'), corner = zoneCells(topRows, leftCols, 'k'), main = zoneCells(mainRows, mainCols, 'm')
  void top.merged; void left.merged; void corner.merged; void main.merged

  return (
    <div ref={scroller} className="sg-scroll" tabIndex={0} onKeyDown={onKeyDown} onMouseDown={onMouseDown} onDoubleClick={onDoubleClick} onContextMenu={onContextMenu}
      onCopy={(e) => onCopy(e, false)} onCut={(e) => onCopy(e, true)} onPaste={onPaste}>
      <div className="sg-content" style={{ width: layout.totalW, height: layout.totalH, ...(z !== 1 ? { zoom: z } : {}) }}>
        {/* scrolling body */}
        <div className="sg-layer">
          {lines(mainRows, mainCols, 'm')}
          {mainCols.length > 0 && mergedEls(wideRows, wideCols, 'm')}
          {main.out}
          {copyBox(p.copyRect, sheet, box)}
          {refBoxes.map((b, i) => <div key={i} className="sg-ref" style={{ ...box(b.R), borderColor: b.color }} />)}
          {remoteBoxes.map(({ r, R }) => (
            <div key={r.id} className="sg-remote" style={{ ...box(R), borderColor: r.color, background: r.color + '14' }}><span style={{ background: r.color }}>{r.name}</span></div>
          ))}
          <div className={`sg-sel${ed ? ' editing' : ''}`} style={selBox} />
          {multi && <div className="sg-active" style={activeBox} />}
          {!ed && !p.readOnly && <div className="sg-fill" style={{ left: selBox.left + selBox.width - 4, top: selBox.top + selBox.height - 4 }} />}
          {fillRect && <div className="sg-fillprev" style={box(fillRect)} />}
          {p.overlay?.(layout)}
          {edZone === 'main' && editor}
        </div>
        {/* frozen rows */}
        {fr > 0 && (
          <div className="sg-sticky top" style={{ zIndex: 3 }}>
            {zoneBg(layout.totalW - HEADER_W - frozenW, frozenH, X(fc), HEADER_H)}
            {lines(topRows, mainCols, 't')}{mergedEls(topRows, mainCols, 'tm')}{top.out}
            {edZone === 'top' && editor}
          </div>
        )}
        {/* frozen columns */}
        {fc > 0 && (
          <div className="sg-sticky left" style={{ zIndex: 3 }}>
            {zoneBg(frozenW, layout.totalH - HEADER_H - frozenH, HEADER_W, Y(fr))}
            {lines(mainRows, leftCols, 'l')}{mergedEls(mainRows, leftCols, 'lm')}{left.out}
            {edZone === 'left' && editor}
          </div>
        )}
        {/* headers */}
        <div className="sg-sticky top" style={{ zIndex: 5 }}>
          <div className="sg-hdrbg top" style={{ left: HEADER_W, width: layout.totalW, height: HEADER_H }} />
          {mainCols.map(colHeader)}
        </div>
        <div className="sg-sticky left" style={{ zIndex: 5 }}>
          <div className="sg-hdrbg left" style={{ top: HEADER_H, height: layout.totalH, width: HEADER_W }} />
          {mainRows.map(rowHeader)}
        </div>
        {/* frozen corner block */}
        <div className="sg-sticky corner" style={{ zIndex: 7 }}>
          <div className="sg-hdrbg corner" style={{ left: 0, top: 0, width: HEADER_W, height: HEADER_H }} />
          {fc > 0 && <><div className="sg-hdrbg top" style={{ left: HEADER_W, width: frozenW, height: HEADER_H }} />{leftCols.map(colHeader)}</>}
          {fr > 0 && <><div className="sg-hdrbg left" style={{ top: HEADER_H, height: frozenH, width: HEADER_W }} />{topRows.map(rowHeader)}</>}
          {fr > 0 && fc > 0 && <>{zoneBg(frozenW, frozenH, HEADER_W, HEADER_H)}{lines(topRows, leftCols, 'k')}{mergedEls(topRows, leftCols, 'km')}{corner.out}{edZone === 'corner' && editor}</>}
          {(fr > 0 || fc > 0) && <div className="sg-freezeline" style={{ left: 0, top: 0, width: HEADER_W + frozenW, height: HEADER_H + frozenH }} />}
        </div>
      </div>
    </div>
  )
})

function copyBox(copyRect: Rect | null, _sheet: string, box: (r: Rect) => CSSProperties) {
  return copyRect ? <div className="sg-copy" style={box(copyRect)} /> : null
}

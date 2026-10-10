import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { SlideStage, TableView, TextBody, elFont } from './SlideView'
import { fontStack } from '../fonts'
import { H, W, resolveColor, type El, type Slide, type Theme } from './themes'
import type { SlidesModel } from './model'

export interface RemoteSel { id: number; name: string; color: string; slide?: string; ids?: string[] }
type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const MIN = 24

interface Gesture {
  kind: 'move' | 'resize' | 'marquee'
  sx: number; sy: number
  orig: Record<string, { x: number; y: number; w: number; h: number }>
  handle?: Handle
  box?: { x: number; y: number }
  moved: boolean
}

/** The editable slide: select, drag, resize and edit text directly on the stage. */
export function Canvas({ model, slide, theme, sel, setSel, editing, setEditing, readOnly, remotes, onEditChart, onActiveCell, pins, onContext, zoom = 1 }: {
  /** 1 fits the slide in the window; below shows it smaller, above larger (the area then scrolls) */
  zoom?: number
  model: SlidesModel; slide: Slide; theme: Theme; sel: string[]; setSel: (ids: string[]) => void
  editing: string | null; setEditing: (id: string | null) => void; readOnly: boolean; remotes: RemoteSel[]
  onEditChart?: (id: string) => void; onActiveCell?: (r: number, c: number) => void; pins?: { id: string; el?: string; n: number }[]
  /** right-click: on an element (its id) or on the empty stage (null). Not while text is being edited, which keeps the browser's own text menu. */
  onContext?: (x: number, y: number, id: string | null) => void
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.6)
  const [live, setLive] = useState<Record<string, { x: number; y: number; w: number; h: number }> | null>(null)
  const [guides, setGuides] = useState<{ x?: number; y?: number }[]>([])
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const gesture = useRef<Gesture | null>(null)

  useLayoutEffect(() => {
    const el = wrap.current; if (!el) return
    const fit = () => setScale(Math.max(0.05, Math.min((el.clientWidth - 24) / W, (el.clientHeight - 24) / H) * zoom))
    fit(); const ro = new ResizeObserver(fit); ro.observe(el); return () => ro.disconnect()
  }, [zoom])

  const rectOf = (e: El) => live?.[e.id] ?? { x: e.x, y: e.y, w: e.w, h: e.h }
  const toStage = useCallback((cx: number, cy: number) => { const r = stage.current!.getBoundingClientRect(); return { x: (cx - r.left) / scale, y: (cy - r.top) / scale } }, [scale])

  // ───────────── gestures ─────────────
  const snap = (box: { x: number; y: number; w: number; h: number }, ids: string[], resizing = false) => {
    const T = 6 / scale * 0.8 + 3
    const xs: number[] = [0, W / 2, W], ys: number[] = [0, H / 2, H]
    slide.els.forEach((o) => { if (ids.includes(o.id)) return; xs.push(o.x, o.x + o.w / 2, o.x + o.w); ys.push(o.y, o.y + o.h / 2, o.y + o.h) })
    let { x, y } = box; const gx: number[] = [], gy: number[] = []
    const tryAxis = (pos: number, size: number, targets: number[], out: number[]) => {
      let best: { d: number; v: number; g: number } | null = null
      for (const off of resizing ? [0, size] : [0, size / 2, size]) for (const t of targets) { const d = t - (pos + off); if (Math.abs(d) <= T && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, v: pos + d, g: t } }
      if (best) { out.push(best.g); return best.v }
      return pos
    }
    x = tryAxis(x, box.w, xs, gx); y = tryAxis(y, box.h, ys, gy)
    setGuides([...gx.map((v) => ({ x: v })), ...gy.map((v) => ({ y: v }))])
    return { x, y }
  }

  const onMove = useCallback((ev: PointerEvent) => {
    const g = gesture.current; if (!g) return
    const p = toStage(ev.clientX, ev.clientY)
    const dx = p.x - g.sx, dy = p.y - g.sy
    if (!g.moved && Math.hypot(dx, dy) * scale < 3) return
    g.moved = true
    if (g.kind === 'move') {
      const ids = Object.keys(g.orig)
      const bx = Math.min(...ids.map((i) => g.orig[i].x)), by = Math.min(...ids.map((i) => g.orig[i].y))
      const bw = Math.max(...ids.map((i) => g.orig[i].x + g.orig[i].w)) - bx, bh = Math.max(...ids.map((i) => g.orig[i].y + g.orig[i].h)) - by
      let nx = bx + dx, ny = by + dy
      if (!ev.altKey) { const s = snap({ x: nx, y: ny, w: bw, h: bh }, ids); nx = s.x; ny = s.y }
      const ddx = nx - bx, ddy = ny - by
      setLive(Object.fromEntries(ids.map((i) => [i, { ...g.orig[i], x: g.orig[i].x + ddx, y: g.orig[i].y + ddy }])))
    } else if (g.kind === 'resize') {
      const id = Object.keys(g.orig)[0], o = g.orig[id], h = g.handle!
      let { x, y, w, h: hh } = o
      const keep = ev.shiftKey || slide.els.find((e) => e.id === id)?.type === 'image'
      if (h.includes('e')) w = o.w + dx
      if (h.includes('s')) hh = o.h + dy
      if (h.includes('w')) { w = o.w - dx; x = o.x + dx }
      if (h.includes('n')) { hh = o.h - dy; y = o.y + dy }
      if (keep && (h.length === 2)) { const r = o.w / o.h; if (Math.abs(w - o.w) > Math.abs(hh - o.h) * r) hh = w / r; else w = hh * r; if (h.includes('w')) x = o.x + o.w - w; if (h.includes('n')) y = o.y + o.h - hh }
      if (w < MIN) { if (h.includes('w')) x -= MIN - w; w = MIN }
      if (hh < MIN) { if (h.includes('n')) y -= MIN - hh; hh = MIN }
      if (!ev.altKey) { const s = snap({ x, y, w, h: hh }, [id], true); if (h.includes('w')) { w += x - s.x; x = s.x } else if (h.includes('e')) w = Math.max(MIN, w + (s.x - x)); if (h.includes('n')) { hh += y - s.y; y = s.y } else if (h.includes('s')) hh = Math.max(MIN, hh + (s.y - y)) }
      setLive({ [id]: { x, y, w, h: hh } })
    } else if (g.kind === 'marquee') {
      const b = g.box!
      const r = { x: Math.min(b.x, p.x), y: Math.min(b.y, p.y), w: Math.abs(p.x - b.x), h: Math.abs(p.y - b.y) }
      setMarquee(r)
      setSel(slide.els.filter((e) => e.x < r.x + r.w && e.x + e.w > r.x && e.y < r.y + r.h && e.y + e.h > r.y).map((e) => e.id))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toStage, scale, slide])

  const onUp = useCallback(() => {
    const g = gesture.current; gesture.current = null
    window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp)
    setGuides([]); setMarquee(null)
    setLive((cur) => {
      if (g && g.moved && cur && g.kind !== 'marquee') model.updateMany(slide.id, Object.fromEntries(Object.entries(cur).map(([id, r]) => [id, { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) }])))
      return null
    })
  }, [model, onMove, slide.id])

  const begin = (g: Gesture) => { gesture.current = g; window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp) }
  useEffect(() => () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }, [onMove, onUp])

  const downEl = (ev: React.PointerEvent, e: El) => {
    if (editing === e.id) return
    ev.stopPropagation()
    if (editing) setEditing(null)
    let ids = sel
    if (ev.shiftKey || ev.metaKey || ev.ctrlKey) { ids = sel.includes(e.id) ? sel.filter((i) => i !== e.id) : [...sel, e.id]; setSel(ids); if (!ids.includes(e.id)) return }
    else if (!sel.includes(e.id)) { ids = [e.id]; setSel(ids) }
    if (readOnly) return
    const p = toStage(ev.clientX, ev.clientY)
    begin({ kind: 'move', sx: p.x, sy: p.y, orig: Object.fromEntries(slide.els.filter((x) => ids.includes(x.id)).map((x) => [x.id, { x: x.x, y: x.y, w: x.w, h: x.h }])), moved: false })
  }
  const downHandle = (ev: React.PointerEvent, e: El, h: Handle) => {
    ev.stopPropagation(); ev.preventDefault(); if (readOnly) return
    const p = toStage(ev.clientX, ev.clientY)
    begin({ kind: 'resize', handle: h, sx: p.x, sy: p.y, orig: { [e.id]: { x: e.x, y: e.y, w: e.w, h: e.h } }, moved: false })
  }
  const downStage = (ev: React.PointerEvent) => {
    if (ev.target !== ev.currentTarget && !(ev.target as HTMLElement).classList.contains('slide-surface')) return
    setEditing(null)
    const p = toStage(ev.clientX, ev.clientY)
    if (!ev.shiftKey) setSel([])
    begin({ kind: 'marquee', sx: p.x, sy: p.y, orig: {}, box: p, moved: false })
  }

  const single = sel.length === 1 ? slide.els.find((e) => e.id === sel[0]) : undefined
  const editEl = editing ? slide.els.find((e) => e.id === editing) : undefined

  return (
    <div className="sl-canvas-wrap" ref={wrap}>
      <div ref={stage} className="sl-stage-host" style={{ width: W * scale, height: H * scale }}>
        <SlideStage slide={slide} theme={theme} scale={scale} placeholders={!readOnly} editingId={editing}>
          <div className="sl-overlay" onPointerDown={downStage} onContextMenu={(ev) => { if (editing || !onContext) return; ev.preventDefault(); onContext(ev.clientX, ev.clientY, null) }} style={{ position: 'absolute', inset: 0 }}>
            {slide.els.map((e) => {
              const r = rectOf(e), on = sel.includes(e.id)
              const others = remotes.filter((x) => x.slide === slide.id && x.ids?.includes(e.id))
              return (
                <div key={e.id} className={`sl-hit ${on ? 'on' : ''}`} style={{ left: r.x, top: r.y, width: r.w, height: r.h, ['--ow' as string]: `${2 / scale}px` }}
                  onPointerDown={(ev) => downEl(ev, e)} onContextMenu={(ev) => { if (editing || !onContext) return; ev.preventDefault(); ev.stopPropagation(); onContext(ev.clientX, ev.clientY, e.id) }} onDoubleClick={() => { if (readOnly) return; if (e.type === 'chart') { setSel([e.id]); onEditChart?.(e.id) } else if (e.type !== 'image') { setSel([e.id]); setEditing(e.id) } }}>
                  {others.map((o) => <span key={o.id} className="sl-remote" style={{ outlineColor: o.color, outlineWidth: 2 / scale }}><em style={{ background: o.color, fontSize: 11 / scale }}>{o.name}</em></span>)}
                  {live?.[e.id] && (e.type === 'text') ? <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} /> : null}
                </div>
              )
            })}
            {single && !readOnly && !editing && (() => {
              const r = rectOf(single)
              return (
                <div className="sl-handles" style={{ left: r.x, top: r.y, width: r.w, height: r.h }}>
                  {HANDLES.filter((h) => !((single.shape === 'line' || single.shape === 'arrow') && h.length === 2 && false)).map((h) => (
                    <i key={h} className={`h-${h}`} style={{ width: 12 / scale, height: 12 / scale, borderWidth: 2 / scale, ...handlePos(h, 12 / scale) }} onPointerDown={(ev) => downHandle(ev, single, h)} />))}
                </div>)
            })()}
            {guides.map((g, i) => g.x !== undefined ? <div key={i} className="sl-guide v" style={{ left: g.x, width: 1 / scale }} /> : <div key={i} className="sl-guide h" style={{ top: g.y, height: 1 / scale }} />)}
            {marquee && <div className="sl-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h, borderWidth: 1 / scale }} />}
            {editEl && editEl.type === 'table' && <TableEditor key={editEl.id} e={editEl} theme={theme} onCell={(r, c, text) => model.setCell(slide.id, editEl.id, r, c, text)} onActive={onActiveCell} onDone={() => setEditing(null)} />}
            {editEl && editEl.type !== 'table' && <TextEditor key={editEl.id} e={editEl} theme={theme} onCommit={(text) => { model.updateEl(slide.id, editEl.id, { text }); setEditing(null) }} />}
            {pins?.filter((p) => p.id === slide.id).map((p, i) => {
              const el = p.el ? slide.els.find((x) => x.id === p.el) : undefined
              const x = el ? el.x + el.w - 6 : W - 44, y = el ? el.y - 12 : 14
              return <span key={i} className="cm-pin" style={{ left: x - 11 / 1, top: y, transform: `scale(${1 / scale})`, transformOrigin: '0 0' }} title="Comment">{p.n}</span>
            })}
          </div>
        </SlideStage>
      </div>
    </div>
  )
}

/** Cell-by-cell table editing: Tab and Enter move between cells, and whatever was typed is saved even if the click-away removes the editor before the browser reports a blur. */
function TableEditor({ e, theme, onCell, onActive, onDone }: { e: El; theme: Theme; onCell: (r: number, c: number, text: string) => void; onActive?: (r: number, c: number) => void; onDone: () => void }) {
  const root = useRef<HTMLDivElement>(null)
  const pending = useRef(new Map<string, string>())
  const flush = () => { pending.current.forEach((text, k) => { const [r, c] = k.split(':').map(Number); onCell(r, c, text) }); pending.current.clear() }
  const cb = useRef({ flush }); cb.current.flush = flush
  useEffect(() => { (root.current?.querySelector('td') as HTMLElement | null)?.focus(); return () => cb.current.flush() }, [])
  const cellAt = (r: number, c: number) => root.current?.querySelector(`td[data-r="${r}"][data-c="${c}"]`) as HTMLElement | null
  const nr = e.nr ?? 1, nc = e.nc ?? 1
  return (
    <div ref={root} style={{ position: 'absolute', left: e.x, top: e.y, width: e.w, height: e.h, zIndex: 6, outline: '3px solid #3b82f6' }} onPointerDown={(ev) => ev.stopPropagation()}
      onInput={(ev) => { const td = (ev.target as HTMLElement).closest('td'); if (td) pending.current.set(`${td.dataset.r}:${td.dataset.c}`, (td as HTMLElement).innerText.replace(/\n$/, '')) }}
      onFocus={(ev) => { const td = (ev.target as HTMLElement).closest('td'); if (td) onActive?.(Number(td.dataset.r), Number(td.dataset.c)) }}
      onKeyDown={(ev) => {
        ev.stopPropagation()
        const td = (ev.target as HTMLElement).closest('td'); if (!td) return
        const r = Number(td.dataset.r), c = Number(td.dataset.c)
        if (ev.key === 'Escape') { ev.preventDefault(); flush(); onDone() }
        else if (ev.key === 'Tab') { ev.preventDefault(); flush(); const n = ev.shiftKey ? (c > 0 ? [r, c - 1] : r > 0 ? [r - 1, nc - 1] : [r, c]) : (c < nc - 1 ? [r, c + 1] : r < nr - 1 ? [r + 1, 0] : [r, c]); cellAt(n[0], n[1])?.focus() }
        else if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); flush(); cellAt(Math.min(nr - 1, r + 1), c)?.focus() }
      }}
      onBlur={(ev) => { if (!root.current?.contains(ev.relatedTarget as Node | null)) flush() }}>
      <TableView e={e} t={theme} editable onCell={(r, c, text) => { pending.current.set(`${r}:${c}`, text); flush() }} />
    </div>
  )
}

function handlePos(h: Handle, size: number): React.CSSProperties {
  const o = -size / 2
  const x = h.includes('w') ? { left: o } : h.includes('e') ? { right: o } : { left: `calc(50% - ${size / 2}px)` }
  const y = h.includes('n') ? { top: o } : h.includes('s') ? { bottom: o } : { top: `calc(50% - ${size / 2}px)` }
  return { ...x, ...y, cursor: `${h}-resize` }
}

function TextEditor({ e, theme, onCommit }: { e: El; theme: Theme; onCommit: (text: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const done = useRef(false)
  const latest = useRef(e.text ?? '')
  const commit = useRef(onCommit); commit.current = onCommit
  useEffect(() => {
    done.current = false
    const d = ref.current!; d.textContent = e.text ?? ''; d.focus()
    const r = document.createRange(); r.selectNodeContents(d); const s = getSelection(); s?.removeAllRanges(); s?.addRange(r)
    // Clicking elsewhere can remove this box before the browser sends a blur, so whatever was typed is also saved when it unmounts.
    return () => { if (!done.current) { done.current = true; commit.current(latest.current) } }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const read = () => { latest.current = (ref.current?.innerText ?? latest.current).replace(/\n$/, '') }
  const finish = () => { if (done.current) return; read(); done.current = true; commit.current(latest.current) }
  const justify = e.valign === 'middle' ? 'center' : e.valign === 'bottom' ? 'flex-end' : 'flex-start'
  return (
    <div style={{ position: 'absolute', left: e.x, top: e.y, width: e.w, minHeight: e.h, display: 'flex', flexDirection: 'column', justifyContent: justify }} onPointerDown={(ev) => ev.stopPropagation()}>
      <div ref={ref} contentEditable suppressContentEditableWarning spellCheck={false} className="sl-editor" onBlur={finish} onInput={read}
        onKeyDown={(ev) => { if (ev.key === 'Escape') { ev.preventDefault(); finish() } ev.stopPropagation() }}
        onPaste={(ev) => { ev.preventDefault(); document.execCommand('insertText', false, ev.clipboardData.getData('text/plain')) }}
        style={{ outline: 'none', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: fontStack(elFont(e, theme)), fontSize: e.size ?? 28, fontWeight: e.bold ? 700 : 400, fontStyle: e.italic ? 'italic' : 'normal', textDecoration: e.underline ? 'underline' : 'none', color: resolveColor(e.color, theme, e.role === 'sub' ? 'muted' : 'fg'), textAlign: e.align ?? (e.type === 'shape' ? 'center' : 'left'), lineHeight: 1.25, caretColor: 'currentColor', background: 'transparent' }} />
    </div>
  )
}
export { TextBody }

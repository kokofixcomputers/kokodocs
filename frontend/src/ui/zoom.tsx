import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Maximize2, Minus, Plus } from 'lucide-react'
import './zoom.css'

/** Zoom for every kind of file: out to see the whole thing, in to see detail. The level is remembered per kind. */
export const ZOOM_MIN = 0.1, ZOOM_MAX = 3
const STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2, 3]
const clamp = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100))
const key = (kind: string) => `koko.zoom.${kind}`

export interface Zoom { z: number; set: (z: number) => void; in: () => void; out: () => void; reset: () => void }

export function useZoom(kind: string): Zoom {
  const [z, setZ] = useState(() => { try { return clamp(Number(localStorage.getItem(key(kind))) || 1) } catch { return 1 } })
  const set = useCallback((v: number) => { const n = clamp(v); setZ(n); try { n === 1 ? localStorage.removeItem(key(kind)) : localStorage.setItem(key(kind), String(n)) } catch { /* ignore */ } }, [kind])
  const zin = useCallback(() => set(STEPS.find((s) => s > z + 0.005) ?? ZOOM_MAX), [z, set])
  const zout = useCallback(() => set([...STEPS].reverse().find((s) => s < z - 0.005) ?? ZOOM_MIN), [z, set])
  return { z, set, in: zin, out: zout, reset: () => set(1) }
}

/** Ctrl or ⌘ with the wheel (and a trackpad pinch) zooms the file instead of the whole page. */
export function useWheelZoom(el: RefObject<HTMLElement | null>, zoom: Zoom) {
  const cur = useRef(zoom); cur.current = zoom
  useEffect(() => {
    const node = el.current
    if (!node) return
    const on = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      cur.current.set(cur.current.z * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025)))
    }
    node.addEventListener('wheel', on, { passive: false })
    return () => node.removeEventListener('wheel', on)
  })
}

/** The little control at the bottom right of a file: − 100% + and "fit the whole thing". It sits in the corner of `anchor`, so panels beside the file don't cover it. */
export function ZoomPill({ zoom, anchor, onFit, fitLabel = 'Fit the whole file' }: { zoom: Zoom; anchor: RefObject<HTMLElement | null>; onFit?: () => void; fitLabel?: string }) {
  const [box, setBox] = useState<{ right: number; bottom: number } | null>(null)
  useEffect(() => {   // (after the commit, so the box it sits in has its ref)
    const a = anchor.current
    if (!a) return
    const place = () => {
      const r = a.getBoundingClientRect(), right = Math.max(8, Math.round(window.innerWidth - r.right + 16)), bottom = Math.max(8, Math.round(window.innerHeight - r.bottom + 14))
      setBox((b) => (b && b.right === right && b.bottom === bottom ? b : { right, bottom }))   // (only when it moved, or this would redraw forever)
    }
    place()
    const ro = new ResizeObserver(place); ro.observe(a)
    window.addEventListener('resize', place)
    return () => { ro.disconnect(); window.removeEventListener('resize', place) }
  }, [anchor])
  if (!box) return null
  const pct = Math.round(zoom.z * 100)
  return createPortal(
    <div className="zoom-pill" style={{ right: box.right, bottom: box.bottom }} role="group" aria-label="Zoom">
      <button type="button" aria-label="Zoom out" title="Zoom out" onMouseDown={(e) => e.preventDefault()} onClick={zoom.out} disabled={zoom.z <= ZOOM_MIN + 0.005}><Minus size={15} /></button>
      <button type="button" className="pct" aria-label="Reset to 100%" title="Reset to 100%" onMouseDown={(e) => e.preventDefault()} onClick={zoom.reset}>{pct}%</button>
      <button type="button" aria-label="Zoom in" title="Zoom in" onMouseDown={(e) => e.preventDefault()} onClick={zoom.in} disabled={zoom.z >= ZOOM_MAX - 0.005}><Plus size={15} /></button>
      {onFit && <button type="button" className="fit" aria-label={fitLabel} title={fitLabel} onMouseDown={(e) => e.preventDefault()} onClick={onFit}><Maximize2 size={14} /></button>}
    </div>, document.body)
}

/** Zooms its contents while the box itself keeps its size on the screen: more fits in when zoomed out. Whatever scrolls inside (columns, a table) keeps working.
 *  Used by the files made of ordinary page layout (boards, forms). */
export function Zoomed({ zoom, anchor, fitLabel, className = '', children }: { zoom: Zoom; anchor?: RefObject<HTMLDivElement | null>; fitLabel?: string; className?: string; children: React.ReactNode }) {
  const own = useRef<HTMLDivElement>(null), inner = useRef<HTMLDivElement>(null)
  const ref = anchor ?? own
  useWheelZoom(ref, zoom)
  const fit = () => {
    const box = ref.current, root = inner.current; if (!box || !root) return
    let w = root.clientWidth, h = root.clientHeight   // (natural sizes: the zoom is not part of them)
    for (const el of root.querySelectorAll<HTMLElement>('*')) {
      if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX !== 'visible') w = Math.max(w, el.scrollWidth + (root.clientWidth - el.clientWidth))
      if (el.scrollHeight > el.clientHeight + 2 && getComputedStyle(el).overflowY !== 'visible') h = Math.max(h, el.scrollHeight + (root.clientHeight - el.clientHeight))
    }
    w = Math.max(w, root.scrollWidth); h = Math.max(h, root.scrollHeight)
    zoom.set(Math.max(0.1, Math.min(1, (box.clientWidth - 8) / w, (box.clientHeight - 8) / h)))
  }
  return (
    <div ref={own} className={`zoom-box ${className}`}>
      <div ref={inner} className="zoom-inner" style={{ ['--uz' as string]: zoom.z }}>{children}</div>
      <ZoomPill zoom={zoom} anchor={own} onFit={fit} fitLabel={fitLabel} />
    </div>
  )
}

import { isLinear, isShape, type El, type ShapeKind } from './types'

export type Pt = [number, number]
export interface Box { x: number; y: number; w: number; h: number }

export const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])
export const center = (e: Box): Pt => [e.x + e.w / 2, e.y + e.h / 2]
export function rot(p: Pt, c: Pt, a: number): Pt { if (!a) return p; const s = Math.sin(a), k = Math.cos(a), dx = p[0] - c[0], dy = p[1] - c[1]; return [c[0] + dx * k - dy * s, c[1] + dx * s + dy * k] }
/** the corners of an element, turned by its angle */
export const corners = (e: Box & { a?: number }): Pt[] => { const c = center(e), a = e.a ?? 0; return ([[e.x, e.y], [e.x + e.w, e.y], [e.x + e.w, e.y + e.h], [e.x, e.y + e.h]] as Pt[]).map((p) => rot(p, c, a)) }
export function union(boxes: Box[]): Box | null {
  if (!boxes.length) return null
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const b of boxes) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h) }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}
/** the box that really holds an element on the page (turned ones are measured by their corners) */
export function pageBox(e: El): Box {
  if (!e.a || isLinear(e.type)) return { x: e.x, y: e.y, w: e.w, h: e.h }
  const c = corners(e), xs = c.map((p) => p[0]), ys = c.map((p) => p[1])
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
}

/** for pen strokes, lines and arrows: the box is worked out from the points, and the points are kept relative to its corner */
export function boundsOf(e: El, normalize: boolean): Partial<El> {
  const pts = e.pts ?? []
  if (!pts.length) return {}
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), x0 = Math.min(...xs), y0 = Math.min(...ys)
  if (!normalize) return { w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 }
  return { x: e.x + x0, y: e.y + y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0, pts: pts.map((p) => [p[0] - x0, p[1] - y0] as Pt) }
}
export const absPts = (e: El): Pt[] => (e.pts ?? []).map((p) => [p[0] + e.x, p[1] + e.y] as Pt)

/** the outline of a shape, as a polygon in its own coordinates (0,0 to w,h) */
export function shapePoly(kind: ShapeKind, w: number, h: number): Pt[] {
  switch (kind) {
    case 'diamond': return [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]
    case 'triangle': return [[w / 2, 0], [w, h], [0, h]]
    case 'parallelogram': return [[w * 0.2, 0], [w, 0], [w * 0.8, h], [0, h]]
    case 'hexagon': return [[w * 0.25, 0], [w * 0.75, 0], [w, h / 2], [w * 0.75, h], [w * 0.25, h], [0, h / 2]]
    case 'star': { const out: Pt[] = []; for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.2 : 0.5, t = -Math.PI / 2 + (i * Math.PI) / 5; out.push([w / 2 + Math.cos(t) * w * r * 1 * (r === 0.5 ? 1 : 1), h / 2 + Math.sin(t) * h * r * (r === 0.5 ? 1 : 1)]) } return out }
    case 'ellipse': { const out: Pt[] = []; for (let i = 0; i < 48; i++) { const t = (i / 48) * Math.PI * 2; out.push([w / 2 + (Math.cos(t) * w) / 2, h / 2 + (Math.sin(t) * h) / 2]) } return out }
    default: return [[0, 0], [w, 0], [w, h], [0, h]]
  }
}
const toLocal = (e: El, p: Pt): Pt => { const q = rot(p, center(e), -e.a); return [q[0] - e.x, q[1] - e.y] }

export function inPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
export function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy
  const t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}
const polyEdgeDist = (p: Pt, poly: Pt[]) => { let d = Infinity; for (let i = 0; i < poly.length; i++) d = Math.min(d, segDist(p, poly[i], poly[(i + 1) % poly.length])); return d }
const filled = (e: El) => e.fill !== 'transparent' && e.fill !== 'none' && e.fill !== ''

/** is this point on the element? `tol` is how far from a line still counts (in canvas units) */
export function hit(e: El, p: Pt, tol: number): boolean {
  if (e.hide) return false
  if (isLinear(e.type)) {
    const pts = absPts(e); if (pts.length < 2) return pts.length === 1 && dist(p, pts[0]) <= tol + e.sw
    if (e.type === 'draw' && e.fill !== 'transparent' && closed(e) && inPolygon(p, pts)) return true
    for (let i = 0; i < pts.length - 1; i++) if (segDist(p, pts[i], pts[i + 1]) <= tol + e.sw / 2) return true
    return false
  }
  const q = toLocal(e, p)
  if (e.type === 'text' || e.type === 'image' || e.type === 'embed') return q[0] >= -tol && q[1] >= -tol && q[0] <= e.w + tol && q[1] <= e.h + tol
  if (e.type === 'frame') return polyEdgeDist(q, shapePoly('rect', e.w, e.h)) <= tol + 4 || (q[0] >= 0 && q[0] <= Math.min(e.w, 220) && q[1] >= -26 && q[1] <= 0)
  if (isShape(e.type)) {
    const poly = shapePoly(e.type, e.w, e.h)
    if (filled(e) || e.text) { if (e.type === 'cylinder' || e.type === 'cloud' || e.type === 'document') return q[0] >= -tol && q[1] >= -tol && q[0] <= e.w + tol && q[1] <= e.h + tol; return inPolygon(q, poly) || polyEdgeDist(q, poly) <= tol }
    return polyEdgeDist(q, poly) <= tol + e.sw / 2
  }
  return false
}
export const closed = (e: El) => { const pts = e.pts ?? []; return pts.length > 5 && dist(pts[0], pts[pts.length - 1]) < Math.max(14, 0.12 * Math.max(e.w, e.h)) }

/** where a line from the middle of a shape toward `toward` leaves its outline, pushed a little outwards */
export function leave(e: El, toward: Pt, gap = 6): Pt {
  const c = center(e), tw = e.a ? rot(toward, c, -e.a) : toward
  const poly = (isShape(e.type) ? shapePoly(e.type, e.w, e.h) : shapePoly('rect', e.w, e.h)).map((p) => [p[0] + e.x, p[1] + e.y] as Pt)
  const dx = tw[0] - c[0], dy = tw[1] - c[1], len = Math.hypot(dx, dy) || 1
  let best: Pt | null = null, bt = Infinity
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], ex = b[0] - a[0], ey = b[1] - a[1]
    const den = dx * ey - dy * ex; if (Math.abs(den) < 1e-9) continue
    const t = ((a[0] - c[0]) * ey - (a[1] - c[1]) * ex) / den, u = ((a[0] - c[0]) * dy - (a[1] - c[1]) * dx) / den
    if (t > 0 && u >= 0 && u <= 1 && t < bt) { bt = t; best = [c[0] + dx * t, c[1] + dy * t] }
  }
  const out: Pt = best ?? c
  const o: Pt = [out[0] + (dx / len) * gap, out[1] + (dy / len) * gap]
  return e.a ? rot(o, c, e.a) : o
}
/** the middle of the side of a shape that faces `toward` (used by elbow arrows) */
function side(e: El, toward: Pt, gap = 6): { p: Pt; horizontal: boolean } {
  const c = center(e), dx = toward[0] - c[0], dy = toward[1] - c[1]
  const horizontal = Math.abs(dx) * e.h >= Math.abs(dy) * e.w
  return horizontal
    ? { p: [dx >= 0 ? e.x + e.w + gap : e.x - gap, c[1]], horizontal }
    : { p: [c[0], dy >= 0 ? e.y + e.h + gap : e.y - gap], horizontal }
}

/** the points of an elbow arrow: square corners, leaving and entering the shapes at their sides */
export function elbow(a: Pt, b: Pt, from?: El, to?: El): Pt[] {
  const sa = from ? side(from, to ? center(to) : b) : null, sb = to ? side(to, from ? center(from) : a) : null
  const A = sa?.p ?? a, B = sb?.p ?? b
  const horizontal = sa ? sa.horizontal : sb ? sb.horizontal : Math.abs(B[0] - A[0]) >= Math.abs(B[1] - A[1])
  if (horizontal) { const mx = (A[0] + B[0]) / 2; return [A, [mx, A[1]], [mx, B[1]], B] }
  const my = (A[1] + B[1]) / 2; return [A, [A[0], my], [B[0], my], B]
}

/** an arrow tied to shapes is drawn again from where the shapes now are; null if there is nothing to change */
export function reroute(e: El, get: (id: string) => El | undefined): El | null {
  if (!e.pts || e.pts.length < 2) return null
  const from = e.from ? get(e.from.id) : undefined, to = e.to ? get(e.to.id) : undefined
  if (!from && !to && e.curve !== 'elbow') return null
  const abs = absPts(e); let a = abs[0], b = abs[abs.length - 1]
  let pts: Pt[]
  if (e.curve === 'elbow') {
    pts = elbow(a, b, from, to)
  } else {
    if (from) a = leave(from, to ? center(to) : abs[1])
    if (to) b = leave(to, from ? center(from) : abs[abs.length - 2])
    pts = [a, ...abs.slice(1, -1), b]
  }
  const n: El = { ...e, pts: pts.map((p) => [p[0] - e.x, p[1] - e.y] as Pt) }
  return { ...n, ...boundsOf(n, true) } as El
}

/** the shape under a point, front first (used to tie an arrow to it) */
export function shapeAt(els: El[], p: Pt, skip?: string): El | undefined {
  for (let i = els.length - 1; i >= 0; i--) { const e = els[i]; if (e.id !== skip && !e.hide && (isShape(e.type) || e.type === 'text' || e.type === 'image' || e.type === 'frame' || e.type === 'embed') && hit({ ...e, fill: e.type === 'frame' ? 'transparent' : '#000' }, p, 4) && !(e.type === 'frame')) return e }
  return undefined
}

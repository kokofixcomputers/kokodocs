import type { Pt } from './geometry'
import type { ShapeKind } from './types'

/** Work out what shape a hand-drawn stroke was meant to be (used when you hold the pen still at the end of a stroke). */
export type Rec =
  | { kind: 'line'; a: Pt; b: Pt }
  | { kind: 'shape'; type: ShapeKind; x: number; y: number; w: number; h: number; a: number; label: string }
  | { kind: 'poly'; pts: Pt[]; label: string }

const d = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])
const deg = (r: number) => (r * 180) / Math.PI

function length(p: Pt[]) { let l = 0; for (let i = 1; i < p.length; i++) l += d(p[i - 1], p[i]); return l }
/** the same stroke as n evenly spaced points */
export function resample(p: Pt[], n: number): Pt[] {
  const total = length(p); if (total === 0) return p.slice(0, 1)
  const step = total / (n - 1), out: Pt[] = [[p[0][0], p[0][1]]]
  let acc = 0, prev: Pt = p[0]
  for (let i = 1; i < p.length; i++) {
    let seg = d(prev, p[i])
    while (acc + seg >= step && seg > 0) {
      const t = (step - acc) / seg, q: Pt = [prev[0] + (p[i][0] - prev[0]) * t, prev[1] + (p[i][1] - prev[1]) * t]
      out.push(q); prev = q; seg = d(prev, p[i]); acc = 0
    }
    acc += seg; prev = p[i]
  }
  if (out.length < n) out.push([p[p.length - 1][0], p[p.length - 1][1]])
  return out
}
function dp(p: Pt[], eps: number): Pt[] {
  if (p.length < 3) return p
  const a = p[0], b = p[p.length - 1], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1
  let idx = 0, max = 0
  for (let i = 1; i < p.length - 1; i++) { const dist = Math.abs(dy * p[i][0] - dx * p[i][1] + b[0] * a[1] - b[1] * a[0]) / l; if (dist > max) { max = dist; idx = i } }
  if (max <= eps) return [a, b]
  return [...dp(p.slice(0, idx + 1), eps).slice(0, -1), ...dp(p.slice(idx), eps)]
}
/** the angle at corner b, in degrees (180 = straight on) */
const corner = (a: Pt, b: Pt, c: Pt) => { const v1: Pt = [a[0] - b[0], a[1] - b[1]], v2: Pt = [c[0] - b[0], c[1] - b[1]]; return deg(Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / ((Math.hypot(...v1) * Math.hypot(...v2)) || 1))))) }

export function recognize(raw: Pt[]): Rec | null {
  if (raw.length < 6) return null
  const pts = resample(raw, 96), len = length(pts)
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]) }
  const w = x1 - x0, h = y1 - y0, diag = Math.hypot(w, h)
  if (diag < 28) return null
  const first = pts[0], last = pts[pts.length - 1], gap = d(first, last)

  // ── a straight line ──
  {
    const dx = last[0] - first[0], dy = last[1] - first[1], chord = Math.hypot(dx, dy)
    if (chord > 0) {
      let dev = 0; for (const p of pts) dev = Math.max(dev, Math.abs(dy * (p[0] - first[0]) - dx * (p[1] - first[1])) / chord)
      // held still at the end of a stroke that mostly went one way, so it is wobbly or slightly bent: straighten it
      // (how many times it swings across the straight line between its ends: a few small swings is a wobbly line, wide repeated swings is a squiggle)
      let cross = 0, side = 0
      for (const p of pts) { const off = (dy * (p[0] - first[0]) - dx * (p[1] - first[1])) / chord, sd = off > 0.02 * chord ? 1 : off < -0.02 * chord ? -1 : 0; if (sd && sd !== side) { if (side) cross++; side = sd } }
      if (chord > 0.55 * len && dev / chord < 0.19 && (cross <= 2 || dev / chord < 0.065)) {
        let b: Pt = [last[0], last[1]]
        const ang = Math.atan2(dy, dx), snap = (to: number) => Math.abs(deg(ang) - to) < 5 || Math.abs(deg(ang) - to - 180) < 5 || Math.abs(deg(ang) - to + 180) < 5
        if (snap(0)) b = [last[0], first[1]]; else if (snap(90) || snap(-90)) b = [first[0], last[1]]
        else { const s = Math.round(deg(ang) / 45) * 45; if (Math.abs(deg(ang) - s) < 4) b = [first[0] + Math.cos((s * Math.PI) / 180) * chord, first[1] + Math.sin((s * Math.PI) / 180) * chord] }
        return { kind: 'line', a: [first[0], first[1]], b }
      }
    }
  }
  // ── closed shapes ──
  if (gap / len > 0.24 || len / diag < 1.9) return null
  const closedPts = [...pts.slice(0, -1), pts[0]]
  // (a loop starts and ends at the same place, so it is cut at the point farthest from there and the two halves are simplified separately)
  let m = 0, far = 0; closedPts.forEach((p, i) => { const dd = d(p, closedPts[0]); if (dd > far) { far = dd; m = i } })
  let v = [...dp(closedPts.slice(0, m + 1), 0.055 * diag).slice(0, -1), ...dp(closedPts.slice(m), 0.055 * diag)]; v = v.slice(0, -1)
  // clean up: drop corners that are nearly straight or crowded together
  for (let again = true; again && v.length > 3;) {
    again = false
    for (let i = 0; i < v.length; i++) {
      const a = v[(i + v.length - 1) % v.length], b = v[i], c = v[(i + 1) % v.length]
      if (corner(a, b, c) > 154 || d(b, c) < 0.09 * diag) { v.splice(i, 1); again = true; break }
    }
  }
  const k = v.length
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length

  // an ellipse: the points sit on one, whatever way it is tilted
  const ellipse = () => {
    let sxx = 0, syy = 0, sxy = 0; for (const p of pts) { sxx += (p[0] - cx) ** 2; syy += (p[1] - cy) ** 2; sxy += (p[0] - cx) * (p[1] - cy) }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), c = Math.cos(th), s = Math.sin(th)
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity
    const rot = pts.map((p) => { const u = (p[0] - cx) * c + (p[1] - cy) * s, vv = -(p[0] - cx) * s + (p[1] - cy) * c; a0 = Math.min(a0, u); a1 = Math.max(a1, u); b0 = Math.min(b0, vv); b1 = Math.max(b1, vv); return [u, vv] as Pt })
    const rx = (a1 - a0) / 2, ry = (b1 - b0) / 2, mu = (a0 + a1) / 2, mv = (b0 + b1) / 2
    if (rx < 6 || ry < 6) return null
    let err = 0; for (const [u, vv] of rot) err += Math.abs(Math.sqrt(((u - mu) / rx) ** 2 + ((vv - mv) / ry) ** 2) - 1)
    err /= rot.length
    return { err, th, rx, ry, c: [cx + mu * c - mv * s, cy + mu * s + mv * c] as Pt }
  }
  const sides = v.map((p, i) => d(p, v[(i + 1) % k]))
  const angles = v.map((p, i) => corner(v[(i + k - 1) % k], p, v[(i + 1) % k]))
  const hexOK = k === 6 && Math.max(...sides) / Math.min(...sides) < 1.85 && angles.every((a) => Math.abs(a - 120) < 30)
  const e = ellipse()
  if (e && ((k >= 6 && e.err < 0.13) || e.err < 0.07) && k !== 3 && k !== 4 && !(hexOK && e.err > 0.045)) {
    let a = e.th, w2 = e.rx * 2, h2 = e.ry * 2
    if (Math.abs(deg(a)) < 9 || Math.abs(Math.abs(deg(a)) - 90) < 9) { if (Math.abs(deg(a)) > 45) { [w2, h2] = [h2, w2] } a = 0 }   // tilt so slight it was probably meant straight
    if (Math.abs(w2 - h2) / Math.max(w2, h2) < 0.12) { w2 = h2 = (w2 + h2) / 2; a = 0 }
    return { kind: 'shape', type: 'ellipse', x: e.c[0] - w2 / 2, y: e.c[1] - h2 / 2, w: w2, h: h2, a, label: w2 === h2 ? 'circle' : 'ellipse' }
  }
  if (k === 4) {
    const rightish = angles.every((a) => Math.abs(a - 90) < 22), ratio = (a: number, b: number) => Math.abs(a - b) / Math.max(a, b)
    if (rightish && ratio(sides[0], sides[2]) < 0.28 && ratio(sides[1], sides[3]) < 0.28) {
      // are the four corners at the middles of the sides of their box? then it is a diamond
      const mid = [[(x0 + x1) / 2, y0], [x1, (y0 + y1) / 2], [(x0 + x1) / 2, y1], [x0, (y0 + y1) / 2]]
      const diamond = mid.every((m) => v.some((p) => d(p, m as Pt) < 0.2 * diag))
      if (diamond) return { kind: 'shape', type: 'diamond', x: x0, y: y0, w, h, a: 0, label: 'diamond' }
      const long = sides[0] >= sides[1] ? 0 : 1, ex = v[(long + 1) % 4][0] - v[long][0], ey = v[(long + 1) % 4][1] - v[long][1]
      let th = Math.atan2(ey, ex); while (th > Math.PI / 2) th -= Math.PI; while (th < -Math.PI / 2) th += Math.PI
      if (Math.abs(deg(th)) < 9) th = 0; else if (Math.abs(Math.abs(deg(th)) - 90) < 9) th = 0
      let ww = (sides[long] + sides[(long + 2) % 4]) / 2, hh = (sides[(long + 1) % 4] + sides[(long + 3) % 4]) / 2
      if (Math.abs(deg(Math.atan2(ey, ex))) > 45 && Math.abs(deg(Math.atan2(ey, ex))) < 135 && th === 0) [ww, hh] = [hh, ww]
      if (Math.abs(ww - hh) / Math.max(ww, hh) < 0.12) ww = hh = (ww + hh) / 2
      const ccx = v.reduce((s, p) => s + p[0], 0) / 4, ccy = v.reduce((s, p) => s + p[1], 0) / 4
      return { kind: 'shape', type: 'rect', x: ccx - ww / 2, y: ccy - hh / 2, w: ww, h: hh, a: th, label: ww === hh ? 'square' : 'rectangle' }
    }
    return { kind: 'poly', pts: [...v, v[0]].map((p) => [p[0], p[1]] as Pt), label: 'quadrilateral' }
  }
  if (k === 3) {
    // a triangle standing on a flat base, pointing up or down, and even-sided enough: the triangle shape; otherwise exactly the three corners
    const base = [0, 1, 2].reduce((m, i) => (Math.abs(v[i][1] - v[(i + 1) % 3][1]) < Math.abs(v[m][1] - v[(m + 1) % 3][1]) ? i : m), 0)
    const A = v[base], B = v[(base + 1) % 3], C = v[(base + 2) % 3]
    if (Math.abs(A[1] - B[1]) < 0.12 * diag && Math.abs(C[0] - (A[0] + B[0]) / 2) < 0.16 * Math.abs(A[0] - B[0])) {
      const up = C[1] < A[1], bx0 = Math.min(A[0], B[0]), bw = Math.abs(A[0] - B[0]), by = (A[1] + B[1]) / 2
      return { kind: 'shape', type: 'triangle', x: bx0, y: up ? C[1] : by, w: bw, h: Math.abs(by - C[1]), a: up ? 0 : Math.PI, label: 'triangle' }
    }
    return { kind: 'poly', pts: [...v, v[0]].map((p) => [p[0], p[1]] as Pt), label: 'triangle' }
  }
  if (k === 6) {
    if (hexOK) return { kind: 'shape', type: 'hexagon', x: x0, y: y0, w, h, a: 0, label: 'hexagon' }
  }
  if (k >= 5 && k <= 9) return { kind: 'poly', pts: [...v, v[0]].map((p) => [p[0], p[1]] as Pt), label: k === 5 ? 'pentagon' : 'polygon' }
  if (e && e.err < 0.2) return { kind: 'shape', type: 'ellipse', x: e.c[0] - e.rx, y: e.c[1] - e.ry, w: e.rx * 2, h: e.ry * 2, a: 0, label: 'ellipse' }
  return null
}

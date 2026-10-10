import { RoughGenerator } from 'roughjs/bin/generator'
import type { Options } from 'roughjs/bin/core'
import { getStroke } from 'perfect-freehand'
import { closed, shapePoly, type Pt } from './geometry'
import type { El, Head } from './types'

/** A piece of a drawing, ready for an SVG <path>. */
export interface Part { d: string; stroke: string; fill: string; sw: number; dash?: string; round?: boolean }

const gen = new RoughGenerator()
/** how hand-drawn: 0 is clean, 1 sketchy, 2 very sketchy, and anything in between or beyond */
const rough = (ro: number) => (ro <= 1 ? ro : 1 + (ro - 1) * 1.3), bow = (ro: number) => (ro <= 1 ? ro : 1 + (ro - 1) * 1.2)

function opts(e: El, fill: boolean): Options {
  const sw = e.sw, solid = e.fs === 'solid'
  const o: Options = {
    seed: e.seed, roughness: rough(e.ro), bowing: bow(e.ro), strokeWidth: sw, stroke: e.stroke, disableMultiStroke: e.ro < 0.15, preserveVertices: e.ro < 0.15,
    fill: fill && e.fill !== 'transparent' && e.fill !== 'none' ? e.fill : undefined,
    fillStyle: e.fs === 'cross-hatch' ? 'cross-hatch' : e.fs, hachureGap: solid ? undefined : e.fgap && e.fgap > 0 ? e.fgap : Math.max(7, sw * 4), fillWeight: Math.max(1, sw * 0.7), hachureAngle: -41,
    curveStepCount: 12, maxRandomnessOffset: 2 + sw * 0.2,
  }
  if (e.ss === 'dashed') o.strokeLineDash = [sw * 4 + 4, sw * 3 + 3]
  else if (e.ss === 'dotted') o.strokeLineDash = [0.1, sw * 2.4 + 2]
  return o
}
const parts = (d: ReturnType<RoughGenerator['rectangle']>, e: El): Part[] => gen.toPaths(d).map((p) => ({
  d: p.d, stroke: p.stroke === 'none' ? 'none' : p.stroke, fill: p.fill ?? 'none', sw: p.strokeWidth, dash: e.ss === 'solid' ? undefined : undefined, round: e.ss === 'dotted',
}))

const roundRect = (w: number, h: number, r: number) => {
  r = Math.max(0, Math.min(r, w / 2, h / 2))
  return `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`
}
function shapePath(e: El): string | null {
  const { w, h } = e
  if (e.type === 'cylinder') { const ry = Math.min(h * 0.16, 28); return `M 0 ${ry} A ${w / 2} ${ry} 0 0 1 ${w} ${ry} L ${w} ${h - ry} A ${w / 2} ${ry} 0 0 1 0 ${h - ry} Z M 0 ${ry} A ${w / 2} ${ry} 0 0 0 ${w} ${ry}` }
  if (e.type === 'cloud') return `M ${w * 0.25} ${h * 0.82} C ${-w * 0.06} ${h * 0.82} ${-w * 0.06} ${h * 0.42} ${w * 0.2} ${h * 0.42} C ${w * 0.18} ${h * 0.08} ${w * 0.52} ${-h * 0.04} ${w * 0.6} ${h * 0.26} C ${w * 0.76} ${h * 0.02} ${w * 1.02} ${h * 0.18} ${w * 0.86} ${h * 0.46} C ${w * 1.1} ${h * 0.56} ${w * 1.04} ${h * 0.86} ${w * 0.78} ${h * 0.82} Z`
  if (e.type === 'document') return `M 0 0 H ${w} V ${h * 0.86} Q ${w * 0.75} ${h * 1.04} ${w * 0.5} ${h * 0.86} T 0 ${h * 0.86} Z`
  if (e.type === 'rect' && e.rad > 0) return roundRect(w, h, e.rad >= 999 ? h / 2 : e.rad)
  return null
}

/** the lines of a shape, in its own coordinates (0,0 is its top-left corner) */
export function shapeParts(e: El): Part[] {
  const w = Math.max(1, e.w), h = Math.max(1, e.h)
  const o = opts(e, true), p = shapePath({ ...e, w, h })
  if (p) return parts(gen.path(p, o), e)
  if (e.type === 'rect') return parts(gen.rectangle(0, 0, w, h, o), e)
  if (e.type === 'ellipse') return parts(gen.ellipse(w / 2, h / 2, w, h, o), e)
  return parts(gen.polygon(shapePoly(e.type as never, w, h), o), e)
}

const heads = (e: El, tip: Pt, from: Pt, kind: Head): Part[] => {
  if (kind === 'none') return []
  const a = Math.atan2(tip[1] - from[1], tip[0] - from[0]), L = 11 + e.sw * 3.2
  const at = (ang: number, len = L): Pt => [tip[0] - Math.cos(a + ang) * len, tip[1] - Math.sin(a + ang) * len]
  const o = { ...opts({ ...e, ss: 'solid', fill: e.stroke, fs: 'solid' }, kind !== 'arrow' && kind !== 'bar'), roughness: Math.min(rough(e.ro), 1) }
  if (kind === 'arrow') return parts(gen.linearPath([at(0.5), tip, at(-0.5)], o), e)
  if (kind === 'triangle') return parts(gen.polygon([tip, at(0.42), at(-0.42)], o), e)
  if (kind === 'diamond') { const m = at(0, L * 0.6), b = at(0, L * 1.2); return parts(gen.polygon([tip, [m[0] + (at(0.6)[1] - m[1]) * 0.0 + Math.sin(a) * L * 0.36, m[1] - Math.cos(a) * L * 0.36], b, [m[0] - Math.sin(a) * L * 0.36, m[1] + Math.cos(a) * L * 0.36]], o), e) }
  if (kind === 'dot') return parts(gen.circle(tip[0] - Math.cos(a) * L * 0.3, tip[1] - Math.sin(a) * L * 0.3, L * 0.7, o), e)
  return parts(gen.line(tip[0] - Math.cos(a - Math.PI / 2) * L * 0.5, tip[1] - Math.sin(a - Math.PI / 2) * L * 0.5, tip[0] + Math.cos(a - Math.PI / 2) * L * 0.5, tip[1] + Math.sin(a - Math.PI / 2) * L * 0.5, o), e)
}

/** the path a line or arrow follows, as points to draw through (curved ones have a bend in the middle) */
export function linePath(e: El): { d: string; mid: Pt } {
  const pts = (e.pts ?? []) as Pt[]
  if (pts.length < 2) return { d: '', mid: [0, 0] }
  if (e.curve === 'curved' && pts.length === 2) {
    const [a, b] = pts, mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dx = b[0] - a[0], dy = b[1] - a[1], k = 0.22
    const c: Pt = [mx - dy * k, my + dx * k]
    return { d: `M ${a[0]} ${a[1]} Q ${c[0]} ${c[1]} ${b[0]} ${b[1]}`, mid: [mx * 0.5 + c[0] * 0.5, my * 0.5 + c[1] * 0.5] }
  }
  const i = Math.floor((pts.length - 1) / 2), m: Pt = pts.length % 2 ? pts[i + 1 > pts.length - 1 ? i : i] : [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2]
  return { d: '', mid: m }
}
export function lineParts(e: El): Part[] {
  const pts = (e.pts ?? []) as Pt[]
  if (pts.length < 2) return []
  const o = opts(e, false)
  let tipA: Pt = pts[0], afterA: Pt = pts[1], tipB: Pt = pts[pts.length - 1], beforeB: Pt = pts[pts.length - 2]
  let out: Part[]
  if (e.curve === 'curved' && pts.length === 2) {
    const { d } = linePath(e); out = parts(gen.path(d, o), e)
    const [a, b] = pts, mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, c: Pt = [mx - (b[1] - a[1]) * 0.22, my + (b[0] - a[0]) * 0.22]
    afterA = c; beforeB = c
  } else if (e.curve === 'curved' && pts.length > 2) out = parts(gen.curve(pts, o), e)
  else out = parts(gen.linearPath(pts, o), e)
  if (e.type === 'arrow') { if (e.he && e.he !== 'none') out.push(...heads(e, tipB, beforeB, e.he)); if (e.hs && e.hs !== 'none') out.push(...heads(e, tipA, afterA, e.hs)) }
  return out
}

const quad = (pts: number[][]) => {
  if (pts.length < 2) return ''
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)} Q`
  for (let i = 1; i < pts.length - 1; i++) d += ` ${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)} ${((pts[i][0] + pts[i + 1][0]) / 2).toFixed(1)} ${((pts[i][1] + pts[i + 1][1]) / 2).toFixed(1)}`
  return d + ' Z'
}
/** a pen stroke: a smooth shape with a little pressure in it, filled with the stroke colour (plus a fill behind it when the line closes on itself) */
export function drawParts(e: El): Part[] {
  const pts = (e.pts ?? []) as Pt[]
  if (!pts.length) return []
  const size = e.hl ? Math.max(10, e.sw * 3) : e.sw * 2.4
  const pressured = pts.some((q) => q.length > 2)   // drawn with a pen that senses how hard it is pressed
  const outline = pts.length === 1 ? getStroke([pts[0], [pts[0][0] + 0.1, pts[0][1]]], { size, last: true }) : getStroke(pts, { size: pressured ? size * 1.5 : size, thinning: e.hl ? 0 : pressured ? 0.7 : 0.55, smoothing: 0.55, streamline: pressured ? 0.35 : 0.5, simulatePressure: !e.hl && !pressured, last: true })
  const out: Part[] = []
  if (closed(e) && e.fill !== 'transparent' && e.fill !== 'none') out.push(...parts(gen.polygon(pts, { ...opts(e, true), stroke: 'none', strokeWidth: 0 }), e).filter((p) => p.fill !== 'none'))
  out.push({ d: quad(outline), stroke: 'none', fill: e.stroke, sw: 0 })
  return out
}

const cache = new WeakMap<El, Part[]>()
export function partsOf(e: El): Part[] {
  let c = cache.get(e)
  if (!c) { c = e.type === 'draw' ? drawParts(e) : e.type === 'line' || e.type === 'arrow' ? lineParts(e) : e.type === 'text' || e.type === 'image' || e.type === 'embed' || e.type === 'frame' ? [] : shapeParts(e); cache.set(e, c) }
  return c
}

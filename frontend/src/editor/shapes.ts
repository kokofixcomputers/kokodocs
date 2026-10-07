/** Shapes you can drop into a document. One description of a shape (its attributes) turns into SVG here, and that same SVG is what the
 *  editor shows, what HTML and PDF export contain, and what Word export turns into a picture. */
export type ShapeKind = 'rect' | 'round' | 'ellipse' | 'triangle' | 'diamond' | 'hexagon' | 'star' | 'arrow' | 'line'
export const SHAPE_KINDS: { id: ShapeKind; name: string }[] = [
  { id: 'rect', name: 'Rectangle' }, { id: 'round', name: 'Rounded rectangle' }, { id: 'ellipse', name: 'Ellipse' }, { id: 'triangle', name: 'Triangle' },
  { id: 'diamond', name: 'Diamond' }, { id: 'hexagon', name: 'Hexagon' }, { id: 'star', name: 'Star' }, { id: 'arrow', name: 'Arrow' }, { id: 'line', name: 'Line' },
]

export interface ShapeAttrs { shape: ShapeKind; w: number; h: number; fill: string; stroke: string; sw: number; text: string; fs: number }

export const DEFAULT_SHAPE: ShapeAttrs = { shape: 'rect', w: 160, h: 100, fill: '#e0e7ff', stroke: '#6366f1', sw: 2, text: '', fs: 15 }
export const SHAPE_MIN = 16
export const SHAPE_MAX = 1200

const HEX = /^#[0-9a-f]{6}$/i
const num = (v: unknown, d: number, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d }
const colour = (v: unknown, d: string) => (typeof v === 'string' && (HEX.test(v) || v === 'none') ? v : d)

/** Clean up whatever came in (pasted HTML, an old version, the assistant) into attributes that are safe to draw. */
export function cleanShape(a: Partial<Record<keyof ShapeAttrs, unknown>> = {}): ShapeAttrs {
  const kind = SHAPE_KINDS.some((k) => k.id === a.shape) ? (a.shape as ShapeKind) : 'rect'
  const line = kind === 'line'
  return {
    shape: kind, w: num(a.w, line ? 200 : DEFAULT_SHAPE.w, SHAPE_MIN, SHAPE_MAX), h: num(a.h, line ? 24 : DEFAULT_SHAPE.h, SHAPE_MIN, SHAPE_MAX),
    fill: colour(a.fill, DEFAULT_SHAPE.fill), stroke: colour(a.stroke, DEFAULT_SHAPE.stroke), sw: num(a.sw, DEFAULT_SHAPE.sw, 0, 16),
    text: typeof a.text === 'string' ? a.text.slice(0, 300) : '', fs: num(a.fs, DEFAULT_SHAPE.fs, 8, 72),
  }
}

const lum = (hex: string) => { const n = parseInt(hex.slice(1), 16), f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255) }
/** Text colour that stays readable on the fill (a shape with no fill sits on the page, so dark text). */
export const textOn = (fill: string) => (HEX.test(fill) && lum(fill) < 0.4 ? '#ffffff' : '#111111')

/** Break text into lines that fit a width, by an estimate of character width (good enough for labels). */
export function wrapText(text: string, widthPx: number, fs: number): string[] {
  const max = Math.max(3, Math.floor(widthPx / (fs * 0.56)))
  const lines: string[] = []
  for (const para of text.split('\n')) {
    let cur = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (word.length > max) { if (cur) { lines.push(cur); cur = '' } for (let i = 0; i < word.length; i += max) lines.push(word.slice(i, i + max)); continue }
      if (!cur) cur = word
      else if ((cur + ' ' + word).length <= max) cur += ' ' + word
      else { lines.push(cur); cur = word }
    }
    lines.push(cur)
  }
  return lines.length > 6 ? [...lines.slice(0, 5), lines[5] + '…'] : lines
}

const f = (n: number) => String(Math.round(n * 100) / 100)
const pts = (p: [number, number][]) => p.map(([x, y]) => `${f(x)},${f(y)}`).join(' ')

function starPoints(w: number, h: number, p: number): [number, number][] {
  const cx = w / 2, cy = h / 2 + h * 0.03, R = Math.min(w, h) / 2 - p, r = R * 0.4, out: [number, number][] = []
  const rx = (w / 2 - p) / (Math.min(w, h) / 2 - p), ry = (h / 2 - p) / (Math.min(w, h) / 2 - p)   // stretch with the box
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rad = i % 2 ? r : R; out.push([cx + Math.cos(a) * rad * rx, cy + Math.sin(a) * rad * ry]) }
  return out
}

type Spec = [string, Record<string, string | number>, ...(Spec | string)[]]
const NS = 'http://www.w3.org/2000/svg '

/** The drawing as a ProseMirror-style spec: used directly for HTML output and turned into DOM by the editor. */
export function shapeSpec(input: Partial<ShapeAttrs>): Spec {
  const a = cleanShape(input), { w, h } = a
  const p = a.shape === 'line' ? a.sw / 2 : a.sw / 2
  const paint: Record<string, string | number> = { fill: a.shape === 'line' ? 'none' : a.fill, stroke: a.sw > 0 || a.shape === 'line' ? a.stroke : 'none', 'stroke-width': a.shape === 'line' ? Math.max(1, a.sw) : a.sw, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }
  let body: Spec
  switch (a.shape) {
    case 'ellipse': body = [NS + 'ellipse', { cx: f(w / 2), cy: f(h / 2), rx: f(Math.max(0, w / 2 - p)), ry: f(Math.max(0, h / 2 - p)), ...paint }]; break
    case 'round': body = [NS + 'rect', { x: f(p), y: f(p), width: f(Math.max(0, w - 2 * p)), height: f(Math.max(0, h - 2 * p)), rx: f(Math.min(w, h) * 0.2), ...paint }]; break
    case 'triangle': body = [NS + 'polygon', { points: pts([[w / 2, p], [w - p, h - p], [p, h - p]]), ...paint }]; break
    case 'diamond': body = [NS + 'polygon', { points: pts([[w / 2, p], [w - p, h / 2], [w / 2, h - p], [p, h / 2]]), ...paint }]; break
    case 'hexagon': body = [NS + 'polygon', { points: pts([[w * 0.25, p], [w * 0.75, p], [w - p, h / 2], [w * 0.75, h - p], [w * 0.25, h - p], [p, h / 2]]), ...paint }]; break
    case 'star': body = [NS + 'polygon', { points: pts(starPoints(w, h, p)), ...paint }]; break
    case 'arrow': body = [NS + 'polygon', { points: pts([[p, h * 0.3], [w * 0.6, h * 0.3], [w * 0.6, p], [w - p, h / 2], [w * 0.6, h - p], [w * 0.6, h * 0.7], [p, h * 0.7]]), ...paint }]; break
    case 'line': body = [NS + 'line', { x1: f(p + 1), y1: f(h / 2), x2: f(w - p - 1), y2: f(h / 2), ...paint }]; break
    default: body = [NS + 'rect', { x: f(p), y: f(p), width: f(Math.max(0, w - 2 * p)), height: f(Math.max(0, h - 2 * p)), ...paint }]
  }
  const kids: (Spec | string)[] = [body]
  if (a.text.trim() && a.shape !== 'line') {
    const inset = a.shape === 'triangle' ? 0.5 : a.shape === 'diamond' || a.shape === 'star' ? 0.55 : a.shape === 'ellipse' || a.shape === 'hexagon' ? 0.78 : a.shape === 'arrow' ? 0.55 : 0.92
    const cy = a.shape === 'triangle' ? h * 0.64 : a.shape === 'arrow' ? h / 2 : h / 2
    const cx = a.shape === 'arrow' ? w * 0.3 : w / 2
    const room = a.shape === 'arrow' ? w * 0.52 : w * inset
    const lines = wrapText(a.text, room - 6, a.fs), lh = a.fs * 1.25
    const y0 = cy - ((lines.length - 1) * lh) / 2
    kids.push([NS + 'text', { x: f(cx), 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': a.fs, 'font-family': 'Inter, system-ui, sans-serif', 'font-weight': 500, fill: textOn(a.fill) },
      ...lines.map((ln, i): Spec => [NS + 'tspan', { x: f(cx), y: f(y0 + i * lh) }, ln])])
  }
  return [NS + 'svg', { viewBox: `0 0 ${f(w)} ${f(h)}`, width: f(w), height: f(h), role: 'img', 'aria-label': a.text.trim() || a.shape, class: 'doc-shape-svg' }, ...kids]
}

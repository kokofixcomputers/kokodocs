import { fontStack } from '../fonts'
import { isShape, type El } from './types'

let ctx: CanvasRenderingContext2D | null = null
const c2d = () => (ctx ??= document.createElement('canvas').getContext('2d')!)
export const LH = 1.28
export const fontCss = (e: Pick<El, 'font' | 'size' | 'bold' | 'italic'>) => `${e.italic ? 'italic ' : ''}${e.bold ? '700 ' : '400 '}${e.size ?? 24}px ${fontStack(e.font ?? 'Caveat')}`

const widths = new Map<string, number>()
export function measure(text: string, css: string): number {
  const k = css + '|' + text, hit = widths.get(k); if (hit !== undefined) return hit
  const g = c2d(); g.font = css; const w = g.measureText(text).width
  if (widths.size > 6000) widths.clear()
  widths.set(k, w); return w
}
/** break text into lines that fit a width (new lines in the text are kept; a word longer than the width is cut) */
export function wrapLines(text: string, css: string, maxW: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    if (!para) { out.push(''); continue }
    let line = ''
    for (const word of para.split(/(?<=\s)/)) {
      const t = line + word
      if (!line || measure(t.trimEnd(), css) <= maxW) { line = t; continue }
      out.push(line.trimEnd()); line = word
      while (measure(line.trimEnd(), css) > maxW && line.length > 1) {   // a single word wider than the box
        let n = line.length - 1; while (n > 1 && measure(line.slice(0, n), css) > maxW) n--
        out.push(line.slice(0, n)); line = line.slice(n)
      }
    }
    out.push(line.trimEnd())
  }
  return out
}
/** how much room text takes inside a shape of this kind (the middle of a diamond or an ellipse is narrower than its box) */
export function inset(e: El): { w: number; h: number } {
  const k = e.type === 'ellipse' || e.type === 'cloud' ? 0.74 : e.type === 'diamond' ? 0.52 : e.type === 'triangle' ? 0.5 : e.type === 'hexagon' ? 0.8 : e.type === 'star' ? 0.5 : 0.92
  return { w: Math.max(20, e.w * k - 14), h: Math.max(16, e.h * k) }
}
export interface Laid { lines: string[]; lh: number; w: number; h: number; css: string }
export function layout(e: El): Laid {
  const size = e.size ?? 24, lh = size * LH, css = fontCss(e), text = e.text ?? ''
  let lines: string[]
  if (isShape(e.type) || e.type === 'frame') lines = wrapLines(text, css, inset(e).w)
  else if (e.type === 'text' && e.wrap) lines = wrapLines(text, css, Math.max(20, e.w))
  else lines = text.split('\n')
  const w = Math.max(...lines.map((l) => measure(l, css)), 0)
  return { lines, lh, w, h: lines.length * lh, css }
}
/** the size a free-standing text needs */
export function fitText(e: El): { w: number; h: number } {
  const l = layout(e); return { w: e.wrap ? e.w : Math.max(12, Math.ceil(l.w) + 2), h: Math.max(l.lh, Math.ceil(l.h)) }
}

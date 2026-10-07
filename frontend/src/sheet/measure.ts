let ctx: CanvasRenderingContext2D | null = null
const cache = new Map<string, number>()
export function textWidth(text: string, font: string): number {
  const k = font + '\u0000' + text
  const hit = cache.get(k)
  if (hit !== undefined) return hit
  if (!ctx) ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return text.length * 7
  ctx.font = font
  const w = ctx.measureText(text).width
  if (cache.size > 20000) cache.clear()
  cache.set(k, w)
  return w
}

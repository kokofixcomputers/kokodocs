import { fontCssUrl } from '../fonts'
import { pageBox, union } from './geometry'
import type { El } from './types'

/** Pictures of the board. The fonts used are fetched and put inside the picture, so the text looks the same wherever it is opened. */
async function fontStyles(els: El[]): Promise<string> {
  const used = [...new Set(els.map((e) => e.font).filter(Boolean) as string[])].slice(0, 12)
  let css = ''
  for (const f of used) {
    const url = fontCssUrl(f); if (!url) continue
    try {
      let t = await (await fetch(url)).text()
      const urls = [...new Set([...t.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1]))].slice(0, 6)
      for (const u of urls) {
        const buf = await (await fetch(u)).arrayBuffer()
        let bin = ''; new Uint8Array(buf).forEach((b) => { bin += String.fromCharCode(b) })
        t = t.split(u).join(`data:font/woff2;base64,${btoa(bin)}`)
      }
      css += t
    } catch { /* that font is left out */ }
  }
  return css
}
const imageData = async (src: string): Promise<string> => {
  if (!src || src.startsWith('data:')) return src
  try { const b = await (await fetch(src)).blob(); return await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsDataURL(b) }) } catch { return src }
}

export interface Region { x: number; y: number; w: number; h: number }
export async function boardSvg(els: El[], bg: string, opt: { pad?: number; region?: Region } = {}): Promise<{ svg: string; w: number; h: number }> {
  const region = opt.region, pad = region ? 0 : opt.pad ?? 32
  let live = els.filter((e) => !e.hide && e.type !== 'embed')
  if (region) live = live.filter((e) => { const p = pageBox(e); return p.x < region.x + region.w && p.x + p.w > region.x && p.y < region.y + region.h && p.y + p.h > region.y })
  const b = region ?? union(live.map(pageBox)) ?? { x: 0, y: 0, w: 400, h: 300 }
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { createElement } = await import('react')
  const { ElNode } = await import('./Scene')
  const withImgs = await Promise.all(live.map(async (e) => (e.type === 'image' ? { ...e, src: await imageData(e.src ?? '') } : e)))
  const inner = withImgs.map((e) => renderToStaticMarkup(createElement('svg', null, createElement(ElNode, { e, bg })))).map((s) => s.replace(/^<svg>|<\/svg>$/g, '')).join('')
  const w = Math.ceil(b.w + pad * 2), h = Math.ceil(b.h + pad * 2), css = await fontStyles(live)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><style>${css}</style><rect width="100%" height="100%" fill="${bg}"/><g transform="translate(${pad - b.x} ${pad - b.y})">${inner}</g></svg>`
  return { svg, w, h }
}
const save = (blob: Blob, name: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000) }
export async function exportSvg(els: El[], bg: string, title: string) { const { svg } = await boardSvg(els, bg); save(new Blob([svg], { type: 'image/svg+xml' }), `${title || 'whiteboard'}.svg`) }
export async function pngBlob(els: El[], bg: string, scale = 2, region?: Region, max = 2400): Promise<Blob> {
  const { svg, w, h } = await boardSvg(els, bg, { region })
  const k = Math.min(scale, max / Math.max(w, h))
  const img = new Image(); img.decoding = 'async'
  await new Promise<void>((ok, bad) => { img.onload = () => ok(); img.onerror = () => bad(new Error('The picture could not be made')); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) })
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k))
  const g = c.getContext('2d')!; g.scale(k, k); g.drawImage(img, 0, 0, w, h)
  return await new Promise((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error('The picture could not be made'))), 'image/png'))
}
export async function exportPng(els: El[], bg: string, title: string) { save(await pngBlob(els, bg), `${title || 'whiteboard'}.png`) }

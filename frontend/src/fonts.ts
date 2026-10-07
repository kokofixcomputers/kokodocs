import raw from './fonts.json'

export type FontCategory = 'sans' | 'serif' | 'display' | 'hand' | 'mono'
export interface FontInfo { family: string; category: FontCategory; weights: number[]; italic: boolean }

export const FONTS: FontInfo[] = (raw as [string, FontCategory, number[], number][]).map(
  ([family, category, weights, italic]) => ({ family, category, weights, italic: !!italic }),
)
const byName = new Map(FONTS.map((f) => [f.family, f]))
export const CATEGORY_LABEL: Record<FontCategory | 'all', string> = {
  all: 'All', sans: 'Sans serif', serif: 'Serif', display: 'Display', hand: 'Handwriting', mono: 'Monospace',
}
export const DEFAULT_FONT = 'Inter'

const loaded = new Set<string>()
const enc = (s: string) => encodeURIComponent(s).replace(/%20/g, '+')

function addLink(href: string) {
  const l = document.createElement('link')
  l.rel = 'stylesheet'
  l.href = href
  document.head.appendChild(l)
}

/** Google Fonts stylesheet URL for the regular/bold/italic faces of a family (null if it isn't a Google font). */
export function fontCssUrl(family: string): string | null {
  const info = byName.get(family)
  if (!info) return null
  const want = [400, 700].filter((w) => info.weights.includes(w))
  const ws = want.length ? want : info.weights.slice(0, 1)
  if (!ws.length) return `https://fonts.googleapis.com/css2?family=${enc(family)}&display=swap`
  const spec = info.italic
    ? `ital,wght@${ws.map((w) => `0,${w}`).concat(ws.map((w) => `1,${w}`)).join(';')}`
    : `wght@${ws.join(';')}`
  return `https://fonts.googleapis.com/css2?family=${enc(family)}:${spec}&display=swap`
}

/** Load the regular/bold/italic faces of a family from Google Fonts (once). */
export function loadFont(family: string) {
  if (loaded.has(family) || family === 'Lexend' || family === 'Inter') return
  loaded.add(family)
  const url = fontCssUrl(family)
  if (url) addLink(url)
}

const previews = new Set<string>()
/** Tiny glyph-subset load so the picker can show each name in its own typeface. */
export function loadFontPreview(family: string) {
  if (previews.has(family) || loaded.has(family)) return
  previews.add(family)
  addLink(`https://fonts.googleapis.com/css2?family=${enc(family)}&text=${enc(family)}&display=swap`)
}

export const fontStack = (family: string) => {
  const cat = byName.get(family)?.category
  const fb = cat === 'serif' ? 'serif' : cat === 'mono' ? 'monospace' : cat === 'hand' ? 'cursive' : 'sans-serif'
  return `"${family}", ${fb}`
}

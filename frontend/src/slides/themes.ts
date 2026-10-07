export const W = 1280, H = 720

export interface Theme {
  id: string; name: string
  bg: string; fg: string; muted: string; accent: string; accentInk: string
  head: string; body: string
}
/** A theme with the deck's own heading/body fonts laid over it (any of the 2000 fonts), when it has chosen them. */
export const withFonts = (t: Theme, head?: string | null, body?: string | null): Theme => (head || body ? { ...t, head: head || t.head, body: body || t.body } : t)
export const THEMES: Theme[] = [
  { id: 'mono', name: 'Monochrome', bg: '#ffffff', fg: '#111111', muted: '#6b6b6b', accent: '#111111', accentInk: '#ffffff', head: 'Inter', body: 'Inter' },
  { id: 'night', name: 'Night', bg: '#121212', fg: '#f3f3f3', muted: '#9a9a9a', accent: '#f3f3f3', accentInk: '#121212', head: 'Inter', body: 'Inter' },
  { id: 'paper', name: 'Paper', bg: '#f6f1e7', fg: '#2b2420', muted: '#7d6f62', accent: '#b4532a', accentInk: '#ffffff', head: 'Playfair Display', body: 'Source Sans 3' },
  { id: 'ocean', name: 'Ocean', bg: '#0b1f33', fg: '#eaf4ff', muted: '#8fb3d1', accent: '#3aa0ff', accentInk: '#06121f', head: 'Poppins', body: 'Inter' },
  { id: 'forest', name: 'Forest', bg: '#f1f6f0', fg: '#14301f', muted: '#5d7a66', accent: '#1f8a4c', accentInk: '#ffffff', head: 'Lexend', body: 'Inter' },
  { id: 'sunset', name: 'Sunset', bg: '#fff4ec', fg: '#3a1d12', muted: '#946a58', accent: '#ef5b2a', accentInk: '#ffffff', head: 'Poppins', body: 'Inter' },
]
export const themeById = (id: string | undefined) => THEMES.find((t) => t.id === id) ?? THEMES[0]

export type ElType = 'text' | 'shape' | 'image' | 'table' | 'chart'
export type ChartKind = 'column' | 'bar' | 'line' | 'area' | 'pie' | 'scatter'
export type ShapeKind = 'rect' | 'round' | 'ellipse' | 'triangle' | 'line' | 'arrow'
export interface El {
  id: string; type: ElType
  x: number; y: number; w: number; h: number; z: number
  role?: 'title' | 'body' | 'sub' | 'stat' | 'label' | 'heading' | 'quote'
  text?: string; font?: string; size?: number; bold?: boolean; italic?: boolean; underline?: boolean
  align?: 'left' | 'center' | 'right'; valign?: 'top' | 'middle' | 'bottom'
  color?: string; bullets?: boolean
  shape?: ShapeKind; fill?: string; stroke?: string; strokeW?: number
  src?: string; alt?: string; opacity?: number
  /** tables and charts: a grid of text keyed "row:col". For a chart, row 0 holds the series names and column 0 the category labels. */
  cells?: Record<string, string>; nr?: number; nc?: number; header?: boolean; chart?: ChartKind; legend?: boolean
}
export interface Slide { id: string; notes: string; bg: string | null; els: El[] }

export type LayoutId = 'table' | 'chart' | 'title' | 'titleContent' | 'twoColumn' | 'section' | 'cards' | 'stats' | 'stat' | 'quote' | 'steps' | 'split' | 'closing' | 'titleOnly' | 'blank'
export const LAYOUTS: { id: LayoutId; name: string; hint: string }[] = [
  { id: 'title', name: 'Title', hint: 'Opening slide with a bold headline' },
  { id: 'titleContent', name: 'Title and bullets', hint: 'A heading and a short list' },
  { id: 'twoColumn', name: 'Two columns', hint: 'Compare two things side by side' },
  { id: 'cards', name: 'Three cards', hint: 'Three ideas, each in a card' },
  { id: 'table', name: 'Table', hint: 'A heading and a table' },
  { id: 'chart', name: 'Chart', hint: 'A heading and a chart you fill in' },
  { id: 'stats', name: 'Key numbers', hint: 'Three big figures with labels' },
  { id: 'stat', name: 'One big number', hint: 'A single figure that matters' },
  { id: 'quote', name: 'Quote', hint: 'A statement or testimonial' },
  { id: 'steps', name: 'Steps', hint: 'A process or timeline' },
  { id: 'split', name: 'Split', hint: 'Colored panel with the title, text on the right' },
  { id: 'section', name: 'Section header', hint: 'Full-color divider between parts' },
  { id: 'closing', name: 'Closing', hint: 'Thank you or call to action' },
  { id: 'titleOnly', name: 'Title only', hint: 'A heading and open space' },
  { id: 'blank', name: 'Blank', hint: 'Empty slide' },
]
type Draft = Omit<El, 'id' | 'z'>
export interface SlideContent {
  title?: string; subtitle?: string; bullets?: string; body?: string
  columns?: { heading?: string; text?: string }[]
  stats?: { value?: string; label?: string }[]
  quote?: string; author?: string
  steps?: { title?: string; text?: string }[]
  table?: string[][]
  chart?: { kind?: ChartKind; categories?: string[]; series?: { name?: string; values?: (number | string)[] }[]; title?: string }
}
const M = 80
const text = (o: Partial<Draft>): Draft => ({ type: 'text', x: M, y: 200, w: 1120, h: 100, text: '', size: 28, align: 'left', valign: 'top', ...o })
const shape = (shape: ShapeKind, o: Partial<Draft>): Draft => ({ type: 'shape', shape, x: 0, y: 0, w: 100, h: 100, fill: 'accent', strokeW: 0, ...o })
const title = (o: Partial<Draft> = {}): Draft => text({ role: 'title', y: 56, h: 100, size: 54, bold: true, valign: 'middle', ...o })
const rule = (x = M, y = 168, w = 84): Draft => shape('rect', { x, y, w, h: 8 })
export const cellKey = (r: number, c: number) => `${r}:${c}`
/** A table element from rows of text. */
export function tableDraft(rows: string[][], x: number, y: number, w: number, h: number): Draft {
  const nc = Math.max(...rows.map((r) => r.length), 1), cells: Record<string, string> = {}
  rows.forEach((r, i) => r.forEach((v, j) => { if (v !== '' && v != null) cells[cellKey(i, j)] = String(v) }))
  return { type: 'table', x, y, w, h, nr: rows.length, nc, cells, header: true, size: 24 }
}
/** Chart data in the shared grid form: series names across row 0, category labels down column 0. */
export function chartCells(cats?: string[], series?: { name?: string; values?: (number | string)[] }[]): Record<string, string> {
  const cs = cats?.length ? cats : ['Q1', 'Q2', 'Q3', 'Q4'], sr = series?.length ? series : [{ name: 'Series 1', values: [12, 19, 14, 24] }, { name: 'Series 2', values: [8, 11, 17, 15] }]
  const cells: Record<string, string> = {}
  sr.forEach((s, j) => { cells[cellKey(0, j + 1)] = s.name ?? `Series ${j + 1}` })
  cs.forEach((cat, i) => { cells[cellKey(i + 1, 0)] = String(cat); sr.forEach((s, j) => { const v = s.values?.[i]; if (v !== undefined && v !== '') cells[cellKey(i + 1, j + 1)] = String(v) }) })
  return cells
}
const lines = (s?: string) => (s ?? '').split('\n').map((l) => l.trim()).filter(Boolean)

/** Starting elements for a layout (positions are on the 1280 x 720 stage). Colors are theme tokens, so every theme looks right. */
export function layoutElements(id: LayoutId, c: SlideContent = {}): Draft[] {
  const t = c.title ?? '', bullets = c.bullets ?? c.body ?? ''
  switch (id) {
    case 'title': return [
      shape('ellipse', { x: 840, y: -150, w: 620, h: 620, opacity: 0.14 }), shape('ellipse', { x: 1000, y: 430, w: 400, h: 400, opacity: 0.08 }),
      rule(M, 232, 96), title({ x: M, y: 262, w: 940, h: 130, size: 80, valign: 'top', text: t }),
      text({ role: 'sub', x: M, y: 410, w: 820, h: 110, size: 34, color: 'muted', text: c.subtitle ?? bullets }),
    ]
    case 'section': return [
      shape('rect', { x: 0, y: 0, w: 1280, h: 720 }), shape('ellipse', { x: 880, y: 300, w: 640, h: 640, fill: 'accentInk', opacity: 0.1 }),
      text({ role: 'label', x: M + 20, y: 236, w: 900, h: 50, size: 26, bold: true, color: 'accentInk', opacity: 0.75, text: c.subtitle ?? '' }),
      title({ x: M + 20, y: 290, w: 960, h: 200, size: 84, color: 'accentInk', valign: 'top', text: t }),
    ]
    case 'titleContent': return [title({ text: t }), rule(), text({ role: 'body', y: 208, h: 440, size: 32, bullets: true, text: bullets })]
    case 'twoColumn': {
      const cols = c.columns?.length ? c.columns : [{ heading: '', text: lines(bullets).slice(0, Math.ceil(lines(bullets).length / 2)).join('\n') }, { heading: '', text: lines(bullets).slice(Math.ceil(lines(bullets).length / 2)).join('\n') }]
      return [title({ text: t }), rule(), ...[0, 1].flatMap((i) => {
        const x = M + i * 580, col = cols[i] ?? {}
        return [shape('rect', { x, y: 208, w: 8, h: 40, fill: 'accent' }), text({ role: 'heading', x: x + 26, y: 204, w: 500, h: 48, size: 32, bold: true, color: 'accent', valign: 'middle', text: col.heading ?? '' }),
          text({ role: 'body', x, y: 280, w: 540, h: 360, size: 32, bullets: true, text: col.text ?? '' })]
      })]
    }
    case 'cards': {
      const cols = c.columns?.length ? c.columns : [{}, {}, {}]
      return [title({ text: t }), rule(), ...[0, 1, 2].flatMap((i) => {
        const x = M + i * 390, col = cols[i] ?? {}
        return [shape('round', { x, y: 228, w: 360, h: 340, fill: 'card' }), shape('ellipse', { x: x + 30, y: 258, w: 60, h: 60, text: String(i + 1), size: 28, bold: true, color: 'accentInk', align: 'center' }),
          text({ role: 'heading', x: x + 30, y: 338, w: 300, h: 60, size: 32, bold: true, valign: 'middle', text: col.heading ?? '' }),
          text({ role: 'body', x: x + 30, y: 410, w: 300, h: 140, size: 26, color: 'muted', text: col.text ?? '' })]
      })]
    }
    case 'stats': {
      const st = c.stats?.length ? c.stats : [{}, {}, {}]
      const n = Math.min(4, Math.max(2, st.length)), w = (1120 - (n - 1) * 40) / n
      return [title({ text: t }), rule(), ...Array.from({ length: n }, (_v, i) => {
        const x = M + i * (w + 40), s = st[i] ?? {}
        return [shape('rect', { x, y: 300, w: 56, h: 6 }), text({ role: 'stat', x, y: 326, w, h: 150, size: n > 3 ? 84 : 100, bold: true, color: 'accent', valign: 'middle', text: s.value ?? '' }), text({ role: 'label', x, y: 484, w, h: 120, size: 30, color: 'muted', text: s.label ?? '' })]
      }).flat()]
    }
    case 'stat': {
      const s = c.stats?.[0] ?? {}
      return [shape('ellipse', { x: 900, y: 380, w: 520, h: 520, opacity: 0.1 }), title({ y: 60, h: 90, size: 40, text: t }),
        text({ role: 'stat', x: M, y: 150, w: 1120, h: 330, size: 240, bold: true, color: 'accent', valign: 'middle', text: s.value ?? '' }),
        text({ role: 'label', x: M, y: 490, w: 1000, h: 70, size: 44, bold: true, text: s.label ?? '' }), text({ role: 'sub', x: M, y: 566, w: 900, h: 90, size: 28, color: 'muted', text: c.subtitle ?? bullets })]
    }
    case 'quote': return [
      shape('rect', { x: 100, y: 190, w: 10, h: 340 }), text({ role: 'label', x: 140, y: 80, w: 200, h: 200, size: 220, bold: true, color: 'accent', text: '\u201C', valign: 'top' }),
      text({ role: 'quote', x: 140, y: 190, w: 1020, h: 340, size: 52, italic: true, valign: 'middle', text: c.quote ?? t }), text({ role: 'sub', x: 140, y: 560, w: 900, h: 60, size: 28, color: 'muted', text: c.author ? `\u2014 ${c.author}` : '' }),
    ]
    case 'steps': {
      const st = (c.steps?.length ? c.steps : [{}, {}, {}]).slice(0, 5), n = st.length, w = 1120 / n
      return [title({ text: t }), shape('rect', { x: M + 36, y: 276, w: 1120 - 72, h: 4, fill: 'card' }), ...st.flatMap((s, i) => {
        const x = M + i * w
        return [shape('ellipse', { x, y: 244, w: 72, h: 72, text: String(i + 1), size: 32, bold: true, color: 'accentInk', align: 'center' }),
          text({ role: 'heading', x, y: 346, w: w - 28, h: 56, size: n > 4 ? 26 : 32, bold: true, valign: 'middle', text: s.title ?? '' }), text({ role: 'body', x, y: 414, w: w - 28, h: 200, size: n > 4 ? 20 : 24, color: 'muted', text: s.text ?? '' })]
      })]
    }
    case 'split': return [
      shape('rect', { x: 0, y: 0, w: 500, h: 720 }), shape('ellipse', { x: -140, y: 520, w: 420, h: 420, fill: 'accentInk', opacity: 0.1 }),
      title({ x: 60, y: 150, w: 390, h: 340, size: 56, color: 'accentInk', valign: 'middle', text: t }),
      text({ role: 'body', x: 570, y: 150, w: 630, h: 440, size: 32, bullets: true, valign: 'middle', text: bullets }),
    ]
    case 'closing': return [
      shape('ellipse', { x: -200, y: -200, w: 640, h: 640, opacity: 0.12 }), shape('ellipse', { x: 900, y: 360, w: 560, h: 560, opacity: 0.1 }),
      title({ x: 140, y: 230, w: 1000, h: 170, size: 92, align: 'center', text: t }), shape('rect', { x: 596, y: 420, w: 88, h: 8 }),
      text({ role: 'sub', x: 240, y: 460, w: 800, h: 110, size: 32, align: 'center', color: 'muted', text: c.subtitle ?? bullets }),
    ]
    case 'table': {
      const rows = c.table?.length ? c.table : [['Item', 'Detail', 'Value'], ['', '', ''], ['', '', ''], ['', '', '']]
      const nr = rows.length
      return [title({ text: t }), rule(), tableDraft(rows, M, 208, 1120, Math.min(440, nr * 70))]
    }
    case 'chart': {
      const ch = c.chart ?? {}
      return [title({ text: t }), rule(), { type: 'chart', chart: ch.kind ?? 'column', x: M, y: 200, w: 1120, h: 460, text: ch.title ?? '', cells: chartCells(ch.categories, ch.series), nr: (ch.categories?.length ?? 4) + 1, nc: (ch.series?.length ?? 2) + 1, legend: true }]
    }
    case 'titleOnly': return [title({ text: t }), rule()]
    default: return []
  }
}
export const PLACEHOLDER: Record<string, string> = { title: 'Click to add title', body: 'Click to add text', sub: 'Click to add subtitle', stat: '00%', label: 'Label', heading: 'Heading', quote: 'Click to add a quote' }

/** Resolve "auto" colors against the theme. */
const mix = (a: string, b: string, t: number) => {
  const p = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16)
  return '#' + [0, 1, 2].map((i) => Math.round(p(a, i) * (1 - t) + p(b, i) * t).toString(16).padStart(2, '0')).join('')
}
export function resolveColor(c: string | undefined, theme: Theme, fallback: 'fg' | 'accent' | 'muted' = 'fg'): string {
  if (!c || c === 'auto') return theme[fallback]
  if (c === 'card') return mix(theme.bg, theme.fg, 0.07)
  if (c === 'muted' || c === 'fg' || c === 'accent') return theme[c]
  if (c === 'bg') return theme.bg
  if (c === 'accentInk') return theme.accentInk
  return c
}
export const FONT_CHOICES = ['Inter', 'Poppins', 'Lexend', 'Playfair Display', 'Source Sans 3', 'Merriweather', 'Roboto Slab', 'Montserrat', 'DM Serif Display', 'Space Grotesk', 'Caveat', 'JetBrains Mono']

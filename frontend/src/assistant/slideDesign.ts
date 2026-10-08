import { api } from '../api'
import { FONTS, fontStack, loadFont } from '../fonts'
import type { SlidesModel } from '../slides/model'
import { H, W, resolveColor, type El, type ShapeKind, type Slide, type Theme } from '../slides/themes'
import { type Tool, clip, tool } from './adapter'
import { cleanSvg, svgDataUrl } from './svgSafe'

/** Tools that let Koko compose a slide from nothing: its own palette and fonts, shapes, pictures, layering, and a design check. */
export interface DesignDeps {
  model: SlidesModel
  docId: string
  slideAt: (n: unknown) => Slide
  elAt: (s: Slide, n: unknown) => El
  setCur: (id: string) => void
}

const HEX = /^#[0-9a-f]{6}$/i
const hexOf = (c: unknown, what: string) => { const s = String(c ?? '').trim(); const h = /^#?([0-9a-f]{3})$/i.exec(s); const six = HEX.test(s) ? s : h ? '#' + h[1].split('').map((x) => x + x).join('') : null; if (!six) throw new Error(`${what} must be a hex colour like #1a2b3c.`); return six.toLowerCase() }
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const lum = (h: string) => { const [r, g, b] = rgb(h).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
export const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const mixHex = (a: string, b: string, t: number) => '#' + [0, 1, 2].map((i) => Math.round(rgb(a)[i] * (1 - t) + rgb(b)[i] * t).toString(16).padStart(2, '0')).join('')
const ink = (bg: string) => (contrast(bg, '#ffffff') >= contrast(bg, '#111111') ? '#ffffff' : '#111111')
const fontOf = (name: string) => { const f = FONTS.find((x) => x.family.toLowerCase() === name.trim().toLowerCase()); if (!f) throw new Error(`"${name}" isn't a font I can use. Use a Google Font's exact family name.`); loadFont(f.family); return f.family }

let ctx: CanvasRenderingContext2D | null = null
/** How many lines a text element wraps to, and how tall that is, measured the way the slide draws it. */
function measureText(e: El, t: Theme): { lines: number; height: number; widest: number } {
  ctx ??= document.createElement('canvas').getContext('2d')
  const size = e.size ?? 28, family = e.font && e.font !== 'auto' ? e.font : e.role === 'title' ? t.head : t.body
  if (!ctx) return { lines: 1, height: size * 1.25, widest: 0 }
  ctx.font = `${e.italic ? 'italic ' : ''}${e.bold ? 700 : 400} ${size}px ${fontStack(family)}`
  const avail = Math.max(10, e.w - (e.bullets ? size * 0.5 + size * 0.35 : 0))
  let lines = 0, widest = 0
  for (const para of (e.text ?? '').split('\n')) {
    let line = '', n = 1
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const next = line ? line + ' ' + w : w
      if (ctx.measureText(next).width > avail && line) { widest = Math.max(widest, ctx.measureText(line).width); line = w; n++ } else line = next
    }
    widest = Math.max(widest, ctx.measureText(line).width)
    lines += n
  }
  return { lines, height: lines * size * 1.25 + (e.bullets ? (e.text ?? '').split('\n').length * size * 0.3 : 0), widest }
}

const area = (a: El, b: El) => { const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y); return w > 0 && h > 0 ? w * h : 0 }
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length

/** Problems a person would see on this slide: text that spills out of its box or the slide, overlaps, tiny or low-contrast text, crowding. */
export function reviewSlide(s: Slide, n: number, t: Theme): string[] {
  const out: string[] = []
  const slideBg = /#[0-9a-fA-F]{6}/.exec(s.bg ?? '')?.[0] ?? t.bg
  const name = (e: El, i: number) => `[${i + 1}] ${e.type === 'text' ? `“${clip(e.text ?? '', 28)}”` : e.type}`
  let total = 0
  s.els.forEach((e, i) => {
    const bleeds = e.type === 'shape' || e.type === 'image'   // decoration and pictures may run off the edge on purpose
    if (!bleeds && (e.x < -2 || e.y < -2 || e.x + e.w > W + 2 || e.y + e.h > H + 2)) out.push(`${name(e, i)} runs off the slide.`)
    if (e.type === 'text') {
      if (!(e.text ?? '').trim()) { out.push(`${name(e, i)} is empty.`); return }
      total += words(e.text ?? '')
      const m = measureText(e, t)
      if (m.height > e.h + 6) out.push(`${name(e, i)} needs about ${Math.round(m.height)}px of height but its box is ${Math.round(e.h)}px: the text will spill out. Make the box taller, the text shorter or the type smaller.`)
      if (m.widest > e.w + 2) out.push(`${name(e, i)} has a word wider than its box.`)
      if (e.x < 24 || e.y < 24 || e.x + e.w > W - 24 || e.y + Math.min(m.height, e.h) > H - 24) out.push(`${name(e, i)} is within 24px of the slide edge. Keep a margin of at least 48px.`)
      if ((e.size ?? 28) < 16) out.push(`${name(e, i)} is ${e.size}px, too small to read on a projector (use 16px or more).`)
      // contrast against whatever is behind the middle of the text: the top-most filled shape under it, else the slide background
      const cx = e.x + e.w / 2, cy = e.y + Math.min(e.h, m.height) / 2
      let bg = slideBg
      for (const u of s.els.slice(0, i)) if (u.type === 'shape' && u.fill !== 'none' && u.shape !== 'line' && u.shape !== 'arrow' && cx >= u.x && cx <= u.x + u.w && cy >= u.y && cy <= u.y + u.h) { const f = resolveColor(u.fill, t, 'accent'); if (HEX.test(f)) bg = u.opacity !== undefined && u.opacity < 1 ? mixHex(bg, f, u.opacity) : f }
      if (s.els.slice(0, i).some((u) => u.type === 'image' && cx >= u.x && cx <= u.x + u.w && cy >= u.y && cy <= u.y + u.h)) { out.push(`${name(e, i)} sits on a picture: make sure it stays readable (a solid or dark translucent shape behind it helps).`) } else {
        const fg = resolveColor(e.color, t, e.role === 'sub' ? 'muted' : 'fg')
        if (HEX.test(fg) && HEX.test(bg)) { const c = contrast(fg, bg), big = (e.size ?? 28) >= 40 || ((e.size ?? 28) >= 28 && e.bold); if (c < (big ? 3 : 4.5)) out.push(`${name(e, i)} has low contrast (${c.toFixed(1)}:1 ${fg} on ${bg}). Use ${ink(bg)} or change the background.`) }
      }
    }
    if (e.type === 'shape' && e.text) {
      const m = measureText({ ...e, w: e.w - 32, bullets: false } as El, t)
      if (m.height > e.h - 12) out.push(`${name(e, i)} (shape text) does not fit inside its shape.`)
    }
  })
  const texts = s.els.map((e, i) => ({ e, i })).filter((x) => x.e.type === 'text' && (x.e.text ?? '').trim())
  for (let a = 0; a < texts.length; a++) for (let b = a + 1; b < texts.length; b++) {
    const A = texts[a], B = texts[b]
    const ma = measureText(A.e, t), mb = measureText(B.e, t)
    const ra = { ...A.e, h: Math.min(A.e.h, ma.height) }, rb = { ...B.e, h: Math.min(B.e.h, mb.height) }
    const ov = area(ra, rb)
    if (ov > 0.1 * Math.min(ra.w * ra.h, rb.w * rb.h)) out.push(`${name(A.e, A.i)} and ${name(B.e, B.i)} overlap.`)
  }
  s.els.forEach((e, i) => { if (e.type === 'text' || e.type === 'table' || e.type === 'chart') s.els.forEach((u, j) => { if (j > i && (u.type === 'table' || u.type === 'chart' || u.type === 'image') && j !== i && area(e, u) > 0.15 * Math.min(e.w * e.h, u.w * u.h) && !(u.type === 'image' && e.type === 'text')) out.push(`${name(e, i)} and ${name(u, j)} overlap.`) }) })
  if (total > 70) out.push(`There are ${total} words on this slide: too dense. Cut it down, or split it over two slides, and move detail into the speaker notes.`)
  if (!s.els.length) out.push('The slide is empty.')
  return [...new Set(out)].map((l) => `Slide ${n}: ${l}`)
}

export function designTools(d: DesignDeps): Tool[] {
  const m = d.model
  const shapeKinds: ShapeKind[] = ['rect', 'round', 'ellipse', 'triangle', 'line', 'arrow']
  const colorHelp = 'a hex like #1a2b3c, or a theme token (bg, fg, muted, accent, accentInk, card)'

  const setDesign: Tool = tool('set_design', 'Set the look of the whole deck: its colours and fonts. Use this first when the person describes a design, so every slide you build then shares one palette. Colours are hex like #0b1f33. Heading and body fonts can be any Google Font by exact family name. Theme tokens (bg, fg, muted, accent, accentInk, card) used in elements follow this palette.', {
    background: { type: 'string', description: 'Slide background' }, text: { type: 'string', description: 'Main text colour' }, muted: { type: 'string', description: 'Quieter text colour (optional, derived if left out)' },
    accent: { type: 'string', description: 'The highlight colour for shapes, bullets, table headers and charts' }, accent_text: { type: 'string', description: 'Text colour on top of the accent (optional, chosen for contrast if left out)' },
    heading_font: { type: 'string' }, body_font: { type: 'string' },
  }, [], {
    edit: true,
    describe: (a) => ({ title: 'Set the design of the deck', detail: [a.background && `background ${a.background}`, a.text && `text ${a.text}`, a.accent && `accent ${a.accent}`, a.heading_font && `headings in ${a.heading_font}`, a.body_font && `body in ${a.body_font}`].filter(Boolean).join(', ') }),
    run: (a) => {
      const cur = m.deckTheme(), p: Record<string, string> = { ...(m.palette ?? {}) }
      if (a.background) p.bg = hexOf(a.background, 'background')
      if (a.text) p.fg = hexOf(a.text, 'text')
      if (a.accent) p.accent = hexOf(a.accent, 'accent')
      if (a.muted) p.muted = hexOf(a.muted, 'muted')
      else if (a.background || a.text) p.muted = mixHex(p.bg ?? cur.bg, p.fg ?? cur.fg, 0.55)
      if (a.accent_text) p.accentInk = hexOf(a.accent_text, 'accent_text')
      else if (a.accent) p.accentInk = ink(p.accent)
      if (Object.keys(p).length) m.setPalette(p)
      if (a.heading_font) m.setDeckFont('head', fontOf(String(a.heading_font)))
      if (a.body_font) m.setDeckFont('body', fontOf(String(a.body_font)))
      const t = m.deckTheme()
      const warn = contrast(t.fg, t.bg) < 4.5 ? ` Warning: text on the background has only ${contrast(t.fg, t.bg).toFixed(1)}:1 contrast.` : ''
      return `Design set: background ${t.bg}, text ${t.fg}, muted ${t.muted}, accent ${t.accent} (text on accent ${t.accentInk}), headings ${t.head}, body ${t.body}.${warn}`
    },
  })

  const common = { slide: { type: 'number' }, x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } }
  const addShape: Tool = tool('add_shape', `Draw a shape on a slide: ${shapeKinds.join(', ')}. Use shapes for panels, cards, accent bars, dividers, badges and framing; a line or arrow takes its colour from "stroke". Position on the 1280x720 canvas. Shapes are drawn in the order you add them, so add backgrounds first. Optional "text" is centred inside the shape.`, {
    ...common, shape: { type: 'string', enum: shapeKinds }, fill: { type: 'string', description: `Fill: ${colorHelp}, or "none"` }, stroke: { type: 'string', description: 'Outline colour (or the line colour)' }, stroke_width: { type: 'number' },
    opacity: { type: 'number', description: '0 to 1' }, text: { type: 'string' }, text_color: { type: 'string' }, size: { type: 'number', description: 'Text size inside the shape' }, bold: { type: 'boolean' }, font: { type: 'string' },
  }, ['slide', 'shape', 'x', 'y', 'width', 'height'], {
    edit: true, describe: (a) => ({ title: `Draw a ${a.shape} on slide ${a.slide}`, detail: [a.fill && `fill ${a.fill}`, a.text && `“${clip(String(a.text), 40)}”`, `${Math.round(Number(a.width))}×${Math.round(Number(a.height))} at ${Math.round(Number(a.x))},${Math.round(Number(a.y))}`].filter(Boolean).join(', ') }),
    run: (a) => {
      if (!shapeKinds.includes(a.shape)) throw new Error(`Shape must be one of: ${shapeKinds.join(', ')}.`)
      const s = d.slideAt(a.slide), line = a.shape === 'line' || a.shape === 'arrow'
      const el: Omit<El, 'id' | 'z'> = { type: 'shape', shape: a.shape, x: Number(a.x), y: Number(a.y), w: Math.max(1, Number(a.width)), h: Math.max(1, Number(a.height)), fill: line ? 'none' : a.fill === undefined ? 'accent' : String(a.fill), strokeW: Number(a.stroke_width ?? (line ? 6 : 0)) }
      if (a.stroke !== undefined) el.stroke = String(a.stroke); else if (line) el.stroke = 'accent'
      if (a.opacity !== undefined) el.opacity = Math.max(0, Math.min(1, Number(a.opacity)))
      if (a.text) { el.text = String(a.text); el.size = Number(a.size ?? 24); el.bold = !!a.bold; el.color = a.text_color ? String(a.text_color) : 'accentInk'; if (a.font) el.font = fontOf(String(a.font)) }
      m.addEl(s.id, el)
      return `Added shape ${m.read().find((x) => x.id === s.id)!.els.length} on slide ${a.slide}.`
    },
  })

  const addImage: Tool = tool('add_image', 'Put a picture on a slide from a public web address (the server fetches and keeps its own copy). Only use addresses you were given or are certain exist; if it cannot be fetched you get an error. "cover" fills the box and crops the edges, "contain" fits the whole picture inside.', {
    ...common, url: { type: 'string' }, fit: { type: 'string', enum: ['cover', 'contain'] }, alt: { type: 'string', description: 'A short description of the picture' },
  }, ['slide', 'url', 'x', 'y', 'width', 'height'], {
    edit: true, describe: (a) => ({ title: `Add a picture to slide ${a.slide}`, detail: clip(String(a.url ?? ''), 90) }),
    run: async (a) => {
      const s = d.slideAt(a.slide)
      let src: string
      try { src = await api.importImage(d.docId, String(a.url)) } catch (e) { throw new Error(`Couldn't fetch that picture: ${(e as Error).message}`) }
      m.addEl(s.id, { type: 'image', src, alt: a.alt ? String(a.alt) : undefined, fit: a.fit === 'contain' ? 'contain' : 'cover', x: Number(a.x), y: Number(a.y), w: Number(a.width), h: Number(a.height) })
      return 'Added the picture.'
    },
  })


  const searchIcons: Tool = tool('search_icons', 'Find icons in the Lucide set (about 1,700) by keyword, for add_icon. Search with a concept or object, like "rocket", "shield", "chart", "users", "clock". Returns icon names.', { query: { type: 'string' } }, ['query'], {
    label: (a) => `Looking for icons: ${clip(String(a?.query ?? ''), 40)}`,
    run: async (a) => {
      const { searchIcons: find } = await import('./lucideSvg')
      const r = find(String(a.query ?? ''))
      return r.length ? r.join(', ') : 'No icon matched. Try a simpler or more general word, or draw it yourself with add_icon and svg.'
    },
  })

  const addIcon: Tool = tool('add_icon', 'Put an icon on a slide, as a crisp vector that stays sharp at any size. Two ways: (1) "icon" = the name of a Lucide icon (use search_icons to find one; these are clean outline icons, 24x24, drawn with a stroke); or (2) "svg" = markup you write yourself when no Lucide icon fits, such as a logo mark, a simple illustration, a diagram piece or a decorative shape. For your own SVG: one <svg viewBox="0 0 W H"> using only path, circle, ellipse, rect, line, polyline, polygon, g and gradients; keep it simple and under about 20 shapes; use fill and stroke directly, or "currentColor" to take the "color" you pass. No text, images, scripts or styles. Icons look best at 48 to 96px on their own, or inside a circle or rounded square you drew with add_shape first (add the shape, then the icon on top). Size is in canvas pixels (1280x720).', {
    slide: { type: 'number' }, x: { type: 'number' }, y: { type: 'number' }, size: { type: 'number', description: 'Width and height in pixels (default 64). For a custom svg that is not square, give width and height instead.' }, width: { type: 'number' }, height: { type: 'number' },
    icon: { type: 'string', description: 'Lucide icon name like "rocket" or "chart-bar"' }, svg: { type: 'string', description: 'Your own SVG markup (instead of icon)' },
    color: { type: 'string', description: `Icon colour: ${colorHelp}. Default accent.` }, stroke_width: { type: 'number', description: 'Lucide line thickness, 1 to 3 (default 2)' }, alt: { type: 'string', description: 'A short description' },
  }, ['slide', 'x', 'y'], {
    edit: true, describe: (a) => ({ title: a.svg ? `Add a drawn icon to slide ${a.slide}` : `Add the “${String(a.icon ?? '')}” icon to slide ${a.slide}`, detail: [a.color && String(a.color), `${Math.round(Number(a.width ?? a.size ?? 64))}px at ${Math.round(Number(a.x))},${Math.round(Number(a.y))}`].filter(Boolean).join(', '), after: a.svg ? clip(String(a.svg), 160) : undefined }),
    run: async (a) => {
      if (!a.icon && !a.svg) throw new Error('Give an icon name (see search_icons) or your own svg markup.')
      const s = d.slideAt(a.slide), t = m.deckTheme(), color = resolveColor(a.color === undefined ? 'accent' : String(a.color), t, 'accent')
      let svg: string
      if (a.svg) svg = cleanSvg(String(a.svg).replace(/currentColor/gi, color))
      else {
        const { lucideSvg, searchIcons: find } = await import('./lucideSvg')
        const out = lucideSvg(String(a.icon), color, Math.max(0.5, Math.min(4, Number(a.stroke_width ?? 2))))
        if (!out) { const near = find(String(a.icon).replace(/[-_]/g, ' ')).slice(0, 8); throw new Error(`There is no Lucide icon called “${a.icon}”.${near.length ? ` Similar: ${near.join(', ')}.` : ' Use search_icons to find one.'}`) }
        svg = out
      }
      const w = Number(a.width ?? a.size ?? 64), h = Number(a.height ?? a.size ?? a.width ?? 64)
      m.addEl(s.id, { type: 'image', src: svgDataUrl(svg), alt: a.alt ? String(a.alt) : String(a.icon ?? 'Icon'), fit: 'contain', x: Number(a.x), y: Number(a.y), w, h })
      return `Added the ${a.icon ? `“${a.icon}” ` : ''}icon.`
    },
  })

  const arrange: Tool = tool('arrange_element', 'Change the stacking order of an element on a slide (what is in front of what).', { slide: { type: 'number' }, element: { type: 'number' }, order: { type: 'string', enum: ['front', 'back', 'forward', 'backward'] } }, ['slide', 'element', 'order'], {
    edit: true, describe: (a) => ({ title: `Send element ${a.element} on slide ${a.slide} to the ${a.order}` }),
    run: (a) => { const s = d.slideAt(a.slide), e = d.elAt(s, a.element); m.reorder(s.id, [e.id], a.order); return 'Done. Element numbers on this slide may have changed: read the slide again before editing more.' },
  })
  const dupSlide: Tool = tool('duplicate_slide', 'Duplicate a slide (the copy goes right after it), to reuse a composition you designed.', { slide: { type: 'number' } }, ['slide'], {
    edit: true, describe: (a) => ({ title: `Duplicate slide ${a.slide}` }),
    run: (a) => { const s = d.slideAt(a.slide), id = m.duplicateSlide(s.id); if (!id) throw new Error('Could not duplicate it.'); d.setCur(id); return `Duplicated as slide ${m.ids().indexOf(id) + 1}.` },
  })

  const review: Tool = tool('review_design', 'Check the design for problems a person would see: text that overflows its box or the slide, overlapping elements, text too small, low contrast, crowding, and too many words. Run it after building a slide (or the deck) and fix what it reports. Leave out "slide" to check every slide.', { slide: { type: 'number' } }, [], {
    label: (a) => (a?.slide ? `Checking the design of slide ${a.slide}` : 'Checking the design'),
    run: async (a) => {
      await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 1500))])   // a font that never loads must not stall the review
      const t = m.deckTheme(), all = m.read()
      const list = a.slide ? [[d.slideAt(a.slide), Number(a.slide)] as const] : all.map((s, i) => [s, i + 1] as const)
      const issues = list.flatMap(([s, n]) => reviewSlide(s, n, t))
      const fonts = new Set(all.flatMap((s) => s.els.map((e) => (e.type === 'text' ? e.font ?? (e.role === 'title' ? t.head : t.body) : null))).filter(Boolean))
      if (!a.slide && fonts.size > 3) issues.push(`The deck uses ${fonts.size} different fonts. Stick to two.`)
      return issues.length ? `${issues.length} thing${issues.length === 1 ? '' : 's'} to fix:\n${issues.join('\n')}` : 'No problems found: nothing overflows or overlaps, text is readable and the contrast is fine.'
    },
  })
  return [setDesign, addShape, addImage, searchIcons, addIcon, arrange, dupSlide, review]
}

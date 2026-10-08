import { FileCode2, FileText, Presentation as PresentationIcon, Printer } from 'lucide-react'
import { fontCssUrl } from '../fonts'
import { Menu, type Item } from '../export/ExportMenu'
import { printHtml } from '../export/printPdf'
import { escapeHtml, safeName, saveBlob } from '../export/util'
import { toast } from '../ui/Toast'
import type { SlidesModel } from './model'
import { SlideStage, elFont } from './SlideView'
import { chartData, dims, toMatrix } from './matrix'
import { chartColors } from './SlideView'
import { resolveColor, type El, type Slide, type Theme } from './themes'

const hex = (c: string) => c.replace('#', '').slice(0, 6).toUpperCase()
/** A slide's background as one colour: a gradient (which PowerPoint export can't draw from this) becomes its first colour. */
const bgOf = (s: Slide, t: Theme) => /#[0-9a-fA-F]{6}/.exec(s.bg ?? '')?.[0] ?? t.bg

async function dataUrl(src: string): Promise<string | null> {
  try {
    const b = await (await fetch(new URL(src, location.href).href)).blob()
    return await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => res(null); r.readAsDataURL(b) })
  } catch { return null }
}

export async function buildPptx(slides: Slide[], t: Theme, title: string): Promise<Blob> {
  const { default: Pptx } = await import('pptxgenjs')
  const pptx = new Pptx()
  pptx.layout = 'LAYOUT_WIDE'   // 13.33 x 7.5 in, the same 16:9 as the 1280 x 720 stage
  pptx.title = title
  const px = (n: number) => n / 96
  for (const s of slides) {
    const sl = pptx.addSlide()
    sl.background = { color: hex(bgOf(s, t)) }
    for (const e of s.els) {
      const box = { x: px(e.x), y: px(e.y), w: px(e.w), h: px(e.h) }
      if (e.type === 'image' && e.src) {
        const data = await dataUrl(e.src)
        if (data) sl.addImage({ data, ...box, sizing: { type: e.fit === 'cover' ? 'cover' : 'contain', w: box.w, h: box.h } })
        continue
      }
      if (e.type === 'table') {
        const m = toMatrix(e), { nr, nc } = dims(e), head = e.header !== false
        const rows = m.map((row, r) => row.map((v) => ({ text: v, options: {
          bold: (head && r === 0) || !!e.bold, color: hex(head && r === 0 ? resolveColor('accentInk', t) : resolveColor(e.color, t, 'fg')),
          fill: { color: hex(head && r === 0 ? resolveColor('accent', t) : r % 2 === 0 ? bgOf(s, t) : resolveColor('card', t)) }, align: e.align ?? 'left', valign: 'middle' as const,
        } })))
        sl.addTable(rows as never, { x: box.x, y: box.y, w: box.w, colW: Array(nc).fill(box.w / nc), rowH: Array(nr).fill(box.h / nr), fontFace: elFont(e, t), fontSize: (e.size ?? 24) * 0.75, border: { type: 'solid', pt: 1, color: hex(resolveColor('muted', t)) }, margin: 8 })
        continue
      }
      if (e.type === 'chart') {
        const d = chartData(e), kind = e.chart ?? 'column', C = pptx.ChartType
        const type = kind === 'line' ? C.line : kind === 'area' ? C.area : kind === 'pie' ? C.pie : C.bar
        const series = kind === 'pie' ? d.series.slice(0, 1) : d.series
        sl.addChart(type, series.map((x) => ({ name: x.name, labels: d.cats, values: x.values })) as never, {
          ...box, barDir: kind === 'bar' ? 'bar' : 'col', showLegend: e.legend !== false && (series.length > 1 || kind === 'pie'), legendPos: 'b', legendColor: hex(t.muted), legendFontSize: 14,
          chartColors: kind === 'pie' ? chartColors(t).slice(0, d.cats.length).map(hex) : chartColors(t).slice(0, series.length).map(hex),
          catAxisLabelColor: hex(t.muted), valAxisLabelColor: hex(t.muted), catAxisLabelFontSize: 14, valAxisLabelFontSize: 14, valGridLine: { color: hex(t.muted), size: 0.5, style: 'dash' },
          showTitle: !!e.text, title: e.text, titleColor: hex(t.fg), titleFontSize: 20, dataLabelColor: hex(t.fg),
        } as never)
        continue
      }
      if (e.type === 'shape') {
        const fill = e.fill === 'none' ? undefined : { color: hex(resolveColor(e.fill, t, 'accent')) }
        const line = e.stroke && e.stroke !== 'none' ? { color: hex(resolveColor(e.stroke, t, 'fg')), width: (e.strokeW ?? 4) * 0.75 } : undefined
        const T = pptx.ShapeType
        if (e.shape === 'line' || e.shape === 'arrow') {
          sl.addShape(T.line, { x: box.x, y: box.y + box.h / 2, w: box.w, h: 0, line: { color: hex(resolveColor(e.stroke && e.stroke !== 'none' ? e.stroke : 'auto', t, 'fg')), width: (e.strokeW ?? 6) * 0.75, endArrowType: e.shape === 'arrow' ? 'triangle' : undefined } })
        } else {
          sl.addShape(e.shape === 'ellipse' ? T.ellipse : e.shape === 'triangle' ? T.triangle : e.shape === 'round' ? T.roundRect : T.rect, { ...box, fill: fill ?? { type: 'none' } as never, line: line ?? { type: 'none' } as never, rectRadius: 0.12 })
        }
        if (!e.text) continue
      }
      if (e.text !== undefined) addText(sl, e, t.id, box)
    }
    if (s.notes.trim()) sl.addNotes(s.notes)
  }
  const out = await pptx.write({ outputType: 'blob' })
  return out as Blob

  function addText(sl: ReturnType<typeof pptx.addSlide>, e: El, _theme: string, box: { x: number; y: number; w: number; h: number }) {
    const color = hex(resolveColor(e.color, t, e.role === 'sub' ? 'muted' : 'fg'))
    const size = (e.size ?? 28) * 0.75
    const lines = (e.text ?? '').split('\n')
    const runs = lines.map((l, i) => ({ text: l || ' ', options: { breakLine: i < lines.length - 1, bullet: e.bullets && l.trim() ? { indent: Math.round(size * 1.2) } : false, paraSpaceAfter: e.bullets ? size * 0.3 : 0 } }))
    sl.addText(runs as never, {
      ...box, margin: 0, fontFace: elFont(e, t), fontSize: size, bold: !!e.bold, italic: !!e.italic, underline: e.underline ? { style: 'sng' } : undefined,
      color, align: e.align ?? (e.type === 'shape' ? 'center' : 'left'), valign: e.valign ?? (e.type === 'shape' ? 'middle' : 'top'), fit: 'none', wrap: true,
    })
  }
}

export async function buildPdfHtml(slides: Slide[], t: Theme, title: string): Promise<string> {
  const { renderToStaticMarkup } = await import('react-dom/server')
  const fonts = new Set<string>([t.head, t.body]); slides.forEach((s) => s.els.forEach((e) => { if (e.font && e.font !== 'auto') fonts.add(e.font) }))
  const links = [...fonts].map(fontCssUrl).filter(Boolean).map((u) => `<link rel="stylesheet" href="${u}">`).join('')
  const pages = slides.map((s) => `<section class="pg">${renderToStaticMarkup(<SlideStage slide={s} theme={t} scale={1} />)}</section>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><base href="${location.origin}/"><title>${escapeHtml(title)}</title>${links}
<style>@page{size:1280px 720px;margin:0} html,body{margin:0;background:#fff} *{-webkit-print-color-adjust:exact;print-color-adjust:exact;box-sizing:border-box}
.pg{width:1280px;height:720px;position:relative;overflow:hidden;break-after:page;page-break-after:always} .pg:last-child{break-after:auto;page-break-after:auto}
.slide-stage{position:relative;overflow:hidden} .slide-surface{position:absolute;left:0;top:0;transform-origin:0 0;overflow:hidden} img.emoji{height:1.15em;width:1.15em;vertical-align:-.2em}</style></head><body>${pages}</body></html>`
}

export function toOutline(slides: Slide[], title: string): string {
  const out = [`# ${title}`, '']
  slides.forEach((s, i) => {
    const ttl = s.els.find((e) => e.role === 'title')?.text?.trim() || `Slide ${i + 1}`
    out.push(`## ${i + 1}. ${ttl}`, '')
    s.els.filter((e) => e.type === 'text' && e.role !== 'title' && e.text?.trim()).forEach((e) => { e.text!.split('\n').filter(Boolean).forEach((l) => out.push(e.bullets ? `- ${l}` : l)); out.push('') })
    s.els.filter((e) => e.type === 'table').forEach((e) => { const m = toMatrix(e); m.forEach((r, i) => { out.push(`| ${r.map((v) => v.replace(/\|/g, '/')).join(' | ')} |`); if (i === 0) out.push(`|${r.map(() => ' --- ').join('|')}|`) }); out.push('') })
    s.els.filter((e) => e.type === 'chart').forEach((e) => { const d = chartData(e); out.push(`Chart${e.text ? ` “${e.text}”` : ''} (${e.chart ?? 'column'}):`); d.cats.forEach((c, i) => out.push(`- ${c}: ${d.series.map((x) => `${x.name} ${x.values[i]}`).join(', ')}`)); out.push('') })
    if (s.notes.trim()) out.push(`> Notes: ${s.notes.trim().replace(/\n/g, '\n> ')}`, '')
  })
  return out.join('\n')
}

export function SlidesExportMenu({ model, slides, title }: { model: SlidesModel; slides: Slide[]; title: string }) {
  const name = safeName(title, 'Untitled presentation')
  const items: Item[] = [
    { id: 'pptx', icon: <PresentationIcon size={18} />, label: 'PowerPoint (.pptx)', hint: 'Editable in PowerPoint, Keynote, Google Slides', run: async () => { saveBlob(await buildPptx(slides, model.deckTheme(), name), `${name}.pptx`) } },
    { id: 'pdf', icon: <Printer size={18} />, label: 'PDF', hint: 'One slide per page. Choose “Save as PDF”', run: async () => { toast('In the print window, choose “Save as PDF” as the destination.'); await printHtml(await buildPdfHtml(slides, model.deckTheme(), name)) } },
    { id: 'md', icon: <FileCode2 size={18} />, label: 'Outline (.md)', hint: 'Slide titles, bullets and notes', run: async () => { saveBlob(new Blob([toOutline(slides, name)], { type: 'text/markdown;charset=utf-8' }), `${name}.md`) } },
    { id: 'txt', icon: <FileText size={18} />, label: 'Plain text (.txt)', hint: 'Just the words', run: async () => { saveBlob(new Blob([toOutline(slides, name).replace(/^#+\s*/gm, '').replace(/^- /gm, '  ')], { type: 'text/plain;charset=utf-8' }), `${name}.txt`) } },
  ]
  return <Menu items={items} label="Download as" />
}

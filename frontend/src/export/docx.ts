import {
  AlignmentType, BorderStyle, Document, ExternalHyperlink, Footer, Header, HeadingLevel, ImageRun, LevelFormat, PageNumber, Paragraph, ShadingType, Table, TableCell, TableRow,
  PageOrientation, TextRun, UnderlineType, WidthType, type ParagraphChild, type IParagraphOptions,
} from 'docx'
import { shapeToPng } from './shapePng'
import { DEFAULT_META, PAGE_SIZES, type PageMeta } from '../editor/Pagination'
import type { ImageData, PMNode } from './util'

const hex = (c?: string | null): string | undefined => {
  if (!c) return undefined
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})/i.exec(c.trim())
  if (m) return (m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1]).toUpperCase()
  const rgb = /rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(c)
  return rgb ? [rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase() : undefined
}

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6]
const ALIGN: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED }
const MAX_IMG = 600 // px (6.25 in), fits inside Letter with 1 in margins

export interface DocxOptions { title: string; meta: PageMeta; loadImage: (src: string) => Promise<ImageData | null> }

interface Ctx extends DocxOptions { numbering: { reference: string; levels: any[] }[]; counter: number }

const levels = (fmt: 'bullet' | 'decimal', start = 1) => Array.from({ length: 9 }, (_, i) => ({
  level: i, format: fmt === 'bullet' ? LevelFormat.BULLET : LevelFormat.DECIMAL, text: fmt === 'bullet' ? ['•', '◦', '▪'][i % 3] : `%${i + 1}.`, start,
  alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720 + i * 360, hanging: 360 } } },
}))

async function inline(nodes: PMNode[] = [], ctx: Ctx, base: { size?: number; bold?: boolean } = {}): Promise<ParagraphChild[]> {
  const out: ParagraphChild[] = []
  for (const n of nodes) {
    if (n.type === 'hardBreak') { out.push(new TextRun({ break: 1 })); continue }
    if (n.type === 'emoji') { out.push(new TextRun({ text: String(n.attrs?.char ?? '') })); continue }
    if (n.type === 'docShape') {
      const png = await shapeToPng(n.attrs ?? {})
      if (png) out.push(new ImageRun({ type: 'png', data: png.data, transformation: { width: Math.min(MAX_IMG, png.width), height: Math.round((png.height * Math.min(MAX_IMG, png.width)) / png.width) }, altText: { title: String(n.attrs?.text || 'shape'), description: String(n.attrs?.text || 'shape'), name: 'shape' } }))
      continue
    }
    if (n.type === 'image') {
      const img = n.attrs?.src ? await ctx.loadImage(n.attrs.src) : null
      if (img) {
        const w = Math.min(MAX_IMG, n.attrs?.width ? Number(n.attrs.width) : img.width), h = Math.round((w * img.height) / img.width)
        out.push(new ImageRun({ type: img.type, data: img.data, transformation: { width: Math.max(8, Math.round(w)), height: Math.max(8, h) }, altText: { title: n.attrs?.alt || 'image', description: n.attrs?.alt || 'image', name: 'image' } }))
      } else out.push(new TextRun({ text: `[image${n.attrs?.alt ? ': ' + n.attrs.alt : ''}]`, italics: true, color: '888888' }))
      continue
    }
    if (n.type !== 'text') { out.push(...(await inline(n.content, ctx, base))); continue }
    const marks = n.marks ?? []
    const m = (t: string) => marks.find((x) => x.type === t)
    const style = m('textStyle')?.attrs ?? {}
    const link = m('link')?.attrs?.href as string | undefined
    const hl = m('highlight')
    const opts: ConstructorParameters<typeof TextRun>[0] = {
      text: n.text ?? '',
      bold: !!m('bold') || base.bold || undefined, italics: !!m('italic') || undefined, strike: !!m('strike') || undefined,
      underline: m('underline') || link ? { type: UnderlineType.SINGLE } : undefined,
      subScript: !!m('subscript') || undefined, superScript: !!m('superscript') || undefined,
      color: link ? '2563EB' : hex(style.color), font: m('code') ? 'Courier New' : style.fontFamily || undefined,
      size: style.fontSize ? Math.round(Number(style.fontSize) * 2) : base.size,
      shading: hl ? { type: ShadingType.CLEAR, fill: hex(hl.attrs?.color) ?? 'FDE047', color: 'auto' } : m('code') ? { type: ShadingType.CLEAR, fill: 'F0F0F0', color: 'auto' } : undefined,
    }
    const run = new TextRun(opts)
    out.push(link ? new ExternalHyperlink({ link, children: [run] }) : run)
  }
  return out
}

type Block = Paragraph | Table
async function blocks(nodes: PMNode[] = [], ctx: Ctx, extra: Partial<IParagraphOptions> = {}, depth = 0): Promise<Block[]> {
  const out: Block[] = []
  for (const n of nodes) {
    switch (n.type) {
      case 'paragraph':
        out.push(new Paragraph({ ...extra, children: await inline(n.content, ctx), alignment: ALIGN[n.attrs?.textAlign ?? ''] ?? extra.alignment, spacing: { after: 140, line: 300, ...(extra.spacing ?? {}) } }))
        break
      case 'heading':
        out.push(new Paragraph({ ...extra, heading: HEADINGS[(n.attrs?.level ?? 1) - 1], children: await inline(n.content, ctx), alignment: ALIGN[n.attrs?.textAlign ?? ''] ?? extra.alignment, spacing: { before: 200, after: 120 } }))
        break
      case 'bulletList': case 'orderedList': case 'taskList': {
        let ref = 'bullets'
        if (n.type === 'orderedList') { ref = `ol-${ctx.counter++}`; ctx.numbering.push({ reference: ref, levels: levels('decimal', n.attrs?.start ?? 1) }) }
        for (const li of n.content ?? []) {
          const kids = li.content ?? []
          let first = true
          for (const c of kids) {
            if (c.type === 'paragraph' && first) {
              const prefix: ParagraphChild[] = n.type === 'taskList' ? [new TextRun({ text: li.attrs?.checked ? '☑  ' : '☐  ' })] : []
              out.push(new Paragraph({ ...extra, children: [...prefix, ...(await inline(c.content, ctx))], spacing: { after: 60, line: 288 },
                ...(n.type === 'taskList' ? { indent: { left: 360 + depth * 360 } } : { numbering: { reference: ref, level: Math.min(depth, 8) } }) }))
              first = false
            } else if (['bulletList', 'orderedList', 'taskList'].includes(c.type)) out.push(...(await blocks([c], ctx, extra, depth + 1)))
            else out.push(...(await blocks([c], ctx, { ...extra, indent: { left: 720 + depth * 360 } }, depth)))
          }
        }
        break
      }
      case 'callout': {
        const custom = n.attrs?.kind === 'custom', hx = (c?: string) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c.slice(1).toUpperCase() : undefined)
        const fill = custom ? hx(n.attrs?.bg) ?? 'FFF7D6' : 'F3F4F6', edge = custom ? hx(n.attrs?.accent) ?? '6B7280' : '6B7280'
        out.push(new Paragraph({ ...extra, children: [new TextRun({ text: String(n.attrs?.title || String(n.attrs?.kind ?? 'note').toUpperCase()), bold: true, color: edge })], spacing: { after: 40 } }))
        out.push(...(await blocks(n.content, ctx, { ...extra, indent: { left: 360 }, shading: { type: ShadingType.CLEAR, fill, color: 'auto' }, border: { left: { style: BorderStyle.SINGLE, size: 24, color: edge, space: 10 } } }, depth)))
        break
      }
      case 'blockquote':
        out.push(...(await blocks(n.content, ctx, { ...extra, indent: { left: 540 }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: 'A3A3A3', space: 10 } } }, depth)))
        break
      case 'codeBlock': {
        const lines = (n.content ?? []).map((t) => t.text ?? '').join('').split('\n')
        lines.forEach((l, i) => out.push(new Paragraph({ ...extra, shading: { type: ShadingType.CLEAR, fill: 'F0F0F0', color: 'auto' }, spacing: { after: i === lines.length - 1 ? 160 : 0 },
          children: [new TextRun({ text: l || ' ', font: 'Courier New', size: 20 })] })))
        break
      }
      case 'horizontalRule':
        out.push(new Paragraph({ ...extra, border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: 'BBBBBB', space: 1 } }, spacing: { after: 160 } }))
        break
      case 'table': {
        const rows: TableRow[] = []
        for (const tr of n.content ?? []) {
          const cells: TableCell[] = []
          for (const c of tr.content ?? []) {
            const head = c.type === 'tableHeader'
            const kids = (await blocks(c.content, ctx, {}, 0))
            const fill = hex(c.attrs?.backgroundColor) ?? (head ? 'EEEEF2' : undefined)
            const edge = { style: BorderStyle.SINGLE, size: 4, color: 'D4D4D8' }
            cells.push(new TableCell({
              children: kids.length ? kids : [new Paragraph({})], columnSpan: (c.attrs?.colspan ?? 1) > 1 ? c.attrs?.colspan : undefined, rowSpan: (c.attrs?.rowspan ?? 1) > 1 ? c.attrs?.rowspan : undefined,
              shading: fill ? { type: ShadingType.CLEAR, fill, color: 'auto' } : undefined, margins: { top: 80, bottom: 80, left: 120, right: 120 },
              borders: { top: edge, bottom: edge, left: edge, right: edge },
            }))
          }
          rows.push(new TableRow({ children: cells }))
        }
        out.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }), new Paragraph({ spacing: { after: 120 } }))
        break
      }
      default:
        if (n.content) out.push(...(await blocks(n.content, ctx, extra, depth)))
    }
  }
  return out
}

/** Header / footer text with {page} / {pages} turned into real Word page-number fields. */
function headerFooterRuns(text: string): ParagraphChild[] {
  return text.split(/(\{page\}|\{pages\})/).filter(Boolean).map((p) => (p === '{page}' ? new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '666666' }) : p === '{pages}' ? new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, color: '666666' }) : new TextRun({ text: p, size: 18, color: '666666' })))
}

export async function buildDocx(doc: PMNode, opts: DocxOptions): Promise<Document> {
  const ctx: Ctx = { ...opts, numbering: [{ reference: 'bullets', levels: levels('bullet') }], counter: 0 }
  const children = await blocks(doc.content, ctx)
  const meta: PageMeta = { ...DEFAULT_META, ...opts.meta }
  const PS = PAGE_SIZES[meta.size] ?? PAGE_SIZES.letter
  return new Document({
    creator: 'KokoDocs', title: opts.title,
    numbering: { config: ctx.numbering },
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [{
      properties: { page: { size: { width: Math.round(PS.w * 15), height: Math.round(PS.h * 15), orientation: meta.orientation === 'landscape' ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT }, margin: { top: Math.round(meta.mt * 15), bottom: Math.round(meta.mb * 15), left: Math.round(meta.ml * 15), right: Math.round(meta.mr * 15) } } },
      headers: meta.header.trim() ? { default: new Header({ children: [new Paragraph({ alignment: ALIGN[meta.headerAlign], children: headerFooterRuns(meta.header) })] }) } : undefined,
      footers: meta.footer.trim() ? { default: new Footer({ children: [new Paragraph({ alignment: ALIGN[meta.footerAlign], children: headerFooterRuns(meta.footer) })] }) } : undefined,
      children: children.length ? children : [new Paragraph({})],
    }],
  })
}

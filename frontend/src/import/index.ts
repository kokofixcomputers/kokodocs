import DOMPurify from 'dompurify'
import { parseDelimited } from '../sheet/csv'
import type { SheetModel, Style } from '../sheet/model'
import type { ImportPlan } from './pending'

export const ACCEPT = '.docx,.md,.markdown,.txt,.html,.htm,.xlsx,.csv,.tsv,.pptx'
export const MAX_IMPORT = 40 * 1024 * 1024
const ext = (f: File) => f.name.split('.').pop()?.toLowerCase() ?? ''
const baseName = (f: File) => f.name.replace(/\.[^.]+$/, '').trim() || 'Imported file'
export const importKind = (f: File): 'doc' | 'sheet' | 'slides' | null => {
  const e = ext(f)
  return ['docx', 'md', 'markdown', 'txt', 'html', 'htm'].includes(e) ? 'doc' : ['xlsx', 'csv', 'tsv'].includes(e) ? 'sheet' : e === 'pptx' ? 'slides' : null
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const IMG_OK: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }

/** Read a file into something an editor can take. `upload` stores pictures on the new file. Throws a friendly Error when it can't. */
export async function parseImport(file: File, upload: (f: File) => Promise<string>): Promise<ImportPlan> {
  if (file.size > MAX_IMPORT) throw new Error(`That file is larger than ${MAX_IMPORT / 1024 / 1024} MB.`)
  const e = ext(file), title = baseName(file)

  if (e === 'docx') {
    const clean = (h: string) => DOMPurify.sanitize(h, { ADD_ATTR: ['src', 'data-color', 'data-bg', 'colspan', 'rowspan'] }).replace(/<img[^>]*src=""[^>]*>/g, '')
    try {
      const { docxToHtml } = await import('./docx')
      const r = await docxToHtml(file, upload)
      if (r.html.replace(/<[^>]+>/g, '').trim() || r.images) return { kind: 'doc', title, note: r.skippedImages ? `${r.skippedImages} picture${r.skippedImages === 1 ? '' : 's'} couldn't be imported` : undefined, apply: (ed) => { ed.chain().setContent(clean(r.html), true).run() } }
    } catch { /* fall back to the plain converter below */ }
    const mammoth = (await import('mammoth/mammoth.browser')).default as unknown as typeof import('mammoth')
    const res = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() }, {
      styleMap: ['u => u', 'strike => s', "p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh"],
      convertImage: mammoth.images.imgElement(async (img) => {
        const type = img.contentType, ok = IMG_OK[type]
        if (!ok) return { src: '' }
        try {
          const b64 = await img.read('base64'); const bin = atob(b64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
          return { src: await upload(new File([bytes], `image.${ok}`, { type })) }
        } catch { return { src: '' } }
      }),
    } as never)
    return { kind: 'doc', title, apply: (ed) => { ed.chain().setContent(clean(res.value), true).run() } }
  }
  if (e === 'md' || e === 'markdown') {
    const { mdToHtml } = await import('../assistant/docTools')
    const src = await file.text(), html = DOMPurify.sanitize(mdToHtml(src))
    const h1 = /^#\s+(.+)$/m.exec(src)?.[1]?.trim()
    return { kind: 'doc', title: h1 && h1.length < 120 ? h1 : title, apply: (ed) => { ed.chain().setContent(html, true).run() } }
  }
  if (e === 'txt') {
    const html = (await file.text()).replace(/\r\n?/g, '\n').split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')
    return { kind: 'doc', title, apply: (ed) => { ed.chain().setContent(html || '<p></p>', true).run() } }
  }
  if (e === 'html' || e === 'htm') {
    const parsed = new DOMParser().parseFromString(await file.text(), 'text/html')
    const html = DOMPurify.sanitize(parsed.body.innerHTML, { FORBID_TAGS: ['style', 'script', 'form', 'iframe', 'img'] })
    return { kind: 'doc', title: parsed.title?.trim() || title, apply: (ed) => { ed.chain().setContent(html, true).run() } }
  }

  if (e === 'csv' || e === 'tsv') {
    const text = await file.text()
    const first = text.split(/\r?\n/, 1)[0]
    const delim = e === 'tsv' ? '\t' : (first.match(/\t/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? '\t' : first.includes(';') && !first.includes(',') ? ';' : ','
    return { kind: 'sheet', title, apply: (m) => { m.ensureDefaultTab(); m.importDelimited(m.tabList()[0].id, text, delim) } }
  }
  if (e === 'xlsx') {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await file.arrayBuffer())
    return { kind: 'sheet', title, note: wb.worksheets.length > 1 ? `${wb.worksheets.length} sheets imported` : undefined, apply: (m) => writeWorkbook(m, wb) }
  }

  if (e === 'pptx') {
    const { readPptx } = await import('./pptx')
    const { slides, skipped } = await readPptx(file, upload)
    const note = [skipped.charts && `${skipped.charts} chart${skipped.charts === 1 ? '' : 's'} couldn't be imported`, skipped.images && `${skipped.images} image${skipped.images === 1 ? '' : 's'} skipped`].filter(Boolean).join(', ')
    const first = slides[0]?.els.find((x) => x.role === 'title')?.text?.trim()
    return { kind: 'slides', title: first && first.length < 100 ? first : title, note: note || undefined, apply: (m) => m.importSlides(slides) }
  }
  throw new Error('That file type isn’t supported yet. You can import Word, Excel, PowerPoint, CSV, Markdown, HTML and text files.')
}

// ───────────── Excel ─────────────
const MAX_ROWS = 5000, MAX_COLS = 100, MAX_STYLED = 4000
function cellText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('formula' in o || 'sharedFormula' in o) { const f = String(o.formula ?? ''); return f ? '=' + f.replace(/^=/, '') : cellText(o.result) }
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((r) => r.text).join('')
    if ('text' in o) return cellText(o.text)
    if ('error' in o) return String(o.error)
    return ''
  }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  return String(v)
}
const argb = (c?: { argb?: string }) => (c?.argb && c.argb.length >= 6 ? '#' + c.argb.slice(-6).toLowerCase() : undefined)

function writeWorkbook(m: SheetModel, wb: import('exceljs').Workbook) {
  m.ensureDefaultTab()
  wb.worksheets.slice(0, 20).forEach((ws, i) => {
    const id = i === 0 ? m.tabList()[0].id : m.addTab(ws.name.slice(0, 40))
    if (i === 0 && ws.name) m.renameTab(id, ws.name.slice(0, 40))
    const entries: { r: number; c: number; text: string }[] = [], styled: { r: number; c: number; s: Partial<Style> }[] = []
    ws.eachRow({ includeEmpty: false }, (row, rn) => {
      if (rn > MAX_ROWS) return
      row.eachCell({ includeEmpty: false }, (cell, cn) => {
        if (cn > MAX_COLS) return
        const text = cellText(cell.value)
        if (text !== '') entries.push({ r: rn - 1, c: cn - 1, text })
        const s: Partial<Style> = {}
        if (cell.font?.bold) s.b = 1
        if (cell.font?.italic) s.i = 1
        if (cell.font?.underline) s.u = 1
        const fc = argb(cell.font?.color as never); if (fc && fc !== '#000000') s.color = fc
        const fill = cell.fill as { type?: string; pattern?: string; fgColor?: { argb?: string } } | undefined
        if (fill?.type === 'pattern' && fill.pattern === 'solid') { const bg = argb(fill.fgColor); if (bg && bg !== '#ffffff') s.bg = bg }
        const h = cell.alignment?.horizontal; if (h === 'center' || h === 'right') s.ha = h
        if (cell.alignment?.wrapText) s.wrap = 1
        if (Object.keys(s).length && styled.length < MAX_STYLED) styled.push({ r: rn - 1, c: cn - 1, s })
      })
    })
    if (entries.length) m.setTexts(id, entries)
    styled.forEach((x) => m.setStyle(id, { r1: x.r, c1: x.c, r2: x.r, c2: x.c }, x.s))
    ws.columns?.forEach((col, ci) => { if (col?.width && ci < MAX_COLS) m.setColWidth(id, ci, Math.round(col.width * 7 + 5)) })
  })
}

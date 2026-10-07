import { toDelimited } from '../sheet/csv'
import { CellError, type Scalar } from '../sheet/engine/values'
import { colName } from '../sheet/engine/refs'
import type { Rect, SheetModel, Style } from '../sheet/model'
import { escapeHtml } from './util'

const dataRect = (m: SheetModel, sheet: string): Rect => { const u = m.used(sheet); return { r1: 0, c1: 0, r2: Math.max(0, u.vrows - 1), c2: Math.max(0, u.vcols - 1) } }
const styleRect = (m: SheetModel, sheet: string): Rect => { const u = m.used(sheet); return { r1: 0, c1: 0, r2: Math.max(0, u.rows - 1), c2: Math.max(0, u.cols - 1) } }

/** CSV / TSV. `raw` writes real values (4050) instead of what the cell shows ($4,050). */
export function toDelimitedSheet(m: SheetModel, sheet: string, delim: string, raw = false): string {
  const R = dataRect(m, sheet)
  const rows: string[][] = []
  for (let r = R.r1; r <= R.r2; r++) {
    const row: string[] = []
    for (let c = R.c1; c <= R.c2; c++) {
      if (raw) { const v = m.value(sheet, r, c); row.push(v === null ? '' : v instanceof CellError ? v.code : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v)) }
      else row.push(m.display(sheet, r, c).text)
    }
    rows.push(row)
  }
  return toDelimited(rows, delim)
}

/** JSON array of objects keyed by the first row; values keep their types. */
export function toJsonSheet(m: SheetModel, sheet: string): string {
  const R = dataRect(m, sheet)
  const val = (r: number, c: number): Scalar => m.value(sheet, r, c)
  const heads: string[] = []
  const seen = new Map<string, number>()
  for (let c = R.c1; c <= R.c2; c++) {
    const h = val(0, c)
    let name = h === null || h === '' ? colName(c) : String(h)
    const n = seen.get(name) ?? 0; seen.set(name, n + 1)
    if (n) name = `${name}_${n + 1}`
    heads.push(name)
  }
  const out: Record<string, unknown>[] = []
  for (let r = 1; r <= R.r2; r++) {
    const o: Record<string, unknown> = {}
    let any = false
    for (let c = R.c1; c <= R.c2; c++) {
      const v = val(r, c)
      const x = v === null ? null : v instanceof CellError ? v.code : v
      if (x !== null && x !== '') any = true
      o[heads[c - R.c1]] = x
    }
    if (any) out.push(o)
  }
  return JSON.stringify(out, null, 2) + '\n'
}

const cssColor = (c?: string) => (c ? c : undefined)
/** A styled HTML table of the used range: for the HTML download and the PDF print view. */
export function sheetTableHtml(m: SheetModel, sheet: string): string {
  const R = styleRect(m, sheet)
  const merges = m.merges(sheet)
  const covered = new Set<string>()
  merges.forEach((g) => { for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) if (r !== g.r1 || c !== g.c1) covered.add(`${r},${c}`) })
  let html = '<table class="sheet-table"><colgroup>'
  for (let c = R.c1; c <= R.c2; c++) html += `<col style="width:${m.colWidth(sheet, c)}px">`
  html += '</colgroup><tbody>'
  for (let r = R.r1; r <= R.r2; r++) {
    html += `<tr style="height:${m.rowHeight(sheet, r)}px">`
    for (let c = R.c1; c <= R.c2; c++) {
      if (covered.has(`${r},${c}`)) continue
      const g = merges.find((x) => x.r1 === r && x.c1 === c)
      const d = m.display(sheet, r, c), s: Style = d.style
      const v = d.v
      const align = s.ha ?? (typeof v === 'number' ? 'right' : v instanceof CellError || typeof v === 'boolean' ? 'center' : 'left')
      const css = [
        `text-align:${align}`, `vertical-align:${s.va === 'top' ? 'top' : s.va === 'middle' ? 'middle' : 'bottom'}`,
        s.b ? 'font-weight:700' : '', s.i ? 'font-style:italic' : '', s.u || s.st ? `text-decoration:${[s.u ? 'underline' : '', s.st ? 'line-through' : ''].filter(Boolean).join(' ')}` : '',
        s.color ? `color:${cssColor(s.color)}` : '', s.bg ? `background:${cssColor(s.bg)}` : '', s.fs ? `font-size:${s.fs}px` : '', s.ff ? `font-family:'${s.ff}',sans-serif` : '',
        s.wrap ? 'white-space:pre-wrap' : 'white-space:pre',
        s.bt ? `border-top:1px solid ${s.bt}` : '', s.bb ? `border-bottom:1px solid ${s.bb}` : '', s.bl ? `border-left:1px solid ${s.bl}` : '', s.br ? `border-right:1px solid ${s.br}` : '',
      ].filter(Boolean).join(';')
      html += `<td${g ? ` colspan="${g.c2 - g.c1 + 1}" rowspan="${g.r2 - g.r1 + 1}"` : ''} style="${css}">${escapeHtml(d.text)}</td>`
    }
    html += '</tr>'
  }
  return html + '</tbody></table>'
}

export const SHEET_CSS = `
body { margin: 0; background: #f4f4f6; font: 13px/1.3 'Inter', system-ui, sans-serif; color: #111; }
.page { margin: 24px; padding: 24px; background: #fff; border-radius: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.12); overflow: auto; }
h1 { font-size: 18px; margin: 0 0 14px; } h2 { font-size: 14px; margin: 22px 0 8px; color: #555; }
.sheet-table { border-collapse: collapse; table-layout: fixed; } .sheet-table td { border: 1px solid #e2e2e8; padding: 3px 6px; overflow: hidden; }
@media print { body { background: #fff; } .page { margin: 0; padding: 0; box-shadow: none; border-radius: 0; overflow: visible; } * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } tr { break-inside: avoid; } h2 { break-after: avoid; } }
`

// ───────────── Excel ─────────────
const argb = (c?: string) => { const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((c ?? '').trim()); if (!m) return undefined; const h = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1]; return 'FF' + h.toUpperCase() }
const px2pt = (px: number) => Math.round(px * 0.75 * 2) / 2
/** Functions Excel stores with an _xlfn. prefix; without it newer Excel shows #NAME?. */
const XLFN = /\b(XLOOKUP|XMATCH|FILTER|SORT|SORTBY|UNIQUE|SEQUENCE|LET|TEXTJOIN|CONCAT|IFS|SWITCH|MAXIFS|MINIFS|TEXTSPLIT|RANDARRAY|XOR|DAYS|ISOWEEKNUM|STDEV\.S|STDEV\.P|VAR\.S|VAR\.P|RANK\.EQ|MODE\.SNGL|PERCENTILE\.INC|QUARTILE\.INC)(?=\()/gi
const ARRAYISH = /(FILTER|SORT|SORTBY|UNIQUE|SEQUENCE|TRANSPOSE|TEXTSPLIT|MMULT|RANDARRAY|ARRAYFORMULA|REGEXEXTRACT|SPLIT)\(|^=\s*[-+(]*\$?[A-Za-z]{1,3}\$?\d+:/i
const sheetTitle = (name: string, used: Set<string>) => {
  let t = name.replace(/[\[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Sheet'
  let n = 2; const base = t
  while (used.has(t.toLowerCase())) t = `${base.slice(0, 28)} ${n++}`
  used.add(t.toLowerCase()); return t
}

type ExcelJSLib = typeof import('exceljs')

export async function buildXlsx(m: SheetModel, ExcelJS: ExcelJSLib, title: string): Promise<ArrayBuffer> {
  const wb = new (ExcelJS as any).Workbook() as import('exceljs').Workbook
  wb.creator = 'KokoDocs'; wb.title = title; wb.created = new Date()
  const names = new Set<string>()
  const nameOf = new Map<string, string>()
  const tabs = m.tabList()
  tabs.forEach((t) => nameOf.set(t.name.toLowerCase(), sheetTitle(t.name, names)))
  for (const tab of tabs) {
    const ws = wb.addWorksheet(nameOf.get(tab.name.toLowerCase())!, { properties: tab.color ? { tabColor: { argb: argb(tab.color) } } : {} })
    const R = styleRect(m, tab.id)
    const fz = m.freeze(tab.id)
    if (fz.rows || fz.cols) ws.views = [{ state: 'frozen', xSplit: fz.cols, ySplit: fz.rows }]
    for (let c = R.c1; c <= R.c2; c++) ws.getColumn(c + 1).width = Math.max(4, Math.round((m.colWidth(tab.id, c) / 7.2) * 10) / 10)
    for (let r = R.r1; r <= R.r2; r++) { const h = m.rowHeight(tab.id, r); if (h !== 24) ws.getRow(r + 1).height = px2pt(h) }
    for (let r = R.r1; r <= R.r2; r++) for (let c = R.c1; c <= R.c2; c++) {
      const cell = m.cell(tab.id, r, c)
      const spilled = m.engine.isSpilled(tab.id, r, c)
      if (!cell && !spilled) continue
      const x = ws.getCell(r + 1, c + 1)
      const res = m.engine.result(tab.id, r, c)
      const v = res.v
      const rawText = cell?.v ?? ''
      const isFormula = rawText.startsWith('=') && rawText.length > 1
      if (isFormula && !ARRAYISH.test(rawText) && !spilled) {
        let f = rawText.slice(1).replace(/'?([^'!]+)'?!/g, (_s, n) => { const k = String(n).toLowerCase(); return nameOf.has(k) ? `'${nameOf.get(k)!.replace(/'/g, "''")}'!` : _s })
        f = f.replace(XLFN, (fn) => `_xlfn.${fn.toUpperCase()}`)
        x.value = { formula: f, result: v instanceof CellError ? { error: v.code as any } : (v as any) ?? undefined }
      } else if (v !== null) x.value = v instanceof CellError ? { error: v.code as any } : (v as any)
      const s: Style = cell?.s ?? {}
      let nf = s.nf && s.nf !== 'General' ? s.nf : undefined
      if (!nf && res.date && typeof v === 'number') nf = v % 1 === 0 ? 'yyyy-mm-dd' : 'yyyy-mm-dd h:mm'
      if (nf) x.numFmt = nf
      if (s.b || s.i || s.u || s.st || s.color || s.fs || s.ff) {
        x.font = { name: s.ff ?? 'Calibri', size: s.fs ? px2pt(s.fs) : 11, bold: !!s.b, italic: !!s.i, underline: !!s.u, strike: !!s.st, color: argb(s.color) ? { argb: argb(s.color)! } : undefined }
      }
      if (s.bg && argb(s.bg)) x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(s.bg)! } }
      if (s.ha || s.va || s.wrap) x.alignment = { horizontal: s.ha, vertical: s.va === 'middle' ? 'middle' : s.va, wrapText: !!s.wrap }
      if (s.bt || s.bb || s.bl || s.br) {
        const side = (c?: string) => (c ? { style: 'thin' as const, color: { argb: argb(c) ?? 'FF000000' } } : undefined)
        x.border = { top: side(s.bt), bottom: side(s.bb), left: side(s.bl), right: side(s.br) }
      }
    }
    for (const g of m.merges(tab.id)) ws.mergeCells(g.r1 + 1, g.c1 + 1, g.r2 + 1, g.c2 + 1)
  }
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>
}

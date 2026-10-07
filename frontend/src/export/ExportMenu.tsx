import { useState, type ReactNode } from 'react'
import type { Editor } from '@tiptap/react'
import { Braces, Download, FileCode2, FileSpreadsheet, FileText, FileType2, Loader2, Printer, Sheet, Table2 } from 'lucide-react'
import type { PageMeta } from '../editor/Pagination'
import { Popover } from '../ui/Popover'
import { toast } from '../ui/Toast'
import type { SheetModel } from '../sheet/model'
import { buildHtml } from './htmlDoc'
import { toMarkdown, toPlainText } from './markdown'
import { printHtml } from './printPdf'
import { buildXlsx, SHEET_CSS, sheetTableHtml, toDelimitedSheet, toJsonSheet } from './sheetExport'
import { escapeHtml, loadImageData, safeName, saveBlob, usedFonts, type PMNode } from './util'

export interface Item { id: string; icon: ReactNode; label: string; hint: string; run: () => Promise<void> }

export function Menu({ items, label }: { items: Item[]; label: string }) {
  const [busy, setBusy] = useState<string | null>(null)
  const go = async (it: Item, close: () => void) => {
    close(); setBusy(it.id)
    try { await it.run() } catch (e) { console.error(e); toast(`Could not create the ${it.label} file`) } finally { setBusy(null) }
  }
  return (
    <Popover align="end" className="exp-menu" trigger={({ toggle }) => (
      <button className="icon-btn" title={label} aria-label={label} onClick={toggle}>{busy ? <Loader2 size={19} className="spin" /> : <Download size={19} />}</button>)}>
      {(close) => (
        <div className="exp-list">
          <div className="exp-title">{label}</div>
          {items.map((it) => (
            <button key={it.id} className="exp-item" onClick={() => go(it, close)}>
              <span className="exp-ico">{it.icon}</span><span className="exp-text"><b>{it.label}</b><span>{it.hint}</span></span>
            </button>))}
        </div>)}
    </Popover>
  )
}

const abs = (n: PMNode): PMNode => (n.type === 'image' && n.attrs?.src?.startsWith('/') ? { ...n, attrs: { ...n.attrs, src: location.origin + n.attrs.src } } : n.content ? { ...n, content: n.content.map(abs) } : n)

export function DocExportMenu({ editor, title, meta }: { editor: Editor; title: string; meta: PageMeta }) {
  const name = safeName(title, 'Untitled document')
  const json = () => editor.getJSON() as PMNode
  const html = (mode: 'download' | 'print') => buildHtml({ title: name, body: editor.getHTML().replace(/<img[^>]*class="emoji"[^>]*alt="([^"]*)"[^>]*>/g, '$1'), fonts: usedFonts(json()), meta, mode, embedImages: mode === 'download' })
  const items: Item[] = [
    { id: 'pdf', icon: <Printer size={18} />, label: 'PDF', hint: 'Choose “Save as PDF” in the print window', run: async () => {
      toast('In the print window, choose “Save as PDF” as the destination.')
      await printHtml(await html('print'))
    } },
    { id: 'docx', icon: <FileType2 size={18} />, label: 'Word (.docx)', hint: 'Editable in Word, Pages, Google Docs', run: async () => {
      const [{ buildDocx }, { Packer }] = await Promise.all([import('./docx'), import('docx')])
      const d = await buildDocx(json(), { title: name, meta, loadImage: (src) => loadImageData(new URL(src, location.href).href) })
      saveBlob(await Packer.toBlob(d), `${name}.docx`)
    } },
    { id: 'md', icon: <FileCode2 size={18} />, label: 'Markdown (.md)', hint: 'Headings, lists, tables, links', run: async () => { saveBlob(new Blob([toMarkdown(abs(json()))], { type: 'text/markdown;charset=utf-8' }), `${name}.md`) } },
    { id: 'html', icon: <Braces size={18} />, label: 'Web page (.html)', hint: 'Self-contained, images included', run: async () => { saveBlob(new Blob([await html('download')], { type: 'text/html;charset=utf-8' }), `${name}.html`) } },
    { id: 'txt', icon: <FileText size={18} />, label: 'Plain text (.txt)', hint: 'No formatting', run: async () => { saveBlob(new Blob([toPlainText(json())], { type: 'text/plain;charset=utf-8' }), `${name}.txt`) } },
  ]
  return <Menu items={items} label="Download as" />
}

export function SheetExportMenu({ model, sheet, title }: { model: SheetModel; sheet: string; title: string }) {
  const name = safeName(title, 'Untitled spreadsheet')
  const tab = model.tabList().find((t) => t.id === sheet)?.name ?? 'Sheet1'
  const file = (ext: string) => `${name}${model.tabList().length > 1 ? ` - ${safeName(tab)}` : ''}.${ext}`
  const allSheets = () => model.tabList().map((t) => `${model.tabList().length > 1 ? `<h2>${escapeHtml(t.name)}</h2>` : ''}${sheetTableHtml(model, t.id)}`).join('\n')
  const page = (extra = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(name)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap"><style>${SHEET_CSS}${extra}</style></head>
<body><main class="page"><h1>${escapeHtml(name)}</h1>${allSheets()}</main></body></html>`
  const items: Item[] = [
    { id: 'xlsx', icon: <FileSpreadsheet size={18} />, label: 'Excel (.xlsx)', hint: 'All sheets, formulas and formatting', run: async () => {
      const ExcelJS = (await import('exceljs')).default
      const buf = await buildXlsx(model, ExcelJS as never, name)
      saveBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${name}.xlsx`)
      if (model.charts(sheet).length || model.tabList().some((t) => model.charts(t.id).length)) toast('Charts aren’t included in Excel files yet.')
    } },
    { id: 'csv', icon: <Table2 size={18} />, label: 'CSV (.csv)', hint: 'This sheet, as it appears', run: async () => { saveBlob(new Blob(['﻿' + toDelimitedSheet(model, sheet, ',')], { type: 'text/csv;charset=utf-8' }), file('csv')) } },
    { id: 'csvraw', icon: <Table2 size={18} />, label: 'CSV, plain values', hint: 'Numbers without $ or % formatting', run: async () => { saveBlob(new Blob(['﻿' + toDelimitedSheet(model, sheet, ',', true)], { type: 'text/csv;charset=utf-8' }), file('csv')) } },
    { id: 'tsv', icon: <Table2 size={18} />, label: 'Tab-separated (.tsv)', hint: 'This sheet', run: async () => { saveBlob(new Blob([toDelimitedSheet(model, sheet, '\t')], { type: 'text/tab-separated-values;charset=utf-8' }), file('tsv')) } },
    { id: 'json', icon: <Braces size={18} />, label: 'JSON (.json)', hint: 'Rows as objects, first row as keys', run: async () => { saveBlob(new Blob([toJsonSheet(model, sheet)], { type: 'application/json' }), file('json')) } },
    { id: 'html', icon: <FileCode2 size={18} />, label: 'Web page (.html)', hint: 'All sheets with formatting', run: async () => { saveBlob(new Blob([page()], { type: 'text/html;charset=utf-8' }), `${name}.html`) } },
    { id: 'pdf', icon: <Sheet size={18} />, label: 'PDF', hint: 'All sheets, landscape. Choose “Save as PDF”', run: async () => {
      toast('In the print window, choose “Save as PDF” as the destination.')
      await printHtml(page('@page { size: landscape; margin: .5in } .sheet-table { font-size: 10px }'))
    } },
  ]
  return <Menu items={items} label="Download as" />
}

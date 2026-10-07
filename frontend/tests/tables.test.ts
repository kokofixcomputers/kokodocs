import JSZip from 'jszip'
import { Packer } from 'docx'
import { DOMParser as XmlDom } from '@xmldom/xmldom'
;(globalThis as unknown as { DOMParser: unknown }).DOMParser = XmlDom
import { buildDocx } from '../src/export/docx'
import { toMarkdown } from '../src/export/markdown'
import { docxToHtml } from '../src/import/docx'
import { DEFAULT_META } from '../src/editor/Pagination'

let pass = 0, fail = 0
const ok = (name: string, c: boolean, info = '') => { if (c) pass++; else { fail++; console.log('FAIL', name, info) } }
const cell = (text: string, attrs: Record<string, unknown> = {}, type = 'tableCell') => ({ type, attrs: { colspan: 1, rowspan: 1, ...attrs }, content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }] })
const tr = (...c: unknown[]) => ({ type: 'tableRow', content: c })
// the editor's own shape: a title across three columns, a cell spanning two rows, a row that is short because of it
const doc = { type: 'doc', content: [{ type: 'table', content: [
  tr(cell('Report', { colspan: 3 }, 'tableHeader')),
  tr(cell('A', { rowspan: 2 }), cell('B'), cell('C')),
  tr(cell('D'), cell('E')),
] }] }

// 1. export to Word, then import it back: the merged cells survive
const built = await buildDocx(doc as never, { title: 't', meta: DEFAULT_META, loadImage: async () => null })
const buf = await Packer.toBuffer(built)
const back = await docxToHtml(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, async () => '')
ok('column span survives export then import', /<td[^>]*colspan="3"[^>]*>.*Report/.test(back.html), back.html)
ok('row span survives export then import', /<td[^>]*rowspan="2"[^>]*>.*A/.test(back.html), back.html)
ok('same number of cells', (back.html.match(/<td/g) ?? []).length === 6, String((back.html.match(/<td/g) ?? []).length))

// 2. Markdown has no merged cells, so the grid must still line up
const md = toMarkdown(doc as never)
const lines = md.trim().split('\n')
ok('markdown keeps columns aligned for merged cells', lines.every((l) => (l.match(/\|/g) ?? []).length === 4), md)
ok('a spanned cell keeps its text in the first slot', lines[0].includes('Report') && lines[2].startsWith('| A | B | C |') && lines[3].startsWith('|  | D | E |'), md)

// 3. irregular tables as Word writes them
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
const tc = (t: string, pr = '') => `<w:tc>${pr ? `<w:tcPr>${pr}</w:tcPr>` : ''}<w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`
const row = (inner: string, trPr = '') => `<w:tr>${trPr ? `<w:trPr>${trPr}</w:trPr>` : ''}${inner}</w:tr>`
const xml = `<w:document ${W}><w:body><w:tbl><w:tblGrid><w:gridCol/><w:gridCol/><w:gridCol/></w:tblGrid>` +
  row(tc('a1') + tc('a2') + tc('a3')) +
  row(tc('b2') + tc('b3'), '<w:gridBefore w:val="1"/>') +          // starts in the second column
  row(tc('c1') + tc('c2'), '<w:gridAfter w:val="1"/>') +           // stops before the last column
  row(tc('d1')) +                                                   // just one cell in a three column table
  row(tc('e1', '<w:gridSpan w:val="2"/>') + tc('e3')) +
  `</w:tbl></w:body></w:document>`
const z = new JSZip(); z.file('word/document.xml', xml)
const r = await docxToHtml(await z.generateAsync({ type: 'arraybuffer' }), async () => '')
const rowsHtml = r.html.split('<tr>').slice(1)
const spans = rowsHtml.map((h) => (h.match(/<td[^>]*>/g) ?? []).map((t) => /colspan="(\d+)"/.exec(t)?.[1] ?? '1').join('+'))
ok('a full row is left alone', spans[0] === '1+1+1', spans.join(' / '))
ok('a row that starts later stretches its first cell over the gap', spans[1] === '2+1', spans.join(' / '))
ok('a row that ends early stretches its last cell over the gap', spans[2] === '1+2', spans.join(' / '))
ok('a one cell row fills the width', spans[3] === '3', spans.join(' / '))
ok('explicit spans are kept', spans[4] === '2+1', spans.join(' / '))
ok('every row adds up to the grid width', spans.every((s) => s.split('+').reduce((a, b) => a + Number(b), 0) === 3), spans.join(' / '))

console.log(`${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

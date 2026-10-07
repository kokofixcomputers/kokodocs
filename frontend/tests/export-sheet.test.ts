import { writeFileSync } from 'node:fs'
import * as Y from 'yjs'
import ExcelJS from 'exceljs'
import { SheetModel } from '../src/sheet/model'
import { parseDelimited } from '../src/sheet/csv'
import { buildXlsx, sheetTableHtml, toDelimitedSheet, toJsonSheet } from '../src/export/sheetExport'

let pass = 0, fail = 0
const eq = (name: string, got: unknown, exp: unknown) => { if (JSON.stringify(got) === JSON.stringify(exp)) pass++; else { fail++; console.log(`FAIL ${name}\n  got      ${JSON.stringify(got)}\n  expected ${JSON.stringify(exp)}`) } }

const m = new SheetModel(new Y.Doc()); m.ensureDefaultTab(); const S = 'sheet1'
const rows = [['Product', 'Q1', 'Q2', 'Notes'], ['Laptops', 1200, 1350, 'say "hi", ok'], ['Phones', 980, 1100, 'line\nbreak'], ['Cables', 90, 120, '']]
rows.forEach((r, i) => r.forEach((v, j) => v !== '' && m.setText(S, i, j, String(v))))
m.setText(S, 4, 0, 'Total'); m.setText(S, 4, 1, '=SUM(B2:B4)'); m.setText(S, 4, 2, '=SUM(C2:C4)'); m.setText(S, 5, 0, 'Best'); m.setText(S, 5, 1, '=XLOOKUP(MAX(B2:B4),B2:B4,A2:A4)')
m.setText(S, 6, 0, 'Date'); m.setText(S, 6, 1, '2024-01-15'); m.setText(S, 7, 0, 'Today'); m.setText(S, 7, 1, '=TODAY()'); m.setText(S, 8, 0, 'Spill'); m.setText(S, 8, 3, '=SEQUENCE(3)')
m.setText(S, 9, 0, 'Err'); m.setText(S, 9, 1, '=1/0')
m.setStyle(S, { r1: 0, c1: 0, r2: 0, c2: 3 }, { b: 1, bg: '#111111', color: '#ffffff', ha: 'center' }); m.setStyle(S, { r1: 1, c1: 1, r2: 4, c2: 2 }, { nf: '$#,##0' })
m.setBorders(S, { r1: 0, c1: 0, r2: 3, c2: 3 }, 'outer'); m.setColWidth(S, 0, 160); m.setFreeze(S, 1, 1); m.merge(S, { r1: 11, c1: 0, r2: 11, c2: 2 }); m.setText(S, 11, 0, 'Merged title')
const t2 = m.addTab('Sum / Data'); m.setText(t2, 0, 0, '=Sheet1!B5*2'); m.setTabColor(t2, '#22c55e')

// csv / tsv / json
const csv = toDelimitedSheet(m, S, ',')
const grid = parseDelimited(csv, ',')
eq('csv quoting + displayed values', grid[1], ['Laptops', '$1,200', '$1,350', 'say "hi", ok'])
eq('csv newline field survives', grid[2][3], 'line\nbreak')
eq('csv total row', grid[4], ['Total', '$2,270', '$2,570', ''])
eq('csv raw values', parseDelimited(toDelimitedSheet(m, S, ',', true), ',')[4], ['Total', '2270', '2570', ''])
eq('tsv', toDelimitedSheet(m, S, '\t').split('\n')[0], 'Product\tQ1\tQ2\tNotes')
const json = JSON.parse(toJsonSheet(m, S))
eq('json typed rows', [json[0].Product, json[0].Q1, json[3].Q2, json[3].Q1 === 2270], ['Laptops', 1200, 2570, true])
eq('json error + date + spill', [json.find((r: any) => r.Product === 'Err').Q1, json.find((r: any) => r.Product === 'Date').Q1 > 40000], ['#DIV/0!', true])
const html = sheetTableHtml(m, S)
eq('html table basics', html.includes('<th') === false && html.includes('font-weight:700') && html.includes('background:#111111') && html.includes('colspan="3"') && html.includes('$1,200'), true)

// xlsx
const buf = await buildXlsx(m, ExcelJS, 'Report')
writeFileSync('/tmp/koko-sample.xlsx', Buffer.from(buf))
const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as ArrayBuffer)
eq('sheet names (sanitised)', wb.worksheets.map((w) => w.name), ['Sheet1', 'Sum Data'])
const ws = wb.getWorksheet('Sheet1')!
eq('formula kept', (ws.getCell('B5').value as any).formula, 'SUM(B2:B4)')
eq('cached result kept', (ws.getCell('B5').value as any).result, 2270)
eq('xlfn prefix', (ws.getCell('B6').value as any).formula, '_xlfn.XLOOKUP(MAX(B2:B4),B2:B4,A2:A4)')
eq('number format', ws.getCell('B2').numFmt, '$#,##0')
eq('header style', [ws.getCell('A1').font?.bold, (ws.getCell('A1').fill as any)?.fgColor?.argb, ws.getCell('A1').alignment?.horizontal], [true, 'FF111111', 'center'])
eq('merge', ws.getCell('B12').isMerged, true)
eq('frozen', [ws.views[0]?.state, (ws.views[0] as any)?.xSplit, (ws.views[0] as any)?.ySplit], ['frozen', 1, 1])
eq('spill exported as plain values', [ws.getCell('D9').value, ws.getCell('D10').value, ws.getCell('D11').value], [1, 2, 3])
eq('error value', (ws.getCell('B10').value as any).error ?? (ws.getCell('B10').value as any).result?.error, '#DIV/0!')
eq('cross-sheet formula uses sanitised name', (wb.getWorksheet('Sum Data')!.getCell('A1').value as any).formula, "'Sheet1'!B5*2")
eq('date has date format', ws.getCell('B8').numFmt?.includes('yyyy'), true)
console.log(`${pass} passed, ${fail} failed`)

import * as Y from 'yjs'
import { SheetModel } from '../src/sheet/model'
import { createSheetAdapter, parseRange } from '../src/assistant/sheetTools'

let pass = 0, fail = 0
const eq = (name: string, got: unknown, exp: unknown) => { if (JSON.stringify(got) === JSON.stringify(exp)) pass++; else { fail++; console.log(`FAIL ${name}\n  got      ${JSON.stringify(got)}\n  expected ${JSON.stringify(exp)}`) } }
const has = (name: string, text: string, ...needles: string[]) => { const miss = needles.filter((n) => !text.includes(n)); if (!miss.length) pass++; else { fail++; console.log(`FAIL ${name}: missing ${JSON.stringify(miss)} in\n${text.slice(0, 600)}`) } }

const m = new SheetModel(new Y.Doc()); m.ensureDefaultTab()
let active = 'sheet1'
let sel = { r1: 0, c1: 0, r2: 0, c2: 0 }
let revealed: number[] | null = null
const a = createSheetAdapter({ model: m, getSheet: () => active, setSheet: (id) => { active = id }, getSel: () => sel, getTitle: () => 'Q3 Sales', canEdit: () => true, reveal: (x, y) => { revealed = [x, y] } })
const T = (n: string) => a.tools.find((t) => t.spec.function.name === n)!
const run = async (n: string, args: object) => String(await T(n).run(args))

// parseRange
eq('parse cell', parseRange('B7'), { r1: 6, c1: 1, r2: 6, c2: 1 }); eq('parse range', parseRange('a1:C3'), { r1: 0, c1: 0, r2: 2, c2: 2 })
eq('parse abs', parseRange('$A$1:$B$2'), { r1: 0, c1: 0, r2: 1, c2: 1 }); eq('parse column', parseRange('B:B', 500)?.r2, 499); eq('parse junk', parseRange('hello'), null)

// empty sheet
has('empty sheet', await run('read_sheet', {}), 'Sheet “Sheet1” is empty')

// write a table, headers + data + formulas, then read it back
const out = await run('set_range', { start: 'A1', values: [['Product', 'Q1', 'Q2', 'Total'], ['Laptops', 1200, 1350, '=B2+C2'], ['Phones', 980, 1100, '=B3+C3'], ['Cables', 90, 120, '=B4+C4']] })
has('set_range reports + verifies', out, 'Wrote 16 cell(s) at A1:D4', 'D2 =B2+C2 → 2550', 'D4 =B4+C4 → 210')
const rd = await run('read_sheet', {})
has('read_sheet markdown table', rd, 'Spreadsheet “Q3 Sales”', 'used range A1:D4', '| 2 | Laptops | 1200 | 1350 | 2550 |', 'Formulas:', 'D3: =B3+C3 → 2080')
has('read_sheet range', await run('read_sheet', { range: 'B2:C3' }), '| 2 | 1200 | 1350 |')

// set_cells with a broken formula is flagged so the model can fix it
const bad = await run('set_cells', { cells: [{ ref: 'D5', value: '=SUM(B2:B4)' }, { ref: 'E5', value: '=NOSUCHFN(1)' }, { ref: 'A7', value: null }] })
has('set_cells flags errors', bad, 'D5 =SUM(B2:B4) → 2270', 'E5 =NOSUCHFN(1) → #NAME?', '1 formula(s) returned an error')
await run('clear_range', { range: 'E5' })

// formatting
await run('format_cells', { range: 'A1:D1', bold: true, fill_color: '#111111', text_color: '#ffffff', align: 'center' })
await run('format_cells', { range: 'B2:D5', number_format: 'currency' })
await run('format_cells', { range: 'A1:D4', borders: 'outer' })
eq('format applied', [m.style('sheet1', 0, 0).b, m.style('sheet1', 0, 0).bg, m.style('sheet1', 0, 0).ha, m.style('sheet1', 1, 1).nf, !!m.style('sheet1', 0, 0).bt], [1, '#111111', 'center', '$#,##0.00', true])
await run('format_cells', { range: 'A1', bold: false }); eq('unbold', m.style('sheet1', 0, 0).b, undefined)

// charts
const ch = await run('create_chart', { type: 'column', range: 'A1:C4', title: 'Sales' })
has('create_chart', ch, 'Created chart', 'column, A1:C4')
eq('chart stored', [m.charts('sheet1').length, m.charts('sheet1')[0].title, m.charts('sheet1')[0].headers], [1, 'Sales', true])
eq('chart placed right of the data & revealed', [m.charts('sheet1')[0].x > 300, Array.isArray(revealed)], [true, true])
const cid = m.charts('sheet1')[0].id
await run('update_chart', { id: cid, type: 'line', title: 'Trend' }); eq('update chart', [m.charts('sheet1')[0].type, m.charts('sheet1')[0].title], ['line', 'Trend'])
has('read shows chart id', await run('read_sheet', {}), `id ${cid}: line chart “Trend” from A1:C4`)
await run('delete_chart', { id: cid }); eq('delete chart', m.charts('sheet1').length, 0)

// sort / structure
await run('sort_range', { range: 'A1:D4', by_column: 'B', ascending: true, has_header_row: true }); eq('sorted by Q1', [2, 3, 4].map((r) => m.raw('sheet1', r - 1, 0)), ['Cables', 'Phones', 'Laptops'])
await run('insert_rows', { before_row: 2, count: 1 }); eq('insert row shifts data', m.raw('sheet1', 2, 0), 'Cables')
await run('delete_rows', { from_row: 2, count: 1 }); eq('delete row', m.raw('sheet1', 1, 0), 'Cables')
await run('insert_columns', { before_column: 'B' }); eq('insert column', m.raw('sheet1', 0, 2), 'Q1')
await run('delete_columns', { from_column: 'B' }); eq('delete column', m.raw('sheet1', 0, 1), 'Q1')
await run('freeze_panes', { rows: 1, columns: 1 }); eq('freeze', m.freeze('sheet1'), { rows: 1, cols: 1 })
await run('set_column_width', { columns: 'A:B', width: 180 }); eq('col width', [m.colWidth('sheet1', 0), m.colWidth('sheet1', 1), m.colWidth('sheet1', 2)], [180, 180, 100])
await run('merge_cells', { range: 'A8:C8' }); eq('merge', m.merges('sheet1').length, 1)

// sheets
await run('add_sheet', { name: 'Summary' }); eq('add sheet switches to it', [m.tabList().map((t) => t.name), active === m.sheetId('Summary')], [['Sheet1', 'Summary'], true])
await run('set_cells', { cells: [{ ref: 'A1', value: '=SUM(Sheet1!D2:D4)' }] }); eq('cross-sheet write on active sheet', m.display(active, 0, 0).text, '4840')
has('cross-sheet read', await run('read_sheet', { sheet: 'Sheet1', range: 'A1:A2' }), 'Sheet “Sheet1”')
await run('rename_sheet', { from: 'Summary', to: 'Totals' }); eq('rename', m.tabList()[1].name, 'Totals')

// errors the model can read and recover from
let msg = ''; try { await run('read_sheet', { sheet: 'Nope' }) } catch (e) { msg = (e as Error).message }; has('unknown sheet explained', msg, 'no sheet called “Nope”', 'Sheet1, Totals')
msg = ''; try { await run('set_cells', { cells: [{ ref: 'not a cell', value: 1 }] }) } catch (e) { msg = (e as Error).message }; has('bad ref explained', msg, 'isn\'t a valid range')
msg = ''; try { await run('update_chart', { id: 'zzz', type: 'pie' }) } catch (e) { msg = (e as Error).message }; has('missing chart explained', msg, 'No chart with id zzz')

// approval descriptions
const d1 = T('set_cells').describe!({ cells: [{ ref: 'A1', value: '=1+1' }, { ref: 'B1', value: 'hi' }] }); eq('describe set_cells', d1.title, 'Set 2 cells'); has('describe detail', d1.detail!, 'A1 = =1+1')
eq('describe chart', T('create_chart').describe!({ type: 'pie', title: 'Share', range: 'A1:B5' }).title, 'Create a pie chart “Share”')
eq('edit flags: reads are free, writes need approval', a.tools.map((t) => `${t.spec.function.name}:${t.edit ? 'edit' : 'read'}`).filter((x) => x.endsWith('read')), ['read_sheet:read', 'get_selection:read'])
sel = { r1: 1, c1: 1, r2: 3, c2: 2 }; active = 'sheet1'
has('context mentions selection', a.context(), 'B2:C4 selected'); has('get_selection returns values', await run('get_selection', {}), 'Selected B2:C4')
console.log(`${pass} passed, ${fail} failed`)

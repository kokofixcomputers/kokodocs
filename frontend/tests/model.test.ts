import * as Y from 'yjs'
import { SheetModel } from '../src/sheet/model'
import { parseAddr } from '../src/sheet/engine/refs'
let pass = 0, fail = 0
const eq = (name: string, got: unknown, exp: unknown) => { if (JSON.stringify(got) === JSON.stringify(exp)) pass++; else { fail++; console.log(`FAIL ${name}: ${JSON.stringify(got)} != ${JSON.stringify(exp)}`) } }
const A = (a: string) => { const p = parseAddr(a)!; return [p.r, p.c] as [number, number] }
const mk = () => { const d = new Y.Doc(); const m = new SheetModel(d); m.ensureDefaultTab(); return { d, m } }

{ // basic formulas + recalculation
  const { m } = mk(); const S = 'sheet1'
  const set = (a: string, t: string) => m.setText(S, ...A(a), t)
  const val = (a: string) => m.value(S, ...A(a))
  set('A1', '5'); set('A2', '7'); set('A3', '=A1+A2'); eq('A3 = A1+A2', val('A3'), 12)
  set('A1', '100'); eq('recalculates', val('A3'), 107)
  set('B1', '=SUM(A1:A3)'); eq('SUM range', val('B1'), 214)
  set('C1', '=IF(A1>50,"big","small")'); eq('IF', val('C1'), 'big')
  // number format inference
  set('D1', '12%'); eq('percent value', val('D1'), 0.12); eq('percent nf', m.style(S, ...A('D1')).nf, '0%'); eq('percent display', m.display(S, ...A('D1')).text, '12%')
  set('D2', '$1234.5'); eq('currency display', m.display(S, ...A('D2')).text, '$1,234.50'); set('D3', '2024-01-15'); eq('date display', m.display(S, ...A('D3')).text, '2024-01-15')
  set('D4', '=TODAY()'); eq('TODAY auto date format', /^\d{4}-\d\d-\d\d$/.test(m.display(S, ...A('D4')).text), true)
  // styles
  m.setStyle(S, { r1: 0, c1: 0, r2: 1, c2: 0 }, { b: 1, color: '#ff0000' }); eq('style applied', m.style(S, ...A('A2')), { b: 1, color: '#ff0000' }); eq('value kept', m.raw(S, ...A('A2')), '7')
  m.setBorders(S, { r1: 0, c1: 0, r2: 1, c2: 1 }, 'outer'); eq('outer border TL', [!!m.style(S, 0, 0).bt, !!m.style(S, 0, 0).bl, !!m.style(S, 0, 0).bb], [true, true, false])
  m.clear(S, { r1: 0, c1: 0, r2: 1, c2: 0 }, 'formats'); eq('clear formats', m.style(S, 0, 0).b, undefined)
}
{ // insert/delete rows and columns rewrite formulas
  const { m } = mk(); const S = 'sheet1'
  const set = (a: string, t: string) => m.setText(S, ...A(a), t); const raw = (a: string) => m.raw(S, ...A(a)); const val = (a: string) => m.value(S, ...A(a))
  set('A1', '1'); set('A2', '2'); set('A3', '3'); set('B1', '=SUM(A1:A3)'); set('B2', '=A3*2')
  m.insertRows(S, 1, 1)   // new row 2
  eq('rows shifted', [raw('A1'), raw('A2'), raw('A3'), raw('A4')], ['1', undefined, '2', '3']); eq('range expands', raw('B1'), '=SUM(A1:A4)'); eq('moved formula updated', raw('B3'), '=A4*2'); eq('values still right', [val('B1'), val('B3')], [6, 6])
  m.deleteRows(S, 1, 1)
  eq('delete restores', [raw('B1'), raw('B2')], ['=SUM(A1:A3)', '=A3*2'])
  m.deleteRows(S, 2, 1)   // delete row holding A3
  eq('ref to deleted row -> #REF!', raw('B2'), '=#REF!*2'); eq('shrinks range', raw('B1'), '=SUM(A1:A2)'); eq('shows #REF!', m.display(S, ...A('B2')).text, '#REF!')
  set('E1', '=A1+B1'); m.stopCapturing(); m.insertCols(S, 0, 1); eq('cols shift', [raw('B1'), raw('F1')], ['1', '=B1+C1']); m.stopCapturing(); m.deleteCols(S, 0, 1); eq('cols back', raw('E1'), '=A1+B1')
  m.undo(); eq('undo delete-cols', raw('F1'), '=B1+C1'); m.undo(); eq('undo insert-cols', raw('E1'), '=A1+B1')
}
{ // undo / redo
  const { m } = mk(); const S = 'sheet1'
  m.setText(S, 0, 0, 'one'); m.stopCapturing(); m.setText(S, 0, 0, 'two'); m.stopCapturing(); m.setText(S, 0, 0, 'three')
  m.undo(); eq('undo 1', m.raw(S, 0, 0), 'two'); m.undo(); eq('undo 2', m.raw(S, 0, 0), 'one'); m.redo(); eq('redo', m.raw(S, 0, 0), 'two'); eq('canUndo/canRedo', [m.canUndo(), m.canRedo()], [true, true])
}
{ // fill / sort / merge / paste
  const { m } = mk(); const S = 'sheet1'
  m.setText(S, 0, 0, '1'); m.setText(S, 1, 0, '2'); m.fill(S, { r1: 0, c1: 0, r2: 1, c2: 0 }, { r1: 2, c1: 0, r2: 4, c2: 0 }); eq('fill series down', [2, 3, 4].map((r) => m.raw(S, r, 0)), ['3', '4', '5'])
  m.setText(S, 0, 1, '=A1*10'); m.fill(S, { r1: 0, c1: 1, r2: 0, c2: 1 }, { r1: 1, c1: 1, r2: 4, c2: 1 }); eq('fill formula down', [1, 4].map((r) => m.raw(S, r, 1)), ['=A2*10', '=A5*10']); eq('fill formula values', m.value(S, 4, 1), 50)
  m.setText(S, 6, 0, 'Mon'); m.fill(S, { r1: 6, c1: 0, r2: 6, c2: 0 }, { r1: 6, c1: 1, r2: 6, c2: 3 }); eq('fill right weekdays', [1, 2, 3].map((c) => m.raw(S, 6, c)), ['Tue', 'Wed', 'Thu'])
  m.setText(S, 1, 5, '5'); m.fill(S, { r1: 1, c1: 5, r2: 1, c2: 5 }, { r1: 0, c1: 5, r2: 0, c2: 5 }); eq('fill up copies single number', m.raw(S, 0, 5), '5')
}
{
  const { m } = mk(); const S = 'sheet1'
  const rows = [['Bob', '30'], ['alice', '25'], ['Cara', '35'], ['', ''], ['Dan', '']]
  rows.forEach((r, i) => r.forEach((t, j) => t && m.setText(S, i + 1, j, t))); m.setText(S, 0, 0, 'Name'); m.setText(S, 0, 1, 'Age'); m.setText(S, 1, 2, '=B2*2')
  m.sort(S, { r1: 0, c1: 0, r2: 5, c2: 2 }, 1, true, true); eq('sort asc by number, blanks last', [1, 2, 3, 4, 5].map((r) => m.raw(S, r, 0) ?? null), ['alice', 'Bob', 'Cara', null, 'Dan'])
  eq('row formula follows its row (Bob moved to row 3)', [m.raw(S, 2, 2), m.value(S, 2, 2)], ['=B3*2', 60]); eq('header untouched', m.raw(S, 0, 0), 'Name')
  m.sort(S, { r1: 0, c1: 0, r2: 5, c2: 2 }, 0, false, true); eq('sort desc by text', [1, 2, 3].map((r) => m.raw(S, r, 0)), ['Dan', 'Cara', 'Bob'])
  m.merge(S, { r1: 8, c1: 0, r2: 9, c2: 2 }); eq('merge lookup', [m.mergeAt(S, 9, 2)?.r1, m.mergeAt(S, 7, 0)], [8, undefined]); m.unmerge(S, { r1: 8, c1: 0, r2: 9, c2: 2 }); eq('unmerge', m.merges(S).length, 0)
  // copy / paste with relative formula shift, and cut without
  m.setText(S, 12, 0, '10'); m.setText(S, 12, 1, '=A13*2'); const clip = m.copyRange(S, { r1: 12, c1: 0, r2: 12, c2: 1 }); m.paste(S, 14, 0, clip)
  eq('paste shifts relative refs', [m.raw(S, 14, 0), m.raw(S, 14, 1), m.value(S, 14, 1)], ['10', '=A15*2', 20])
  const cut = m.copyRange(S, { r1: 14, c1: 0, r2: 14, c2: 1 }, true); m.paste(S, 16, 0, cut); eq('cut keeps refs & clears source', [m.raw(S, 16, 1), m.raw(S, 14, 0)], ['=A15*2', undefined])
  m.pasteText(S, 20, 0, 'a\tb\n1\t=1+1\n"x\ty"\t3'); eq('paste TSV', [m.raw(S, 20, 1), m.value(S, 21, 1), m.raw(S, 22, 0)], ['b', 2, 'x\ty']); eq('copy as TSV', m.textOf(S, { r1: 20, c1: 0, r2: 21, c2: 1 }), 'a\tb\n1\t2')
}
{ // multiple tabs, cross-sheet refs, rename / delete
  const { m } = mk(); const S1 = 'sheet1'; const S2 = m.addTab('Sales')
  m.setText(S2, 0, 0, '40'); m.setText(S2, 1, 0, '2'); m.setText(S1, 0, 0, '=Sales!A1*Sales!A2'); eq('cross-sheet', m.value(S1, 0, 0), 80)
  m.renameTab(S2, 'Revenue 24'); eq('rename rewrites formulas', m.raw(S1, 0, 0), "='Revenue 24'!A1*'Revenue 24'!A2"); eq('still computes', m.value(S1, 0, 0), 80)
  m.insertRows(S2, 0, 1); eq('structure change on other sheet adjusts formulas here', m.raw(S1, 0, 0), "='Revenue 24'!A2*'Revenue 24'!A3")
  eq('tab list', m.tabList().map((t) => t.name), ['Sheet1', 'Revenue 24']); eq('duplicate name rejected', (m.renameTab(S2, 'sheet1'), m.tabList()[1].name), 'Revenue 24')
  const dup = m.duplicateTab(S2)!; eq('duplicate tab copies', [m.tabList().length, m.value(dup, 1, 0)], [3, 40]); m.moveTab(dup, 0); eq('move tab', m.tabList()[0].id, dup)
  m.deleteTab(S2); eq('delete tab -> #REF!', m.display(S1, 0, 0).text, '#REF!'); eq('cannot delete last tab', (m.deleteTab(S1), m.deleteTab(dup)), false)
}
{ // collaboration: two clients, concurrent edits converge
  const a = mk(), b = (() => { const d = new Y.Doc(); const m = new SheetModel(d); return { d, m } })()
  const sync = () => { Y.applyUpdate(b.d, Y.encodeStateAsUpdate(a.d)); Y.applyUpdate(a.d, Y.encodeStateAsUpdate(b.d)) }
  sync(); b.m.ensureDefaultTab(); sync()
  eq('single default tab after both initialise', a.m.tabList().length, 1)
  a.m.setText('sheet1', 0, 0, '5'); b.m.setText('sheet1', 1, 0, '7'); sync(); a.m.setText('sheet1', 2, 0, '=A1+A2'); sync()
  eq('A sees B edit', a.m.value('sheet1', 1, 0), 7); eq('B sees formula computed', b.m.value('sheet1', 2, 0), 12)
  a.m.setText('sheet1', 0, 0, '50'); sync(); eq('B recalculates after A changes precedent', b.m.value('sheet1', 2, 0), 57)
  a.m.setText('sheet1', 5, 5, 'x'); b.m.setText('sheet1', 5, 5, 'y'); sync(); eq('concurrent same-cell converges', a.m.raw('sheet1', 5, 5), b.m.raw('sheet1', 5, 5))
  // undo only reverts the local user's own changes
  b.m.setText('sheet1', 9, 0, 'mine'); sync(); a.m.setText('sheet1', 8, 0, 'theirs'); sync(); b.m.undo(); sync()
  eq("undo is per-user", [b.m.raw('sheet1', 9, 0), b.m.raw('sheet1', 8, 0)], [undefined, 'theirs'])
}
{ // version restore
  const { d, m } = mk(); const S = 'sheet1'
  m.setText(S, 0, 0, 'original'); m.addTab('Extra'); const snap = new Y.Doc(); Y.applyUpdate(snap, Y.encodeStateAsUpdate(d))
  m.setText(S, 0, 0, 'changed'); m.setText(S, 1, 0, 'added'); m.deleteTab(m.tabList()[1].id)
  m.restoreFrom(snap); eq('restore content', [m.raw(S, 0, 0), m.raw(S, 1, 0)], ['original', undefined]); eq('restore tabs', m.tabList().map((t) => t.name), ['Sheet1', 'Extra'])
}
{ // charts
  const { m } = mk(); const id = m.addChart('sheet1', { type: 'column', range: 'A1:B5', title: 'T', x: 10, y: 10, w: 300, h: 200, headers: true }); eq('chart add', m.charts('sheet1').length, 1)
  m.updateChart('sheet1', id, { title: 'New' }); eq('chart update', m.charts('sheet1')[0].title, 'New'); m.removeChart('sheet1', id); eq('chart remove', m.charts('sheet1').length, 0)
}
console.log(`${pass} passed, ${fail} failed`)

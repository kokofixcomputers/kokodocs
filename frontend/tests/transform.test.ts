import { shiftFormula, adjustForStructure, renameSheetInFormula } from '../src/sheet/engine/transform'
import { extendSeries } from '../src/sheet/engine/autofill'
let pass = 0, fail = 0
const eq = (name: string, got: unknown, exp: unknown) => { if (JSON.stringify(got) === JSON.stringify(exp)) pass++; else { fail++; console.log(`FAIL ${name}: ${JSON.stringify(got)} != ${JSON.stringify(exp)}`) } }
// copy/paste & fill shifting
eq('shift down', shiftFormula('=A1+B1', 1, 0), '=A2+B2')
eq('shift right', shiftFormula('=A1+B1', 0, 2), '=C1+D1')
eq('abs col', shiftFormula('=$A1+B$1', 2, 2), '=$A3+D$1')
eq('abs both', shiftFormula('=$A$1*2', 5, 5), '=$A$1*2')
eq('range', shiftFormula('=SUM(A1:A4)', 0, 1), '=SUM(B1:B4)')
eq('sheet ref', shiftFormula("=Data!A1+'My Sheet'!B2", 1, 0), "=Data!A2+'My Sheet'!B3")
eq('string untouched', shiftFormula('=A1&"B2"', 1, 0), '=A2&"B2"')
eq('whole col stays', shiftFormula('=SUM(A:A)', 0, 1), '=SUM(B:B)')
eq('off sheet -> #REF!', shiftFormula('=A1', -1, 0), '=#REF!')
eq('fn names not refs', shiftFormula('=LOG10(A1)+ATAN2(B1,1)', 1, 0), '=LOG10(A2)+ATAN2(B2,1)')
// insert / delete rows & cols
const sid = (n: string) => ({ data: 's2' } as Record<string, string>)[n.toLowerCase()]
const adj = (f: string, axis: 'row' | 'col', at: number, n: number, fs = 's1') => adjustForStructure(f, fs, 's1', sid, axis, at, n)
eq('insert row above ref', adj('=A5', 'row', 2, 1), '=A6'); eq('insert row below ref', adj('=A2', 'row', 4, 1), '=A2'); eq('insert expands range', adj('=SUM(A1:A5)', 'row', 2, 2), '=SUM(A1:A7)')
eq('insert col', adj('=C1', 'col', 0, 1), '=D1'); eq('abs preserved', adj('=$B$3', 'row', 0, 1), '=$B$4')
eq('delete row before', adj('=A5', 'row', 1, -2), '=A3'); eq('delete the row -> REF', adj('=A3', 'row', 2, -1), '=#REF!'); eq('delete shrinks range', adj('=SUM(A1:A5)', 'row', 2, -2), '=SUM(A1:A3)')
eq('delete range start', adj('=SUM(A2:A5)', 'row', 1, -2), '=SUM(A2:A3)'); eq('delete whole range -> REF', adj('=SUM(A2:A3)', 'row', 1, -2), '=SUM(#REF!)')
eq('whole column untouched by row ops', adj('=SUM(A:A)', 'row', 0, 5), '=SUM(A:A)'); eq('other sheet untouched', adjustForStructure('=Data!A5', 's1', 's1', sid, 'row', 0, 1), '=Data!A5')
eq('formula on other sheet pointing here', adjustForStructure("=Sheet1!A5", 's2', 's1', (n) => (n.toLowerCase() === 'sheet1' ? 's1' : undefined), 'row', 0, 1), '=Sheet1!A6')
eq('rename sheet', renameSheetInFormula('=Data!A1+Data!B2', 'Data', 'Sales 2024'), "='Sales 2024'!A1+'Sales 2024'!B2"); eq('delete sheet', renameSheetInFormula('=Data!A1+B1', 'Data', undefined), '=#REF!+B1')
// autofill series
eq('1,2,3 -> 4,5,6', extendSeries(['1', '2', '3'], 3), ['4', '5', '6']); eq('10,20 -> 30', extendSeries(['10', '20'], 2), ['30', '40']); eq('single number copies', extendSeries(['7'], 3), ['7', '7', '7'])
eq('Item 1', extendSeries(['Item 1'], 3), ['Item 2', 'Item 3', 'Item 4']); eq('Q1,Q2', extendSeries(['Q1', 'Q2'], 2), ['Q3', 'Q4']); eq('zero pad', extendSeries(['007'], 2), ['008', '009'])
eq('Mon -> Tue', extendSeries(['Mon'], 3), ['Tue', 'Wed', 'Thu']); eq('Jan wraps', extendSeries(['Nov', 'Dec'], 2), ['Jan', 'Feb']); eq('January', extendSeries(['January'], 2), ['February', 'March'])
eq('dates', extendSeries(['2024-01-30'], 3), ['2024-01-31', '2024-02-01', '2024-02-02']); eq('date step 7', extendSeries(['2024-01-01', '2024-01-08'], 2), ['2024-01-15', '2024-01-22'])
eq('text cycles', extendSeries(['a', 'b'], 5), ['a', 'b', 'a', 'b', 'a']); eq('backward numbers', extendSeries(['4', '5'], 3, true), ['3', '2', '1']); eq('decimals', extendSeries(['0.1', '0.2'], 2), ['0.3', '0.4'])
console.log(`${pass} passed, ${fail} failed`)

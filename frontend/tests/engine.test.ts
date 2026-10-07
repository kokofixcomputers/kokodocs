import { Engine, type DataSource } from '../src/sheet/engine/engine'
import { addr, parseAddr } from '../src/sheet/engine/refs'
import { CellError } from '../src/sheet/engine/values'
import { formatNumber } from '../src/sheet/engine/format'

const sheets: Record<string, Map<string, string>> = { s1: new Map(), s2: new Map() }
const names: Record<string, string> = { sheet1: 's1', data: 's2', 'my sheet': 's2' }
const put = (sh: string, a: string, raw: string) => { const p = parseAddr(a)!; sheets[sh].set(`${p.r},${p.c}`, raw) }
const ds: DataSource = {
  raw: (s, r, c) => sheets[s].get(`${r},${c}`),
  extent: (s) => { let rows = 0, cols = 0; for (const k of sheets[s].keys()) { const [r, c] = k.split(',').map(Number); rows = Math.max(rows, r + 1); cols = Math.max(cols, c + 1) } return { rows, cols } },
  sheetId: (n) => names[n.toLowerCase()], sheetIds: () => Object.keys(sheets),
  *formulaCells(s) { for (const [k, v] of sheets[s]) if (v.startsWith('=')) { const [r, c] = k.split(',').map(Number); yield [r, c, v] } },
}
const ev = new Engine(ds)

// data
const col = (a: string, vals: (string | number)[]) => vals.forEach((v, i) => put('s1', `${a}${i + 1}`, String(v)))
col('A', [10, 20, 30, 40]); col('B', [1, 2, 3, 4]); col('C', ['apple', 'banana', 'cherry', 'apple'])
put('s1', 'D1', 'Name'); put('s1', 'D2', 'Ann'); put('s1', 'D3', 'Bob'); put('s1', 'E1', 'Score'); put('s1', 'E2', '90'); put('s1', 'E3', '75')
put('s2', 'A1', '5'); put('s2', 'A2', '7')

let pass = 0, fail = 0
const t = (formula: string, expected: unknown, nf?: string) => {
  put('s1', 'Z1', formula); ev.invalidate()
  const got = ev.value('s1', 0, 25)
  const shown = got instanceof CellError ? got.code : got
  const ok = typeof expected === 'number' && typeof shown === 'number' ? Math.abs(shown - expected) < 1e-9 * Math.max(1, Math.abs(expected)) : shown === expected
  if (ok) pass++; else { fail++; console.log(`FAIL ${formula}  =>  ${JSON.stringify(shown)}   (expected ${JSON.stringify(expected)})`) }
}

// the user's example: add row1col1 and row2col1 into row3col1
put('s1', 'G1', '5'); put('s1', 'G2', '7'); put('s1', 'G3', '=G1+G2'); ev.invalidate()
t('=G3', 12)
// arithmetic + precedence
t('=1+2*3', 7); t('=(1+2)*3', 9); t('=2^3^2', 64); t('=-2^2', 4); t('=10/4', 2.5); t('=10%', 0.1); t('=50%*200', 100); t('=2*-3', -6)
t('=1/0', '#DIV/0!'); t('="a"+1', '#VALUE!'); t('="5"+1', 6); t('=TRUE+1', 2)
t('="Hello "&"World"', 'Hello World'); t('=1&2', '12'); t('=A1&"-"&B1', '10-1')
// comparisons
t('=1<2', true); t('=2<=1', false); t('="a"="A"', true); t('=1<>2', true); t('="b">"a"', true)
// refs, ranges, absolute
t('=A1+A2', 30); t('=SUM(A1:A4)', 100); t('=$A$1+B$2', 12); t('=SUM(A:A)', 100); t('=SUM(A1:B4)', 110); t('=AVERAGE(A1:A4)', 25)
t('=MAX(A1:A4)', 40); t('=MIN(B1:B4)', 1); t('=COUNT(A1:A4)', 4); t('=COUNTA(C1:C4)', 4); t('=PRODUCT(B1:B4)', 24)
t('=SUM(A1:A2,B1:B2,100)', 133); t('=SUM(1,2,3)', 6)
// cross-sheet
t('=Data!A1+Data!A2', 12); t("='My Sheet'!A1*2", 10); t('=SUM(Data!A1:A2)', 12); t('=Nope!A1', '#REF!')
// conditional
t('=IF(A1>5,"big","small")', 'big'); t('=IF(A1>50,"big","small")', 'small'); t('=IF(1,2)', 2); t('=IF(0,2)', false)
t('=IFERROR(1/0,"oops")', 'oops'); t('=IFERROR(5,"oops")', 5); t('=IFS(A1>50,"a",A1>5,"b")', 'b'); t('=SWITCH(2,1,"one",2,"two","other")', 'two'); t('=CHOOSE(2,"a","b","c")', 'b')
t('=AND(1,1,TRUE)', true); t('=OR(0,0,1)', true); t('=NOT(TRUE)', false)
// conditional aggregates
t('=SUMIF(C1:C4,"apple",A1:A4)', 50); t('=COUNTIF(A1:A4,">15")', 3); t('=COUNTIF(C1:C4,"a*")', 2); t('=AVERAGEIF(A1:A4,">=20")', 30)
t('=SUMIFS(A1:A4,C1:C4,"apple",B1:B4,">1")', 40); t('=COUNTIFS(A1:A4,">10",B1:B4,"<4")', 2)
t('=SUMPRODUCT(A1:A4,B1:B4)', 300); t('=SUMPRODUCT((A1:A4>15)*(B1:B4))', 9); t('=SUMPRODUCT(--(C1:C4="apple"))', 2)
// lookup
t('=VLOOKUP("Bob",D2:E3,2,FALSE)', 75); t('=INDEX(A1:A4,3)', 30); t('=MATCH(30,A1:A4,0)', 3); t('=INDEX(A1:B4,2,2)', 2); t('=INDEX(A1:A4,MATCH(40,A1:A4,0))', 40)
t('=XLOOKUP("Bob",D2:D3,E2:E3)', 75); t('=XLOOKUP("Zed",D2:D3,E2:E3,"none")', 'none'); t('=HLOOKUP("Score",D1:E3,2,FALSE)', 90)
// text
t('=LEN("hello")', 5); t('=UPPER("abc")', 'ABC'); t('=LEFT("hello",2)', 'he'); t('=RIGHT("hello",3)', 'llo'); t('=MID("hello",2,3)', 'ell'); t('=TRIM("  a  b ")', 'a b')
t('=SUBSTITUTE("a-b-c","-","+")', 'a+b+c'); t('=CONCATENATE("a","b")', 'ab'); t('=TEXTJOIN(", ",TRUE,C1:C3)', 'apple, banana, cherry'); t('=FIND("l","hello")', 3); t('=REPT("ab",3)', 'ababab')
t('=PROPER("hello world")', 'Hello World'); t('=VALUE("12.5")', 12.5); t('=TEXT(1234.5,"#,##0.00")', '1,234.50'); t('=TEXT(0.256,"0.0%")', '25.6%'); t('=LEN(A1:A3)', 2)
// math
t('=ROUND(2.567,2)', 2.57); t('=ROUNDUP(2.1,0)', 3); t('=INT(-2.5)', -3); t('=MOD(10,3)', 1); t('=ABS(-4)', 4); t('=SQRT(16)', 4); t('=POWER(2,10)', 1024); t('=PI()', Math.PI)
t('=CEILING(2.1,1)', 3); t('=FLOOR(2.9,1)', 2); t('=MEDIAN(A1:A4)', 25); t('=LARGE(A1:A4,2)', 30); t('=SMALL(A1:A4,2)', 20); t('=STDEV(A1:A4)', 12.909944487358056); t('=RANK(30,A1:A4)', 2)
t('=COUNTBLANK(A1:A5)', 1); t('=SUMSQ(1,2,3)', 14); t('=FACT(5)', 120); t('=GCD(12,18)', 6); t('=LN(EXP(2))', 2); t('=ISNUMBER(A1)', true); t('=ISBLANK(Q9)', true)
// dates (Excel serial numbers: 2024-01-15 = 45306)
t('=DATE(2024,1,15)', 45306); t('=YEAR(45306)', 2024); t('=MONTH(45306)', 1); t('=DAY(45306)', 15); t('=DATE(2024,1,15)+30', 45336); t('=EOMONTH(DATE(2024,1,15),0)', 45322)
t('=WEEKDAY(DATE(2024,1,15))', 2); t('=DATEDIF(DATE(2024,1,1),DATE(2024,3,1),"M")', 2); t('=NETWORKDAYS(DATE(2024,1,1),DATE(2024,1,31))', 23)
// finance
t('=PMT(0.05/12,360,200000)', -1073.6432460242797); t('=FV(0.05,10,-100)', 1257.789253554883); t('=NPV(0.1,100,100)', 173.55371900826447)
// arrays / dynamic
t('=SUM(SEQUENCE(4))', 10); t('=SUM(FILTER(A1:A4,A1:A4>15))', 90); t('=ROWS(A1:A4)', 4); t('=COLUMNS(A1:B4)', 2); t('=ROW(A5)', 5); t('=COLUMN(C1)', 3); t('=MAX(IF(C1:C4="apple",A1:A4))', 40)
t('=SUM(--(A1:A4>15))', 3); t('=INDEX(SORT(A1:A4,1,-1),1)', 40); t('=COUNTA(UNIQUE(C1:C4))', 3); t('=LET(x,5,y,x*2,x+y)', 15); t('=SUM({1,2,3})', 6)
t('=INDIRECT("A2")', 20); t('=INDIRECT("Data!A1")', 5); t('=SUM(INDIRECT("A1:A3"))', 60); t('=OFFSET(A1,2,0)', 30)
// errors propagate
t('=SUM(A1,1/0)', '#DIV/0!'); t('=NOSUCHFN(1)', '#NAME?'); t('=A1+', '#ERROR!'); t('=ISERROR(1/0)', true); t('=IFNA(NA(),"x")', 'x')
t('=Z1', '#CIRC!')

// circular reference between two cells
put('s1', 'H1', '=H2+1'); put('s1', 'H2', '=H1+1'); ev.invalidate()
const circ = ev.value('s1', 0, 7); console.log(circ instanceof CellError && circ.code === '#CIRC!' ? 'PASS circular reference detected' : 'FAIL circular -> ' + String(circ)); circ instanceof CellError ? pass++ : fail++

// spill: FILTER result flows into the cells below
put('s1', 'J1', '=FILTER(A1:A4,A1:A4>15)'); ev.invalidate()
const spilled = [0, 1, 2].map((r) => ev.value('s1', r, 9)); console.log(JSON.stringify(spilled) === '[20,30,40]' ? 'PASS spill FILTER -> J1:J3' : 'FAIL spill ' + JSON.stringify(spilled)); JSON.stringify(spilled) === '[20,30,40]' ? pass++ : fail++
put('s1', 'J2', 'blocker'); ev.invalidate(); const blocked = ev.value('s1', 0, 9); console.log(blocked instanceof CellError && blocked.code === '#SPILL!' ? 'PASS blocked spill -> #SPILL!' : 'FAIL ' + String(blocked)); blocked instanceof CellError ? pass++ : fail++
sheets.s1.delete('1,9')

// live recalculation: change a precedent, dependants update after invalidate
put('s1', 'G1', '100'); ev.invalidate(); console.log(ev.value('s1', 2, 6) === 107 ? 'PASS recalculation G3 = G1+G2 -> 107' : 'FAIL recalc'); ev.value('s1', 2, 6) === 107 ? pass++ : fail++

// number formats
const nf = (n: number, code: string, exp: string) => { const g = formatNumber(n, code); if (g === exp) pass++; else { fail++; console.log(`FAIL format ${n} "${code}" => "${g}" (expected "${exp}")`) } }
nf(1234.5, '#,##0.00', '1,234.50'); nf(0.256, '0.0%', '25.6%'); nf(-1234.5, '$#,##0.00', '-$1,234.50'); nf(-5, '$#,##0.00;($#,##0.00)', '($5.00)'); nf(1234567, '#,##0', '1,234,567'); nf(5, '0000', '0005')
nf(0.000123, '0.00E+00', '1.23E-04'); nf(45306, 'yyyy-mm-dd', '2024-01-15'); nf(45306, 'mmmm d, yyyy', 'January 15, 2024'); nf(45306.5, 'h:mm AM/PM', '12:00 PM'); nf(45306, 'ddd', 'Mon'); nf(45306.75, 'yyyy-mm-dd h:mm', '2024-01-15 18:00')
nf(3.14159, 'General', '3.14159'); nf(1e12, "General", "1E+12"); nf(1234.5, '0', '1235'); nf(0.5, '0%', '50%'); nf(12, '"Qty: "0', 'Qty: 12'); nf(1234.5678, '#,##0.0', '1,234.6')
// criteria edge cases
t('=COUNTIF(A1:A4,">=20")', 3); t('=COUNTIF(A1:A4,20)', 1); t('=COUNTIF(C1:C4,"<>apple")', 2); t('=COUNTIF(C1:C4,"?pple")', 2); t('=COUNTIF(C1:C4,"APPLE")', 2); t('=COUNTIF(A1:A6,"")', 2); t('=SUMIF(A1:A4,">25")', 70); t('=SUMIF(C1:C4,"apple",B1:B4)', 5)
t('=MAXIFS(A1:A4,C1:C4,"apple")', 40); t('=AVERAGEIFS(A1:A4,C1:C4,"apple")', 25)
console.log(`\n${pass} passed, ${fail} failed`)

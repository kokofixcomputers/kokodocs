export class CellError {
  constructor(public code: string) {}
  toString() { return this.code }
}
export const E = {
  DIV0: new CellError('#DIV/0!'), VALUE: new CellError('#VALUE!'), REF: new CellError('#REF!'), NAME: new CellError('#NAME?'),
  NUM: new CellError('#NUM!'), NA: new CellError('#N/A'), CIRC: new CellError('#CIRC!'), SPILL: new CellError('#SPILL!'),
  ERROR: new CellError('#ERROR!'), NULL: new CellError('#NULL!'),
}
const BY_CODE = new Map(Object.values(E).map((e) => [e.code, e]))
export const errorFromCode = (c: string) => BY_CODE.get(c.toUpperCase()) ?? E.ERROR

export type Scalar = number | string | boolean | null | CellError
export type Value = Scalar | Scalar[][]
export const isArr = (v: unknown): v is Scalar[][] => Array.isArray(v)

const EPOCH = Date.UTC(1899, 11, 30)
export const serialToDate = (n: number) => new Date(EPOCH + Math.round(n * 86400000))
/** Excel serial from a JS Date, using its local wall-clock fields (so TODAY() shows the user's date). */
export const dateToSerial = (d: Date) => (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) - EPOCH) / 86400000
export const ymdToSerial = (y: number, m: number, d: number) => (Date.UTC(y, m - 1, d) - EPOCH) / 86400000

const NUM_RE = /^[-+]?[$€£]?\s*(?:\d{1,3}(?:,\d{3})+|\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?\s*%?$/
/** "1,234.5", "$12", "12%", "(5)" -> number. null when the text is not numeric. */
export function parseNumberString(raw: string): number | null {
  let s = raw.trim()
  if (!s) return null
  let neg = false
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim() }
  if (!NUM_RE.test(s) || !/\d/.test(s)) return null
  const pct = s.endsWith('%')
  const n = Number(s.replace(/[$€£,%\s]/g, ''))
  if (Number.isNaN(n)) return null
  return (neg ? -n : n) / (pct ? 100 : 1)
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
export function parseDateString(s: string): number | null {
  s = s.trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s)
  if (m) return valid(+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0))
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s)
  if (m) return valid(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[1], +m[2], 0, 0, 0)
  m = /^(\d{1,2})[- ]([A-Za-z]{3})[a-z]*[- ,]+(\d{4})$/.exec(s)
  if (m && MONTHS.includes(m[2].toLowerCase())) return valid(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1], 0, 0, 0)
  m = /^([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{4})$/.exec(s)
  if (m && MONTHS.includes(m[1].toLowerCase())) return valid(+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2], 0, 0, 0)
  return null
}
function valid(y: number, mo: number, d: number, h: number, mi: number, se: number): number | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) return null
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCMonth() !== mo - 1) return null
  return ymdToSerial(y, mo, d) + (h * 3600 + mi * 60 + se) / 86400
}

/** Raw cell text (not starting with "=") -> typed value. */
export function parseConstant(raw: string): Scalar {
  if (raw === '') return null
  if (raw.startsWith("'")) return raw.slice(1)
  const t = raw.trim()
  if (/^(true|false)$/i.test(t)) return t.toUpperCase() === 'TRUE'
  if (/^#(NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|CIRC!|SPILL!|ERROR!)$/i.test(t)) return errorFromCode(t)
  const n = parseNumberString(raw)
  if (n !== null) return n
  const d = parseDateString(raw)
  if (d !== null) return d
  return raw
}

export function toNumber(v: Scalar): number {
  if (v instanceof CellError) throw v
  if (v === null) return 0
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  const n = parseNumberString(v) ?? parseDateString(v)
  if (n === null) throw E.VALUE
  return n
}
export function toText(v: Scalar): string {
  if (v instanceof CellError) throw v
  if (v === null) return ''
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'number') return numToText(v)
  return v
}
export function toBool(v: Scalar): boolean {
  if (v instanceof CellError) throw v
  if (v === null) return false
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (/^true$/i.test(v)) return true
  if (/^false$/i.test(v)) return false
  const n = parseNumberString(v)
  if (n !== null) return n !== 0
  throw E.VALUE
}
export function numToText(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? '#NUM!' : '#NUM!'
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n)
  const s = String(Number(n.toPrecision(15)))
  return s
}

/** Excel's ordering: numbers < text < booleans; text compared case-insensitively. */
export function compareScalars(a: Scalar, b: Scalar): number {
  if (a instanceof CellError) throw a
  if (b instanceof CellError) throw b
  const rank = (v: Scalar) => (typeof v === 'number' ? 1 : typeof v === 'string' ? 2 : typeof v === 'boolean' ? 3 : 0)
  if (a === null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0
  if (b === null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0
  const ra = rank(a), rb = rank(b)
  if (ra !== rb) return ra - rb
  if (typeof a === 'string') { const x = a.toLowerCase(), y = (b as string).toLowerCase(); return x < y ? -1 : x > y ? 1 : 0 }
  return (a as number) < (b as number) ? -1 : (a as number) > (b as number) ? 1 : 0
}

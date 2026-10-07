import { CellError, serialToDate, type Scalar } from './values'

export const PRESETS: Record<string, { label: string; code: string; sample: string }> = {
  general: { label: 'Automatic', code: 'General', sample: '1234.5' },
  number: { label: 'Number', code: '#,##0.00', sample: '1,234.50' },
  integer: { label: 'Whole number', code: '0', sample: '1235' },
  currency: { label: 'Currency', code: '$#,##0.00', sample: '$1,234.50' },
  accounting: { label: 'Accounting', code: '$#,##0.00;($#,##0.00)', sample: '$1,234.50' },
  percent: { label: 'Percent', code: '0.00%', sample: '12.35%' },
  scientific: { label: 'Scientific', code: '0.00E+00', sample: '1.23E+03' },
  date: { label: 'Date', code: 'yyyy-mm-dd', sample: '2026-10-06' },
  datelong: { label: 'Long date', code: 'mmmm d, yyyy', sample: 'October 6, 2026' },
  time: { label: 'Time', code: 'h:mm AM/PM', sample: '3:45 PM' },
  datetime: { label: 'Date time', code: 'yyyy-mm-dd h:mm', sample: '2026-10-06 15:45' },
  text: { label: 'Plain text', code: '@', sample: 'Text' },
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function formatGeneral(n: number): string {
  if (!Number.isFinite(n)) return '#NUM!'
  if (n === 0) return '0'
  const a = Math.abs(n)
  if (a >= 1e11 || a < 1e-9) return n.toExponential(5).replace(/\.?0+e/, 'E').replace('e', 'E').replace(/E([+-])(\d)$/, 'E$10$2')
  if (Number.isInteger(n)) return String(n)
  return String(Number(n.toPrecision(10)))
}

/** Split a format code into sections on ';' outside quotes. */
function sections(code: string): string[] {
  const out: string[] = []; let cur = ''; let q = false
  for (const ch of code) {
    if (ch === '"') q = !q
    if (ch === ';' && !q) { out.push(cur); cur = '' } else cur += ch
  }
  out.push(cur)
  return out
}

const isDateCode = (code: string) => /(^|[^\\"])(?:[ymdhs]|AM\/PM|A\/P)/i.test(code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, ''))

function formatDate(n: number, code: string): string {
  const d = serialToDate(n)
  type T = { kind: 'lit' | 'y4' | 'y2' | 'mon' | 'min' | 'd' | 'h' | 's' | 'ampm'; text: string; len: number }
  const toks: T[] = []
  let i = 0
  const has12 = /AM\/PM|A\/P/i.test(code)
  while (i < code.length) {
    const rest = code.slice(i)
    let m: RegExpExecArray | null
    if (code[i] === '"') { const j = code.indexOf('"', i + 1); const end = j < 0 ? code.length : j; toks.push({ kind: 'lit', text: code.slice(i + 1, end), len: 0 }); i = end + 1; continue }
    if (code[i] === '\\') { toks.push({ kind: 'lit', text: code[i + 1] ?? '', len: 0 }); i += 2; continue }
    if (code[i] === '[') { const j = code.indexOf(']', i); i = j < 0 ? code.length : j + 1; continue }
    if ((m = /^AM\/PM|^A\/P/i.exec(rest))) { toks.push({ kind: 'ampm', text: m[0], len: 0 }); i += m[0].length; continue }
    if ((m = /^y+/i.exec(rest))) { toks.push({ kind: m[0].length > 2 ? 'y4' : 'y2', text: m[0], len: m[0].length }); i += m[0].length; continue }
    if ((m = /^m+/i.exec(rest))) { toks.push({ kind: 'mon', text: m[0], len: m[0].length }); i += m[0].length; continue }
    if ((m = /^d+/i.exec(rest))) { toks.push({ kind: 'd', text: m[0], len: m[0].length }); i += m[0].length; continue }
    if ((m = /^h+/i.exec(rest))) { toks.push({ kind: 'h', text: m[0], len: m[0].length }); i += m[0].length; continue }
    if ((m = /^s+/i.exec(rest))) { toks.push({ kind: 's', text: m[0], len: m[0].length }); i += m[0].length; continue }
    toks.push({ kind: 'lit', text: code[i], len: 0 }); i++
  }
  // "m" right after hours or right before seconds means minutes
  toks.forEach((t, k) => {
    if (t.kind !== 'mon') return
    const prev = [...toks.slice(0, k)].reverse().find((x) => x.kind !== 'lit')
    const nxt = toks.slice(k + 1).find((x) => x.kind !== 'lit')
    if (prev?.kind === 'h' || nxt?.kind === 's') t.kind = 'min'
  })
  const p2 = (x: number) => String(x).padStart(2, '0')
  return toks.map((t) => {
    switch (t.kind) {
      case 'lit': return t.text
      case 'y4': return String(d.getUTCFullYear())
      case 'y2': return p2(d.getUTCFullYear() % 100)
      case 'mon': return t.len >= 4 ? MONTH_NAMES[d.getUTCMonth()] : t.len === 3 ? MONTH_NAMES[d.getUTCMonth()].slice(0, 3) : t.len === 2 ? p2(d.getUTCMonth() + 1) : String(d.getUTCMonth() + 1)
      case 'min': return t.len >= 2 ? p2(d.getUTCMinutes()) : String(d.getUTCMinutes())
      case 'd': return t.len >= 4 ? DAY_NAMES[d.getUTCDay()] : t.len === 3 ? DAY_NAMES[d.getUTCDay()].slice(0, 3) : t.len === 2 ? p2(d.getUTCDate()) : String(d.getUTCDate())
      case 'h': { let h = d.getUTCHours(); if (has12) h = h % 12 || 12; return t.len >= 2 ? p2(h) : String(h) }
      case 's': return t.len >= 2 ? p2(d.getUTCSeconds()) : String(d.getUTCSeconds())
      case 'ampm': return /^a\/p/i.test(t.text) ? (d.getUTCHours() < 12 ? 'A' : 'P') : (d.getUTCHours() < 12 ? 'AM' : 'PM')
    }
  }).join('')
}

function formatNumeric(n: number, code: string): string {
  const cleaned = code.replace(/\[[^\]]*\]/g, '').replace(/_./g, '').replace(/\*./g, '')
  const m = /[#0?][#0?,.]*(?:E[+-]0+)?/.exec(cleaned.replace(/"[^"]*"/g, (q) => ' '.repeat(q.length)))
  const lit = (s: string) => s.replace(/"([^"]*)"/g, '$1').replace(/\\(.)/g, '$1')
  if (!m) return lit(cleaned)
  const before = lit(cleaned.slice(0, m.index)), after = lit(cleaned.slice(m.index + m[0].length))
  const pat = m[0]
  const pctCount = (cleaned.match(/%/g) ?? []).length
  let x = Math.abs(n) * Math.pow(100, Math.min(pctCount, 1))
  let body: string
  const sci = /E[+-]0+$/.exec(pat)
  if (sci) {
    const mant = pat.slice(0, sci.index)
    const dec = (mant.split('.')[1] ?? '').length
    const [mantissa, exp] = x.toExponential(dec).split('e')
    const e = Number(exp)
    body = `${mantissa}E${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(sci[0].length - 2, '0')}`
  } else {
    const [ip, dp = ''] = pat.split('.')
    const decimals = dp.replace(/,/g, '').length
    const required = (dp.match(/[0?]/g) ?? []).length
    x = Math.round((x + Number.EPSILON * Math.max(1, x)) * 10 ** decimals) / 10 ** decimals
    let [intStr, decStr = ''] = x.toFixed(decimals).split('.')
    while (decStr.length > required && decStr.endsWith('0')) decStr = decStr.slice(0, -1)
    const minInt = (ip.match(/0/g) ?? []).length
    intStr = intStr.replace(/^0+(?=\d)/, '')
    if (minInt === 0 && intStr === '0') intStr = ''
    intStr = intStr.padStart(minInt, '0')
    if (ip.includes(',')) intStr = intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    body = decStr ? `${intStr || '0'}.${decStr}` : intStr
    if (!body) body = '0'
  }
  return `${before}${body}${after}`
}

export function formatNumber(n: number, code: string): string {
  if (!code || code === 'General') return formatGeneral(n)
  if (code === '@') return formatGeneral(n)
  const secs = sections(code)
  let sec = secs[0], value = n
  if (n < 0 && secs.length > 1) { sec = secs[1]; value = -n }
  else if (n === 0 && secs.length > 2) sec = secs[2]
  if (isDateCode(sec)) return formatDate(value, sec)
  const out = formatNumeric(value, sec)
  return n < 0 && secs.length < 2 && Number(out.replace(/[^0-9.]/g, '')) !== 0 ? `-${out}` : out
}

export function formatValue(v: Scalar, code?: string): string {
  if (v === null) return ''
  if (v instanceof CellError) return v.code
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'string') return v
  return formatNumber(v, code ?? 'General')
}

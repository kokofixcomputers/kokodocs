import * as FJ from '@formulajs/formulajs'
import type { Ctx, Engine } from './engine'
import { formatNumber } from './format'
import type { Node } from './parser'
import { CellError, E, compareScalars, dateToSerial, errorFromCode, isArr, parseNumberString, toBool, toNumber, toText, type Scalar, type Value } from './values'

export type Fn = (args: Value[], ev: Engine, cx: Ctx) => Value
export type LazyFn = (args: Node[], ev: Engine, cx: Ctx) => Value

export const builtin = new Map<string, Fn>()
export const lazy = new Map<string, LazyFn>()

/** Functions that accept error arguments without propagating them. */
export const ERROR_AWARE = new Set(['ISERROR', 'ISERR', 'ISNA', 'ISBLANK', 'ISNUMBER', 'ISTEXT', 'ISLOGICAL', 'ISNONTEXT', 'COUNT', 'COUNTA', 'ERROR.TYPE', 'TYPE', 'IFERROR', 'IFNA', 'NA', 'SUMPRODUCT_', 'COUNTBLANK', 'ISREF', 'N', 'AGGREGATE'])
/** Scalar functions that apply element-wise when given a range / array. */
export const LIFT = new Set(['ABS', 'ROUND', 'ROUNDUP', 'ROUNDDOWN', 'INT', 'SQRT', 'LEN', 'UPPER', 'LOWER', 'PROPER', 'TRIM', 'LEFT', 'RIGHT', 'MID', 'VALUE',
  'TEXT', 'ISNUMBER', 'ISTEXT', 'ISBLANK', 'ISERROR', 'ISNA', 'YEAR', 'MONTH', 'DAY', 'HOUR', 'MINUTE', 'SECOND', 'WEEKDAY', 'SIGN', 'EXP', 'LN', 'LOG', 'LOG10', 'MOD',
  'POWER', 'FLOOR', 'CEILING', 'TRUNC', 'SUBSTITUTE', 'REPLACE', 'SEARCH', 'FIND', 'EXACT', 'NOT', 'CODE', 'CHAR', 'SIN', 'COS', 'TAN', 'ISEVEN', 'ISODD', 'ISLOGICAL', 'REPT', 'T', 'N'])

// ───────────── helpers ─────────────
const flat = (v: Value): Scalar[] => (isArr(v) ? v.flat() : [v])
const scalar = (v: Value): Scalar => (isArr(v) ? (v[0]?.[0] ?? null) : v)
const toFJ = (v: Value): unknown => {
  if (v instanceof CellError) return new Error(v.code)
  if (isArr(v)) return v.map((row) => row.map((x) => (x instanceof CellError ? new Error(x.code) : x)))
  return v
}
const fromFJ = (v: unknown, cx: Ctx): Value => {
  if (v instanceof Error) throw errorFromCode(v.message)
  if (v instanceof Date) { cx.flags.date = true; return dateToSerial(v) }
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw E.NUM; return v }
  if (v === undefined) return null
  if (Array.isArray(v)) {
    const rows = (Array.isArray(v[0]) ? v : (v as unknown[]).map((x) => [x])) as unknown[][]
    return rows.map((row) => row.map((x) => { const r = fromFJ(x, cx); return (isArr(r) ? (r[0]?.[0] ?? null) : r) as Scalar }))
  }
  return v as Scalar
}

function register(name: string, fn: (...a: never[]) => unknown) {
  builtin.set(name.toUpperCase(), (args, _ev, cx) => {
    try { return fromFJ((fn as (...x: unknown[]) => unknown)(...args.map(toFJ)), cx) }
    catch (e) { if (e instanceof CellError) throw e; throw E.VALUE }
  })
}
for (const [k, v] of Object.entries(FJ as unknown as Record<string, unknown>)) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(k)) continue
  if (typeof v === 'function') register(k, v as never)
  const props = typeof v === 'function' || (v && typeof v === 'object') ? v as Record<string, unknown> : null
  if (props) for (const [sk, sv] of Object.entries(props)) if (typeof sv === 'function' && /^[A-Z0-9]+$/.test(sk)) register(`${k}.${sk}`, sv as never)
}
if (builtin.has('STDEV.S')) builtin.set('STDEV', builtin.get('STDEV.S')!)
if (builtin.has('VAR.S')) builtin.set('VAR', builtin.get('VAR.S')!)
if (builtin.has('RANK.EQ')) builtin.set('RANK', builtin.get('RANK.EQ')!)
if (builtin.has('MODE.SNGL')) builtin.set('MODE', builtin.get('MODE.SNGL')!)

const def = (name: string, fn: Fn) => builtin.set(name, fn)
const defLazy = (name: string, fn: LazyFn) => lazy.set(name, fn)
const need = (args: unknown[], min: number, max = min) => { if (args.length < min || args.length > max) throw E.VALUE }

// ───────────── logic (lazy so unused branches are not evaluated) ─────────────
const evalS = (n: Node, ev: Engine, cx: Ctx) => ev.eval(n, cx)
defLazy('IF', (a, ev, cx) => {
  need(a, 2, 3)
  const c = evalS(a[0], ev, cx)
  if (isArr(c)) {
    const t = a[1] ? evalS(a[1], ev, cx) : true, f = a[2] ? evalS(a[2], ev, cx) : false
    return c.map((row, i) => row.map((x, j) => {
      const pick = toBool(x) ? t : f
      return isArr(pick) ? (pick[pick.length === 1 ? 0 : i]?.[pick[0].length === 1 ? 0 : j] ?? null) : pick
    }))
  }
  if (toBool(c)) return a[1].k === 'empty' ? 0 : evalS(a[1], ev, cx)
  return a[2] ? (a[2].k === 'empty' ? 0 : evalS(a[2], ev, cx)) : false
})
defLazy('IFS', (a, ev, cx) => {
  if (a.length < 2 || a.length % 2) throw E.NA
  for (let i = 0; i < a.length; i += 2) if (toBool(scalar(evalS(a[i], ev, cx)))) return evalS(a[i + 1], ev, cx)
  throw E.NA
})
defLazy('IFERROR', (a, ev, cx) => {
  need(a, 2)
  try { const v = evalS(a[0], ev, cx); if (!(v instanceof CellError)) return v } catch (e) { if (!(e instanceof CellError)) throw e }
  return evalS(a[1], ev, cx)
})
defLazy('IFNA', (a, ev, cx) => {
  need(a, 2)
  try { const v = evalS(a[0], ev, cx); if (!(v === E.NA || (v instanceof CellError && v.code === '#N/A'))) return v } catch (e) { if (!(e instanceof CellError && e.code === '#N/A')) throw e }
  return evalS(a[1], ev, cx)
})
defLazy('SWITCH', (a, ev, cx) => {
  if (a.length < 3) throw E.VALUE
  const x = scalar(evalS(a[0], ev, cx))
  const hasDefault = a.length % 2 === 0
  for (let i = 1; i + 1 < a.length + (hasDefault ? 0 : 1) && i + 1 < a.length; i += 2) if (compareScalars(x, scalar(evalS(a[i], ev, cx))) === 0) return evalS(a[i + 1], ev, cx)
  if (hasDefault) return evalS(a[a.length - 1], ev, cx)
  throw E.NA
})
defLazy('CHOOSE', (a, ev, cx) => {
  const i = Math.trunc(toNumber(scalar(evalS(a[0], ev, cx))))
  if (i < 1 || i >= a.length) throw E.VALUE
  return evalS(a[i], ev, cx)
})
defLazy('LET', (a, ev, cx) => {
  if (a.length < 3 || a.length % 2 === 0) throw E.VALUE
  const locals = new Map(cx.locals ?? [])
  const inner: Ctx = { ...cx, locals }
  for (let i = 0; i < a.length - 1; i += 2) {
    if (a[i].k !== 'name') throw E.NAME
    locals.set((a[i] as { name: string }).name.toUpperCase(), evalS(a[i + 1], ev, inner))
  }
  return evalS(a[a.length - 1], ev, inner)
})
defLazy('ARRAYFORMULA', (a, ev, cx) => evalS(a[0], ev, cx))
const refOf = (n: Node | undefined) => (n && n.k === 'ref' ? n.ref : null)
defLazy('ROW', (a, ev, cx) => { const r = refOf(a[0]); return r ? r.r1 + 1 : cx.r + 1 })
defLazy('COLUMN', (a, ev, cx) => { const r = refOf(a[0]); return r ? r.c1 + 1 : cx.c + 1 })
defLazy('ROWS', (a, ev, cx) => { const v = evalS(a[0], ev, cx); return isArr(v) ? v.length : 1 })
defLazy('COLUMNS', (a, ev, cx) => { const v = evalS(a[0], ev, cx); return isArr(v) ? v[0].length : 1 })
defLazy('INDIRECT', (a, ev, cx) => {
  const text = toText(scalar(evalS(a[0], ev, cx)))
  const m = /^(?:(?:'((?:[^']|'')+)'|([A-Za-z_][\w.]*))!)?(\$?[A-Za-z]{1,3}\$?\d+)(?::(\$?[A-Za-z]{1,3}\$?\d+))?$/.exec(text.trim())
  if (!m) throw E.REF
  const sheet = ev.sheetOf(m[1]?.replace(/''/g, "'") ?? m[2], cx)
  const p = (s: string) => { const x = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(s)!; let c = 0; for (const ch of x[1].toUpperCase()) c = c * 26 + ch.charCodeAt(0) - 64; return [Number(x[2]) - 1, c - 1] }
  const [r1, c1] = p(m[3])
  if (!m[4]) return ev.value(sheet, r1, c1)
  const [r2, c2] = p(m[4])
  return ev.range(sheet, Math.min(r1, r2), Math.min(c1, c2), Math.max(r1, r2), Math.max(c1, c2))
})
defLazy('OFFSET', (a, ev, cx) => {
  const ref = refOf(a[0]); if (!ref) throw E.REF
  const dr = toNumber(scalar(evalS(a[1], ev, cx))), dc = toNumber(scalar(evalS(a[2], ev, cx)))
  const h = a[3] && a[3].k !== 'empty' ? toNumber(scalar(evalS(a[3], ev, cx))) : ref.r2 - ref.r1 + 1
  const w = a[4] && a[4].k !== 'empty' ? toNumber(scalar(evalS(a[4], ev, cx))) : ref.c2 - ref.c1 + 1
  const r = ref.r1 + dr, c = ref.c1 + dc
  if (r < 0 || c < 0) throw E.REF
  const sheet = ev.sheetOf(ref.sheet, cx)
  return h === 1 && w === 1 ? ev.value(sheet, r, c) : ev.range(sheet, r, c, r + h - 1, c + w - 1)
})

// ───────────── logical / info (eager) ─────────────
const bools = (args: Value[]) => args.flatMap(flat).filter((x) => x !== null && typeof x !== 'string').map((x) => toBool(x))
def('AND', (a) => { const b = bools(a); if (!b.length) throw E.VALUE; return b.every(Boolean) })
def('OR', (a) => { const b = bools(a); if (!b.length) throw E.VALUE; return b.some(Boolean) })
def('XOR', (a) => bools(a).filter(Boolean).length % 2 === 1)
def('NOT', (a) => { need(a, 1); return !toBool(scalar(a[0])) })
def('TRUE', () => true)
def('FALSE', () => false)
def('NA', () => { throw E.NA })
def('ISBLANK', (a) => scalar(a[0]) === null)
def('ISERROR', (a) => scalar(a[0]) instanceof CellError)
def('ISERR', (a) => { const v = scalar(a[0]); return v instanceof CellError && v.code !== '#N/A' })
def('ISNA', (a) => { const v = scalar(a[0]); return v instanceof CellError && v.code === '#N/A' })
def('ISNUMBER', (a) => typeof scalar(a[0]) === 'number')
def('ISTEXT', (a) => typeof scalar(a[0]) === 'string')
def('ISNONTEXT', (a) => typeof scalar(a[0]) !== 'string')
def('ISLOGICAL', (a) => typeof scalar(a[0]) === 'boolean')
def('ISEVEN', (a) => Math.trunc(Math.abs(toNumber(scalar(a[0])))) % 2 === 0)
def('ISODD', (a) => Math.trunc(Math.abs(toNumber(scalar(a[0])))) % 2 === 1)
def('N', (a) => { const v = scalar(a[0]); return typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : 0 })
def('T', (a) => { const v = scalar(a[0]); return typeof v === 'string' ? v : '' })

// ───────────── text ─────────────
def('TEXT', (a) => {
  need(a, 2)
  const v = scalar(a[0]), code = toText(scalar(a[1]))
  if (typeof v === 'number') return formatNumber(v, code)
  if (typeof v === 'string') { const n = parseNumberString(v); return n === null ? v : formatNumber(n, code) }
  return toText(v)
})
def('TEXTJOIN', (a) => {
  if (a.length < 3) throw E.VALUE
  const delim = toText(scalar(a[0])), skip = toBool(scalar(a[1]))
  return a.slice(2).flatMap(flat).filter((x) => !(skip && (x === null || x === ''))).map((x) => toText(x)).join(delim)
})
def('CONCAT', (a) => a.flatMap(flat).map((x) => toText(x)).join(''))
def('TEXTSPLIT', (a) => {
  need(a, 2, 3)
  const text = toText(scalar(a[0])), cd = toText(scalar(a[1]))
  const rd = a[2] !== undefined && a[2] !== null && scalar(a[2]) !== null ? toText(scalar(a[2])) : null
  const rows = rd ? text.split(rd) : [text]
  return rows.map((r) => r.split(cd))
})
def('SPLIT', (a) => [toText(scalar(a[0])).split(toText(scalar(a[1])))])
def('REGEXMATCH', (a) => new RegExp(toText(scalar(a[1]))).test(toText(scalar(a[0]))))
def('REGEXEXTRACT', (a) => { const m = new RegExp(toText(scalar(a[1]))).exec(toText(scalar(a[0]))); if (!m) throw E.NA; return m[1] ?? m[0] })
def('REGEXREPLACE', (a) => toText(scalar(a[0])).replace(new RegExp(toText(scalar(a[1])), 'g'), toText(scalar(a[2]))))

// ───────────── lookup / arrays ─────────────
const matrix = (v: Value): Scalar[][] => (isArr(v) ? v : [[v]])
def('XLOOKUP', (a) => {
  if (a.length < 3) throw E.VALUE
  const key = scalar(a[0]), look = matrix(a[1]), ret = matrix(a[2])
  const vertical = look[0].length === 1
  const cells = vertical ? look.map((r) => r[0]) : look[0]
  const mode = a[5] === undefined ? 0 : toNumber(scalar(a[5]))
  let idx = -1
  const eq = (x: Scalar) => x !== null && !(x instanceof CellError) && (mode === 2 && typeof key === 'string' && typeof x === 'string'
    ? new RegExp('^' + key.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i').test(x) : compareScalars(x, key) === 0)
  const reverse = a[6] !== undefined && toNumber(scalar(a[6])) < 0
  const order = cells.map((_, i) => i)
  if (reverse) order.reverse()
  for (const i of order) if (eq(cells[i])) { idx = i; break }
  if (idx < 0 && (mode === -1 || mode === 1)) {
    let best = -1
    cells.forEach((x, i) => {
      if (x === null || typeof x !== typeof key) return
      const cmp = compareScalars(x, key)
      if ((mode === -1 && cmp < 0 && (best < 0 || compareScalars(x, cells[best]) > 0)) || (mode === 1 && cmp > 0 && (best < 0 || compareScalars(x, cells[best]) < 0))) best = i
    })
    idx = best
  }
  if (idx < 0) { if (a[3] !== undefined && a[3] !== null) return a[3]; throw E.NA }
  if (vertical) return ret.length === look.length ? (ret[idx].length === 1 ? ret[idx][0] : [ret[idx]]) : E.VALUE as unknown as Value
  return ret.length === 1 ? ret[0][idx] : ret.map((r) => [r[idx]])
})
def('FILTER', (a) => {
  need(a, 2, 3)
  const arr = matrix(a[0]), inc = matrix(a[1])
  const byRow = inc[0].length === 1 && arr.length === inc.length
  let out: Scalar[][]
  if (byRow) out = arr.filter((_, i) => toBool(inc[i][0]))
  else {
    const keep = inc[0].map((x) => toBool(x))
    out = arr.map((row) => row.filter((_, j) => keep[j]))
    if (!out[0]?.length) out = []
  }
  if (!out.length) { if (a[2] !== undefined) return a[2]; throw E.NA }
  return out
})
def('SEQUENCE', (a) => {
  const rows = Math.trunc(toNumber(scalar(a[0]))), cols = a[1] === undefined ? 1 : Math.trunc(toNumber(scalar(a[1])))
  const start = a[2] === undefined ? 1 : toNumber(scalar(a[2])), step = a[3] === undefined ? 1 : toNumber(scalar(a[3]))
  if (rows < 1 || cols < 1 || rows * cols > 1e6) throw E.VALUE
  return Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => start + (i * cols + j) * step))
})
def('SORT', (a) => {
  const arr = matrix(a[0]), col = a[1] === undefined ? 0 : Math.trunc(toNumber(scalar(a[1]))) - 1
  const asc = a[2] === undefined ? true : (typeof scalar(a[2]) === 'boolean' ? scalar(a[2]) === true : toNumber(scalar(a[2])) >= 0)
  const out = arr.map((r) => r.slice())
  out.sort((x, y) => (asc ? 1 : -1) * compareScalars(x[col] ?? null, y[col] ?? null))
  return out
})
def('SORTBY', (a) => {
  const arr = matrix(a[0]), by = matrix(a[1]).map((r) => r[0]), asc = a[2] === undefined ? true : toNumber(scalar(a[2])) >= 0
  return arr.map((r, i) => ({ r, k: by[i] })).sort((x, y) => (asc ? 1 : -1) * compareScalars(x.k, y.k)).map((x) => x.r)
})
def('UNIQUE', (a) => {
  const arr = matrix(a[0]), seen = new Set<string>(), out: Scalar[][] = []
  for (const row of arr) { const k = JSON.stringify(row.map((x) => (typeof x === 'string' ? x.toLowerCase() : x))); if (!seen.has(k)) { seen.add(k); out.push(row) } }
  return out
})
def('TRANSPOSE', (a) => { const m = matrix(a[0]); return m[0].map((_, j) => m.map((r) => r[j])) })
def('SUMPRODUCT', (a) => {
  const mats = a.map(matrix)
  const n = mats[0].length * mats[0][0].length
  if (mats.some((m) => m.length * m[0].length !== n)) throw E.VALUE
  let s = 0
  for (let i = 0; i < n; i++) { let p = 1; for (const m of mats) { const x = m.flat()[i]; p *= typeof x === 'number' ? x : typeof x === 'boolean' ? (x ? 1 : 0) : 0 } s += p }
  return s
})
def('MMULT', (a) => {
  const A = matrix(a[0]), B = matrix(a[1])
  if (A[0].length !== B.length) throw E.VALUE
  return A.map((r) => B[0].map((_, j) => r.reduce<number>((s, x, k) => s + toNumber(x) * toNumber(B[k][j]), 0)))
})
def('RANDARRAY', (a) => {
  const rows = a[0] === undefined ? 1 : Math.trunc(toNumber(scalar(a[0]))), cols = a[1] === undefined ? 1 : Math.trunc(toNumber(scalar(a[1])))
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => Math.random()))
})

// ───────────── conditional aggregates with real Excel criteria semantics ─────────────
export function makeCriteria(c: Scalar): (x: Scalar) => boolean {
  if (c instanceof CellError) throw c
  const numEq = (n: number) => (x: Scalar) => (typeof x === 'number' ? x === n : typeof x === 'string' && parseNumberString(x) === n)
  if (typeof c === 'number') return numEq(c)
  if (typeof c === 'boolean') return (x) => x === c
  if (c === null) return (x) => x === null || x === ''
  const m = /^(<=|>=|<>|=|<|>)?([\s\S]*)$/.exec(c)!
  const op = m[1] ?? '=', rest = m[2]
  const n = rest.trim() === '' ? null : parseNumberString(rest)
  const wild = /[*?~]/.test(rest)
  const rx = wild ? new RegExp('^' + rest.replace(/~([*?~])|[.+^${}()|[\]\\]|([*?])/g, (_, esc, w) => (esc ? '\\' + esc : w === '*' ? '[\\s\\S]*' : w === '?' ? '[\\s\\S]' : '\\' + _)) + '$', 'i') : null
  if (n !== null && op !== '<>' ) {
    return (x) => {
      const v = typeof x === 'number' ? x : null
      if (v === null) return false
      return op === '=' ? v === n : op === '<' ? v < n : op === '>' ? v > n : op === '<=' ? v <= n : v >= n
    }
  }
  if (op === '<>') {
    if (rest === '') return (x) => x !== null && x !== ''
    if (n !== null) return (x) => !numEq(n)(x)
    return (x) => (rx ? !(typeof x === 'string' && rx.test(x)) : !(typeof x === 'string' && x.toLowerCase() === rest.toLowerCase()))
  }
  if (op === '=') {
    if (rest === '') return (x) => x === null || x === ''
    return (x) => typeof x === 'string' && (rx ? rx.test(x) : x.toLowerCase() === rest.toLowerCase())
  }
  return (x) => typeof x === 'string' && (op === '<' ? x.toLowerCase() < rest.toLowerCase() : op === '>' ? x.toLowerCase() > rest.toLowerCase() : op === '<=' ? x.toLowerCase() <= rest.toLowerCase() : x.toLowerCase() >= rest.toLowerCase())
}

function maskOf(pairs: Value[]): boolean[][] {
  const first = matrix(pairs[0])
  const mask = first.map((r) => r.map(() => true))
  for (let i = 0; i < pairs.length; i += 2) {
    const rng = matrix(pairs[i]), crit = makeCriteria(scalar(pairs[i + 1]))
    if (rng.length !== mask.length || rng[0].length !== mask[0].length) throw E.VALUE
    rng.forEach((row, r) => row.forEach((x, c) => { if (!crit(x)) mask[r][c] = false }))
  }
  return mask
}
const picked = (vals: Value, mask: boolean[][]) => {
  const m = matrix(vals)
  if (m.length !== mask.length || m[0].length !== mask[0].length) throw E.VALUE
  return m.flatMap((row, r) => row.filter((_, c) => mask[r][c])).filter((x): x is number => typeof x === 'number')
}
def('COUNTIF', (a) => { need(a, 2); return maskOf(a).flat().filter(Boolean).length })
def('COUNTIFS', (a) => { if (a.length < 2 || a.length % 2) throw E.VALUE; return maskOf(a).flat().filter(Boolean).length })
def('SUMIF', (a) => { need(a, 2, 3); return picked(a[2] ?? a[0], maskOf(a.slice(0, 2))).reduce((s, x) => s + x, 0) })
def('SUMIFS', (a) => { if (a.length < 3 || a.length % 2 === 0) throw E.VALUE; return picked(a[0], maskOf(a.slice(1))).reduce((s, x) => s + x, 0) })
def('AVERAGEIF', (a) => { need(a, 2, 3); const v = picked(a[2] ?? a[0], maskOf(a.slice(0, 2))); if (!v.length) throw E.DIV0; return v.reduce((s, x) => s + x, 0) / v.length })
def('AVERAGEIFS', (a) => { if (a.length < 3 || a.length % 2 === 0) throw E.VALUE; const v = picked(a[0], maskOf(a.slice(1))); if (!v.length) throw E.DIV0; return v.reduce((s, x) => s + x, 0) / v.length })
def('MAXIFS', (a) => { const v = picked(a[0], maskOf(a.slice(1))); return v.length ? Math.max(...v) : 0 })
def('MINIFS', (a) => { const v = picked(a[0], maskOf(a.slice(1))); return v.length ? Math.min(...v) : 0 })

export const functionNames = () => [...new Set([...builtin.keys(), ...lazy.keys()])].sort()

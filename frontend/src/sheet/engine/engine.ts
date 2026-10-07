import { parse, type Node } from './parser'
import { FormulaSyntaxError } from './tokenizer'
import { CellError, E, compareScalars, errorFromCode, isArr, parseConstant, toNumber, toText, type Scalar, type Value } from './values'
import { formatValue } from './format'
import { builtin, lazy, ERROR_AWARE, LIFT } from './functions'

export interface DataSource {
  raw(sheet: string, r: number, c: number): string | undefined
  extent(sheet: string): { rows: number; cols: number }
  sheetId(name: string): string | undefined
  sheetIds(): string[]
  formulaCells(sheet: string): Iterable<[number, number, string]>
}

export interface Ctx { sheet: string; r: number; c: number; flags: { date: boolean }; locals?: Map<string, Value> }
export interface CellResult { v: Scalar; date?: boolean }

const ARRAYISH = /(FILTER|SORT|SORTBY|UNIQUE|SEQUENCE|TRANSPOSE|TEXTSPLIT|MMULT|RANDARRAY|ARRAYFORMULA|MUNIT|SPLIT|\{)/i
const STARTS_WITH_RANGE = /^=\s*[-+(]*\$?[A-Za-z]{1,3}\$?\d+:\$?[A-Za-z]{1,3}\$?\d+/
const MAX_CELLS = 3_000_000

export class Engine {
  private cache = new Map<string, CellResult>()
  private full = new Map<string, Scalar[][]>()
  private asts = new Map<string, Node | FormulaSyntaxError>()
  private stack = new Set<string>()
  private spill: Map<string, Scalar> | null = null
  private building = false

  constructor(public ds: DataSource) {}

  invalidate() { this.cache.clear(); this.full.clear(); this.spill = null }

  private key = (s: string, r: number, c: number) => `${s}\u0000${r}\u0000${c}`

  value(sheet: string, r: number, c: number): Scalar { return this.result(sheet, r, c).v }

  result(sheet: string, r: number, c: number): CellResult {
    const k = this.key(sheet, r, c)
    const hit = this.cache.get(k)
    if (hit) return hit
    const raw = this.ds.raw(sheet, r, c)
    if (raw === undefined || raw === '') {
      if (!this.spill && !this.building) this.buildSpill()
      const sp = this.spill?.get(k)
      const res: CellResult = { v: sp === undefined ? null : sp }
      if (!this.building) this.cache.set(k, res)
      return res
    }
    let res: CellResult
    if (raw[0] === '=' && raw.length > 1) {
      if (!this.spill && !this.building && (ARRAYISH.test(raw) || STARTS_WITH_RANGE.test(raw))) {
        this.buildSpill() // may mark this very cell as #SPILL! when its target area is occupied
        const done = this.cache.get(k)
        if (done) return done
      }
      if (this.stack.has(k)) return { v: E.CIRC }
      this.stack.add(k)
      try { res = this.evalFormulaCell(raw, sheet, r, c, k) } finally { this.stack.delete(k) }
    } else res = { v: parseConstant(raw) }
    this.cache.set(k, res)
    return res
  }

  private ast(raw: string): Node | FormulaSyntaxError {
    let a = this.asts.get(raw)
    if (!a) {
      try { a = parse(raw) } catch (e) { a = e instanceof FormulaSyntaxError ? e : new FormulaSyntaxError(String(e)) }
      this.asts.set(raw, a)
      if (this.asts.size > 5000) this.asts.clear()
    }
    return a
  }

  private evalFormulaCell(raw: string, sheet: string, r: number, c: number, k: string): CellResult {
    const ast = this.ast(raw)
    if (ast instanceof FormulaSyntaxError) return { v: E.ERROR }
    const cx: Ctx = { sheet, r, c, flags: { date: false } }
    let v: Value
    try { v = this.eval(ast, cx) } catch (e) {
      if (e instanceof CellError) return { v: e }
      return { v: E.ERROR }
    }
    if (isArr(v)) {
      if (v.length === 1 && v[0].length === 1) v = v[0][0]
      else { this.full.set(k, v); v = v[0]?.[0] ?? null }
    }
    return { v: v as Scalar, date: cx.flags.date }
  }

  private buildSpill() {
    this.building = true
    this.spill = new Map()
    try {
      for (const sheet of this.ds.sheetIds()) {
        for (const [r, c, raw] of this.ds.formulaCells(sheet)) {
          if (!(ARRAYISH.test(raw) || STARTS_WITH_RANGE.test(raw))) continue
          const k = this.key(sheet, r, c)
          this.result(sheet, r, c)
          const arr = this.full.get(k)
          if (!arr) continue
          let blocked = false
          for (let i = 0; i < arr.length && !blocked; i++) for (let j = 0; j < arr[i].length; j++) {
            if ((i || j) && (this.ds.raw(sheet, r + i, c + j) ?? '') !== '') { blocked = true; break }
          }
          if (blocked) { this.cache.set(k, { v: E.SPILL }); continue }
          for (let i = 0; i < arr.length; i++) for (let j = 0; j < arr[i].length; j++) if (i || j) this.spill.set(this.key(sheet, r + i, c + j), arr[i][j])
        }
      }
    } finally { this.building = false }
  }

  /** True when (r,c) is displaying a value spilled from another cell. */
  isSpilled(sheet: string, r: number, c: number) {
    if (!this.spill && !this.building) this.buildSpill()
    return this.spill?.has(this.key(sheet, r, c)) ?? false
  }

  display(sheet: string, r: number, c: number, nf?: string): { text: string; v: Scalar } {
    const res = this.result(sheet, r, c)
    let code = nf
    if ((!code || code === 'General') && res.date && typeof res.v === 'number') code = res.v % 1 === 0 ? 'yyyy-mm-dd' : 'yyyy-mm-dd h:mm'
    return { text: formatValue(res.v, code), v: res.v }
  }

  // ───────────── evaluation ─────────────
  sheetOf(name: string | undefined, cx: Ctx): string {
    if (!name) return cx.sheet
    const id = this.ds.sheetId(name)
    if (!id) throw E.REF
    return id
  }

  range(sheet: string, r1: number, c1: number, r2: number, c2: number): Scalar[][] {
    const ext = this.ds.extent(sheet)
    if (r2 === Infinity) r2 = Math.max(r1, ext.rows - 1)
    if (c2 === Infinity) c2 = Math.max(c1, ext.cols - 1)
    if ((r2 - r1 + 1) * (c2 - c1 + 1) > MAX_CELLS) throw E.NUM
    const out: Scalar[][] = []
    for (let r = r1; r <= r2; r++) {
      const row: Scalar[] = []
      for (let c = c1; c <= c2; c++) row.push(this.value(sheet, r, c))
      out.push(row)
    }
    return out
  }

  eval(n: Node, cx: Ctx): Value {
    switch (n.k) {
      case 'num': case 'str': case 'bool': return n.v
      case 'err': return errorFromCode(n.v)
      case 'empty': return null
      case 'name': {
        const v = cx.locals?.get(n.name.toUpperCase())
        if (v !== undefined) return v
        throw E.NAME
      }
      case 'ref': {
        const { ref } = n
        const sh = this.sheetOf(ref.sheet, cx)
        if (ref.kind === 'cell') return this.value(sh, ref.r1, ref.c1)
        return this.range(sh, ref.r1, ref.c1, ref.r2, ref.c2)
      }
      case 'arr': return n.rows.map((row) => row.map((x) => { const v = this.eval(x, cx); return isArr(v) ? (v[0]?.[0] ?? null) : v }))
      case 'un': {
        const v = this.eval(n.a, cx)
        return this.lift1(v, (x) => (n.op === '-' ? -toNumber(x) : (typeof x === 'string' ? x : toNumber(x))))
      }
      case 'pct': return this.lift1(this.eval(n.a, cx), (x) => toNumber(x) / 100)
      case 'bin': return this.binary(n.op, this.eval(n.a, cx), this.eval(n.b, cx))
      case 'call': return this.call(n.name, n.args, cx)
    }
  }

  private lift1(v: Value, f: (x: Scalar) => Scalar): Value {
    if (!isArr(v)) return f(v)
    return v.map((row) => row.map((x) => { try { return f(x) } catch (e) { if (e instanceof CellError) return e; throw e } }))
  }

  binary(op: string, a: Value, b: Value): Value {
    if (isArr(a) || isArr(b)) {
      const A = isArr(a) ? a : [[a]], B = isArr(b) ? b : [[b]]
      const rows = Math.max(A.length, B.length), cols = Math.max(A[0].length, B[0].length)
      if ((A.length !== 1 && B.length !== 1 && A.length !== B.length) || (A[0].length !== 1 && B[0].length !== 1 && A[0].length !== B[0].length)) throw E.VALUE
      const out: Scalar[][] = []
      for (let i = 0; i < rows; i++) {
        const row: Scalar[] = []
        for (let j = 0; j < cols; j++) {
          const x = A[A.length === 1 ? 0 : i][A[0].length === 1 ? 0 : j], y = B[B.length === 1 ? 0 : i][B[0].length === 1 ? 0 : j]
          try { row.push(this.binary1(op, x, y)) } catch (e) { if (e instanceof CellError) row.push(e); else throw e }
        }
        out.push(row)
      }
      return out
    }
    return this.binary1(op, a, b)
  }

  private binary1(op: string, a: Scalar, b: Scalar): Scalar {
    if (a instanceof CellError) throw a
    if (b instanceof CellError) throw b
    switch (op) {
      case '+': return toNumber(a) + toNumber(b)
      case '-': return toNumber(a) - toNumber(b)
      case '*': return toNumber(a) * toNumber(b)
      case '/': { const d = toNumber(b); if (d === 0) throw E.DIV0; return toNumber(a) / d }
      case '^': { const r = Math.pow(toNumber(a), toNumber(b)); if (!Number.isFinite(r)) throw E.NUM; return r }
      case '&': return toText(a) + toText(b)
      case '=': return compareScalars(a, b) === 0
      case '<>': return compareScalars(a, b) !== 0
      case '<': return compareScalars(a, b) < 0
      case '>': return compareScalars(a, b) > 0
      case '<=': return compareScalars(a, b) <= 0
      case '>=': return compareScalars(a, b) >= 0
    }
    throw E.ERROR
  }

  private call(name: string, args: Node[], cx: Ctx): Value {
    const lz = lazy.get(name)
    if (lz) return lz(args, this, cx)
    const fn = builtin.get(name)
    if (!fn) throw E.NAME
    const aware = ERROR_AWARE.has(name)
    const vals = args.map((a) => {
      if (!aware) return this.eval(a, cx)
      try { return this.eval(a, cx) } catch (e) { if (e instanceof CellError) return e; throw e }
    })
    if (!aware) {
      for (const v of vals) {
        if (v instanceof CellError) throw v
        if (isArr(v)) for (const row of v) for (const x of row) if (x instanceof CellError) throw x
      }
    }
    if (LIFT.has(name) && vals.some(isArr)) return this.liftCall(fn, vals, cx)
    const out = fn(vals, this, cx)
    return out
  }

  private liftCall(fn: (a: Value[], ev: Engine, cx: Ctx) => Value, vals: Value[], cx: Ctx): Value {
    const arrays = vals.filter(isArr) as Scalar[][][]
    const rows = Math.max(...arrays.map((a) => a.length)), cols = Math.max(...arrays.map((a) => a[0].length))
    const out: Scalar[][] = []
    for (let i = 0; i < rows; i++) {
      const row: Scalar[] = []
      for (let j = 0; j < cols; j++) {
        const args = vals.map((v) => (isArr(v) ? v[v.length === 1 ? 0 : i]?.[v[0].length === 1 ? 0 : j] ?? null : v))
        try { const r = fn(args, this, cx); row.push(isArr(r) ? (r[0]?.[0] ?? null) : r) } catch (e) { if (e instanceof CellError) row.push(e); else throw e }
      }
      out.push(row)
    }
    return out
  }
}

import * as Y from 'yjs'
import { extendSeries } from './engine/autofill'
import { Engine, type DataSource } from './engine/engine'
import { colName } from './engine/refs'
import { adjustForStructure, renameSheetInFormula, shiftFormula } from './engine/transform'
import { compareScalars, parseDateString, parseNumberString, CellError, type Scalar } from './engine/values'
import { parseDelimited } from './csv'

export const LOCAL = 'koko-sheet'
export const DEFAULT_COL_W = 100
export const DEFAULT_ROW_H = 24
export const HEADER_H = 26
export const HEADER_W = 48
export const MIN_ROWS = 1000
export const MIN_COLS = 26

export interface Style {
  b?: 1; i?: 1; u?: 1; st?: 1
  color?: string; bg?: string; fs?: number; ff?: string
  ha?: 'left' | 'center' | 'right'; va?: 'top' | 'middle' | 'bottom'; wrap?: 1; nf?: string
  bt?: string; br?: string; bb?: string; bl?: string // custom borders (css colors)
}
export interface CellData { v?: string; s?: Style }
export interface Tab { id: string; name: string; order: number; color?: string }
export interface Rect { r1: number; c1: number; r2: number; c2: number }
export interface Chart {
  id: string; type: 'column' | 'bar' | 'line' | 'pie' | 'area' | 'scatter'
  range: string; title: string; x: number; y: number; w: number; h: number
  headers: boolean; stacked?: boolean
}
export interface ClipPayload { sheet: string; r0: number; c0: number; cut: boolean; cells: (CellData | null)[][] }

interface Mirror {
  id: string
  cellsY: Y.Map<CellData>; dimsY: Y.Map<number>; mergesY: Y.Array<number[]>; chartsY: Y.Array<Chart>
  cells: Map<string, CellData>; formulas: Set<string>
  dims: Map<string, number>; merges: Rect[]; charts: Chart[]
  ext: { rows: number; cols: number; vrows: number; vcols: number } | null
}

const key = (r: number, c: number) => `${r},${c}`
const unkey = (k: string): [number, number] => { const i = k.indexOf(','); return [Number(k.slice(0, i)), Number(k.slice(i + 1))] }
const styleEmpty = (s?: Style) => !s || Object.keys(s).length === 0
const cleanStyle = (s: Style): Style | undefined => {
  const o: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(s)) if (v !== undefined && v !== null && v !== '' && v !== false && !(k === 'nf' && v === 'General')) o[k] = v
  return Object.keys(o).length ? (o as Style) : undefined
}
export const rectNorm = (a: Rect): Rect => ({ r1: Math.min(a.r1, a.r2), c1: Math.min(a.c1, a.c2), r2: Math.max(a.r1, a.r2), c2: Math.max(a.c1, a.c2) })
export const rectHas = (a: Rect, r: number, c: number) => r >= a.r1 && r <= a.r2 && c >= a.c1 && c <= a.c2
const rid = () => Math.random().toString(36).slice(2, 8)

/** Style a typed value implies (so "12%" becomes a percent cell and "$5" a currency cell). */
export function inferStyle(text: string): Partial<Style> | null {
  const t = text.trim()
  if (/^-?\$\s?\d[\d,]*(\.\d+)?$/.test(t)) return { nf: '$#,##0.00' }
  if (/^-?[\d.,]+%$/.test(t) && parseNumberString(t) !== null) return { nf: /\.\d/.test(t) ? '0.00%' : '0%' }
  if (parseDateString(t) !== null && !parseNumberString(t)) return { nf: /\d:\d/.test(t) ? 'yyyy-mm-dd h:mm' : 'yyyy-mm-dd' }
  return null
}

type MapEntry = { kind: 'map'; map: Y.Map<unknown>; key: string; old: unknown; cur: unknown }
type ArrEntry = { kind: 'arr'; arr: Y.Array<unknown>; old: unknown[]; cur: unknown[] }
type HistoryEntry = MapEntry | ArrEntry
interface HistoryItem { entries: HistoryEntry[]; at: number }

/**
 * Per-user undo/redo that records the old and new value of every key this user changed.
 * (Yjs' UndoManager cannot restore a map key that was deleted and later re-set, which structural edits
 * such as insert-then-delete columns do all the time.)  Undo applies the old values as a new edit, so
 * collaborators see it as an ordinary change and nobody else's work is rolled back.
 */
class History {
  undoStack: HistoryItem[] = []
  redoStack: HistoryItem[] = []
  private pending: HistoryEntry[] = []
  private arrays = new Set<Y.Array<unknown>>()
  private before = new Map<Y.Array<unknown>, unknown[]>()
  private seal = false
  private off: (() => void)[] = []

  watchDoc(doc: Y.Doc) {
    const before = (tr: Y.Transaction) => { if (tr.origin === LOCAL) this.arrays.forEach((a) => this.before.set(a, a.toArray())) }
    const after = (tr: Y.Transaction) => {
      if (tr.origin !== LOCAL) return
      for (const a of this.arrays) {
        const was = this.before.get(a), now = a.toArray()
        if (was && JSON.stringify(was) !== JSON.stringify(now)) this.pending.push({ kind: 'arr', arr: a, old: was, cur: now })
      }
      this.before.clear()
      if (!this.pending.length) return
      const now = Date.now(), last = this.undoStack[this.undoStack.length - 1]
      if (last && !this.seal && now - last.at < 500) { last.entries.push(...this.pending); last.at = now }
      else { this.undoStack.push({ entries: this.pending, at: now }); if (this.undoStack.length > 300) this.undoStack.shift() }
      this.seal = false
      this.pending = []
      this.redoStack = []
    }
    doc.on('beforeTransaction', before); doc.on('afterTransaction', after)
    this.off.push(() => { doc.off('beforeTransaction', before); doc.off('afterTransaction', after) })
  }
  watchMap<T>(m: Y.Map<T>) {
    const map = m as unknown as Y.Map<unknown>
    const h = (e: Y.YMapEvent<unknown>) => {
      if (e.transaction.origin !== LOCAL) return
      e.changes.keys.forEach((ch, key) => this.pending.push({ kind: 'map', map, key, old: ch.action === 'add' ? undefined : ch.oldValue, cur: map.has(key) ? map.get(key) : undefined }))
    }
    map.observe(h); this.off.push(() => map.unobserve(h))
  }
  watchArray<T>(arr: Y.Array<T>) { this.arrays.add(arr as unknown as Y.Array<unknown>) }
  stopCapturing() { this.seal = true }
  destroy() { this.off.forEach((f) => f()); this.undoStack = []; this.redoStack = [] }

  private apply(doc: Y.Doc, entries: HistoryEntry[], dir: 'old' | 'cur') {
    doc.transact(() => {
      const list = dir === 'old' ? [...entries].reverse() : entries
      for (const e of list) {
        if (e.kind === 'map') { const v = e[dir]; if (v === undefined) e.map.delete(e.key); else e.map.set(e.key, v) }
        else { e.arr.delete(0, e.arr.length); const v = e[dir]; if (v.length) e.arr.push(v) }
      }
    }, 'koko-history')
  }
  undo(doc: Y.Doc) { const it = this.undoStack.pop(); if (!it) return; this.apply(doc, it.entries, 'old'); this.redoStack.push(it); this.seal = true }
  redo(doc: Y.Doc) { const it = this.redoStack.pop(); if (!it) return; this.apply(doc, it.entries, 'cur'); this.undoStack.push(it); this.seal = true }
}

export class SheetModel implements DataSource {
  readonly engine: Engine
  readonly tabsY: Y.Map<Tab>
  readonly history = new History()
  version = 0
  private sheets = new Map<string, Mirror>()
  private listeners = new Set<() => void>()
  private pending = false
  private tabCache: Tab[] | null = null

  constructor(public ydoc: Y.Doc) {
    this.engine = new Engine(this)
    this.tabsY = ydoc.getMap<Tab>('tabs')
    this.history.watchDoc(ydoc)
    this.history.watchMap(this.tabsY)
    this.tabsY.forEach((_, id) => this.attach(id))
    this.tabsY.observe((e) => {
      e.keysChanged.forEach((id) => { if (this.tabsY.has(id)) this.attach(id) })
      this.tabCache = null
      this.changed()
    })
  }

  destroy() { this.history.destroy(); this.listeners.clear() }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  private changed() {
    this.version++
    this.engine.invalidate()
    for (const m of this.sheets.values()) m.ext = null
    if (this.pending) return
    this.pending = true
    queueMicrotask(() => { this.pending = false; this.listeners.forEach((l) => l()) })
  }

  /** The default tab uses a fixed id so two clients creating it at once converge on one record. */
  ensureDefaultTab() {
    if (this.tabsY.size === 0) this.ydoc.transact(() => { this.tabsY.set('sheet1', { id: 'sheet1', name: 'Sheet1', order: 0 }) }, 'init')
  }

  // ───────────── mirrors ─────────────
  private attach(id: string) {
    if (this.sheets.has(id)) return
    const cellsY = this.ydoc.getMap<CellData>('cells:' + id), dimsY = this.ydoc.getMap<number>('dims:' + id)
    const mergesY = this.ydoc.getArray<number[]>('merges:' + id), chartsY = this.ydoc.getArray<Chart>('charts:' + id)
    const m: Mirror = { id, cellsY, dimsY, mergesY, chartsY, cells: new Map(), formulas: new Set(), dims: new Map(), merges: [], charts: [], ext: null }
    this.sheets.set(id, m)
    cellsY.forEach((v, k) => this.put(m, k, v))
    dimsY.forEach((v, k) => m.dims.set(k, v))
    m.merges = mergesY.toArray().map(([r1, c1, r2, c2]) => ({ r1, c1, r2, c2 }))
    m.charts = chartsY.toArray()
    cellsY.observe((e) => {
      e.changes.keys.forEach((ch, k) => { if (ch.action === 'delete') this.drop(m, k); else this.put(m, k, cellsY.get(k)!) })
      this.changed()
    })
    dimsY.observe((e) => { e.changes.keys.forEach((ch, k) => { if (ch.action === 'delete') m.dims.delete(k); else m.dims.set(k, dimsY.get(k)!) }); this.changed() })
    mergesY.observe(() => { m.merges = mergesY.toArray().map(([r1, c1, r2, c2]) => ({ r1, c1, r2, c2 })); this.changed() })
    chartsY.observe(() => { m.charts = chartsY.toArray(); this.changed() })
    this.history.watchMap(cellsY); this.history.watchMap(dimsY); this.history.watchArray(mergesY); this.history.watchArray(chartsY)
  }
  private put(m: Mirror, k: string, v: CellData) {
    m.cells.set(k, v)
    if (v.v && v.v[0] === '=') m.formulas.add(k); else m.formulas.delete(k)
  }
  private drop(m: Mirror, k: string) { m.cells.delete(k); m.formulas.delete(k) }
  private mirror(id: string) { const m = this.sheets.get(id); if (!m) throw new Error('Unknown sheet ' + id); return m }
  has(id: string) { return this.sheets.has(id) }

  // ───────────── DataSource for the formula engine ─────────────
  raw(sheet: string, r: number, c: number) { return this.sheets.get(sheet)?.cells.get(key(r, c))?.v }
  extent(sheet: string) { const e = this.used(sheet); return { rows: e.vrows, cols: e.vcols } }
  sheetId(name: string) { const n = name.toLowerCase(); return this.tabList().find((t) => t.name.toLowerCase() === n)?.id }
  sheetIds() { return this.tabList().map((t) => t.id) }
  *formulaCells(sheet: string): Iterable<[number, number, string]> {
    const m = this.sheets.get(sheet); if (!m) return
    for (const k of m.formulas) { const [r, c] = unkey(k); yield [r, c, m.cells.get(k)!.v!] }
  }

  // ───────────── reads ─────────────
  tabList(): Tab[] {
    if (!this.tabCache) this.tabCache = [...this.tabsY.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    return this.tabCache
  }
  cell(sheet: string, r: number, c: number) { return this.sheets.get(sheet)?.cells.get(key(r, c)) }
  style(sheet: string, r: number, c: number): Style { return this.cell(sheet, r, c)?.s ?? {} }
  /** Extent of anything stored (values or formatting) and of values only. */
  used(sheet: string) {
    const m = this.sheets.get(sheet)
    if (!m) return { rows: 0, cols: 0, vrows: 0, vcols: 0 }
    if (!m.ext) {
      let rows = 0, cols = 0, vrows = 0, vcols = 0
      for (const [k, v] of m.cells) {
        const [r, c] = unkey(k)
        if (r + 1 > rows) rows = r + 1
        if (c + 1 > cols) cols = c + 1
        if (v.v) { if (r + 1 > vrows) vrows = r + 1; if (c + 1 > vcols) vcols = c + 1 }
      }
      m.ext = { rows, cols, vrows, vcols }
    }
    return m.ext
  }
  rowCount(sheet: string) { return Math.max(MIN_ROWS, this.used(sheet).rows + 200) }
  colCount(sheet: string) { return Math.max(MIN_COLS, this.used(sheet).cols + 6) }
  colWidth(sheet: string, c: number) { return this.sheets.get(sheet)?.dims.get('c' + c) ?? DEFAULT_COL_W }
  rowHeight(sheet: string, r: number) { return this.sheets.get(sheet)?.dims.get('r' + r) ?? DEFAULT_ROW_H }
  freeze(sheet: string) { const d = this.sheets.get(sheet)?.dims; return { rows: d?.get('fr') ?? 0, cols: d?.get('fc') ?? 0 } }
  merges(sheet: string) { return this.sheets.get(sheet)?.merges ?? [] }
  mergeAt(sheet: string, r: number, c: number) { return this.sheets.get(sheet)?.merges.find((m) => rectHas(m, r, c)) }
  charts(sheet: string) { return this.sheets.get(sheet)?.charts ?? [] }

  display(sheet: string, r: number, c: number) {
    const s = this.style(sheet, r, c)
    const d = this.engine.display(sheet, r, c, s.nf)
    return { ...d, style: s }
  }
  value(sheet: string, r: number, c: number): Scalar { return this.engine.value(sheet, r, c) }

  // ───────────── writes ─────────────
  private tx<T>(fn: () => T): T { let out!: T; this.ydoc.transact(() => { out = fn() }, LOCAL); return out }

  private write(m: Mirror, r: number, c: number, next: CellData | null | undefined) {
    const k = key(r, c)
    const s = next?.s ? cleanStyle(next.s) : undefined
    if (!next || (!next.v && !s)) { if (m.cellsY.has(k)) m.cellsY.delete(k); return }
    const out: CellData = {}
    if (next.v) out.v = next.v
    if (s) out.s = s
    m.cellsY.set(k, out)
  }
  private yCell(m: Mirror, r: number, c: number): CellData | undefined { return m.cellsY.get(key(r, c)) }

  /** Set the typed text of a cell (formula or constant); also applies number-format inference. */
  setText(sheet: string, r: number, c: number, text: string, infer = true) {
    this.tx(() => {
      const m = this.mirror(sheet)
      const cur = this.yCell(m, r, c)
      let s = cur?.s
      if (infer && text && text[0] !== '=' && (!s?.nf || s.nf === 'General')) {
        const inf = inferStyle(text)
        if (inf) s = { ...s, ...inf }
      }
      this.write(m, r, c, { v: text || undefined, s })
    })
  }
  setTexts(sheet: string, entries: { r: number; c: number; text: string }[]) {
    this.tx(() => entries.forEach((e) => this.setText(sheet, e.r, e.c, e.text)))
  }

  setStyle(sheet: string, rect: Rect, patch: Partial<Style> | ((s: Style) => Style)) {
    const R = rectNorm(rect)
    if ((R.r2 - R.r1 + 1) * (R.c2 - R.c1 + 1) > 300000) return
    this.tx(() => {
      const m = this.mirror(sheet)
      for (let r = R.r1; r <= R.r2; r++) for (let c = R.c1; c <= R.c2; c++) {
        const cur = this.yCell(m, r, c)
        const base = cur?.s ?? {}
        const next = typeof patch === 'function' ? patch({ ...base }) : { ...base, ...patch }
        this.write(m, r, c, { v: cur?.v, s: next })
      }
    })
  }
  /** Borders around / inside a rect. */
  setBorders(sheet: string, rect: Rect, mode: 'all' | 'outer' | 'none' | 'top' | 'bottom' | 'left' | 'right' | 'inner', color = '#000000') {
    const R = rectNorm(rect)
    this.setStyleEach(sheet, R, (s, r, c) => {
      const t = r === R.r1, b = r === R.r2, l = c === R.c1, rr = c === R.c2
      const set = (k: 'bt' | 'br' | 'bb' | 'bl', on: boolean) => { if (mode === 'none') delete s[k]; else if (on) s[k] = color }
      if (mode === 'none') { delete s.bt; delete s.br; delete s.bb; delete s.bl; return s }
      if (mode === 'all') { s.bt = s.br = s.bb = s.bl = color }
      if (mode === 'outer') { set('bt', t); set('bb', b); set('bl', l); set('br', rr) }
      if (mode === 'top') set('bt', t); if (mode === 'bottom') set('bb', b); if (mode === 'left') set('bl', l); if (mode === 'right') set('br', rr)
      if (mode === 'inner') { set('bt', !t); set('bb', !b); set('bl', !l); set('br', !rr) }
      return s
    })
  }
  setStyleEach(sheet: string, rect: Rect, fn: (s: Style, r: number, c: number) => Style) {
    const R = rectNorm(rect)
    if ((R.r2 - R.r1 + 1) * (R.c2 - R.c1 + 1) > 300000) return
    this.tx(() => {
      const m = this.mirror(sheet)
      for (let r = R.r1; r <= R.r2; r++) for (let c = R.c1; c <= R.c2; c++) {
        const cur = this.yCell(m, r, c)
        this.write(m, r, c, { v: cur?.v, s: fn({ ...(cur?.s ?? {}) }, r, c) })
      }
    })
  }

  clear(sheet: string, rect: Rect, what: 'values' | 'formats' | 'all' = 'values') {
    const R = rectNorm(rect)
    this.tx(() => {
      const m = this.mirror(sheet)
      // iterate stored cells (a whole-column clear must not walk millions of empty keys)
      for (const [k, v] of [...m.cellsY.entries()]) {
        const [r, c] = unkey(k)
        if (!rectHas(R, r, c)) continue
        this.write(m, r, c, what === 'all' ? null : what === 'values' ? { v: undefined, s: v.s } : { v: v.v, s: undefined })
      }
    })
  }

  setColWidth(sheet: string, c: number, w: number) { this.tx(() => { const m = this.mirror(sheet); if (Math.round(w) === DEFAULT_COL_W) m.dimsY.delete('c' + c); else m.dimsY.set('c' + c, Math.max(20, Math.round(w))) }) }
  setRowHeight(sheet: string, r: number, h: number) { this.tx(() => { const m = this.mirror(sheet); if (Math.round(h) === DEFAULT_ROW_H) m.dimsY.delete('r' + r); else m.dimsY.set('r' + r, Math.max(14, Math.round(h))) }) }
  setFreeze(sheet: string, rows: number, cols: number) {
    this.tx(() => { const m = this.mirror(sheet); rows ? m.dimsY.set('fr', rows) : m.dimsY.delete('fr'); cols ? m.dimsY.set('fc', cols) : m.dimsY.delete('fc') })
  }

  // ───────────── merge ─────────────
  merge(sheet: string, rect: Rect) {
    const R = rectNorm(rect)
    if (R.r1 === R.r2 && R.c1 === R.c2) return
    this.tx(() => {
      const m = this.mirror(sheet)
      const keep = m.mergesY.toArray().filter(([a, b, c, d]) => !(a <= R.r2 && c >= R.r1 && b <= R.c2 && d >= R.c1))
      m.mergesY.delete(0, m.mergesY.length)
      m.mergesY.push([...keep, [R.r1, R.c1, R.r2, R.c2]])
      for (let r = R.r1; r <= R.r2; r++) for (let c = R.c1; c <= R.c2; c++) if (r !== R.r1 || c !== R.c1) { const cur = this.yCell(m, r, c); if (cur?.v) this.write(m, r, c, { s: cur.s }) }
    })
  }
  unmerge(sheet: string, rect: Rect) {
    const R = rectNorm(rect)
    this.tx(() => {
      const m = this.mirror(sheet)
      const keep = m.mergesY.toArray().filter(([a, b, c, d]) => !(a <= R.r2 && c >= R.r1 && b <= R.c2 && d >= R.c1))
      m.mergesY.delete(0, m.mergesY.length)
      if (keep.length) m.mergesY.push(keep)
    })
  }

  // ───────────── structure: insert / delete rows and columns ─────────────
  private restructure(sheet: string, axis: 'row' | 'col', at: number, count: number) {
    this.tx(() => {
      const m = this.mirror(sheet)
      const idx = (k: string) => (axis === 'row' ? unkey(k)[0] : unkey(k)[1])
      const rekey = (k: string, n: number) => { const [r, c] = unkey(k); return axis === 'row' ? key(r + n, c) : key(r, c + n) }
      const del = count < 0 ? -count : 0
      const entries = [...m.cellsY.entries()]
      const moves: [string, string | null, CellData][] = []
      for (const [k, v] of entries) {
        const i = idx(k)
        if (count > 0 && i >= at) moves.push([k, rekey(k, count), v])
        else if (count < 0 && i >= at && i < at + del) moves.push([k, null, v])
        else if (count < 0 && i >= at + del) moves.push([k, rekey(k, -del), v])
      }
      moves.forEach(([k]) => m.cellsY.delete(k))
      moves.forEach(([, nk, v]) => { if (nk) m.cellsY.set(nk, v) })
      // sizes (row heights / column widths) follow their rows / columns
      const pre = axis === 'row' ? 'r' : 'c'
      const dm: [string, number | null, number][] = []
      for (const [k, v] of [...m.dimsY.entries()]) {
        if (k[0] !== pre || !/^[rc]\d+$/.test(k)) continue
        const i = Number(k.slice(1))
        if (count > 0 && i >= at) dm.push([k, i + count, v])
        else if (count < 0 && i >= at && i < at + del) dm.push([k, null, v])
        else if (count < 0 && i >= at + del) dm.push([k, i - del, v])
      }
      dm.forEach(([k]) => m.dimsY.delete(k)); dm.forEach(([, ni, v]) => { if (ni !== null) m.dimsY.set(pre + ni, v) })
      const fk = axis === 'row' ? 'fr' : 'fc', fz = m.dimsY.get(fk) ?? 0
      if (fz && count > 0 && at < fz) m.dimsY.set(fk, fz + count)
      if (fz && count < 0) { const nf = Math.max(0, fz - Math.max(0, Math.min(fz, at + del) - at)); nf ? m.dimsY.set(fk, nf) : m.dimsY.delete(fk) }
      // merges
      const lo = (a: number[]) => (axis === 'row' ? [a[0], a[2]] : [a[1], a[3]])
      const merges: number[][] = []
      for (const a of m.mergesY.toArray()) {
        let [s, e] = lo(a)
        if (count > 0) { if (s >= at) s += count; if (e >= at) e += count }
        else { const end = at + del; const ns = s < at ? s : s >= end ? s - del : at; const ne = e < at ? e : e >= end ? e - del : at - 1; if (ns > ne) continue; s = ns; e = ne }
        const b = a.slice(); if (axis === 'row') { b[0] = s; b[2] = e } else { b[1] = s; b[3] = e }
        if (b[0] === b[2] && b[1] === b[3]) continue
        merges.push(b)
      }
      m.mergesY.delete(0, m.mergesY.length); if (merges.length) m.mergesY.push(merges)
      // formulas in every sheet that point at this one
      const nameToId = (n: string) => this.sheetId(n)
      for (const other of this.sheets.values()) {
        for (const [k, v] of [...other.cellsY.entries()]) {
          if (!v.v || v.v[0] !== '=') continue
          const nv = adjustForStructure(v.v, other.id, sheet, nameToId, axis, at, count)
          if (nv !== v.v) other.cellsY.set(k, { ...v, v: nv })
        }
      }
    })
  }
  insertRows(sheet: string, at: number, n = 1) { this.restructure(sheet, 'row', at, n) }
  deleteRows(sheet: string, at: number, n = 1) { this.restructure(sheet, 'row', at, -n) }
  insertCols(sheet: string, at: number, n = 1) { this.restructure(sheet, 'col', at, n) }
  deleteCols(sheet: string, at: number, n = 1) { this.restructure(sheet, 'col', at, -n) }

  // ───────────── clipboard ─────────────
  copyRange(sheet: string, rect: Rect, cut = false): ClipPayload {
    const R = rectNorm(rect)
    const cells: (CellData | null)[][] = []
    for (let r = R.r1; r <= R.r2; r++) {
      const row: (CellData | null)[] = []
      for (let c = R.c1; c <= R.c2; c++) { const x = this.cell(sheet, r, c); row.push(x ? { v: x.v, s: x.s } : null) }
      cells.push(row)
    }
    return { sheet, r0: R.r1, c0: R.c1, cut, cells }
  }
  textOf(sheet: string, rect: Rect): string {
    const R = rectNorm(rect)
    const rows: string[] = []
    for (let r = R.r1; r <= R.r2; r++) {
      const cols: string[] = []
      for (let c = R.c1; c <= R.c2; c++) {
        let t = this.display(sheet, r, c).text
        if (/[\t\n"]/.test(t)) t = `"${t.replace(/"/g, '""')}"`
        cols.push(t)
      }
      rows.push(cols.join('\t'))
    }
    return rows.join('\n')
  }
  paste(sheet: string, r0: number, c0: number, p: ClipPayload, what: 'all' | 'values' | 'formats' = 'all') {
    this.tx(() => {
      const m = this.mirror(sheet)
      p.cells.forEach((row, i) => row.forEach((cell, j) => {
        const r = r0 + i, c = c0 + j
        const cur = this.yCell(m, r, c)
        let v = cell?.v
        if (v && v[0] === '=' && !p.cut) v = shiftFormula(v, r - (p.r0 + i), c - (p.c0 + j))
        if (what === 'values') { if (v && v[0] === '=') v = String(this.engine.value(p.sheet, p.r0 + i, p.c0 + j) ?? ''); this.write(m, r, c, { v, s: cur?.s }) }
        else if (what === 'formats') this.write(m, r, c, { v: cur?.v, s: cell?.s })
        else this.write(m, r, c, { v, s: cell?.s })
      }))
      if (p.cut && what === 'all') {
        const src = this.mirror(p.sheet)
        const R: Rect = { r1: p.r0, c1: p.c0, r2: p.r0 + p.cells.length - 1, c2: p.c0 + (p.cells[0]?.length ?? 1) - 1 }
        for (let r = R.r1; r <= R.r2; r++) for (let c = R.c1; c <= R.c2; c++) {
          const inDest = p.sheet === sheet && rectHas({ r1: r0, c1: c0, r2: r0 + p.cells.length - 1, c2: c0 + p.cells[0].length - 1 }, r, c)
          if (!inDest) this.write(src, r, c, null)
        }
      }
    })
  }
  /** Paste plain tab-separated text (from Excel / Google Sheets / another app). Returns the pasted rect. */
  pasteText(sheet: string, r0: number, c0: number, text: string): Rect {
    const rows = parseDelimited(text.replace(/\r\n/g, '\n').replace(/\n$/, ''), '\t')
    this.tx(() => rows.forEach((row, i) => row.forEach((t, j) => this.setText(sheet, r0 + i, c0 + j, t))))
    return { r1: r0, c1: c0, r2: r0 + rows.length - 1, c2: c0 + Math.max(...rows.map((r) => r.length)) - 1 }
  }
  importDelimited(sheet: string, text: string, delim: string) {
    const rows = parseDelimited(text, delim)
    this.tx(() => rows.forEach((row, i) => row.forEach((t, j) => { if (t !== '') this.setText(sheet, i, j, t) })))
    return rows.length
  }

  // ───────────── fill / sort ─────────────
  /** Extend the contents of `src` into the adjacent `dest` rectangle (series, text patterns, formulas shift). */
  fill(sheet: string, src: Rect, dest: Rect) {
    const S = rectNorm(src), D = rectNorm(dest)
    const vertical = D.c1 >= S.c1 && D.c2 <= S.c2 && (D.r1 > S.r2 || D.r2 < S.r1)
    const horizontal = D.r1 >= S.r1 && D.r2 <= S.r2 && (D.c1 > S.c2 || D.c2 < S.c1)
    if (!vertical && !horizontal) return
    this.tx(() => {
      const m = this.mirror(sheet)
      const lines = vertical ? S.c2 - S.c1 + 1 : S.r2 - S.r1 + 1
      for (let line = 0; line < lines; line++) {
        const srcPos: [number, number][] = []
        if (vertical) for (let r = S.r1; r <= S.r2; r++) srcPos.push([r, S.c1 + line]); else for (let c = S.c1; c <= S.c2; c++) srcPos.push([S.r1 + line, c])
        const srcCells = srcPos.map(([r, c]) => this.yCell(m, r, c))
        const n = srcCells.length
        const forward = vertical ? D.r1 > S.r2 : D.c1 > S.c2
        const targets: [number, number][] = []
        if (vertical) { for (let r = D.r1; r <= D.r2; r++) targets.push([r, S.c1 + line]) } else for (let c = D.c1; c <= D.c2; c++) targets.push([S.r1 + line, c])
        if (!forward) targets.reverse() // nearest-to-source first
        const hasFormula = srcCells.some((x) => x?.v && x.v[0] === '=')
        const raws = srcCells.map((x) => x?.v ?? '')
        const series = hasFormula ? null : extendSeries(raws, targets.length, !forward)
        targets.forEach(([r, c], i) => {
          const pos = vertical ? r : c, base = vertical ? S.r1 : S.c1
          const si = (((pos - base) % n) + n) % n
          const sc = srcCells[si]
          let v: string | undefined
          if (hasFormula) {
            const raw = sc?.v
            v = raw && raw[0] === '=' ? shiftFormula(raw, vertical ? r - srcPos[si][0] : 0, vertical ? 0 : c - srcPos[si][1]) : raw
          } else v = series![i] || undefined
          this.write(m, r, c, { v, s: sc?.s })
        })
      }
    })
  }

  sort(sheet: string, rect: Rect, byCol: number, ascending: boolean, header: boolean) {
    const R = rectNorm(rect)
    const first = R.r1 + (header ? 1 : 0)
    if (first >= R.r2) return
    this.tx(() => {
      const m = this.mirror(sheet)
      const rows: { r: number; key: Scalar; cells: (CellData | undefined)[] }[] = []
      for (let r = first; r <= R.r2; r++) {
        const cells: (CellData | undefined)[] = []
        for (let c = R.c1; c <= R.c2; c++) cells.push(this.yCell(m, r, c))
        rows.push({ r, key: this.engine.value(sheet, r, byCol), cells })
      }
      const blank = (k: Scalar) => k === null || k === ''
      const sorted = rows.slice().sort((a, b) => {
        if (blank(a.key) !== blank(b.key)) return blank(a.key) ? 1 : -1 // blanks always last
        if (blank(a.key)) return 0
        try { return (ascending ? 1 : -1) * compareScalars(a.key, b.key) } catch { return 0 }
      })
      sorted.forEach((row, i) => {
        const r = first + i
        row.cells.forEach((cell, j) => {
          let v = cell?.v
          if (v && v[0] === '=') v = shiftFormula(v, r - row.r, 0)
          this.write(m, r, R.c1 + j, cell ? { v, s: cell.s } : null)
        })
      })
    })
  }

  // ───────────── tabs ─────────────
  addTab(name?: string): string {
    return this.tx(() => {
      const id = rid(), tabs = this.tabList()
      let n = tabs.length + 1, nm = name
      if (!nm) { const taken = new Set(tabs.map((t) => t.name.toLowerCase())); while (taken.has(`sheet${n}`)) n++; nm = `Sheet${n}` }
      this.tabsY.set(id, { id, name: nm, order: Math.max(-1, ...tabs.map((t) => t.order)) + 1 })
      this.attach(id)
      return id
    })
  }
  renameTab(id: string, name: string) {
    const t = this.tabsY.get(id); if (!t || !name.trim() || t.name === name) return
    if (this.tabList().some((x) => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) return
    this.tx(() => {
      this.tabsY.set(id, { ...t, name })
      for (const m of this.sheets.values()) for (const [k, v] of [...m.cellsY.entries()]) {
        if (v.v && v.v[0] === '=' && v.v.includes('!')) { const nv = renameSheetInFormula(v.v, t.name, name); if (nv !== v.v) m.cellsY.set(k, { ...v, v: nv }) }
      }
    })
  }
  setTabColor(id: string, color?: string) { const t = this.tabsY.get(id); if (t) this.tx(() => this.tabsY.set(id, { ...t, color })) }
  moveTab(id: string, toIndex: number) {
    const tabs = this.tabList().filter((t) => t.id !== id), t = this.tabsY.get(id)
    if (!t) return
    tabs.splice(Math.max(0, Math.min(toIndex, tabs.length)), 0, t)
    this.tx(() => tabs.forEach((x, i) => { if (x.order !== i || x.id === id) this.tabsY.set(x.id, { ...x, order: i }) }))
  }
  deleteTab(id: string) {
    const t = this.tabsY.get(id)
    if (!t || this.tabsY.size <= 1) return false
    this.tx(() => {
      this.tabsY.delete(id)
      const m = this.sheets.get(id)
      if (m) { m.cellsY.clear(); m.dimsY.clear(); m.mergesY.delete(0, m.mergesY.length); m.chartsY.delete(0, m.chartsY.length) }
      for (const o of this.sheets.values()) for (const [k, v] of [...o.cellsY.entries()]) {
        if (v.v && v.v[0] === '=' && v.v.includes('!')) { const nv = renameSheetInFormula(v.v, t.name, undefined); if (nv !== v.v) o.cellsY.set(k, { ...v, v: nv }) }
      }
    })
    return true
  }
  duplicateTab(id: string): string | null {
    const t = this.tabsY.get(id), src = this.sheets.get(id)
    if (!t || !src) return null
    return this.tx(() => {
      const nid = this.addTab(`${t.name} (copy)`)
      const dst = this.mirror(nid)
      src.cellsY.forEach((v, k) => dst.cellsY.set(k, { ...v }))
      src.dimsY.forEach((v, k) => dst.dimsY.set(k, v))
      if (src.mergesY.length) dst.mergesY.push(src.mergesY.toArray())
      this.moveTab(nid, this.tabList().findIndex((x) => x.id === id) + 1)
      return nid
    })
  }

  // ───────────── charts ─────────────
  addChart(sheet: string, chart: Omit<Chart, 'id'>) { const id = rid(); this.tx(() => this.mirror(sheet).chartsY.push([{ ...chart, id }])); return id }
  updateChart(sheet: string, id: string, patch: Partial<Chart>) {
    this.tx(() => {
      const arr = this.mirror(sheet).chartsY, i = arr.toArray().findIndex((c) => c.id === id)
      if (i < 0) return
      const cur = arr.get(i); arr.delete(i, 1); arr.insert(i, [{ ...cur, ...patch }])
    })
  }
  removeChart(sheet: string, id: string) {
    this.tx(() => { const arr = this.mirror(sheet).chartsY, i = arr.toArray().findIndex((c) => c.id === id); if (i >= 0) arr.delete(i, 1) })
  }

  // ───────────── history ─────────────
  undo() { this.history.undo(this.ydoc) }
  redo() { this.history.redo(this.ydoc) }
  canUndo() { return this.history.undoStack.length > 0 }
  canRedo() { return this.history.redoStack.length > 0 }
  stopCapturing() { this.history.stopCapturing() }

  /** Replace everything with the contents of another document (used to restore a saved version). */
  restoreFrom(snap: Y.Doc) {
    this.tx(() => {
      for (const id of [...this.tabsY.keys()]) {
        const m = this.sheets.get(id)
        if (m) { m.cellsY.clear(); m.dimsY.clear(); m.mergesY.delete(0, m.mergesY.length); m.chartsY.delete(0, m.chartsY.length) }
        this.tabsY.delete(id)
      }
      const st = snap.getMap<Tab>('tabs')
      st.forEach((tab, id) => {
        this.tabsY.set(id, tab)
        this.attach(id)
        const m = this.mirror(id)
        snap.getMap<CellData>('cells:' + id).forEach((v, k) => m.cellsY.set(k, v))
        snap.getMap<number>('dims:' + id).forEach((v, k) => m.dimsY.set(k, v))
        const mg = snap.getArray<number[]>('merges:' + id).toArray(); if (mg.length) m.mergesY.push(mg)
        const ch = snap.getArray<Chart>('charts:' + id).toArray(); if (ch.length) m.chartsY.push(ch)
      })
    })
  }

  /** Displayed text of a range as CSV-ready rows. */
  rows(sheet: string, rect: Rect): string[][] {
    const R = rectNorm(rect), out: string[][] = []
    for (let r = R.r1; r <= R.r2; r++) { const row: string[] = []; for (let c = R.c1; c <= R.c2; c++) row.push(this.display(sheet, r, c).text); out.push(row) }
    return out
  }
  isError(sheet: string, r: number, c: number) { return this.engine.value(sheet, r, c) instanceof CellError }
  headerLabel(c: number) { return colName(c) }
}

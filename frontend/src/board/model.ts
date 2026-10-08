import * as Y from 'yjs'

export type FieldType = 'text' | 'number' | 'date' | 'single' | 'multi' | 'checkbox' | 'link'
export interface Opt { id: string; label: string; color: string }
export interface FieldDef {
  name: string; type: FieldType; required?: boolean
  options?: Opt[]            // single / multi select
  hidden?: boolean           // not shown on the card face (still in the card dialog)
  min?: number | string; max?: number | string   // number or date limits
}
export interface Col { name: string; color: string }
export type Value = string | number | boolean | string[]
export interface Card { col: string; rank: number; title: string; desc?: string; v?: Record<string, Value>; at: number }

export const TYPE_LABEL: Record<FieldType, string> = { text: 'Text', number: 'Number', date: 'Date', single: 'Single select', multi: 'Multi select', checkbox: 'Checkbox', link: 'Link' }
export const COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#22c55e', '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#8b5cf6', '#64748b']
export const uid = () => Math.random().toString(36).slice(2, 10)

export const isEmpty = (v: Value | undefined) => v === undefined || v === '' || v === false || (Array.isArray(v) && v.length === 0)
export const isHttp = (s: string) => { try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:' } catch { return false } }

/** What is wrong with `v` for field `f`, or null. An empty value is only a problem when the field is required. */
export function problem(f: FieldDef, v: Value | undefined): string | null {
  if (isEmpty(v)) return f.required ? 'Required' : null
  if (f.type === 'number') {
    const n = Number(v)
    if (!Number.isFinite(n)) return 'Enter a number'
    if (f.min !== undefined && f.min !== '' && n < Number(f.min)) return `At least ${f.min}`
    if (f.max !== undefined && f.max !== '' && n > Number(f.max)) return `At most ${f.max}`
  }
  if (f.type === 'date') {
    const s = String(v)
    if (f.min && s < String(f.min)) return `On or after ${f.min}`
    if (f.max && s > String(f.max)) return `On or before ${f.max}`
  }
  if (f.type === 'link' && !isHttp(String(v))) return 'Enter a web link starting with http:// or https://'
  return null
}

/** The board lives in a Yjs doc so several people can work on it together.
 *  `colOrder` lists column ids, `cols` maps id -> Col, `fieldOrder` / `fields` do the same for the custom fields, `cards` maps id -> Card. */
export class BoardModel {
  colOrder: Y.Array<string>; cols: Y.Map<Col>
  fieldOrder: Y.Array<string>; fields: Y.Map<FieldDef>
  cards: Y.Map<Card>; meta: Y.Map<unknown>
  undo: Y.UndoManager
  version = 0
  private listeners = new Set<() => void>()

  constructor(public doc: Y.Doc) {
    this.colOrder = doc.getArray('colOrder'); this.cols = doc.getMap('cols')
    this.fieldOrder = doc.getArray('fieldOrder'); this.fields = doc.getMap('fields')
    this.cards = doc.getMap('cards'); this.meta = doc.getMap('meta')
    this.undo = new Y.UndoManager([this.colOrder, this.cols, this.fieldOrder, this.fields, this.cards, this.meta], { captureTimeout: 500, trackedOrigins: new Set([null, 'local']) })
    doc.on('update', this.bump)
  }
  private bump = () => { this.version++; this.listeners.forEach((l) => l()) }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  destroy() { this.doc.off('update', this.bump); this.undo.destroy(); this.listeners.clear() }
  private tx(fn: () => void) { this.doc.transact(fn, 'local') }

  getMeta<T>(k: string, d: T): T { const v = this.meta.get(k); return (v === undefined ? d : v) as T }
  setMeta(k: string, v: unknown) { this.tx(() => { if (v === undefined || v === '') this.meta.delete(k); else this.meta.set(k, v) }) }

  columns(): ({ id: string } & Col)[] { return this.colOrder.toArray().flatMap((id) => { const c = this.cols.get(id); return c ? [{ id, ...c }] : [] }) }
  fieldList(): ({ id: string } & FieldDef)[] { return this.fieldOrder.toArray().flatMap((id) => { const f = this.fields.get(id); return f ? [{ id, ...f }] : [] }) }
  cardsIn(col: string): ({ id: string } & Card)[] {
    const out: ({ id: string } & Card)[] = []
    this.cards.forEach((c, id) => { if (c.col === col) out.push({ id, ...c }) })
    return out.sort((a, b) => a.rank - b.rank || a.at - b.at)
  }
  card(id: string): ({ id: string } & Card) | null { const c = this.cards.get(id); return c ? { id, ...c } : null }

  /** A new board starts with the usual columns and two example fields, so there is something to see. */
  ensure() {
    if (this.colOrder.length > 0 || this.meta.get('seeded')) return
    this.tx(() => {
      const defs: [string, string][] = [['To do', '#64748b'], ['In progress', '#f59e0b'], ['Done', '#22c55e']]
      for (const [name, color] of defs) { const id = uid(); this.cols.set(id, { name, color }); this.colOrder.push([id]) }
      const pr = uid(), due = uid()
      this.fields.set(pr, { name: 'Priority', type: 'single', options: [{ id: uid(), label: 'Low', color: '#22c55e' }, { id: uid(), label: 'Medium', color: '#f59e0b' }, { id: uid(), label: 'High', color: '#ef4444' }] })
      this.fields.set(due, { name: 'Due date', type: 'date' })
      this.fieldOrder.push([pr, due]); this.meta.set('seeded', true)
    })
  }

  // columns
  addCol(name = 'New column'): string { const id = uid(); this.tx(() => { this.cols.set(id, { name, color: COLORS[this.colOrder.length % COLORS.length] }); this.colOrder.push([id]) }); return id }
  updateCol(id: string, patch: Partial<Col>) { const c = this.cols.get(id); if (c) this.tx(() => this.cols.set(id, { ...c, ...patch })) }
  moveCol(id: string, dir: -1 | 1) { const ids = this.colOrder.toArray(), i = ids.indexOf(id), j = i + dir; if (i < 0 || j < 0 || j >= ids.length) return; this.tx(() => { this.colOrder.delete(i, 1); this.colOrder.insert(j, [id]) }) }
  /** Removes a column; its cards go to `moveTo` (the neighbouring column), or are deleted when `moveTo` is null. */
  removeCol(id: string, moveTo: string | null) {
    this.tx(() => {
      const mine = this.cardsIn(id)
      if (moveTo) { const base = this.cardsIn(moveTo).length ? this.cardsIn(moveTo).slice(-1)[0].rank : 0; mine.forEach((c, i) => this.cards.set(c.id, { ...this.cards.get(c.id)!, col: moveTo, rank: base + i + 1 })) }
      else mine.forEach((c) => this.cards.delete(c.id))
      const i = this.colOrder.toArray().indexOf(id); if (i >= 0) this.colOrder.delete(i, 1)
      this.cols.delete(id)
    })
  }

  // cards
  addCard(col: string, title: string, v?: Record<string, Value>, desc?: string): string {
    const id = uid(), last = this.cardsIn(col).slice(-1)[0]
    this.tx(() => this.cards.set(id, { col, rank: (last?.rank ?? 0) + 1, title, ...(desc ? { desc } : {}), ...(v && Object.keys(v).length ? { v } : {}), at: Date.now() }))
    return id
  }
  updateCard(id: string, patch: Partial<Pick<Card, 'title' | 'desc'>>) { const c = this.cards.get(id); if (c) this.tx(() => this.cards.set(id, { ...c, ...patch })) }
  setValue(id: string, field: string, value: Value | undefined) {
    const c = this.cards.get(id); if (!c) return
    const v = { ...(c.v ?? {}) }
    if (value === undefined || isEmpty(value)) delete v[field]; else v[field] = value
    const next: Card = { ...c, v }; if (!Object.keys(v).length) delete next.v
    this.tx(() => this.cards.set(id, next))
  }
  removeCard(id: string) { this.tx(() => this.cards.delete(id)) }
  /** Put a card in `col`, just before `before` (or at the end when null). */
  moveCard(id: string, col: string, before: string | null) {
    const c = this.cards.get(id); if (!c) return
    const sibs = this.cardsIn(col).filter((x) => x.id !== id)
    const i = before ? sibs.findIndex((x) => x.id === before) : -1
    let rank: number
    if (i < 0) rank = (sibs.slice(-1)[0]?.rank ?? 0) + 1
    else if (i === 0) rank = sibs[0].rank - 1
    else rank = (sibs[i - 1].rank + sibs[i].rank) / 2
    this.tx(() => this.cards.set(id, { ...c, col, rank }))
  }

  // fields
  addField(type: FieldType): string {
    const id = uid()
    const f: FieldDef = { name: TYPE_LABEL[type], type, ...(type === 'single' || type === 'multi' ? { options: [{ id: uid(), label: 'Option 1', color: COLORS[0] }, { id: uid(), label: 'Option 2', color: COLORS[1] }] } : {}) }
    this.tx(() => { this.fields.set(id, f); this.fieldOrder.push([id]) }); return id
  }
  updateField(id: string, patch: Partial<FieldDef>) {
    const f = this.fields.get(id); if (!f) return
    const next: Record<string, unknown> = { ...f, ...patch }
    for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === '' || next[k] === false) delete next[k]
    this.tx(() => this.fields.set(id, next as unknown as FieldDef))
  }
  moveField(id: string, dir: -1 | 1) { const ids = this.fieldOrder.toArray(), i = ids.indexOf(id), j = i + dir; if (i < 0 || j < 0 || j >= ids.length) return; this.tx(() => { this.fieldOrder.delete(i, 1); this.fieldOrder.insert(j, [id]) }) }
  removeField(id: string) {
    this.tx(() => {
      const i = this.fieldOrder.toArray().indexOf(id); if (i >= 0) this.fieldOrder.delete(i, 1)
      this.fields.delete(id)
      this.cards.forEach((c, cid) => { if (c.v && id in c.v) { const v = { ...c.v }; delete v[id]; const n: Card = { ...c, v }; if (!Object.keys(v).length) delete n.v; this.cards.set(cid, n) } })
    })
  }
  /** Cards missing a value a required field asks for (or holding a value that breaks a field's limits). */
  issues(c: Card, fields: ({ id: string } & FieldDef)[]): { field: string; msg: string }[] {
    return fields.flatMap((f) => { const m = problem(f, c.v?.[f.id]); return m ? [{ field: f.name, msg: m }] : [] })
  }
}

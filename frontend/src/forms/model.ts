import * as Y from 'yjs'

export type ItemType = 'color' | 'file' | 'short' | 'long' | 'number' | 'email' | 'url' | 'date' | 'time' | 'radio' | 'checkbox' | 'select' | 'scale' | 'section' | 'info' | 'media' | 'page'

export type CondOp = 'is' | 'isnot' | 'contains' | 'filled' | 'empty' | 'gt' | 'lt'
export interface Cond { q: string; op: CondOp; v?: string }
export interface ShowIf { match: 'all' | 'any'; rules: Cond[] }

export interface FormItem {
  id: string; type: ItemType; title: string; help?: string; required?: boolean
  options?: string[]; other?: boolean; placeholder?: string
  minLen?: number; maxLen?: number; pattern?: string; patternMsg?: string
  min?: number | string; max?: number | string; integer?: boolean
  minSel?: number; maxSel?: number
  showIf?: ShowIf; jumps?: Record<string, string>   // logic: only show when the rules hold / where each answer sends the filler
  maxMB?: number; accept?: 'images' | 'pdf' | 'docs'     // file upload questions
  media?: 'image' | 'video'; src?: string; size?: 'small' | 'medium' | 'full'
  scaleMin?: number; scaleMax?: number; minLabel?: string; maxLabel?: string
}

/** What people filling the form get (also what the preview renders). */
export interface PublicForm {
  title: string; description: string; accent?: string; accepting: boolean; requireLogin: boolean; oneResponse: boolean; confirmation: string
  items: FormItem[]
}

export const ANSWERABLE: ItemType[] = ['color', 'file', 'short', 'long', 'number', 'email', 'url', 'date', 'time', 'radio', 'checkbox', 'select', 'scale']
export const hasOptions = (t: ItemType) => t === 'radio' || t === 'checkbox' || t === 'select'

export const TYPE_LABEL: Record<ItemType, string> = {
  color: 'Colour', file: 'File upload', short: 'Short answer', long: 'Paragraph', number: 'Number', email: 'Email', url: 'Link', date: 'Date', time: 'Time',
  radio: 'Single choice', checkbox: 'Multiple choice', select: 'Dropdown', scale: 'Linear scale', section: 'Heading', info: 'Info block', media: 'Image / video', page: 'New page',
}

const uid = () => Math.random().toString(36).slice(2, 10)

export function defaults(type: ItemType): Omit<FormItem, 'id'> {
  switch (type) {
    case 'radio': case 'checkbox': case 'select': return { type, title: 'Untitled question', options: ['Option 1', 'Option 2'] }
    case 'scale': return { type, title: 'Untitled question', scaleMin: 1, scaleMax: 5 }
    case 'info': return { type, title: 'Add a note for the people filling this out.' }
    case 'color': return { type, title: 'Pick a colour' }
    case 'file': return { type, title: 'Upload a file', maxMB: 3 }
    case 'media': return { type, title: '', media: 'image', size: 'medium' }
    case 'section': return { type, title: 'Section title' }
    case 'page': return { type, title: 'Next page' }
    default: return { type, title: 'Untitled question' }
  }
}

/** The form lives in a Yjs doc so several people can build it together:
 *  `order` lists item ids, `items` maps id -> a plain JSON item, `meta` holds settings. */
export class FormModel {
  order: Y.Array<string>
  items: Y.Map<Omit<FormItem, 'id'>>
  meta: Y.Map<unknown>
  undo: Y.UndoManager
  version = 0
  private listeners = new Set<() => void>()

  constructor(public doc: Y.Doc) {
    this.order = doc.getArray('order')
    this.items = doc.getMap('items')
    this.meta = doc.getMap('meta')
    this.undo = new Y.UndoManager([this.order, this.items, this.meta], { captureTimeout: 500, trackedOrigins: new Set([null, 'local']) })
    doc.on('update', this.bump)
  }
  private bump = () => { this.version++; this.listeners.forEach((l) => l()) }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  destroy() { this.doc.off('update', this.bump); this.undo.destroy(); this.listeners.clear() }

  read(): FormItem[] {
    const out: FormItem[] = []
    for (const id of this.order.toArray()) {
      const it = this.items.get(id)
      if (it) out.push({ ...it, id })
    }
    return out
  }
  getMeta<T>(key: string, fallback: T): T { const v = this.meta.get(key); return (v === undefined ? fallback : v) as T }
  setMeta(key: string, value: unknown) { this.doc.transact(() => { this.meta.set(key, value) }, 'local') }

  add(type: ItemType, afterId?: string | null): string {
    const id = uid()
    this.doc.transact(() => {
      this.items.set(id, defaults(type))
      const at = afterId ? this.order.toArray().indexOf(afterId) : -1
      this.order.insert(at < 0 ? this.order.length : at + 1, [id])
    }, 'local')
    return id
  }
  update(id: string, patch: Partial<FormItem>) {
    const cur = this.items.get(id) as Record<string, unknown> | undefined
    if (!cur) return
    const next: Record<string, unknown> = { ...cur, ...patch }
    for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === '' || next[k] === null || next[k] === false) delete next[k]
    this.doc.transact(() => { this.items.set(id, next as Omit<FormItem, 'id'>) }, 'local')
  }
  /** Switch type, keeping what still makes sense. */
  retype(id: string, type: ItemType) {
    const cur = this.items.get(id) as FormItem | undefined
    if (!cur) return
    const d = defaults(type)
    this.doc.transact(() => {
      this.items.set(id, { type, title: cur.title, ...(cur.help ? { help: cur.help } : {}), ...(cur.showIf ? { showIf: cur.showIf } : {}), ...(cur.jumps && (type === 'radio' || type === 'select') ? { jumps: cur.jumps } : {}),
        ...(cur.required && type !== 'section' && type !== 'page' ? { required: true } : {}),
        ...(hasOptions(type) ? { options: hasOptions(cur.type) && cur.options?.length ? cur.options : d.options } : {}),
        ...(type === 'scale' ? { scaleMin: 1, scaleMax: 5 } : {}) } as Omit<FormItem, 'id'>)
    }, 'local')
  }
  remove(id: string) {
    this.doc.transact(() => {
      const i = this.order.toArray().indexOf(id)
      if (i >= 0) this.order.delete(i, 1)
      this.items.delete(id)
    }, 'local')
  }
  duplicate(id: string): string | null {
    const cur = this.items.get(id) as FormItem | undefined
    if (!cur) return null
    const nid = uid()
    this.doc.transact(() => {
      this.items.set(nid, JSON.parse(JSON.stringify(cur)))
      this.order.insert(this.order.toArray().indexOf(id) + 1, [nid])
    }, 'local')
    return nid
  }
  move(id: string, dir: -1 | 1) {
    const ids = this.order.toArray(), i = ids.indexOf(id), j = i + dir
    if (i < 0 || j < 0 || j >= ids.length) return
    this.doc.transact(() => { this.order.delete(i, 1); this.order.insert(j, [id]) }, 'local')
  }
  /** Drag and drop: put `id` where `target` is. */
  moveTo(id: string, target: string) {
    const ids = this.order.toArray(), i = ids.indexOf(id), j = ids.indexOf(target)
    if (i < 0 || j < 0 || i === j) return
    this.doc.transact(() => { this.order.delete(i, 1); this.order.insert(j, [id]) }, 'local')
  }
  /** A brand-new form starts with one question so there is something to see. */
  ensure() { if (this.order.length === 0) this.add('radio') }
}

export type Answers = Record<string, string | string[]>

/** Items grouped into pages: a `page` item starts a new one. */
export function paginate(items: FormItem[]): { head: FormItem | null; items: FormItem[] }[] {
  const pages: { head: FormItem | null; items: FormItem[] }[] = [{ head: null, items: [] }]
  for (const it of items) { if (it.type === 'page') pages.push({ head: it, items: [] }); else pages[pages.length - 1].items.push(it) }
  return pages
}

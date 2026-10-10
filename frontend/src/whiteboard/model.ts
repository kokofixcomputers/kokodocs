import * as Y from 'yjs'
import { DEFAULT_STYLE, isLinear, type El, type Style } from './types'
import { boundsOf, reroute } from './geometry'

const ORIGIN = 'whiteboard-local'
const uid = () => Math.random().toString(36).slice(2, 10)

/** The shared board: elements by id, the title and canvas colour, and your own undo history. Everything that changes the board goes through here, so one gesture is one undo step. */
export class WhiteboardModel {
  readonly els: Y.Map<El>
  readonly meta: Y.Map<unknown>
  readonly undo: Y.UndoManager
  version = 0
  private cache: El[] | null = null
  private subs = new Set<() => void>()
  private off: (() => void)[] = []

  constructor(readonly doc: Y.Doc) {
    this.els = doc.getMap('els'); this.meta = doc.getMap('meta')
    this.undo = new Y.UndoManager([this.els], { trackedOrigins: new Set([ORIGIN]), captureTimeout: 350 })
    const f = () => { this.cache = null; this.version++; this.subs.forEach((s) => s()) }
    this.els.observe(f); this.meta.observe(f)
    this.undo.on('stack-item-added', f); this.undo.on('stack-item-popped', f)
    this.off.push(() => { this.els.unobserve(f); this.meta.unobserve(f); this.undo.destroy() })
  }
  subscribe(f: () => void) { this.subs.add(f); return () => { this.subs.delete(f) } }
  destroy() { this.off.forEach((o) => o()); this.subs.clear() }

  /** every element, back to front */
  read(): El[] {
    return (this.cache ??= [...this.els.values()].sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1)))
  }
  get(id: string): El | undefined { return this.els.get(id) }
  private tx(f: () => void) { this.doc.transact(f, ORIGIN) }
  private top() { let z = 0; for (const e of this.els.values()) if (e.z > z) z = e.z; return z }
  private bottom() { let z = 0; for (const e of this.els.values()) if (e.z < z) z = e.z; return z }

  make(type: El['type'], p: Partial<El> = {}, style: Partial<Style> = {}): El {
    const s = { ...DEFAULT_STYLE, ...style }
    return {
      id: uid(), type, x: 0, y: 0, w: 0, h: 0, a: 0, z: 0, stroke: s.stroke, fill: s.fill, fs: s.fs, sw: s.sw, ss: s.ss, ro: s.ro, op: s.op, rad: s.rad,
      seed: Math.floor(Math.random() * 2 ** 31), ...p,
    }
  }
  /** put elements on the board, in front of what is there; returns the ids */
  add(list: El[]): string[] {
    const ids: string[] = []
    this.tx(() => {
      let z = this.top()
      for (const e of list) { const el = { ...e, z: ++z }; if (isLinear(el.type)) Object.assign(el, boundsOf(el, true)); this.els.set(el.id, el); ids.push(el.id) }
      this.rebind(ids)
    })
    return ids
  }
  update(id: string, p: Partial<El>) { this.updateMany({ [id]: p }) }
  /** change several elements at once (a move, a resize, a colour); arrows tied to them follow */
  updateMany(patches: Record<string, Partial<El>>) {
    const ids = Object.keys(patches).filter((id) => this.els.has(id))
    if (!ids.length) return
    this.tx(() => {
      for (const id of ids) {
        const cur = this.els.get(id)!; const next: El = { ...cur, ...patches[id] }
        for (const k of Object.keys(next) as (keyof El)[]) if (next[k] === undefined) delete next[k]
        if (isLinear(next.type) && patches[id].pts) Object.assign(next, boundsOf(next, true))
        this.els.set(id, next)
      }
      this.rebind(ids)
    })
  }
  remove(ids: string[]) {
    this.tx(() => {
      const gone = new Set(ids)
      for (const id of ids) this.els.delete(id)
      for (const e of [...this.els.values()]) if ((e.from && gone.has(e.from.id)) || (e.to && gone.has(e.to.id))) { const n = { ...e }; if (e.from && gone.has(e.from.id)) delete n.from; if (e.to && gone.has(e.to.id)) delete n.to; this.els.set(e.id, n) }
    })
  }
  /** arrows that are tied to any of these shapes are drawn again from where the shapes now are */
  private rebind(moved: string[]) {
    const set = new Set(moved)
    for (const e of [...this.els.values()]) {
      if (e.type !== 'arrow' && e.type !== 'line') continue
      if (!((e.from && set.has(e.from.id)) || (e.to && set.has(e.to.id)) || set.has(e.id))) continue
      const n = reroute(e, (id) => this.els.get(id))
      if (n) this.els.set(e.id, n)
    }
  }
  reorder(ids: string[], how: 'front' | 'back' | 'forward' | 'backward') {
    const all = this.read(), pick = new Set(ids), mine = all.filter((e) => pick.has(e.id))
    if (!mine.length) return
    this.tx(() => {
      if (how === 'front') { let z = this.top(); for (const e of mine) this.els.set(e.id, { ...e, z: ++z }) }
      else if (how === 'back') { let z = this.bottom() - mine.length; for (const e of mine) this.els.set(e.id, { ...e, z: ++z }) }
      else {
        // swap each with its neighbour, skipping over the others in the selection
        const order = all.map((e) => e.id); const dir = how === 'forward' ? 1 : -1
        const seq = dir > 0 ? [...mine].reverse() : mine
        for (const e of seq) {
          const i = order.indexOf(e.id); let j = i + dir
          while (j >= 0 && j < order.length && pick.has(order[j])) j += dir
          if (j < 0 || j >= order.length) continue
          order.splice(i, 1); order.splice(j, 0, e.id)
        }
        order.forEach((id, i) => { const e = this.els.get(id)!; if (e.z !== i) this.els.set(id, { ...e, z: i }) })
      }
    })
  }
  /** move a layer to a place in the list (0 = very back) */
  moveTo(id: string, index: number) {
    const order = this.read().map((e) => e.id).filter((x) => x !== id)
    order.splice(Math.max(0, Math.min(index, order.length)), 0, id)
    this.tx(() => order.forEach((x, i) => { const e = this.els.get(x)!; if (e.z !== i) this.els.set(x, { ...e, z: i }) }))
  }
  duplicate(ids: string[], dx = 24, dy = 24): string[] {
    const src = this.read().filter((e) => ids.includes(e.id)), map = new Map<string, string>()
    src.forEach((e) => map.set(e.id, uid()))
    const gmap = new Map<string, string>()
    const copies = src.map((e) => {
      const c: El = { ...structuredClone(e), id: map.get(e.id)!, x: e.x + dx, y: e.y + dy, seed: Math.floor(Math.random() * 2 ** 31) }
      if (e.grp) { if (!gmap.has(e.grp)) gmap.set(e.grp, uid()); c.grp = gmap.get(e.grp) }
      if (e.from) { if (map.has(e.from.id)) c.from = { id: map.get(e.from.id)! }; else delete c.from }
      if (e.to) { if (map.has(e.to.id)) c.to = { id: map.get(e.to.id)! }; else delete c.to }
      return c
    })
    return this.add(copies)
  }
  group(ids: string[]) { const g = uid(); this.updateMany(Object.fromEntries(ids.map((i) => [i, { grp: g }]))) }
  ungroup(ids: string[]) { this.updateMany(Object.fromEntries(ids.map((i) => [i, { grp: undefined }]))) }

  getMeta<T>(k: string, d: T): T { const v = this.meta.get(k); return (v === undefined ? d : v) as T }
  setMeta(k: string, v: unknown) { this.tx(() => this.meta.set(k, v)) }
  clear() { this.tx(() => { for (const id of [...this.els.keys()]) this.els.delete(id) }) }
  /** put another version of the board in place of this one (restoring from history) */
  restoreFrom(snap: Y.Doc) {
    this.doc.transact(() => {
      const src = snap.getMap<El>('els')
      for (const id of [...this.els.keys()]) if (!src.has(id)) this.els.delete(id)
      src.forEach((v, id) => this.els.set(id, structuredClone(v)))
      const m = snap.getMap('meta'); m.forEach((v, k) => { if (k !== 'title') this.meta.set(k, v) })
    }, 'whiteboard-restore')
  }
}

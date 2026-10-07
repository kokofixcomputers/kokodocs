import * as Y from 'yjs'
import { layoutElements, themeById, withFonts, type Theme, type El, type LayoutId, type Slide, type SlideContent } from './themes'

export interface ImportedSlide { notes: string; els: (Partial<El> & { type: El['type']; x: number; y: number; w: number; h: number })[] }
const uid = () => Math.random().toString(36).slice(2, 10)

/** A presentation stored in Yjs: an ordered list of slide ids, a map of slides (notes, background, elements), and deck meta. */
export class SlidesModel {
  order: Y.Array<string>
  slides: Y.Map<Y.Map<any>>
  meta: Y.Map<any>
  version = 0
  undo: Y.UndoManager
  private cache: Slide[] | null = null
  private listeners = new Set<() => void>()
  private raf = 0
  private onUpdate = () => {
    this.cache = null   // reads are always fresh; the version bump (which re-renders the UI) is batched to one frame
    if (typeof requestAnimationFrame === 'undefined') { this.version++; this.listeners.forEach((l) => l()); return }
    cancelAnimationFrame(this.raf); this.raf = requestAnimationFrame(() => { this.version++; this.listeners.forEach((l) => l()) })
  }

  constructor(public doc: Y.Doc) {
    this.order = doc.getArray<string>('order')
    this.slides = doc.getMap<Y.Map<any>>('slides')
    this.meta = doc.getMap<any>('meta')
    this.undo = new Y.UndoManager([this.order, this.slides, this.meta], { captureTimeout: 500, trackedOrigins: new Set([null, 'local']) })
    doc.on('update', this.onUpdate)
  }
  destroy() { if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.raf); this.doc.off('update', this.onUpdate); this.undo.destroy() }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }

  // ───────────── reading ─────────────
  ids(): string[] { const seen = new Set<string>(); return this.order.toArray().filter((i) => this.slides.has(i) && !seen.has(i) && !!seen.add(i)) }
  read(): Slide[] {
    if (this.cache) return this.cache
    return (this.cache = this.ids().map((id) => this.readSlide(id)!))
  }
  readSlide(id: string): Slide | null {
    const s = this.slides.get(id); if (!s) return null
    const els: El[] = []
    ;(s.get('els') as Y.Map<Y.Map<any>> | undefined)?.forEach((e, eid) => { const o = e.toJSON() as El; o.id = eid; els.push(o) })
    els.sort((a, b) => (a.z ?? 0) - (b.z ?? 0))
    return { id, notes: s.get('notes') ?? '', bg: s.get('bg') ?? null, els }
  }
  get theme(): string { return this.meta.get('theme') ?? 'mono' }
  get headFont(): string | undefined { return this.meta.get('headFont') || undefined }
  get bodyFont(): string | undefined { return this.meta.get('bodyFont') || undefined }
  /** The theme plus any fonts the deck picked for headings and body text. */
  deckTheme(): Theme { return withFonts(themeById(this.theme), this.headFont, this.bodyFont) }
  setDeckFont(which: 'head' | 'body', family: string | null) { this.t(() => { const k = which === 'head' ? 'headFont' : 'bodyFont'; if (family) this.meta.set(k, family); else this.meta.delete(k) }) }
  get transition(): string { return this.meta.get('transition') ?? 'fade' }
  get title(): string { return this.meta.get('title') ?? '' }

  // ───────────── writing ─────────────
  private t<T>(fn: () => T): T { let r!: T; this.doc.transact(() => { r = fn() }, 'local'); return r }
  private writeEl(els: Y.Map<Y.Map<any>>, e: Partial<El> & { id: string }) {
    const m = new Y.Map<any>()
    Object.entries(e).forEach(([k, v]) => {
      if (v === undefined || k === 'id') return
      if (k === 'cells') { const cm = new Y.Map<string>(); Object.entries(v as Record<string, string>).forEach(([ck, cv]) => cm.set(ck, cv)); m.set('cells', cm) } else m.set(k, v)
    })
    els.set(e.id, m)
  }
  private makeSlide(id: string, s?: Partial<Slide>): Y.Map<any> {
    const m = new Y.Map<any>()
    m.set('notes', s?.notes ?? ''); m.set('bg', s?.bg ?? null)
    const els = new Y.Map<Y.Map<any>>()
    m.set('els', els)
    ;(s?.els ?? []).forEach((e, i) => this.writeEl(els, { ...e, z: e.z ?? i }))
    void id
    return m
  }
  ensureDeck() {
    if (this.order.length > 0) { this.dedupe(); return }
    this.t(() => {
      if (this.order.length > 0) return
      const els = layoutElements('title').map((e, i) => ({ ...e, id: uid(), z: i }))
      this.slides.set('s1', this.makeSlide('s1', { els }))
      this.order.push(['s1'])
    })
  }
  private dedupe() {
    const arr = this.order.toArray(), seen = new Set<string>()
    const drop: number[] = []
    arr.forEach((id, i) => { if (seen.has(id) || !this.slides.has(id)) drop.push(i); seen.add(id) })
    if (drop.length) this.t(() => drop.reverse().forEach((i) => this.order.delete(i, 1)))
  }
  addSlide(layout: LayoutId, after?: number, content?: SlideContent, notes = ''): string {
    return this.t(() => {
      const id = uid()
      const els = layoutElements(layout, content).map((e, i) => ({ ...e, id: uid(), z: i }))
      this.slides.set(id, this.makeSlide(id, { els, notes }))
      const n = this.order.length
      this.order.insert(after === undefined ? n : Math.min(n, after + 1), [id])
      return id
    })
  }
  duplicateSlide(id: string): string | null {
    const s = this.readSlide(id); if (!s) return null
    return this.t(() => {
      const nid = uid()
      this.slides.set(nid, this.makeSlide(nid, { notes: s.notes, bg: s.bg, els: s.els.map((e) => ({ ...e, id: uid() })) }))
      this.order.insert(this.order.toArray().indexOf(id) + 1, [nid])
      return nid
    })
  }
  deleteSlide(id: string) {
    if (this.ids().length <= 1) return
    this.t(() => { this.order.toArray().forEach((x, i) => { if (x === id) this.order.delete(i, 1) }); this.slides.delete(id) })
  }
  moveSlide(id: string, to: number) {
    this.t(() => {
      const arr = this.order.toArray(); const from = arr.indexOf(id); if (from < 0) return
      this.order.delete(from, 1)
      this.order.insert(Math.max(0, Math.min(to, this.order.length)), [id])
    })
  }
  setNotes(id: string, notes: string) { this.t(() => this.slides.get(id)?.set('notes', notes)) }
  setBg(id: string, bg: string | null) { this.t(() => this.slides.get(id)?.set('bg', bg)) }
  private elsOf(slideId: string) { return this.slides.get(slideId)?.get('els') as Y.Map<Y.Map<any>> | undefined }
  addEl(slideId: string, e: Omit<El, 'id' | 'z'> & { id?: string }): string | null {
    return this.t(() => {
      const els = this.elsOf(slideId); if (!els) return null
      let top = 0; els.forEach((x) => { top = Math.max(top, x.get('z') ?? 0) })
      const id = e.id ?? uid()
      this.writeEl(els, { ...e, id, z: top + 1 })
      return id
    })
  }
  updateEl(slideId: string, elId: string, patch: Partial<El>) {
    this.t(() => {
      const m = this.elsOf(slideId)?.get(elId); if (!m) return
      Object.entries(patch).forEach(([k, v]) => {
        if (k === 'id') return
        if (k === 'cells') { const cm = new Y.Map<string>(); Object.entries((v ?? {}) as Record<string, string>).forEach(([ck, cv]) => cm.set(ck, cv)); m.set('cells', cm); return }
        if (v === undefined) m.delete(k); else if (m.get(k) !== v) m.set(k, v)
      })
    })
  }
  updateMany(slideId: string, patches: Record<string, Partial<El>>) {
    this.t(() => Object.entries(patches).forEach(([id, p]) => this.updateEl(slideId, id, p)))
  }
  /** Edit one table or chart cell without touching the others, so two people editing different cells don't overwrite each other. */
  setCell(slideId: string, elId: string, r: number, c: number, text: string) {
    this.t(() => {
      const m = this.elsOf(slideId)?.get(elId); if (!m) return
      let cm = m.get('cells') as Y.Map<string> | undefined
      if (!cm) { cm = new Y.Map<string>(); m.set('cells', cm) }
      const k = `${r}:${c}`
      if (text === '') cm.delete(k); else if (cm.get(k) !== text) cm.set(k, text)
    })
  }
  deleteEls(slideId: string, ids: string[]) { this.t(() => { const els = this.elsOf(slideId); ids.forEach((i) => els?.delete(i)) }) }
  duplicateEls(slideId: string, ids: string[]): string[] {
    const s = this.readSlide(slideId); if (!s) return []
    return this.t(() => s.els.filter((e) => ids.includes(e.id)).map((e) => this.addEl(slideId, { ...e, id: undefined, x: e.x + 24, y: e.y + 24 } as never)!).filter(Boolean))
  }
  reorder(slideId: string, ids: string[], where: 'front' | 'back' | 'forward' | 'backward') {
    const s = this.readSlide(slideId); if (!s) return
    const list = s.els.map((e) => e.id)
    const sel = list.filter((i) => ids.includes(i)), rest = list.filter((i) => !ids.includes(i))
    let next: string[]
    if (where === 'front') next = [...rest, ...sel]
    else if (where === 'back') next = [...sel, ...rest]
    else {
      next = [...list]
      const step = where === 'forward' ? 1 : -1
      const idx = where === 'forward' ? [...sel].reverse() : sel
      idx.forEach((id) => { const i = next.indexOf(id), j = i + step; if (j >= 0 && j < next.length && !sel.includes(next[j])) { [next[i], next[j]] = [next[j], next[i]] } })
    }
    this.t(() => next.forEach((id, z) => this.elsOf(slideId)?.get(id)?.set('z', z)))
  }
  setMeta(k: 'theme' | 'transition' | 'title', v: string) { this.t(() => this.meta.set(k, v)) }

  /** Replace the deck with slides built from layouts (used by templates). */
  buildDeck(spec: { layout: LayoutId; content?: SlideContent; notes?: string }[], theme = 'mono') {
    this.importSlides(spec.map((x) => ({ notes: x.notes ?? '', els: layoutElements(x.layout, x.content) as ImportedSlide['els'] })), theme)
  }
  /** Replace the whole deck with slides read from another file (a PowerPoint import). */
  importSlides(slides: ImportedSlide[], theme = 'mono') {
    this.t(() => {
      this.order.delete(0, this.order.length)
      Array.from(this.slides.keys()).forEach((k) => this.slides.delete(k))
      const list = slides.length ? slides : [{ notes: '', els: [] }]
      list.forEach((s) => { const id = uid(); this.slides.set(id, this.makeSlide(id, { notes: s.notes, els: s.els.map((e, i) => ({ ...e, id: uid(), z: i })) as El[] })); this.order.push([id]) })
      this.meta.set('theme', theme)
    })
  }

  /** Replace everything with another deck's content (used when restoring a version). */
  restoreFrom(snap: Y.Doc) {
    const other = new SlidesModel(snap)
    const slides = other.read(), theme = other.theme, transition = other.transition, headFont = other.headFont, bodyFont = other.bodyFont
    other.destroy()
    this.t(() => {
      this.order.delete(0, this.order.length)
      Array.from(this.slides.keys()).forEach((k) => this.slides.delete(k))
      slides.forEach((s) => { this.slides.set(s.id, this.makeSlide(s.id, s)); this.order.push([s.id]) })
      this.meta.set('theme', theme); this.meta.set('transition', transition)
      if (headFont) this.meta.set('headFont', headFont); else this.meta.delete('headFont')
      if (bodyFont) this.meta.set('bodyFont', bodyFont); else this.meta.delete('bodyFont')
    })
  }
}

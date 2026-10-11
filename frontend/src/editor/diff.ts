import * as Y from 'yjs'
import { addr } from '../sheet/engine/refs'
import { children, type Entry, type Tree } from '../wiki/tree'

/** Comparing two versions of a file. Each kind is flattened into comparable text, then diffed:
 *  documents as an ordered list of lines (LCS), spreadsheets and presentations as keyed items (cell, slide element). */
export type Part = { t: 'same' | 'add' | 'del'; text: string }
export type Row =
  | { kind: 'same'; text: string }
  | { kind: 'add' | 'del'; text: string; label?: string }
  | { kind: 'mod'; parts: Part[]; label?: string }
  | { kind: 'gap'; count: number }
export interface Diff { rows: Row[]; added: number; removed: number; changed: number; same: boolean }

const MAX_LCS = 6_000_000

/** Longest-common-subsequence diff of two arrays. Falls back to "all removed, all added" for huge inputs. */
export function lcs<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean = (x, y) => x === y): { t: 'same' | 'add' | 'del'; a?: T; b?: T }[] {
  let s = 0
  while (s < a.length && s < b.length && eq(a[s], b[s])) s++
  let ea = a.length, eb = b.length
  while (ea > s && eb > s && eq(a[ea - 1], b[eb - 1])) { ea--; eb-- }
  const A = a.slice(s, ea), B = b.slice(s, eb)
  const out: { t: 'same' | 'add' | 'del'; a?: T; b?: T }[] = a.slice(0, s).map((x, i) => ({ t: 'same' as const, a: x, b: b[i] }))
  if (A.length * B.length > MAX_LCS) {
    A.forEach((x) => out.push({ t: 'del', a: x })); B.forEach((x) => out.push({ t: 'add', b: x }))
  } else {
    const n = A.length, m = B.length, w = m + 1
    const dp = new Uint32Array((n + 1) * w)
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i * w + j] = eq(A[i], B[j]) ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1])
    let i = 0, j = 0
    while (i < n && j < m) {
      if (eq(A[i], B[j])) { out.push({ t: 'same', a: A[i], b: B[j] }); i++; j++ }
      else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) out.push({ t: 'del', a: A[i++] })
      else out.push({ t: 'add', b: B[j++] })
    }
    while (i < n) out.push({ t: 'del', a: A[i++] })
    while (j < m) out.push({ t: 'add', b: B[j++] })
  }
  for (let k = ea; k < a.length; k++) out.push({ t: 'same', a: a[k], b: b[eb + (k - ea)] })
  return out
}

/** Word-level diff of two strings (whitespace kept so the result reads naturally). */
export function wordDiff(a: string, b: string): Part[] {
  const tok = (s: string) => s.match(/\s+|[^\s]+/g) ?? []
  const parts: Part[] = []
  for (const o of lcs(tok(a), tok(b))) {
    const text = (o.t === 'add' ? o.b : o.a) as string
    const last = parts[parts.length - 1]
    if (last && last.t === o.t) last.text += text; else parts.push({ t: o.t, text })
  }
  return parts
}

// ── documents ──────────────────────────────────────────────────────────────
const INLINE_ATOMS: Record<string, (el: Y.XmlElement) => string> = { emoji: (el) => String(el.getAttribute('char') ?? ''), hardBreak: () => ' ', docShape: (el) => (el.getAttribute('text') ? `[Shape: ${String(el.getAttribute('text'))}]` : '[Shape]'), wikiBadge: (el) => `[${String(el.getAttribute('label') ?? '')}]` }

function inlineText(el: Y.XmlElement): string {
  let s = ''
  for (const c of el.toArray()) {
    if (c instanceof Y.XmlText) for (const d of c.toDelta() as { insert?: unknown }[]) { if (typeof d.insert === 'string') s += d.insert }
    else if (c instanceof Y.XmlElement) s += INLINE_ATOMS[c.nodeName]?.(c) ?? ''
  }
  return s
}

export function docLines(doc: Y.Doc): string[] { return fragLines(doc.getXmlFragment('default')) }

export function fragLines(root: Y.XmlFragment): string[] {
  const out: string[] = []
  const walk = (el: Y.XmlElement | Y.XmlFragment, prefix: string) => {
    for (const c of el.toArray()) {
      if (!(c instanceof Y.XmlElement)) continue
      const name = c.nodeName
      if (name === 'image') { out.push('[Image]'); continue }
      if (name === 'horizontalRule') { out.push('────'); continue }
      if (name === 'wikiTab') out.push(`[Tab: ${String(c.getAttribute('title') ?? '')}]`)
      if (name === 'apiRequest') { out.push(`[Request] ${String(c.getAttribute('method') ?? 'GET')} ${String(c.getAttribute('url') ?? '')}`); continue }
      const kids = c.toArray()
      const leaf = kids.some((k) => k instanceof Y.XmlText || (k instanceof Y.XmlElement && INLINE_ATOMS[k.nodeName])) || kids.length === 0
      if (leaf) {
        const t = inlineText(c).trim()
        if (!t && name !== 'paragraph') { if (kids.length === 0) continue }
        if (!t) continue
        const lvl = name === 'heading' ? '#'.repeat(Math.min(6, Number(c.getAttribute('level')) || 1)) + ' ' : ''
        out.push(prefix + lvl + t)
      } else {
        const p = name === 'bulletList' ? '• ' : name === 'orderedList' ? '1. ' : name === 'taskItem' ? (c.getAttribute('checked') ? '☑ ' : '☐ ') : name === 'blockquote' ? '> ' : ''
        walk(c, name === 'bulletList' || name === 'orderedList' ? p : p || prefix)
      }
    }
  }
  walk(root, '')
  return out
}

export function diffLines(a: string[], b: string[], context = 2): Diff {
  const ops = lcs(a, b)
  const rows: Row[] = []
  let added = 0, removed = 0, changed = 0
  for (let i = 0; i < ops.length;) {
    if (ops[i].t === 'same') { rows.push({ kind: 'same', text: ops[i].a as string }); i++; continue }
    const dels: string[] = [], adds: string[] = []
    while (i < ops.length && ops[i].t !== 'same') { if (ops[i].t === 'del') dels.push(ops[i].a as string); else adds.push(ops[i].b as string); i++ }
    // pair removed and added lines up as edits to the same line
    const pairs = Math.min(dels.length, adds.length)
    for (let k = 0; k < pairs; k++) { rows.push({ kind: 'mod', parts: wordDiff(dels[k], adds[k]) }); changed++ }
    for (let k = pairs; k < dels.length; k++) { rows.push({ kind: 'del', text: dels[k] }); removed++ }
    for (let k = pairs; k < adds.length; k++) { rows.push({ kind: 'add', text: adds[k] }); added++ }
  }
  return { rows: collapse(rows, context), added, removed, changed, same: !added && !removed && !changed }
}

/** Keep changes and a little context; fold long unchanged stretches into a "N unchanged lines" gap. */
function collapse(rows: Row[], context: number): Row[] {
  const keep = rows.map((r) => r.kind !== 'same')
  const near = keep.map((_, i) => { for (let d = -context; d <= context; d++) if (keep[i + d]) return true; return false })
  const out: Row[] = []
  let gap = 0
  rows.forEach((r, i) => { if (near[i]) { if (gap) { out.push({ kind: 'gap', count: gap }); gap = 0 } out.push(r) } else gap++ })
  if (gap) out.push({ kind: 'gap', count: gap })
  return out
}

// ── keyed items (spreadsheets, presentations) ───────────────────────────────
interface Item { key: string; label: string; text: string; order: number }
function diffItems(a: Item[], b: Item[]): Diff {
  const am = new Map(a.map((i) => [i.key, i])), bm = new Map(b.map((i) => [i.key, i]))
  const rows: { order: number; row: Row }[] = []
  let added = 0, removed = 0, changed = 0
  for (const i of b) {
    const o = am.get(i.key)
    if (!o) { rows.push({ order: i.order, row: { kind: 'add', text: i.text, label: i.label } }); added++ }
    else if (o.text !== i.text) { rows.push({ order: i.order, row: { kind: 'mod', parts: wordDiff(o.text, i.text), label: i.label } }); changed++ }
  }
  for (const i of a) if (!bm.has(i.key)) { rows.push({ order: i.order - 0.5, row: { kind: 'del', text: i.text, label: i.label } }); removed++ }
  rows.sort((x, y) => x.order - y.order)
  return { rows: rows.map((r) => r.row), added, removed, changed, same: !added && !removed && !changed }
}

function sheetItems(doc: Y.Doc): Item[] {
  const items: Item[] = []
  const tabs = [...doc.getMap<Record<string, unknown>>('tabs').values()].map((t) => ({ id: String((t as Record<string, unknown>).id), name: String((t as Record<string, unknown>).name ?? ''), order: Number((t as Record<string, unknown>).order ?? 0) })).sort((x, y) => x.order - y.order)
  tabs.forEach((t, ti) => {
    const cells = doc.getMap<{ v?: string }>('cells:' + t.id)
    const list: [number, number, string][] = []
    cells.forEach((c, k) => { const [r, col] = k.split(',').map(Number); if (c?.v !== undefined && c.v !== '' && Number.isFinite(r)) list.push([r, col, c.v]) })
    list.sort((x, y) => x[0] - y[0] || x[1] - y[1]).forEach(([r, c, v], n) => items.push({ key: `${t.id}!${r},${c}`, label: `${tabs.length > 1 ? t.name + ' · ' : ''}${addr(r, c)}`, text: v, order: ti * 1e7 + n }))
  })
  return items
}

function slideItems(doc: Y.Doc): Item[] {
  const items: Item[] = []
  const order = doc.getArray<string>('order').toArray(), slides = doc.getMap<Y.Map<unknown>>('slides')
  order.forEach((sid, si) => {
    const sl = slides.get(String(sid)); if (!sl) return
    const els = sl.get('els') as Y.Map<Y.Map<unknown>> | undefined
    const label = (e: Y.Map<unknown>) => `Slide ${si + 1} · ${e.get('role') === 'title' ? 'title' : String(e.get('type') ?? 'item')}`
    let n = 0
    els?.forEach((e, eid) => {
      const t = e.get('type')
      const text = typeof e.get('text') === 'string' ? (e.get('text') as string) : `[${String(t)}]`
      items.push({ key: `${sid}:${eid}`, label: label(e), text: text.trim() || `[empty ${String(t)}]`, order: si * 1000 + n++ })
    })
    if (typeof sl.get('notes') === 'string' && (sl.get('notes') as string).trim()) items.push({ key: `${sid}:notes`, label: `Slide ${si + 1} · notes`, text: (sl.get('notes') as string).trim(), order: si * 1000 + 999 })
  })
  return items
}

/** A wiki as lines: each page in reading order under a `§` line with its title, folders as `§§` lines. */
export function wikiLines(doc: Y.Doc): string[] {
  const tree = doc.getMap<Entry>('tree').toJSON() as Tree
  const out: string[] = []
  const walk = (p: string | null) => {
    for (const id of children(tree, p)) {
      const e = tree[id]
      if (e.t === 'folder') { out.push(`§§ ${e.title}`); walk(id) } else { out.push(`§ ${e.title}${e.method ? ` [${e.method}]` : ''}`); out.push(...fragLines(doc.getXmlFragment('p:' + id))) }
    }
  }
  walk(null)
  return out
}

export type DiffKind = 'doc' | 'sheet' | 'slides' | 'wiki'
export function diffDocs(kind: DiffKind, before: Y.Doc, after: Y.Doc): Diff {
  if (kind === 'sheet') return diffItems(sheetItems(before), sheetItems(after))
  if (kind === 'slides') return diffItems(slideItems(before), slideItems(after))
  if (kind === 'wiki') return diffLines(wikiLines(before), wikiLines(after))
  return diffLines(docLines(before), docLines(after))
}

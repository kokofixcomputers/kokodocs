import { Extension } from '@tiptap/core'
import { Plugin, TextSelection } from '@tiptap/pm/state'
import { CellSelection, TableMap } from '@tiptap/pm/tables'
import type { EditorView } from '@tiptap/pm/view'
import type { Fragment, Node as PMNode } from '@tiptap/pm/model'

/** Fill handle, as in a spreadsheet: a small square at the corner of the selected table cells. Drag it down, up, right or left over other cells and they continue the pattern:
 *  1, 2 → 3, 4, 5; Monday → Tuesday; Jan → Feb; 2026-01-30 → 2026-01-31; Item 1 → Item 2; anything else is copied (keeping its formatting). */

interface Rect { top: number; left: number; bottom: number; right: number }   // (bottom and right are one past the last cell)
interface Info { table: PMNode; start: number; map: TableMap; rect: Rect }

function selectedCells(view: EditorView): Info | null {
  const sel = view.state.selection
  if (sel instanceof CellSelection) {
    const table = sel.$anchorCell.node(-1), start = sel.$anchorCell.start(-1), map = TableMap.get(table)
    return { table, start, map, rect: map.rectBetween(sel.$anchorCell.pos - start, sel.$headCell.pos - start) }
  }
  const $f = sel.$from
  for (let d = $f.depth; d > 1; d--) {
    const role = $f.node(d).type.spec.tableRole
    if (role === 'cell' || role === 'header_cell') {
      const table = $f.node(d - 2), start = $f.start(d - 2), map = TableMap.get(table)
      const r = map.findCell($f.before(d) - start)
      return { table, start, map, rect: r }
    }
  }
  return null
}
const cellAtMap = (i: Info, row: number, col: number) => i.map.map[row * i.map.width + col]

// ── series ──
const LISTS = [
  'monday tuesday wednesday thursday friday saturday sunday'.split(' '), 'mon tue wed thu fri sat sun'.split(' '),
  'january february march april may june july august september october november december'.split(' '), 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' '),
]
const num = (s: string) => { const t = s.trim().replace(/,/g, ''); return t !== '' && /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null }
const decimals = (s: string) => (s.split('.')[1] ?? '').length
const casing = (like: string, s: string) => (like === like.toUpperCase() && like.length > 1 ? s.toUpperCase() : like[0] === like[0].toUpperCase() ? s[0].toUpperCase() + s.slice(1) : s)
const dateOf = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s.trim()) ? Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) : null)
const trailing = (s: string) => { const m = /^(.*?)(\d+)$/.exec(s.trim()); return m && m[1] ? { prefix: m[1], n: Number(m[2]), pad: m[2].length } : null }

/** the next `count` values after `src` (copied in this order), or null when it is a plain pattern to repeat */
export function continueSeries(src: string[], count: number): string[] | null {
  const out: string[] = []
  const last = src[src.length - 1]
  const nums = src.map(num)
  if (nums.every((x) => x !== null)) {
    if (src.length < 2) return null   // one number is copied, not counted up
    const step = nums[nums.length - 1]! - nums[nums.length - 2]!, d = Math.max(...src.map(decimals))
    for (let i = 1; i <= count; i++) out.push((nums[nums.length - 1]! + step * i).toFixed(d))
    return out
  }
  const dates = src.map(dateOf)
  if (dates.every((x) => x !== null)) {
    const step = dates.length > 1 ? dates[dates.length - 1]! - dates[dates.length - 2]! : 86400000
    for (let i = 1; i <= count; i++) out.push(new Date(dates[dates.length - 1]! + step * i).toISOString().slice(0, 10))
    return out
  }
  for (const list of LISTS) {
    const idx = src.map((s) => list.indexOf(s.trim().toLowerCase()))
    if (idx.every((x) => x >= 0)) {
      const step = idx.length > 1 ? ((idx[idx.length - 1] - idx[idx.length - 2]) % list.length + list.length) % list.length || 1 : 1
      for (let i = 1; i <= count; i++) out.push(casing(last.trim(), list[(idx[idx.length - 1] + step * i) % list.length]))
      return out
    }
  }
  const tr = src.map(trailing)
  if (tr.every((x) => x !== null) && tr.every((x) => x!.prefix === tr[0]!.prefix)) {
    const step = tr.length > 1 ? tr[tr.length - 1]!.n - tr[tr.length - 2]!.n : 1, t = tr[tr.length - 1]!
    for (let i = 1; i <= count; i++) out.push(`${t.prefix}${String(Math.max(0, t.n + step * i)).padStart(t.pad, '0')}`)
    return out
  }
  return null
}

export const TableFill = Extension.create({
  name: 'tableFill',
  addProseMirrorPlugins() {
    let handle: HTMLDivElement | null = null
    let dragging = false
    return [new Plugin({
      view(view) {
        handle = document.createElement('div')
        handle.className = 'tbl-fill'; handle.title = 'Drag to continue the pattern into other cells'; handle.setAttribute('aria-hidden', 'true'); handle.style.display = 'none'
        document.body.appendChild(handle)
        const place = () => {
          if (!handle) return
          const info = view.editable ? selectedCells(view) : null
          if (!info || (!view.hasFocus() && !dragging)) { handle.style.display = 'none'; return }
          const rel = cellAtMap(info, info.rect.bottom - 1, info.rect.right - 1)
          const dom = view.nodeDOM(info.start + rel) as HTMLElement | null
          if (!dom || !dom.getBoundingClientRect) { handle.style.display = 'none'; return }
          const b = dom.getBoundingClientRect()
          handle.style.display = 'block'; handle.style.left = `${b.right - 6}px`; handle.style.top = `${b.bottom - 6}px`
        }
        const again = () => requestAnimationFrame(place)
        window.addEventListener('scroll', again, true); window.addEventListener('resize', again)
        view.dom.addEventListener('focus', again); view.dom.addEventListener('blur', () => { if (!dragging) setTimeout(place, 0) })

        handle.addEventListener('mousedown', (e) => {
          e.preventDefault(); e.stopPropagation()
          const info = selectedCells(view); if (!info) return
          dragging = true
          const tableDom = (view.nodeDOM(info.start - 1) as HTMLElement | null)?.querySelector?.('table') ?? null
          let plan: { dir: 'down' | 'up' | 'right' | 'left'; n: number } | null = null
          const marked: HTMLElement[] = []
          const clear = () => { marked.forEach((m) => m.classList.remove('tbl-fill-preview')); marked.length = 0 }
          const cellOf = (x: number, y: number) => {
            const el = document.elementFromPoint(x, y)?.closest('td,th') as HTMLElement | null
            if (!el || !tableDom?.contains(el)) return null
            const rel = view.posAtDOM(el, 0) - 1 - info.start
            const i = info.map.map.indexOf(rel)
            return i < 0 ? null : { row: Math.floor(i / info.map.width), col: i % info.map.width }
          }
          const move = (ev: MouseEvent) => {
            const t = cellOf(ev.clientX, ev.clientY)
            clear(); plan = null
            if (!t) return
            const R = info.rect
            const down = t.row - (R.bottom - 1), up = R.top - t.row, right = t.col - (R.right - 1), left = R.left - t.col
            const best = Math.max(down, up, right, left)
            if (best <= 0) return
            plan = best === down ? { dir: 'down', n: down } : best === up ? { dir: 'up', n: up } : best === right ? { dir: 'right', n: right } : { dir: 'left', n: left }
            const rows: number[] = [], cols: number[] = []
            if (plan.dir === 'down') for (let r = R.bottom; r < R.bottom + plan.n; r++) rows.push(r)
            if (plan.dir === 'up') for (let r = R.top - plan.n; r < R.top; r++) rows.push(r)
            if (plan.dir === 'right') for (let c = R.right; c < R.right + plan.n; c++) cols.push(c)
            if (plan.dir === 'left') for (let c = R.left - plan.n; c < R.left; c++) cols.push(c)
            const rr = rows.length ? rows : Array.from({ length: R.bottom - R.top }, (_, k) => R.top + k), cc = cols.length ? cols : Array.from({ length: R.right - R.left }, (_, k) => R.left + k)
            for (const r of rr) for (const c of cc) {
              const d = view.nodeDOM(info.start + cellAtMap(info, r, c)) as HTMLElement | null
              if (d) { d.classList.add('tbl-fill-preview'); marked.push(d) }
            }
          }
          const up = () => {
            window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up)
            clear(); dragging = false
            if (plan) fill(view, info, plan.dir, plan.n)
            place()
          }
          window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
        })
        place()
        return {
          update: () => again(),
          destroy: () => { window.removeEventListener('scroll', again, true); window.removeEventListener('resize', again); handle?.remove(); handle = null },
        }
      },
    })]
  },
})

function fill(view: EditorView, info: Info, dir: 'down' | 'up' | 'right' | 'left', n: number) {
  const { state } = view, { schema } = state, { map, start, rect: R } = info
  const vertical = dir === 'down' || dir === 'up'
  const lines = vertical ? R.right - R.left : R.bottom - R.top   // one column (or row) of source cells at a time
  const along = vertical ? R.bottom - R.top : R.right - R.left
  const edits: { pos: number; node: PMNode; content: PMNode | Fragment }[] = []
  const done = new Set<number>()
  for (let l = 0; l < lines; l++) {
    // the source cells in the order the pattern runs (top to bottom, or the reverse when filling upwards)
    const cells: PMNode[] = []
    for (let k = 0; k < along; k++) {
      const idx = dir === 'down' ? k : dir === 'up' ? along - 1 - k : dir === 'right' ? k : along - 1 - k
      const row = vertical ? R.top + idx : R.top + l, col = vertical ? R.left + l : R.left + idx
      cells.push(info.table.nodeAt(cellAtMap(info, row, col))!)
    }
    const texts = cells.map((c) => c.textContent)
    const made = continueSeries(texts, n)
    for (let k = 1; k <= n; k++) {
      const row = vertical ? (dir === 'down' ? R.bottom - 1 + k : R.top - k) : R.top + l
      const col = vertical ? R.left + l : (dir === 'right' ? R.right - 1 + k : R.left - k)
      if (row < 0 || col < 0 || row >= map.height || col >= map.width) continue
      const rel = cellAtMap(info, row, col)
      if (done.has(rel)) continue
      done.add(rel)
      const target = info.table.nodeAt(rel)!
      const srcCell = cells[(k - 1) % cells.length]   // (patterns repeat; a copy keeps the source's formatting)
      if (made) {
        const mark = srcCell.firstChild?.firstChild?.marks ?? []
        edits.push({ pos: start + rel, node: target, content: schema.nodes.paragraph.create(null, made[k - 1] ? schema.text(made[k - 1], mark) : null) })
      } else edits.push({ pos: start + rel, node: target, content: srcCell.content })
    }
  }
  if (!edits.length) return
  const tr = state.tr
  for (const e of edits.sort((a, b) => b.pos - a.pos)) {   // (last in the document first, so earlier positions stay valid)
    tr.replaceWith(e.pos + 1, e.pos + e.node.nodeSize - 1, e.content)
  }
  // leave the filled area (with its source) selected
  try {
    const first = edits.reduce((a, b) => (a.pos < b.pos ? a : b)).pos, srcPos = start + cellAtMap(info, R.top, R.left)
    const lastE = edits.reduce((a, b) => (a.pos > b.pos ? a : b)).pos, srcEnd = start + cellAtMap(info, R.bottom - 1, R.right - 1)
    const a = Math.min(first, srcPos), b = Math.max(lastE, srcEnd)
    tr.setSelection(CellSelection.create(tr.doc, tr.mapping.map(a), tr.mapping.map(b)))
  } catch { tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(tr.doc.content.size, start + 2)))) }
  view.dispatch(tr.scrollIntoView())
}

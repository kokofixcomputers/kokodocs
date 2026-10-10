import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, Selection, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition, ySyncPluginKey } from 'y-prosemirror'
import * as Y from 'yjs'

/** Several cursors at once, as in VS Code.
 *   Alt+click          add a cursor            Cmd/Ctrl+D          select the next match of the selected word
 *   Cmd/Ctrl+Alt+↑/↓   add a cursor above/below Cmd/Ctrl+Shift+L   select every match
 *   Esc or a plain click   back to one cursor
 *  Typing, Backspace/Delete, Enter, arrows, Home/End, paste and Bold/Italic/Underline act on every cursor. The ProseMirror selection is the main cursor; the others live here. */
interface R { a: number; h: number }   // anchor, head
interface Rel { a: unknown; h: unknown }
interface St { ranges: R[] }
const key = new PluginKey<St>('multiCursor')
const MAX = 300
const lo = (r: R) => Math.min(r.a, r.h)
const hi = (r: R) => Math.max(r.a, r.h)

type YS = { doc: Y.Doc; type: Y.XmlFragment; binding: { mapping: unknown } } | undefined
const ysOf = (s: EditorState) => ySyncPluginKey.getState(s) as YS

/** sorted, inside the document, merged when they overlap or touch, and without the one that is the main selection */
function tidy(ranges: R[], state: EditorState): R[] {
  const size = state.doc.content.size, main = state.selection
  const valid = (p: number) => { const $p = state.doc.resolve(Math.max(0, Math.min(p, size))); return $p.parent.inlineContent ? $p.pos : Selection.near($p, 1).head }   // (always inside a line of text)
  const sorted = ranges.map((r) => ({ a: valid(r.a), h: valid(r.h) })).sort((x, y) => lo(x) - lo(y))
  const out: R[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && lo(r) <= hi(last)) { if (hi(r) > hi(last)) { const fwd = last.h >= last.a; out[out.length - 1] = fwd ? { a: last.a, h: hi(r) } : { a: hi(r), h: last.h } } } else out.push(r)
  }
  return out.filter((r) => !(lo(r) <= main.to && hi(r) >= main.from)).slice(0, MAX)
}
const fromRel = (rel: Rel[], state: EditorState): R[] | null => {
  const ys = ysOf(state); if (!ys) return null   // (the shared text's own state: same object before and after a change)
  const out: R[] = []
  for (const r of rel) {
    const a = relativePositionToAbsolutePosition(ys.doc, ys.type, Y.createRelativePositionFromJSON(r.a), ys.binding.mapping as never)
    const h = relativePositionToAbsolutePosition(ys.doc, ys.type, Y.createRelativePositionFromJSON(r.h), ys.binding.mapping as never)
    if (a != null && h != null) out.push({ a, h })
  }
  return out
}

const extras = (state: EditorState) => key.getState(state)?.ranges ?? []
const sel = (state: EditorState): R | null => (state.selection instanceof TextSelection ? { a: state.selection.anchor, h: state.selection.head } : null)
/** every cursor, main one included, in document order */
function everyone(state: EditorState): { r: R; main: boolean }[] {
  const m = sel(state)
  return [...(m ? [{ r: m, main: true }] : []), ...extras(state).map((r) => ({ r, main: false }))].sort((x, y) => lo(x.r) - lo(y.r))
}

function dispatch(view: EditorView, tr: Transaction, ranges: R[]) { view.dispatch(tr.setMeta(key, { ranges }).scrollIntoView()) }
const clear = (view: EditorView) => { if (extras(view.state).length) view.dispatch(view.state.tr.setMeta(key, { ranges: [] })) }

/** Run one edit at every cursor (last in the document first, so the earlier ones stay put), then put a cursor after each. */
function editAll(view: EditorView, edit: (tr: Transaction, from: number, to: number) => void): boolean {
  const all = everyone(view.state); if (!all.some((x) => !x.main)) return false
  const tr = view.state.tr
  for (const x of [...all].reverse()) edit(tr, lo(x.r), hi(x.r))
  const at = all.map((x) => tr.mapping.map(hi(x.r), 1))
  const mi = all.findIndex((x) => x.main)
  const others = at.filter((_, i) => i !== mi).map((p) => ({ a: p, h: p }))
  tr.setSelection(TextSelection.create(tr.doc, at[mi]))
  dispatch(view, tr, others)
  return true
}

const isWord = (c: string) => /[\p{L}\p{N}_]/u.test(c)
const wordAt = ($p: ReturnType<EditorState['doc']['resolve']>): R | null => {
  const t = $p.parent.textBetween(0, $p.parent.content.size, undefined, '￼'), o = $p.parentOffset, s = $p.start()
  let a = o, b = o
  while (a > 0 && isWord(t[a - 1])) a--
  while (b < t.length && isWord(t[b])) b++
  return a === b ? null : { a: s + a, h: s + b }
}
/** where a piece of text occurs, as document positions (inside single text blocks) */
function occurrences(state: EditorState, needle: string): R[] {
  const out: R[] = []
  state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    const t = node.textBetween(0, node.content.size, undefined, '￼')
    for (let i = t.indexOf(needle); i >= 0; i = t.indexOf(needle, i + needle.length)) out.push({ a: pos + 1 + i, h: pos + 1 + i + needle.length })
    return false
  })
  return out
}

const step = (view: EditorView, h: number, dir: -1 | 1): number => {
  const $h = view.state.doc.resolve(h), t = $h.parent.textBetween(0, $h.parent.content.size, undefined, '￼'), o = $h.parentOffset
  if (dir < 0 && o > 0) return h - (o > 1 && /[\uDC00-\uDFFF]/.test(t[o - 1]) ? 2 : 1)
  if (dir > 0 && o < t.length) return h + (/[\uD800-\uDBFF]/.test(t[o]) ? 2 : 1)
  const next = Selection.findFrom(view.state.doc.resolve(dir < 0 ? $h.before() : $h.after()), dir, true)
  return next ? next.head : h
}
const vertical = (view: EditorView, h: number, dir: -1 | 1): number | null => {
  try {
    const c = view.coordsAtPos(h), lh = Math.max(12, c.bottom - c.top)
    for (let i = 1; i <= 8; i++) {   // (the next line may be past a gap between paragraphs: look a little further each time)
      const p = view.posAtCoords({ left: c.left, top: dir < 0 ? c.top - lh * 0.5 * i : c.bottom + lh * 0.5 * i })
      if (!p) continue
      const at = Selection.near(view.state.doc.resolve(p.pos), dir).head
      if (at !== h && Math.abs(view.coordsAtPos(at).top - c.top) > lh * 0.4 && (dir < 0 ? at < h : at > h)) return at
    }
    return null
  } catch { return null }
}

export const MultiCursor = Extension.create({
  name: 'multiCursor',
  priority: 1000,
  addProseMirrorPlugins() {
    // The cursors' places in the shared text, worked out just after each change (the text isn't in step with the page until then). Used when someone else edits.
    let rel: Rel[] | null = null, relFor: R[] | null = null
    return [new Plugin<St>({
      key,
      state: {
        init: () => ({ ranges: [] }),
        apply(tr, st, _old, next) {
          const meta = tr.getMeta(key) as { ranges: R[] } | undefined
          if (meta) return { ranges: tidy(meta.ranges, next) }
          if (!st.ranges.length) return st
          if ((tr.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean } | undefined)?.isChangeOrigin && rel && relFor === st.ranges) {   // someone else edited: find the cursors again from their place in the shared text
            const back = fromRel(rel, _old)
            if (back) return { ranges: tidy(back, next) }
          }
          if (!tr.docChanged) return st
          return { ranges: tidy(st.ranges.map((r) => ({ a: tr.mapping.map(r.a, 1), h: tr.mapping.map(r.h, 1) })), next) }
        },
      },
      props: {
        decorations(state) {
          const rs = extras(state); if (!rs.length) return null
          const out: Decoration[] = []
          for (const r of rs) {
            if (lo(r) !== hi(r)) out.push(Decoration.inline(lo(r), hi(r), { class: 'mc-sel' }))
            out.push(Decoration.widget(r.h, () => { const s = document.createElement('span'); s.className = 'mc-caret'; s.setAttribute('aria-hidden', 'true'); return s }, { key: `mc${r.h}`, side: r.h >= r.a ? 1 : -1, ignoreSelection: true }))
          }
          return DecorationSet.create(state.doc, out)
        },
        handleTextInput(view, _f, _t, text) { return view.editable && editAll(view, (tr, a, b) => { tr.insertText(text, a, b) }) },
        handlePaste(view, event) {
          if (!view.editable || !extras(view.state).length) return false
          const text = event.clipboardData?.getData('text/plain') ?? ''
          const lines = text.replace(/\r\n?/g, '\n').split('\n'), n = everyone(view.state).length
          if (!text || (lines.length !== 1 && lines.length !== n)) { clear(view); return false }   // (one line, or one line for each cursor)
          event.preventDefault()
          let i = 0
          const order = new Map(everyone(view.state).map((x, k) => [lo(x.r), k]))
          return editAll(view, (tr, a, b) => { tr.insertText(lines.length === 1 ? lines[0] : lines[order.get(a) ?? i++], a, b) })
        },
        handleDOMEvents: {
          mousedown(view, e) {
            if (!view.editable || e.button !== 0) return false
            if (e.altKey && !e.metaKey && !e.ctrlKey && view.state.selection instanceof TextSelection) {
              const p = view.posAtCoords({ left: e.clientX, top: e.clientY }); if (!p) return false
              e.preventDefault()
              const at = Selection.near(view.state.doc.resolve(p.pos)).head
              dispatch(view, view.state.tr, [...extras(view.state), { a: at, h: at }])
              view.focus()
              return true
            }
            clear(view); return false
          },
        },
        handleKeyDown(view, e) {
          if (!view.editable) return false
          const mod = e.metaKey || e.ctrlKey, k = e.key, state = view.state, main = sel(state)
          if (!main) return false
          const have = extras(state).length > 0
          const move = (to: (r: R, main: boolean) => number | null, extend: boolean) => {
            const all = everyone(state), mi = all.findIndex((x) => x.main)
            const next = all.map((x) => { const t = to(x.r, x.main); return t == null ? x.r : { a: extend ? x.r.a : t, h: t } })
            const tr = state.tr.setSelection(TextSelection.create(state.doc, next[mi].a, next[mi].h))
            dispatch(view, tr, next.filter((_, i) => i !== mi)); return true
          }
          // add or widen
          if (mod && !e.altKey && !e.shiftKey && k.toLowerCase() === 'd') {
            e.preventDefault()
            if (main.a === main.h) { const w = wordAt(state.doc.resolve(main.h)); if (w) view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, w.a, w.h))); return true }
            const needle = state.doc.textBetween(lo(main), hi(main), undefined, '￼'); if (!needle || /[\n￼]/.test(needle)) return true
            const all = everyone(state), end = Math.max(...all.map((x) => hi(x.r))), found = occurrences(state, needle)
            const taken = new Set(all.map((x) => lo(x.r)))
            const next = found.find((o) => o.a >= end && !taken.has(o.a)) ?? found.find((o) => !taken.has(o.a))
            if (!next) return true
            const tr = state.tr.setSelection(TextSelection.create(state.doc, next.a, next.h))
            dispatch(view, tr, [...extras(state), main]); return true
          }
          if (mod && e.shiftKey && !e.altKey && k.toLowerCase() === 'l') {
            e.preventDefault()
            const needle = main.a === main.h ? (wordAt(state.doc.resolve(main.h)) && state.doc.textBetween(wordAt(state.doc.resolve(main.h))!.a, wordAt(state.doc.resolve(main.h))!.h)) : state.doc.textBetween(lo(main), hi(main))
            if (!needle) return true
            const found = occurrences(state, needle); if (found.length < 2) return true
            const mine = found.find((o) => o.a <= main.h && o.h >= main.h) ?? found[0]
            const tr = state.tr.setSelection(TextSelection.create(state.doc, mine.a, mine.h))
            dispatch(view, tr, found.filter((o) => o !== mine)); return true
          }
          if (mod && e.altKey && (k === 'ArrowUp' || k === 'ArrowDown')) {
            e.preventDefault()
            const dir = k === 'ArrowUp' ? -1 : 1, all = everyone(state)
            const edge = dir < 0 ? all[0] : all[all.length - 1], p = vertical(view, edge.r.h, dir)
            if (p != null) dispatch(view, state.tr, [...extras(state), { a: p, h: p }])
            return true
          }
          if (!have) return false
          if (k === 'Escape') { clear(view); return true }
          if (mod && !e.altKey && !e.shiftKey && ['b', 'i', 'u'].includes(k.toLowerCase())) {
            const type = state.schema.marks[{ b: 'bold', i: 'italic', u: 'underline' }[k.toLowerCase() as 'b']]
            const parts = everyone(state).filter((x) => lo(x.r) !== hi(x.r)); if (!type || !parts.length) return false
            e.preventDefault()
            const on = parts.every((x) => state.doc.rangeHasMark(lo(x.r), hi(x.r), type)), tr = state.tr
            for (const x of parts) on ? tr.removeMark(lo(x.r), hi(x.r), type) : tr.addMark(lo(x.r), hi(x.r), type.create())
            view.dispatch(tr.setMeta(key, { ranges: extras(state) })); return true
          }
          if (!mod && k.length === 1 && !e.isComposing) { e.preventDefault(); return editAll(view, (tr, a, b) => { tr.insertText(k, a, b) }) }   // (here rather than as text input, so "- " doesn't start a list at only one of the cursors)
          if (mod || e.altKey) return false
          if (k === 'Backspace' || k === 'Delete') {
            const back = k === 'Backspace'
            return editAll(view, (tr, a, b) => {
              if (a !== b) { tr.delete(a, b); return }
              const $p = tr.doc.resolve(a), t = $p.parent.textBetween(0, $p.parent.content.size, undefined, '￼'), o = $p.parentOffset
              if (back && o > 0) tr.delete(a - (o > 1 && /[\uDC00-\uDFFF]/.test(t[o - 1]) ? 2 : 1), a)
              else if (!back && o < t.length) tr.delete(a, a + (/[\uD800-\uDBFF]/.test(t[o]) ? 2 : 1))
            })
          }
          if (k === 'Enter' && !e.shiftKey) {
            return editAll(view, (tr, a, b) => {
              const code = tr.doc.resolve(a).parent.type.spec.code
              if (code) { tr.insertText('\n', a, b); return }
              if (a !== b) tr.delete(a, b)
              tr.split(a)
            })
          }
          const collapse = !e.shiftKey
          if (k === 'ArrowLeft') return move((r) => (collapse && lo(r) !== hi(r) ? lo(r) : step(view, r.h, -1)), !collapse)
          if (k === 'ArrowRight') return move((r) => (collapse && lo(r) !== hi(r) ? hi(r) : step(view, r.h, 1)), !collapse)
          if (k === 'ArrowUp' || k === 'ArrowDown') return move((r) => vertical(view, r.h, k === 'ArrowUp' ? -1 : 1) ?? r.h, !collapse)
          if (k === 'Home') return move((r) => state.doc.resolve(r.h).start(), !collapse)
          if (k === 'End') return move((r) => state.doc.resolve(r.h).end(), !collapse)
          return false
        },
      },
      view(view) {
        const pill = document.createElement('div')
        pill.className = 'mc-pill'; pill.setAttribute('role', 'status'); pill.style.display = 'none'; document.body.appendChild(pill)
        const show = () => { const n = extras(view.state).length; pill.style.display = n ? 'flex' : 'none'; if (n) pill.textContent = `${n + 1} cursors · Esc to go back to one` }
        const remember = () => {
          const rs = extras(view.state); if (rs === relFor) return
          relFor = rs; rel = null
          const ys = ysOf(view.state); if (!ys || !rs.length) return
          void Promise.resolve().then(() => {
            if (extras(view.state) !== rs) return
            try { rel = rs.map((r) => ({ a: absolutePositionToRelativePosition(r.a, ys.type, ys.binding.mapping as never), h: absolutePositionToRelativePosition(r.h, ys.type, ys.binding.mapping as never) })) } catch { rel = null }
          })
        }
        show()
        return { update: () => { show(); remember() }, destroy: () => pill.remove() }
      },
    })]
  },
})

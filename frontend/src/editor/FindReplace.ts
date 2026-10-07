import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'

export interface Hit { from: number; to: number }
interface FState { query: string; cs: boolean; hits: Hit[]; cur: number }
export const findKey = new PluginKey<FState>('find')

function search(doc: PMNode, query: string, cs: boolean): Hit[] {
  if (!query) return []
  const q = cs ? query : query.toLowerCase()
  const out: Hit[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    const t = node.textBetween(0, node.content.size, undefined, '￼')
    const hay = cs ? t : t.toLowerCase()
    for (let i = hay.indexOf(q); i >= 0 && out.length < 5000; i = hay.indexOf(q, i + Math.max(1, q.length))) out.push({ from: pos + 1 + i, to: pos + 1 + i + q.length })
    return false
  })
  return out
}

/** Highlights every match of the current search; the active one is drawn stronger. */
export const FindReplace = Extension.create({
  name: 'findReplace',
  addProseMirrorPlugins() {
    return [new Plugin<FState>({
      key: findKey,
      state: {
        init: () => ({ query: '', cs: false, hits: [], cur: 0 }),
        apply(tr, v, _old, state) {
          const m = tr.getMeta(findKey) as Partial<FState> | undefined
          if (m) {
            const next = { ...v, ...m }
            const hits = search(state.doc, next.query, next.cs)
            return { ...next, hits, cur: hits.length ? Math.min(Math.max(0, next.cur), hits.length - 1) : 0 }
          }
          if (tr.docChanged && v.query) { const hits = search(state.doc, v.query, v.cs); return { ...v, hits, cur: Math.min(v.cur, Math.max(0, hits.length - 1)) } }
          return v
        },
      },
      props: {
        decorations(state) {
          const s = findKey.getState(state)
          if (!s || !s.hits.length) return DecorationSet.empty
          return DecorationSet.create(state.doc, s.hits.map((h, i) => Decoration.inline(h.from, h.to, { class: i === s.cur ? 'find-hit find-cur' : 'find-hit' })))
        },
      },
    })]
  },
})

export const findState = (editor: Editor) => findKey.getState(editor.state) ?? { query: '', cs: false, hits: [], cur: 0 }
const put = (editor: Editor, m: Partial<FState>) => editor.view.dispatch(editor.state.tr.setMeta(findKey, m).setMeta('addToHistory', false))

export function setFind(editor: Editor, query: string, cs: boolean) { put(editor, { query, cs, cur: 0 }) }
export function clearFind(editor: Editor) { put(editor, { query: '', hits: [], cur: 0 }) }
export function stepFind(editor: Editor, dir: 1 | -1) {
  const s = findState(editor); if (!s.hits.length) return
  put(editor, { cur: (s.cur + dir + s.hits.length) % s.hits.length })
  reveal(editor)
}
export function reveal(editor: Editor) {
  const s = findState(editor); const h = s.hits[s.cur]; if (!h) return
  const dom = editor.view.domAtPos(h.from).node
  ;((dom.nodeType === 1 ? dom : dom.parentElement) as HTMLElement | null)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}
/** Jump to the first match at or after the cursor (used when the search text changes). */
export function seekFromCursor(editor: Editor) {
  const s = findState(editor); if (!s.hits.length) return
  const at = editor.state.selection.from
  const i = s.hits.findIndex((h) => h.to >= at)
  put(editor, { cur: i < 0 ? 0 : i }); reveal(editor)
}
export function replaceCurrent(editor: Editor, text: string) {
  const s = findState(editor); const h = s.hits[s.cur]; if (!h) return
  editor.view.dispatch(editor.state.tr.insertText(text, h.from, h.to))
  reveal(editor)
}
export function replaceAll(editor: Editor, text: string): number {
  const s = findState(editor); if (!s.hits.length) return 0
  const tr = editor.state.tr
  for (const h of [...s.hits].reverse()) tr.insertText(text, h.from, h.to)
  editor.view.dispatch(tr)
  return s.hits.length
}

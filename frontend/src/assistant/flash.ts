import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const key = new PluginKey<DecorationSet>('aiFlash')

/** Briefly highlights text the assistant just changed so the user can see what moved. */
export const AiFlash = Extension.create({
  name: 'aiFlash',
  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({
      key,
      state: {
        init: () => DecorationSet.empty,
        apply(tr, set) {
          const m = tr.getMeta(key) as { add?: [number, number]; clear?: boolean } | undefined
          if (m?.clear) return DecorationSet.empty
          if (m?.add) {
            const [a, b] = m.add
            if (b > a) return set.add(tr.doc, [Decoration.inline(a, b, { class: 'ai-flash' })])
          }
          return tr.docChanged ? set.map(tr.mapping, tr.doc) : set
        },
      },
      props: { decorations: (s) => key.getState(s) },
    })]
  },
})

export function flash(editor: Editor, from: number, to: number) {
  const size = editor.state.doc.content.size
  const a = Math.max(0, Math.min(from, size)), b = Math.max(0, Math.min(to, size))
  if (b <= a) return
  editor.view.dispatch(editor.state.tr.setMeta(key, { add: [a, b] }).setMeta('addToHistory', false))
  setTimeout(() => { if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(key, { clear: true }).setMeta('addToHistory', false)) }, 3200)
}

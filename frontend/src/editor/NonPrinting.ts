import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'

/** "Show non-printing characters": a ¶ at the end of every paragraph, a dot on every space, → on tabs, ° on non-breaking spaces and ↵ on line breaks, the way Word does.
 *  They are only drawn over the text (decorations): the document itself is never changed, they don't print, and they can't be selected or copied. The choice is remembered. */
export const nonPrintKey = new PluginKey<{ on: boolean; deco: DecorationSet }>('nonPrinting')
const STORE = 'koko.nonprinting'
const saved = () => { try { return localStorage.getItem(STORE) === '1' } catch { return false } }
const MAX = 80000   // a very long document shows the marks for its first part only, so typing stays quick

const mark = (cls: string, text: string) => () => { const s = document.createElement('span'); s.className = cls; s.textContent = text; s.setAttribute('aria-hidden', 'true'); s.contentEditable = 'false'; return s }

function build(doc: PMNode): DecorationSet {
  const out: Decoration[] = []
  doc.descendants((node, pos) => {
    if (out.length > MAX) return false
    if (node.isText) {
      const t = node.text ?? ''
      for (let i = 0; i < t.length; i++) {
        const c = t.charCodeAt(i)
        const cls = c === 32 ? 'np-space' : c === 160 ? 'np-nbsp' : c === 9 ? 'np-tab' : null
        if (cls) out.push(Decoration.inline(pos + i, pos + i + 1, { class: cls }))
      }
      return false
    }
    if (node.type.name === 'hardBreak') out.push(Decoration.widget(pos, mark('np-brk', '↵'), { side: -1, key: 'np-br' }))
    if (node.isTextblock) out.push(Decoration.widget(pos + node.nodeSize - 1, mark('np-para', '¶'), { side: 1, key: 'np-para' }))
    return true
  })
  return DecorationSet.create(doc, out)
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> { nonPrinting: { toggleNonPrinting: () => ReturnType } }
}

export const NonPrinting = Extension.create({
  name: 'nonPrinting',
  addCommands() {
    return {
      toggleNonPrinting: () => ({ tr, state, dispatch }) => {
        const on = !nonPrintKey.getState(state)?.on
        try { localStorage.setItem(STORE, on ? '1' : '0') } catch { /* ignore */ }
        if (dispatch) dispatch(tr.setMeta(nonPrintKey, { on }).setMeta('addToHistory', false))
        return true
      },
    }
  },
  addKeyboardShortcuts() { return { 'Mod-Shift-8': () => this.editor.commands.toggleNonPrinting() } },   // (Word's own shortcut)
  addProseMirrorPlugins() {
    return [new Plugin({
      key: nonPrintKey,
      state: {
        init: (_c, state) => { const on = saved(); return { on, deco: on ? build(state.doc) : DecorationSet.empty } },
        apply(tr, v) {
          const m = tr.getMeta(nonPrintKey) as { on?: boolean } | undefined
          if (m && typeof m.on === 'boolean') return { on: m.on, deco: m.on ? build(tr.doc) : DecorationSet.empty }
          if (!v.on || !tr.docChanged) return v
          return { on: true, deco: build(tr.doc) }
        },
      },
      props: { decorations: (state) => nonPrintKey.getState(state)?.deco },
    })]
  },
})

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export interface Ghost { text: string; busy: boolean }
declare module '@tiptap/core' {
  interface Commands<ReturnType> { voiceGhost: { setVoiceGhost: (g: Ghost | null) => ReturnType } }
}
const key = new PluginKey<Ghost | null>('voiceGhost')

/** While you dictate, what is being heard shows right at the cursor, in the page itself (grey, with a recording dot). It is only a drawing: it is not part of the document,
 *  and is replaced by the real words as soon as they are written. */
export const VoiceGhost = Extension.create({
  name: 'voiceGhost',
  addCommands() { return { setVoiceGhost: (g) => ({ tr, dispatch }) => { if (dispatch) dispatch(tr.setMeta(key, { g })); return true } } },
  addProseMirrorPlugins() {
    return [new Plugin<Ghost | null>({
      key,
      state: { init: () => null, apply: (tr, cur) => { const m = tr.getMeta(key) as { g: Ghost | null } | undefined; return m ? m.g : cur } },
      props: {
        decorations(state) {
          const g = key.getState(state); if (!g) return null
          const el = document.createElement('span'); el.className = `vt-ghost${g.busy ? ' busy' : ''}`; el.setAttribute('aria-hidden', 'true'); el.contentEditable = 'false'
          const dot = document.createElement('i'); dot.className = 'vt-dot'; el.appendChild(dot)
          el.appendChild(document.createTextNode(g.text ? ` ${g.text}` : g.busy ? ' …' : ' Listening…'))
          return DecorationSet.create(state.doc, [Decoration.widget(state.selection.to, () => el, { side: 1, key: 'voice-ghost' })])
        },
      },
    })]
  },
})

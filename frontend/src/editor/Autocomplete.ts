import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { getWriting } from '../prefs'
import { AUTOCOMPLETE_SYSTEM, POLISHED_PREFIX, aiConnected, askModel, tidySuggestion } from './ai/model'
import { cancelLocal, completeLocal, loadLocalModel } from './ai/local'

/** Grey suggestions while you type, like GitHub Copilot: pause after a few words and the likely rest of the sentence appears after the cursor.
 *  Tab takes it, Cmd/Ctrl+→ takes one word, anything else (or Esc) dismisses it. Off until it is switched on in Settings → Writing; the suggestions come from a small
 *  model on this device or from the AI connection, whichever is chosen there. */
interface Sug { pos: number; text: string }
const key = new PluginKey<Sug | null>('autocomplete')
const DELAY = 650

export const Autocomplete = Extension.create<{ allowServer: () => boolean }>({
  name: 'autocomplete',
  addOptions() { return { allowServer: () => true } },
  addProseMirrorPlugins() {
    const opts = this.options
    return [new Plugin<Sug | null>({
      key,
      state: {
        init: () => null,
        apply(tr, cur) {
          const m = tr.getMeta(key) as { set?: Sug | null } | undefined
          if (m && 'set' in m) return m.set ?? null
          return tr.docChanged || tr.selectionSet ? null : cur
        },
      },
      props: {
        decorations(state) {
          const s = key.getState(state); if (!s) return null
          return DecorationSet.create(state.doc, [Decoration.widget(s.pos, () => { const e = document.createElement('span'); e.className = 'ac-ghost'; e.textContent = s.text; e.setAttribute('aria-hidden', 'true'); return e }, { key: 'ac', side: 1, ignoreSelection: true })])
        },
        handleKeyDown(view, e) {
          const s = key.getState(view.state); if (!s) return false
          if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); view.dispatch(view.state.tr.insertText(s.text, s.pos).scrollIntoView()); return true }
          if (e.key === 'ArrowRight' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
            const w = /^\s*\S+/.exec(s.text)?.[0] ?? s.text
            e.preventDefault()
            const tr = view.state.tr.insertText(w, s.pos)
            const rest = s.text.slice(w.length)
            view.dispatch((rest.trim() ? tr.setMeta(key, { set: { pos: s.pos + w.length, text: rest } }) : tr).scrollIntoView()); return true
          }
          if (e.key === 'Escape') { view.dispatch(view.state.tr.setMeta(key, { set: null })); return true }
          return false
        },
      },
      view(view) {
        let timer = 0, ctl: AbortController | null = null, serial = 0
        const stop = () => { window.clearTimeout(timer); if (ctl) { ctl.abort(); ctl = null; cancelLocal() } }
        const eligible = (v: EditorView) => {
          const w = getWriting(), sel = v.state.selection
          if (!w.autocomplete || !v.editable || v.composing || !(sel instanceof TextSelection) || !sel.empty) return false
          const $h = sel.$head
          if (!$h.parent.isTextblock || $h.parent.type.spec.code || $h.parentOffset !== $h.parent.content.size || $h.parent.textContent.trim().length < 4) return false
          return !/[\n]$/.test($h.parent.textContent)
        }
        const run = async () => {
          if (!eligible(view)) return
          const w = getWriting(), at = view.state.selection.head, doc = view.state.doc, id = ++serial
          const before = doc.textBetween(Math.max(0, at - 1200), at, '\n', '￼')
          ctl = new AbortController(); const mine = ctl
          try {
            let raw = ''
            if (w.engine === 'server') {
              if (!opts.allowServer() || !(await aiConnected())) return
              raw = await askModel(AUTOCOMPLETE_SYSTEM, before, mine.signal, undefined, 200)
            } else {
              raw = await completeLocal(POLISHED_PREFIX + before.slice(-600), 20, mine.signal)
            }
            if (mine.signal.aborted || id !== serial || view.state.doc !== doc || view.state.selection.head !== at) return
            const text = tidySuggestion(before, raw)
            if (text) view.dispatch(view.state.tr.setMeta(key, { set: { pos: at, text } }))
          } catch { /* cancelled, no connection, model not ready: no suggestion */ }
        }
        return {
          update(v, prev) {
            if (prev.doc.eq(v.state.doc) && prev.selection.eq(v.state.selection)) return
            stop(); serial++
            if (!eligible(v)) return
            if (getWriting().engine === 'device') { void loadLocalModel().catch(() => undefined) }
            timer = window.setTimeout(() => void run(), DELAY)
          },
          destroy: stop,
        }
      },
    })]
  },
})

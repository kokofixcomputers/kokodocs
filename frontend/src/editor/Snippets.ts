import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { getSnippets, type Snippet } from '../prefs'

/** Text expansion: type a trigger like ;sig and it turns into the saved text. It expands as soon as the trigger is typed, unless another trigger starts the same way
 *  (;a and ;addr), in which case it waits for a space or punctuation. Placeholders in the text: {date} {time} {datetime} {name} {email}. */
export const expandText = (text: string, who: { name?: string; email?: string } = {}) => {
  const d = new Date()
  return text.replace(/\{(date|time|datetime|name|email)\}/g, (_m, k: string) =>
    k === 'date' ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : k === 'time' ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
      : k === 'datetime' ? d.toLocaleString() : k === 'name' ? who.name ?? '' : who.email ?? '')
}

const BOUNDARY = /^[\s.,;:!?)\]}"']$/
let who: { name?: string; email?: string } = {}
export const setSnippetUser = (u: { name?: string; email?: string }) => { who = u }

function expand(view: EditorView, s: Snippet, from: number, to: number, after = '') {
  const { state } = view, { schema } = state
  const lines = expandText(s.text, who).split('\n')
  const nodes: import('@tiptap/pm/model').Node[] = []
  lines.forEach((l, i) => { if (i && schema.nodes.hardBreak) nodes.push(schema.nodes.hardBreak.create()); if (l) nodes.push(schema.text(l)) })
  if (after) nodes.push(schema.text(after))
  const tr = state.tr.replaceWith(from, to, nodes)
  view.dispatch(tr.scrollIntoView())
}

export const Snippets = Extension.create({
  name: 'snippets',
  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        handleTextInput(view, from, to, text) {
          const list = getSnippets(); if (!list.length) return false
          const { $from } = view.state.selection
          if (!$from.parent.isTextblock || $from.parent.type.name === 'codeBlock' || from !== to) return false
          const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
          const at = (trigger: string, typed: string) => {
            const t = before + typed
            if (!t.endsWith(trigger)) return false
            const prev = t.slice(0, -trigger.length).slice(-1)   // a trigger starts a word: not in the middle of one
            return !prev || BOUNDARY.test(prev)
          }
          if (BOUNDARY.test(text)) {   // a space or punctuation after a trigger
            const s = list.filter((x) => before.endsWith(x.trigger) && at(x.trigger, '')).sort((a, b) => b.trigger.length - a.trigger.length)[0]
            if (s) { expand(view, s, from - s.trigger.length, to, text); return true }
            return false
          }
          const s = list.filter((x) => at(x.trigger, text)).sort((a, b) => b.trigger.length - a.trigger.length)[0]
          if (!s || list.some((o) => o !== s && o.trigger.length > s.trigger.length && o.trigger.startsWith(s.trigger))) return false   // (a longer trigger could still be coming)
          expand(view, s, from - (s.trigger.length - text.length), to)
          return true
        },
      },
    })]
  },
})

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Extension, InputRule } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion'
import { emojiUrl } from '../emoji'
import { viewBottom, viewRight } from '../ui/viewport'
import { type EmojiHit, loadEmojiIndex, searchEmoji, toned } from './emojiData'

/** Set once the list has loaded (the first time someone types a colon and two letters), so a whole `:name:` typed afterwards can become an emoji at once. */
let knownIndex: Awaited<ReturnType<typeof loadEmojiIndex>> | null = null
interface Live { items: EmojiHit[]; rect: DOMRect | null; command: (i: EmojiHit) => void; sel: number }
let live: Live | null = null
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())
const MIN = 2   // "10:30" or "http://" shouldn't start a menu, so wait for two letters

/** Type ":" and a couple of letters (":tad") for a menu of emoji; Tab or Enter (or a click) puts the highlighted one in. Typing the whole
 *  `:tada:` turns it into the emoji too. The list itself is drawn by <EmojiSuggestMenu />. */
export const EmojiSuggest = Extension.create({
  name: 'emojiSuggest',
  addProseMirrorPlugins() {
    return [Suggestion<EmojiHit, EmojiHit>({
      editor: this.editor, pluginKey: new PluginKey('emojiSuggest'), char: ':', startOfLine: false, allowedPrefixes: [' ', '\n'],
      allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
      items: async ({ query }) => {
        if (query.length < MIN || !/^[a-z0-9_+-]+$/i.test(query)) return []
        const ix = knownIndex = await loadEmojiIndex()
        return searchEmoji(ix, query)
      },
      command: ({ editor, range, props }) => { editor.chain().focus().deleteRange(range).insertContent({ type: 'emoji', attrs: { char: props.char } }).run() },
      render: () => {
        const upd = (p: SuggestionProps<EmojiHit, EmojiHit>, sel?: number) => {
          live = { items: p.items, rect: p.clientRect?.() ?? null, command: (i) => p.command(i), sel: sel ?? Math.min(live?.sel ?? 0, Math.max(0, p.items.length - 1)) }
          emit()
        }
        return {
          onStart: (p) => upd(p, 0),
          onUpdate: (p) => upd(p),
          onKeyDown: ({ event }: SuggestionKeyDownProps) => {
            if (!live || !live.items.length) return false
            if (event.key === 'ArrowDown') { live = { ...live, sel: (live.sel + 1) % live.items.length }; emit(); return true }
            if (event.key === 'ArrowUp') { live = { ...live, sel: (live.sel - 1 + live.items.length) % live.items.length }; emit(); return true }
            if (event.key === 'Enter' || event.key === 'Tab') { live.command(live.items[live.sel]); return true }
            if (event.key === 'Escape') { live = null; emit(); return true }
            return false
          },
          onExit: () => { live = null; emit() },
        }
      },
    })]
  },
  addInputRules() {
    // the whole name typed with its closing colon: ":tada:"
    return [new InputRule({
      find: /(?:^|\s)(:([a-z0-9_+-]{2,}):)$/i,
      handler: ({ state, range, match, chain }) => {
        const slug = match[2].toLowerCase()
        const e = knownIndex?.bySlug.get(slug)
        if (!e) return null
        const start = range.to - match[1].length
        if (state.doc.resolve(start).parent.type.spec.code) return null
        chain().deleteRange({ from: start, to: range.to }).insertContent({ type: 'emoji', attrs: { char: toned(e) } }).run()
      },
    })]
  },
})

export function EmojiSuggestMenu() {
  const [, tick] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => { const f = () => tick((n) => n + 1); subs.add(f); return () => { subs.delete(f) } }, [])
  useEffect(() => { list.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' }) })
  if (!live || !live.items.length || !live.rect) return null
  const r = live.rect
  const below = viewBottom() - r.bottom > 300
  const left = Math.max(8, Math.min(r.left, viewRight() - 276))
  return createPortal(
    <div className="slash-menu emoji-suggest popover" ref={list} role="listbox" aria-label="Emoji"
      style={{ left, ...(below ? { top: r.bottom + 6 } : { bottom: window.innerHeight - r.top + 6 }) }}>
      {live.items.map((it, i) => (
        <button key={it.emoji.hexcode} role="option" aria-selected={i === live!.sel} className={i === live!.sel ? 'on' : ''}
          onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => { if (live) { live = { ...live, sel: i }; emit() } }} onClick={() => live?.command(it)}>
          <span className="sm-ico"><img className="emoji" src={emojiUrl(it.char)} alt={it.char} draggable={false} /></span>
          <span className="sm-text"><b>:{it.slug}:</b><em>{it.emoji.label}</em></span>
        </button>
      ))}
    </div>, document.body)
}

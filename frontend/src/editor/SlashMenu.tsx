import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { viewBottom, viewRight } from '../ui/viewport'
import { Extension, type Editor, type Range } from '@tiptap/core'
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion'
import { SHAPE_KINDS } from './shapes'
import { DIVIDERS } from './Blocks'
import { Sparkles, CalendarDays, Shapes, CheckSquare, Code2, Heading1, Heading2, Heading3, Image as ImageIcon, Info, List, ListOrdered, Minus, Pilcrow, Quote, Table2, TriangleAlert, Lightbulb, OctagonX, Sigma, ChevronRight, Columns3, TextQuote, ListTree, type LucideIcon } from 'lucide-react'

export interface SlashItem { title: string; hint: string; keys: string; icon: LucideIcon; run: (editor: Editor, range: Range) => void }
const del = (e: Editor, r: Range) => e.chain().focus().deleteRange(r)
const ITEMS: SlashItem[] = [
  { title: 'Do something…', hint: 'Say what you want: make this bold, summarize this paragraph', keys: 'ai command do something ask assistant rewrite summarize', icon: Sparkles, run: (e, r) => { del(e, r).run(); window.setTimeout(() => window.dispatchEvent(new Event('koko:command')), 30) } },
  { title: 'Text', hint: 'Plain paragraph', keys: 'paragraph text normal', icon: Pilcrow, run: (e, r) => del(e, r).setParagraph().run() },
  { title: 'Heading 1', hint: 'Big section title', keys: 'h1 title heading', icon: Heading1, run: (e, r) => del(e, r).setHeading({ level: 1 }).run() },
  { title: 'Heading 2', hint: 'Medium section title', keys: 'h2 subtitle heading', icon: Heading2, run: (e, r) => del(e, r).setHeading({ level: 2 }).run() },
  { title: 'Heading 3', hint: 'Small section title', keys: 'h3 heading', icon: Heading3, run: (e, r) => del(e, r).setHeading({ level: 3 }).run() },
  { title: 'Bulleted list', hint: 'A simple list', keys: 'bullet ul unordered list', icon: List, run: (e, r) => del(e, r).toggleBulletList().run() },
  { title: 'Numbered list', hint: 'A list with numbers', keys: 'number ol ordered list', icon: ListOrdered, run: (e, r) => del(e, r).toggleOrderedList().run() },
  { title: 'Checklist', hint: 'Track tasks with checkboxes', keys: 'todo task checkbox check', icon: CheckSquare, run: (e, r) => del(e, r).toggleTaskList().run() },
  { title: 'Table', hint: '3 by 3 table', keys: 'grid rows columns', icon: Table2, run: (e, r) => del(e, r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { title: 'Quote', hint: 'Set text apart', keys: 'blockquote citation', icon: Quote, run: (e, r) => del(e, r).toggleBlockquote().run() },
  { title: 'Info callout', hint: 'Highlighted note box', keys: 'callout note box alert', icon: Info, run: (e, r) => del(e, r).setCallout('info').run() },
  { title: 'Tip callout', hint: 'Helpful hint box', keys: 'callout hint idea', icon: Lightbulb, run: (e, r) => del(e, r).setCallout('tip').run() },
  { title: 'Warning callout', hint: 'Caution box', keys: 'callout caution alert', icon: TriangleAlert, run: (e, r) => del(e, r).setCallout('warning').run() },
  { title: 'Danger callout', hint: 'Critical box', keys: 'callout error alert', icon: OctagonX, run: (e, r) => del(e, r).setCallout('danger').run() },
  { title: 'Toggle list', hint: 'A heading that folds the text under it', keys: 'toggle collapse fold accordion details', icon: ChevronRight, run: (e, r) => del(e, r).insertToggle().run() },
  { title: '2 columns', hint: 'Side by side', keys: 'columns layout split', icon: Columns3, run: (e, r) => del(e, r).insertColumns(2).run() },
  { title: '3 columns', hint: 'Three side by side', keys: 'columns layout split', icon: Columns3, run: (e, r) => del(e, r).insertColumns(3).run() },
  { title: 'Pull quote', hint: 'A big highlighted quotation', keys: 'quote pull highlight', icon: TextQuote, run: (e, r) => del(e, r).insertPullQuote().run() },
  { title: 'Table of contents', hint: 'Links to every heading', keys: 'toc contents outline', icon: ListTree, run: (e, r) => del(e, r).insertToc().run() },
  ...DIVIDERS.filter(([v]) => v !== 'line').map(([v, name]): SlashItem => ({ title: `Divider: ${name}`, hint: 'A different kind of line', keys: `hr rule separator ${v}`, icon: Minus, run: (e, r) => del(e, r).insertDivider(v).run() })),
  { title: 'Equation', hint: 'A LaTeX formula on its own line', keys: 'math latex formula equation katex', icon: Sigma, run: (e, r) => del(e, r).insertMath(true).run() },
  { title: 'Inline equation', hint: 'A formula inside a sentence', keys: 'math latex formula inline equation', icon: Sigma, run: (e, r) => del(e, r).insertMath(false).run() },
  { title: 'Code block', hint: 'Monospaced code', keys: 'code snippet pre', icon: Code2, run: (e, r) => del(e, r).toggleCodeBlock().run() },
  { title: 'Divider', hint: 'Horizontal line', keys: 'hr line rule separator', icon: Minus, run: (e, r) => del(e, r).setHorizontalRule().run() },
  ...SHAPE_KINDS.map((k): SlashItem => ({ title: `Shape: ${k.name}`, hint: 'Drop it into the text, then resize', keys: `shape draw ${k.id} box`, icon: Shapes, run: (e, r) => del(e, r).insertShape(k.id === 'line' ? { shape: k.id, w: 200, h: 24, fill: 'none', sw: 3 } : { shape: k.id }).run() })),
  { title: 'Image', hint: 'Upload a picture', keys: 'photo picture upload', icon: ImageIcon, run: (e, r) => { del(e, r).run(); window.dispatchEvent(new Event('koko:pick-image')) } },
  { title: 'Today’s date', hint: new Date().toLocaleDateString(undefined, { dateStyle: 'long' }), keys: 'date today time', icon: CalendarDays, run: (e, r) => del(e, r).insertContent(new Date().toLocaleDateString(undefined, { dateStyle: 'long' }) + ' ').run() },
]
const filter = (q: string, extra: SlashItem[]) => { const s = q.toLowerCase().trim(); const all = [...ITEMS, ...extra]; return s ? all.filter((i) => i.title.toLowerCase().includes(s) || i.keys.includes(s)) : all }

interface Live { items: SlashItem[]; rect: DOMRect | null; command: (i: SlashItem) => void; sel: number }
let live: Live | null = null
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())

/** Type "/" in an empty spot to insert blocks. The list itself is rendered by <SlashMenu />. */
export const SlashCommand = Extension.create({
  name: 'slashCommand',
  addOptions() { return { extra: [] as SlashItem[] } },
  addProseMirrorPlugins() {
    return [Suggestion<SlashItem, SlashItem>({
      editor: this.editor, char: '/', startOfLine: false, allowedPrefixes: [' ', '\n'],
      allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
      items: ({ query }) => filter(query, this.options.extra),
      command: ({ editor, range, props }) => props.run(editor, range),
      render: () => {
        const upd = (p: SuggestionProps<SlashItem, SlashItem>, sel?: number) => {
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
})

export function SlashMenu() {
  const [, tick] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => { const f = () => tick((n) => n + 1); subs.add(f); return () => { subs.delete(f) } }, [])
  useEffect(() => { list.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' }) })
  if (!live || !live.items.length || !live.rect) return null
  const r = live.rect
  const vb = viewBottom()
  const below = vb - r.bottom > 300
  const left = Math.max(8, Math.min(r.left, viewRight() - 276))
  return createPortal(
    <div className="slash-menu popover" ref={list} role="listbox" aria-label="Insert"
      style={{ left, ...(below ? { top: r.bottom + 6 } : { bottom: window.innerHeight - r.top + 6 }) }}>
      {live.items.map((it, i) => (
        <button key={it.title} role="option" aria-selected={i === live!.sel} className={i === live!.sel ? 'on' : ''}
          onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => { if (live) { live = { ...live, sel: i }; emit() } }} onClick={() => live?.command(it)}>
          <span className="sm-ico"><it.icon size={18} /></span><span className="sm-text"><b>{it.title}</b><em>{it.hint}</em></span>
        </button>
      ))}
    </div>, document.body)
}

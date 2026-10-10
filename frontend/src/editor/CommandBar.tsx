import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'
import { Check, ClipboardCopy, CornerDownLeft, Loader2, RotateCcw, Sparkles, X } from 'lucide-react'
import { getWriting } from '../prefs'
import { toast } from '../ui/Toast'
import { viewBottom, viewRight } from '../ui/viewport'
import { COMMAND_EXAMPLES, runLocalCommand, scopeOf, type Scope } from './ai/commands'
import { aiConnected, askModel } from './ai/model'

/** The command box (Ctrl/Cmd+J, the sparkle button, or "Do something" in the / menu): say what you want in your own words.
 *  Formatting requests ("make this bold", "heading 2", "align center") are done on the spot; anything else ("summarize this paragraph", "make it shorter",
 *  "translate to Spanish") goes to the AI model that is connected in Settings → Assistant, and you see its answer before it touches your text. */
const SYSTEM = "You are a text-editing function inside a document editor. Apply the user's instruction to the TEXT and reply with ONLY the resulting text: no preface, no explanation, no code fences, no quotation marks around it. Use simple Markdown (**bold**, lists, headings) only when it helps. Keep the language of the text unless asked to change it. Never invent facts that are not in the text."
const AI_EXAMPLES = ['Summarize this', 'Make it shorter', 'Fix spelling and grammar', 'Make it more formal', 'Translate to Spanish', 'Continue writing']
const WHOLE = /\b(whole|entire|all of|everything|document|page|article|essay)\b/i

type Phase = { kind: 'ask' } | { kind: 'working'; text: string } | { kind: 'result'; text: string } | { kind: 'note'; text: string }

export function CommandBar({ editor, zk }: { editor: Editor | null; zk: boolean }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [phase, setPhase] = useState<Phase>({ kind: 'ask' })
  const [connected, setConnected] = useState(false)
  const scope = useRef<Scope & { doc: boolean }>({ from: 0, to: 0, block: true, doc: false })
  const [label, setLabel] = useState('')
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const ctl = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!editor) return
    const show = () => {
      if (!getWriting().commandBar || !editor.isEditable) return
      const s = scopeOf(editor)
      scope.current = { ...s, doc: false }
      const words = editor.state.doc.textBetween(s.from, s.to, ' ').trim().split(/\s+/).filter(Boolean).length
      setLabel(s.block ? 'this line' : `the selection · ${words} ${words === 1 ? 'word' : 'words'}`)
      try { const c = editor.view.coordsAtPos(s.block ? s.from : s.to); setPos({ left: c.left, top: c.bottom + 10 }) } catch { setPos(null) }
      setQ(''); setPhase({ kind: 'ask' }); setOpen(true)
      void aiConnected().then(setConnected)
    }
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'j' && (editor.isFocused || editor.view.dom.contains(document.activeElement))) { e.preventDefault(); e.stopPropagation(); show() }
    }
    window.addEventListener('koko:command', show); window.addEventListener('keydown', key, true)
    return () => { window.removeEventListener('koko:command', show); window.removeEventListener('keydown', key, true) }
  }, [editor])
  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 20) }, [open])
  useEffect(() => {
    if (!open) return
    const out = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) close() }
    window.addEventListener('mousedown', out, true)
    return () => window.removeEventListener('mousedown', out, true)
  }, [open])  // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => { ctl.current?.abort(); setOpen(false); editor?.commands.focus() }
  // sit under the text, and stay on the screen
  useEffect(() => {
    if (!open || !box.current || !pos) return
    const b = box.current.getBoundingClientRect()
    const left = Math.max(12, Math.min(pos.left, viewRight() - b.width - 12)), top = pos.top + b.height > viewBottom() - 12 ? Math.max(12, pos.top - b.height - 40) : pos.top
    if (left !== pos.left || top !== pos.top) setPos({ left, top })
  }, [open, pos, phase])

  const asked = useRef('')
  const target = (ask = asked.current) => {
    const s = scope.current
    const doc = WHOLE.test(ask) && editor ? { from: 0, to: editor.state.doc.content.size } : { from: s.from, to: s.to }
    return { ...doc, whole: WHOLE.test(ask) }
  }
  const textOf = (from: number, to: number) => editor!.state.doc.textBetween(from, to, '\n\n', '￼').slice(0, 24000)

  const submit = async (said?: string) => {
    const ask = (said ?? q).trim()
    if (!ask || !editor) return
    asked.current = ask
    const done = runLocalCommand(editor, ask)
    if (done) { toast(done); close(); return }
    if (zk) { setPhase({ kind: 'note', text: "This document is end-to-end encrypted, so its text can't be sent to an AI model. Formatting commands such as “make this bold” still work." }); return }
    if (!getWriting().commandBar) return
    if (!(await aiConnected())) { setPhase({ kind: 'note', text: 'I know formatting commands (make this bold, heading 2, bullet list, align center, uppercase…). For rewrites and summaries, connect an AI model in Settings → Assistant.' }); return }
    const t = target(ask), src = textOf(t.from, t.to)
    if (!src.trim()) { setPhase({ kind: 'note', text: 'There is no text there yet. Select some text first, or put the cursor in a paragraph.' }); return }
    ctl.current?.abort(); const c = (ctl.current = new AbortController())
    setPhase({ kind: 'working', text: '' })
    try {
      const out = await askModel(SYSTEM, `Instruction: ${ask}\n\nTEXT:\n${src}`, c.signal, (x) => setPhase({ kind: 'working', text: x }))
      setPhase({ kind: 'result', text: out.trim() })
    } catch (e) { if (!c.signal.aborted) setPhase({ kind: 'note', text: (e as Error).message || 'The AI model did not answer.' }) }
  }

  const apply = async (how: 'replace' | 'below') => {
    if (phase.kind !== 'result' || !editor) return
    const { mdToHtml } = await import('../assistant/docTools')
    const md = phase.text, t = target()
    const html = mdToHtml(md), single = /^<p>((?:(?!<\/?p>)[\s\S])*)<\/p>\s*$/.exec(html)
    const chain = editor.chain().focus()
    if (how === 'below') {
      const $e = editor.state.doc.resolve(Math.min(t.to, editor.state.doc.content.size))
      chain.insertContentAt($e.depth ? $e.after($e.depth) : $e.pos, html).run()
    } else if (t.whole) {
      chain.insertContentAt(editor.state.selection.to, html).run()
    } else if (scope.current.block) {
      const $f = editor.state.doc.resolve(t.from)
      if (single) chain.insertContentAt({ from: t.from, to: t.to }, single[1]).run()
      else chain.insertContentAt({ from: $f.before(), to: $f.after() }, html).run()
    } else chain.insertContentAt({ from: t.from, to: t.to }, single ? single[1] : html).run()
    toast(how === 'below' ? 'Added below' : 'Replaced')
    close()
  }

  const chips = useMemo(() => (connected && !zk ? [...COMMAND_EXAMPLES.slice(0, 3), ...AI_EXAMPLES] : COMMAND_EXAMPLES), [connected, zk])
  if (!open) return null
  return createPortal(
    <div ref={box} className="cmdbar" role="dialog" aria-label="Do something" style={pos ? { left: pos.left, top: pos.top } : { left: '50%', top: '16vh', transform: 'translateX(-50%)' }}>
      <form className="cmd-row" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <Sparkles size={17} />
        <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); if (phase.kind !== 'ask') setPhase({ kind: 'ask' }) }} placeholder={`What should I do with ${label || 'this'}?`} aria-label="What should I do"
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() } }} spellCheck={false} />
        {phase.kind === 'working' ? <Loader2 size={17} className="spin" /> : <button type="submit" className="cmd-go" aria-label="Run" disabled={!q.trim()}><CornerDownLeft size={15} /></button>}
        <button type="button" className="cmd-x" aria-label="Close" onClick={close}><X size={15} /></button>
      </form>
      {phase.kind === 'ask' && <div className="cmd-chips">{chips.map((c) => <button key={c} type="button" onClick={() => { setQ(c); void submit(c) }}>{c}</button>)}</div>}
      {phase.kind === 'note' && <p className="cmd-note">{phase.text}</p>}
      {(phase.kind === 'working' || phase.kind === 'result') && (
        <div className="cmd-result">
          <div className="cmd-text" aria-live="polite">{phase.text || 'Thinking…'}</div>
          {phase.kind === 'result' && (
            <div className="cmd-acts">
              <button type="button" className="btn btn-pill btn-primary btn-sm" onClick={() => void apply('replace')}><Check size={15} />{target().whole ? 'Insert here' : 'Replace'}</button>
              {!target().whole && <button type="button" className="btn btn-pill btn-soft btn-sm" onClick={() => void apply('below')}>Insert below</button>}
              <button type="button" className="btn btn-pill btn-ghost btn-sm" onClick={() => navigator.clipboard.writeText(phase.text).then(() => toast('Copied'), () => undefined)}><ClipboardCopy size={15} />Copy</button>
              <button type="button" className="btn btn-pill btn-ghost btn-sm" onClick={() => void submit()}><RotateCcw size={15} />Try again</button>
            </div>)}
        </div>)}
    </div>, document.body)
}

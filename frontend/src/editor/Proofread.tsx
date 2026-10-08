import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { CheckCircle2, EyeOff, Loader2, SpellCheck } from 'lucide-react'
import { api, type ProofIssue } from '../api'
import { Select } from '../ui/Select'

export interface Issue extends ProofIssue { from: number; to: number; text: string; key: string }
const proofKey = new PluginKey<DecorationSet>('proof')

export const ProofreadMarks = Extension.create({
  name: 'proofreadMarks',
  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({
      key: proofKey,
      state: {
        init: () => DecorationSet.empty,
        apply(tr, set) {
          const m = tr.getMeta(proofKey) as { from: number; to: number; kind: string }[] | undefined
          if (m) return DecorationSet.create(tr.doc, m.map((i) => Decoration.inline(i.from, i.to, { class: `proof proof-${i.kind}` })))
          return tr.docChanged ? set.map(tr.mapping, tr.doc) : set
        },
      },
      props: { decorations: (s) => proofKey.getState(s) },
    })]
  },
})

function gather(editor: Editor) {
  const blocks: { id: number; text: string }[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.isTextblock) {
      const text = node.textBetween(0, node.content.size, undefined, '￼')
      if (text.trim()) blocks.push({ id: pos, text })
      return false
    }
    return true
  })
  return blocks
}

/** Debounced proofreading; returns issues with absolute doc ranges and paints underlines. */
export const PROOF_LANGUAGES = [
  { value: 'en-US', label: 'English (US)' }, { value: 'en-GB', label: 'English (UK)' }, { value: 'en-CA', label: 'English (Canada)' }, { value: 'en-AU', label: 'English (Australia)' },
  { value: 'en-NZ', label: 'English (New Zealand)' }, { value: 'en-ZA', label: 'English (South Africa)' }, { value: 'en-IE', label: 'English (Ireland)' }, { value: 'en-IN', label: 'English (India)' },
]
const LANG_KEY = 'koko.proofLang'
/** The saved choice, else the browser's own language when it is one we offer (so a UK browser starts on UK spelling). */
function initialLanguage(): string {
  try { const s = localStorage.getItem(LANG_KEY); if (s && PROOF_LANGUAGES.some((l) => l.value === s)) return s } catch { /* private mode */ }
  const nav = (navigator.language || '').replace('_', '-')
  return PROOF_LANGUAGES.find((l) => l.value.toLowerCase() === nav.toLowerCase())?.value ?? 'en-US'
}

export function useProofread(editor: Editor | null) {
  const [language, setLanguageState] = useState(initialLanguage)
  const [issues, setIssues] = useState<Issue[]>([])
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [signedOut, setSignedOut] = useState(false)   // proofreading needs an account
  const [ignored, setIgnored] = useState<Set<string>>(new Set())
  const [tick, setTick] = useState(0)
  const seq = useRef(0)

  useEffect(() => {
    if (!editor) return
    let t: number
    const bump = () => { window.clearTimeout(t); t = window.setTimeout(() => setTick((n) => n + 1), 900) }
    const onTx = ({ transaction }: { transaction: { docChanged: boolean } }) => { if (transaction.docChanged) bump() }
    editor.on('transaction', onTx)
    bump()
    return () => { window.clearTimeout(t); editor.off('transaction', onTx) }
  }, [editor])

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const my = ++seq.current
    const blocks = gather(editor)
    if (!blocks.length) { setIssues([]); return }
    setLoading(true)
    api.proofread(blocks, language).then(({ issues: raw }) => {
      if (my !== seq.current || editor.isDestroyed) return
      const out: Issue[] = []
      for (const i of raw) {
        const from = i.block + 1 + i.offset
        const to = from + i.length
        let text = ''
        try { text = editor.state.doc.textBetween(from, to, undefined, '￼') } catch { continue }
        out.push({ ...i, from, to, text, key: `${i.kind}|${text}|${i.message}` })
      }
      setIssues(out); setFailed(false); setSignedOut(false)
    }).catch((e) => { if (my === seq.current) { setFailed(true); setSignedOut(e?.status === 401) } }).finally(() => { if (my === seq.current) setLoading(false) })
  }, [editor, tick, language])

  const visible = issues.filter((i) => !ignored.has(i.key))
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    editor.view.dispatch(editor.state.tr.setMeta(proofKey, visible.map((i) => ({ from: i.from, to: i.to, kind: i.kind }))).setMeta('addToHistory', false))
  }, [editor, issues, ignored]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    issues: visible, loading, failed, signedOut, language,
    setLanguage: (l: string) => { setLanguageState(l); try { localStorage.setItem(LANG_KEY, l) } catch { /* private mode */ } },
    ignore: (i: Issue) => setIgnored((s) => new Set(s).add(i.key)),
    recheck: () => setTick((n) => n + 1),
  }
}

export function applyIssue(editor: Editor, i: Issue, replacement: string, recheck: () => void) {
  if (editor.state.doc.textBetween(i.from, i.to, undefined, '\ufffc') !== i.text) { recheck(); return }
  editor.view.dispatch(editor.state.tr.insertText(replacement, i.from, i.to))
  editor.commands.focus()
  recheck()
}

const KIND = { spelling: 'Spelling', grammar: 'Grammar', style: 'Style' } as const

export function ProofreadPanel({ editor, state }: { editor: Editor; state: ReturnType<typeof useProofread> }) {
  const { issues, loading, failed, signedOut, ignore, recheck, language, setLanguage } = state
  const can = editor.isEditable

  const reveal = (i: Issue) => {
    editor.chain().focus().setTextSelection({ from: i.from, to: i.to }).run()
    const { node } = editor.view.domAtPos(i.from)
    ;(node.nodeType === 1 ? (node as HTMLElement) : node.parentElement)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  const apply = (i: Issue, s: string) => {
    if (editor.state.doc.textBetween(i.from, i.to, undefined, '￼') !== i.text) { recheck(); return }
    editor.view.dispatch(editor.state.tr.insertText(s, i.from, i.to))
    editor.commands.focus()
    recheck()
  }

  return (
    <div className="side-body">
      <div className="side-title">
        <SpellCheck size={18} /><h3>Spelling &amp; grammar</h3>
        {loading && <Loader2 size={16} className="spin muted" />}
      </div>
      <div className="proof-lang"><span>Language</span><Select value={language} options={PROOF_LANGUAGES} onChange={setLanguage} label="Proofreading language" /></div>
      {failed && issues.length === 0 ? (
        <div className="all-clear err">
          <strong>{signedOut ? 'Sign in to proofread' : "Couldn't check right now"}</strong>
          <span>{signedOut ? 'Proofreading is for signed-in people. Sign in, then it will check this document.' : "The proofreading service isn't reachable."}</span>
          {!signedOut && <button className="btn btn-pill btn-soft btn-sm" onClick={recheck}>Try again</button>}
        </div>
      ) : issues.length === 0 ? (
        <div className="all-clear">
          <CheckCircle2 size={34} />
          <strong>{loading ? 'Checking' : 'Looking good'}</strong>
          <span>{loading ? 'Reading through your document.' : 'No spelling or grammar issues found.'}</span>
        </div>
      ) : (
        <>
          <div className="issue-count"><b>{issues.length}</b> suggestion{issues.length === 1 ? '' : 's'}</div>
          <div className="issues">
            {issues.slice(0, 80).map((i) => (
              <div key={`${i.from}-${i.key}`} className={`issue k-${i.kind}`} onClick={() => reveal(i)}>
                <div className="issue-top">
                  <span className={`kind-pill k-${i.kind}`}>{KIND[i.kind]}</span>
                  {can && <button className="icon-btn sm" title="Ignore" aria-label="Ignore" onClick={(e) => { e.stopPropagation(); ignore(i) }}><EyeOff size={15} /></button>}
                </div>
                <p className="issue-msg">{i.message}</p>
                <div className="issue-text"><s>{i.text.trim() ? i.text : '(space)'}</s></div>
                {can && i.suggestions.length > 0 && (
                  <div className="sugg">
                    {i.suggestions.map((s) => (
                      <button key={s} className="sugg-pill" onClick={(e) => { e.stopPropagation(); apply(i, s) }}>{s === ' ' ? 'Single space' : s}</button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {issues.length > 80 && <p className="side-empty">Showing the first 80. Fix these and the rest will follow.</p>}
          </div>
        </>
      )}
    </div>
  )
}

/** Click an underlined word to get a small menu of corrections. */
export function ProofMenu({ editor, state }: { editor: Editor; state: ReturnType<typeof useProofread> }) {
  const [open, setOpen] = useState<{ issue: Issue; x: number; y: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const issues = useRef(state.issues)
  issues.current = state.issues

  useEffect(() => {
    const dom = editor.view.dom as HTMLElement
    const click = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest?.('.proof') as HTMLElement | null
      if (!el) { setOpen(null); return }
      const at = editor.view.posAtCoords({ left: e.clientX, top: e.clientY })?.pos
      if (at == null) return
      const issue = issues.current.find((i) => at >= i.from && at <= i.to)
      if (!issue) return
      const r = el.getBoundingClientRect()
      setOpen({ issue, x: Math.min(e.clientX, window.innerWidth - 260), y: r.bottom + 6 })
    }
    const close = () => setOpen(null)
    dom.addEventListener('click', click)
    editor.on('update', close)
    return () => { dom.removeEventListener('click', click); editor.off('update', close) }
  }, [editor])

  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('.proof')) setOpen(null) }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null)
    // phones: opening the keyboard scrolls/resizes the page, which must not dismiss the menu (it is docked above the keyboard)
    const scroll = () => { if (window.matchMedia('(max-width: 720px)').matches) return; setOpen(null) }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    document.addEventListener('scroll', scroll, true)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); document.removeEventListener('scroll', scroll, true) }
  }, [open])

  if (!open) return null
  const { issue } = open
  const can = editor.isEditable
  return createPortal(
    <div ref={ref} className="popover proof-menu" style={{ top: open.y, left: open.x, ...(window.matchMedia('(max-width: 720px)').matches ? { top: 'auto', left: 8, right: 8, bottom: 'calc(var(--kb, 0px) + 8px)', width: 'auto' } : {}) }} onMouseDown={(e) => e.preventDefault()}>
      <div className="pm-head"><span className={`kind-pill k-${issue.kind}`}>{KIND[issue.kind]}</span><span>{issue.message}</span></div>
      {can && issue.suggestions.map((s) => (
        <button key={s} className="pm-item" onClick={() => { setOpen(null); applyIssue(editor, issue, s, state.recheck) }}>
          {s === ' ' ? 'Use a single space' : s}
        </button>
      ))}
      {can && issue.suggestions.length === 0 && <div className="pm-none">No suggestions</div>}
      {can && <button className="pm-item muted" onClick={() => { setOpen(null); state.ignore(issue) }}>Ignore</button>}
    </div>, document.body)
}

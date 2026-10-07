import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { Check, MessageSquare, RotateCcw, Send, Trash2 } from 'lucide-react'
import { api, type Comment, type User } from '../api'
import { Avatar } from '../ui/Avatar'
import { toast } from '../ui/Toast'
import { collectAnchors } from './CommentMark'
import { EmojiText } from '../ui/EmojiText'

export interface Draft { id: string; quote: string }
export const ago = (t: number) => { const s = Date.now() / 1000 - t; return s < 60 ? 'now' : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : new Date(t * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' }) }

export function useComments(docId: string, enabled: boolean) {
  const [list, setList] = useState<Comment[]>([])
  const refresh = useCallback(() => { if (enabled) api.comments(docId).then(setList).catch(() => {}) }, [docId, enabled])
  useEffect(() => { refresh(); if (!enabled) return; const t = setInterval(refresh, 7000); return () => clearInterval(t) }, [refresh, enabled])
  return { list, refresh, setList }
}

export function Body({ text, me }: { text: string; me: string }) {
  return <p className="cm-body">{text.split(/(@[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g).map((p, i) => (p.startsWith('@') && p.includes('.') && p.indexOf('@', 1) > 0 ? <span key={i} className={`cm-mention ${p.slice(1).toLowerCase() === me ? 'me' : ''}`}>{p}</span> : <EmojiText key={i} text={p} />))}</p>
}

export function Composer({ docId, placeholder, onSend, autoFocus }: { docId: string; placeholder: string; onSend: (body: string) => Promise<void>; autoFocus?: boolean }) {
  const [text, setText] = useState('')
  const [people, setPeople] = useState<{ email: string; name: string | null }[]>([])
  const [q, setQ] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ta = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { api.people(docId).then(setPeople).catch(() => {}) }, [docId])
  useEffect(() => { if (autoFocus) ta.current?.focus() }, [autoFocus])
  const onChange = (v: string) => {
    setText(v)
    const pos = ta.current?.selectionStart ?? v.length
    const m = /(?:^|\s)@([^\s@]*)$/.exec(v.slice(0, pos))
    setQ(m ? m[1].toLowerCase() : null)
  }
  const matches = q === null ? [] : people.filter((p) => p.email.toLowerCase().includes(q) || (p.name ?? '').toLowerCase().includes(q)).slice(0, 5)
  const pick = (email: string) => {
    const pos = ta.current?.selectionStart ?? text.length
    const before = text.slice(0, pos).replace(/@[^\s@]*$/, `@${email} `)
    setText(before + text.slice(pos)); setQ(null); setTimeout(() => ta.current?.focus(), 0)
  }
  const send = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    try { await onSend(text.trim()); setText('') } catch (e) { toast((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="cm-composer">
      {matches.length > 0 && <div className="cm-pop">{matches.map((p) => <button key={p.email} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p.email)}><b>{p.name ?? p.email}</b>{p.name && <span>{p.email}</span>}</button>)}</div>}
      <textarea ref={ta} rows={2} value={text} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && matches.length === 0) { e.preventDefault(); void send() } if (e.key === 'Escape') setQ(null) }} />
      <button className="ai-send" aria-label="Send" disabled={!text.trim() || busy} onClick={() => void send()}><Send size={15} /></button>
    </div>
  )
}

export function CommentsPanel({ editor, docId, user, list, refresh, draft, onDraft, activeId, setActiveId }: {
  editor: Editor; docId: string; user: User; list: Comment[]; refresh: () => void; draft: Draft | null; onDraft: (d: Draft | null) => void; activeId: string | null; setActiveId: (id: string | null) => void
}) {
  const [showResolved, setShowResolved] = useState(false)
  const [, bump] = useState(0)
  useEffect(() => { const f = () => bump((n) => n + 1); editor.on('update', f); return () => { editor.off('update', f) } }, [editor])
  const anchors = collectAnchors(editor.state.doc)
  const me = user.email.toLowerCase()
  const roots = list.filter((c) => !c.parent_id)
  const replies = useMemo(() => { const m = new Map<string, Comment[]>(); list.forEach((c) => c.parent_id && m.set(c.parent_id, [...(m.get(c.parent_id) ?? []), c])); return m }, [list])
  const shown = roots.filter((c) => (showResolved ? true : !c.resolved)).sort((a, b) => (anchors.get(a.id)?.from ?? 1e9) - (anchors.get(b.id)?.from ?? 1e9))
  const resolvedCount = roots.filter((c) => c.resolved).length

  const go = (id: string) => {
    setActiveId(id)
    const a = anchors.get(id); if (!a) return
    editor.chain().setTextSelection({ from: a.from, to: a.to }).run()
    const el = editor.view.nodeDOM(a.from) as HTMLElement | null
    ;(el?.nodeType === 1 ? el : el?.parentElement)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  const create = async (body: string) => {
    if (!draft) return
    await api.addComment(docId, { id: draft.id, body, quote: draft.quote }); onDraft(null); setActiveId(draft.id); refresh()
  }
  const cancelDraft = () => { if (draft) { removeAnchor(editor, draft.id) } onDraft(null) }
  const reply = async (parent: string, body: string) => { await api.addComment(docId, { body, parent_id: parent }); refresh() }
  const resolve = async (c: Comment, v: boolean) => { await api.resolveComment(docId, c.id, v).catch((e) => toast(e.message)); refresh() }
  const remove = async (c: Comment) => { await api.deleteComment(docId, c.id).catch((e) => toast(e.message)); if (!c.parent_id) removeAnchor(editor, c.id); refresh() }
  const style = [...roots.filter((c) => c.resolved).map((c) => `.ProseMirror .cmt[data-comment-id="${c.id}"]{background:transparent!important;border-bottom-color:transparent!important}`), activeId ? `.ProseMirror .cmt[data-comment-id="${activeId}"]{background:rgba(250,204,21,.5)!important}` : ''].join('')

  return (
    <div className="side-body cm-panel">
      <style>{style}</style>
      <div className="side-title"><MessageSquare size={18} /><h3>Comments</h3></div>
      {draft && (
        <div className="cm-thread draft">
          <div className="cm-quote">{draft.quote}</div>
          <Composer docId={docId} placeholder="Add a comment. Type @ to mention someone" autoFocus onSend={create} />
          <button className="cm-link" onClick={cancelDraft}>Cancel</button>
        </div>
      )}
      {!draft && shown.length === 0 && (
        <p className="side-empty">{resolvedCount ? 'No open comments.' : editor.isEditable ? 'Select some text and choose Comment to start a conversation. Use @email to bring someone in.' : 'No comments yet.'}</p>
      )}
      <div className="cm-list">
        {shown.map((c) => {
          const orphan = !anchors.has(c.id)
          const all = [c, ...(replies.get(c.id) ?? [])]
          return (
            <div key={c.id} className={`cm-thread ${activeId === c.id ? 'active' : ''} ${c.resolved ? 'done' : ''}`} onClick={() => go(c.id)}>
              {c.quote && <div className="cm-quote" title={orphan ? 'The commented text was deleted' : undefined}>{orphan ? 'Text deleted: ' : ''}{c.quote}</div>}
              {all.map((m) => (
                <div key={m.id} className="cm-msg">
                  <Avatar name={m.author} color="#8b8aa5" size={24} />
                  <div className="cm-main">
                    <div className="cm-meta"><b>{m.author}</b><span>{ago(m.created_at)}</span>
                      {m.mentions.includes(me) && <em>mentions you</em>}
                      {(m.user_id === user.id) && <button className="cm-x" aria-label="Delete comment" onClick={(e) => { e.stopPropagation(); void remove(m) }}><Trash2 size={13} /></button>}
                    </div>
                    <Body text={m.body} me={me} />
                  </div>
                </div>
              ))}
              <div onClick={(e) => e.stopPropagation()}>
                {!c.resolved && <Composer docId={docId} placeholder="Reply" onSend={(b) => reply(c.id, b)} />}
                <button className="cm-link" onClick={() => void resolve(c, !c.resolved)}>{c.resolved ? <><RotateCcw size={13} />Reopen</> : <><Check size={13} />Resolve</>}</button>
              </div>
            </div>
          )
        })}
      </div>
      {resolvedCount > 0 && <button className="cm-link" onClick={() => setShowResolved((v) => !v)}>{showResolved ? 'Hide' : 'Show'} {resolvedCount} resolved</button>}
    </div>
  )
}

export function removeAnchor(editor: Editor, id: string) {
  const a = collectAnchors(editor.state.doc).get(id); if (!a) return
  const type = editor.schema.marks.comment
  const tr = editor.state.tr
  editor.state.doc.nodesBetween(a.from, a.to, (n, pos) => { if (n.isText) n.marks.forEach((m) => { if (m.type === type && m.attrs.commentId === id) tr.removeMark(pos, pos + n.nodeSize, m) }) })
  editor.view.dispatch(tr)
}

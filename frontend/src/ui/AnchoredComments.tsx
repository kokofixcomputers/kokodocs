import { useMemo, useState } from 'react'
import { Check, MessageSquare, RotateCcw, Trash2 } from 'lucide-react'
import { api, type Comment, type User } from '../api'
import { Body, Composer, ago } from '../editor/Comments'
import { Avatar } from './Avatar'
import { toast } from './Toast'

export interface Anchor { [k: string]: unknown }
/** Comments on things that aren't text (spreadsheet cells, slides and what's on them). The comment remembers where it points. */
export function AnchoredComments({ docId, user, list, refresh, current, label, onGo, focusId, readOnly }: {
  docId: string; user: User; list: Comment[]; refresh: () => void
  /** what a new comment would attach to right now (the selected cell, the current slide...) */
  current: { anchor: Anchor; label: string } | null
  label: (a: Anchor | null) => string
  onGo: (a: Anchor) => void
  focusId?: string | null
  readOnly?: boolean
}) {
  const [showResolved, setShowResolved] = useState(false)
  const me = user.email.toLowerCase()
  const roots = useMemo(() => list.filter((c) => !c.parent_id), [list])
  const replies = useMemo(() => { const m = new Map<string, Comment[]>(); list.forEach((c) => c.parent_id && m.set(c.parent_id, [...(m.get(c.parent_id) ?? []), c])); return m }, [list])
  const shown = roots.filter((c) => showResolved || !c.resolved)
  const resolvedCount = roots.filter((c) => c.resolved).length
  const create = async (body: string) => { if (!current) return; await api.addComment(docId, { body, quote: current.label, anchor: current.anchor }); refresh() }
  const reply = async (parent: string, body: string) => { await api.addComment(docId, { body, parent_id: parent }); refresh() }
  const resolve = async (c: Comment, v: boolean) => { await api.resolveComment(docId, c.id, v).catch((e) => toast(e.message)); refresh() }
  const remove = async (c: Comment) => { await api.deleteComment(docId, c.id).catch((e) => toast(e.message)); refresh() }

  return (
    <div className="side-body cm-panel">
      <div className="side-title"><MessageSquare size={18} /><h3>Comments</h3></div>
      {current && (
        <div className="cm-thread draft">
          <div className="cm-quote">Comment on <b>{current.label}</b></div>
          <Composer key={JSON.stringify(current.anchor)} docId={docId} placeholder="Add a comment. Type @ to mention someone" onSend={create} />
        </div>
      )}
      {shown.length === 0 && <p className="side-empty">{resolvedCount ? 'No open comments.' : 'No comments yet. Select something and write the first one.'}</p>}
      <div className="cm-list">
        {shown.map((c) => {
          const all = [c, ...(replies.get(c.id) ?? [])]
          return (
            <div key={c.id} className={`cm-thread ${focusId === c.id ? 'active' : ''} ${c.resolved ? 'done' : ''}`} onClick={() => c.anchor && onGo(c.anchor)}>
              <div className="cm-quote cm-anchor">{label(c.anchor)}</div>
              {all.map((m) => (
                <div key={m.id} className="cm-msg">
                  <Avatar name={m.author} color="#8b8aa5" size={24} />
                  <div className="cm-main">
                    <div className="cm-meta"><b>{m.author}</b><span>{ago(m.created_at)}</span>
                      {m.mentions.includes(me) && <em>mentions you</em>}
                      {m.user_id === user.id && <button className="cm-x" aria-label="Delete comment" onClick={(e) => { e.stopPropagation(); void remove(m) }}><Trash2 size={13} /></button>}
                    </div>
                    <Body text={m.body} me={me} />
                  </div>
                </div>
              ))}
              <div onClick={(e) => e.stopPropagation()}>
                {!c.resolved && !readOnly && <Composer docId={docId} placeholder="Reply" onSend={(b) => reply(c.id, b)} />}
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

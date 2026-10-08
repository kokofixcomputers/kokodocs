import { MessageSquare, Trash2 } from 'lucide-react'
import { api, type Comment, type User } from '../api'
import { Body, Composer, ago } from '../editor/Comments'
import { Avatar } from '../ui/Avatar'
import { toast } from '../ui/Toast'

/** A comment on a board card is an ordinary comment whose anchor says which card it belongs to. */
export const forCard = (list: Comment[], cardId: string) => list.filter((c) => !c.parent_id && (c.anchor as { card?: string } | null)?.card === cardId).sort((a, b) => a.created_at - b.created_at)

export function CardComments({ docId, cardId, user, list, refresh }: { docId: string; cardId: string; user: User | null; list: Comment[]; refresh: () => void }) {
  const mine = forCard(list, cardId), me = (user?.email ?? '').toLowerCase()
  const remove = async (c: Comment) => { await api.deleteComment(docId, c.id).catch((e) => toast(e.message)); refresh() }
  return (
    <section className="bd-comments" aria-label="Comments">
      <div className="bd-flabel"><MessageSquare size={14} /> Comments{mine.length ? ` (${mine.length})` : ''}</div>
      {mine.length === 0 && <p className="bd-muted">No comments yet.</p>}
      {mine.map((m) => (
        <div key={m.id} className="cm-msg">
          <Avatar name={m.author} color="#8b8aa5" size={26} />
          <div className="cm-main">
            <div className="cm-meta"><b>{m.author}</b><span>{ago(m.created_at)}</span>
              {user && m.mentions.includes(me) && <em>mentions you</em>}
              {user && m.user_id === user.id && <button className="cm-x" aria-label="Delete comment" onClick={() => void remove(m)}><Trash2 size={13} /></button>}
            </div>
            <Body text={m.body} me={me} />
          </div>
        </div>))}
      {user
        ? <Composer docId={docId} placeholder="Write a comment. Type @ to mention someone" onSend={async (body) => { await api.addComment(docId, { body, anchor: { card: cardId } }); refresh() }} />
        : <p className="bd-muted">Sign in to comment.</p>}
    </section>
  )
}

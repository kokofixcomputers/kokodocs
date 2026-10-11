import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AtSign, Bell, CheckCheck, MessageSquare, Share2 } from 'lucide-react'
import { api, type Notice } from '../api'
import { Popover } from './Popover'

const ago = (t: number) => { const s = Date.now() / 1000 - t; return s < 60 ? 'now' : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : new Date(t * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' }) }
const ICON = { mention: AtSign, comment: MessageSquare, share: Share2, access: Share2 }
const VERB = { mention: 'mentioned you in', comment: 'commented on', share: 'shared', access: 'asked for edit access to' }

export function NotificationsBell() {
  const nav = useNavigate()
  const [unread, setUnread] = useState(0)
  const [items, setItems] = useState<Notice[] | null>(null)
  const count = useCallback(() => { api.notificationCount().then((r) => setUnread(r.unread)).catch(() => {}) }, [])
  useEffect(() => { count(); const t = setInterval(count, 30000); const f = () => { if (!document.hidden) count() }; document.addEventListener('visibilitychange', f); return () => { clearInterval(t); document.removeEventListener('visibilitychange', f) } }, [count])
  const load = () => api.notifications().then((r) => { setItems(r.items); setUnread(r.unread) }).catch(() => {})
  return (
    <Popover align="end" className="notif-pop" onOpenChange={(o) => { if (o) void load() }} trigger={({ toggle }) => (
      <button className="icon-btn bell" onClick={toggle} aria-label="Notifications" title="Notifications">
        <Bell size={19} />{unread > 0 && <b className="badge">{unread > 9 ? '9+' : unread}</b>}
      </button>)}>
      {(close) => (
        <div className="notif">
          <div className="notif-head"><b>Notifications</b>
            <button className="cm-link" disabled={!unread} onClick={() => { void api.markRead({ all: true }).then(load) }}><CheckCheck size={14} />Mark all read</button></div>
          {!items ? <div className="notif-empty"><span className="spinner sm" style={{ borderColor: 'var(--accent-soft-2)', borderTopColor: 'var(--accent)' }} /></div>
            : items.length === 0 ? <p className="notif-empty">Nothing yet. Mentions, comments and shares will show up here.</p>
            : <div className="notif-list">{items.map((n) => {
              const I = ICON[n.kind] ?? Bell
              return (
                <button key={n.id} className={`notif-item ${n.read ? '' : 'unread'}`} onClick={() => { close(); void api.markRead({ ids: [n.id] }); nav(n.link) }}>
                  <span className="notif-ico"><I size={15} /></span>
                  <span className="notif-body"><span><b>{n.actor}</b> {VERB[n.kind] ?? ''} <b>{n.doc_title || 'a file'}</b>{n.kind === 'share' && n.text ? <> and {n.text.replace('gave you ', 'gave you ')}</> : null}</span>
                    {n.kind !== 'share' && n.text && <em>{n.text}</em>}</span>
                  <span className="notif-time">{ago(n.created_at)}</span>
                </button>)
            })}</div>}
        </div>)}
    </Popover>
  )
}

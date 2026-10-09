import { useEffect, useRef, useState } from 'react'
import { BarChart3, Check, Crown, Hand, MessageSquare, Mic, MicOff, MoreHorizontal, Pin, Plus, Send, Star, Trash2, UserCheck, UserX, VideoOff, X } from 'lucide-react'
import { Popover } from '../ui/Popover'
import { useContextMenu, type CtxItem } from '../ui/ContextMenu'
import { Select } from '../ui/Select'
import { askConfirm } from '../ui/Dialogs'
import { hue, initials } from './util'
import type { Call, Peer, PollView } from './types'

const Avatar = ({ name }: { name: string }) => <span className="meet-avatar sm" style={{ '--h': hue(name) } as React.CSSProperties}>{initials(name)}</span>

// ───────────────────────────── chat

export function ChatPanel({ call, peers, to, setTo }: { call: Call; peers: Peer[]; to: string; setTo: (id: string) => void }) {
  const [text, setText] = useState('')
  const log = useRef<HTMLDivElement>(null)
  const msgs = call.chat()
  const s = call.settings(), me = call.me()
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }) }, [msgs.length])
  const target = to ? peers.find((p) => p.id === to) : null
  const mode = s.chat
  const blocked = mode === 'off' || (mode === 'host' && !me.manager && !(target && target.manager))
  const submit = () => { if (text.trim() && !blocked) { call.send(text, to || undefined); setText('') } }
  const others = peers.filter((p) => !p.self)
  return (
    <>
      <div className="meet-log" ref={log}>
        {msgs.length === 0 && <p className="muted center">Messages are only kept while the meeting is open.</p>}
        {msgs.map((m) => (
          <div key={m.id} className={`meet-msg ${m.self ? 'mine' : ''} ${m.private ? 'priv' : ''}`}>
            <div className="meta"><b>{m.self ? 'You' : m.name}</b>{m.private && <i>{m.self ? `to ${m.to_name}` : 'to you'}, privately</i>}<time>{new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
            <p>{m.text}</p>
          </div>))}
      </div>
      {mode !== 'all' && <p className="meet-note">{mode === 'off' ? 'Chat is turned off.' : me.manager ? 'Only hosts can write to everyone.' : 'Only the host can write to everyone. You can message the host privately.'}</p>}
      <div className="meet-to"><span>To</span>
        <Select label="Send to" value={to || 'all'} onChange={(v) => setTo(v === 'all' ? '' : v)}
          options={[{ value: 'all', label: 'Everyone' }, ...others.map((p) => ({ value: p.id, label: p.name }))]} /></div>
      <form className="meet-send" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <span className="field"><input value={text} maxLength={2000} disabled={blocked} placeholder={target ? `Message ${target.name} privately` : 'Message everyone'} onChange={(e) => setText(e.target.value)} /></span>
        <button className="icon-btn" type="submit" aria-label="Send" disabled={!text.trim() || blocked}><Send size={18} /></button>
      </form>
    </>
  )
}

// ───────────────────────────── people

/** Everything that can be done to one person, for right-click on a tile or a row, and for the "..." button. Managers get the moderation actions. */
export function personItems(call: Call, p: Peer, o: { onMessage: (id: string) => void; pin?: { pinned: boolean; toggle: () => void } }): CtxItem[] {
  const me = call.me()
  const items: CtxItem[] = []
  if (o.pin) items.push({ label: o.pin.pinned ? 'Unpin' : 'Pin to the main view', icon: <Pin size={16} />, onClick: o.pin.toggle })
  if (p.self) return items
  items.push({ label: 'Message privately', icon: <MessageSquare size={16} />, onClick: () => o.onMessage(p.id) })
  if (me.manager && !(p.host && !me.owner)) {
    items.push({ sep: true })
    items.push(p.audio ? { label: 'Mute', icon: <MicOff size={16} />, onClick: () => call.mute(p.id) } : { label: 'Ask to unmute', icon: <Mic size={16} />, onClick: () => call.askUnmute(p.id) })
    if (p.video) items.push({ label: 'Turn off camera', icon: <VideoOff size={16} />, onClick: () => call.camOff(p.id) })
    if (p.hand > 0) items.push({ label: 'Lower hand', icon: <Hand size={16} />, onClick: () => call.lowerHand(p.id) })
    items.push({ label: call.spotlight() === p.id ? 'Remove spotlight' : 'Spotlight for everyone', icon: <Star size={16} />, onClick: () => call.spotlightTo(call.spotlight() === p.id ? null : p.id) })
    if (me.owner && !p.host) items.push({ label: p.cohost ? 'Remove co-host' : 'Make co-host', icon: <Crown size={16} />, onClick: () => call.cohost(p.id, !p.cohost) })
    if (!p.host && (!p.manager || me.owner)) {
      items.push({ sep: true })
      items.push({ label: 'Remove', icon: <UserX size={16} />, danger: true, onClick: () => void askConfirm({ title: `Remove ${p.name}?`, text: 'They are disconnected and can rejoin with the link.', label: 'Remove', danger: true }).then((y) => y && call.kick(p.id)) })
      items.push({ label: 'Remove and block', icon: <UserX size={16} />, danger: true, onClick: () => void askConfirm({ title: `Remove and block ${p.name}?`, text: "They can't come back to this meeting session.", label: 'Remove and block', danger: true }).then((y) => y && call.kick(p.id, true)) })
    }
  }
  return items
}

function ItemsMenu({ items, close }: { items: CtxItem[]; close: () => void }) {
  return (
    <div className="menu wide">
      {items.map((it, i) => 'sep' in it ? <div key={i} className="menu-sep" /> : 'label' in it ? (
        <button key={i} className={it.danger ? 'danger' : ''} onClick={() => { close(); it.onClick() }}>{it.icon}{it.label}</button>) : null)}
    </div>)
}

export function PeoplePanel({ call, peers, onMessage }: { call: Call; peers: Peer[]; onMessage: (id: string) => void }) {
  const me = call.me(), waiting = call.waiting()
  const raised = peers.filter((p) => p.hand > 0).sort((a, b) => a.hand - b.hand)
  return (
    <div className="meet-people">
      {me.manager && waiting.length > 0 && (
        <section className="meet-wait-list">
          <header><b>Waiting to join ({waiting.length})</b>{waiting.length > 1 && <button className="btn btn-soft btn-sm" onClick={() => call.admit('all')}>Admit all</button>}</header>
          {waiting.map((w) => (
            <div key={w.id} className="meet-person"><Avatar name={w.name} /><span className="name">{w.name}{w.guest && <i className="meet-tag">guest</i>}{w.reason === 'host' && <i className="meet-tag">waiting for the host</i>}</span>
              <button className="icon-btn sm ok" title="Let in" aria-label={`Let ${w.name} in`} onClick={() => call.admit(w.id)}><UserCheck size={16} /></button>
              <button className="icon-btn sm" title="Turn away" aria-label={`Turn ${w.name} away`} onClick={() => call.deny(w.id)}><X size={16} /></button></div>))}
        </section>)}
      {raised.length > 0 && (
        <section className="meet-hands-list">
          <header><b>Raised hands</b>{me.manager && <button className="btn btn-soft btn-sm" onClick={() => call.lowerHand('all')}>Lower all</button>}</header>
          {raised.map((p) => <div key={p.id} className="meet-person"><Avatar name={p.name} /><span className="name">{p.self ? `${p.name} (you)` : p.name}</span><span className="meet-hand-n"><Hand size={14} />{p.hand}</span></div>)}
        </section>)}
      <header className="meet-people-h"><b>In the meeting ({peers.length})</b></header>
      {peers.map((p) => <Row key={p.id} call={call} p={p} onMessage={onMessage} />)}
    </div>
  )
}

function Row({ call, p, onMessage }: { call: Call; p: Peer; onMessage: (id: string) => void }) {
  const ctx = useContextMenu()
  const items = () => personItems(call, p, { onMessage })
  return (
        <div className="meet-person" {...ctx.bind(items)}>
          {ctx.node}
          <Avatar name={p.name} />
          <span className="name">{p.self ? `${p.name} (you)` : p.name}{p.host && <Crown size={13} aria-label="Host" />}{p.cohost && <Star size={13} aria-label="Co-host" />}{p.guest && <i className="meet-tag">guest</i>}</span>
          {!p.audio && <MicOff size={15} className="muted" />}
          {!p.self && (
            <Popover align="end" trigger={({ toggle }) => <button className="icon-btn sm" onClick={toggle} aria-label={`Options for ${p.name}`}><MoreHorizontal size={16} /></button>}>
              {(close) => <ItemsMenu items={items()} close={close} />}
            </Popover>)}
        </div>
  )
}

// ───────────────────────────── polls

function Results({ poll, call }: { poll: PollView; call: Call }) {
  const me = call.me()
  const pick = (i: number) => {
    if (!poll.open) return
    const next = poll.multi ? (poll.mine.includes(i) ? poll.mine.filter((x) => x !== i) : [...poll.mine, i]) : [i]
    call.vote(poll.id, next)
  }
  return (
    <div className="meet-poll">
      <div className="q"><BarChart3 size={15} /><b>{poll.q}</b></div>
      <p className="muted small">{poll.open ? 'Open' : 'Closed'} · {poll.total} {poll.total === 1 ? 'vote' : 'votes'}{poll.multi ? ' · choose any' : ''}{poll.anonymous ? ' · anonymous' : ''}</p>
      {poll.options.map((o, i) => {
        const pct = poll.total ? Math.round((poll.counts[i] / poll.total) * 100) : 0
        const mine = poll.mine.includes(i)
        return (
          <button key={i} className={`opt ${mine ? 'mine' : ''}`} disabled={!poll.open} onClick={() => pick(i)} aria-pressed={mine}>
            <span className="bar" style={{ width: `${pct}%` }} />
            <span className="lbl">{mine && <Check size={14} />}{o}</span><span className="n">{poll.counts[i]} · {pct}%</span>
          </button>)
      })}
      {!poll.anonymous && me.manager && poll.total > 0 && (
        <details className="who"><summary>Who voted</summary>{poll.options.map((o, i) => poll.names?.[i]?.length ? <p key={i}><b>{o}:</b> {poll.names[i].join(', ')}</p> : null)}</details>)}
      {me.manager && (
        <div className="poll-actions">
          {poll.open ? <button className="btn btn-soft btn-sm" onClick={() => call.poll({ action: 'close', id: poll.id })}>Close poll</button>
            : <button className="btn btn-soft btn-sm" onClick={() => call.poll({ action: 'reopen', id: poll.id })}>Reopen</button>}
          <button className="icon-btn sm" aria-label="Delete poll" onClick={() => call.poll({ action: 'delete', id: poll.id })}><Trash2 size={15} /></button>
        </div>)}
    </div>)
}

export function PollsPanel({ call }: { call: Call }) {
  const me = call.me(), polls = call.polls()
  const [making, setMaking] = useState(false)
  const [q, setQ] = useState('')
  const [opts, setOpts] = useState(['', ''])
  const [multi, setMulti] = useState(false)
  const [anon, setAnon] = useState(false)
  const valid = q.trim() && opts.filter((o) => o.trim()).length >= 2
  const create = () => {
    call.poll({ action: 'create', q, options: opts.filter((o) => o.trim()), multi, anonymous: anon })
    setMaking(false); setQ(''); setOpts(['', '']); setMulti(false); setAnon(false)
  }
  return (
    <div className="meet-polls">
      {me.manager && !making && <button className="btn btn-primary btn-pill btn-sm" onClick={() => setMaking(true)}><Plus size={15} />New poll</button>}
      {making && (
        <form className="meet-newpoll" onSubmit={(e) => { e.preventDefault(); if (valid) create() }}>
          <span className="field"><input autoFocus value={q} placeholder="Ask a question" maxLength={200} onChange={(e) => setQ(e.target.value)} /></span>
          {opts.map((o, i) => (
            <span className="field" key={i}><input value={o} placeholder={`Choice ${i + 1}`} maxLength={100} onChange={(e) => setOpts(opts.map((x, j) => (j === i ? e.target.value : x)))} />
              {opts.length > 2 && <button type="button" className="icon-btn sm" aria-label="Remove choice" onClick={() => setOpts(opts.filter((_, j) => j !== i))}><X size={14} /></button>}</span>))}
          {opts.length < 8 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpts([...opts, ''])}><Plus size={14} />Add a choice</button>}
          <label className="check"><input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} />People can choose more than one</label>
          <label className="check"><input type="checkbox" checked={anon} onChange={(e) => setAnon(e.target.checked)} />Anonymous</label>
          <div className="row"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setMaking(false)}>Cancel</button><button className="btn btn-primary btn-sm" disabled={!valid}>Start poll</button></div>
        </form>)}
      {polls.length === 0 && !making && <p className="muted center">{me.manager ? 'Ask the room a question with a poll.' : 'No polls yet.'}</p>}
      {[...polls].reverse().map((p) => <Results key={p.id} poll={p} call={call} />)}
    </div>)
}

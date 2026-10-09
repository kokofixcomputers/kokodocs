import { useEffect, useRef, useState } from 'react'
import { BarChart3, Check, Crown, Hand, MessageSquare, MicOff, MoreHorizontal, Plus, Send, Star, Trash2, UserCheck, UserX, X } from 'lucide-react'
import { Popover } from '../ui/Popover'
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

function PersonMenu({ call, p, onMessage, close }: { call: Call; p: Peer; onMessage: (id: string) => void; close: () => void }) {
  const me = call.me()
  const go = (f: () => void) => () => { close(); f() }
  return (
    <div className="menu wide">
      <button onClick={go(() => onMessage(p.id))}><MessageSquare size={16} />Message privately</button>
      {me.manager && <>
        {p.audio ? <button onClick={go(() => call.mute(p.id))}><MicOff size={16} />Mute</button> : <button onClick={go(() => call.askUnmute(p.id))}><MicOff size={16} />Ask to unmute</button>}
        {p.hand > 0 && <button onClick={go(() => call.lowerHand(p.id))}><Hand size={16} />Lower hand</button>}
        <button onClick={go(() => call.spotlightTo(call.spotlight() === p.id ? null : p.id))}><Star size={16} />{call.spotlight() === p.id ? 'Remove spotlight' : 'Spotlight for everyone'}</button>
        {me.owner && !p.host && <button onClick={go(() => call.cohost(p.id, !p.cohost))}><Crown size={16} />{p.cohost ? 'Remove co-host' : 'Make co-host'}</button>}
        {!p.host && (!p.manager || me.owner) && <>
          <div className="menu-sep" />
          <button className="danger" onClick={go(() => void askConfirm({ title: `Remove ${p.name}?`, text: 'They are disconnected and can rejoin with the link.', label: 'Remove', danger: true }).then((y) => y && call.kick(p.id)))}><UserX size={16} />Remove</button>
          <button className="danger" onClick={go(() => void askConfirm({ title: `Remove and block ${p.name}?`, text: "They can't come back to this meeting session.", label: 'Remove and block', danger: true }).then((y) => y && call.kick(p.id, true)))}><UserX size={16} />Remove and block</button>
        </>}
      </>}
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
            <div key={w.id} className="meet-person"><Avatar name={w.name} /><span className="name">{w.name}{w.reason === 'host' && <i className="meet-tag">waiting for the host</i>}</span>
              <button className="icon-btn sm ok" title="Let in" aria-label={`Let ${w.name} in`} onClick={() => call.admit(w.id)}><UserCheck size={16} /></button>
              <button className="icon-btn sm" title="Turn away" aria-label={`Turn ${w.name} away`} onClick={() => call.deny(w.id)}><X size={16} /></button></div>))}
        </section>)}
      {raised.length > 0 && (
        <section className="meet-hands-list">
          <header><b>Raised hands</b>{me.manager && <button className="btn btn-soft btn-sm" onClick={() => call.lowerHand('all')}>Lower all</button>}</header>
          {raised.map((p) => <div key={p.id} className="meet-person"><Avatar name={p.name} /><span className="name">{p.self ? `${p.name} (you)` : p.name}</span><span className="meet-hand-n"><Hand size={14} />{p.hand}</span></div>)}
        </section>)}
      <header className="meet-people-h"><b>In the meeting ({peers.length})</b></header>
      {peers.map((p) => (
        <div key={p.id} className="meet-person">
          <Avatar name={p.name} />
          <span className="name">{p.self ? `${p.name} (you)` : p.name}{p.host && <Crown size={13} aria-label="Host" />}{p.cohost && <Star size={13} aria-label="Co-host" />}</span>
          {!p.audio && <MicOff size={15} className="muted" />}
          {!p.self && (
            <Popover align="end" trigger={({ toggle }) => <button className="icon-btn sm" onClick={toggle} aria-label={`Options for ${p.name}`}><MoreHorizontal size={16} /></button>}>
              {(close) => <PersonMenu call={call} p={p} onMessage={onMessage} close={close} />}
            </Popover>)}
        </div>))}
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

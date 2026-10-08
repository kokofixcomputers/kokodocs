import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Check, ChevronDown, CircleAlert, FolderSearch, History, Loader2, MessageSquarePlus, Settings2, ShieldCheck, Sparkles, Square, Trash2, X } from 'lucide-react'
import { type AiFilesMode, type AiSettings, type User } from '../api'
import { Popover } from '../ui/Popover'
import { toast } from '../ui/Toast'
import type { Adapter } from './adapter'
import { AiSettingsDialog } from './AiSettings'
import { Markdown } from './Markdown'
import { type Item, type PCall, useAssistant } from './useAssistant'

function Proposal({ item, decide, canEdit }: { item: Extract<Item, { k: 'proposal' }>; decide: (id: string, d: 'approve' | 'session' | 'skip') => void; canEdit: boolean }) {
  const n = item.calls.length
  const pending = item.status === 'pending'
  if (item.kind === 'read') {   // Koko wants to look at another of the person's files
    const c = item.calls[0]
    return (
      <div className={`ai-card read ${item.status}`}>
        <div className="ai-card-head"><FolderSearch size={15} /><b>{pending ? 'Koko would like to look at another file' : item.status === 'skipped' ? 'Not allowed' : 'Allowed'}</b></div>
        <ul className="ai-edits"><li><span className="ai-edit-title">{c.item.title}</span>{c.item.detail && <span className="ai-edit-detail">{c.item.detail}</span>}</li></ul>
        {pending && (
          <div className="ai-card-actions">
            <button className="btn btn-pill btn-primary btn-sm" onClick={() => decide(item.id, 'approve')}>Allow</button>
            <button className="btn btn-pill btn-soft btn-sm" onClick={() => decide(item.id, 'session')}>Allow for this session</button>
            <button className="btn btn-pill btn-ghost btn-sm" onClick={() => decide(item.id, 'skip')}>Don't</button>
          </div>)}
      </div>
    )
  }
  return (
    <div className={`ai-card ${item.status}`}>
      <div className="ai-card-head">
        <ShieldCheck size={15} />
        <b>{pending ? (n === 1 ? 'Koko would like to make an edit' : `Koko would like to make ${n} edits`) : item.status === 'skipped' ? 'Edit skipped' : n === 1 ? 'Edit made' : `${n} edits made`}</b>
      </div>
      <ul className="ai-edits">
        {item.calls.map((c: PCall) => (
          <li key={c.id} className={c.state}>
            <span className="ai-edit-title">{c.item.title}{c.state === 'done' && <Check size={13} />}{c.state === 'error' && <CircleAlert size={13} />}</span>
            {c.item.detail && <span className="ai-edit-detail">{c.item.detail}</span>}
            {c.item.before && <span className="ai-diff del">{c.item.before}</span>}
            {c.item.after && <span className="ai-diff add">{c.item.after}</span>}
            {c.note && <span className="ai-edit-err">{c.note}</span>}
          </li>
        ))}
      </ul>
      {pending && canEdit && (
        <div className="ai-card-actions">
          <button className="btn btn-pill btn-primary btn-sm" onClick={() => decide(item.id, 'approve')}>Approve</button>
          <button className="btn btn-pill btn-soft btn-sm" onClick={() => decide(item.id, 'session')}>Approve for this session</button>
          <button className="btn btn-pill btn-ghost btn-sm" onClick={() => decide(item.id, 'skip')}>Skip</button>
        </div>
      )}
    </div>
  )
}

export default function AssistantPanel({ adapter, docId, user, settings, onSettings, onClose, initialPrompt }: {
  adapter: Adapter; docId: string; user: User; settings: AiSettings | null; onSettings: (s: AiSettings) => void; onClose: () => void; initialPrompt?: string | null
}) {
  const a = useAssistant(adapter, docId, user, settings)
  const [text, setText] = useState('')
  const sentFirst = useRef(false)
  // a request typed in the template gallery runs as soon as the new file opens
  useEffect(() => { if (initialPrompt && a.configured && !sentFirst.current) { sentFirst.current = true; a.send(initialPrompt) } }, [initialPrompt, a.configured])
  const [showSettings, setShowSettings] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const feed = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const stick = useRef(true)

  useEffect(() => { const f = feed.current; if (f && stick.current) f.scrollTop = f.scrollHeight }, [a.items])
  useEffect(() => { const t = box.current; if (!t) return; t.style.height = 'auto'; t.style.height = Math.min(140, t.scrollHeight) + 'px' }, [text])

  const submit = () => { if (!text.trim()) return; a.send(text); setText(''); stick.current = true }
  const lastItem = a.items[a.items.length - 1]
  const lastIsWorking = a.busy && lastItem?.k !== 'assistant' && !(lastItem?.k === 'proposal' && lastItem.status === 'pending')

  return (
    <div className="side-body ai-panel">
      <div className="ai-head">
        <div className="side-title" style={{ padding: 0 }}><Sparkles size={18} /><h3>Koko</h3></div>
        <div className="ai-head-actions">
          <button className="icon-btn sm" title="New conversation" aria-label="New conversation" onClick={() => { void a.newConversation(); setShowHistory(false) }}><MessageSquarePlus size={17} /></button>
          <button className={`icon-btn sm ${showHistory ? 'active' : ''}`} title="Past conversations" aria-label="Past conversations" onClick={() => setShowHistory((v) => !v)}><History size={17} /></button>
          <button className="icon-btn sm" title="Connection settings" aria-label="Connection settings" onClick={() => setShowSettings(true)}><Settings2 size={17} /></button>
          <button className="icon-btn sm" title="Close" aria-label="Close" onClick={onClose}><X size={17} /></button>
        </div>
      </div>

      {a.configured && (
        <div className="ai-files-row">
          <Popover className="ai-files-pop" trigger={({ toggle }) => (
            <button className={`ai-files-btn ${a.filesMode !== 'off' ? 'on' : ''}`} aria-label="Other files" onMouseDown={(e) => e.preventDefault()} onClick={toggle}>
              <FolderSearch size={14} />Other files: <b>{a.filesMode === 'off' ? 'Off' : a.filesMode === 'ask' ? 'Ask first' : 'Allowed'}</b><ChevronDown size={13} /></button>)}>
            {(close) => (
              <div className="ai-files-menu" role="radiogroup" aria-label="Let Koko look at your other files">
                <p>Let Koko read your <b>other</b> files to answer questions and cross-check things. It can never change them, and only sees files you can open yourself.</p>
                {([['off', 'Off', 'Koko only sees the file you have open.'], ['ask', 'Ask first', 'Koko asks each time it wants to look. You say yes or no.'], ['allow', 'Allowed', 'Koko can look when it needs to. You still see what it read.']] as [AiFilesMode, string, string][]).map(([m, label, hint]) => (
                  <button key={m} role="radio" aria-checked={a.filesMode === m} className={a.filesMode === m ? 'on' : ''}
                    onClick={() => { close(); a.setFilesMode(m).catch((e) => toast((e as Error).message)) }}><span><b>{label}</b><em>{hint}</em></span>{a.filesMode === m && <Check size={15} />}</button>))}
              </div>)}
          </Popover>
        </div>)}

      {showHistory && (
        <div className="ai-history">
          {a.history.length === 0 && <p className="side-empty">No past conversations on this {adapter.noun}.</p>}
          {a.history.map((h) => (
            <div key={h.id} className={`ai-hist-row ${h.id === a.convId ? 'on' : ''}`}>
              <button onClick={() => { void a.openConversation(h.id); setShowHistory(false) }}><b>{h.title}</b><span>{new Date(h.updated_at * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span></button>
              <button className="icon-btn sm" aria-label="Delete conversation" onClick={() => void a.removeConversation(h.id)}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      )}

      {!a.configured ? (
        <div className="ai-empty">
          <p><b>Connect a model to get started.</b></p>
          <p className="muted">Koko works with any OpenAI-compatible service, such as Mistral or OpenAI.</p>
          <button className="btn btn-pill btn-primary" onClick={() => setShowSettings(true)}>Connect</button>
        </div>
      ) : (
        <>
          <div className="ai-feed" ref={feed} onScroll={(e) => { const f = e.currentTarget; stick.current = f.scrollHeight - f.scrollTop - f.clientHeight < 60 }}>
            {a.items.length === 0 && (
              <div className="ai-empty">
                <p><b>Hi {user.name.split(' ')[0]}.</b> I can read this {adapter.noun} and work on it with you.</p>
                <div className="ai-suggest">{adapter.suggestions.map((s) => <button key={s} className="chip" onClick={() => a.send(s)}>{s}</button>)}</div>
              </div>
            )}
            {a.items.map((i) => {
              if (i.k === 'user') return <div key={i.id} className="ai-user">{i.text}</div>
              if (i.k === 'assistant') return i.text ? <div key={i.id} className="ai-msg"><Markdown text={i.text} /></div> : null
              if (i.k === 'activity') return <div key={i.id} className={`ai-act ${i.status}`}>{i.status === 'run' ? <Loader2 size={13} className="spin" /> : i.status === 'error' ? <CircleAlert size={13} /> : <Check size={13} />}<span>{i.text}</span></div>
              if (i.k === 'proposal') return <Proposal key={i.id} item={i} decide={a.decide} canEdit={adapter.canEdit()} />
              return <div key={i.id} className="ai-notice">{i.text}</div>
            })}
            {lastIsWorking && <div className="ai-act run"><Loader2 size={13} className="spin" /><span>Thinking</span></div>}
          </div>
          {a.readApprove && a.filesMode === 'ask' && (
            <div className="ai-session"><FolderSearch size={14} /><span>Looking at your other files is allowed for this session</span><button onClick={a.revokeReads}>Turn off</button></div>
          )}
          {a.sessionApprove && (
            <div className="ai-session"><ShieldCheck size={14} /><span>Edits are auto-approved for this session</span><button onClick={a.revokeSession}>Turn off</button></div>
          )}
          <div className="ai-composer">
            <textarea ref={box} rows={1} value={text} placeholder={`Ask Koko about this ${adapter.noun}`} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() } }} />
            {a.busy
              ? <button className="ai-send stop" aria-label="Stop" onClick={a.stop}><Square size={13} fill="currentColor" /></button>
              : <button className="ai-send" aria-label="Send" disabled={!text.trim()} onClick={submit}><ArrowUp size={17} /></button>}
          </div>
        </>
      )}
      {showSettings && <AiSettingsDialog settings={settings} onSaved={onSettings} onClose={() => setShowSettings(false)} />}
    </div>
  )
}

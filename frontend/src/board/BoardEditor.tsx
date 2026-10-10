import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { EncryptionBadge } from '../zk/EncryptionBadge'
import { Link } from 'react-router-dom'
import * as Y from 'yjs'
import { AlertCircle, ArrowLeft, ArrowRight, Calendar, CheckSquare, ChevronDown, ChevronUp, Cloud, CloudOff, Copy, GripVertical, Hash, Kanban, MessageSquare, Sparkles, CalendarDays, GanttChart, Table2, Link2, LogIn, Moon, MoreHorizontal, Plus, Redo2, Settings2, Share2, Sun, Tags, Trash2, Type, Undo2, X } from 'lucide-react'
import { api, type ApiError, type Comment, type DocInfo, type User } from '../api'
import { useAuth } from '../auth'
import { KokoProvider } from '../collab'
import { ShareDialog } from '../editor/ShareDialog'
import { useTheme } from '../theme'
import { Avatar } from '../ui/Avatar'
import { askConfirm } from '../ui/Dialogs'
import { Select } from '../ui/Select'
import { useVoiceTyping } from '../voice/useVoiceTyping'
import { VoicePill } from '../voice/VoicePill'
import { VoiceFab } from '../voice/VoiceControl'
import { useZoom, Zoomed } from '../ui/zoom'
import { useContextMenu, type CtxItem } from '../ui/ContextMenu'
import { DatePicker } from '../ui/DatePicker'
import { Logo } from '../ui/Logo'
import { Modal } from '../ui/Modal'
import { Popover } from '../ui/Popover'
import { toast } from '../ui/Toast'
import { openSettings } from '../ui/settingsStore'
import { BoardModel, COLORS, customRegex, FORMATS, isEmpty, problem, TYPE_LABEL, uid, type Card, type FieldDef, type FieldType, type TextFormat, type Value } from './model'
import '../forms/forms.css'
import { Chip, today, type F } from './shared'
import { CardComments, forCard } from './CardComments'
import { useComments } from '../editor/Comments'
import { CalendarView } from './CalendarView'
import { RoadmapView } from './RoadmapView'
import { TableView } from './TableView'
import type { OpenTarget } from './views'
import './board.css'
const AssistantHost = lazy(() => import('../assistant/AssistantHost'))

type C = { id: string } & Card
const ICON: Record<FieldType, typeof Type> = { text: Type, number: Hash, date: Calendar, single: ChevronDown, multi: Tags, checkbox: CheckSquare, link: Link2 }
const FIELD_TYPES = Object.keys(TYPE_LABEL) as FieldType[]
const ANIMALS = ['Otter', 'Fox', 'Koala', 'Panda', 'Heron', 'Lynx', 'Gecko', 'Falcon']
function guestIdentity() {
  try { const s = sessionStorage.getItem('koko.guest'); if (s) return JSON.parse(s) as { name: string; color: string } } catch { /* ignore */ }
  const g = { name: `Guest ${ANIMALS[Math.floor(Math.random() * ANIMALS.length)]}`, color: COLORS[Math.floor(Math.random() * COLORS.length)] }
  try { sessionStorage.setItem('koko.guest', JSON.stringify(g)) } catch { /* ignore */ }
  return g
}

type Tab = 'board' | 'table' | 'roadmap' | 'calendar' | 'fields'
const TABS: { id: Tab; label: string; icon: typeof Kanban }[] = [{ id: 'board', label: 'Board', icon: Kanban }, { id: 'table', label: 'Table', icon: Table2 }, { id: 'roadmap', label: 'Roadmap', icon: GanttChart }, { id: 'calendar', label: 'Calendar', icon: CalendarDays }]

function useVersion(m: BoardModel) { const [v, setV] = useState(0); useEffect(() => m.subscribe(() => setV(m.version)), [m]); return v }
function useStatus(p: KokoProvider) { const [, f] = useState(0); useEffect(() => p.subscribe(() => f((n) => n + 1)), [p]); return { status: p.status, synced: p.synced } }

export default function BoardEditor({ info }: { info: DocInfo }) {
  const { user } = useAuth()
  const readOnly = info.role === 'viewer'
  const identity = useMemo(() => (user ? { name: user.name, color: user.color } : guestIdentity()), [user])
  const ydoc = useMemo(() => new Y.Doc(), [])
  const model = useMemo(() => new BoardModel(ydoc), [ydoc])
  const [provider, setProvider] = useState<KokoProvider | null>(null)
  useEffect(() => {
    const p = new KokoProvider(info.id, ydoc, readOnly)
    p.awareness.setLocalStateField('user', identity)
    setProvider(p)
    return () => { p.destroy(); setProvider(null) }
  }, [info.id, ydoc, identity, readOnly])
  useEffect(() => () => model.destroy(), [model])
  if (!provider) return <div className="splash"><span className="spinner" /></div>
  return <Inner info={info} model={model} provider={provider} readOnly={readOnly} />
}

function Inner({ info, model, provider, readOnly }: { info: DocInfo; model: BoardModel; provider: KokoProvider; readOnly: boolean }) {
  const { user, logout } = useAuth()
  const { theme, toggle } = useTheme()
  const version = useVersion(model)
  const { status, synced } = useStatus(provider)
  const [title, setTitle] = useState(info.title)
  const [tab, setTabState] = useState<Tab>(() => { try { const t = localStorage.getItem('koko.boardview') as Tab; return TABS.some((x) => x.id === t) ? t : 'board' } catch { return 'board' } })
  const setTab = (t: Tab) => { setTabState(t); try { localStorage.setItem('koko.boardview', t) } catch { /* ignore */ } }
  const [share, setShare] = useState(false)
  const [assistant, setAssistant] = useState(false)
  const [open, setOpen] = useState<OpenTarget | null>(null)
  const [people, setPeople] = useState<{ id: number; name: string; color: string }[]>([])
  const [filter, setFilter] = useState('')
  const { list: comments, refresh: refreshComments } = useComments(info.id, true)
  void version
  const cols = model.columns(), fields = model.fieldList()

  useEffect(() => { if (synced && !readOnly) model.ensure() }, [synced, model, readOnly])
  // voice typing: only while the cursor is in a text box (the title, a card's title or notes, a field, the filter, Koko's message box)
  const voice = useVoiceTyping({ editor: null, docId: info.id, enabled: !readOnly, fieldsOnly: true })
  const uz = useZoom('board')
  const [inField, setInField] = useState(false)
  useEffect(() => {
    const check = () => { const a = document.activeElement; setInField(a instanceof HTMLTextAreaElement || (a instanceof HTMLInputElement && /^(text|search|url)$/.test(a.type))) }
    const out = () => { setTimeout(check, 0) }
    document.addEventListener('focusin', check); document.addEventListener('focusout', out)
    return () => { document.removeEventListener('focusin', check); document.removeEventListener('focusout', out) }
  }, [])
  useEffect(() => { const f = () => { const t = model.meta.get('title'); if (typeof t === 'string') setTitle(t) }; model.meta.observe(f); f(); return () => model.meta.unobserve(f) }, [model])
  const timer = useRef<number | undefined>(undefined)
  const onTitle = (v: string) => {
    setTitle(v); model.meta.set('title', v)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => api.renameDoc(info.id, v).catch((e: ApiError) => toast(e.message)), 600)
  }
  useEffect(() => { document.title = `${title || 'Untitled board'} - KokoDocs` }, [title])
  useEffect(() => {
    const f = () => {
      const p: { id: number; name: string; color: string }[] = []
      provider.awareness.getStates().forEach((s, id) => { if (id !== provider.doc.clientID && s.user) p.push({ id, ...(s.user as { name: string; color: string }) }) })
      setPeople(p)
    }
    provider.awareness.on('change', f); f()
    return () => provider.awareness.off('change', f)
  }, [provider])
  useEffect(() => {
    const changed = () => { toast('Your access to this board changed'); setTimeout(() => location.reload(), 900) }
    window.addEventListener('koko:access-changed', changed)
    return () => window.removeEventListener('koko:access-changed', changed)
  }, [])
  useEffect(() => {
    const k = (ev: KeyboardEvent) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z' && !readOnly && !(ev.target as HTMLElement)?.closest('input, textarea')) { ev.preventDefault(); ev.shiftKey ? model.undo.redo() : model.undo.undo() }
    }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [model, readOnly])

  const ConnIcon = status === 'connected' ? Cloud : CloudOff
  const connLabel = status === 'connected' ? 'Saved' : status === 'denied' ? 'No access' : status === 'offline' ? 'Offline' : 'Reconnecting'
  const copyLink = () => navigator.clipboard.writeText(`${location.origin}/d/${info.id}`).then(() => toast('Board link copied'), () => toast(`${location.origin}/d/${info.id}`))

  return (
    <div className={`editor-shell bd-shell ${assistant ? 'ai-open' : ''}`}>
      <header className="ed-top">
        <div className="ed-left">
          {user ? <Link to="/" className="logo-link" title="All documents"><Logo size={32} /></Link> : <span className="logo-link"><Logo size={32} /></span>}
          <input className="title-input" value={title} onChange={(e) => onTitle(e.target.value)} placeholder="Untitled board" aria-label="Board title" maxLength={200} readOnly={readOnly} />
          <span className={`status-pill ${status}`}><ConnIcon size={14} /><span className="lbl">{connLabel}</span></span>
          <EncryptionBadge info={info} />
        </div>
        <div className="ed-right">
          <div className="presence">{people.slice(0, 5).map((p) => <Avatar key={p.id} name={p.name} color={p.color} size={32} ring />)}{people.length > 5 && <span className="more" data-tip={people.slice(5).map((x) => x.name).join(', ')}>+{people.length - 5}</span>}</div>
          {!readOnly && <button className="icon-btn" title="Undo" aria-label="Undo" onClick={() => model.undo.undo()}><Undo2 size={18} /></button>}
          {!readOnly && <button className="icon-btn" title="Redo" aria-label="Redo" onClick={() => model.undo.redo()}><Redo2 size={18} /></button>}
          <button className="icon-btn" title="Copy board link" aria-label="Copy board link" onClick={copyLink}><Copy size={18} /></button>
          <button className="icon-btn" onClick={toggle} aria-label="Toggle theme">{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
          {user && <button className={`btn btn-pill btn-soft ${assistant ? 'active' : ''}`} aria-pressed={assistant} onClick={() => setAssistant((v) => !v)}><Sparkles size={16} /><span className="lbl">Assistant</span></button>}
          {info.role !== 'viewer' && <button className="btn btn-pill btn-primary" onClick={() => setShare(true)}><Share2 size={16} /><span className="lbl">Share</span></button>}
          {user ? (
            <Popover align="end" trigger={({ toggle: t }) => <button className="avatar-btn" onClick={t}><Avatar name={user.name} color={user.color} size={34} /></button>}>
              {(close) => (<div className="menu wide"><div className="menu-head"><strong>{user.name}</strong><span>{user.email}</span></div><Link to="/" className="menu-link" onClick={close}>All documents</Link><button onClick={() => { close(); openSettings() }}>Settings</button><button onClick={() => { close(); logout() }}>Sign out</button></div>)}
            </Popover>
          ) : <Link className="btn btn-pill btn-ghost" to="/login" state={{ from: `/d/${info.id}` }}><LogIn size={16} />Sign in</Link>}
        </div>
      </header>
      <nav className="fm-tabs bd-tabs" role="tablist" aria-label="Board sections">
        {TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}><t.icon size={16} /><span className="bd-tab-l">{t.label}</span></button>)}
        {!readOnly && <button role="tab" aria-selected={tab === 'fields'} className={tab === 'fields' ? 'on' : ''} onClick={() => setTab('fields')}><Settings2 size={16} /><span className="bd-tab-l">Fields{fields.length ? ` (${fields.length})` : ''}</span></button>}
        {tab !== 'fields' && <input className="bd-filter" type="search" placeholder="Filter cards" aria-label="Filter cards" value={filter} onChange={(e) => setFilter(e.target.value)} />}
      </nav>

      <Zoomed zoom={uz} fitLabel="Fit the whole board">
      {tab === 'board' && <Columns model={model} cols={cols} fields={fields} readOnly={readOnly} filter={filter} onOpen={setOpen} comments={comments} />}
      {tab === 'table' && <TableView model={model} cols={cols} fields={fields} readOnly={readOnly} filter={filter} onOpen={setOpen} title={title} />}
      {tab === 'roadmap' && <RoadmapView model={model} cols={cols} fields={fields} readOnly={readOnly} filter={filter} onOpen={setOpen} />}
      {tab === 'calendar' && <CalendarView model={model} cols={cols} fields={fields} readOnly={readOnly} filter={filter} onOpen={setOpen} />}
      {tab === 'fields' && !readOnly && <FieldsPage model={model} fields={fields} />}
      </Zoomed>

      {open && <CardDialog model={model} fields={fields} cols={cols} target={open} readOnly={readOnly} onClose={() => setOpen(null)} docId={info.id} user={user} comments={comments} refreshComments={refreshComments} />}
      <VoicePill voice={voice} />
      <VoiceFab voice={voice} editable={!readOnly && (inField || voice.phase !== 'idle')} />
      {share && <ShareDialog info={{ ...info, title }} onClose={() => setShare(false)} />}
      {user && assistant && <aside className="ai-drawer" aria-label="Assistant"><Suspense fallback={null}><AssistantHost docId={info.id} user={user} onClose={() => setAssistant(false)} source={{ kind: 'board', deps: { model, getTitle: () => title, setTitle: onTitle, canEdit: () => !readOnly } }} /></Suspense></aside>}
    </div>
  )
}

// ---------- the columns ----------

function Columns({ model, cols, fields, readOnly, filter, onOpen, comments }: { model: BoardModel; cols: ({ id: string; name: string; color: string })[]; fields: F[]; readOnly: boolean; filter: string; onOpen: (t: OpenTarget) => void; comments: Comment[] }) {
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; title: string; over: string | null; before: string | null } | null>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const cm = useContextMenu()
  const [cur, setCur] = useState(0)   // the column most in view (for the strip of column names shown on phones)
  const q = filter.trim().toLowerCase()
  const visible = fields.filter((f) => !f.hidden)

  // Pointer-based dragging so it works with a mouse and a finger alike (a finger drags by the grip, so the column can still scroll).
  const startDrag = (e: React.PointerEvent, c: C) => {
    if (readOnly || e.button !== 0) return
    const touchGrip = (e.target as HTMLElement).closest('.bd-grip')
    if (e.pointerType !== 'mouse' && !touchGrip) return
    if ((e.target as HTMLElement).closest('button, a, input')  && !touchGrip) return
    const sx = e.clientX, sy = e.clientY
    let moved = false
    const locate = (x: number, y: number) => {
      const col = document.elementsFromPoint(x, y).map((el) => (el as HTMLElement).closest?.('[data-col]')).find(Boolean) as HTMLElement | undefined
      if (!col) return { over: null, before: null }
      const cards = [...col.querySelectorAll<HTMLElement>('[data-card]')].filter((el) => el.dataset.card !== c.id)
      const next = cards.find((el) => { const r = el.getBoundingClientRect(); return y < r.top + r.height / 2 })
      return { over: col.dataset.col!, before: next?.dataset.card ?? null }
    }
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return
      moved = true; ev.preventDefault()
      setDrag({ id: c.id, x: ev.clientX, y: ev.clientY, title: c.title, ...locate(ev.clientX, ev.clientY) })
      const box = wrap.current; if (box) { const r = box.getBoundingClientRect(); if (ev.clientX > r.right - 70) box.scrollLeft += 18; else if (ev.clientX < r.left + 70) box.scrollLeft -= 18 }
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up)
      setDrag(null)
      if (!moved) return
      const t = locate(ev.clientX, ev.clientY)
      if (t.over && ev.type !== 'pointercancel') model.moveCard(c.id, t.over, t.before)
      suppressClick.current = true; setTimeout(() => { suppressClick.current = false }, 0)
    }
    window.addEventListener('pointermove', move, { passive: false }); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up)
  }
  const suppressClick = useRef(false)

  /** Press and hold (or right-click) a card: move it to another column without dragging, open it, or delete it. */
  const cardMenu = (c: C): CtxItem[] => readOnly ? [] : [
    { heading: 'Move to' },
    ...cols.map((col) => ({ label: col.name, checked: col.id === c.col, onClick: () => { if (col.id !== c.col) model.moveCard(c.id, col.id, null) } })),
    { sep: true },
    { label: 'Open', onClick: () => onOpen({ id: c.id }) },
    { label: 'Delete', danger: true, onClick: async () => { if (await askConfirm({ title: 'Delete this card?', text: 'It is removed from the board for everyone, with its comments.', label: 'Delete', danger: true })) model.removeCard(c.id) } },
  ]
  const onScroll = () => {
    const box = wrap.current; if (!box) return
    const kids = [...box.querySelectorAll<HTMLElement>('[data-col]')]
    let best = 0, d = Infinity
    const left = box.getBoundingClientRect().left
    kids.forEach((k, i) => { const x = Math.abs(k.getBoundingClientRect().left - left); if (x < d) { d = x; best = i } })
    setCur(best)
  }
  const jump = (i: number) => { const k = wrap.current?.querySelectorAll<HTMLElement>('[data-col]')[i]; const box = wrap.current; if (k && box) box.scrollTo({ left: box.scrollLeft + k.getBoundingClientRect().left - box.getBoundingClientRect().left - 12, behavior: 'smooth' }) }

  return (<>
    <nav className="bd-colnav" aria-label="Columns">
      {cols.map((col, i) => <button key={col.id} type="button" className={i === cur ? 'on' : ''} style={{ '--c': col.color } as React.CSSProperties} aria-current={i === cur} onClick={() => jump(i)}><i />{col.name}<em>{model.cardsIn(col.id).length}</em></button>)}
    </nav>
    <div className="bd-cols" ref={wrap} onScroll={onScroll}>
      {cols.map((col, ci) => {
        const all = model.cardsIn(col.id)
        const list = q ? all.filter((c) => (c.title + ' ' + (c.desc ?? '')).toLowerCase().includes(q)) : all
        return (
          <section className="bd-col" key={col.id} data-col={col.id} style={{ '--c': col.color } as React.CSSProperties} aria-label={col.name}>
            <header className="bd-col-head">
              <i className="bd-dot" />
              <input value={col.name} readOnly={readOnly} aria-label="Column name" maxLength={60} onChange={(e) => model.updateCol(col.id, { name: e.target.value })} />
              <span className="bd-count">{all.length}</span>
              {!readOnly && <ColMenu model={model} col={col} index={ci} cols={cols} />}
            </header>
            <div className="bd-cards">
              {list.map((c) => {
                const issues = model.issues(c, fields)
                return (
                  <div key={c.id}>
                    {drag?.over === col.id && drag.before === c.id && <div className="bd-drop" />}
                    <article data-card={c.id} className={`bd-card ${drag?.id === c.id ? 'dragging' : ''}`} tabIndex={0} onPointerDown={(e) => startDrag(e, c)} {...cm.bind(() => cardMenu(c))}
                      onClick={() => { if (!suppressClick.current) onOpen({ id: c.id }) }} onKeyDown={(e) => { if (e.key === 'Enter') onOpen({ id: c.id }) }}>
                      {!readOnly && <span className="bd-grip" aria-hidden><GripVertical size={14} /></span>}
                      <b>{c.title || 'Untitled'}</b>
                      {(visible.some((f) => !isEmpty(c.v?.[f.id])) || issues.length > 0 || forCard(comments, c.id).length > 0) && (
                        <div className="bd-chips">
                          {visible.map((f) => <Chip key={f.id} f={f} v={c.v?.[f.id]} />)}
                          {forCard(comments, c.id).length > 0 && <span className="bd-chip plain" title="Comments"><MessageSquare size={12} />{forCard(comments, c.id).length}</span>}
                          {issues.length > 0 && <span className="bd-chip warn" title={issues.map((i) => `${i.field}: ${i.msg}`).join('\n')}><AlertCircle size={12} />{issues.length === 1 ? issues[0].field : `${issues.length} to fix`}</span>}
                        </div>)}
                    </article>
                  </div>)
              })}
              {drag?.over === col.id && drag.before === null && <div className="bd-drop" />}
              {list.length === 0 && !drag && <p className="bd-empty">{q ? 'No matches' : 'No cards'}</p>}
            </div>
            {!readOnly && <button className="bd-add" onClick={() => onOpen({ col: col.id })}><Plus size={16} />Add card</button>}
          </section>)
      })}
      {!readOnly && <button className="bd-newcol" onClick={() => { const id = model.addCol(); setTimeout(() => document.querySelector<HTMLInputElement>(`[data-col="${id}"] input`)?.select(), 50) }}><Plus size={16} />Add column</button>}
      {drag && <div className="bd-ghost" style={{ left: drag.x + 8, top: drag.y + 8 }}>{drag.title || 'Untitled'}</div>}
      {cm.node}
    </div>
  </>)
}

function ColMenu({ model, col, index, cols }: { model: BoardModel; col: { id: string; name: string; color: string }; index: number; cols: { id: string; name: string }[] }) {
  const remove = async (close: () => void) => {
    close()
    const n = model.cardsIn(col.id).length, other = cols[index === 0 ? 1 : index - 1]
    if (cols.length === 1) { toast('A board needs at least one column'); return }
    if (!(await askConfirm({ title: `Delete “${col.name}”?`, text: n ? `Its ${n} ${n === 1 ? 'card moves' : 'cards move'} to “${other.name}”.` : 'The column is empty.', label: 'Delete', danger: true }))) return
    model.removeCol(col.id, other.id)
  }
  return (
    <Popover align="end" trigger={({ toggle }) => <button className="icon-btn sm" aria-label="Column options" onClick={toggle}><MoreHorizontal size={16} /></button>}>
      {(close) => (
        <div className="menu wide">
          <div className="bd-swatches" role="group" aria-label="Column colour">{COLORS.map((c) => <button key={c} className={`swatch ${col.color === c ? 'on' : ''}`} style={{ background: c }} aria-label={`Colour ${c}`} onClick={() => model.updateCol(col.id, { color: c })} />)}</div>
          <button disabled={index === 0} onClick={() => { close(); model.moveCol(col.id, -1) }}><ArrowLeft size={16} />Move left</button>
          <button disabled={index === cols.length - 1} onClick={() => { close(); model.moveCol(col.id, 1) }}><ArrowRight size={16} />Move right</button>
          <button className="danger" onClick={() => void remove(close)}><Trash2 size={16} />Delete column</button>
        </div>)}
    </Popover>
  )
}

// ---------- a card ----------

function FieldInput({ f, value, onChange, error }: { f: F; value: Value | undefined; onChange: (v: Value | undefined) => void; error: string | null }) {
  const label = <span className="bd-flabel">{f.name}{f.required && <em title="Required">*</em>}</span>
  const err = error && <small className="bd-err" role="alert">{error}</small>
  switch (f.type) {
    case 'checkbox': return <label className="bd-field bd-check"><input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked || undefined)} />{label}{err}</label>
    case 'date': return <div className="bd-field">{label}<DatePicker value={String(value ?? '')} onChange={(v) => onChange(v || undefined)} min={f.min ? String(f.min) : undefined} max={f.max ? String(f.max) : undefined} ariaLabel={f.name} />{err}</div>
    case 'single': return (
      <div className="bd-field">{label}
        <div className="bd-opts" role="radiogroup" aria-label={f.name}>
          {(f.options ?? []).map((o) => <button key={o.id} type="button" role="radio" aria-checked={value === o.id} className={`bd-opt ${value === o.id ? 'on' : ''}`} style={{ '--c': o.color } as React.CSSProperties} onClick={() => onChange(value === o.id ? undefined : o.id)}><i />{o.label}</button>)}
        </div>{err}</div>)
    case 'multi': {
      const cur = Array.isArray(value) ? value : []
      return (
        <div className="bd-field">{label}
          <div className="bd-opts" role="group" aria-label={f.name}>
            {(f.options ?? []).map((o) => { const on = cur.includes(o.id); return <button key={o.id} type="button" aria-pressed={on} className={`bd-opt ${on ? 'on' : ''}`} style={{ '--c': o.color } as React.CSSProperties} onClick={() => onChange(on ? cur.filter((x) => x !== o.id) : [...cur, o.id])}><i />{o.label}</button> })}
          </div>{err}</div>)
    }
    case 'number': return <div className="bd-field">{label}<input type="number" inputMode="decimal" value={value === undefined ? '' : String(value)} min={f.min !== undefined ? Number(f.min) : undefined} max={f.max !== undefined ? Number(f.max) : undefined} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />{err}</div>
    case 'link': return <div className="bd-field">{label}<input type="url" inputMode="url" placeholder="https://" value={String(value ?? '')} onChange={(e) => onChange(e.target.value || undefined)} />{err}</div>
    default: return <div className="bd-field">{label}<input type="text" maxLength={500} value={String(value ?? '')} onChange={(e) => onChange(e.target.value || undefined)} />{err}</div>
  }
}

/** Opens an existing card (every change is saved as you make it) or starts a new one (nothing is saved until the required fields are filled in). */
function CardDialog({ model, fields, cols, target, readOnly, onClose, docId, user, comments, refreshComments }: { docId: string; user: User | null; comments: Comment[]; refreshComments: () => void; model: BoardModel; fields: F[]; cols: { id: string; name: string }[]; target: OpenTarget; readOnly: boolean; onClose: () => void }) {
  const existing = 'id' in target ? model.card(target.id) : null
  const [draft, setDraft] = useState<{ title: string; desc: string; v: Record<string, Value>; col: string }>(() => ({ title: '', desc: '', v: 'col' in target ? { ...(target.v ?? {}) } : {}, col: 'col' in target ? target.col : '' }))
  const [tried, setTried] = useState(false)
  const [, bump] = useState(0)
  useEffect(() => model.subscribe(() => bump((n) => n + 1)), [model])
  useEffect(() => { if ('id' in target && !existing) onClose() }, [existing, target, onClose])
  if ('id' in target && !existing) return null

  const v = existing ? existing.v ?? {} : draft.v
  const errs = Object.fromEntries(fields.map((f) => [f.id, problem(f, v[f.id])]))
  const bad = fields.filter((f) => errs[f.id])
  const titleBad = !(existing ? existing.title : draft.title).trim()
  const set = (f: F, val: Value | undefined) => { if (existing) model.setValue(existing.id, f.id, val); else setDraft((d) => { const nv = { ...d.v }; if (val === undefined || isEmpty(val)) delete nv[f.id]; else nv[f.id] = val; return { ...d, v: nv } }) }
  const create = () => {
    setTried(true)
    if (titleBad || bad.length) return
    model.addCard(draft.col, draft.title.trim(), draft.v, draft.desc.trim() || undefined); onClose()
  }
  const colId = existing ? existing.col : draft.col
  const remove = async () => {
    if (!existing || !(await askConfirm({ title: 'Delete this card?', text: 'It is removed from the board for everyone, with its comments.', label: 'Delete', danger: true }))) return
    const gone = forCard(comments, existing.id)
    model.removeCard(existing.id); onClose()
    await Promise.all(gone.map((c) => api.deleteComment(docId, c.id).catch(() => undefined))); if (gone.length) refreshComments()   // comments you can't delete (someone else's) stay hidden: the card is gone
  }

  return (
    <Modal title={existing ? 'Card' : 'New card'} onClose={onClose} width={existing ? 1040 : 620}>
      <div className={`bd-dialog ${existing ? 'two' : ''}`}>
        <div className="bd-main">
        <input className="bd-title-in" autoFocus={!existing} placeholder="Card title" maxLength={300} readOnly={readOnly} value={existing ? existing.title : draft.title}
          onChange={(e) => existing ? model.updateCard(existing.id, { title: e.target.value }) : setDraft({ ...draft, title: e.target.value })} aria-label="Card title" />
        {tried && titleBad && <small className="bd-err" role="alert">Give the card a title</small>}
        <div className="bd-field"><span className="bd-flabel">Column</span>
          <div className="bd-opts" role="radiogroup" aria-label="Column">
            {cols.map((c) => <button key={c.id} type="button" role="radio" aria-checked={colId === c.id} disabled={readOnly} className={`bd-opt ${colId === c.id ? 'on' : ''}`} onClick={() => existing ? model.moveCard(existing.id, c.id, null) : setDraft({ ...draft, col: c.id })}>{c.name}</button>)}
          </div>
        </div>
        {fields.map((f) => <FieldInput key={f.id} f={f} value={v[f.id]} error={existing || tried ? errs[f.id] : f.required && isEmpty(v[f.id]) ? null : errs[f.id]} onChange={(val) => !readOnly && set(f, val)} />)}
        <label className="bd-field"><span className="bd-flabel">Description</span>
          <textarea rows={5} maxLength={20000} readOnly={readOnly} placeholder="Add more detail…" value={existing ? existing.desc ?? '' : draft.desc}
            onChange={(e) => existing ? model.updateCard(existing.id, { desc: e.target.value || undefined }) : setDraft({ ...draft, desc: e.target.value })} /></label>
        <div className="modal-actions">
          {existing && !readOnly ? <button className="btn btn-pill btn-ghost danger" onClick={() => void remove()}><Trash2 size={16} />Delete</button> : <span />}
          {existing ? <button className="btn btn-pill btn-primary" onClick={onClose}>Done</button>
            : <button className="btn btn-pill btn-primary" onClick={create}>Add card</button>}
        </div>
        {tried && (titleBad || bad.length > 0) && <p className="bd-err" role="alert">Fill in {[titleBad && 'the title', ...bad.map((f) => f.name)].filter(Boolean).join(', ')} first.</p>}
        </div>
        {existing && <aside className="bd-side"><CardComments docId={docId} cardId={existing.id} user={user} list={comments} refresh={refreshComments} /></aside>}
      </div>
    </Modal>
  )
}

// ---------- the field manager ----------

function FieldsPage({ model, fields }: { model: BoardModel; fields: F[] }) {
  const [sel, setSel] = useState<string | null>(null)
  return (
    <div className="bd-fields">
      <p className="bd-lead">Fields are the extra details every card can carry. Mark one <b>required</b> and a card can't be added until it is filled in; cards that miss it show a warning.</p>
      {fields.map((f, i) => {
        const I = ICON[f.type]
        return (
          <div className={`fm-card bd-fcard ${sel === f.id ? 'open' : ''}`} key={f.id}>
            <div className="bd-fhead" onClick={() => setSel(sel === f.id ? null : f.id)}>
              <I size={17} /><input value={f.name} maxLength={60} aria-label="Field name" onClick={(e) => e.stopPropagation()} onChange={(e) => model.updateField(f.id, { name: e.target.value })} />
              <span className="bd-ftype">{TYPE_LABEL[f.type]}{f.required ? ' · required' : ''}</span>
              <button className="icon-btn sm" aria-label="Move up" disabled={i === 0} onClick={(e) => { e.stopPropagation(); model.moveField(f.id, -1) }}><ChevronUp size={16} /></button>
              <button className="icon-btn sm" aria-label="Move down" disabled={i === fields.length - 1} onClick={(e) => { e.stopPropagation(); model.moveField(f.id, 1) }}><ChevronDown size={16} /></button>
            </div>
            {sel === f.id && <FieldSettings model={model} f={f} onRemove={async () => { if (await askConfirm({ title: `Delete “${f.name}”?`, text: 'Its values are removed from every card.', label: 'Delete', danger: true })) { model.removeField(f.id); setSel(null) } }} />}
          </div>)
      })}
      <div className="fm-card bd-addfield">
        <b>Add a field</b>
        <div className="bd-opts">{FIELD_TYPES.map((t) => { const I = ICON[t]; return <button key={t} className="bd-opt" onClick={() => setSel(model.addField(t))}><I size={14} />{TYPE_LABEL[t]}</button> })}</div>
      </div>
    </div>
  )
}

function FieldSettings({ model, f, onRemove }: { model: BoardModel; f: F; onRemove: () => void }) {
  const opts = f.options ?? []
  const setOpts = (o: typeof opts) => model.updateField(f.id, { options: o })
  return (
    <div className="bd-fbody">
      <label className="fm-switch-row"><div><b>Required</b><span>A card can't be added without it.{f.type === 'checkbox' ? ' For a checkbox this means it must be ticked.' : ''}</span></div>
        <button type="button" role="switch" aria-checked={!!f.required} aria-label="Required" className={`toggle ${f.required ? 'on' : ''}`} onClick={() => model.updateField(f.id, { required: !f.required })} /></label>
      <label className="fm-switch-row"><div><b>Show on the card</b><span>Display the value on the card in the column, not only inside it.</span></div>
        <button type="button" role="switch" aria-checked={!f.hidden} aria-label="Show on the card" className={`toggle ${!f.hidden ? 'on' : ''}`} onClick={() => model.updateField(f.id, { hidden: !f.hidden })} /></label>
      {f.type === 'number' && (
        <div className="bd-range"><label>Minimum<input type="number" value={f.min ?? ''} onChange={(e) => model.updateField(f.id, { min: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
          <label>Maximum<input type="number" value={f.max ?? ''} onChange={(e) => model.updateField(f.id, { max: e.target.value === '' ? undefined : Number(e.target.value) })} /></label></div>)}
      {f.type === 'text' && (<>
        <div className="bd-range"><label>Fewest characters<input type="number" min={0} value={f.min ?? ''} onChange={(e) => model.updateField(f.id, { min: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })} /></label>
          <label>Most characters<input type="number" min={0} value={f.max ?? ''} onChange={(e) => model.updateField(f.id, { max: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })} /></label></div>
        <label className="bd-stack">Must look like
          <Select label="Format" value={(f.format ?? '') as TextFormat | ''} options={[{ value: '', label: 'Anything' }, ...FORMATS.map((x) => ({ value: x.id, label: x.label }))]} onChange={(v) => model.updateField(f.id, { format: (v || undefined) as TextFormat | undefined })} /></label>
        {f.format === 'custom' && <label className="bd-stack">Pattern (regular expression)
          <input value={f.pattern ?? ''} placeholder="^[A-Z]{3}-\d{4}$" spellCheck={false} aria-invalid={!!f.pattern && !customRegex(f.pattern)} onChange={(e) => model.updateField(f.id, { pattern: e.target.value || undefined })} />
          {f.pattern && !customRegex(f.pattern) && <span className="bd-bad">Not a valid pattern, so it is ignored.</span>}</label>}
        {f.format && <label className="bd-stack">Message when it doesn't match (optional)
          <input value={f.message ?? ''} maxLength={120} placeholder={FORMATS.find((x) => x.id === f.format)?.hint} onChange={(e) => model.updateField(f.id, { message: e.target.value || undefined })} /></label>}
      </>)}
      {f.type === 'date' && (
        <div className="bd-range"><label>Not before<DatePicker value={String(f.min ?? '')} onChange={(v) => model.updateField(f.id, { min: v || undefined })} ariaLabel="Not before" /></label>
          <label>Not after<DatePicker value={String(f.max ?? '')} onChange={(v) => model.updateField(f.id, { max: v || undefined })} ariaLabel="Not after" /></label>
          <button className="btn btn-pill btn-ghost" onClick={() => model.updateField(f.id, { min: today() })}>No past dates</button></div>)}
      {(f.type === 'single' || f.type === 'multi') && (
        <div className="bd-optlist">
          <b>Options</b>
          {opts.map((o, i) => (
            <div className="bd-optrow" key={o.id}>
              <Popover trigger={({ toggle }) => <button className="swatch" style={{ background: o.color }} aria-label="Option colour" onClick={toggle} />}>
                {(close) => <div className="bd-swatches">{COLORS.map((c) => <button key={c} className={`swatch ${o.color === c ? 'on' : ''}`} style={{ background: c }} aria-label={`Colour ${c}`} onClick={() => { close(); setOpts(opts.map((x) => x.id === o.id ? { ...x, color: c } : x)) }} />)}</div>}
              </Popover>
              <input value={o.label} maxLength={60} aria-label="Option" onChange={(e) => setOpts(opts.map((x) => x.id === o.id ? { ...x, label: e.target.value } : x))} />
              <button className="icon-btn sm" aria-label="Move up" disabled={i === 0} onClick={() => { const n = [...opts]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; setOpts(n) }}><ChevronUp size={15} /></button>
              <button className="icon-btn sm" aria-label="Remove option" disabled={opts.length <= 1} onClick={() => setOpts(opts.filter((x) => x.id !== o.id))}><X size={15} /></button>
            </div>))}
          <button className="btn btn-pill btn-ghost" onClick={() => setOpts([...opts, { id: uid(), label: `Option ${opts.length + 1}`, color: COLORS[opts.length % COLORS.length] }])}><Plus size={15} />Add option</button>
        </div>)}
      <div className="modal-actions"><button className="btn btn-pill btn-ghost danger" onClick={onRemove}><Trash2 size={16} />Delete field</button><span /></div>
    </div>
  )
}

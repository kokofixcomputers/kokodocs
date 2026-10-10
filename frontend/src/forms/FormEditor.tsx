import { SavePill } from '../ui/SavePill'
import { useZoom, Zoomed } from '../ui/zoom'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EncryptionBadge } from '../zk/EncryptionBadge'
import { openSettings } from '../ui/settingsStore'
import { Link } from 'react-router-dom'
import * as Y from 'yjs'
import {
  GitBranch, AlignLeft, AtSign, Calendar, ChevronDown, ChevronUp, CircleDot, Clipboard, Clock, Cloud, CloudOff, Copy, Eye, FileText, GripVertical, Hash, Inbox,
  Image as ImageIcon, Palette, Paperclip, Info, Upload, Video, Link2, ListChecks, LogIn, Moon, Plus, Redo2, Settings2, Share2, SlidersHorizontal, SquareCheck, Sun, Trash2, Type, Undo2, X, Rows3, ClipboardList, ChevronsUpDown, Sparkles,
} from 'lucide-react'
import { api, type ApiError, type DocInfo } from '../api'
import { useAuth } from '../auth'
import { KokoProvider } from '../collab'
import { ShareDialog } from '../editor/ShareDialog'
import { ColorPicker } from '../editor/ColorPicker'
import { useTheme } from '../theme'
import { Avatar } from '../ui/Avatar'
import { Logo } from '../ui/Logo'
import { DatePicker } from '../ui/DatePicker'
import { Popover } from '../ui/Popover'
import { Select } from '../ui/Select'
import { toast } from '../ui/Toast'
import { Fill } from './Fill'
import { MediaView } from './MediaView'
import { safeUrl, videoSource } from './media'
import { ANSWERABLE, type Cond, FormModel, hasOptions, TYPE_LABEL, type FormItem, type ItemType, type PublicForm } from './model'
import { OPS } from './flow'
import { Responses } from './Responses'
import { patternProblem } from './validate'
import './forms.css'
const AssistantHost = lazy(() => import('../assistant/AssistantHost'))

const ANIMALS = ['Otter', 'Fox', 'Koala', 'Panda', 'Heron', 'Lynx', 'Gecko', 'Falcon', 'Narwhal', 'Quokka']
const COLORS = ['#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#8b5cf6', '#ef4444', '#0ea5e9', '#22c55e', '#f97316', '#d946ef']
function guestIdentity() {
  try { const s = sessionStorage.getItem('koko.guest'); if (s) return JSON.parse(s) as { name: string; color: string } } catch { /* ignore */ }
  const g = { name: `Guest ${ANIMALS[Math.floor(Math.random() * ANIMALS.length)]}`, color: COLORS[Math.floor(Math.random() * COLORS.length)] }
  try { sessionStorage.setItem('koko.guest', JSON.stringify(g)) } catch { /* ignore */ }
  return g
}

export const TYPE_ICON: Record<ItemType, typeof Type> = {
  color: Palette, file: Paperclip, short: Type, long: AlignLeft, number: Hash, email: AtSign, url: Link2, date: Calendar, time: Clock, radio: CircleDot, checkbox: SquareCheck,
  select: ChevronsUpDown, scale: SlidersHorizontal, section: Rows3, info: Info, media: ImageIcon, page: FileText,
}
const PALETTE: ItemType[] = ['short', 'long', 'radio', 'checkbox', 'select', 'number', 'email', 'url', 'date', 'time', 'scale', 'section', 'info', 'media', 'page']
const TOOL_GROUPS: ItemType[][] = [['short', 'long', 'number', 'email', 'url', 'file'], ['radio', 'checkbox', 'select', 'scale'], ['date', 'time', 'color'], ['section', 'info', 'media', 'page']]
const TYPE_TIP: Record<ItemType, string> = {
  color: 'Let people pick a colour, from presets or any custom colour. The answer is its hex code',
  file: 'Let people attach a file, up to 3 MB. It counts toward your storage',
  short: 'A one-line text answer', long: 'A multi-line text answer', number: 'Only numbers, with an optional min and max', email: 'Checks the answer is an email address',
  url: 'Checks the answer is a web link', radio: 'Pick exactly one option, as round buttons', checkbox: 'Pick as many options as apply, as checkboxes', select: 'Pick one option from a dropdown',
  scale: 'Rate on a scale like 1 to 5', date: 'Pick a calendar date', time: 'Pick a time of day', section: 'Add a heading between questions', media: 'Show a picture or a video. Use an upload or a link, nothing is hosted for videos',
  info: 'Show a block of text, such as instructions or a note. Nothing to answer',
  page: 'Start a new page, so long forms are split into steps',
}
const TYPE_OPTIONS = PALETTE.filter((t) => t !== 'page').map((t) => ({ value: t, label: TYPE_LABEL[t] }))

function useModelVersion(m: FormModel) { const [v, setV] = useState(0); useEffect(() => m.subscribe(() => setV(m.version)), [m]); return v }
function useStatus(p: KokoProvider) { const [, f] = useState(0); useEffect(() => p.subscribe(() => f((n) => n + 1)), [p]); return { status: p.status, synced: p.synced } }

export default function FormEditor({ info }: { info: DocInfo }) {
  const { user } = useAuth()
  const identity = useMemo(() => (user ? { name: user.name, color: user.color } : guestIdentity()), [user])
  const ydoc = useMemo(() => new Y.Doc(), [])
  const model = useMemo(() => new FormModel(ydoc), [ydoc])
  const [provider, setProvider] = useState<KokoProvider | null>(null)
  useEffect(() => {
    const p = new KokoProvider(info.id, ydoc, false)
    p.awareness.setLocalStateField('user', identity)
    setProvider(p)
    return () => { p.destroy(); setProvider(null) }
  }, [info.id, ydoc, identity])
  useEffect(() => () => model.destroy(), [model])
  if (!provider) return <div className="splash"><span className="spinner" /></div>
  return <Inner info={info} model={model} provider={provider} />
}

function Inner({ info, model, provider }: { info: DocInfo; model: FormModel; provider: KokoProvider }) {
  const uz = useZoom('form')
  const { user, logout } = useAuth()
  const { theme: uiTheme, toggle: toggleTheme } = useTheme()
  const version = useModelVersion(model)
  const { status, synced } = useStatus(provider)
  const [title, setTitle] = useState(info.title)
  const [tab, setTab] = useState<'questions' | 'preview' | 'responses' | 'settings'>('questions')
  const [sel, setSel] = useState<string | null>(null)
  const [share, setShare] = useState(false)
  const [assistant, setAssistant] = useState(false)
  const [count, setCount] = useState<number | null>(null)
  const [people, setPeople] = useState<{ id: number; name: string; color: string }[]>([])

  void version
  const items = model.read()
  const description = model.getMeta('description', '')
  const form: PublicForm = {
    title, description, accent: model.getMeta('accent', ''), accepting: model.getMeta('accepting', true), requireLogin: model.getMeta('requireLogin', false),
    oneResponse: model.getMeta('oneResponse', false), confirmation: model.getMeta('confirmation', ''), items,
  }

  useEffect(() => { if (synced) model.ensure() }, [synced, model])
  useEffect(() => { if (sel && !items.some((i) => i.id === sel)) setSel(null) }, [items, sel])

  const ymeta = model.meta
  useEffect(() => { const f = () => { const t = ymeta.get('title'); if (typeof t === 'string') setTitle(t) }; ymeta.observe(f); f(); return () => ymeta.unobserve(f) }, [ymeta])
  const titleTimer = useRef<number | undefined>(undefined)
  const onTitle = (v: string) => {
    setTitle(v); model.setMeta('title', v)
    window.clearTimeout(titleTimer.current)
    titleTimer.current = window.setTimeout(() => api.renameDoc(info.id, v).catch((e: ApiError) => toast(e.message)), 600)
  }
  useEffect(() => { document.title = `${title || 'Untitled form'} - KokoDocs` }, [title])

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
    const changed = () => { toast('Your access to this form changed'); setTimeout(() => location.reload(), 900) }
    window.addEventListener('koko:access-changed', changed)
    return () => window.removeEventListener('koko:access-changed', changed)
  }, [])
  useEffect(() => {
    const k = (ev: KeyboardEvent) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z' && !(ev.target as HTMLElement)?.closest('input, textarea')) { ev.preventDefault(); ev.shiftKey ? model.undo.redo() : model.undo.undo() }
    }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [model])

  const addItem = (t: ItemType) => { const id = model.add(t, sel ?? items[items.length - 1]?.id ?? null); setSel(id); setTimeout(() => document.getElementById(`fi-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50) }
  const onCount = useCallback((n: number) => setCount(n), [])
  const link = `${location.origin}/d/${info.id}`
  const copyLink = () => navigator.clipboard.writeText(link).then(() => toast('Form link copied'), () => toast(link))
  const TABS = [
    { id: 'questions', label: 'Questions', icon: ClipboardList }, { id: 'preview', label: 'Preview', icon: Eye },
    { id: 'responses', label: count === null ? 'Responses' : `Responses (${count})`, icon: Inbox }, { id: 'settings', label: 'Settings', icon: Settings2 },
  ] as const

  return (
    <div className={`editor-shell form-shell ${assistant ? 'ai-open' : ''}`}>
      <header className="ed-top">
        <div className="ed-left">
          {user ? <Link to="/" className="logo-link" title="All documents"><Logo size={32} /></Link> : <span className="logo-link"><Logo size={32} /></span>}
          <input className="title-input" value={title} onChange={(e) => onTitle(e.target.value)} placeholder="Untitled form" aria-label="Form title" maxLength={200} />
          <SavePill provider={provider} status={status} readOnly={false} />
          <EncryptionBadge info={info} />
          {!form.accepting && <span className="fm-closed-chip">Closed</span>}
        </div>
        <div className="ed-right">
          <div className="presence">{people.slice(0, 5).map((p) => <Avatar key={p.id} name={p.name} color={p.color} size={32} ring />)}{people.length > 5 && <span className="more" data-tip={people.slice(5).map((x) => x.name).join(', ')}>+{people.length - 5}</span>}</div>
          <button className="icon-btn" title="Undo" aria-label="Undo" onClick={() => model.undo.undo()}><Undo2 size={18} /></button>
          <button className="icon-btn" title="Redo" aria-label="Redo" onClick={() => model.undo.redo()}><Redo2 size={18} /></button>
          <button className="icon-btn" title="Copy form link" aria-label="Copy form link" onClick={copyLink}><Copy size={18} /></button>
          <button className="icon-btn" onClick={toggleTheme} aria-label="Toggle theme">{uiTheme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
          {user && <button className={`btn btn-pill btn-soft ${assistant ? 'active' : ''}`} aria-pressed={assistant} onClick={() => setAssistant((v) => !v)}><Sparkles size={16} /><span className="lbl">Assistant</span></button>}
          <button className="btn btn-pill btn-primary" onClick={() => setShare(true)}><Share2 size={16} /><span className="lbl">Share</span></button>
          {user ? (
            <Popover align="end" trigger={({ toggle }) => <button className="avatar-btn" onClick={toggle}><Avatar name={user.name} color={user.color} size={34} /></button>}>
              {(close) => (<div className="menu wide"><div className="menu-head"><strong>{user.name}</strong><span>{user.email}</span></div><Link to="/" className="menu-link" onClick={close}>All documents</Link><button onClick={() => { close(); openSettings() }}>Settings</button><button onClick={() => { close(); logout() }}>Sign out</button></div>)}
            </Popover>
          ) : <Link className="btn btn-pill btn-ghost" to="/login" state={{ from: `/d/${info.id}` }}><LogIn size={16} />Sign in</Link>}
        </div>
      </header>
      <nav className="fm-tabs" role="tablist" aria-label="Form sections">
        {TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}><t.icon size={16} />{t.label}</button>)}
      </nav>

      {tab === 'questions' && (
        <div className="ed-toolbar-wrap">
          <div className="toolbar fm-toolbar" role="toolbar" aria-label="Add to form">
            {TOOL_GROUPS.map((g) => (
              <div className="tb-group" key={g[0]}>
                {g.map((t) => { const I = TYPE_ICON[t]; return (
                  <button key={t} className="tb-btn" aria-label={`Add ${TYPE_LABEL[t].toLowerCase()}`} data-tip={`Add ${TYPE_LABEL[t].toLowerCase()}|${TYPE_TIP[t]}`} onClick={() => addItem(t)}><I size={18} /></button>) })}
              </div>
            ))}
          </div>
        </div>
      )}

      <Zoomed zoom={uz} fitLabel="Fit the whole form">
      <div className="fm-body">
        {tab === 'questions' && (
          <div className="fm-col">
            <div className="fm-card fm-head-edit">
              <div className="fm-bar-accent" />
              <input className="fm-title-in" value={title} onChange={(e) => onTitle(e.target.value)} placeholder="Form title" maxLength={200} aria-label="Form title" />
              <textarea className="fm-desc-in" rows={2} value={description} placeholder="Form description (optional)" maxLength={2000} onChange={(e) => model.setMeta('description', e.target.value)} />
            </div>
            {items.map((it, i) => (
              <ItemCard key={it.id} docId={info.id} items={items} it={it} index={i} total={items.length} model={model} selected={sel === it.id} onSelect={() => setSel(it.id)} onAdd={addItem} pageNo={it.type === 'page' ? items.slice(0, i).filter((x) => x.type === 'page').length + 2 : 0} />
            ))}
          </div>
        )}
        {tab === 'preview' && (
          <div className="fm-col fm-previewing">
            <div className="fm-preview-note"><Eye size={15} />Preview. Answers here are not saved.</div>
            <Fill form={form} signedIn={!!user} signInTo={`/d/${info.id}`} preview onSubmit={async () => ({ ok: true })} />
          </div>
        )}
        {tab === 'responses' && <div className="fm-col wide"><Responses docId={info.id} title={title} onCount={onCount} /></div>}
        {tab === 'settings' && (
          <div className="fm-col">
            <div className="fm-card fm-settings">
              <h3>Responses</h3>
              <Switch label="Accepting responses" sub="Turn off to close the form. People who open it will see that it's closed." on={form.accepting} onChange={(v) => model.setMeta('accepting', v)} />
              <Switch label="Require sign-in" sub="Anonymous visitors must sign in, and you'll see who responded." on={form.requireLogin || form.oneResponse} disabled={form.oneResponse} onChange={(v) => model.setMeta('requireLogin', v)} />
              <Switch label="Limit to one response per person" sub="Needs sign-in. People can't submit twice." on={form.oneResponse} onChange={(v) => { model.setMeta('oneResponse', v); if (v) model.setMeta('requireLogin', true) }} />
              <label className="fm-field"><span>Confirmation message</span>
                <textarea rows={3} maxLength={1000} placeholder="Your response has been recorded. Thank you!" value={form.confirmation} onChange={(e) => model.setMeta('confirmation', e.target.value)} /></label>
            </div>
            <div className="fm-card fm-settings">
              <h3>Appearance</h3>
              <div className="fm-switch-row"><div><b>Accent colour</b><span>Colours the form's header bar, buttons, progress bar and selected answers for everyone who fills it out.</span></div>
                <span className="fm-accent-ctl">
                  <Popover align="end" trigger={({ toggle }) => <button type="button" className="fm-accent-btn" onClick={toggle} aria-label="Accent colour"><i className="fm-sw big" style={form.accent ? { background: form.accent } : undefined} /><span>{form.accent ? form.accent.toUpperCase() : 'Default'}</span></button>}>
                    {(close) => <ColorPicker value={form.accent || null} noneLabel="Default (black and white)" onPick={(c) => { close(); model.setMeta('accent', c ?? '') }} />}
                  </Popover>
                </span></div>
            </div>
            <div className="fm-card fm-settings">
              <h3>Who can fill this out</h3>
              <p className="muted">Everyone with view access fills the form out: people you add in Share, and anyone with the link if you turn that on. Only people you give <b>edit</b> or <b>manage</b> access can change the questions and see responses, and only the owner and people with <b>manage</b> access can change who has access. Links can never grant edit access on a form.</p>
              <div className="fm-linkrow"><code>{link}</code><button className="btn btn-pill btn-soft btn-sm" onClick={copyLink}><Clipboard size={14} />Copy</button></div>
              <button className="btn btn-pill btn-primary" onClick={() => setShare(true)}><Share2 size={16} />Share settings</button>
            </div>
          </div>
        )}
      </div>
      </Zoomed>
      {share && <ShareDialog info={info} onClose={() => setShare(false)} />}
      {user && assistant && <aside className="ai-drawer" aria-label="Assistant"><Suspense fallback={null}><AssistantHost docId={info.id} user={user} onClose={() => setAssistant(false)} source={{ kind: 'form', deps: { model, docId: info.id, getTitle: () => title, setTitle: onTitle, canEdit: () => true } }} /></Suspense></aside>}
    </div>
  )
}

function Switch({ label, sub, on, onChange, disabled }: { label: string; sub: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="fm-switch-row"><div><b>{label}</b><span>{sub}</span></div>
      <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={`fm-switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)}><i /></button></div>
  )
}

function ItemCard({ it, index, total, model, selected, onSelect, onAdd, pageNo, docId, items }: {
  docId: string; items: FormItem[]; it: FormItem; index: number; total: number; model: FormModel; selected: boolean; onSelect: () => void; onAdd: (t: ItemType) => void; pageNo: number
}) {
  const [over, setOver] = useState(false)
  const I = TYPE_ICON[it.type]
  const upd = (p: Partial<FormItem>) => model.update(it.id, p)
  const isQ = it.type !== 'section' && it.type !== 'page' && it.type !== 'info' && it.type !== 'media'
  return (
    <div id={`fi-${it.id}`} className={`fm-card fm-item ${selected ? 'sel' : ''} ${over ? 'over' : ''} t-${it.type}`} onClick={onSelect}
      draggable={false}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('text/koko-form-item')) { e.preventDefault(); setOver(true) } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { setOver(false); const id = e.dataTransfer.getData('text/koko-form-item'); if (id) { e.preventDefault(); model.moveTo(id, it.id) } }}>
      <span className="fm-grip" draggable title="Drag to reorder" aria-label="Drag to reorder"
        onDragStart={(e) => { e.dataTransfer.setData('text/koko-form-item', it.id); e.dataTransfer.effectAllowed = 'move' }}><GripVertical size={18} /></span>
      {it.type === 'page' && <div className="fm-page-tag">Page {pageNo}</div>}
      {selected ? (
        <div className="fm-edit">
          <div className="fm-edit-top">
            {it.type === 'media' ? <input className="fm-q-in" value={it.title} onChange={(e) => upd({ title: e.target.value })} placeholder="Caption (optional)" maxLength={300} aria-label="Caption" autoFocus /> : it.type === 'info' ? <textarea className="fm-q-in fm-info-in" rows={3} value={it.title} onChange={(e) => upd({ title: e.target.value })} placeholder="Write the text people will read" maxLength={5000} aria-label="Info text" autoFocus /> :
            <input className="fm-q-in" value={it.title} onChange={(e) => upd({ title: e.target.value })} placeholder={it.type === 'page' ? 'Page title' : it.type === 'section' ? 'Section title' : 'Question'} maxLength={500} aria-label="Question title" autoFocus />}
            {isQ ? <Select label="Question type" className="fm-type-sel" value={it.type} options={TYPE_OPTIONS} onChange={(t) => model.retype(it.id, t)} /> : <span className="fm-type-fixed"><I size={15} />{TYPE_LABEL[it.type]}</span>}
          </div>
          {it.type === 'media' && <MediaEditor it={it} upd={upd} docId={docId} />}
          {it.type !== 'info' && it.type !== 'media' && <input className="fm-help-in" value={it.help ?? ''} onChange={(e) => upd({ help: e.target.value })} placeholder={it.type === 'page' || it.type === 'section' ? 'Description (optional)' : 'Help text (optional)'} maxLength={1000} aria-label="Help text" />}
          {hasOptions(it.type) && <OptionsEditor it={it} upd={upd} pages={laterPages(items, index)} />}
          {isQ && <Rules it={it} upd={upd} />}
          <Logic it={it} upd={upd} before={items.slice(0, index).filter((x) => ANSWERABLE.includes(x.type))} />
          <div className="fm-edit-foot">
            {isQ && <button type="button" role="switch" aria-checked={!!it.required} className="fm-req" onClick={() => upd({ required: !it.required })}><span className={`fm-switch sm ${it.required ? 'on' : ''}`}><i /></span>Required</button>}
            <span className="fm-spacer" />
            <button className="icon-btn" title="Move up" aria-label="Move up" disabled={index === 0} onClick={(e) => { e.stopPropagation(); model.move(it.id, -1) }}><ChevronUp size={18} /></button>
            <button className="icon-btn" title="Move down" aria-label="Move down" disabled={index === total - 1} onClick={(e) => { e.stopPropagation(); model.move(it.id, 1) }}><ChevronDown size={18} /></button>
            <button className="icon-btn" title="Duplicate" aria-label="Duplicate" onClick={(e) => { e.stopPropagation(); model.duplicate(it.id) }}><Copy size={17} /></button>
            <button className="icon-btn danger" title="Delete" aria-label="Delete" onClick={(e) => { e.stopPropagation(); model.remove(it.id) }}><Trash2 size={17} /></button>
            <Popover align="end" trigger={({ toggle }) => <button className="icon-btn" title="Add below" aria-label="Add below" onClick={(e) => { e.stopPropagation(); toggle() }}><Plus size={19} /></button>}>
              {(close) => <div className="menu wide fm-addmenu">{PALETTE.map((t) => { const T = TYPE_ICON[t]; return <button key={t} onClick={() => { close(); onAdd(t) }}><T size={16} />{TYPE_LABEL[t]}</button> })}</div>}
            </Popover>
          </div>
        </div>
      ) : (
        <div className="fm-view">
          <div className="fm-view-title"><I size={16} /><b className={it.type === 'info' ? 'fm-info-prev' : ''}>{it.title || (it.type === 'page' ? 'Untitled page' : 'Untitled question')}</b>{it.required && <span className="fm-star">*</span>}</div>
          {it.help && <p className="fm-q-help">{it.help}</p>}
          {it.type === 'media' && it.src && <div className="fm-media-thumb"><MediaView it={{ ...it, size: 'small' }} /></div>}
          <p className="fm-summary muted">{summary(it)}{it.showIf?.rules?.length ? ' · conditional' : ''}{it.jumps && Object.keys(it.jumps).length ? ' · page logic' : ''}</p>
        </div>
      )}
    </div>
  )
}

function summary(it: FormItem): string {
  const t = TYPE_LABEL[it.type]
  if (it.type === 'media') return it.src ? `${it.media === 'video' ? 'Video' : 'Image'} · ${it.size ?? 'medium'}` : `${it.media === 'video' ? 'Video' : 'Image'} · add a link${it.media === 'video' ? '' : ' or upload'}`
  if (hasOptions(it.type)) return `${t} · ${it.options?.length ?? 0} options${it.other ? ' + Other' : ''}`
  if (it.type === 'scale') return `${t} · ${it.scaleMin ?? 1} to ${it.scaleMax ?? 5}`
  const rules: string[] = []
  if (it.minLen) rules.push(`min ${it.minLen} chars`); if (it.maxLen) rules.push(`max ${it.maxLen} chars`); if (it.pattern) rules.push('pattern')
  if (it.min !== undefined && it.min !== '') rules.push(`min ${it.min}`); if (it.max !== undefined && it.max !== '') rules.push(`max ${it.max}`)
  if (it.integer) rules.push('whole numbers')
  return rules.length ? `${t} · ${rules.join(', ')}` : t
}

function MediaEditor({ it, upd, docId }: { it: FormItem; upd: (p: Partial<FormItem>) => void; docId: string }) {
  const isVideo = it.media === 'video'
  const file = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const bad = !!it.src && (isVideo ? !videoSource(it.src) : !safeUrl(it.src))
  const upload = async (f: File | undefined) => {
    if (!f) return
    setBusy(true)
    try { upd({ src: await api.uploadImage(docId, f) }) } catch (e) { toast((e as Error).message || 'Upload failed') } finally { setBusy(false); if (file.current) file.current.value = '' }
  }
  return (
    <div className="fm-media-edit">
      <div className="fm-rule-row">
        <span className="seg mini" role="group" aria-label="Media type">
          <button className={!isVideo ? 'on' : ''} onClick={() => upd({ media: 'image', src: '' })}><ImageIcon size={15} />Image</button>
          <button className={isVideo ? 'on' : ''} onClick={() => upd({ media: 'video', src: '' })}><Video size={15} />Video</button>
        </span>
        <div className="fm-mini"><span>Size</span><Select label="Size" value={it.size ?? 'medium'} options={[{ value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'full', label: 'Full width' }]} onChange={(v) => upd({ size: v })} /></div>
      </div>
      <div className="fm-rule-row">
        <label className="fm-mini wide"><span>{isVideo ? 'Video link' : 'Image link'}</span>
          <input className={bad ? 'dup' : ''} value={it.src ?? ''} maxLength={2000} spellCheck={false} placeholder={isVideo ? 'https://www.youtube.com/watch?v=…' : 'https://example.com/picture.png'} onChange={(e) => upd({ src: e.target.value.trim() })} /></label>
        {!isVideo && (
          <>
            <input ref={file} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => upload(e.target.files?.[0])} />
            <button className="btn btn-pill btn-soft" disabled={busy} onClick={() => file.current?.click()}>{busy ? <span className="spinner sm" /> : <><Upload size={16} />Upload</>}</button>
          </>
        )}
      </div>
      <p className={`fm-hint ${bad ? 'bad' : ''}`}>{bad ? (isVideo ? 'That link can’t be embedded. Use a YouTube or Vimeo link, or a direct .mp4 / .webm file.' : 'Use a link that starts with https://') : isVideo ? 'YouTube, Vimeo, or a direct .mp4 / .webm link. Videos are never uploaded or hosted here.' : 'Paste an image link, or upload a PNG, JPEG, GIF or WebP.'}</p>
      {it.src && !bad && <div className="fm-media-thumb"><MediaView it={it} /></div>}
    </div>
  )
}

const laterPages = (items: FormItem[], index: number) => {
  let n = 1
  return items.map((x, i) => { if (x.type === 'page') n++; return { x, i, n } }).filter((p) => p.x.type === 'page' && p.i > index).map((p) => ({ id: p.x.id, label: `Page ${p.n}${p.x.title ? `: ${p.x.title}` : ''}` }))
}

function OptionsEditor({ it, upd, pages }: { it: FormItem; upd: (p: Partial<FormItem>) => void; pages: { id: string; label: string }[] }) {
  const opts = it.options ?? []
  const jumps = it.jumps ?? {}
  const canJump = (it.type === 'radio' || it.type === 'select') && pages.length > 0
  const set = (o: string[], j: Record<string, string> = jumps) => upd({ options: o, jumps: Object.keys(j).length ? j : undefined })
  const dup = (o: string, i: number) => opts.findIndex((x) => x === o) !== i
  const rename = (i: number, v: string) => {
    const j = { ...jumps }
    if (jumps[opts[i]] !== undefined && !opts.includes(v)) { j[v] = j[opts[i]]; delete j[opts[i]] }
    set(opts.map((x, k) => (k === i ? v : x)), j)
  }
  const setJump = (o: string, to: string) => { const j = { ...jumps }; if (to) j[o] = to; else delete j[o]; upd({ jumps: Object.keys(j).length ? j : undefined }) }
  return (
    <div className="fm-options">
      {canJump && <p className="fm-hint">Send people to a different page depending on what they pick. Left as “Next page”, they just carry on.</p>}
      {opts.map((o, i) => (
        <div className="fm-opt-row" key={i}>
          <i className={`fm-mark ${it.type === 'radio' ? 'round' : it.type === 'select' ? 'num' : ''}`}>{it.type === 'select' ? i + 1 : ''}</i>
          <input value={o} aria-label={`Option ${i + 1}`} className={dup(o, i) ? 'dup' : ''} maxLength={200} onChange={(e) => rename(i, e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); set([...opts.slice(0, i + 1), `Option ${opts.length + 1}`, ...opts.slice(i + 1)]) } }} />
          {dup(o, i) && <span className="fm-dup-note">Duplicate</span>}
          {canJump && <Select label={`Where “${o}” goes`} className="fm-jump" value={pages.some((p) => p.id === jumps[o]) || jumps[o] === 'submit' ? jumps[o] : ''}
            options={[{ value: '', label: 'Next page' }, ...pages.map((p) => ({ value: p.id, label: `Go to ${p.label}` })), { value: 'submit', label: 'Submit the form' }]} onChange={(v) => setJump(o, v)} />}
          <button className="icon-btn sm" aria-label="Remove option" disabled={opts.length <= 1} onClick={() => { const j = { ...jumps }; delete j[o]; set(opts.filter((_, k) => k !== i), j) }}><X size={15} /></button>
        </div>
      ))}
      <div className="fm-opt-add">
        <button className="btn btn-pill btn-soft btn-sm" onClick={() => set([...opts, `Option ${opts.length + 1}`])}><Plus size={14} />Add option</button>
        {it.type !== 'select' && !it.other && <button className="btn btn-pill btn-ghost btn-sm" onClick={() => upd({ other: true })}>Add “Other”</button>}
        {it.other && <button className="btn btn-pill btn-ghost btn-sm" onClick={() => upd({ other: false })}><X size={14} />Remove “Other”</button>}
      </div>
    </div>
  )
}

/** "Show this only if…" rules, based on answers to questions above. */
function Logic({ it, upd, before }: { it: FormItem; upd: (p: Partial<FormItem>) => void; before: FormItem[] }) {
  const si = it.showIf
  const rules = si?.rules ?? []
  const label = (q: FormItem, n: number) => `${n}. ${q.title || 'Untitled question'}`.slice(0, 60)
  const nth = (q: FormItem) => before.findIndex((x) => x.id === q.id) + 1
  if (!rules.length) {
    if (!before.length) return null
    return <div className="fm-logic"><button className="btn btn-pill btn-ghost btn-sm" onClick={() => upd({ showIf: { match: 'all', rules: [{ q: before[before.length - 1].id, op: 'is', v: '' }] } })}><GitBranch size={15} />Show only if…</button></div>
  }
  const setRules = (r: Cond[]) => upd({ showIf: r.length ? { match: si?.match ?? 'all', rules: r } : undefined })
  const patch = (i: number, p: Partial<Cond>) => setRules(rules.map((r, k) => (k === i ? { ...r, ...p } : r)))
  return (
    <div className="fm-logic on">
      <div className="fm-logic-head">
        <GitBranch size={16} /><b>Show this {it.type === 'page' ? 'page' : 'block'} only if</b>
        {rules.length > 1 && <Select label="Match" value={si?.match ?? 'all'} options={[{ value: 'all', label: 'all of these' }, { value: 'any', label: 'any of these' }]} onChange={(v) => upd({ showIf: { match: v, rules } })} />}
      </div>
      {rules.map((r, i) => {
        const src = before.find((x) => x.id === r.q)
        const choices = src ? (src.type === 'scale' ? Array.from({ length: Math.max(0, (src.scaleMax ?? 5) - (src.scaleMin ?? 1) + 1) }, (_, k) => String((src.scaleMin ?? 1) + k)) : src.options) : undefined
        const ops = OPS.filter((o) => src && (src.type === 'file' ? ['filled', 'empty'].includes(o.value) : src.type === 'color' ? ['is', 'isnot', 'filled', 'empty'].includes(o.value) : choices ? ['is', 'isnot', 'filled', 'empty'].includes(o.value) || (src.type === 'checkbox' && o.value === 'contains') : src.type === 'number' ? ['is', 'isnot', 'gt', 'lt', 'filled', 'empty'].includes(o.value) : ['is', 'isnot', 'contains', 'filled', 'empty'].includes(o.value)))
        const op = OPS.find((o) => o.value === r.op)
        return (
          <div className="fm-rule" key={i}>
            <Select label="Question" className="fm-rule-q" value={src ? r.q : ''} options={[...(src ? [] : [{ value: '', label: 'A deleted or later question' }]), ...before.map((q) => ({ value: q.id, label: label(q, nth(q)) }))]} onChange={(v) => patch(i, { q: v, op: 'is', v: '' })} />
            <Select label="Condition" value={ops.some((o) => o.value === r.op) ? r.op : 'is'} options={ops.length ? ops : OPS} onChange={(v) => patch(i, { op: v })} />
            {op?.needsValue && (choices ? <Select label="Value" value={r.v ?? ''} options={[{ value: '', label: 'Choose…' }, ...choices.map((c) => ({ value: c, label: c }))]} onChange={(v) => patch(i, { v })} />
              : <input className="fm-rule-v" value={r.v ?? ''} maxLength={200} aria-label="Value" placeholder="Value" onChange={(e) => patch(i, { v: e.target.value })} />)}
            <button className="icon-btn sm" aria-label="Remove condition" onClick={() => setRules(rules.filter((_, k) => k !== i))}><X size={15} /></button>
          </div>
        )
      })}
      <button className="btn btn-pill btn-soft btn-sm" onClick={() => setRules([...rules, { q: before[before.length - 1].id, op: 'is', v: '' }])}><Plus size={14} />Add condition</button>
    </div>
  )
}

const numVal = (v: string): number | undefined => (v.trim() === '' || !Number.isFinite(Number(v)) ? undefined : Number(v))
function Num({ label, value, onChange, min }: { label: string; value: number | string | undefined; onChange: (v: number | undefined) => void; min?: number }) {
  return <label className="fm-mini"><span>{label}</span><input type="number" min={min} value={value ?? ''} onChange={(e) => onChange(numVal(e.target.value))} /></label>
}

/** Validation settings for the selected question. */
function Rules({ it, upd }: { it: FormItem; upd: (p: Partial<FormItem>) => void }) {
  const t = it.type
  const textual = t === 'short' || t === 'long' || t === 'email' || t === 'url'
  const problem = patternProblem(it.pattern ?? '')
  return (
    <div className="fm-rules">
      {textual && (
        <>
          <div className="fm-rule-row">
            <label className="fm-mini wide"><span>Placeholder</span><input value={it.placeholder ?? ''} maxLength={100} onChange={(e) => upd({ placeholder: e.target.value })} /></label>
            <Num label="Min length" min={0} value={it.minLen} onChange={(v) => upd({ minLen: v })} />
            <Num label="Max length" min={0} value={it.maxLen} onChange={(v) => upd({ maxLen: v })} />
          </div>
          {(t === 'short' || t === 'long') && (
            <div className="fm-rule-row">
              <label className="fm-mini wide"><span>Must match pattern (regular expression)</span><input className={problem ? 'dup' : ''} value={it.pattern ?? ''} placeholder="e.g. ^[A-Z]{3}-\d{4}$" spellCheck={false} maxLength={200} onChange={(e) => upd({ pattern: e.target.value })} /></label>
              <label className="fm-mini wide"><span>Message when it doesn't match</span><input value={it.patternMsg ?? ''} maxLength={200} placeholder="Use the format ABC-1234" onChange={(e) => upd({ patternMsg: e.target.value })} /></label>
              {problem && <p className="fm-err">{problem}</p>}
            </div>
          )}
        </>
      )}
      {t === 'number' && (
        <div className="fm-rule-row">
          <Num label="Minimum" value={it.min} onChange={(v) => upd({ min: v })} />
          <Num label="Maximum" value={it.max} onChange={(v) => upd({ max: v })} />
          <button type="button" role="switch" aria-checked={!!it.integer} className="fm-req" onClick={() => upd({ integer: !it.integer })}><span className={`fm-switch sm ${it.integer ? 'on' : ''}`}><i /></span>Whole numbers only</button>
        </div>
      )}
      {t === 'date' && (
        <div className="fm-rule-row">
          <div className="fm-mini"><span>Earliest date</span><DatePicker ariaLabel="Earliest date" placeholder="No limit" value={typeof it.min === 'string' ? it.min : ''} max={typeof it.max === 'string' ? it.max : undefined} onChange={(v) => upd({ min: v })} /></div>
          <div className="fm-mini"><span>Latest date</span><DatePicker ariaLabel="Latest date" placeholder="No limit" value={typeof it.max === 'string' ? it.max : ''} min={typeof it.min === 'string' ? it.min : undefined} onChange={(v) => upd({ max: v })} /></div>
        </div>
      )}
      {t === 'file' && (
        <div className="fm-rule-row">
          <div className="fm-mini"><span>Largest file</span><Select label="Largest file" value={String(it.maxMB ?? 3)} options={[{ value: '1', label: '1 MB' }, { value: '2', label: '2 MB' }, { value: '3', label: '3 MB' }]} onChange={(v) => upd({ maxMB: Number(v) })} /></div>
          <div className="fm-mini"><span>Allowed files</span><Select label="Allowed files" value={it.accept ?? 'any'} options={[{ value: 'any', label: 'Any file' }, { value: 'images', label: 'Images' }, { value: 'pdf', label: 'PDF' }, { value: 'docs', label: 'Documents and PDFs' }]} onChange={(v) => upd({ accept: v === 'any' ? undefined : v })} /></div>
          <p className="fm-hint" style={{ flexBasis: '100%' }}>Uploads count toward your storage until you delete the response. Programs and web pages are never accepted.</p>
        </div>
      )}
      {t === 'checkbox' && (
        <div className="fm-rule-row">
          <Num label="Choose at least" min={0} value={it.minSel} onChange={(v) => upd({ minSel: v })} />
          <Num label="Choose at most" min={0} value={it.maxSel} onChange={(v) => upd({ maxSel: v })} />
        </div>
      )}
      {t === 'scale' && (
        <div className="fm-rule-row">
          <label className="fm-mini"><span>From</span><Select label="Scale start" value={String(it.scaleMin ?? 1)} options={[{ value: '0', label: '0' }, { value: '1', label: '1' }]} onChange={(v) => upd({ scaleMin: Number(v) })} /></label>
          <label className="fm-mini"><span>To</span><Select label="Scale end" value={String(it.scaleMax ?? 5)} options={Array.from({ length: 9 }, (_, i) => ({ value: String(i + 2), label: String(i + 2) }))} onChange={(v) => upd({ scaleMax: Number(v) })} /></label>
          <label className="fm-mini wide"><span>Label for low end</span><input value={it.minLabel ?? ''} maxLength={60} onChange={(e) => upd({ minLabel: e.target.value })} /></label>
          <label className="fm-mini wide"><span>Label for high end</span><input value={it.maxLabel ?? ''} maxLength={60} onChange={(e) => upd({ maxLabel: e.target.value })} /></label>
        </div>
      )}
    </div>
  )
}


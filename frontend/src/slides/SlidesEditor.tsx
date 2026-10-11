import { SavePill } from '../ui/SavePill'
import { BranchButton } from '../editor/Branch'
import { RequestAccess, useOpenShareFromUrl } from '../editor/RequestAccess'
import { useWheelZoom, useZoom, ZoomPill } from '../ui/zoom'
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EncryptionBadge } from '../zk/EncryptionBadge'
import { openSettings } from '../ui/settingsStore'
import { Link } from 'react-router-dom'
import * as Y from 'yjs'
import { ArrowDown, ArrowUp, BringToFront, ClipboardPaste, Cloud, CloudOff, Copy, CopyPlus, History, Loader2, LogIn, MessageSquare, MessageSquarePlus, Moon, Pencil, Play, Plus, RotateCcw, Scissors, SendToBack, Share2, Sparkles, Sun, TextSelect, Trash2, Type, X } from 'lucide-react'
import { api, type ApiError, type DocInfo, type Version } from '../api'
import { useAuth } from '../auth'
import { KokoProvider } from '../collab'
import { ShareDialog } from '../editor/ShareDialog'
import { useContextMenu, type CtxItem } from '../ui/ContextMenu'
import { useComments } from '../editor/Comments'
import { fullLabel, VersionHistory } from '../editor/VersionHistory'
import { DiffToggle, VersionDiff } from '../editor/VersionDiff'
import { AnchoredComments } from '../ui/AnchoredComments'
import { takePending, takePrompt } from '../import/pending'
import { useTheme } from '../theme'
import { Avatar } from '../ui/Avatar'
import { Logo } from '../ui/Logo'
import { Popover } from '../ui/Popover'
import { toast } from '../ui/Toast'
import { Canvas, type RemoteSel } from './Canvas'
import { SlidesExportMenu } from './slidesExport'
import { SlideStage, useDeckFonts } from './SlideView'
import { SlidesModel } from './model'
import { Present } from './Present'
import { Rail } from './Rail'
import { type El } from './themes'
import { SlidesToolbar } from './Toolbar'
import { ChartDataDialog } from './DataDialog'
import './slides.css'

const AssistantHost = lazy(() => import('../assistant/AssistantHost'))
const ANIMALS = ['Otter', 'Fox', 'Koala', 'Panda', 'Heron', 'Lynx', 'Gecko', 'Falcon', 'Narwhal', 'Quokka']
const COLORS = ['#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#8b5cf6', '#ef4444', '#0ea5e9', '#22c55e', '#f97316', '#d946ef']
function guestIdentity() {
  try { const s = sessionStorage.getItem('koko.guest'); if (s) return JSON.parse(s) as { name: string; color: string } } catch { /* ignore */ }
  const g = { name: `Guest ${ANIMALS[Math.floor(Math.random() * ANIMALS.length)]}`, color: COLORS[Math.floor(Math.random() * COLORS.length)] }
  try { sessionStorage.setItem('koko.guest', JSON.stringify(g)) } catch { /* ignore */ }
  return g
}
function useModelVersion(m: SlidesModel) { const [v, setV] = useState(0); useEffect(() => m.subscribe(() => setV(m.version)), [m]); return v }
function useStatus(p: KokoProvider) { const [, f] = useState(0); useEffect(() => p.subscribe(() => f((n) => n + 1)), [p]); return { status: p.status, synced: p.synced } }

export default function SlidesEditor({ info }: { info: DocInfo }) {
  const { user } = useAuth()
  const readOnly = info.role === 'viewer'
  const identity = useMemo(() => (user ? { name: user.name, color: user.color } : guestIdentity()), [user])
  const ydoc = useMemo(() => new Y.Doc(), [])
  const model = useMemo(() => new SlidesModel(ydoc), [ydoc])
  const [provider, setProvider] = useState<KokoProvider | null>(null)
  useEffect(() => {
    const p = new KokoProvider(info.id, ydoc, readOnly)
    p.awareness.setLocalStateField('user', identity)
    setProvider(p)
    return () => { p.destroy(); setProvider(null) }
  }, [info.id, ydoc, readOnly, identity])
  useEffect(() => () => model.destroy(), [model])
  if (!provider) return <div className="splash"><span className="spinner" /></div>
  return <Inner info={info} ydoc={ydoc} model={model} provider={provider} readOnly={readOnly} />
}

function Inner({ info, ydoc, model, provider, readOnly }: { info: DocInfo; ydoc: Y.Doc; model: SlidesModel; provider: KokoProvider; readOnly: boolean }) {
  const uz = useZoom('slides'), mainRef = useRef<HTMLElement>(null)
  useWheelZoom(mainRef, uz)
  const { user, logout } = useAuth()
  const { theme: uiTheme, toggle: toggleTheme } = useTheme()
  const version = useModelVersion(model)
  const { status, synced } = useStatus(provider)
  const [title, setTitle] = useState(info.title)
  const [cur, setCurRaw] = useState('')
  const [sel, setSel] = useState<string[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [share, setShare] = useState(false)
  useOpenShareFromUrl(info.role === 'owner' || info.role === 'manager', setShare)
  const [initialPrompt] = useState(() => takePrompt(info.id))
  const [panel, setPanel] = useState<'none' | 'history' | 'assistant' | 'comments'>(initialPrompt ? 'assistant' : 'none')
  const [preview, setPreview] = useState<Version | null>(null)
  const [verKey, setVerKey] = useState(0)
  const [presenting, setPresenting] = useState<number | null>(null)
  const [remotes, setRemotes] = useState<RemoteSel[]>([])
  const [people, setPeople] = useState<{ id: number; name: string; color: string }[]>([])
  const clip = useRef<El[]>([])
  const [chartEdit, setChartEdit] = useState<string | null>(null)
  const [activeCell, setActiveCell] = useState<{ r: number; c: number } | null>(null)

  useEffect(() => { if (!synced) return; const p = !readOnly ? takePending(info.id, 'slides') : null; if (p) { p.apply(model); toast('Imported ' + p.title) } else model.ensureDeck() }, [synced, model, readOnly, info.id])
  useEffect(() => { const t = setTimeout(() => { if (!readOnly) model.ensureDeck() }, 3500); return () => clearTimeout(t) }, [model, readOnly])

  void version
  const slides = model.read()   // always the latest; re-renders are driven by `version`
  const theme = model.deckTheme()
  useDeckFonts(slides, theme)
  const slide = slides.find((s) => s.id === cur) ?? slides[0]
  useEffect(() => { if (slides.length && !slides.some((s) => s.id === cur)) setCurRaw(slides[0].id) }, [slides, cur])
  const setCur = useCallback((id: string) => { setCurRaw(id); setSel([]); setEditing(null) }, [])
  useEffect(() => { setSel((s) => (slide ? s.filter((id) => slide.els.some((e) => e.id === id)) : [])) }, [slide])

  // title lives in the shared doc, like documents
  const ymeta = model.meta
  useEffect(() => { const f = () => { const t = ymeta.get('title'); if (typeof t === 'string') setTitle(t) }; ymeta.observe(f); f(); return () => ymeta.unobserve(f) }, [ymeta])
  const titleTimer = useRef<number | undefined>(undefined)
  const onTitle = (v: string) => {
    setTitle(v); model.setMeta('title', v)
    window.clearTimeout(titleTimer.current)
    titleTimer.current = window.setTimeout(() => api.renameDoc(info.id, v).catch((e: ApiError) => toast(e.message)), 600)
  }
  useEffect(() => { document.title = `${title || 'Untitled presentation'} - KokoDocs` }, [title])

  // presence
  useEffect(() => { provider.awareness.setLocalStateField('sel', { slide: slide?.id, ids: sel }) }, [provider, slide?.id, sel])
  useEffect(() => {
    const f = () => {
      const r: RemoteSel[] = [], p: { id: number; name: string; color: string }[] = []
      provider.awareness.getStates().forEach((s, id) => {
        if (id === provider.doc.clientID || !s.user) return
        const u = s.user as { name: string; color: string }, rs = s.sel as { slide?: string; ids?: string[] } | undefined
        r.push({ id, name: u.name, color: u.color, slide: rs?.slide, ids: rs?.ids }); p.push({ id, ...u })
      })
      setRemotes(r); setPeople(p)
    }
    provider.awareness.on('change', f); f()
    return () => provider.awareness.off('change', f)
  }, [provider])

  useEffect(() => {
    const changed = () => { toast('Your access to this presentation changed'); setTimeout(() => location.reload(), 900) }
    window.addEventListener('koko:access-changed', changed)
    return () => window.removeEventListener('koko:access-changed', changed)
  }, [])

  // keyboard
  useEffect(() => {
    const k = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null
      if (!slide || presenting !== null || editing || t?.closest('input, textarea, select, [contenteditable="true"], .modal, .popover')) return
      const mod = ev.ctrlKey || ev.metaKey, key = ev.key.toLowerCase()
      if (mod && key === 'z') { ev.preventDefault(); if (!readOnly) (ev.shiftKey ? model.undo.redo() : model.undo.undo()); return }
      if (mod && key === 'y') { ev.preventDefault(); if (!readOnly) model.undo.redo(); return }
      if (mod && key === 'a') { ev.preventDefault(); setSel(slide.els.map((e) => e.id)); return }
      if (mod && key === 'c') { clip.current = slide.els.filter((e) => sel.includes(e.id)); return }
      if (mod && key === 'x' && !readOnly) { clip.current = slide.els.filter((e) => sel.includes(e.id)); model.deleteEls(slide.id, sel); setSel([]); return }
      if (mod && key === 'v' && !readOnly && clip.current.length) { ev.preventDefault(); setSel(clip.current.map((e) => model.addEl(slide.id, { ...e, id: undefined, x: e.x + 24, y: e.y + 24 } as never)!).filter(Boolean)); return }
      if (mod && key === 'd' && !readOnly && sel.length) { ev.preventDefault(); setSel(model.duplicateEls(slide.id, sel)); return }
      if (ev.key === 'Escape') { setSel([]); return }
      if (readOnly) return
      if ((ev.key === 'Delete' || ev.key === 'Backspace') && sel.length) { ev.preventDefault(); model.deleteEls(slide.id, sel); setSel([]); return }
      if (ev.key === 'Enter' && sel.length === 1) { const e = slide.els.find((x) => x.id === sel[0]); if (e && e.type !== 'image') { ev.preventDefault(); setEditing(e.id) } return }
      const step = ev.shiftKey ? 10 : 1
      const d = ev.key === 'ArrowLeft' ? [-step, 0] : ev.key === 'ArrowRight' ? [step, 0] : ev.key === 'ArrowUp' ? [0, -step] : ev.key === 'ArrowDown' ? [0, step] : null
      if (d && sel.length) { ev.preventDefault(); model.updateMany(slide.id, Object.fromEntries(slide.els.filter((e) => sel.includes(e.id)).map((e) => [e.id, { x: e.x + d[0], y: e.y + d[1] }]))) }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [slide, sel, editing, presenting, readOnly, model])

  const upload = useCallback((f: File) => api.uploadImage(info.id, f), [info.id])
  const restoreVersion = async (snap: Y.Doc, v: Version) => {
    try { await api.createVersion(info.id, `Before restoring ${v.label ?? fullLabel(v.created_at)}`) } catch { /* nothing to back up */ }
    model.restoreFrom(snap)
    setPreview(null); setVerKey((n) => n + 1)
    toast(`Restored ${v.label ?? fullLabel(v.created_at)}. The previous state is saved in version history.`)
  }
  const comments = useComments(info.id, !!user)
  const open = comments.list.filter((c) => !c.parent_id && !c.resolved && c.anchor)
  const pinMap = new Map<string, { id: string; el?: string; n: number }>()
  open.forEach((c) => { const k = `${c.anchor!.slide}|${c.anchor!.el ?? ''}`; const p = pinMap.get(k); if (p) p.n++; else pinMap.set(k, { id: String(c.anchor!.slide), el: c.anchor!.el ? String(c.anchor!.el) : undefined, n: 1 }) })
  const pins = [...pinMap.values()]
  const perSlide: Record<string, number> = {}; open.forEach((c) => { const k = String(c.anchor!.slide); perSlide[k] = (perSlide[k] ?? 0) + 1 })
  const elName = (e: El) => (e.role === 'title' ? 'title' : e.type === 'text' ? 'text' : e.type)
  const slideLabel = (a: Record<string, unknown> | null) => {
    if (!a || typeof a.slide !== 'string') return 'Presentation'
    const i = slides.findIndex((x) => x.id === a.slide); const el = a.el ? slides[i]?.els.find((e) => e.id === a.el) : undefined
    return i < 0 ? 'A deleted slide' : `Slide ${i + 1}${el ? `, ${elName(el)}` : ''}`
  }
  const goComment = (a: Record<string, unknown>) => { if (typeof a.slide !== 'string') return; setCur(a.slide); if (a.el) setTimeout(() => setSel([String(a.el)]), 0) }
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('comment'); if (!id || !comments.list.length) return
    const c = comments.list.find((x) => x.id === id); if (!c) return
    setPanel('comments'); if (c.anchor) goComment(c.anchor); history.replaceState(null, '', location.pathname)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments.list.length])
  const assistantDeps = { model, getCur: () => slide?.id ?? '', setCur, getSel: () => sel, getTitle: () => title, canEdit: () => !readOnly, docId: info.id }

  // right-click menus: on a slide's thumbnail, on an element, and on the empty stage
  const cm = useContextMenu()
  const pasteClip = () => { if (clip.current.length) setSel(clip.current.map((e) => model.addEl(slide.id, { ...e, id: undefined, x: e.x + 24, y: e.y + 24 } as never)!).filter(Boolean)) }
  const onContext = (x: number, y: number, id: string | null) => {
    const ids = id ? (sel.includes(id) ? sel : [id]) : sel
    if (id && !sel.includes(id)) setSel([id])
    const picked = slide.els.filter((e) => ids.includes(e.id)), one = picked.length === 1 ? picked[0] : null
    const items: CtxItem[] = []
    if (picked.length) {
      items.push(
        { label: 'Cut', icon: <Scissors size={16} />, hint: 'Ctrl+X', disabled: readOnly, onClick: () => { clip.current = picked; model.deleteEls(slide.id, ids); setSel([]) } },
        { label: 'Copy', icon: <Copy size={16} />, hint: 'Ctrl+C', onClick: () => { clip.current = picked } },
      )
    }
    items.push({ label: 'Paste', icon: <ClipboardPaste size={16} />, hint: 'Ctrl+V', disabled: readOnly || !clip.current.length, onClick: pasteClip })
    if (picked.length && !readOnly) {
      items.push({ label: 'Duplicate', icon: <CopyPlus size={16} />, hint: 'Ctrl+D', onClick: () => setSel(model.duplicateEls(slide.id, ids)) }, { sep: true })
      if (one && one.type === 'chart') items.push({ label: 'Edit chart data…', icon: <Pencil size={16} />, onClick: () => setChartEdit(one.id) })
      else if (one && one.type !== 'image') items.push({ label: 'Edit text', icon: <Pencil size={16} />, hint: 'Enter', onClick: () => setEditing(one.id) })
      items.push(
        { label: 'Bring to front', icon: <BringToFront size={16} />, onClick: () => model.reorder(slide.id, ids, 'front') },
        { label: 'Send to back', icon: <SendToBack size={16} />, onClick: () => model.reorder(slide.id, ids, 'back') },
      )
    }
    if (user && picked.length) items.push({ sep: true }, { label: 'Comment', icon: <MessageSquarePlus size={16} />, onClick: () => setPanel('comments') })
    if (!picked.length && !readOnly) items.push({ sep: true }, { label: 'Add text box', icon: <Type size={16} />, onClick: () => { const n = model.addEl(slide.id, { type: 'text', x: 400, y: 300, w: 480, h: 90, text: '', size: 32, align: 'left', valign: 'top' } as never); if (n) { setSel([n]); setEditing(n) } } })
    items.push({ sep: true }, { label: 'Select all', icon: <TextSelect size={16} />, hint: 'Ctrl+A', onClick: () => setSel(slide.els.map((e) => e.id)) })
    if (picked.length && !readOnly) items.push({ sep: true }, { label: picked.length > 1 ? `Delete ${picked.length} items` : 'Delete', icon: <Trash2 size={16} />, danger: true, hint: 'Del', onClick: () => { model.deleteEls(slide.id, ids); setSel([]) } })
    cm.show(x, y, items)
  }
  const onSlideContext = (x: number, y: number, sid: string) => {
    const i = slides.findIndex((s) => s.id === sid), last = slides.length - 1
    setCur(sid)
    cm.show(x, y, [
      { label: 'Present from here', icon: <Play size={16} />, onClick: () => setPresenting(i) },
      ...(readOnly ? [] : [
        { sep: true } as CtxItem,
        { label: 'New slide after this', icon: <Plus size={16} />, onClick: () => setCur(model.addSlide('titleContent', i)) },
        { label: 'Duplicate slide', icon: <Copy size={16} />, onClick: () => { const n = model.duplicateSlide(sid); if (n) setCur(n) } },
        { sep: true } as CtxItem,
        { label: 'Move up', icon: <ArrowUp size={16} />, disabled: i === 0, onClick: () => model.moveSlide(sid, i - 1) },
        { label: 'Move down', icon: <ArrowDown size={16} />, disabled: i === last, onClick: () => model.moveSlide(sid, i + 1) },
        { sep: true } as CtxItem,
        { label: 'Delete slide', icon: <Trash2 size={16} />, danger: true, disabled: slides.length < 2, onClick: () => { model.deleteSlide(sid); if (sid === slide.id) setCur(slides[Math.max(0, i - 1)].id === sid ? slides[1].id : slides[Math.max(0, i - 1)].id) } },
      ]),
    ])
  }
  if (!slide) return <div className="splash"><span className="spinner" /></div>
  const index = slides.findIndex((s) => s.id === slide.id)

  return (
    <div className="editor-shell slides-shell">
      <header className="ed-top">
        <div className="ed-left">
          {user ? <Link to="/" className="logo-link" title="All documents"><Logo size={32} /></Link> : <span className="logo-link"><Logo size={32} /></span>}
          <input className="title-input" value={title} readOnly={readOnly} onChange={(e) => onTitle(e.target.value)} placeholder="Untitled presentation" aria-label="Presentation title" maxLength={200} />
          <SavePill provider={provider} status={status} readOnly={readOnly} />
          <EncryptionBadge info={info} />
        </div>
        <div className="ed-right">
          <div className="presence">{people.slice(0, 5).map((p) => <Avatar key={p.id} name={p.name} color={p.color} size={32} ring />)}{people.length > 5 && <span className="more" data-tip={people.slice(5).map((x) => x.name).join(', ')}>+{people.length - 5}</span>}</div>
          <button className="btn btn-pill btn-soft" onClick={() => setPresenting(index)}><Play size={16} /><span className="lbl">Present</span></button>
          <SlidesExportMenu model={model} slides={slides} title={title} />
          {!readOnly && <button className={`icon-btn ${panel === 'history' ? 'active' : ''}`} title="Version history" aria-label="Version history" onClick={() => { setPreview(null); setPanel((p) => (p === 'history' ? 'none' : 'history')) }}><History size={19} /></button>}
          {user && !preview && (
            <button className={`icon-btn comments-btn ${panel === 'comments' ? 'active' : ''}`} title="Comments" aria-label="Comments" onClick={() => setPanel((p) => (p === 'comments' ? 'none' : 'comments'))}>
              <MessageSquare size={19} />{open.length > 0 && <b className="badge">{open.length}</b>}
            </button>)}
          {user && !preview && <button className={`btn btn-pill btn-soft ${panel === 'assistant' ? 'active' : ''}`} onClick={() => setPanel((p) => (p === 'assistant' ? 'none' : 'assistant'))}><Sparkles size={17} /><span className="lbl">Assistant</span></button>}
          <button className="icon-btn" onClick={toggleTheme} aria-label="Toggle theme">{uiTheme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
          <RequestAccess info={info} />
          <button className="btn btn-pill btn-primary" onClick={() => setShare(true)}><Share2 size={16} /><span className="lbl">Share</span></button>
          {user ? (
            <Popover align="end" trigger={({ toggle }) => <button className="avatar-btn" onClick={toggle}><Avatar name={user.name} color={user.color} size={34} /></button>}>
              {(close) => (<div className="menu wide"><div className="menu-head"><strong>{user.name}</strong><span>{user.email}</span></div><Link to="/" className="menu-link" onClick={close}>All documents</Link><button onClick={() => { close(); openSettings() }}>Settings</button><button onClick={() => { close(); logout() }}>Sign out</button></div>)}
            </Popover>
          ) : <Link className="btn btn-pill btn-ghost" to="/login" state={{ from: `/d/${info.id}` }}><LogIn size={16} />Sign in</Link>}
        </div>
      </header>

      {!preview && <div className="ed-toolbar-wrap"><SlidesToolbar model={model} slides={slides} slide={slide} theme={theme} sel={sel} setSel={setSel} setEditing={setEditing} setCur={setCur} readOnly={readOnly} upload={upload} transition={model.transition} activeCell={editing ? activeCell : null} onEditChart={setChartEdit} /></div>}

      <div className="ed-body slides-body">
        {preview ? <SlidesPreview live={ydoc} docId={info.id} version={preview} onRestore={restoreVersion} onClose={() => setPreview(null)} /> : (
          <>
            <Rail model={model} slides={slides} theme={theme} cur={slide.id} setCur={setCur} readOnly={readOnly} remotes={remotes} commentCounts={perSlide} onContext={onSlideContext} />
            <main className="sl-main" ref={mainRef}>
              <Canvas zoom={uz.z} model={model} slide={slide} theme={theme} sel={sel} setSel={setSel} editing={editing} setEditing={(id) => { setEditing(id); if (!id) setActiveCell(null) }} readOnly={readOnly} remotes={remotes} onContext={onContext} onEditChart={setChartEdit} onActiveCell={(r, c) => setActiveCell({ r, c })} pins={pins} />
              <div className="sl-notes">
                <label htmlFor="sl-notes-box">Speaker notes</label>
                <textarea id="sl-notes-box" rows={2} readOnly={readOnly} value={slide.notes} placeholder={readOnly ? 'No notes' : 'Add notes for this slide. Only you see them while presenting.'} onChange={(e) => model.setNotes(slide.id, e.target.value)} />
              </div>
            </main>
            <ZoomPill zoom={uz} anchor={mainRef} fitLabel="Fit the slide to the window" onFit={() => uz.reset()} />
          </>
        )}
        <aside className={`side right ${panel === 'assistant' ? 'wide' : ''} ${panel !== 'none' ? 'open' : ''}`}>
          <button className="side-close" aria-label="Close panel" onClick={() => setPanel('none')}><X size={18} /></button>
          <div className="side-inner">
            {panel === 'comments' && user
              ? <AnchoredComments docId={info.id} user={user} list={comments.list} refresh={comments.refresh} label={slideLabel} onGo={goComment}
                  current={{ anchor: sel.length === 1 ? { slide: slide.id, el: sel[0] } : { slide: slide.id }, label: slideLabel(sel.length === 1 ? { slide: slide.id, el: sel[0] } : { slide: slide.id }) }} />
              : panel === 'assistant' && user
              ? <Suspense fallback={null}><AssistantHost docId={info.id} user={user} initialPrompt={initialPrompt} onClose={() => setPanel('none')} source={{ kind: 'slides', deps: assistantDeps }} /></Suspense>
              : <VersionHistory docId={info.id} open={panel === 'history'} selected={preview} refreshKey={verKey} onSelect={(v) => { setPreview(v); if (window.matchMedia('(max-width: 720px)').matches) setPanel('none') }} unit="slides" />}
          </div>
        </aside>
      </div>

      {chartEdit && slide.els.find((e) => e.id === chartEdit) && <ChartDataDialog el={slide.els.find((e) => e.id === chartEdit)!} onSave={(p) => model.updateEl(slide.id, chartEdit, p)} onClose={() => setChartEdit(null)} />}
      {cm.node}
      {share && <ShareDialog info={info} onClose={() => setShare(false)} />}
      {presenting !== null && <Present slides={slides} theme={theme} start={presenting} transition={model.transition} onClose={() => setPresenting(null)} />}
    </div>
  )
}

/** Read-only view of an old version, with the same restore bar documents have. */
function SlidesPreview({ docId, version, live, onRestore, onClose }: { live: Y.Doc; docId: string; version: Version; onRestore: (snap: Y.Doc, v: Version) => Promise<void>; onClose: () => void }) {
  const [snap, setSnap] = useState<Y.Doc | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [diff, setDiff] = useState(false)
  useEffect(() => {
    let dead = false; setSnap(null); setErr('')
    api.versionData(docId, version.id).then((buf) => { if (dead) return; const d = new Y.Doc(); Y.applyUpdate(d, buf); setSnap(d) }).catch((e) => setErr(e.message || 'Could not load this version'))
    return () => { dead = true }
  }, [docId, version.id])
  const old = useMemo(() => { if (!snap) return null; const m = new SlidesModel(snap); const s = m.read(); const t = m.deckTheme(); m.destroy(); return { s, t } }, [snap])
  return (
    <main className="sl-main sl-preview">
      <div className="ver-bar">
        <div className="ver-bar-text"><b>{version.label ?? 'Earlier version'}</b><span>{fullLabel(version.created_at)}{version.authors.length ? ` · ${version.authors.join(', ')}` : ''}</span></div>
        <div className="ver-bar-actions">
          <DiffToggle on={diff} onClick={() => setDiff((d) => !d)} />
          <button className="btn btn-ghost btn-pill btn-sm" onClick={onClose}>Back to current</button>
          {snap && <BranchButton docId={docId} title="this file" versionId={version.id} />}
          <button className="btn btn-primary btn-pill btn-sm" disabled={!snap || busy} onClick={async () => { if (!snap) return; setBusy(true); try { await onRestore(snap, version) } finally { setBusy(false) } }}>
            {busy ? <Loader2 size={14} className="spin" /> : <RotateCcw size={14} />}Restore this version
          </button>
        </div>
      </div>
      {err ? <p className="side-empty ver-err">{err}</p> : diff ? <VersionDiff docId={docId} kind="slides" version={version} live={live} snap={snap} /> : err ? <p className="side-empty ver-err">{err}</p> : old ? (
        <div className="sl-preview-grid">{old.s.map((s, i) => <figure key={s.id}><SlideStage slide={s} theme={old.t} scale={0.3} /><figcaption>{i + 1}</figcaption></figure>)}</div>
      ) : <div className="splash small"><span className="spinner" /></div>}
    </main>
  )
}

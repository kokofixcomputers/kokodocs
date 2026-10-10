import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EncryptionBadge } from '../zk/EncryptionBadge'
import { Select } from '../ui/Select'
import { Link } from 'react-router-dom'
import * as Y from 'yjs'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import Placeholder from '@tiptap/extension-placeholder'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import { BookOpen, Braces, History, Loader2, RotateCcw, Sparkles, ChevronDown, ChevronLeft, ChevronRight, Cloud, CloudOff, FilePlus2, FileText, FileUp, SpellCheck, FolderClosed, FolderOpen, FolderPlus, LogIn, Moon, MoreHorizontal, PanelLeft, Search, Share2, Sun, Trash2, X } from 'lucide-react'
import { api, type ApiError, type DocInfo, type Version } from '../api'
import { useAuth } from '../auth'
import { KokoProvider } from '../collab'
import { useTheme } from '../theme'
import { Avatar } from '../ui/Avatar'
import { Logo } from '../ui/Logo'
import { Modal } from '../ui/Modal'
import { Popover } from '../ui/Popover'
import { askConfirm, askText } from '../ui/Dialogs'
import { toast } from '../ui/Toast'
import { useContextMenu, type CtxItem } from '../ui/ContextMenu'
import { openSettings } from '../ui/settingsStore'
import { baseExtensions } from '../editor/extensions'
import { ScrollAnchor } from '../editor/ScrollAnchor'
import { ImageUpload } from '../editor/ResizableImage'
import { PasteChecklists } from '../editor/PasteChecklists'
import { SlashCommand, SlashMenu } from '../editor/SlashMenu'
import { EmojiSuggest, EmojiSuggestMenu } from '../editor/EmojiSuggest'
import { CalloutMenu, ImageMenu, ShapeMenu, TableMenu } from '../editor/BubbleMenus'
import { LinkHover } from '../editor/LinkHover'
import { useBatchedRerender } from '../editor/useBatchedRerender'
import { DocContextMenu } from '../editor/TextContextMenu'
import { Toolbar } from '../editor/Toolbar'
import { useVoiceTyping } from '../voice/useVoiceTyping'
import { VoicePill } from '../voice/VoicePill'
import { VoiceFab } from '../voice/VoiceControl'
import { ReadAloud } from '../tts/ReadAloud'
import { useWheelZoom, useZoom, ZoomPill } from '../ui/zoom'
import { Outline } from '../editor/Outline'
import { ShareDialog } from '../editor/ShareDialog'
import { VersionHistory, fullLabel } from '../editor/VersionHistory'
import { DiffToggle, VersionDiff } from '../editor/VersionDiff'
import { guestIdentity, usePresence, useProviderStatus } from '../editor/DocEditor'
import { ApiRequest, KVEditor, MethodBadge, WikiBadge, WikiContext, WikiToolbarExtras, wikiSlashItems } from './WikiNodes'
import { WikiTab, WikiTabs } from './WikiTabs'
import { METHODS, type KV, type Vars } from './request'
import { ancestors, children, descendants, nextPos, place, reading, uid, type Entry, type Tree } from './tree'
import { ProofMenu, ProofreadMarks, ProofreadPanel, useProofread } from '../editor/Proofread'
import { NonPrinting } from '../editor/NonPrinting'
import { NotionImport } from './NotionImport'
import './wiki.css'
const AssistantHost = lazy(() => import('../assistant/AssistantHost'))

export default function WikiEditor({ info }: { info: DocInfo }) {
  const { user, logout } = useAuth()
  const { theme, toggle } = useTheme()
  const readOnly = info.role === 'viewer'
  const identity = useMemo(() => (user ? { name: user.name, color: user.color } : guestIdentity()), [user])
  const ydoc = useMemo(() => new Y.Doc(), [])
  const [provider, setProvider] = useState<KokoProvider | null>(null)
  useEffect(() => {
    const p = new KokoProvider(info.id, ydoc, readOnly)
    setProvider(p)
    return () => { p.destroy(); setProvider(null) }
  }, [info.id, ydoc, readOnly])
  if (!provider) return <div className="splash"><span className="spinner" /></div>
  return <Inner info={info} ydoc={ydoc} provider={provider} identity={identity} readOnly={readOnly} theme={theme} toggleTheme={toggle} user={user} logout={logout} />
}

interface InnerProps {
  info: DocInfo; ydoc: Y.Doc; provider: KokoProvider; identity: { name: string; color: string }; readOnly: boolean
  theme: string; toggleTheme: () => void; user: ReturnType<typeof useAuth>['user']; logout: () => void
}

const lsGet = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d } catch { return d } }
const lsSet = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* private mode */ } }

function Inner({ info, ydoc, provider, identity, readOnly, theme, toggleTheme, user, logout }: InnerProps) {
  const ytree = useMemo(() => ydoc.getMap<Entry>('tree'), [ydoc])
  const ymeta = useMemo(() => ydoc.getMap<unknown>('meta'), [ydoc])
  const [tree, setTree] = useState<Tree>({})
  const [title, setTitle] = useState(info.title)
  const [sharedVars, setSharedVars] = useState<Vars>({})
  const [myVars, setMyVars] = useState<Vars>(() => lsGet(`koko.wikivars.${info.id}`, {}))
  const [pageId, setPageId] = useState<string | null>(() => decodeURIComponent(location.hash.slice(1)) || null)
  const [navOpen, setNavOpen] = useState(() => window.innerWidth > 900)
  const [share, setShare] = useState(false)
  const [varsOpen, setVarsOpen] = useState(false)
  const [notion, setNotion] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [ed, setEd] = useState<Editor | null>(null)
  const edRef = useRef<Editor | null>(null); edRef.current = ed
  const [panel, setPanel] = useState<'none' | 'history' | 'assistant' | 'proof'>('none')
  const [preview, setPreview] = useState<Version | null>(null)
  const [verKey, setVerKey] = useState(0)
  const proof = useProofread(ed, info.id)
  const voice = useVoiceTyping({ editor: ed, docId: info.id, enabled: !readOnly && !preview })
  const uz = useZoom('wiki'), canvasRef = useRef<HTMLDivElement>(null)
  useWheelZoom(canvasRef, uz)
  const { status, synced } = useProviderStatus(provider)
  const people = usePresence(provider)

  useEffect(() => {
    const f = () => {
      setTree(ytree.toJSON() as Tree)
    }
    ytree.observe(f); f()
    return () => ytree.unobserve(f)
  }, [ytree])
  useEffect(() => {
    const f = () => {
      const t = ymeta.get('title'); if (typeof t === 'string') setTitle(t)
      const v = ymeta.get('vars'); setSharedVars(v && typeof v === 'object' ? (v as Vars) : {})
    }
    ymeta.observe(f); f()
    return () => ymeta.unobserve(f)
  }, [ymeta])
  useEffect(() => { const h = () => setPageId(decodeURIComponent(location.hash.slice(1)) || null); window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h) }, [])
  useEffect(() => {
    const changed = () => { toast('Your access to this wiki changed'); setTimeout(() => location.reload(), 900) }
    window.addEventListener('koko:access-changed', changed)
    return () => window.removeEventListener('koko:access-changed', changed)
  }, [])

  // a brand new wiki gets one page and an address to try, so the blocks have something to show
  useEffect(() => {
    if (!synced || readOnly || Object.keys(tree).length || ymeta.get('seeded')) return
    ydoc.transact(() => {
      ymeta.set('seeded', true)
      ytree.set('home', { t: 'page', title: 'Welcome', parent: null, pos: 1 })
      if (!ymeta.get('vars')) ymeta.set('vars', { baseUrl: 'https://httpbin.org' })
    })
  }, [synced, readOnly, tree, ymeta, ytree, ydoc])

  const order = useMemo(() => reading(tree), [tree])
  const cur = pageId && tree[pageId]?.t === 'page' ? pageId : order[0] ?? null
  const curRef = useRef(cur); curRef.current = cur
  const go = useCallback((id: string) => { history.replaceState(null, '', `#${encodeURIComponent(id)}`); setPageId(id); if (window.innerWidth <= 900) setNavOpen(false) }, [])

  const vars = useMemo<Vars>(() => ({ ...sharedVars, ...myVars }), [sharedVars, myVars])

  const titleTimer = useRef<number | undefined>(undefined)
  const onTitle = (v: string) => {
    setTitle(v); ymeta.set('title', v)
    window.clearTimeout(titleTimer.current)
    titleTimer.current = window.setTimeout(() => { api.renameDoc(info.id, v).catch((e: ApiError) => toast(e.message)) }, 600)
  }
  useEffect(() => { document.title = `${title || 'Untitled wiki'} - KokoDocs` }, [title])

  const patch = (id: string, p: Partial<Entry>) => { const c = ytree.get(id); if (c) ytree.set(id, { ...c, ...p }) }
  const add = (t: Entry['t'], parent: string | null) => {
    const id = uid()
    ytree.set(id, { t, title: t === 'page' ? 'Untitled page' : 'New folder', parent, pos: nextPos(ytree.toJSON() as Tree, parent) })
    if (parent) setClosed((s) => { const n = new Set(s); n.delete(parent); return n })
    if (t === 'page') { go(id); setRenaming(id) } else setRenaming(id)
  }
  const remove = async (id: string) => {
    const e = tree[id]; if (!e) return
    const gone = [id, ...descendants(tree, id)]
    const pages = gone.filter((g) => tree[g].t === 'page').length
    if (!(await askConfirm({ title: `Delete “${e.title}”?`, text: e.t === 'folder' ? `This deletes the folder and the ${pages} ${pages === 1 ? 'page' : 'pages'} inside it. You can restore them from version history only if you saved a version first.` : 'This deletes the page and everything on it.', label: 'Delete', danger: true }))) return
    ydoc.transact(() => {
      for (const g of gone) { ytree.delete(g); const f = ydoc.getXmlFragment('p:' + g); if (f.length) f.delete(0, f.length) }
    })
    if (cur && gone.includes(cur)) { const next = reading(ytree.toJSON() as Tree)[0]; if (next) go(next); else history.replaceState(null, '', location.pathname) }
  }
  const move = (id: string, parent: string | null, before: string | null) => {
    const p = place(tree, id, parent, before); if (!p) return
    patch(id, p)
    if (parent) setClosed((s) => { const n = new Set(s); n.delete(parent); return n })
  }
  const nudge = (id: string, dir: -1 | 1) => {
    const sibs = children(tree, tree[id].parent), i = sibs.indexOf(id)
    if (dir < 0 && i > 0) move(id, tree[id].parent, sibs[i - 1])
    else if (dir > 0 && i < sibs.length - 1) move(id, tree[id].parent, sibs[i + 2] ?? null)
  }

  // ── sidebar ──
  const [closed, setClosed] = useState<Set<string>>(() => new Set(lsGet<string[]>(`koko.wikiclosed.${info.id}`, [])))
  useEffect(() => lsSet(`koko.wikiclosed.${info.id}`, [...closed]), [closed, info.id])
  const [q, setQ] = useState('')
  const [drag, setDrag] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ id: string; at: 'before' | 'after' | 'inside' } | null>(null)
  const cm = useContextMenu()

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase(); if (!s) return null
    const set = new Set<string>()
    for (const id of Object.keys(tree)) if (tree[id].title.toLowerCase().includes(s)) { set.add(id); ancestors(tree, id).forEach((a) => set.add(a)) }
    return set
  }, [q, tree])

  const menuFor = (id: string): CtxItem[] => {
    const e = tree[id]
    const items: CtxItem[] = [{ label: 'Rename', onClick: () => { if (e.t === 'page') go(id); setRenaming(id) } }]
    if (readOnly) return []
    if (e.t === 'folder') items.push({ label: 'New page inside', onClick: () => add('page', id) }, { label: 'New folder inside', onClick: () => add('folder', id) })
    items.push({ sep: true }, { label: 'Move up', onClick: () => nudge(id, -1) }, { label: 'Move down', onClick: () => nudge(id, 1) })
    if (e.parent) items.push({ label: 'Move out of folder', onClick: () => move(id, tree[e.parent!].parent, e.parent!) })
    if (e.t === 'page') {
      items.push({ sep: true }, { heading: 'Method badge' }, { label: 'None', checked: !e.method, onClick: () => patch(id, { method: undefined }) })
      for (const m of METHODS) items.push({ label: m, checked: e.method === m, onClick: () => patch(id, { method: m }) })
    }
    items.push({ sep: true }, { label: 'Delete', danger: true, icon: <Trash2 size={16} />, onClick: () => void remove(id) })
    return items
  }

  const row = (id: string, depth: number) => {
    const e = tree[id], isF = e.t === 'folder', open = !closed.has(id) || !!shown
    const kids = isF && open ? children(tree, id).filter((k) => !shown || shown.has(k)) : []
    const on = id === cur
    return (
      <div key={id} role="treeitem" aria-expanded={isF ? open : undefined} aria-selected={on}>
        <div className={`wk-row ${on ? 'on' : ''} ${drop?.id === id ? `drop-${drop.at}` : ''} ${drag === id ? 'dragging' : ''}`} style={{ paddingLeft: 8 + depth * 16 }}
          draggable={!readOnly && !shown}
          onDragStart={(ev) => { setDrag(id); ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', id) }}
          onDragEnd={() => { setDrag(null); setDrop(null) }}
          onDragOver={(ev) => {
            if (!drag || drag === id) return
            ev.preventDefault()
            const r = (ev.currentTarget as HTMLElement).getBoundingClientRect(), y = (ev.clientY - r.top) / r.height
            setDrop({ id, at: isF && y > 0.25 && y < 0.75 ? 'inside' : y < 0.5 ? 'before' : 'after' })
          }}
          onDrop={(ev) => {
            ev.preventDefault()
            if (drag && drop && drop.id === id) {
              if (drop.at === 'inside') move(drag, id, null)
              else if (drop.at === 'before') move(drag, e.parent, id)
              else { const sibs = children(tree, e.parent).filter((s) => s !== drag); move(drag, e.parent, sibs[sibs.indexOf(id) + 1] ?? null) }
            }
            setDrag(null); setDrop(null)
          }}
          {...cm.bind(() => menuFor(id))}>
          <button className="wk-row-main" onClick={() => (isF ? setClosed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n }) : go(id))}>
            {isF ? (open ? <ChevronDown size={15} className="wk-chev" /> : <ChevronRight size={15} className="wk-chev" />) : <span className="wk-chev-gap" />}
            {isF ? (open ? <FolderOpen size={16} /> : <FolderClosed size={16} />) : e.method ? <MethodBadge method={e.method} /> : <FileText size={16} />}
            <span className="wk-row-title">{e.title || 'Untitled'}</span>
          </button>
          {!readOnly && <button className="wk-row-more icon-btn sm" aria-label="More" onClick={(ev) => { const r = (ev.currentTarget as HTMLElement).getBoundingClientRect(); cm.show(r.right, r.bottom + 4, menuFor(id)) }}><MoreHorizontal size={15} /></button>}
        </div>
        {isF && open && <div role="group">{kids.map((k) => row(k, depth + 1))}</div>}
      </div>
    )
  }
  const top = children(tree, null).filter((k) => !shown || shown.has(k))

  /** Put an old version back as an ordinary edit, so everyone connected sees it and nothing is lost. */
  const restoreVersion = async (snap: Y.Doc, v: Version) => {
    try { await api.createVersion(info.id, `Before restoring ${v.label ?? fullLabel(v.created_at)}`) } catch { /* nothing to back up */ }
    const old = snap.getMap<Entry>('tree').toJSON() as Tree
    ydoc.transact(() => {
      const now = ytree.toJSON() as Tree
      for (const id of new Set([...Object.keys(now), ...Object.keys(old)])) {
        if (old[id]) ytree.set(id, old[id]); else ytree.delete(id)
        const live = ydoc.getXmlFragment('p:' + id)
        if (live.length) live.delete(0, live.length)
        const src = snap.getXmlFragment('p:' + id)
        if (old[id] && src.length) live.insert(0, src.toArray().map((n) => (n as Y.XmlElement).clone()))
      }
      const sm = snap.getMap<unknown>('meta')
      for (const k of ['title', 'vars']) { if (sm.has(k)) ymeta.set(k, sm.get(k)); else ymeta.delete(k) }
    })
    const t = ymeta.get('title'); if (typeof t === 'string') api.renameDoc(info.id, t).catch(() => {})
    setPreview(null); setVerKey((n) => n + 1)
    toast(`Restored ${v.label ?? fullLabel(v.created_at)}. The previous state is saved in version history.`)
  }
  const assistantDeps = {
    ydoc, getTree: () => ytree.toJSON() as Tree, getCur: () => curRef.current, getEditor: () => edRef.current, getTitle: () => title, setTitle: (t: string) => onTitle(t), canEdit: () => !readOnly,
    getVars: () => ({ shared: (ymeta.get('vars') as Vars | undefined) ?? {}, privateNames: Object.keys(myVars) }),
    setSharedVar: (name: string, value: string | null) => { const v = { ...((ymeta.get('vars') as Vars | undefined) ?? {}) }; if (value === null) delete v[name]; else v[name] = value; ymeta.set('vars', v) },
    add: (t: Entry['t'], parent: string | null, ttl: string, method?: string) => { const id = uid(); ytree.set(id, { t, title: ttl, parent, pos: nextPos(ytree.toJSON() as Tree, parent), ...(method ? { method } : {}) }); return id },
    patch: (id: string, p: Partial<Entry>) => patch(id, p),
    move: (id: string, parent: string | null, before: string | null) => move(id, parent, before),
    remove: (ids: string[]) => ydoc.transact(() => { for (const g of ids) { ytree.delete(g); const f = ydoc.getXmlFragment('p:' + g); if (f.length) f.delete(0, f.length) } }),
  }
  const connLabel = status === 'connected' ? (readOnly ? 'View only' : 'Saved') : status === 'denied' ? 'No access' : status === 'offline' ? 'Offline' : 'Reconnecting'
  const ConnIcon = status === 'connected' ? Cloud : CloudOff
  useEffect(() => {
    if (!renaming || !tree[renaming] || tree[renaming].t !== 'folder') return
    const id = renaming
    void askText({ title: 'Folder name', value: tree[id].title, label: 'Save' }).then((v) => { if (v) patch(id, { title: v.slice(0, 120) }); setRenaming(null) })
  }, [renaming])  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <WikiContext.Provider value={{ vars }}>
      <div className="editor-shell wiki-shell">
        <header className="ed-top">
          <div className="ed-left">
            <button className={`icon-btn ${navOpen ? 'active' : ''}`} onClick={() => setNavOpen((o) => !o)} aria-label="Toggle contents" title="Contents"><PanelLeft size={19} /></button>
            {user ? <Link to="/" className="logo-link" title="All documents"><Logo size={32} /></Link> : <span className="logo-link"><Logo size={32} /></span>}
            <input className="title-input" value={title} readOnly={readOnly} onChange={(e) => onTitle(e.target.value)} placeholder="Untitled wiki" aria-label="Wiki title" maxLength={200} />
            <span className={`status-pill ${status}`}><ConnIcon size={14} /><span className="lbl">{connLabel}</span></span>
          <EncryptionBadge info={info} />
          </div>
          <div className="ed-right">
            <div className="presence">
              {people.slice(0, 5).map((p) => <Avatar key={p.id} name={p.name} color={p.color} size={32} ring />)}
              {people.length > 5 && <span className="more" data-tip={people.slice(5).map((x) => x.name).join(', ')}>+{people.length - 5}</span>}
            </div>
            {!readOnly && <button className={`icon-btn ${panel === 'history' ? 'active' : ''}`} title="Version history" aria-label="Version history" onClick={() => { setPreview(null); setPanel((p) => (p === 'history' ? 'none' : 'history')) }}><History size={19} /></button>}
            <ReadAloud plain={!!info.zk} />
            {user && !preview && <button className={`btn btn-pill btn-soft ${panel === 'assistant' ? 'active' : ''}`} onClick={() => setPanel((p) => (p === 'assistant' ? 'none' : 'assistant'))}><Sparkles size={17} /><span className="lbl">Assistant</span></button>}
            {!preview && <button className={`btn btn-pill btn-soft proof-btn ${panel === 'proof' ? 'active' : ''}`} onClick={() => setPanel((p) => (p === 'proof' ? 'none' : 'proof'))}>
              <SpellCheck size={17} /><span className="lbl">Proofread</span>{proof.issues.length > 0 && <b className="badge">{proof.issues.length}</b>}
            </button>}
            <button className="btn btn-pill btn-soft" onClick={() => setVarsOpen(true)} title="Values the request blocks can use, like the server address"><Braces size={17} /><span className="lbl">Variables</span></button>
            <button className="icon-btn" onClick={toggleTheme} aria-label="Toggle theme">{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
            <button className="btn btn-pill btn-primary" onClick={() => setShare(true)}><Share2 size={16} /><span className="lbl">Share</span></button>
            {user ? (
              <Popover align="end" trigger={({ toggle }) => <button className="avatar-btn" onClick={toggle}><Avatar name={user.name} color={user.color} size={34} /></button>}>
                {(close) => (
                  <div className="menu wide">
                    <div className="menu-head"><strong>{user.name}</strong><span>{user.email}</span></div>
                    <Link to="/" className="menu-link" onClick={close}>All documents</Link>
                    <button onClick={() => { close(); openSettings() }}>Settings</button><button onClick={() => { close(); logout() }}>Sign out</button>
                  </div>)}
              </Popover>
            ) : <Link className="btn btn-pill btn-ghost" to="/login" state={{ from: `/d/${info.id}` }}><LogIn size={16} />Sign in</Link>}
          </div>
        </header>

        {ed && !readOnly && !preview && <div className="ed-toolbar-wrap"><Toolbar voice={voice} docId={info.id} extras={<WikiToolbarExtras editor={ed} />} editor={ed} onImage={(f) => api.uploadImage(info.id, f).then((src) => ed.chain().focus().setImage({ src, width: 360 } as never).run()).catch((e) => toast(e.message))} /></div>}

        <div className="wiki-body">
          {navOpen && !preview && <button className="wk-scrim" aria-label="Close contents" onClick={() => setNavOpen(false)} />}
          <aside className={`wk-nav ${navOpen && !preview ? 'open' : ''}`} aria-label="Contents">
            <div className="wk-nav-in">
              <div className="wk-nav-top">
                <label className="field compact"><Search size={15} /><input placeholder="Filter pages" value={q} onChange={(e) => setQ(e.target.value)} />{q && <button className="icon-btn sm" aria-label="Clear" onClick={() => setQ('')}><X size={14} /></button>}</label>
                {!readOnly && <>
                  <button className="icon-btn" title="New page" aria-label="New page" onClick={() => add('page', null)}><FilePlus2 size={18} /></button>
                  <button className="icon-btn" title="New folder" aria-label="New folder" onClick={() => add('folder', null)}><FolderPlus size={18} /></button>
                  <button className="icon-btn" title="Import from Notion" aria-label="Import from Notion" onClick={() => setNotion(true)}><FileUp size={18} /></button></>}
              </div>
              <div className="wk-tree" role="tree"
                onDragOver={(ev) => { if (drag && (ev.target as HTMLElement).classList.contains('wk-tree')) ev.preventDefault() }}
                onDrop={(ev) => { if (drag && (ev.target as HTMLElement).classList.contains('wk-tree')) { move(drag, null, null); setDrag(null); setDrop(null) } }}>
                {top.map((k) => row(k, 0))}
                {!top.length && <p className="wk-nav-empty">{q ? 'Nothing matches.' : readOnly ? 'This wiki has no pages yet.' : 'No pages yet. Add one with the button above.'}</p>}
              </div>
            </div>
          </aside>

          <div className="canvas wiki-canvas" ref={canvasRef} style={{ ['--uz' as string]: uz.z }}>
            {!synced && status !== 'denied' && <div className="sync-banner">Loading wiki</div>}
            {preview ? <WikiPreview live={ydoc} docId={info.id} version={preview} onRestore={restoreVersion} onClose={() => setPreview(null)} /> : cur && tree[cur] ? (
              <PageView key={cur} id={cur} entry={tree[cur]} crumbs={ancestors(tree, cur).map((a) => tree[a].title)} prev={order[order.indexOf(cur) - 1]} next={order[order.indexOf(cur) + 1]}
                tree={tree} go={go} ydoc={ydoc} ymeta={ymeta} provider={provider} identity={identity} readOnly={readOnly} synced={synced} info={info}
                proof={proof} onEditor={setEd} onPatch={(p) => patch(cur, p)} autoFocusTitle={renaming === cur} onFocused={() => setRenaming(null)} />
            ) : synced ? (
              <div className="wiki-empty"><BookOpen size={34} /><h2>{readOnly ? 'Nothing here yet' : 'Start your wiki'}</h2><p>{readOnly ? 'The owner hasn’t added any pages.' : 'Add a page to begin. Pages can hold text, tables, code and request blocks people can try.'}</p>
                {!readOnly && <button className="btn btn-pill btn-primary" onClick={() => add('page', null)}><FilePlus2 size={17} />New page</button>}</div>
            ) : null}
          </div>
          <ZoomPill zoom={uz} anchor={canvasRef} fitLabel="Fit the whole page" onFit={() => {
            const c = canvasRef.current, w = c?.querySelector('.wiki-wrap'); if (!c || !w) return
            const r = w.getBoundingClientRect(), nw = r.width / uz.z, nh = r.height / uz.z   // (sizes on the screen are zoomed, so divide the zoom out)
            uz.set(Math.max(0.1, Math.min(1, (c.clientWidth - 48) / nw, (c.clientHeight - 56) / nh))); c.scrollTo({ top: 0 })
          }} />
          <aside className={`side right ${panel === 'assistant' ? 'wide' : ''} ${panel !== 'none' ? 'open' : ''}`}>
            <button className="side-close" aria-label="Close panel" onClick={() => setPanel('none')}><X size={18} /></button>
            <div className="side-inner">
              {panel === 'assistant' && user
                ? <Suspense fallback={null}><AssistantHost docId={info.id} user={user} onClose={() => setPanel('none')} source={{ kind: 'wiki', deps: assistantDeps }} /></Suspense>
                  : panel === 'proof' && ed ? <ProofreadPanel editor={ed} state={proof} />
                : panel === 'history' ? <VersionHistory docId={info.id} open selected={preview} refreshKey={verKey} unit="pages" onSelect={(v) => { setPreview(v); if (window.innerWidth <= 900) setPanel('none') }} /> : null}
            </div>
          </aside>
        </div>

        {cm.node}
        <VoicePill voice={voice} />
        <VoiceFab voice={voice} editable={!readOnly && !preview} />
        {ed && !preview && <ProofMenu editor={ed} state={proof} />}
        <SlashMenu />
        <EmojiSuggestMenu />
        {notion && <NotionImport ydoc={ydoc} tree={tree} upload={(f) => api.uploadImage(info.id, f)} onClose={() => setNotion(false)} onOpen={go} />}
        {share && <ShareDialog info={info} onClose={() => setShare(false)} />}
        {varsOpen && <VariablesDialog shared={sharedVars} mine={myVars} canEdit={!readOnly} id={info.id}
          onShared={(v) => ymeta.set('vars', v)} onMine={(v) => { setMyVars(v); lsSet(`koko.wikivars.${info.id}`, v) }} onClose={() => setVarsOpen(false)} />}
      </div>
    </WikiContext.Provider>
  )
}

// ── a page ────────────────────────────────────────────────────────────────────

const STARTER = (baseNote: string) => ({
  type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: baseNote }] },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Try a request' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Type / on an empty line for request blocks, parameter tables and badges like ' }, { type: 'wikiBadge', attrs: { label: 'Required' } }, { type: 'text', text: ' or ' }, { type: 'wikiBadge', attrs: { label: 'Beta' } }, { type: 'text', text: '. Press Send below to run this one.' }] },
    { type: 'apiRequest', attrs: { method: 'GET', url: '{{baseUrl}}/get', query: [{ k: 'hello', v: 'wiki' }], title: 'Echoes back what you sent' } },
    { type: 'paragraph' },
  ],
})

function PageView({ id, entry, crumbs, prev, next, tree, go, ydoc, ymeta, provider, identity, readOnly, synced, info, proof, onPatch, onEditor, autoFocusTitle, onFocused }: {
  id: string; entry: Entry; crumbs: string[]; prev?: string; next?: string; tree: Tree; go: (id: string) => void; ydoc: Y.Doc; ymeta: Y.Map<unknown>; provider: KokoProvider
  identity: { name: string; color: string }; readOnly: boolean; synced: boolean; info: DocInfo; proof: ReturnType<typeof useProofread>
  onPatch: (p: Partial<Entry>) => void; onEditor: (e: Editor | null) => void; autoFocusTitle: boolean; onFocused: () => void
}) {
  const upload = useCallback((f: File) => api.uploadImage(info.id, f), [info.id])
  const extensions = useMemo(() => [
    ...baseExtensions(),
    ImageUpload.configure({ upload, importUrl: (u: string) => api.importImage(info.id, u) }),
    PasteChecklists,
    Placeholder.configure({ placeholder: 'Write here, or type / for blocks like a request, a parameters table or a badge' }),
    Collaboration.configure({ document: ydoc, field: 'p:' + id }),
    CollaborationCursor.configure({
      provider, user: identity,
      render: (u: { name: string; color: string }) => {
        const c = document.createElement('span'); c.className = 'collab-caret'; c.style.borderColor = u.color
        const l = document.createElement('div'); l.className = 'collab-label'; l.style.background = u.color; l.textContent = u.name; c.appendChild(l)
        return c
      },
    }),
    SlashCommand.configure({ extra: wikiSlashItems }),
    EmojiSuggest,
    ApiRequest, WikiBadge, WikiTabs, WikiTab, ProofreadMarks, ScrollAnchor, NonPrinting,
  ], [provider, identity, ydoc, upload, id, info.id])
  const editorProps = useMemo(() => ({ attributes: { spellcheck: 'false', class: 'koko-prose' } }), [])
  const editor = useEditor({ editable: !readOnly, editorProps, extensions, shouldRerenderOnTransaction: false }, [])
  useBatchedRerender(editor)
  useEffect(() => { onEditor(editor); return () => onEditor(null) }, [editor, onEditor])
  const titleRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (autoFocusTitle && titleRef.current) { titleRef.current.focus(); titleRef.current.select(); onFocused() } }, [autoFocusTitle, onFocused])

  // the first page of a new wiki starts with a short guide and a request to try
  useEffect(() => {
    if (!editor || !synced || readOnly || id !== 'home' || ymeta.get('seededContent')) return
    if (editor.isEmpty) { ymeta.set('seededContent', true); editor.commands.setContent(STARTER('This is your wiki. Use the contents on the left to add pages and folders, and drag them to reorder.')) }
  }, [editor, synced, readOnly, id, ymeta])

  useEffect(() => {
    if (!editor || !readOnly) return
    const dom = editor.view.dom
    const click = (e: Event) => { if ((e.target as HTMLElement).matches?.('input[type="checkbox"]')) toast('This wiki is view only. Ask the owner for edit access.') }
    dom.addEventListener('click', click)
    return () => dom.removeEventListener('click', click)
  }, [editor, readOnly])

  // links to other pages (the ones an import creates are written as #<page id>) open that page instead of a new tab
  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom
    const click = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest?.('a[href^="#"]') as HTMLAnchorElement | null
      const id = a?.getAttribute('href')?.slice(1)
      if (a && id && tree[id]) { e.preventDefault(); if (tree[id].t === 'page') go(id) }
    }
    dom.addEventListener('click', click)
    return () => dom.removeEventListener('click', click)
  }, [editor, tree, go])
  if (!editor) return <div className="splash small"><span className="spinner" /></div>
  const sibling = (pid?: string) => pid && tree[pid] ? <button className="wk-pn" onClick={() => go(pid)}>{pid === prev ? <ChevronLeft size={18} /> : null}<span><em>{pid === prev ? 'Previous' : 'Next'}</em><b>{tree[pid].title || 'Untitled'}</b></span>{pid === next ? <ChevronRight size={18} /> : null}</button> : <span />
  return (
    <div className="wiki-wrap">
      <article className="wiki-page">
        {crumbs.length > 0 && <nav className="wiki-crumbs" aria-label="Breadcrumb">{crumbs.map((c, i) => <span key={i}>{c || 'Untitled'}<ChevronRight size={13} /></span>)}</nav>}
        <div className="wiki-head">
          <input ref={titleRef} className="wiki-title" value={entry.title} readOnly={readOnly} placeholder="Untitled page" aria-label="Page title" maxLength={120} onChange={(e) => onPatch({ title: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); editor.commands.focus('start') } }} />
          {!readOnly ? (
            <Select className="wk-badge wk-method-select wiki-method" tone={entry.method ? entry.method.toLowerCase() : 'none'} label="Method badge shown in the contents" value={entry.method ?? ''} options={[{ value: '', label: 'No badge' }, ...METHODS.map((m) => ({ value: m, label: m }))]} onChange={(m) => onPatch({ method: m || undefined })} />) : entry.method ? <MethodBadge method={entry.method} /> : null}
        </div>
        <EditorContent editor={editor} />
        <footer className="wiki-pn">{sibling(prev)}{sibling(next)}</footer>
      </article>
      <aside className="wiki-toc"><div className="wiki-toc-in"><Outline editor={editor} heading="On this page" /></div></aside>
      {!readOnly && <DocContextMenu editor={editor} issues={proof.issues} recheck={proof.recheck} ignore={proof.ignore} onComment={undefined} onFind={() => {}} />}
      <LinkHover editor={editor} />
      <TableMenu editor={editor} /><CalloutMenu editor={editor} /><ImageMenu editor={editor} /><ShapeMenu editor={editor} />
    </div>
  )
}

// ── variables ─────────────────────────────────────────────────────────────────

const toRows = (v: Vars): KV[] => Object.entries(v).map(([k, val]) => ({ k, v: val }))
const toVars = (rows: KV[]): Vars => { const o: Vars = {}; for (const r of rows) if (r.k.trim()) o[r.k.trim()] = r.v; return o }

function VariablesDialog({ shared, mine, canEdit, onShared, onMine, onClose }: { shared: Vars; mine: Vars; canEdit: boolean; id: string; onShared: (v: Vars) => void; onMine: (v: Vars) => void; onClose: () => void }) {
  const [a, setA] = useState<KV[]>(() => toRows(shared))
  const [b, setB] = useState<KV[]>(() => toRows(mine))
  return (
    <Modal title="Variables" onClose={onClose} width={560}>
      <div className="share-body wk-vars">
        <p className="muted hint" style={{ margin: 0 }}>Write <code>{'{{name}}'}</code> in a request’s address, parameters, headers or body and it is replaced with the value below when you send.</p>
        <section>
          <h4>Shared with everyone</h4>
          <p className="muted hint">Good for the server address. Everyone who can open this wiki can read these, so keep keys out of here.</p>
          <KVEditor rows={a} editable={canEdit} k="name" v="value" onChange={(r) => { setA(r); onShared(toVars(r)) }} />
        </section>
        <section>
          <h4>Only in this browser</h4>
          <p className="muted hint">For your own API key or token. It is saved on this device, never in the wiki, and wins over a shared variable with the same name.</p>
          <KVEditor rows={b} editable k="name" v="value" onChange={(r) => { setB(r); onMine(toVars(r)) }} />
        </section>
        <div className="modal-actions"><span /><button className="btn btn-pill btn-primary" onClick={onClose}>Done</button></div>
      </div>
    </Modal>
  )
}

// ── an old version ────────────────────────────────────────────────────────────

/** Read-only view of an earlier version: its own contents list and pages, with a restore bar. */
function WikiPreview({ live, docId, version, onRestore, onClose }: { live: Y.Doc; docId: string; version: Version; onRestore: (snap: Y.Doc, v: Version) => Promise<void>; onClose: () => void }) {
  const [snap, setSnap] = useState<Y.Doc | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [diff, setDiff] = useState(false)
  const [pick, setPick] = useState<string | null>(null)
  useEffect(() => {
    let dead = false; setSnap(null); setErr(''); setPick(null)
    api.versionData(docId, version.id).then((buf) => { if (dead) return; const d = new Y.Doc(); Y.applyUpdate(d, buf); setSnap(d) }).catch((e) => setErr(e.message || 'Could not load this version'))
    return () => { dead = true }
  }, [docId, version.id])
  const tree = useMemo<Tree>(() => (snap ? (snap.getMap('tree').toJSON() as Tree) : {}), [snap])
  const pages = useMemo(() => reading(tree), [tree])
  const cur = pick && tree[pick] ? pick : pages[0] ?? null
  return (
    <div className="wiki-preview">
      <div className="ver-bar">
        <div className="ver-bar-text"><b>{version.label ?? 'Earlier version'}</b><span>{fullLabel(version.created_at)}{version.authors.length ? ` · ${version.authors.join(', ')}` : ''}</span></div>
        <div className="ver-bar-actions">
          <DiffToggle on={diff} onClick={() => setDiff((d) => !d)} />
          <button className="btn btn-ghost btn-pill btn-sm" onClick={onClose}>Back to current</button>
          <button className="btn btn-primary btn-pill btn-sm" disabled={!snap || busy} onClick={async () => { if (!snap) return; setBusy(true); try { await onRestore(snap, version) } finally { setBusy(false) } }}>
            {busy ? <Loader2 size={14} className="spin" /> : <RotateCcw size={14} />}Restore this version
          </button>
        </div>
      </div>
      {err ? <p className="side-empty ver-err">{err}</p> : diff ? <VersionDiff docId={docId} kind="wiki" version={version} live={live} snap={snap} /> : !snap ? <div className="splash small"><span className="spinner" /></div> : (
        <div className="wiki-preview-body">
          <nav className="wiki-preview-nav" aria-label="Pages in this version">
            {pages.map((id) => <button key={id} className={id === cur ? 'on' : ''} onClick={() => setPick(id)}>{tree[id].method && <MethodBadge method={tree[id].method!} />}<span>{tree[id].title || 'Untitled'}</span></button>)}
            {!pages.length && <p className="side-empty">This version had no pages.</p>}
          </nav>
          {cur && <PreviewPage key={cur} snap={snap} id={cur} title={tree[cur].title} />}
        </div>)}
    </div>
  )
}

function PreviewPage({ snap, id, title }: { snap: Y.Doc; id: string; title: string }) {
  const editor = useEditor({
    editable: false, editorProps: { attributes: { spellcheck: 'false', class: 'koko-prose' } },
    extensions: [...baseExtensions(), ApiRequest, WikiBadge, WikiTabs, WikiTab, Collaboration.configure({ document: snap, field: 'p:' + id })],
  }, [snap, id])
  return <article className="wiki-page wiki-preview-page"><h1 className="wiki-title static">{title || 'Untitled'}</h1><EditorContent editor={editor} /></article>
}

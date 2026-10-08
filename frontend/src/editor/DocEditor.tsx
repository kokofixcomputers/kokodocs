import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror'
import { openSettings } from '../ui/settingsStore'
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import * as Y from 'yjs'
import { EditorContent, useEditor } from '@tiptap/react'
import Placeholder from '@tiptap/extension-placeholder'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import { Cloud, CloudOff, History, LogIn, X, MessageSquare, Moon, PanelLeft, Share2, Sparkles, SpellCheck, Sun, Loader2 } from 'lucide-react'
import { api, ApiError, type DocInfo, type Version } from '../api'
import { useAuth } from '../auth'
const AssistantHost = lazy(() => import('../assistant/AssistantHost'))
import { KokoProvider } from '../collab'
import { loadFont } from '../fonts'
import { useTheme } from '../theme'
import { Avatar } from '../ui/Avatar'
import { Logo } from '../ui/Logo'
import { Popover } from '../ui/Popover'
import { toast } from '../ui/Toast'
import { SlashCommand, SlashMenu } from './SlashMenu'
import { FindBar } from './FindBar'
import { FindReplace } from './FindReplace'
import { CalloutMenu, CommentMenu, ImageMenu, ShapeMenu, TableMenu } from './BubbleMenus'
import { CommentMark } from './CommentMark'
import { CommentsPanel, useComments, type Draft } from './Comments'
import { PageSetupDialog } from './PageSetupDialog'
import { HeaderFooterDialog } from './HeaderFooterDialog'
import { Outline } from './Outline'
import { DEFAULT_META, PAGE_SIZES, Pagination, geometry, pagesKey, readPageMeta, sheetVars, type PageMeta } from './Pagination'
import { takePending, takePrompt } from '../import/pending'
import { AiFlash } from '../assistant/flash'
import { ProofMenu, ProofreadMarks, ProofreadPanel, useProofread } from './Proofread'
import { ImageUpload } from './ResizableImage'
import { DocExportMenu } from '../export/ExportMenu'
import { useVoiceTyping } from '../voice/useVoiceTyping'
import { VoicePill } from '../voice/VoicePill'
import { VoiceFab } from '../voice/VoiceControl'
import { LinkHover } from './LinkHover'
import { DocContextMenu } from './TextContextMenu'
import { StatsPill } from './StatsPill'
import { PasteChecklists } from './PasteChecklists'
import { baseExtensions } from './extensions'
import { ScrollAnchor } from './ScrollAnchor'
import { VersionHistory, VersionPreview, fullLabel } from './VersionHistory'
import { ShareDialog } from './ShareDialog'
import { Toolbar } from './Toolbar'

const ANIMALS = ['Otter', 'Fox', 'Koala', 'Panda', 'Heron', 'Lynx', 'Gecko', 'Falcon', 'Narwhal', 'Quokka']
const COLORS = ['#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#8b5cf6', '#ef4444', '#0ea5e9', '#22c55e', '#f97316', '#d946ef']

export function guestIdentity() {
  try {
    const s = sessionStorage.getItem('koko.guest')
    if (s) return JSON.parse(s) as { name: string; color: string }
  } catch { /* ignore */ }
  const g = { name: `Guest ${ANIMALS[Math.floor(Math.random() * ANIMALS.length)]}`, color: COLORS[Math.floor(Math.random() * COLORS.length)] }
  try { sessionStorage.setItem('koko.guest', JSON.stringify(g)) } catch { /* ignore */ }
  return g
}

export function usePresence(provider: KokoProvider) {
  const [list, setList] = useState<{ id: number; name: string; color: string }[]>([])
  useEffect(() => {
    const f = () => {
      const out: { id: number; name: string; color: string }[] = []
      provider.awareness.getStates().forEach((s, id) => { if (id !== provider.doc.clientID && s.user) out.push({ id, ...(s.user as any) }) })
      setList(out)
    }
    provider.awareness.on('change', f); f()
    return () => provider.awareness.off('change', f)
  }, [provider])
  return list
}

export function useProviderStatus(p: KokoProvider) {
  const [, force] = useState(0)
  useEffect(() => p.subscribe(() => force((n) => n + 1)), [p])
  return { status: p.status, synced: p.synced }
}

export function DocEditor({ info }: { info: DocInfo }) {
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
  return <Inner info={info} ydoc={ydoc} provider={provider} identity={identity} readOnly={readOnly}
    theme={theme} toggleTheme={toggle} user={user} logout={logout} />
}

interface InnerProps {
  info: DocInfo; ydoc: Y.Doc; provider: KokoProvider; identity: { name: string; color: string }; readOnly: boolean
  theme: string; toggleTheme: () => void; user: ReturnType<typeof useAuth>['user']; logout: () => void
}

function Inner({ info, ydoc, provider, identity, readOnly, theme, toggleTheme, user, logout }: InnerProps) {
  const ymeta = useMemo(() => ydoc.getMap('meta'), [ydoc])
  const metaRef = useRef<PageMeta>(DEFAULT_META)
  const [meta, setMeta] = useState<PageMeta>(DEFAULT_META)
  const [title, setTitle] = useState(info.title)
  const [leftOpen, setLeftOpen] = useState(() => window.innerWidth > 1100)
  const [initialPrompt] = useState(() => takePrompt(info.id))
  const [panel, setPanel] = useState<'none' | 'proof' | 'history' | 'assistant' | 'comments'>(initialPrompt ? 'assistant' : 'none')
  const [preview, setPreview] = useState<Version | null>(null)
  const [verKey, setVerKey] = useState(0)
  const [share, setShare] = useState(false)
  const [hf, setHf] = useState(false)
  const [setup, setSetup] = useState(false)
  const [find, setFindOpen] = useState<{ replace: boolean; n: number } | null>(null)
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
      const key = e.key.toLowerCase()
      if (key !== 'f' && key !== 'h') return
      const t = e.target as HTMLElement | null
      if (t && t.closest('input, textarea, [contenteditable="true"]') && !t.closest('.ProseMirror') && !t.closest('.find-bar')) return
      e.preventDefault()
      setFindOpen((o) => ({ replace: key === 'h' || (o?.replace ?? false), n: (o?.n ?? 0) + 1 }))
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])
  const { status, synced } = useProviderStatus(provider)
  const people = usePresence(provider)
  const canvas = useRef<HTMLDivElement>(null)

  const upload = useCallback((f: File) => api.uploadImage(info.id, f), [info.id])

  // Keep these referentially stable: tiptap compares them on every render and re-configures the editor (resetting
  // plugin state and dropping in-flight input) whenever they differ.
  const extensions = useMemo(() => [
      ...baseExtensions(),
      ImageUpload.configure({ upload, importUrl: (u: string) => api.importImage(info.id, u) }),
      PasteChecklists,
      Placeholder.configure({ placeholder: 'Start writing, or drop an image here' }),
      Collaboration.configure({ document: ydoc }),
      CollaborationCursor.configure({
        provider, user: identity,
        render: (u: { name: string; color: string }) => {
          const c = document.createElement('span')
          c.className = 'collab-caret'
          c.style.borderColor = u.color
          const l = document.createElement('div')
          l.className = 'collab-label'
          l.style.background = u.color
          l.textContent = u.name
          c.appendChild(l)
          return c
        },
      }),
      Pagination.configure({ getMeta: () => metaRef.current }),
      ScrollAnchor,
      ProofreadMarks,
      AiFlash,
      FindReplace,
      SlashCommand,
      CommentMark,
    ], [provider, identity, ydoc, upload])
  const editorProps = useMemo(() => ({ attributes: { spellcheck: 'false', class: 'koko-prose' } }), [])
  const editor = useEditor({ editable: !readOnly, editorProps, extensions }, [])

  // a file imported from the documents screen fills this (empty) document once it has synced
  useEffect(() => {
    if (!synced || !editor || readOnly) return
    const p = takePending(info.id, 'doc')
    if (p) { p.apply(editor); toast('Imported ' + p.title) }
  }, [synced, editor, readOnly, info.id])

  const [zoom, setZoom] = useState(1)
  const G = geometry(meta)
  const widthRef = useRef(G.width); widthRef.current = G.width
  // browser print (Ctrl+P / Print button) follows the page setup
  useEffect(() => {
    const el = document.createElement('style')
    el.textContent = `@page { size: ${PAGE_SIZES[meta.size]?.css ?? 'letter'} ${meta.orientation}; margin: ${meta.mt}px ${meta.mr}px ${meta.mb}px ${meta.ml}px; }`
    document.head.appendChild(el)
    return () => el.remove()
  }, [meta.size, meta.orientation, meta.mt, meta.mr, meta.mb, meta.ml])
  const [narrow, setNarrow] = useState(false)   // phones: let the page reflow to the screen instead of shrinking a full-size page
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const phone = el.clientWidth < 640
      setNarrow(phone)
      setZoom(phone ? 1 : Math.min(1, Math.max(0.35, (el.clientWidth - 48) / widthRef.current)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [editor, G.width])

  // header/footer + title live in the shared doc so everyone sees the same thing
  useEffect(() => {
    const f = () => {
      metaRef.current = readPageMeta(ymeta)
      setMeta(metaRef.current)
      const t = ymeta.get('title')
      if (typeof t === 'string') setTitle(t)
      if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(pagesKey, { refresh: true }).setMeta('addToHistory', false))
    }
    ymeta.observe(f); f()
    return () => ymeta.unobserve(f)
  }, [ymeta, editor])

  // load every Google font used in the document (including ones other people applied)
  useEffect(() => {
    if (!editor) return
    let t: number
    const scan = () => {
      const seen = new Set<string>()
      editor.state.doc.descendants((n) => {
        n.marks.forEach((m) => { if (m.type.name === 'textStyle' && m.attrs.fontFamily) seen.add(m.attrs.fontFamily) })
      })
      seen.forEach(loadFont)
    }
    const deb = () => { window.clearTimeout(t); t = window.setTimeout(scan, 250) }
    editor.on('update', deb); scan()
    return () => { window.clearTimeout(t); editor.off('update', deb) }
  }, [editor])

  useEffect(() => {
    const open = () => !readOnly && setHf(true)
    window.addEventListener('koko:edit-header-footer', open)
    return () => window.removeEventListener('koko:edit-header-footer', open)
  }, [readOnly])

  useEffect(() => {
    const changed = () => { toast('Your access to this document changed'); setTimeout(() => location.reload(), 900) }
    window.addEventListener('koko:access-changed', changed)
    return () => window.removeEventListener('koko:access-changed', changed)
  }, [])

  useEffect(() => {
    if (!editor || !readOnly) return
    const dom = editor.view.dom
    const click = (e: Event) => {
      if ((e.target as HTMLElement).matches?.('input[type="checkbox"]')) toast('This document is view only. Ask the owner for edit access.')
    }
    dom.addEventListener('click', click)
    return () => dom.removeEventListener('click', click)
  }, [editor, readOnly])

  const proof = useProofread(editor)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [activeComment, setActiveComment] = useState<string | null>(null)
  const comments = useComments(info.id, !!user)
  const openThreads = comments.list.filter((c) => !c.parent_id && !c.resolved).length
  // a link from a notification or email (/d/<id>?comment=<id>) opens the comments panel on that thread
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('comment'); if (!id || !comments.list.length) return
    const c = comments.list.find((x) => x.id === id); if (!c) return
    setActiveComment(c.parent_id ?? c.id); setPanel('comments'); history.replaceState(null, '', location.pathname)
  }, [comments.list])
  const startComment = () => {
    if (!editor || editor.state.selection.empty) { toast('Select some text to comment on'); return }
    const { from, to } = editor.state.selection
    const id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
    const quote = editor.state.doc.textBetween(from, to, ' ', ' ').slice(0, 200)
    editor.chain().setMark('comment', { commentId: id }).run()
    setDraft({ id, quote }); setActiveComment(id); setPreview(null); setPanel('comments')
  }
  useEffect(() => {
    const dom = editor?.view.dom
    if (!dom) return
    const on = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest?.('.cmt[data-comment-id]') as HTMLElement | null
      if (el) { setActiveComment(el.dataset.commentId ?? null); setPanel((p) => (p === 'none' || p === 'proof' ? 'comments' : p)) }
    }
    dom.addEventListener('click', on); return () => dom.removeEventListener('click', on)
  }, [editor])
  const voice = useVoiceTyping({ editor, docId: info.id, enabled: !readOnly && !preview })

  const assistantDeps = {
    editor: editor!, getTitle: () => title, setTitle: (t: string) => onTitle(t), getMeta: () => metaRef.current,
    setMeta: (m: Partial<PageMeta>) => saveMeta({ ...metaRef.current, ...m }), canEdit: () => !readOnly,
  }

  const titleTimer = useRef<number | undefined>(undefined)
  const onTitle = (v: string) => {
    setTitle(v)
    ymeta.set('title', v)
    window.clearTimeout(titleTimer.current)
    titleTimer.current = window.setTimeout(() => {
      api.renameDoc(info.id, v).catch((e: ApiError) => toast(e.message))
    }, 600)
  }
  useEffect(() => { document.title = `${title || 'Untitled document'} - KokoDocs` }, [title])

  /** Replace the live content with an old version as an ordinary edit, so everyone connected sees it and nothing is lost. */
  const restoreVersion = async (snap: Y.Doc, v: Version) => {
    try { await api.createVersion(info.id, `Before restoring ${v.label ?? fullLabel(v.created_at)}`) }
    catch { /* an empty doc has nothing to back up */ }
    // go through the editor so the view updates immediately and Yjs syncs it like any other edit
    const json = yXmlFragmentToProsemirrorJSON(snap.getXmlFragment('default'))
    if (editor && !editor.isDestroyed) editor.chain().setMeta('addToHistory', false).setContent(json, true).run()
    else ydoc.transact(() => { const live = ydoc.getXmlFragment('default'); live.delete(0, live.length); live.insert(0, snap.getXmlFragment('default').toArray().map((n) => (n as Y.XmlElement).clone())) })
    ydoc.transact(() => {
      const lm = ydoc.getMap('meta'), om = snap.getMap('meta')
      ;(['header', 'footer', 'headerAlign', 'footerAlign'] as const).forEach((k) => (om.has(k) ? lm.set(k, om.get(k)) : lm.delete(k)))
    })
    setPreview(null); setVerKey((n) => n + 1)
    toast(`Restored ${v.label ?? fullLabel(v.created_at)}. The previous state is saved in version history.`)
  }

  const saveMeta = (m: PageMeta) => ydoc.transact(() => { (Object.keys(m) as (keyof PageMeta)[]).forEach((k) => ymeta.set(k, m[k])) })

  const pagesCount = editor ? (pagesKey.getState(editor.state)?.breaks.length ?? 0) + 1 : 1

  const connLabel = status === 'connected' ? (readOnly ? 'View only' : 'Saved') : status === 'denied' ? 'No access' : status === 'offline' ? 'Offline' : 'Reconnecting'
  const ConnIcon = status === 'connected' ? Cloud : CloudOff

  if (import.meta.env.DEV && editor) (window as any).__koko = editor

  if (!editor) return <div className="splash"><span className="spinner" /></div>

  return (
    <div className="editor-shell">
      <header className="ed-top">
        <div className="ed-left">
          <button className={`icon-btn ${leftOpen ? 'active' : ''}`} onClick={() => setLeftOpen((o) => !o)} aria-label="Toggle document tabs" title="Document tabs"><PanelLeft size={19} /></button>
          {user ? <Link to="/" className="logo-link" title="All documents"><Logo size={32} /></Link> : <span className="logo-link"><Logo size={32} /></span>}
          <input className="title-input" value={title} readOnly={readOnly} onChange={(e) => onTitle(e.target.value)}
            placeholder="Untitled document" aria-label="Document title" maxLength={200} />
          <span className={`status-pill ${status}`}><ConnIcon size={14} /><span className="lbl">{connLabel}</span></span>
        </div>
        <div className="ed-right">
          <div className="presence">
            {people.slice(0, 5).map((p) => <Avatar key={p.id} name={p.name} color={p.color} size={32} ring />)}
            {people.length > 5 && <span className="more" data-tip={people.slice(5).map((x) => x.name).join(', ')}>+{people.length - 5}</span>}
          </div>
          <DocExportMenu editor={editor} title={title} meta={meta} />
          {!readOnly && (
            <button className={`icon-btn ${panel === 'history' ? 'active' : ''}`} title="Version history" aria-label="Version history"
              onClick={() => { setPreview(null); setPanel((p) => (p === 'history' ? 'none' : 'history')) }}><History size={19} /></button>
          )}
          {user && !preview && (
            <button className={`icon-btn comments-btn ${panel === 'comments' ? 'active' : ''}`} title="Comments" aria-label="Comments" onClick={() => setPanel((p) => (p === 'comments' ? 'none' : 'comments'))}>
              <MessageSquare size={19} />{openThreads > 0 && <b className="badge">{openThreads}</b>}
            </button>
          )}
          {user && !preview && (
            <button className={`btn btn-pill btn-soft ${panel === 'assistant' ? 'active' : ''}`} onClick={() => setPanel((p) => (p === 'assistant' ? 'none' : 'assistant'))}><Sparkles size={17} /><span className="lbl">Assistant</span></button>
          )}
          <button className={`btn btn-pill btn-soft proof-btn ${panel === 'proof' ? 'active' : ''}`} onClick={() => { setPreview(null); setPanel((p) => (p === 'proof' ? 'none' : 'proof')) }}>
            <SpellCheck size={17} /><span className="lbl">Proofread</span>
            {proof.issues.length > 0 && <b className="badge">{proof.issues.length}</b>}
          </button>
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
          ) : (
            <Link className="btn btn-pill btn-ghost" to="/login" state={{ from: `/d/${info.id}` }}><LogIn size={16} />Sign in</Link>
          )}
        </div>
      </header>

      <div className="ed-toolbar-wrap"><Toolbar voice={voice} editor={editor} onImage={(f) => upload(f).then((src) => editor.chain().focus().setImage({ src, width: 360 } as any).run()).catch((e) => toast(e.message))} onHeaderFooter={() => setHf(true)} onPageSetup={() => setSetup(true)} onFind={() => setFindOpen((o) => ({ replace: o?.replace ?? false, n: (o?.n ?? 0) + 1 }))} /></div>

      <div className="ed-body">
        {find && editor && !preview && <FindBar key={find.n} editor={editor} withReplace={find.replace} onClose={() => setFindOpen(null)} />}
        <aside className={`side left ${leftOpen ? 'open' : ''}`}><div className="side-inner"><Outline editor={editor} /></div></aside>

        <div className="canvas" ref={canvas}>
          {!synced && status !== 'denied' && <div className="sync-banner"><Loader2 size={15} className="spin" />Loading document</div>}
          {preview && <VersionPreview live={ydoc} docId={info.id} version={preview} zoom={zoom} narrow={narrow} onRestore={restoreVersion} onClose={() => setPreview(null)} />}
          <div className={`sheet ${readOnly ? 'is-readonly' : ''}`} hidden={!!preview} style={narrow ? { width: '100%', ['--pad-l' as string]: '18px', ['--pad-r' as string]: '18px', ['--bleed' as string]: '10px' } : { width: G.width, zoom, ...sheetVars(G) }}>
            <EditorContent editor={editor} />
          </div>
          <div className="canvas-foot" />
        </div>

        <aside className={`side right ${panel === 'assistant' ? 'wide' : ''} ${panel !== 'none' ? 'open' : ''}`}>
          <button className="side-close" aria-label="Close panel" onClick={() => setPanel('none')}><X size={18} /></button>
          <div className="side-inner">
            {panel === 'assistant' && user && editor
              ? <Suspense fallback={null}><AssistantHost docId={info.id} user={user} initialPrompt={initialPrompt} onClose={() => setPanel('none')} source={{ kind: 'doc', deps: assistantDeps }} /></Suspense>
              : panel === 'comments' && user && editor
              ? <CommentsPanel editor={editor} docId={info.id} user={user} list={comments.list} refresh={comments.refresh} draft={draft} onDraft={setDraft} activeId={activeComment} setActiveId={setActiveComment} />
              : panel === 'history'
              ? <VersionHistory docId={info.id} open selected={preview} refreshKey={verKey} onSelect={(v) => { setPreview(v); if (narrow) setPanel('none') }} />
              : <ProofreadPanel editor={editor} state={proof} />}
          </div>
        </aside>
      </div>

      <StatsPill editor={editor} pages={pagesCount} editing={people.length} />

      <ProofMenu editor={editor} state={proof} />
      {editor && !preview && <DocContextMenu editor={editor} issues={proof.issues} recheck={proof.recheck} ignore={proof.ignore} onComment={user ? startComment : undefined} onFind={() => setFindOpen((o) => ({ replace: o?.replace ?? false, n: (o?.n ?? 0) + 1 }))} />}
      <VoicePill voice={voice} />
      <VoiceFab voice={voice} editable={!readOnly && !preview} />
      {editor && !preview && <LinkHover editor={editor} />}
      <SlashMenu />
      <TableMenu editor={editor} />
      <CalloutMenu editor={editor} />
      {user && <CommentMenu editor={editor} onComment={startComment} />}
      <ImageMenu editor={editor} /><ShapeMenu editor={editor} />
      {share && <ShareDialog info={info} onClose={() => setShare(false)} />}
      {setup && <PageSetupDialog meta={meta} onSave={saveMeta} onClose={() => setSetup(false)} />}
      {hf && <HeaderFooterDialog meta={meta} onSave={saveMeta} onClose={() => setHf(false)} />}
    </div>
  )
}

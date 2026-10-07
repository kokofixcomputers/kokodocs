import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Ban, ChevronDown, ChevronRight, FileText, Folder as FolderIcon, FolderInput, FolderPlus, Globe, Home, KeyRound, Lock, LogOut, Moon,
  ArrowDownWideNarrow, ArrowUpNarrowWide, ClipboardList, Copy, ExternalLink, FolderOpen, ListFilter, MoreHorizontal, Tag as TagIcon, Pencil, Plus, RotateCcw, Presentation, Search, Star, Upload, LayoutTemplate, Share2, ShieldCheck, Sun, Table2, Trash2, Users,
  Settings, BookOpen,
} from 'lucide-react'
import { api, type DocInfo, type DocKind, type DocSummary, type Folder, type SharedFolder, type SharedFolderView } from '../api'
import { useAuth } from '../auth'
import { useTheme } from '../theme'
import { Avatar } from '../ui/Avatar'
import { askConfirm, askText } from '../ui/Dialogs'
import { ACCEPT, importKind, parseImport } from '../import'
import { setPending, setPrompt } from '../import/pending'
import { FEATURED, TEMPLATES, type Template, type TemplateKind } from '../templates/catalog'
import { TemplateCard, TemplateGallery } from '../templates/Gallery'
import { HitRow, useContentSearch } from '../ui/Search'
import { NotificationsBell } from '../ui/NotificationsBell'
import { StorageMeter } from '../ui/StorageMeter'
import { openSettings } from '../ui/settingsStore'
import { KindIcon } from '../ui/KindIcon'
import { Logo } from '../ui/Logo'
import { Modal } from '../ui/Modal'
import { Popover } from '../ui/Popover'
import { FolderShareDialog } from './FolderShareDialog'
import { toast } from '../ui/Toast'
import { ShareDialog } from '../editor/ShareDialog'
import { useContextMenu, type CtxItem } from '../ui/ContextMenu'
import { RowTags, TagChip } from '../ui/tags'
import { TagDialog, TagManager, type TagCount } from './TagDialogs'

const ago = (t: number) => {
  const s = Date.now() / 1000 - t
  if (s < 60) return 'Just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`
  return new Date(t * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
const ACCESS = {
  restricted: { icon: Lock, label: 'Restricted' },
  anyone: { icon: Globe, label: 'Anyone with link' },
  password: { icon: KeyRound, label: 'Password' },
} as const

type Tab = 'mine' | 'shared' | 'starred' | 'bin'

/** Folder picker used by "Move to…". `blocked` ids (a folder and its children) can't be chosen. */
function MoveDialog({ title, folders, current, blocked, onPick, onClose }: {
  title: string; folders: Folder[]; current: string | null; blocked: Set<string>; onPick: (id: string | null) => void; onClose: () => void
}) {
  const rows: { id: string | null; name: string; depth: number }[] = [{ id: null, name: 'My documents', depth: 0 }]
  const walk = (parent: string | null, depth: number) =>
    folders.filter((f) => f.parent_id === parent).forEach((f) => { rows.push({ id: f.id, name: f.name, depth }); walk(f.id, depth + 1) })
  walk(null, 1)
  return (
    <Modal title={title} onClose={onClose} width={420}>
      <div className="share-body">
        <div className="move-list">
          {rows.map((r) => {
            const off = r.id !== null && blocked.has(r.id)
            return (
              <button key={r.id ?? 'root'} className={`move-row ${r.id === current ? 'on' : ''}`} disabled={off || r.id === current}
                style={{ paddingLeft: 12 + r.depth * 18 }} onClick={() => onPick(r.id)}>
                {r.id === null ? <Home size={17} /> : <FolderIcon size={17} />}<span>{r.name}</span>
                {r.id === current && <em>current</em>}
              </button>
            )
          })}
        </div>
      </div>
    </Modal>
  )
}

const FOLDER_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280']

export function Dashboard() {
  const { user, logout } = useAuth()
  const { theme, toggle } = useTheme()
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const folderId = params.get('folder')
  const sf = params.get('sf') // folder opened inside "Shared with me"
  useEffect(() => {
    const g = new URLSearchParams(location.search).get('google')
    if (!g) return
    history.replaceState(null, '', location.pathname)
    toast(g === 'linked' ? 'Google account linked' : g)
    openSettings('security')
  }, [])
  const [docs, setDocs] = useState<{ mine: DocSummary[]; shared: DocSummary[] } | null>(null)
  const [folders, setFolders] = useState<Folder[]>([])
  const [trash, setTrash] = useState<{ purge_days: number; docs: DocSummary[] } | null>(null)
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<Tab>(params.get('sf') ? 'shared' : 'mine')
  const [sharedRoots, setSharedRoots] = useState<SharedFolder[] | null>(null)
  const [sharedView, setSharedView] = useState<SharedFolderView | null>(null)
  const [shareFolder, setShareFolder] = useState<Folder | null>(null)
  const [move, setMove] = useState<{ kind: 'doc' | 'folder'; id: string } | null>(null)
  const [dropTarget, setDropTarget] = useState<string | 'root' | null>(null)

  const load = useCallback(async () => {
    try {
      const [d, f] = await Promise.all([api.listDocs(), api.listFolders()])
      setDocs(d); setFolders(f)
      if (folderId && !f.some((x) => x.id === folderId)) setParams({}, { replace: true })
    } catch (e) { toast((e as Error).message) }
  }, [folderId, setParams])
  const loadTrash = useCallback(() => api.listTrash().then(setTrash).catch((e) => toast(e.message)), [])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (tab === 'bin') loadTrash() }, [tab, loadTrash])
  useEffect(() => { if (sf) setTab('shared') }, [sf])
  useEffect(() => {
    if (tab !== 'shared') return
    api.listSharedFolders().then(setSharedRoots).catch((e) => toast(e.message))
  }, [tab])
  useEffect(() => {
    if (tab !== 'shared' || !sf) { setSharedView(null); return }
    api.openSharedFolder(sf).then(setSharedView).catch(() => { toast('That folder is no longer shared with you'); setParams({}) })
  }, [tab, sf, setParams])

  const byId = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders])
  const crumbs = useMemo(() => {
    const out: Folder[] = []
    for (let f = folderId ? byId.get(folderId) : undefined; f; f = f.parent_id ? byId.get(f.parent_id) : undefined) out.unshift(f)
    return out
  }, [folderId, byId])
  const childCount = (id: string) => folders.filter((f) => f.parent_id === id).length + (docs?.mine.filter((d) => d.folder_id === id).length ?? 0)
  const descendantsOf = (id: string) => {
    const out = new Set([id]); let grew = true
    while (grew) { grew = false; folders.forEach((f) => { if (f.parent_id && out.has(f.parent_id) && !out.has(f.id)) { out.add(f.id); grew = true } }) }
    return out
  }

  const searching = q.trim() !== '' && tab !== 'bin'
  const { hits: contentHits } = useContentSearch(q, searching)
  const needle = q.toLowerCase()
  const visibleFolders = tab === 'mine' && !searching ? folders.filter((f) => f.parent_id === folderId) : []
  const visibleDocs = useMemo(() => {
    const src = tab === 'mine' ? (docs?.mine ?? []).filter((d) => searching || d.folder_id === folderId)
      : tab === 'starred' ? [...(docs?.mine ?? []), ...(docs?.shared ?? [])].filter((d) => d.starred)
      : sf ? (sharedView?.docs ?? []) : (docs?.shared ?? [])
    return src.filter((d) => d.title.toLowerCase().includes(needle))
  }, [docs, tab, folderId, searching, needle, sf, sharedView])
  const sharedFolders = tab === 'shared'
    ? (sf ? (sharedView?.folders ?? []).map((f) => ({ ...f, role: sharedView!.role, owner: sharedView!.owner })) : (sharedRoots ?? []))
      .filter((f) => f.name.toLowerCase().includes(needle))
    : []

  // sorting, tag filter, and the "Tags" view with one collapsible section per tag
  type SortMode = 'newest' | 'oldest' | 'tags'
  const [sort, setSortRaw] = useState<SortMode>(() => { try { const v = localStorage.getItem('koko.sort'); return v === 'oldest' || v === 'tags' ? v : 'newest' } catch { return 'newest' } })
  const setSort = (m: SortMode) => { setSortRaw(m); try { localStorage.setItem('koko.sort', m) } catch { /* private mode */ } }
  const [collapsed, setCollapsed] = useState<Set<string>>(() => { try { return new Set<string>(JSON.parse(localStorage.getItem('koko.tagsCollapsed') ?? '[]')) } catch { return new Set<string>() } })
  const toggleSection = (k: string) => setCollapsed((cur) => { const n = new Set(cur); if (n.has(k)) n.delete(k); else n.add(k); try { localStorage.setItem('koko.tagsCollapsed', JSON.stringify([...n])) } catch { /* private mode */ } return n })
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [tagging, setTagging] = useState<{ kind: 'doc' | 'folder'; id: string; title: string; tags: string[] } | null>(null)
  const [managing, setManaging] = useState(false)
  const lc = (x: string) => x.toLowerCase()
  const tagOk = (tags?: string[]) => !tagFilter || !!tags?.some((t) => lc(t) === lc(tagFilter))
  const allTags: TagCount[] = useMemo(() => {
    const m = new Map<string, TagCount>()
    for (const t of [...(docs?.mine ?? []), ...(docs?.shared ?? []), ...folders].flatMap((x) => x.tags ?? [])) { const e = m.get(lc(t)); if (e) e.count++; else m.set(lc(t), { name: t, count: 1 }) }
    return [...m.values()].sort((a, b) => lc(a.name).localeCompare(lc(b.name)))
  }, [docs, folders])
  const dir = sort === 'oldest' ? 1 : -1   // newest first unless asked otherwise; "newest" means most recently changed
  const shownFolders = visibleFolders.filter((f) => tagOk(f.tags)).sort((a, b) => dir * (a.created_at - b.created_at))
  const shownDocs = visibleDocs.filter((d) => tagOk(d.tags)).sort((a, b) => dir * (a.updated_at - b.updated_at))
  const sections = useMemo(() => {
    if (sort !== 'tags') return null
    const map = new Map<string, { key: string; name: string; untagged: boolean; folders: Folder[]; docs: DocSummary[] }>()
    const into = (tags: string[] | undefined, put: (sec: { folders: Folder[]; docs: DocSummary[] }) => void) => {
      for (const t of tags?.length ? tags : ['']) {
        const key = t ? lc(t) : '__untagged'
        let sec = map.get(key); if (!sec) { sec = { key, name: t, untagged: !t, folders: [], docs: [] }; map.set(key, sec) }
        put(sec)
      }
    }
    shownFolders.forEach((f) => into(f.tags, (sec) => sec.folders.push(f)))
    shownDocs.forEach((d) => into(d.tags, (sec) => sec.docs.push(d)))
    return [...map.values()].sort((a, b) => (a.untagged ? 1 : b.untagged ? -1 : lc(a.name).localeCompare(lc(b.name))))
  }, [sort, shownFolders, shownDocs])   // eslint-disable-line react-hooks/exhaustive-deps
  const pickTag = (t: string) => setTagFilter((cur) => (cur && lc(cur) === lc(t) ? null : t))
  const saveTags = async (t: NonNullable<typeof tagging>, tags: string[]) => { await api.setTags(t.kind, t.id, tags); await load() }

  const open = (id: string | null) => setParams(id ? { folder: id } : {})
  const openShared = (id: string | null) => setParams(id ? { sf: id } : {})
  const switchTab = (t: Tab) => { setTab(t); if (params.toString()) setParams({}) }
  const [gallery, setGallery] = useState(false)
  const [recent, setRecent] = useState<DocSummary[]>([])
  useEffect(() => { api.recent().then(setRecent).catch(() => {}) }, [docs])
  const toggleStar = async (d: DocSummary) => {
    const on = !d.starred
    setDocs((cur) => cur && ({ mine: cur.mine.map((x) => (x.id === d.id ? { ...x, starred: on } : x)), shared: cur.shared.map((x) => (x.id === d.id ? { ...x, starred: on } : x)) }))
    try { await (on ? api.star(d.id) : api.unstar(d.id)) } catch (e) { toast((e as Error).message); load() }
  }
  const startFrom = async (kind: TemplateKind, t?: Template, prompt?: string) => {
    setGallery(false)
    try {
      const doc = await api.createDoc(undefined, tab === 'mine' ? folderId : null, kind)
      if (t) { const plan = t.make(); setPending(doc.id, plan); await api.renameDoc(doc.id, plan.title).catch(() => {}) }
      if (prompt) setPrompt(doc.id, `Create ${kind === 'doc' ? 'a document' : kind === 'sheet' ? 'a spreadsheet' : 'a presentation'} for this request, fully built with real, specific content: ${prompt}`)
      nav(`/d/${doc.id}`)
    } catch (e) { toast((e as Error).message) }
  }
  const importInput = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState<string | null>(null)
  /** Word, Excel, PowerPoint, CSV, Markdown, HTML and text files become a new file of the right kind. */
  const importFile = async (f: File) => {
    const kind = importKind(f)
    if (!kind) { toast('That file type isn’t supported. Try Word, Excel, PowerPoint, CSV, Markdown, HTML or text files.'); return }
    setImporting(f.name)
    let id: string | null = null
    try {
      id = (await api.createDoc(undefined, tab === 'mine' ? folderId : null, kind)).id
      const docId = id
      const plan = await parseImport(f, (img) => api.uploadImage(docId, img))
      setPending(id, plan)
      await api.renameDoc(id, plan.title.slice(0, 200)).catch(() => {})
      if (plan.note) toast(plan.note)
      nav(`/d/${id}`)
    } catch (e) {
      if (id) await api.deleteDoc(id).catch(() => {})
      toast((e as Error).message || 'Could not import that file')
    } finally { setImporting(null) }
  }
  const create = async (kind: DocKind = 'doc') => nav(`/d/${(await api.createDoc(undefined, tab === 'mine' ? folderId : null, kind)).id}`)
  const newFolder = async () => {
    const name = await askText({ title: 'New folder', placeholder: 'Folder name', label: 'Create' })
    if (name) { await api.createFolder(name, folderId).catch((e) => toast(e.message)); load() }
  }
  const renameDoc = async (d: DocSummary) => {
    const t = await askText({ title: 'Rename document', value: d.title })
    if (t) { await api.renameDoc(d.id, t); load() }
  }
  const setFolderColor = async (f: Folder, color: string | null) => {
    try {
      const r = await api.colorFolder(f.id, color)
      // an older backend silently ignores the field, so check it really stuck instead of failing quietly
      if ((r.color ?? null) !== color) toast("The server didn't save the colour. Make sure the backend is updated to the latest version.")
    } catch (e) { toast((e as Error).message || 'Could not change the colour') }
    load()
  }
  const renameFolder = async (f: Folder) => {
    const t = await askText({ title: 'Rename folder', value: f.name })
    if (t) { await api.renameFolder(f.id, t); load() }
  }
  const trashDoc = async (d: DocSummary) => {
    await api.deleteDoc(d.id); load(); toast(`“${d.title}” moved to the recycle bin`)
  }
  const deleteFolder = async (f: Folder) => {
    const n = childCount(f.id)
    if (!(await askConfirm({ title: `Delete “${f.name}”?`, danger: true, label: 'Delete folder',
      text: n ? `The folder and everything inside it will be removed. Documents inside go to the recycle bin, where you can restore them for ${trash?.purge_days ?? 30} days.` : 'This empty folder will be removed.' }))) return
    await api.deleteFolder(f.id); load()
  }
  const moveTo = async (target: string | null) => {
    if (!move) return
    try {
      if (move.kind === 'doc') await api.moveDoc(move.id, target); else await api.moveFolder(move.id, target)
      toast('Moved')
    } catch (e) { toast((e as Error).message) }
    setMove(null); load()
  }

  // right-click menus (and long-press on touch screens) for every row
  const ctx = useContextMenu()
  const [shareDoc, setShareDoc] = useState<DocInfo | null>(null)
  const shareDocument = async (d: DocSummary) => { try { setShareDoc(await api.getDoc(d.id)) } catch (e) { toast((e as Error).message) } }
  const copyLink = (d: DocSummary) => navigator.clipboard.writeText(`${location.origin}/d/${d.id}`).then(() => toast('Link copied'), () => toast(`${location.origin}/d/${d.id}`))
  const folderItems = (f: Folder): CtxItem[] => [
    { label: 'Open', icon: <FolderOpen size={16} />, onClick: () => open(f.id) },
    { label: 'Share…', icon: <Share2 size={16} />, onClick: () => setShareFolder(f) },
    { sep: true },
    { label: 'Rename', icon: <Pencil size={16} />, onClick: () => void renameFolder(f) },
    { label: 'Tags…', icon: <TagIcon size={16} />, onClick: () => setTagging({ kind: 'folder', id: f.id, title: f.name, tags: f.tags ?? [] }) },
    { colors: FOLDER_COLORS, current: f.color, onPick: (c) => void setFolderColor(f, c) },
    { label: 'Move to…', icon: <FolderInput size={16} />, onClick: () => setMove({ kind: 'folder', id: f.id }) },
    { sep: true },
    { label: 'Delete', icon: <Trash2 size={16} />, danger: true, onClick: () => void deleteFolder(f) },
  ]
  const docItems = (d: DocSummary): CtxItem[] => [
    { label: 'Open', icon: <FileText size={16} />, onClick: () => nav(`/d/${d.id}`) },
    { label: 'Open in a new tab', icon: <ExternalLink size={16} />, onClick: () => { window.open(`/d/${d.id}`, '_blank', 'noopener') } },
    { sep: true },
    { label: d.starred ? 'Remove star' : 'Star', icon: <Star size={16} fill={d.starred ? 'currentColor' : 'none'} />, onClick: () => void toggleStar(d) },
    { label: 'Tags…', icon: <TagIcon size={16} />, onClick: () => setTagging({ kind: 'doc', id: d.id, title: d.title, tags: d.tags ?? [] }) },
    { label: 'Copy link', icon: <Copy size={16} />, onClick: () => copyLink(d) },
    ...(d.role === 'manager' ? [{ label: 'Share…', icon: <Share2 size={16} />, onClick: () => void shareDocument(d) }] : []),
    ...(d.role === 'owner' ? [
      { label: 'Share…', icon: <Share2 size={16} />, onClick: () => void shareDocument(d) },
      { sep: true } as CtxItem,
      { label: 'Rename', icon: <Pencil size={16} />, onClick: () => void renameDoc(d) },
      { label: 'Move to…', icon: <FolderInput size={16} />, onClick: () => setMove({ kind: 'doc', id: d.id }) },
      { sep: true } as CtxItem,
      { label: 'Move to recycle bin', icon: <Trash2 size={16} />, danger: true, onClick: () => void trashDoc(d) },
    ] : []),
  ]
  const binItems = (d: DocSummary): CtxItem[] => [
    { label: 'Restore', icon: <RotateCcw size={16} />, onClick: () => void restore(d) },
    { sep: true },
    { label: 'Delete forever', icon: <Trash2 size={16} />, danger: true, onClick: () => void forever(d) },
  ]
  const spaceItems = (): CtxItem[] => (tab !== 'mine' || searching ? [] : [   // right-click on empty space in My documents
    { label: 'New document', icon: <FileText size={16} />, onClick: () => void create('doc') },
    { label: 'New spreadsheet', icon: <Table2 size={16} />, onClick: () => void create('sheet') },
    { label: 'New presentation', icon: <Presentation size={16} />, onClick: () => void create('slides') },
    { label: 'New form', icon: <ClipboardList size={16} />, onClick: () => void create('form') },
    { label: 'New wiki', icon: <BookOpen size={16} />, onClick: () => void create('wiki') },
    { sep: true },
    { label: 'New folder', icon: <FolderPlus size={16} />, onClick: () => void newFolder() },
  ])

  // drag & drop: documents and folders can be dropped on a folder row or a breadcrumb
  const onDrop = async (target: string | null, e: React.DragEvent) => {
    e.preventDefault(); setDropTarget(null)
    const raw = e.dataTransfer.getData('application/x-koko')
    if (!raw) return
    const item = JSON.parse(raw) as { kind: 'doc' | 'folder'; id: string }
    if (item.kind === 'folder' && (item.id === target || (target && descendantsOf(item.id).has(target)))) return
    try {
      if (item.kind === 'doc') await api.moveDoc(item.id, target); else await api.moveFolder(item.id, target)
      toast(target ? `Moved to “${byId.get(target)?.name}”` : 'Moved to My documents')
    } catch (err) { toast((err as Error).message) }
    load()
  }
  const dragProps = (kind: 'doc' | 'folder', id: string) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => { e.dataTransfer.setData('application/x-koko', JSON.stringify({ kind, id })); e.dataTransfer.effectAllowed = 'move' },
  })
  const dropProps = (target: string | null) => ({
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes('application/x-koko')) { e.preventDefault(); setDropTarget(target ?? 'root') } },
    onDragLeave: () => setDropTarget((t) => (t === (target ?? 'root') ? null : t)),
    onDrop: (e: React.DragEvent) => onDrop(target, e),
  })

  const restore = async (d: DocSummary) => { await api.restoreDoc(d.id); loadTrash(); load(); toast(`“${d.title}” restored`) }
  const forever = async (d: DocSummary) => {
    if (await askConfirm({ title: 'Delete forever?', text: `“${d.title}” and its version history will be permanently deleted. This can't be undone.`, danger: true, label: 'Delete forever' })) {
      await api.deleteForever(d.id); loadTrash()
    }
  }
  const emptyBin = async () => {
    if (await askConfirm({ title: 'Empty the recycle bin?', text: `All ${trash?.docs.length} documents in the bin will be permanently deleted.`, danger: true, label: 'Empty bin' })) {
      await api.emptyTrash(); loadTrash()
    }
  }
  const daysLeft = (d: DocSummary) => Math.max(0, Math.ceil(((d.deleted_at ?? 0) + (trash?.purge_days ?? 30) * 86400 - Date.now() / 1000) / 86400))

  const folderRow = (f: Folder, k = '') => (
<div key={k + f.id} className={`doc-row ${dropTarget === f.id ? 'drop' : ''}`} role="link" tabIndex={0} onClick={() => open(f.id)}
                onKeyDown={(e) => e.key === 'Enter' && open(f.id)} {...dragProps('folder', f.id)} {...dropProps(f.id)} {...ctx.bind(() => folderItems(f))}>
                <span className="doc-name"><i className="folder" style={f.color ? ({ '--fc': f.color } as React.CSSProperties) : undefined}><FolderIcon size={17} fill={f.color ? 'currentColor' : 'none'} fillOpacity={0.25} /></i><b>{f.name}</b><RowTags tags={f.tags} onPick={pickTag} /></span>
                <span className="muted">Me</span>
                <span className="muted doc-access">{f.link_access === 'anyone' ? <><Globe size={14} />Anyone with link</> : f.shared ? <><Users size={14} />Shared with {f.shared}</> : `${childCount(f.id)} item${childCount(f.id) === 1 ? '' : 's'}`}</span>
                <span className="muted">{ago(f.created_at)}</span>
                <span className="doc-menu" onClick={(e) => e.stopPropagation()}>
                  <Popover align="end" trigger={({ toggle }) => <button className="icon-btn sm" onClick={toggle} aria-label="More"><MoreHorizontal size={18} /></button>}>
                    {(close) => (
                      <div className="menu">
                        <button onClick={() => { close(); setShareFolder(f) }}><Share2 size={16} />Share…</button>
                        <button onClick={() => { close(); renameFolder(f) }}><Pencil size={16} />Rename</button>
                        <button onClick={() => { close(); setTagging({ kind: 'folder', id: f.id, title: f.name, tags: f.tags ?? [] }) }}><TagIcon size={16} />Tags…</button>
                        <div className="menu-colors" role="group" aria-label="Folder color">
                          {FOLDER_COLORS.map((c) => <button key={c} className={`swatch ${f.color === c ? 'on' : ''}`} style={{ background: c }} title="Color" aria-label={`Color ${c}`} onClick={() => { close(); void setFolderColor(f, c) }} />)}
                          <button className="swatch none" title="Default color" aria-label="Default color" onClick={() => { close(); void setFolderColor(f, null) }}><Ban size={12} /></button>
                        </div>
                        <button onClick={() => { close(); setMove({ kind: 'folder', id: f.id }) }}><FolderInput size={16} />Move to…</button>
                        <button className="danger" onClick={() => { close(); deleteFolder(f) }}><Trash2 size={16} />Delete</button>
                      </div>
                    )}
                  </Popover>
                </span>
              </div>
  )
  const sharedFolderRow = (f: (typeof sharedFolders)[number]) => (
<div key={'s' + f.id} className="doc-row" role="link" tabIndex={0} onClick={() => openShared(f.id)} onKeyDown={(e) => e.key === 'Enter' && openShared(f.id)}
                {...ctx.bind(() => [{ label: 'Open', icon: <FolderOpen size={16} />, onClick: () => openShared(f.id) }])}>
                <span className="doc-name"><i className="folder"><FolderIcon size={17} /></i><b>{f.name}</b></span>
                <span className="muted">{f.owner}</span>
                <span className="muted doc-access"><Users size={14} />{f.role === 'editor' ? 'Can edit' : 'View only'}</span>
                <span className="muted">{ago(f.created_at)}</span>
                <span />
              </div>
  )
  const docRow = (d: DocSummary, k = '') => {
    const A = ACCESS[d.link_access]
    const mine = d.role === 'owner'
    return (
              <div key={k + d.id} className="doc-row" role="link" tabIndex={0} onClick={() => nav(`/d/${d.id}`)}
                  onKeyDown={(e) => e.key === 'Enter' && nav(`/d/${d.id}`)} {...(mine && tab === 'mine' ? dragProps('doc', d.id) : {})} {...ctx.bind(() => docItems(d))}>
                  <span className="doc-name"><i className={`k-${d.kind}`}><KindIcon kind={d.kind} /></i><b>{d.title}</b><RowTags tags={d.tags} onPick={pickTag} />
                    <button className={`star-btn ${d.starred ? 'on' : ''}`} aria-label={d.starred ? 'Remove star' : 'Star'} title={d.starred ? 'Remove star' : 'Star'} onClick={(e) => { e.stopPropagation(); void toggleStar(d) }}><Star size={15} fill={d.starred ? 'currentColor' : 'none'} /></button>
                    {searching && d.folder_id && byId.get(d.folder_id) && <em className="in-folder"><FolderIcon size={12} />{byId.get(d.folder_id)!.name}</em>}
                  </span>
                  <span className="muted">{mine ? 'Me' : d.owner}</span>
                  <span className="muted doc-access"><A.icon size={14} />{A.label}</span>
                  <span className="muted">{ago(d.updated_at)}</span>
                  <span className="doc-menu" onClick={(e) => e.stopPropagation()}>
                    {mine && (
                      <Popover align="end" trigger={({ toggle }) => <button className="icon-btn sm" onClick={toggle} aria-label="More"><MoreHorizontal size={18} /></button>}>
                        {(close) => (
                          <div className="menu">
                            <button onClick={() => { close(); renameDoc(d) }}><Pencil size={16} />Rename</button>
                            <button onClick={() => { close(); setTagging({ kind: 'doc', id: d.id, title: d.title, tags: d.tags ?? [] }) }}><TagIcon size={16} />Tags…</button>
                            <button onClick={() => { close(); setMove({ kind: 'doc', id: d.id }) }}><FolderInput size={16} />Move to…</button>
                            <button className="danger" onClick={() => { close(); trashDoc(d) }}><Trash2 size={16} />Move to recycle bin</button>
                          </div>
                        )}
                      </Popover>
                    )}
                  </span>
                </div>
    )
  }
  const empty = tab === 'mine' ? shownFolders.length + shownDocs.length === 0 : tab === 'starred' ? shownDocs.length === 0 : tab === 'shared' ? sharedFolders.length + shownDocs.length === 0 : (trash?.docs.length ?? 0) === 0
  const loading = tab === 'bin' ? !trash : tab === 'starred' ? !docs : tab === 'shared' ? !docs || !sharedRoots || (!!sf && !sharedView) : !docs

  return (
    <div className="dash">
      <header className="dash-top">
        <div className="brand"><Logo size={30} /><span>KokoDocs</span></div>
        <label className="field search"><Search size={17} />
          <input placeholder="Search titles and text inside files" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div className="top-actions">
          <NotificationsBell />
          <button className="icon-btn" onClick={toggle} aria-label="Toggle theme">{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
          <Popover align="end" trigger={({ toggle }) => (
            <button className="avatar-btn" onClick={toggle}><Avatar name={user!.name} color={user!.color} size={34} /></button>)}>
            {(close) => (
              <div className="menu wide">
                <div className="menu-head"><strong>{user!.name}</strong><span>{user!.email}</span></div>
                <button onClick={() => { close(); openSettings() }}><Settings size={16} />Settings</button>
                {user!.is_admin && <Link to="/admin" className="menu-link" onClick={close}>Admin panel</Link>}
                <button onClick={() => { close(); logout() }}><LogOut size={16} />Sign out</button>
              </div>
            )}
          </Popover>
        </div>
      </header>

      <main className="dash-main" onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }} onDrop={(e) => { const f = e.dataTransfer.files?.[0]; if (f) { e.preventDefault(); void importFile(f) } }}>
        <input ref={importInput} type="file" accept={ACCEPT} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = '' }} />
        {importing && <div className="import-banner"><span className="spinner sm" style={{ borderColor: 'var(--accent-soft-2)', borderTopColor: 'var(--accent)' }} />Importing {importing}</div>}
        <div className="dash-storage"><StorageMeter refreshKey={docs} onClick={() => openSettings('storage')} /></div>
        <div className="dash-bar">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'mine'} className={tab === 'mine' ? 'on' : ''} onClick={() => switchTab('mine')}>My documents</button>
            <button role="tab" aria-selected={tab === 'shared'} className={tab === 'shared' ? 'on' : ''} onClick={() => switchTab('shared')}>
              Shared with me{docs && docs.shared.length > 0 ? <span className="count">{docs.shared.length}</span> : null}
            </button>
            <button role="tab" aria-selected={tab === 'starred'} className={tab === 'starred' ? 'on' : ''} onClick={() => switchTab('starred')}><Star size={15} />Starred</button>
            <button role="tab" aria-selected={tab === 'bin'} className={tab === 'bin' ? 'on' : ''} onClick={() => switchTab('bin')}>
              <Trash2 size={15} />Recycle bin{trash && trash.docs.length > 0 ? <span className="count">{trash.docs.length}</span> : null}
            </button>
          </div>
          {tab === 'mine' && (
            <div className="bar-actions">
              <button className="btn btn-ghost btn-pill" onClick={newFolder}><FolderPlus size={17} />New folder</button>
              <div className="split-btn">
                <button className="btn btn-primary btn-pill" onClick={() => create('doc')}><Plus size={18} />New document</button>
                <Popover align="end" trigger={({ toggle }) => <button className="btn btn-primary btn-pill split-caret" onClick={toggle} aria-label="More new options"><ChevronDown size={17} /></button>}>
                  {(close) => (
                    <div className="menu wide">
                      <button onClick={() => { close(); create('doc') }}><FileText size={17} />New document</button>
                      <button onClick={() => { close(); create('sheet') }}><Table2 size={17} />New spreadsheet</button>
                      <button onClick={() => { close(); create('slides') }}><Presentation size={17} />New presentation</button>
                      <button onClick={() => { close(); create('form') }}><ClipboardList size={17} />New form</button>
                      <button onClick={() => { close(); create('wiki') }}><BookOpen size={17} />New wiki</button>
                      <div className="menu-sep" />
                      <button onClick={() => { close(); setGallery(true) }}><LayoutTemplate size={17} />Browse templates…</button>
                      <button onClick={() => { close(); importInput.current?.click() }}><Upload size={17} />Import a file…</button>
                    </div>)}
                </Popover>
              </div>
            </div>
          )}
          {tab === 'bin' && trash && trash.docs.length > 0 && (
            <button className="btn btn-ghost btn-pill" onClick={emptyBin}><Trash2 size={16} />Empty bin</button>
          )}
        </div>

        {tab === 'mine' && !searching && !folderId && (
          <>
            <section className="home-sec" aria-label="Start something new">
              <h4>Start something new</h4>
              <div className="start-row">
                {FEATURED.map((id) => TEMPLATES.find((t) => t.id === id)!).map((t) => <TemplateCard key={t.id} t={t} onPick={() => void startFrom(t.kind, t)} />)}
                <button className="tpl-card more" onClick={() => setGallery(true)}><span className="tpl-blank" style={{ height: 92, width: 144, display: 'grid', placeItems: 'center', border: '1.5px dashed var(--line)', borderRadius: 10 }}><LayoutTemplate size={26} /></span><b>All templates</b><span>Documents, sheets, decks</span></button>
              </div>
            </section>
            {recent.length > 0 && (
              <section className="home-sec" aria-label="Recent">
                <h4>Recent</h4>
                <div className="start-row">
                  {recent.slice(0, 6).map((d) => (
                    <button key={d.id} className="recent-card" onClick={() => nav(`/d/${d.id}`)} {...ctx.bind(() => docItems(d))}>
                      <i className={`k-${d.kind}`}><KindIcon kind={d.kind} /></i><b>{d.title || 'Untitled'}</b><span>Opened {ago(d.opened_at ?? d.updated_at)}</span>
                    </button>))}
                </div>
              </section>)}
          </>
        )}
        {tab === 'mine' && !searching && (
          <nav className="crumbs" aria-label="Folder path">
            <button className={dropTarget === 'root' ? 'drop' : ''} onClick={() => open(null)} {...dropProps(null)}><Home size={15} />My documents</button>
            {crumbs.map((c) => (
              <span key={c.id} className="crumb-wrap"><ChevronRight size={15} />
                <button className={dropTarget === c.id ? 'drop' : ''} onClick={() => open(c.id)} {...dropProps(c.id)}>{c.name}</button>
              </span>
            ))}
          </nav>
        )}
        {tab === 'shared' && sf && sharedView && !searching && (
          <nav className="crumbs" aria-label="Folder path">
            <button onClick={() => openShared(null)}><Users size={15} />Shared with me</button>
            {sharedView.trail.map((c) => (
              <span key={c.id} className="crumb-wrap"><ChevronRight size={15} /><button onClick={() => openShared(c.id)}>{c.name}</button></span>
            ))}
            <span className="role-chip">{sharedView.role === 'viewer' ? 'View only' : 'Can edit'}</span>
          </nav>
        )}
        {tab === 'bin' && <p className="bin-note muted">Deleted documents stay here for {trash?.purge_days ?? 30} days, then are removed for good. People you shared them with lose access while they're in the bin.</p>}

        {!loading && tab !== 'bin' && docs && docs.mine.length + docs.shared.length + folders.length > 0 && (
          <div className="list-tools">
            <span className="seg" role="group" aria-label="Sort by">
              <button type="button" className={sort === 'newest' ? 'on' : ''} aria-pressed={sort === 'newest'} onClick={() => setSort('newest')}><ArrowDownWideNarrow size={14} />Newest</button>
              <button type="button" className={sort === 'oldest' ? 'on' : ''} aria-pressed={sort === 'oldest'} onClick={() => setSort('oldest')}><ArrowUpNarrowWide size={14} />Oldest</button>
              <button type="button" className={sort === 'tags' ? 'on' : ''} aria-pressed={sort === 'tags'} onClick={() => setSort('tags')}><TagIcon size={14} />Tags</button>
            </span>
            <span className="lt-spacer" />
            {tagFilter && <TagChip name={tagFilter} active onRemove={() => setTagFilter(null)} />}
            <Popover align="end" trigger={({ toggle }) => <button type="button" className="btn btn-pill btn-ghost btn-sm" onClick={toggle}><ListFilter size={14} />{tagFilter ? 'Change tag' : 'Filter by tag'}</button>}>
              {(close) => (
                <div className="menu tag-menu">
                  {allTags.length === 0 ? <p className="muted tag-menu-empty">No tags yet. Right-click a file or folder and choose Tags…</p> : allTags.map((t) => (
                    <button key={t.name} type="button" onClick={() => { close(); setTagFilter(t.name) }}><TagChip name={t.name} active={!!tagFilter && lc(tagFilter) === lc(t.name)} /><em className="ctx-hint">{t.count}</em></button>))}
                  {tagFilter && <button type="button" onClick={() => { close(); setTagFilter(null) }}>Show everything</button>}
                  <div className="menu-sep" />
                  <button type="button" onClick={() => { close(); setManaging(true) }}><TagIcon size={16} />Manage tags…</button>
                </div>)}
            </Popover>
          </div>
        )}
        {loading ? <div className="splash small"><span className="spinner" /></div> : empty ? (
          <div className="empty" {...ctx.bind(spaceItems)}>
            <p><b>{tagFilter ? `Nothing here is tagged “${tagFilter}”` : searching ? 'No documents match your search' : tab === 'mine' ? (folderId ? 'This folder is empty' : 'No documents yet')
              : tab === 'starred' ? 'No starred files yet' : tab === 'shared' ? 'Nothing has been shared with you' : 'The recycle bin is empty'}</b></p>
            <p className="muted">{searching ? 'Try a different search.' : tab === 'mine' ? 'Create a document or folder to get started.'
              : tab === 'starred' ? 'Click the star next to a file to keep it here for quick access.' : tab === 'shared' ? 'Documents shared with your email address will show up here.' : 'Documents you delete will appear here.'}</p>
          </div>
        ) : tab === 'bin' ? (
          <div className="doc-list">
            <div className="doc-row bin head"><span>Name</span><span>Deleted</span><span>Time left</span><span /></div>
            {trash!.docs.map((d) => (
              <div key={d.id} className="doc-row bin" {...ctx.bind(() => binItems(d))}>
                <span className="doc-name"><i className={`k-${d.kind}`}><KindIcon kind={d.kind} /></i><b>{d.title}</b></span>
                <span className="muted">{ago(d.deleted_at!)}</span>
                <span className="muted">{daysLeft(d)} days</span>
                <span className="doc-menu bin-actions">
                  <button className="btn btn-soft btn-pill btn-sm" onClick={() => restore(d)}><RotateCcw size={14} />Restore</button>
                  <button className="icon-btn sm" aria-label="Delete forever" title="Delete forever" onClick={() => forever(d)}><Trash2 size={16} /></button>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="doc-list" style={tab === 'mine' && !searching ? { minHeight: '46vh' } : undefined} {...ctx.bind(spaceItems)}>
            <div className="doc-row head"><span>Name</span><span>Owner</span><span>Access</span><span>Modified</span><span /></div>
            {sections ? (
              <>
                {sharedFolders.map(sharedFolderRow)}
                {sections.map((sec) => {
                  const n = sec.folders.length + sec.docs.length, shut = collapsed.has(sec.key)
                  return (
                    <section key={sec.key} className="tag-sec" aria-label={sec.untagged ? 'Untagged' : `Tag ${sec.name}`}>
                      <button type="button" className={`tag-sec-head ${shut ? 'shut' : ''}`} aria-expanded={!shut} onClick={() => toggleSection(sec.key)}>
                        <ChevronDown size={16} className="tag-chev" />{sec.untagged ? <b>Untagged</b> : <TagChip name={sec.name} />}<span className="muted">{n} {n === 1 ? 'item' : 'items'}</span>
                      </button>
                      {!shut && <>{sec.folders.map((f) => folderRow(f, sec.key + ':'))}{sec.docs.map((d) => docRow(d, sec.key + ':'))}</>}
                    </section>)
                })}
              </>
            ) : (
              <>{shownFolders.map((f) => folderRow(f))}{sharedFolders.map(sharedFolderRow)}{shownDocs.map((d) => docRow(d))}</>
            )}
          </div>
        )}
        {searching && contentHits && contentHits.some((h) => h.snippet) && (
          <section className="content-hits" aria-label="Matches inside files">
            <h4>Found inside files</h4>
            {contentHits.filter((h) => h.snippet).map((h) => <HitRow key={h.id} hit={h} onOpen={() => nav(`/d/${h.id}`)} />)}
          </section>
        )}
      </main>

      {gallery && <TemplateGallery onClose={() => setGallery(false)} onUse={(t) => void startFrom(t.kind, t)} onBlank={(k) => void startFrom(k)} onDescribe={(k, text) => void startFrom(k, undefined, text)} />}
      {ctx.node}
      {tagging && <TagDialog title={tagging.title} initial={tagging.tags} all={allTags} onSave={(tags) => saveTags(tagging, tags)} onClose={() => setTagging(null)} />}
      {managing && <TagManager tags={allTags} onChanged={() => void load()} onClose={() => setManaging(false)} />}
      {shareDoc && <ShareDialog info={shareDoc} onClose={() => { setShareDoc(null); load() }} />}
      {shareFolder && <FolderShareDialog folder={shareFolder} ownerName={user!.name} ownerEmail={user!.email} onClose={() => setShareFolder(null)} onSaved={load} />}
      {move && (
        <MoveDialog
          title={move.kind === 'doc' ? 'Move document to…' : 'Move folder to…'} folders={folders}
          current={move.kind === 'doc' ? (docs?.mine.find((d) => d.id === move.id)?.folder_id ?? null) : (byId.get(move.id)?.parent_id ?? null)}
          blocked={move.kind === 'folder' ? descendantsOf(move.id) : new Set()}
          onPick={moveTo} onClose={() => setMove(null)} />
      )}
    </div>
  )
}

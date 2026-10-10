import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import * as Y from 'yjs'
import { ClipboardCheck, ClipboardPaste, Copy, ExternalLink, CopyPlus, Download, Grid3x3, Magnet, History, Layers as LayersIcon, Loader2, LogIn, Maximize, Minus, Moon, Plus, RotateCcw, Share2, Sparkles, Sun, Trash2, X } from 'lucide-react'
import { api, type ApiError, type DocInfo, type Version } from '../api'
import { useAuth } from '../auth'
import { KokoProvider } from '../collab'
import { ShareDialog } from '../editor/ShareDialog'
import { fullLabel, VersionHistory } from '../editor/VersionHistory'
import { EncryptionBadge } from '../zk/EncryptionBadge'
import { openSettings } from '../ui/settingsStore'
import { useContextMenu, type CtxItem } from '../ui/ContextMenu'
import { useTheme } from '../theme'
import { Avatar } from '../ui/Avatar'
import { Logo } from '../ui/Logo'
import { Popover } from '../ui/Popover'
import { SavePill } from '../ui/SavePill'
import { toast } from '../ui/Toast'
import { takePrompt } from '../import/pending'
import { loadFont } from '../fonts'
import { Board, type BoardHandle, type Remote, type View } from './Board'
import { WhiteboardModel } from './model'
import { Tools, TOOL_KEYS } from './Tools'
import { Props } from './Props'
import { Layers } from './Layers'
import { elbow, pageBox, union, absPts, type Pt } from './geometry'
import { fitText } from './text'
import { DEFAULT_STYLE, isLinear, type El, type ShapeKind, type Style, type Tool } from './types'
import { exportPng, exportSvg } from './export'
import { buildFlowchart, type FlowSpec } from './flowchart'
import { bringToLife, reviseSite } from './aiFrame'
import { aiConnected } from '../editor/ai/model'
import './whiteboard.css'

const AssistantHost = lazy(() => import('../assistant/AssistantHost'))
const ANIMALS = ['Otter', 'Fox', 'Koala', 'Panda', 'Heron', 'Lynx', 'Gecko', 'Falcon', 'Narwhal', 'Quokka']
const COLORS = ['#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#8b5cf6', '#ef4444', '#0ea5e9', '#22c55e', '#f97316', '#d946ef']
function guestIdentity() {
  try { const s = sessionStorage.getItem('koko.guest'); if (s) return JSON.parse(s) as { name: string; color: string } } catch { /* ignore */ }
  const g = { name: `Guest ${ANIMALS[Math.floor(Math.random() * ANIMALS.length)]}`, color: COLORS[Math.floor(Math.random() * COLORS.length)] }
  try { sessionStorage.setItem('koko.guest', JSON.stringify(g)) } catch { /* ignore */ }
  return g
}
const lsGet = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? { ...d, ...JSON.parse(v) } : d } catch { return d } }
const lsSet = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* private mode */ } }
function useVersion(m: WhiteboardModel) { const [v, setV] = useState(0); useEffect(() => m.subscribe(() => setV(m.version)), [m]); return v }
function useStatus(p: KokoProvider) { const [, f] = useState(0); useEffect(() => p.subscribe(() => f((n) => n + 1)), [p]); return { status: p.status, synced: p.synced } }
const MARK = 'koko-whiteboard:'

export default function WhiteboardEditor({ info }: { info: DocInfo }) {
  const { user } = useAuth()
  const readOnly = info.role === 'viewer'
  const identity = useMemo(() => (user ? { name: user.name, color: user.color } : guestIdentity()), [user])
  const ydoc = useMemo(() => new Y.Doc(), [])
  const model = useMemo(() => new WhiteboardModel(ydoc), [ydoc])
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

function Inner({ info, ydoc, model, provider, readOnly }: { info: DocInfo; ydoc: Y.Doc; model: WhiteboardModel; provider: KokoProvider; readOnly: boolean }) {
  const { user, logout } = useAuth()
  const { theme: uiTheme, toggle: toggleTheme } = useTheme()
  const version = useVersion(model)
  const { status, synced } = useStatus(provider)
  void version
  const els = model.read()
  const board = useRef<BoardHandle>(null)
  const [title, setTitle] = useState(info.title)
  const [tool, setTool] = useState<Tool>('select')
  const [shape, setShape] = useState<ShapeKind>('rect')
  const [style, setStyleState] = useState<Style>(() => lsGet('koko.wb.style', DEFAULT_STYLE))
  const [sel, setSel] = useState<string[]>([])
  const [view, setView] = useState<View>(() => lsGet(`koko.wb.view.${info.id}`, { x: 0, y: 0, z: 1 }))
  const [editing, setEditing] = useState<string | null>(null)
  const [draftText, setDraftText] = useState<El | null>(null)
  const [interactive, setInteractive] = useState<string | null>(null)
  const [share, setShare] = useState(false)
  const [initialPrompt] = useState(() => takePrompt(info.id))
  const [panel, setPanel] = useState<'none' | 'layers' | 'history' | 'assistant'>(initialPrompt ? 'assistant' : 'none')
  const [preview, setPreview] = useState<Version | null>(null)
  const [verKey, setVerKey] = useState(0)
  const [remotes, setRemotes] = useState<Remote[]>([])
  const [people, setPeople] = useState<{ id: number; name: string; color: string }[]>([])
  const [snap, setSnap] = useState<boolean>(() => { try { return localStorage.getItem('koko.wb.snap') !== '0' } catch { return true } })
  const [undoState, setUndoState] = useState({ u: 0, r: 0 })
  const fileInput = useRef<HTMLInputElement>(null)
  const imageAt = useRef<Pt | null>(null)
  const clip = useRef<El[]>([])
  const cm = useContextMenu()
  useEffect(() => { (window as unknown as { __wb?: WhiteboardModel }).__wb = model; return () => { delete (window as unknown as { __wb?: WhiteboardModel }).__wb } }, [model])   // (for tests and debugging)
  ;(window as unknown as { __wbView?: View }).__wbView = view
  const bg = model.getMeta<string>('bg', '#ffffff'), grid = model.getMeta<boolean>('grid', true)

  useEffect(() => lsSet('koko.wb.style', style), [style])
  useEffect(() => { try { localStorage.setItem('koko.wb.snap', snap ? '1' : '0') } catch { /* private mode */ } }, [snap])
  useEffect(() => { const t = window.setTimeout(() => lsSet(`koko.wb.view.${info.id}`, view), 400); return () => window.clearTimeout(t) }, [view, info.id])
  useEffect(() => { const f = () => setUndoState({ u: model.undo.undoStack.length, r: model.undo.redoStack.length }); f(); return model.subscribe(f) }, [model])
  useEffect(() => { els.forEach((e) => e.font && loadFont(e.font)) }, [els])
  useEffect(() => { setSel((s) => s.filter((id) => els.some((e) => e.id === id))) }, [version]) // eslint-disable-line react-hooks/exhaustive-deps

  // title lives in the shared doc, like the other kinds of file
  useEffect(() => { const f = () => { const t = model.meta.get('title'); if (typeof t === 'string') setTitle(t) }; model.meta.observe(f); f(); return () => model.meta.unobserve(f) }, [model])
  const titleTimer = useRef<number | undefined>(undefined)
  const onTitle = (v: string) => {
    setTitle(v); model.setMeta('title', v)
    window.clearTimeout(titleTimer.current)
    titleTimer.current = window.setTimeout(() => api.renameDoc(info.id, v).catch((e: ApiError) => toast(e.message)), 600)
  }
  useEffect(() => { document.title = `${title || 'Untitled whiteboard'} - KokoDocs` }, [title])
  useEffect(() => { const c = () => { toast('Your access to this whiteboard changed'); setTimeout(() => location.reload(), 900) }; window.addEventListener('koko:access-changed', c); return () => window.removeEventListener('koko:access-changed', c) }, [])

  // people: their pictures, pointers and what they have selected
  useEffect(() => {
    const f = () => {
      const r: Remote[] = [], p: { id: number; name: string; color: string }[] = []
      provider.awareness.getStates().forEach((s, id) => {
        if (id === provider.doc.clientID || !s.user) return
        const u = s.user as { name: string; color: string }
        r.push({ id, name: u.name, color: u.color, cursor: s.wbc as { x: number; y: number } | undefined, sel: s.wbs as string[] | undefined }); p.push({ id, ...u })
      })
      setRemotes(r); setPeople(p)
    }
    provider.awareness.on('change', f); f()
    return () => provider.awareness.off('change', f)
  }, [provider])
  useEffect(() => { provider.awareness.setLocalStateField('wbs', sel) }, [provider, sel])
  const lastCursor = useRef(0)
  const onCursor = useCallback((q: Pt | null) => {
    const now = Date.now(); if (q && now - lastCursor.current < 45) return
    lastCursor.current = now; provider.awareness.setLocalStateField('wbc', q ? { x: Math.round(q[0]), y: Math.round(q[1]) } : null)
  }, [provider])

  // first time on a board that has things on it: show all of it
  const fitted = useRef(false)
  const fit = useCallback((list: El[] = model.read(), pad = 80) => {
    const b = union(list.filter((e) => !e.hide).map(pageBox)), s = board.current?.size()
    if (!b || !s) return
    const z = Math.max(0.05, Math.min(1.5, Math.min((s.w - pad * 2) / Math.max(1, b.w), (s.h - pad * 2) / Math.max(1, b.h))))
    setView({ z, x: s.w / 2 - (b.x + b.w / 2) * z, y: s.h / 2 - (b.y + b.h / 2) * z })
  }, [model])
  useEffect(() => { if (synced && !fitted.current) { fitted.current = true; if (!localStorage.getItem(`koko.wb.view.${info.id}`) && model.read().length) fit() } }, [synced, fit, model, info.id])
  const zoomBy = (k: number) => { const s = board.current?.size(); if (!s) return; setView((v) => { const z = Math.max(0.05, Math.min(8, v.z * k)); return { z, x: s.w / 2 - ((s.w / 2 - v.x) / v.z) * z, y: s.h / 2 - ((s.h / 2 - v.y) / v.z) * z } }) }
  const zoomTo = (z: number) => zoomBy(z / view.z)
  const here = (): Pt => { const s = board.current?.size() ?? { w: 800, h: 600 }; return [(s.w / 2 - view.x) / view.z, (s.h / 2 - view.y) / view.z] }

  // ── editing the look of things ──
  const selected = els.filter((e) => sel.includes(e.id))
  const apply = useCallback((p: Partial<Style> & { bold?: boolean; italic?: boolean }) => {
    const { bold, italic, ...st } = p
    if (Object.keys(st).length) setStyleState((s) => ({ ...s, ...st }))
    if (p.font) loadFont(p.font)
    if (!selected.length) return
    const upd: Record<string, Partial<El>> = {}
    for (const e of selected) {
      if (e.lock) continue
      const u: Partial<El> = {}, text = e.type === 'text', line = isLinear(e.type), shape = !text && !line && e.type !== 'image' && e.type !== 'embed' && e.type !== 'frame'
      if (p.stroke !== undefined && !text && e.type !== 'image') u.stroke = p.stroke
      if (p.fill !== undefined && (shape || e.type === 'draw')) u.fill = p.fill
      if (p.fs !== undefined && (shape || e.type === 'draw')) u.fs = p.fs
      if (p.sw !== undefined && !text) u.sw = p.sw
      if (p.ss !== undefined && !text) u.ss = p.ss
      if (p.ro !== undefined && !text) u.ro = p.ro
      if (p.op !== undefined) u.op = p.op
      if (p.rad !== undefined && e.type === 'rect') u.rad = p.rad
      if (p.fgap !== undefined && (shape || e.type === 'draw')) u.fgap = p.fgap
      if (p.font !== undefined) u.font = p.font
      if (p.size !== undefined && (text || shape || line)) u.size = p.size
      if (p.ta !== undefined) u.ta = p.ta
      if (p.tc !== undefined) u.tc = p.tc
      if (bold !== undefined) u.bold = bold
      if (italic !== undefined) u.italic = italic
      if (p.hs !== undefined && e.type === 'arrow') u.hs = p.hs
      if (p.he !== undefined && e.type === 'arrow') u.he = p.he
      if (p.curve !== undefined && line && e.type !== 'draw') {
        u.curve = p.curve
        const a = absPts(e); const s0 = a[0], s1 = a[a.length - 1]
        const fromEl = e.from ? model.get(e.from.id) : undefined, toEl = e.to ? model.get(e.to.id) : undefined
        const pts = p.curve === 'elbow' ? elbow(s0, s1, fromEl, toEl) : [s0, s1]
        u.pts = pts.map((q) => [q[0] - e.x, q[1] - e.y] as Pt)
      }
      if (text && (u.font || u.size || u.bold !== undefined || u.italic !== undefined)) {
        const next = { ...e, ...u }; const fam = next.font ?? 'Caveat'
        if (e.type === 'text') Object.assign(u, fitText(next))
        void document.fonts?.load(`${next.size ?? 24}px "${fam}"`).then(() => { const cur = model.get(e.id); if (cur) model.update(e.id, fitText(cur)) })
      }
      if (Object.keys(u).length) upd[e.id] = u
    }
    model.updateMany(upd)
  }, [selected, model])
  const ids = sel
  const act = {
    front: () => model.reorder(ids, 'front'), back: () => model.reorder(ids, 'back'), forward: () => model.reorder(ids, 'forward'), backward: () => model.reorder(ids, 'backward'),
    duplicate: () => setSel(model.duplicate(ids)), remove: () => { model.remove(ids); setSel([]) },
    lock: () => { const all = selected.every((e) => e.lock); model.updateMany(Object.fromEntries(ids.map((i) => [i, { lock: !all }]))) },
    group: () => model.group(ids), ungroup: () => model.ungroup(ids),
    align: (how: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'dh' | 'dv') => {
      const mine = selected.filter((e) => !e.lock), boxes = mine.map((e) => ({ e, b: pageBox(e) })), u = union(boxes.map((x) => x.b)); if (!u || mine.length < 2) return
      const upd: Record<string, Partial<El>> = {}
      if (how === 'dh' || how === 'dv') {
        const h = how === 'dh', sorted = [...boxes].sort((a, b) => (h ? a.b.x - b.b.x : a.b.y - b.b.y)), total = sorted.reduce((s0, x) => s0 + (h ? x.b.w : x.b.h), 0), gap = ((h ? u.w : u.h) - total) / (sorted.length - 1)
        let pos = h ? u.x : u.y
        for (const x of sorted) { upd[x.e.id] = h ? { x: x.e.x + (pos - x.b.x) } : { y: x.e.y + (pos - x.b.y) }; pos += (h ? x.b.w : x.b.h) + gap }
      } else for (const x of boxes) {
        const dx = how === 'left' ? u.x - x.b.x : how === 'right' ? u.x + u.w - (x.b.x + x.b.w) : how === 'center' ? u.x + u.w / 2 - (x.b.x + x.b.w / 2) : 0
        const dy = how === 'top' ? u.y - x.b.y : how === 'bottom' ? u.y + u.h - (x.b.y + x.b.h) : how === 'middle' ? u.y + u.h / 2 - (x.b.y + x.b.h / 2) : 0
        upd[x.e.id] = { x: x.e.x + dx, y: x.e.y + dy }
      }
      model.updateMany(upd)
    },
  }
  const addTemplate = (spec: FlowSpec) => {
    const c = here(), { els: made } = buildFlowchart(model, spec, [c[0] - 150, c[1] - 180])
    setSel(model.add(made)); setTool('select')
    const b = union(made.map(pageBox)); const s0 = board.current?.size()
    if (b && s0) { const z = Math.max(0.2, Math.min(1, (s0.w - 360) / Math.max(1, b.w), (s0.h - 200) / Math.max(1, b.h))); setView({ z, x: s0.w / 2 - (b.x + b.w / 2) * z, y: s0.h / 2 - (b.y + b.h / 2) * z }) }
  }

  // ── pictures ──
  const addImage = useCallback(async (file: File, at?: Pt) => {
    if (readOnly) return
    if (!file.type.startsWith('image/')) { toast('That is not a picture'); return }
    try {
      const src = await api.uploadImage(info.id, file)
      const dims = await new Promise<{ w: number; h: number }>((ok) => { const i = new Image(); i.onload = () => ok({ w: i.naturalWidth || 320, h: i.naturalHeight || 240 }); i.onerror = () => ok({ w: 320, h: 240 }); i.src = src })
      const k = Math.min(1, 520 / Math.max(dims.w, dims.h)), c = at ?? here()
      const [id] = model.add([model.make('image', { x: c[0] - (dims.w * k) / 2, y: c[1] - (dims.h * k) / 2, w: dims.w * k, h: dims.h * k, src, fill: 'transparent' })])
      setSel([id]); setTool('select')
    } catch (e) { toast((e as Error).message || 'The picture could not be added') }
  }, [info.id, model, readOnly, view]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── clipboard ──
  useEffect(() => {
    const mine = (t: EventTarget | null) => !(t as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"], .modal, .popover')
    const toClip = (e: ClipboardEvent, cut: boolean) => {
      if (!mine(e.target) || !sel.length) return
      const picked = els.filter((x) => sel.includes(x.id)); if (!picked.length) return
      e.preventDefault(); clip.current = picked
      e.clipboardData?.setData('text/plain', MARK + JSON.stringify(picked))
      if (cut && !readOnly) { model.remove(sel); setSel([]) }
    }
    const copy = (e: ClipboardEvent) => toClip(e, false), cut = (e: ClipboardEvent) => toClip(e, true)
    const paste = (e: ClipboardEvent) => {
      if (!mine(e.target) || readOnly) return
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
      if (files.length) { e.preventDefault(); files.forEach((f) => void addImage(f)); return }
      const t = e.clipboardData?.getData('text/plain') ?? ''
      let list: El[] | null = null
      if (t.startsWith(MARK)) { try { list = JSON.parse(t.slice(MARK.length)) as El[] } catch { /* not ours */ } } else if (clip.current.length && !t) list = clip.current
      if (list?.length) {
        e.preventDefault()
        const b = union(list.map(pageBox))!, c = here(), dx = c[0] - (b.x + b.w / 2), dy = c[1] - (b.y + b.h / 2)
        const map = new Map(list.map((x) => [x.id, Math.random().toString(36).slice(2, 10)]))
        const copies = list.map((x) => ({ ...structuredClone(x), id: map.get(x.id)!, x: x.x + dx, y: x.y + dy, from: x.from && map.has(x.from.id) ? { id: map.get(x.from.id)! } : undefined, to: x.to && map.has(x.to.id) ? { id: map.get(x.to.id)! } : undefined, grp: undefined }))
        copies.forEach((x) => { if (!x.from) delete x.from; if (!x.to) delete x.to })
        setSel(model.add(copies)); return
      }
      if (t.trim()) {
        e.preventDefault(); const c = here()
        const el = model.make('text', { x: c[0], y: c[1], text: t.trim().slice(0, 4000), font: style.font, size: style.size, ta: 'left', tc: style.tc }); Object.assign(el, fitText(el))
        setSel(model.add([el]))
      }
    }
    document.addEventListener('copy', copy); document.addEventListener('cut', cut); document.addEventListener('paste', paste)
    return () => { document.removeEventListener('copy', copy); document.removeEventListener('cut', cut); document.removeEventListener('paste', paste) }
  }, [els, sel, readOnly, model, style, addImage]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── keyboard ──
  useEffect(() => {
    const k = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null
      if (editing || draftText || preview || t?.closest('input, textarea, select, [contenteditable="true"], .modal, .popover')) return
      const mod = ev.ctrlKey || ev.metaKey, key = ev.key.toLowerCase()
      if (mod && key === 'z') { ev.preventDefault(); if (!readOnly) (ev.shiftKey ? model.undo.redo() : model.undo.undo()); return }
      if (mod && key === 'y') { ev.preventDefault(); if (!readOnly) model.undo.redo(); return }
      if (mod && key === 'a') { ev.preventDefault(); setSel(els.filter((e) => !e.hide).map((e) => e.id)); return }
      if (mod && key === 'd' && !readOnly && sel.length) { ev.preventDefault(); act.duplicate(); return }
      if (mod && key === 'g' && !readOnly && sel.length) { ev.preventDefault(); ev.shiftKey ? act.ungroup() : act.group(); return }
      if (mod && (ev.key === ']' || ev.key === '}') && !readOnly) { ev.preventDefault(); ev.shiftKey ? act.front() : act.forward(); return }
      if (mod && (ev.key === '[' || ev.key === '{') && !readOnly) { ev.preventDefault(); ev.shiftKey ? act.back() : act.backward(); return }
      if (mod && ev.key === '0') { ev.preventDefault(); zoomTo(1); return }
      if (mod) return
      if (ev.shiftKey && ev.key === '!') { ev.preventDefault(); fit(); return }
      if (ev.key === '+' || ev.key === '=') { zoomBy(1.25); return }
      if (ev.key === '-' || ev.key === '_') { zoomBy(0.8); return }
      if (ev.key === 'Escape') { if (interactive) setInteractive(null); else if (tool !== 'select') setTool('select'); else setSel([]); return }
      if (readOnly) return
      if ((ev.key === 'Delete' || ev.key === 'Backspace') && sel.length) { ev.preventDefault(); act.remove(); return }
      if (ev.key === 'Enter' && sel.length === 1) { ev.preventDefault(); setEditing(sel[0]); return }
      const step = ev.shiftKey ? 10 : 1, d = ev.key === 'ArrowLeft' ? [-step, 0] : ev.key === 'ArrowRight' ? [step, 0] : ev.key === 'ArrowUp' ? [0, -step] : ev.key === 'ArrowDown' ? [0, step] : null
      if (d && sel.length) { ev.preventDefault(); model.updateMany(Object.fromEntries(selected.filter((e) => !e.lock).map((e) => [e.id, { x: e.x + d[0], y: e.y + d[1] }]))); return }
      if (!ev.altKey && TOOL_KEYS[key]) { if (key === 'i') { setTool('image'); fileInput.current?.click(); return } setTool(TOOL_KEYS[key]) }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })

  // ── menus ──
  const onContext = (x: number, y: number, id: string | null) => {
    const picked = id ? (sel.includes(id) ? selected : els.filter((e) => e.id === id)) : selected
    if (id && !sel.includes(id)) setSel([id])
    const items: CtxItem[] = []
    if (picked.length && !readOnly) {
      items.push(
        { label: 'Copy', icon: <Copy size={16} />, hint: 'Ctrl+C', onClick: () => { clip.current = picked; navigator.clipboard?.writeText(MARK + JSON.stringify(picked)).catch(() => undefined) } },
        { label: 'Duplicate', icon: <CopyPlus size={16} />, hint: 'Ctrl+D', onClick: act.duplicate }, { sep: true },
        { label: 'Bring to front', onClick: act.front }, { label: 'Bring forward', onClick: act.forward }, { label: 'Send backward', onClick: act.backward }, { label: 'Send to back', onClick: act.back }, { sep: true },
        { label: picked.every((e) => e.lock) ? 'Unlock' : 'Lock', onClick: act.lock },
      )
      if (picked.length > 1) items.push({ label: 'Group', hint: 'Ctrl+G', onClick: act.group })
      if (picked.some((e) => e.grp)) items.push({ label: 'Ungroup', hint: 'Ctrl+Shift+G', onClick: act.ungroup })
      items.push({ sep: true }, { label: 'Delete', icon: <Trash2 size={16} />, danger: true, hint: 'Del', onClick: act.remove })
    } else if (!readOnly) {
      items.push({ label: 'Paste', icon: <ClipboardPaste size={16} />, disabled: !clip.current.length, onClick: () => { const c = here(), b = union(clip.current.map(pageBox)); if (b) setSel(model.add(clip.current.map((e) => ({ ...structuredClone(e), id: Math.random().toString(36).slice(2, 10), x: e.x + c[0] - b.x - b.w / 2, y: e.y + c[1] - b.y - b.h / 2 })))) } },
        { label: 'Select all', hint: 'Ctrl+A', onClick: () => setSel(els.map((e) => e.id)) })
    }
    if (items.length) cm.show(x, y, items)
  }

  const restoreVersion = async (snap: Y.Doc, v: Version) => {
    try { await api.createVersion(info.id, `Before restoring ${v.label ?? fullLabel(v.created_at)}`) } catch { /* nothing to back up */ }
    model.restoreFrom(snap); setPreview(null); setVerKey((n) => n + 1)
    toast(`Restored ${v.label ?? fullLabel(v.created_at)}. The previous state is saved in version history.`)
  }
  // ── Koko turns a frame into a website ──
  const [life, setLife] = useState<Record<string, number>>({})
  const lifeRef = useRef(life); lifeRef.current = life
  const make = useCallback(async (key: string, job: (progress: (n: number) => void) => Promise<string>): Promise<string> => {
    if (lifeRef.current[key] !== undefined) return 'Already working on that.'
    if (!(await aiConnected())) { toast('Connect an AI model in Settings → Assistant first'); throw new Error('No AI model is connected. Connect one in Settings → Assistant.') }
    setLife((l) => ({ ...l, [key]: 0 }))
    try { const id = await job((n) => setLife((l) => ({ ...l, [key]: n }))); setSel([id]); const b = model.get(id); if (b) { const s0 = board.current?.size(); if (s0) { const z = Math.max(0.2, Math.min(1, (s0.w - 360) / Math.max(1, b.w * 2), (s0.h - 200) / Math.max(1, b.h))); setView({ z, x: s0.w / 2 - (b.x + b.w / 2) * z, y: s0.h / 2 - (b.y + b.h / 2) * z }) } } return id }
    catch (e) { toast((e as Error).message || 'Koko could not build that'); throw e }
    finally { setLife((l) => { const n = { ...l }; delete n[key]; return n }) }
  }, [model])
  const bringFrame = useCallback((frameId: string, instruction?: string) => make(frameId, (p) => bringToLife(model, frameId, { instruction, bg, onProgress: p })), [make, model, bg])
  const reviseEmbed = useCallback((embedId: string, instruction: string) => make(embedId, async (p) => { await reviseSite(model, embedId, instruction, { bg, onProgress: p }); return embedId }), [make, model, bg])
  useEffect(() => { const f = (e: Event) => void bringFrame((e as CustomEvent<string>).detail).catch(() => undefined); window.addEventListener('koko:aiframe', f); return () => window.removeEventListener('koko:aiframe', f) }, [bringFrame])
  const assistantDeps = { bringFrameToLife: async (id: string, instruction?: string) => { await bringFrame(id, instruction); return 'Built it. The website is next to the frame.' }, reviseWebsite: async (id: string, instruction: string) => { await reviseEmbed(id, instruction); return 'Updated.' }, model, getSel: () => sel, setSel, getTitle: () => title, canEdit: () => !readOnly, docId: info.id, getView: () => view, setView, fit: () => fit(), size: () => board.current?.size() ?? { w: 800, h: 600 }, here }

  return (
    <div className="editor-shell wb-shell">
      <header className="ed-top">
        <div className="ed-left">
          {user ? <Link to="/" className="logo-link" title="All documents"><Logo size={32} /></Link> : <span className="logo-link"><Logo size={32} /></span>}
          <input className="title-input" value={title} readOnly={readOnly} onChange={(e) => onTitle(e.target.value)} placeholder="Untitled whiteboard" aria-label="Whiteboard title" maxLength={200} />
          <SavePill provider={provider} status={status} readOnly={readOnly} />
          <EncryptionBadge info={info} />
        </div>
        <div className="ed-right">
          <div className="presence">{people.slice(0, 5).map((p) => <Avatar key={p.id} name={p.name} color={p.color} size={32} ring />)}{people.length > 5 && <span className="more" data-tip={people.slice(5).map((x) => x.name).join(', ')}>+{people.length - 5}</span>}</div>
          <Popover align="end" trigger={({ toggle }) => <button className="icon-btn" title="Export" aria-label="Export" onClick={toggle}><Download size={19} /></button>}>
            {(close) => (<div className="menu">
              <button onClick={() => { close(); void exportPng(els, bg, title).catch((e) => toast(e.message)) }}>Download as PNG</button>
              <button onClick={() => { close(); void exportSvg(els, bg, title).catch((e) => toast(e.message)) }}>Download as SVG</button>
            </div>)}
          </Popover>
          <button className={`icon-btn ${panel === 'layers' ? 'active' : ''}`} title="Layers" aria-label="Layers" onClick={() => setPanel((p) => (p === 'layers' ? 'none' : 'layers'))}><LayersIcon size={19} /></button>
          {!readOnly && <button className={`icon-btn ${panel === 'history' ? 'active' : ''}`} title="Version history" aria-label="Version history" onClick={() => { setPreview(null); setPanel((p) => (p === 'history' ? 'none' : 'history')) }}><History size={19} /></button>}
          {user && !preview && <button className={`btn btn-pill btn-soft ${panel === 'assistant' ? 'active' : ''}`} onClick={() => setPanel((p) => (p === 'assistant' ? 'none' : 'assistant'))}><Sparkles size={17} /><span className="lbl">Koko</span></button>}
          <button className="icon-btn" onClick={toggleTheme} aria-label="Toggle theme">{uiTheme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
          <button className="btn btn-pill btn-primary" onClick={() => setShare(true)}><Share2 size={16} /><span className="lbl">Share</span></button>
          {user ? (
            <Popover align="end" trigger={({ toggle }) => <button className="avatar-btn" onClick={toggle}><Avatar name={user.name} color={user.color} size={34} /></button>}>
              {(close) => (<div className="menu wide"><div className="menu-head"><strong>{user.name}</strong><span>{user.email}</span></div><Link to="/" className="menu-link" onClick={close}>All documents</Link><button onClick={() => { close(); openSettings() }}>Settings</button><button onClick={() => { close(); logout() }}>Sign out</button></div>)}
            </Popover>
          ) : <Link className="btn btn-pill btn-ghost" to="/login" state={{ from: `/d/${info.id}` }}><LogIn size={16} />Sign in</Link>}
        </div>
      </header>

      <div className="ed-body wb-body">
        {preview ? <WhiteboardPreview live={ydoc} docId={info.id} version={preview} onRestore={restoreVersion} onClose={() => setPreview(null)} /> : (
          <main className="wb-main">
            <Board ref={board} model={model} els={els} readOnly={readOnly} tool={tool} setTool={setTool} style={style} sel={sel} setSel={setSel} view={view} setView={setView} bg={bg} grid={grid}
              remotes={remotes} onCursor={onCursor} editing={editing} setEditing={setEditing} draftText={draftText} setDraftText={setDraftText} interactive={interactive} setInteractive={setInteractive}
              onContext={onContext} holdToSnap={snap} onDropFiles={(files, at) => files.forEach((f, i) => void addImage(f, [at[0] + i * 24, at[1] + i * 24]))} onPickImage={(at) => { imageAt.current = at; fileInput.current?.click() }} />
            <Tools tool={tool} setTool={(t) => { setTool(t); if (t === 'image') fileInput.current?.click() }} readOnly={readOnly} canUndo={undoState.u > 0} canRedo={undoState.r > 0} undo={() => model.undo.undo()} redo={() => model.undo.redo()} shape={shape} setShape={setShape} onTemplate={addTemplate} />
            <Props tool={tool} selected={selected} style={style} apply={apply} act={act} readOnly={readOnly} />
            <div className="wb-zoom" role="group" aria-label="Zoom">
              <button className="wb-mini" title="Zoom out (-)" aria-label="Zoom out" onClick={() => zoomBy(0.8)}><Minus size={15} /></button>
              <button className="wb-zoom-pct" title="Reset to 100% (Ctrl/Cmd+0)" onClick={() => zoomTo(1)}>{Math.round(view.z * 100)}%</button>
              <button className="wb-mini" title="Zoom in (+)" aria-label="Zoom in" onClick={() => zoomBy(1.25)}><Plus size={15} /></button>
              <button className="wb-mini" title="Fit everything (Shift+1)" aria-label="Fit everything" onClick={() => fit()}><Maximize size={15} /></button>
              <button className={`wb-mini ${snap ? 'on' : ''}`} title="Hold the pen still at the end of a stroke to turn a rough shape into a perfect one" aria-label="Hold to make perfect shapes" aria-pressed={snap} disabled={readOnly} onClick={() => setSnap((v) => !v)}><Magnet size={15} /></button>
              <button className={`wb-mini ${grid ? 'on' : ''}`} title="Grid" aria-label="Grid" aria-pressed={grid} disabled={readOnly} onClick={() => model.setMeta('grid', !grid)}><Grid3x3 size={15} /></button>
            </div>
            {selected.length === 1 && selected[0].type === 'frame' && selected[0].ai && !readOnly && user && (
              <FrameButton el={selected[0]} view={view} busy={life[selected[0].id]} onMode={(mode) => model.update(selected[0].id, { mode })} onGo={() => window.dispatchEvent(new CustomEvent('koko:aiframe', { detail: selected[0].id }))} />
            )}
            {selected.length === 1 && selected[0].type === 'embed' && !readOnly && (
              <EmbedBar key={selected[0].id} el={selected[0]} view={view} busy={life[selected[0].id]} signedIn={!!user} onChange={(t) => void reviseEmbed(selected[0].id, t).catch(() => undefined)} onInteract={() => setInteractive(selected[0].id)} />
            )}
          </main>
        )}
        <aside className={`side right ${panel === 'assistant' ? 'wide' : ''} ${panel !== 'none' ? 'open' : ''}`}>
          <button className="side-close" aria-label="Close panel" onClick={() => setPanel('none')}><X size={18} /></button>
          <div className="side-inner">
            {panel === 'layers' ? <Layers model={model} els={els} sel={sel} setSel={setSel} readOnly={readOnly} />
              : panel === 'assistant' && user ? <Suspense fallback={null}><AssistantHost docId={info.id} user={user} initialPrompt={initialPrompt} onClose={() => setPanel('none')} source={{ kind: 'whiteboard', deps: assistantDeps }} /></Suspense>
              : <VersionHistory docId={info.id} open={panel === 'history'} selected={preview} refreshKey={verKey} onSelect={(v) => { setPreview(v); if (window.matchMedia('(max-width: 720px)').matches) setPanel('none') }} unit="things" />}
          </div>
        </aside>
      </div>
      <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void addImage(f, imageAt.current ?? undefined); imageAt.current = null; setTool('select') }} />
      {cm.node}
      {share && <ShareDialog info={info} onClose={() => setShare(false)} />}
    </div>
  )
}

function FrameButton({ el, view, onGo, onMode, busy }: { el: El; view: View; onGo: () => void; onMode: (m: 'exact' | 'creative') => void; busy?: number }) {
  const creative = el.mode === 'creative'
  return (
    <div className="wb-frame-ctl" style={{ left: el.x * view.z + view.x + el.w * view.z, top: el.y * view.z + view.y - 46, transform: 'translateX(-100%)' }} onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" role="switch" aria-checked={creative} className={`wb-mode ${creative ? 'creative' : ''}`} disabled={busy !== undefined} aria-label="How closely to follow my drawing"
        title={creative ? 'Creative: Koko treats your drawing as a brief and may redesign it. Click to follow it closely instead.' : 'Faithful: Koko keeps everything you drew exactly and only makes it work. Click to let it be creative instead.'} onClick={() => onMode(creative ? 'exact' : 'creative')}>
        <span className="wb-mode-knob" /><span className="wb-mode-a">Faithful</span><span className="wb-mode-b">Creative</span>
      </button>
      <button type="button" className="wb-frame-go" disabled={busy !== undefined} onClick={onGo}>
        {busy !== undefined ? <><Loader2 size={15} className="spin" />Building{busy ? ` · ${(busy / 1000).toFixed(1)}k` : '…'}</> : <><Sparkles size={15} />Bring to life</>}
      </button>
    </div>
  )
}

/** over a website Koko made: ask for changes, open it, copy or save its code */
function EmbedBar({ el, view, onChange, onInteract, busy, signedIn }: { el: El; view: View; onChange: (t: string) => void; onInteract: () => void; busy?: number; signedIn: boolean }) {
  const [t, setT] = useState('')
  const go = () => { if (t.trim()) { onChange(t.trim()); setT('') } }
  const page = () => new Blob([el.html ?? ''], { type: 'text/html' })
  return (
    <div className="wb-embed-bar-ui" style={{ left: Math.max(8, el.x * view.z + view.x), top: Math.max(64, el.y * view.z + view.y - 50) }} onPointerDown={(e) => e.stopPropagation()}>
      {signedIn && <input value={t} placeholder="Ask Koko to change it: make the header dark, add a contact form…" aria-label="Ask Koko to change this website" disabled={busy !== undefined} onChange={(e) => setT(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') go() }} />}
      {signedIn && <button type="button" className="wb-mini" title="Change it" aria-label="Change it" disabled={busy !== undefined || !t.trim()} onClick={go}>{busy !== undefined ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}</button>}
      <button type="button" className="wb-mini" title="Try it here (double-click the website also works)" aria-label="Try it" onClick={onInteract}>▶</button>
      <button type="button" className="wb-mini" title="Open in a new tab" aria-label="Open in a new tab" disabled={!el.html} onClick={() => { const u = URL.createObjectURL(page()); window.open(u, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(u), 60000) }}><ExternalLink size={15} /></button>
      <button type="button" className="wb-mini" title="Copy the HTML" aria-label="Copy the HTML" disabled={!el.html} onClick={() => navigator.clipboard.writeText(el.html ?? '').then(() => toast('HTML copied'), () => undefined)}><ClipboardCheck size={15} /></button>
      <button type="button" className="wb-mini" title="Download the HTML file" aria-label="Download" disabled={!el.html} onClick={() => { const a = document.createElement('a'); a.href = URL.createObjectURL(page()); a.download = `${el.name || 'website'}.html`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000) }}><Download size={15} /></button>
    </div>
  )
}

/** a look at an earlier version of the board, with the same restore bar the other kinds have */
function WhiteboardPreview({ docId, version, onRestore, onClose }: { live: Y.Doc; docId: string; version: Version; onRestore: (snap: Y.Doc, v: Version) => Promise<void>; onClose: () => void }) {
  const [snap, setSnap] = useState<Y.Doc | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let dead = false; setSnap(null); setErr('')
    api.versionData(docId, version.id).then((buf) => { if (dead) return; const d = new Y.Doc(); Y.applyUpdate(d, buf); setSnap(d) }).catch((e) => setErr(e.message || 'Could not load this version'))
    return () => { dead = true }
  }, [docId, version.id])
  const old = useMemo(() => { if (!snap) return null; const m = new WhiteboardModel(snap); const els = m.read(), bg = m.getMeta<string>('bg', '#ffffff'); m.destroy(); return { els, bg } }, [snap])
  const [view, setView] = useState<View>({ x: 0, y: 0, z: 1 })
  const ref = useRef<BoardHandle>(null)
  useEffect(() => { if (!old) return; const b = union(old.els.map(pageBox)), s = ref.current?.size(); if (b && s) { const z = Math.min(1, (s.w - 120) / Math.max(1, b.w), (s.h - 120) / Math.max(1, b.h)); setView({ z, x: s.w / 2 - (b.x + b.w / 2) * z, y: s.h / 2 - (b.y + b.h / 2) * z }) } }, [old])
  const noop = useMemo(() => new WhiteboardModel(new Y.Doc()), [])
  return (
    <main className="wb-main wb-preview">
      <div className="ver-bar">
        <div className="ver-bar-text"><b>{version.label ?? 'Earlier version'}</b><span>{fullLabel(version.created_at)}{version.authors.length ? ` · ${version.authors.join(', ')}` : ''}</span></div>
        <div className="ver-bar-actions">
          <button className="btn btn-ghost btn-pill btn-sm" onClick={onClose}>Back to current</button>
          <button className="btn btn-primary btn-pill btn-sm" disabled={!snap || busy} onClick={async () => { if (!snap) return; setBusy(true); try { await onRestore(snap, version) } finally { setBusy(false) } }}>{busy ? <Loader2 size={14} className="spin" /> : <RotateCcw size={14} />}Restore this version</button>
        </div>
      </div>
      {err ? <p className="side-empty ver-err">{err}</p> : old ? (
        <div className="wb-preview-board"><Board ref={ref} model={noop} els={old.els} readOnly tool="hand" setTool={() => undefined} style={DEFAULT_STYLE} sel={[]} setSel={() => undefined} view={view} setView={setView} bg={old.bg} grid={false} remotes={[]} onCursor={() => undefined}
          editing={null} setEditing={() => undefined} draftText={null} setDraftText={() => undefined} interactive={null} setInteractive={() => undefined} onContext={() => undefined} onPickImage={() => undefined} /></div>
      ) : <div className="splash small"><span className="spinner" /></div>}
    </main>
  )
}

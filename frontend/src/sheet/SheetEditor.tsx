import { SavePill } from '../ui/SavePill'
import { useWheelZoom, useZoom, ZoomPill } from '../ui/zoom'
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EncryptionBadge } from '../zk/EncryptionBadge'
import { openSettings } from '../ui/settingsStore'
import { Link } from 'react-router-dom'
import * as Y from 'yjs'
import { Cloud, CloudOff, History, Loader2, LogIn, MessageSquare, X, Moon, RotateCcw, Share2, Sparkles, Sun } from 'lucide-react'
import { api, type ApiError, type DocInfo, type Version } from '../api'
import { useAuth } from '../auth'
const AssistantHost = lazy(() => import('../assistant/AssistantHost'))
import { KokoProvider } from '../collab'
import { useComments } from '../editor/Comments'
import { AnchoredComments } from '../ui/AnchoredComments'
import { fullLabel, VersionHistory } from '../editor/VersionHistory'
import { DiffToggle, VersionDiff } from '../editor/VersionDiff'
import { ShareDialog } from '../editor/ShareDialog'
import { SheetExportMenu } from '../export/ExportMenu'
import { takePending, takePrompt } from '../import/pending'
import { useTheme } from '../theme'
import { Avatar } from '../ui/Avatar'
import { Logo } from '../ui/Logo'
import { Popover } from '../ui/Popover'
import { toast } from '../ui/Toast'
import { ChartDialog, ChartLayer } from './Charts'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { addr, colName } from './engine/refs'
import { FormulaBar } from './FormulaBar'
import { Grid, expandRect, selRect, type Editing, type GridHandle, type Remote, type Sel } from './Grid'
import { HEADER_H, HEADER_W, SheetModel, type Chart, type ClipPayload, type Rect, type Style, type Tab } from './model'
import { SheetTabs } from './SheetTabs'
import { SheetToolbar } from './SheetToolbar'
import './sheet.css'

const ANIMALS = ['Otter', 'Fox', 'Koala', 'Panda', 'Heron', 'Lynx', 'Gecko', 'Falcon', 'Narwhal', 'Quokka']
const COLORS = ['#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#8b5cf6', '#ef4444', '#0ea5e9', '#22c55e', '#f97316', '#d946ef']
function guestIdentity() {
  try { const s = sessionStorage.getItem('koko.guest'); if (s) return JSON.parse(s) as { name: string; color: string } } catch { /* ignore */ }
  const g = { name: `Guest ${ANIMALS[Math.floor(Math.random() * ANIMALS.length)]}`, color: COLORS[Math.floor(Math.random() * COLORS.length)] }
  try { sessionStorage.setItem('koko.guest', JSON.stringify(g)) } catch { /* ignore */ }
  return g
}

function useModelVersion(model: SheetModel) {
  const [v, setV] = useState(0)
  useEffect(() => model.subscribe(() => setV(model.version)), [model])
  return v
}

export default function SheetEditor({ info }: { info: DocInfo }) {
  const { user } = useAuth()
  const readOnly = info.role === 'viewer'
  const identity = useMemo(() => (user ? { name: user.name, color: user.color } : guestIdentity()), [user])
  const ydoc = useMemo(() => new Y.Doc(), [])
  const [provider, setProvider] = useState<KokoProvider | null>(null)
  const model = useMemo(() => new SheetModel(ydoc), [ydoc])
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

function useStatus(p: KokoProvider) {
  const [, force] = useState(0)
  useEffect(() => p.subscribe(() => force((n) => n + 1)), [p])
  return { status: p.status, synced: p.synced }
}

const normSel = (s: Sel): Sel => s

function Inner({ info, ydoc, model, provider, readOnly }: { info: DocInfo; ydoc: Y.Doc; model: SheetModel; provider: KokoProvider; readOnly: boolean }) {
  const uz = useZoom('sheet')
  const { user, logout } = useAuth()
  const { theme, toggle: toggleTheme } = useTheme()
  const version = useModelVersion(model)
  const { status, synced } = useStatus(provider)
  const ymeta = useMemo(() => ydoc.getMap('meta'), [ydoc])
  const [title, setTitle] = useState(info.title)
  const [active, setActiveRaw] = useState('sheet1')
  const [sel, setSelState] = useState<Sel>({ ar: 0, ac: 0, fr: 0, fc: 0 })
  const [editing, setEditing] = useState<Editing | null>(null)
  const [copyRect, setCopyRect] = useState<Rect | null>(null)
  const [share, setShare] = useState(false)
  const [initialPrompt] = useState(() => takePrompt(info.id))
  const [panel, setPanel] = useState<'none' | 'history' | 'assistant' | 'comments'>(initialPrompt ? 'assistant' : 'none')
  const [preview, setPreview] = useState<Version | null>(null)
  const [verKey, setVerKey] = useState(0)
  const [ctx, setCtx] = useState<{ x: number; y: number; kind: 'cell' | 'col' | 'row' } | null>(null)
  const [chartSel, setChartSel] = useState<string | null>(null)
  const [chartDlg, setChartDlg] = useState<(Omit<Chart, 'id' | 'x' | 'y'> & { id?: string }) | null>(null)
  const [remotes, setRemotes] = useState<Remote[]>([])
  const grid = useRef<GridHandle>(null)
  const gridAnchor = useMemo(() => ({ get current() { return grid.current?.scroller() ?? null } }) as React.RefObject<HTMLElement | null>, [])
  useWheelZoom(gridAnchor, uz)
  const clipRef = useRef<ClipPayload | null>(null)

  // first client to open an empty spreadsheet creates the default sheet (fixed id, so concurrent creators converge)
  useEffect(() => { if (synced) model.ensureDefaultTab() }, [synced, model])
  useEffect(() => { if (!synced || readOnly) return; const p = takePending(info.id, 'sheet'); if (p) { p.apply(model); toast('Imported ' + p.title) } }, [synced, readOnly, model, info.id])
  useEffect(() => { const t = setTimeout(() => { if (!readOnly) model.ensureDefaultTab() }, 3500); return () => clearTimeout(t) }, [model, readOnly])

  const tabs: Tab[] = model.tabList()
  useEffect(() => { if (tabs.length && !tabs.some((t) => t.id === active)) setActiveRaw(tabs[0].id) }, [tabs, active])
  const sheet = model.has(active) ? active : (tabs[0]?.id ?? 'sheet1')
  const sheetName = tabs.find((t) => t.id === sheet)?.name ?? 'Sheet1'

  const setActive = useCallback((id: string) => {
    setEditing(null); setActiveRaw(id); setSelState({ ar: 0, ac: 0, fr: 0, fc: 0 }); setCopyRect(null); setChartSel(null)
  }, [])
  const setSel = useCallback((s: Sel) => { setSelState(normSel(s)) }, [])

  // title lives in the shared doc so everyone sees renames
  useEffect(() => {
    const f = () => { const t = ymeta.get('title'); if (typeof t === 'string') setTitle(t) }
    ymeta.observe(f); f(); return () => ymeta.unobserve(f)
  }, [ymeta])
  const titleTimer = useRef<number | undefined>(undefined)
  const onTitle = (v: string) => {
    setTitle(v); ymeta.set('title', v)
    window.clearTimeout(titleTimer.current)
    titleTimer.current = window.setTimeout(() => api.renameDoc(info.id, v).catch((e: ApiError) => toast(e.message)), 600)
  }
  useEffect(() => { document.title = `${title || 'Untitled spreadsheet'} - KokoDocs` }, [title])

  // presence: broadcast my selection, show everyone else's
  useEffect(() => { provider.awareness.setLocalStateField('sel', { sheet, ...sel }) }, [provider, sheet, sel])
  useEffect(() => {
    const f = () => {
      const out: Remote[] = []
      provider.awareness.getStates().forEach((s, id) => {
        if (id === provider.doc.clientID || !s.user) return
        const u = s.user as { name: string; color: string }, rs = s.sel as (Sel & { sheet: string }) | undefined
        out.push({ id, name: u.name, color: u.color, sel: rs ? { ar: rs.ar, ac: rs.ac, fr: rs.fr, fc: rs.fc } : undefined, sheet: rs?.sheet })
      })
      setRemotes(out)
    }
    provider.awareness.on('change', f); f()
    return () => provider.awareness.off('change', f)
  }, [provider])

  const rect = selRect(model, sheet, sel)
  const comments = useComments(info.id, !!user)
  const openRoots = comments.list.filter((c) => !c.parent_id && !c.resolved && c.anchor)
  const sheetLabel = (a: Record<string, unknown> | null) => (a && typeof a.sheet === 'string' ? `${tabs.find((t) => t.id === a.sheet)?.name ?? 'Sheet'}!${addr(Number(a.r), Number(a.c))}` : 'Spreadsheet')
  const goComment = (a: Record<string, unknown>) => {
    if (typeof a.sheet !== 'string') return
    if (a.sheet !== sheet && model.has(a.sheet)) setActive(a.sheet)
    const r = Number(a.r), c = Number(a.c)
    setSelState({ ar: r, ac: c, fr: r, fc: c }); setTimeout(() => grid.current?.scrollToCell(r, c), 30)
  }
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('comment'); if (!id || !comments.list.length) return
    const c = comments.list.find((x) => x.id === id); if (!c) return
    setPanel('comments'); if (c.anchor) goComment(c.anchor)
    history.replaceState(null, '', location.pathname)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments.list.length])
  const assistantDeps = { model, getSheet: () => sheet, setSheet: setActive, getSel: () => selRect(model, sheet, sel), getTitle: () => title, canEdit: () => !readOnly }
  const raw = model.raw(sheet, sel.ar, sel.ac) ?? ''
  const focusGrid = useCallback(() => grid.current?.focus(), [])

  // ───────────── editing lifecycle ─────────────
  const startEdit = useCallback((e: Editing) => { if (!readOnly) setEditing(e) }, [readOnly])
  const setEditingText = useCallback((t: string) => setEditing((cur) => (cur ? { ...cur, text: t } : cur)), [])
  const commit = useCallback((dr: number, dc: number) => {
    if (!editing) return
    const e = editing
    setEditing(null)
    model.setText(sheet, e.r, e.c, e.text)
    if (dr || dc) {
      const nr = Math.max(0, Math.min(model.rowCount(sheet) - 1, e.r + dr)), nc = Math.max(0, Math.min(model.colCount(sheet) - 1, e.c + dc))
      const mg = model.mergeAt(sheet, nr, nc)
      setSelState({ ar: mg ? mg.r1 : nr, ac: mg ? mg.c1 : nc, fr: mg ? mg.r1 : nr, fc: mg ? mg.c1 : nc })
      requestAnimationFrame(focusGrid)
    } else if (document.activeElement === document.body) requestAnimationFrame(focusGrid)
  }, [editing, model, sheet, focusGrid])
  const cancel = useCallback(() => { setEditing(null); requestAnimationFrame(focusGrid) }, [focusGrid])

  const applyFormat = (action: 'bold' | 'italic' | 'underline') => {
    const k = action === 'bold' ? 'b' : action === 'italic' ? 'i' : 'u'
    const cur = model.style(sheet, sel.ar, sel.ac)
    model.setStyle(sheet, rect, { [k]: cur[k] ? undefined : 1 } as Partial<Style>)
  }

  // ───────────── import / export ─────────────
  const onImport = async (f: File) => {
    const text = await f.text()
    const first = text.split(/\r?\n/, 1)[0]
    const delim = (first.match(/\t/g)?.length ?? 0) >= (first.match(/,/g)?.length ?? 0) && first.includes('\t') ? '\t' : first.includes(';') && !first.includes(',') ? ';' : ','
    const n = model.importDelimited(sheet, text, delim)
    toast(`Imported ${n} row${n === 1 ? '' : 's'} from ${f.name}`)
  }
  const onExport = () => {
    const u = model.used(sheet)
    const rows = model.rows(sheet, { r1: 0, c1: 0, r2: Math.max(0, u.rows - 1), c2: Math.max(0, u.cols - 1) })
    const esc = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
    const blob = new Blob(['﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = `${title || 'spreadsheet'} - ${sheetName}.csv`; a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  // ───────────── charts ─────────────
  const rangeText = (R: Rect) => (R.r1 === R.r2 && R.c1 === R.c2 ? addr(R.r1, R.c1) : `${addr(R.r1, R.c1)}:${addr(R.r2, R.c2)}`)
  const openChartDialog = () => {
    const single = rect.r1 === rect.r2 && rect.c1 === rect.c2
    const u = model.used(sheet)
    const R = single ? { r1: 0, c1: 0, r2: Math.max(0, u.vrows - 1), c2: Math.max(0, u.vcols - 1) } : rect
    setChartDlg({ type: 'column', range: rangeText(R), title: '', w: 480, h: 300, headers: true })
  }

  // ───────────── version restore ─────────────
  const restoreVersion = async (snap: Y.Doc, v: Version) => {
    try { await api.createVersion(info.id, `Before restoring ${v.label ?? fullLabel(v.created_at)}`) } catch { /* nothing to back up */ }
    model.restoreFrom(snap)
    setPreview(null); setVerKey((n) => n + 1); setEditing(null)
    toast(`Restored ${v.label ?? fullLabel(v.created_at)}. The previous state is saved in version history.`)
  }

  // ───────────── context menu ─────────────
  const doPaste = async (what: 'all' | 'values') => {
    try {
      const items = clipRef.current
      const text = await navigator.clipboard.readText()
      if (items && model.textOf(items.sheet, { r1: items.r0, c1: items.c0, r2: items.r0 + items.cells.length - 1, c2: items.c0 + (items.cells[0]?.length ?? 1) - 1 }) === text) model.paste(sheet, rect.r1, rect.c1, items, what)
      else model.pasteText(sheet, rect.r1, rect.c1, text)
    } catch { toast('Use Ctrl+V to paste: your browser blocks reading the clipboard here') }
  }
  const menuItems = (kind: 'cell' | 'col' | 'row'): MenuItem[] => {
    const R = rect, nr = R.r2 - R.r1 + 1, nc = R.c2 - R.c1 + 1
    const common: MenuItem[] = [
      { label: 'Cut', hint: 'Ctrl+X', disabled: readOnly, onClick: () => { clipRef.current = model.copyRange(sheet, R, true); setCopyRect(R); void navigator.clipboard.writeText(model.textOf(sheet, R)) } },
      { label: 'Copy', hint: 'Ctrl+C', onClick: () => { clipRef.current = model.copyRange(sheet, R); setCopyRect(R); void navigator.clipboard.writeText(model.textOf(sheet, R)) } },
      { label: 'Paste', hint: 'Ctrl+V', disabled: readOnly, onClick: () => doPaste('all') },
      { label: 'Paste values only', disabled: readOnly, onClick: () => doPaste('values') },
      { sep: true, label: '' },
    ]
    const rows: MenuItem[] = [
      { label: `Insert ${nr} row${nr > 1 ? 's' : ''} above`, disabled: readOnly, onClick: () => model.insertRows(sheet, R.r1, nr) },
      { label: `Insert ${nr} row${nr > 1 ? 's' : ''} below`, disabled: readOnly, onClick: () => model.insertRows(sheet, R.r2 + 1, nr) },
      { label: `Delete row${nr > 1 ? 's' : ''}`, danger: true, disabled: readOnly, onClick: () => { model.deleteRows(sheet, R.r1, nr); setSelState({ ar: R.r1, ac: sel.ac, fr: R.r1, fc: sel.ac }) } },
    ]
    const cols: MenuItem[] = [
      { label: `Insert ${nc} column${nc > 1 ? 's' : ''} left`, disabled: readOnly, onClick: () => model.insertCols(sheet, R.c1, nc) },
      { label: `Insert ${nc} column${nc > 1 ? 's' : ''} right`, disabled: readOnly, onClick: () => model.insertCols(sheet, R.c2 + 1, nc) },
      { label: `Delete column${nc > 1 ? 's' : ''}`, danger: true, disabled: readOnly, onClick: () => { model.deleteCols(sheet, R.c1, nc); setSelState({ ar: sel.ar, ac: R.c1, fr: sel.ar, fc: R.c1 }) } },
    ]
    const tail: MenuItem[] = [
      { sep: true, label: '' },
      { label: 'Clear contents', hint: 'Del', disabled: readOnly, onClick: () => model.clear(sheet, R, 'values') },
      { label: 'Clear formatting', disabled: readOnly, onClick: () => model.clear(sheet, R, 'formats') },
      ...(user ? [{ sep: true, label: '' }, { label: nr * nc === 1 ? 'Comment on this cell' : 'Comment', onClick: () => setPanel('comments') }] : []),
    ]
    const extra: MenuItem[] = [
      { sep: true, label: '' },
      { label: `Sort column ${colName(sel.ac)} A → Z`, disabled: readOnly, onClick: () => { const u = model.used(sheet); model.sort(sheet, { r1: 0, c1: 0, r2: Math.max(0, u.rows - 1), c2: Math.max(0, u.cols - 1) }, sel.ac, true, true) } },
      { label: `Sort column ${colName(sel.ac)} Z → A`, disabled: readOnly, onClick: () => { const u = model.used(sheet); model.sort(sheet, { r1: 0, c1: 0, r2: Math.max(0, u.rows - 1), c2: Math.max(0, u.cols - 1) }, sel.ac, false, true) } },
      { label: `Freeze rows up to ${R.r2 + 1}`, onClick: () => model.setFreeze(sheet, R.r2 + 1, model.freeze(sheet).cols) },
      { label: `Freeze columns up to ${colName(R.c2)}`, onClick: () => model.setFreeze(sheet, model.freeze(sheet).rows, R.c2 + 1) },
      { label: 'Insert chart from selection', disabled: readOnly, onClick: openChartDialog },
    ]
    if (kind === 'row') return [...common, ...rows, ...tail, ...extra]
    if (kind === 'col') return [...common, ...cols, ...tail, ...extra]
    return [...common, ...rows.slice(0, 2), ...cols.slice(0, 2), { label: 'Delete row', danger: true, disabled: readOnly, onClick: rows[2].onClick }, { label: 'Delete column', danger: true, disabled: readOnly, onClick: cols[2].onClick },
      { sep: true, label: '' }, { label: model.mergeAt(sheet, R.r1, R.c1) ? 'Unmerge cells' : 'Merge cells', disabled: readOnly || (R.r1 === R.r2 && R.c1 === R.c2 && !model.mergeAt(sheet, R.r1, R.c1)), onClick: () => (model.mergeAt(sheet, R.r1, R.c1) ? model.unmerge(sheet, R) : model.merge(sheet, R)) }, ...tail, ...extra]
  }

  // quick stats for the selection (like Excel's status bar)
  const stats = useMemo(() => {
    void version
    if ((rect.r2 - rect.r1 + 1) * (rect.c2 - rect.c1 + 1) > 200000 || (rect.r1 === rect.r2 && rect.c1 === rect.c2)) return null
    let sum = 0, n = 0, cnt = 0
    const u = model.used(sheet)
    for (let r = rect.r1; r <= Math.min(rect.r2, u.rows); r++) for (let c = rect.c1; c <= Math.min(rect.c2, u.cols); c++) {
      const v = model.value(sheet, r, c)
      if (v === null || v === '') continue
      cnt++
      if (typeof v === 'number') { sum += v; n++ }
    }
    return cnt ? { sum, avg: n ? sum / n : 0, cnt, n } : null
  }, [rect.r1, rect.r2, rect.c1, rect.c2, model, sheet, version])
  const nf = (x: number) => Number(x.toPrecision(10)).toLocaleString(undefined, { maximumFractionDigits: 6 })

  const people = remotes
  useEffect(() => {
    const changed = () => { toast('Your access to this spreadsheet changed'); setTimeout(() => location.reload(), 900) }
    window.addEventListener('koko:access-changed', changed)
    return () => window.removeEventListener('koko:access-changed', changed)
  }, [])
  if (import.meta.env.DEV) (window as unknown as { __sheet?: SheetModel }).__sheet = model

  return (
    <div className="editor-shell sheet-shell">
      <header className="ed-top">
        <div className="ed-left">
          {user ? <Link to="/" className="logo-link" title="All documents"><Logo size={32} /></Link> : <span className="logo-link"><Logo size={32} /></span>}
          <input className="title-input" value={title} readOnly={readOnly} onChange={(e) => onTitle(e.target.value)} placeholder="Untitled spreadsheet" aria-label="Spreadsheet title" maxLength={200} />
          <SavePill provider={provider} status={status} readOnly={readOnly} />
          <EncryptionBadge info={info} />
        </div>
        <div className="ed-right">
          <div className="presence">{people.slice(0, 5).map((p) => <Avatar key={p.id} name={p.name} color={p.color} size={32} ring />)}{people.length > 5 && <span className="more" data-tip={people.slice(5).map((x) => x.name).join(', ')}>+{people.length - 5}</span>}</div>
          <SheetExportMenu model={model} sheet={sheet} title={title} />
          {!readOnly && (
            <button className={`icon-btn ${panel === 'history' ? 'active' : ''}`} title="Version history" aria-label="Version history" onClick={() => { setPreview(null); setPanel((p) => (p === 'history' ? 'none' : 'history')) }}><History size={19} /></button>
          )}
          {user && !preview && (
            <button className={`icon-btn comments-btn ${panel === 'comments' ? 'active' : ''}`} title="Comments" aria-label="Comments" onClick={() => setPanel((p) => (p === 'comments' ? 'none' : 'comments'))}>
              <MessageSquare size={19} />{openRoots.length > 0 && <b className="badge">{openRoots.length}</b>}
            </button>)}
          {user && !preview && <button className={`btn btn-pill btn-soft ${panel === 'assistant' ? 'active' : ''}`} onClick={() => setPanel((p) => (p === 'assistant' ? 'none' : 'assistant'))}><Sparkles size={17} /><span className="lbl">Assistant</span></button>}
          <button className="icon-btn" onClick={toggleTheme} aria-label="Toggle theme">{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
          <button className="btn btn-pill btn-primary" onClick={() => setShare(true)}><Share2 size={16} /><span className="lbl">Share</span></button>
          {user ? (
            <Popover align="end" trigger={({ toggle }) => <button className="avatar-btn" onClick={toggle}><Avatar name={user.name} color={user.color} size={34} /></button>}>
              {(close) => (<div className="menu wide"><div className="menu-head"><strong>{user.name}</strong><span>{user.email}</span></div><Link to="/" className="menu-link" onClick={close}>All documents</Link><button onClick={() => { close(); openSettings() }}>Settings</button><button onClick={() => { close(); logout() }}>Sign out</button></div>)}
            </Popover>
          ) : <Link className="btn btn-pill btn-ghost" to="/login" state={{ from: `/d/${info.id}` }}><LogIn size={16} />Sign in</Link>}
        </div>
      </header>

      <div className="ed-toolbar-wrap">
        <SheetToolbar model={model} sheet={sheet} rect={rect} active={{ r: sel.ar, c: sel.ac }} readOnly={readOnly || !!preview} version={version}
          setSel={(a, b, c, d) => setSelState({ ar: a, ac: b, fr: c, fc: d })} onChart={openChartDialog} onImport={onImport} onExport={onExport} focusGrid={focusGrid} />
      </div>
      <FormulaBar sel={sel} rect={rect} raw={raw} editing={editing} readOnly={readOnly || !!preview} startEdit={startEdit} setText={setEditingText} commit={commit} cancel={cancel}
        goTo={(r1, c1, r2, c2) => { setEditing(null); setSelState({ ar: r1, ac: c1, fr: r2, fc: c2 }); requestAnimationFrame(focusGrid) }} />

      <div className="ed-body sheet-body">
        <div className="sheet-main">
          {preview ? (
            <SheetPreview live={model.ydoc} docId={info.id} version={preview} onRestore={restoreVersion} onClose={() => setPreview(null)} />
          ) : (
            <>
              {!synced && status !== 'denied' && <div className="sync-banner sheet-sync"><Loader2 size={15} className="spin" />Loading spreadsheet</div>}
              <Grid zoom={uz.z} ref={grid} model={model} sheet={sheet} sheetName={sheetName} version={version} sel={sel} setSel={setSel} editing={editing} startEdit={startEdit}
                setEditingText={setEditingText} commit={commit} cancel={cancel} readOnly={readOnly} clipRef={clipRef} copyRect={copyRect} setCopyRect={setCopyRect}
                remotes={remotes} onContext={setCtx} onFormat={applyFormat}
                overlay={(layout) => (<>
                  <ChartLayer zoom={uz.z} model={model} sheet={sheet} version={version} selected={chartSel} setSelected={setChartSel} readOnly={readOnly}
                    onEdit={(c) => setChartDlg({ id: c.id, type: c.type, range: c.range, title: c.title, w: c.w, h: c.h, headers: c.headers, stacked: c.stacked })} />
                  {openRoots.filter((c) => c.anchor?.sheet === sheet).map((c) => <i key={c.id} className="cm-corner" style={{ left: layout.X(Number(c.anchor!.c) + 1) - 10, top: layout.Y(Number(c.anchor!.r)) }} />)}
                </>)} />
              <ZoomPill zoom={uz} anchor={gridAnchor} fitLabel="Fit all the data" onFit={() => {
                const el = grid.current?.scroller(), u = model.used(sheet); if (!el) return
                let w = HEADER_W + 24, h = HEADER_H + 24   // (the size of the part of the sheet that has anything in it, at normal size)
                for (let c = 0; c < Math.max(1, u.cols); c++) w += model.colWidth(sheet, c)
                for (let r = 0; r < Math.max(1, u.rows); r++) h += model.rowHeight(sheet, r)
                uz.set(Math.max(0.1, Math.min(1, el.clientWidth / w, el.clientHeight / h))); el.scrollTo({ left: 0, top: 0 })
              }} />
              <div className="sheet-foot">
                <SheetTabs model={model} tabs={tabs} active={sheet} setActive={setActive} readOnly={readOnly} />
                {stats && (
                  <div className="sheet-stats" title="Statistics for the selected cells">
                    <span>Sum <b>{nf(stats.sum)}</b></span><span>Average <b>{nf(stats.avg)}</b></span><span>Count <b>{stats.cnt}</b></span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        <aside className={`side right ${panel === 'assistant' ? 'wide' : ''} ${panel !== 'none' ? 'open' : ''}`}>
          <button className="side-close" aria-label="Close panel" onClick={() => setPanel('none')}><X size={18} /></button>
          <div className="side-inner">
            {panel === 'comments' && user
              ? <AnchoredComments docId={info.id} user={user} list={comments.list} refresh={comments.refresh} label={sheetLabel} onGo={goComment}
                  current={{ anchor: { sheet, r: sel.ar, c: sel.ac }, label: `${sheetName}!${addr(sel.ar, sel.ac)}` }} />
              : panel === 'assistant' && user
              ? <Suspense fallback={null}><AssistantHost docId={info.id} user={user} initialPrompt={initialPrompt} onClose={() => setPanel('none')} source={{ kind: 'sheet', deps: assistantDeps }} /></Suspense>
              : <VersionHistory docId={info.id} open={panel === 'history'} selected={preview} refreshKey={verKey} onSelect={(v) => { setPreview(v); if (window.matchMedia('(max-width: 720px)').matches) setPanel('none') }} unit="cells" />}
          </div>
        </aside>
      </div>

      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={menuItems(ctx.kind)} onClose={() => { setCtx(null); focusGrid() }} />}
      {share && <ShareDialog info={info} onClose={() => setShare(false)} />}
      {chartDlg && (
        <ChartDialog initial={chartDlg} onClose={() => setChartDlg(null)}
          onSave={(c) => {
            if (chartDlg.id) model.updateChart(sheet, chartDlg.id, c)
            else {
              const gridEl = grid.current?.scroller()
              model.addChart(sheet, { ...c, x: (gridEl?.scrollLeft ?? 0) / uz.z + 80, y: (gridEl?.scrollTop ?? 0) / uz.z + 60 })
            }
          }} />
      )}
    </div>
  )
}

/** Read-only look at an old version of the spreadsheet, with a restore bar. */
function SheetPreview({ docId, version, live, onRestore, onClose }: { live: Y.Doc; docId: string; version: Version; onRestore: (snap: Y.Doc, v: Version) => Promise<void>; onClose: () => void }) {
  const [snap, setSnap] = useState<Y.Doc | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<string | null>(null)
  const [diff, setDiff] = useState(false)
  const [sel, setSel] = useState<Sel>({ ar: 0, ac: 0, fr: 0, fc: 0 })
  const clipRef = useRef<ClipPayload | null>(null)
  useEffect(() => {
    let dead = false
    setSnap(null); setErr('')
    api.versionData(docId, version.id).then((buf) => { if (dead) return; const d = new Y.Doc(); Y.applyUpdate(d, buf); setSnap(d) }).catch((e) => setErr(e.message || 'Could not load this version'))
    return () => { dead = true }
  }, [docId, version.id])
  const pm = useMemo(() => (snap ? new SheetModel(snap) : null), [snap])
  const dummy = useMemo(() => new SheetModel(new Y.Doc()), [])
  const v = useModelVersion(pm ?? dummy)
  const tabs = pm?.tabList() ?? []
  const active = tab && tabs.some((t) => t.id === tab) ? tab : tabs[0]?.id
  return (
    <>
      <div className="ver-bar sheet-ver-bar">
        <div className="ver-bar-text"><b>{version.label ?? 'Earlier version'}</b><span>{fullLabel(version.created_at)}{version.authors.length ? ` · ${version.authors.join(', ')}` : ''}</span></div>
        <div className="ver-bar-actions">
          <DiffToggle on={diff} onClick={() => setDiff((d) => !d)} />
          <button className="btn btn-ghost btn-pill btn-sm" onClick={onClose}>Back to current</button>
          <button className="btn btn-primary btn-pill btn-sm" disabled={!snap || busy} onClick={async () => { if (!snap) return; setBusy(true); try { await onRestore(snap, version) } finally { setBusy(false) } }}>
            {busy ? <Loader2 size={14} className="spin" /> : <RotateCcw size={14} />}Restore this version
          </button>
        </div>
      </div>
      {err ? <p className="side-empty ver-err">{err}</p> : diff ? <VersionDiff docId={docId} kind="sheet" version={version} live={live} snap={snap} /> : !pm || !active ? <div className="splash small"><span className="spinner" /></div> : (
        <>
          <Grid model={pm} sheet={active} sheetName={tabs.find((t) => t.id === active)?.name ?? ''} version={v} sel={sel} setSel={setSel} editing={null} startEdit={() => {}} setEditingText={() => {}}
            commit={() => {}} cancel={() => {}} readOnly clipRef={clipRef} copyRect={null} setCopyRect={() => {}} remotes={[]} onContext={() => {}} onFormat={() => {}} />
          <div className="sheet-foot"><SheetTabs model={pm} tabs={tabs} active={active} setActive={setTab} readOnly /></div>
        </>
      )}
    </>
  )
}

export { expandRect }

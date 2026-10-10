import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type AiSettings, type User } from '../api'
import type { Adapter } from './adapter'
import type { DocDeps } from './docTools'
import type { SheetDeps } from './sheetTools'
import type { SlideDeps } from './slideTools'
import type { WikiDeps } from './wikiTools'
import type { FormDeps } from './formTools'
import type { BoardDeps } from './boardTools'
import type { WhiteboardDeps } from './whiteboardTools'
import AssistantPanel from './AssistantPanel'
import { Lock, X } from 'lucide-react'
import { docKeyOf } from '../zk/session'
import { grantConsent, hasConsent, WHY } from '../zk/consent'

export type HostSource = { kind: 'doc'; deps: DocDeps } | { kind: 'sheet'; deps: SheetDeps } | { kind: 'slides'; deps: SlideDeps } | { kind: 'wiki'; deps: WikiDeps } | { kind: 'form'; deps: FormDeps } | { kind: 'board'; deps: BoardDeps } | { kind: 'whiteboard'; deps: WhiteboardDeps }

/** Loads the connection settings and the right tool set for the file, then shows the panel. */
export default function AssistantHost({ source, docId, user, onClose, initialPrompt }: { source: HostSource; docId: string; user: User; onClose: () => void; initialPrompt?: string | null }) {
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [adapter, setAdapter] = useState<Adapter | null>(null)
  const encrypted = !!docKeyOf(docId)
  const [agreed, setAgreed] = useState(hasConsent('koko'))
  const src = useRef(source); src.current = source
  const kind = source.kind

  useEffect(() => { api.aiSettings().then(setSettings).catch(() => setSettings({ configured: false, models: [], selected: null })) }, [])
  useEffect(() => {
    let alive = true
    if (kind === 'doc') import('./docTools').then((m) => { if (alive) setAdapter(m.createDocAdapter(live('doc'))) })
    else if (kind === 'sheet') import('./sheetTools').then((m) => { if (alive) setAdapter(m.createSheetAdapter(live('sheet'))) })
    else if (kind === 'wiki') import('./wikiTools').then((m) => { if (alive) setAdapter(m.createWikiAdapter(live('wiki'))) })
    else if (kind === 'form') import('./formTools').then((m) => { if (alive) setAdapter(m.createFormAdapter(live('form'))) })
    else if (kind === 'whiteboard') import('./whiteboardTools').then((m) => { if (alive) setAdapter(m.createWhiteboardAdapter(live('whiteboard'))) })
    else if (kind === 'board') import('./boardTools').then((m) => { if (alive) setAdapter(m.createBoardAdapter(live('board'))) })
    else import('./slideTools').then((m) => { if (alive) setAdapter(m.createSlidesAdapter(live('slides'))) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])

  // deps are read through a ref so the adapter always sees the latest state without being rebuilt
  function live(_k: 'doc'): DocDeps
  function live(_k: 'sheet'): SheetDeps
  function live(_k: 'slides'): SlideDeps
  function live(_k: 'wiki'): WikiDeps
  function live(_k: 'form'): FormDeps
  function live(_k: 'board'): BoardDeps
  function live(_k: 'whiteboard'): WhiteboardDeps
  function live(_k: 'doc' | 'sheet' | 'slides' | 'wiki' | 'form' | 'board' | 'whiteboard'): any { return new Proxy({}, { get: (_t, p) => (src.current.deps as any)[p] }) }
  const ready = useMemo(() => !!adapter && !!settings, [adapter, settings])
  if (encrypted && !agreed) return (   // Koko works by sending the document's text through the server to an AI service: that needs a yes first
    <div className="side-body" style={{ padding: 20, display: 'grid', gap: 12, alignContent: 'start' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><b><Lock size={16} style={{ verticalAlign: -3 }} /> Koko and encryption</b><button className="icon-btn" aria-label="Close" onClick={onClose}><X size={18} /></button></div>
      <p className="muted" style={{ margin: 0 }}>{WHY.koko.text}</p>
      <button className="btn btn-pill btn-primary" onClick={() => { grantConsent('koko'); setAgreed(true) }}>{WHY.koko.label}</button>
    </div>)
  if (!ready) return <div className="side-body"><div className="spinner" style={{ margin: '40px auto' }} /></div>
  return <AssistantPanel adapter={adapter!} docId={docId} user={user} settings={settings} onSettings={setSettings} onClose={onClose} initialPrompt={initialPrompt} />
}

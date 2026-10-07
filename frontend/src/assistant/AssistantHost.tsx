import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type AiSettings, type User } from '../api'
import type { Adapter } from './adapter'
import type { DocDeps } from './docTools'
import type { SheetDeps } from './sheetTools'
import type { SlideDeps } from './slideTools'
import type { WikiDeps } from './wikiTools'
import AssistantPanel from './AssistantPanel'

export type HostSource = { kind: 'doc'; deps: DocDeps } | { kind: 'sheet'; deps: SheetDeps } | { kind: 'slides'; deps: SlideDeps } | { kind: 'wiki'; deps: WikiDeps }

/** Loads the connection settings and the right tool set for the file, then shows the panel. */
export default function AssistantHost({ source, docId, user, onClose, initialPrompt }: { source: HostSource; docId: string; user: User; onClose: () => void; initialPrompt?: string | null }) {
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [adapter, setAdapter] = useState<Adapter | null>(null)
  const src = useRef(source); src.current = source
  const kind = source.kind

  useEffect(() => { api.aiSettings().then(setSettings).catch(() => setSettings({ configured: false, source: null, base_url: '', model: '', key_hint: null, server_default: false })) }, [])
  useEffect(() => {
    let alive = true
    if (kind === 'doc') import('./docTools').then((m) => { if (alive) setAdapter(m.createDocAdapter(live('doc'))) })
    else if (kind === 'sheet') import('./sheetTools').then((m) => { if (alive) setAdapter(m.createSheetAdapter(live('sheet'))) })
    else if (kind === 'wiki') import('./wikiTools').then((m) => { if (alive) setAdapter(m.createWikiAdapter(live('wiki'))) })
    else import('./slideTools').then((m) => { if (alive) setAdapter(m.createSlidesAdapter(live('slides'))) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])

  // deps are read through a ref so the adapter always sees the latest state without being rebuilt
  function live(_k: 'doc'): DocDeps
  function live(_k: 'sheet'): SheetDeps
  function live(_k: 'slides'): SlideDeps
  function live(_k: 'wiki'): WikiDeps
  function live(_k: 'doc' | 'sheet' | 'slides' | 'wiki'): any { return new Proxy({}, { get: (_t, p) => (src.current.deps as any)[p] }) }
  const ready = useMemo(() => !!adapter && !!settings, [adapter, settings])
  if (!ready) return <div className="side-body"><div className="spinner" style={{ margin: '40px auto' }} /></div>
  return <AssistantPanel adapter={adapter!} docId={docId} user={user} settings={settings} onSettings={setSettings} onClose={onClose} initialPrompt={initialPrompt} />
}

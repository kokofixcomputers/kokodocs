import { useEffect, useState } from 'react'
import { FileText, PenTool, Presentation, Sheet, Square } from 'lucide-react'
import { setDocToken } from '../api'
import { DeckViewer } from './DeckViewer'
import { hue } from './util'
import type { Call, Share } from './types'

const ICON = { doc: FileText, sheet: Sheet, slides: Presentation, whiteboard: PenTool }

/** The document being edited together. It is the real editor, inside the meeting, opened with a key for this meeting (so people without an account can edit too). */
function EmbeddedDoc({ call, share }: { call: Call; share: Share }) {
  const [src, setSrc] = useState<{ url: string; key: string } | null>(null)
  const [err, setErr] = useState('')
  const canEdit = call.perms().edit
  useEffect(() => {
    let dead = false
    setSrc(null); setErr('')
    call.shareToken().then((t) => {
      if (dead) return
      setDocToken(t.doc_id, t.token)
      try { if (!JSON.parse(sessionStorage.getItem('koko.guest') ?? 'null')?.name) throw 0 } catch { sessionStorage.setItem('koko.guest', JSON.stringify({ name: call.name, color: `hsl(${hue(call.name)} 55% 45%)` })) }   // a guest's cursor carries the name they gave
      setSrc({ url: `/d/${t.doc_id}?embed=1`, key: `${share.id}:${t.role}` })
    }).catch((e) => setErr((e as Error).message))
    return () => { dead = true }
  }, [call, share.id, share.edit, canEdit])
  if (err) return <div className="deck-msg"><p>{err}</p></div>
  if (!src) return <div className="deck-msg"><span className="spinner" /><p>Opening {share.title}…</p></div>
  return <iframe key={src.key} className="shared-frame" src={src.url} title={share.title} allow="clipboard-read; clipboard-write" />
}

/** What the meeting is looking at when someone shares a document or a presentation: it takes the place of the video grid, which moves to the side. */
export function SharedStage({ call, share }: { call: Call; share: Share }) {
  const me = call.me(), mine = share.by_id === me.id, mayControl = mine || me.manager
  const Icon = ICON[share.doc_kind] ?? FileText
  const canEdit = call.perms().edit
  return (
    <div className="shared">
      <header className="shared-head">
        <Icon size={17} />
        <div className="who"><b>{share.title}</b><span>{share.kind === 'present' ? 'Presented' : 'Edited together'} · {mine ? 'by you' : `shared by ${share.by}`}</span></div>
        {share.kind === 'collab' && (mayControl
          ? <button className="btn btn-soft btn-pill btn-sm" onClick={() => call.setShareEdit(!share.edit)} title="Whether everyone can type, or only watch">{share.edit ? 'Everyone can edit' : 'View only for others'}</button>
          : <span className="meet-chip">{share.edit && canEdit ? 'You can edit' : 'View only'}</span>)}
        {mayControl && <button className="btn btn-danger btn-pill btn-sm" onClick={() => call.stopShare()}><Square size={12} fill="currentColor" />{share.kind === 'present' ? 'Stop presenting' : 'Stop sharing'}</button>}
      </header>
      <div className="shared-body">{share.kind === 'present' ? <DeckViewer call={call} share={share} /> : <EmbeddedDoc call={call} share={share} />}</div>
    </div>)
}

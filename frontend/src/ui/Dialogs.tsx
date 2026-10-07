import { useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'

type Req =
  | { kind: 'text'; title: string; value: string; label: string; placeholder?: string; resolve: (v: string | null) => void }
  | { kind: 'confirm'; title: string; text: string; label: string; danger?: boolean; resolve: (v: boolean) => void }

let push: ((r: Req) => void) | null = null

/** Promise-based replacements for window.prompt / window.confirm, rendered in the app's own style. */
export const askText = (o: { title: string; value?: string; label?: string; placeholder?: string }) =>
  new Promise<string | null>((resolve) => push?.({ kind: 'text', title: o.title, value: o.value ?? '', label: o.label ?? 'Save', placeholder: o.placeholder, resolve }))
export const askConfirm = (o: { title: string; text: string; label?: string; danger?: boolean }) =>
  new Promise<boolean>((resolve) => push?.({ kind: 'confirm', title: o.title, text: o.text, label: o.label ?? 'Confirm', danger: o.danger, resolve }))

export function DialogHost() {
  const [req, setReq] = useState<Req | null>(null)
  const [val, setVal] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => { push = (r) => { setReq(r); setVal(r.kind === 'text' ? r.value : '') }; return () => { push = null } }, [])
  useEffect(() => { if (req?.kind === 'text') setTimeout(() => input.current?.select(), 30) }, [req])

  if (!req) return null
  const done = (v: string | boolean | null) => { (req.resolve as (x: unknown) => void)(v); setReq(null) }

  return (
    <Modal title={req.title} onClose={() => done(req.kind === 'text' ? null : false)} width={420}>
      <form className="share-body" onSubmit={(e) => { e.preventDefault(); done(req.kind === 'text' ? (val.trim() || null) : true) }}>
        {req.kind === 'text' ? (
          <label className="field"><input ref={input} value={val} placeholder={req.placeholder} onChange={(e) => setVal(e.target.value)} maxLength={200} /></label>
        ) : <p className="muted dlg-text">{req.text}</p>}
        <div className="modal-actions dlg-actions">
          <button type="button" className="btn btn-pill btn-ghost" onClick={() => done(req.kind === 'text' ? null : false)}>Cancel</button>
          <button className={`btn btn-pill ${req.kind === 'confirm' && req.danger ? 'btn-danger' : 'btn-primary'}`} autoFocus={req.kind === 'confirm'}>{req.label}</button>
        </div>
      </form>
    </Modal>
  )
}

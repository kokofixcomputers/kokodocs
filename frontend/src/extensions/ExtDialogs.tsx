import { useEffect, useRef, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { cleanFields, sanitizeHtml, useExtensions, type ExtDialog } from './runtime'
import { Field } from './Field'

/** Popups that extensions ask for. The window, its title line and its buttons belong to the app, so an extension can't pass itself off as something else. */
export function ExtDialogHost() {
  const { dialogs } = useExtensions()
  const d = dialogs[0]
  return d ? <DialogView key={d.id} d={d} /> : null
}

const s = (v: unknown, max = 400) => (typeof v === 'string' ? v.slice(0, max) : '')

function DialogView({ d }: { d: ExtDialog }) {
  const spec = d.spec ?? {}, kind: string = spec.kind
  const fields = kind === 'modal' ? cleanFields(spec.fields, d.ext) : []
  const [vals, setVals] = useState<Record<string, unknown>>(() => Object.fromEntries(fields.map((f) => [f.key, f.default ?? (f.type === 'toggle' ? false : '')])))
  const [text, setText] = useState(s(spec.value, 4000))
  const html = useRef<HTMLDivElement>(null)
  useEffect(() => { if (html.current && kind === 'modal' && spec.html) html.current.replaceChildren(sanitizeHtml(s(spec.html, 20000))) }, [kind, spec.html])
  const close = () => d.resolve(kind === 'alert' ? true : kind === 'confirm' || kind === 'trust' ? false : null)
  const buttons: { id: string; label: string; primary?: boolean; danger?: boolean }[] = kind === 'modal'
    ? (Array.isArray(spec.buttons) && spec.buttons.length ? spec.buttons.slice(0, 4).map((b: any, i: number) => ({ id: s(b?.id, 40) || `b${i}`, label: s(b?.label, 40) || 'OK', primary: !!b?.primary, danger: !!b?.danger })) : [{ id: 'ok', label: 'Done', primary: true }])
    : []
  const title = s(spec.title, 80) || (kind === 'trust' ? 'Full access request' : kind === 'confirm' ? 'Are you sure?' : kind === 'prompt' ? 'Enter a value' : d.extName)

  return (
    <Modal title={title} onClose={close} width={Math.min(Math.max(Number(spec.width) || 460, 340), 720)}>
      <div className="ext-dlg">
        <p className="ext-dlg-from">From the extension “{d.extName}”</p>
        {kind === 'trust' && (
          <>
            <p className="ext-dlg-warn"><ShieldAlert size={18} /><span>“{d.extName}” asks to run <b>outside the sandbox</b>. It could then read and change everything you can: your documents and files, your account, and it could use the internet. Only allow code you wrote or trust completely.</span></p>
            {s(spec.reason) && <p className="ext-dlg-msg"><b>Its reason:</b> {s(spec.reason, 400)}</p>}
            <div className="modal-actions"><button className="btn btn-pill btn-ghost" onClick={() => d.resolve(false)}>Not now</button><button className="btn btn-pill btn-primary" onClick={() => d.resolve(true)}>Allow full access</button></div>
          </>
        )}
        {kind === 'alert' && (<><p className="ext-dlg-msg">{s(spec.message, 2000)}</p><div className="modal-actions"><button className="btn btn-pill btn-primary" autoFocus onClick={() => d.resolve(true)}>{s(spec.okLabel, 30) || 'OK'}</button></div></>)}
        {kind === 'confirm' && (<><p className="ext-dlg-msg">{s(spec.message, 2000)}</p><div className="modal-actions"><button className="btn btn-pill btn-ghost" onClick={() => d.resolve(false)}>{s(spec.cancelLabel, 30) || 'Cancel'}</button><button className={`btn btn-pill ${spec.danger ? 'btn-danger' : 'btn-primary'}`} autoFocus onClick={() => d.resolve(true)}>{s(spec.okLabel, 30) || 'OK'}</button></div></>)}
        {kind === 'prompt' && (
          <form onSubmit={(e) => { e.preventDefault(); d.resolve(text) }}>
            <p className="ext-dlg-msg">{s(spec.message, 2000)}</p>
            <span className="field">{spec.multiline ? <textarea rows={4} autoFocus value={text} maxLength={4000} placeholder={s(spec.placeholder, 100)} onChange={(e) => setText(e.target.value)} /> : <input autoFocus value={text} maxLength={4000} placeholder={s(spec.placeholder, 100)} onChange={(e) => setText(e.target.value)} />}</span>
            <div className="modal-actions"><button type="button" className="btn btn-pill btn-ghost" onClick={() => d.resolve(null)}>Cancel</button><button type="submit" className="btn btn-pill btn-primary">{s(spec.okLabel, 30) || 'OK'}</button></div>
          </form>
        )}
        {kind === 'modal' && (
          <>
            {spec.html && <div ref={html} className="ext-dlg-html" />}
            {fields.length > 0 && <div className="ext-cfg" style={{ marginTop: 0 }}>{fields.map((f) => <Field key={f.key} f={f} value={vals[f.key]} set={(v) => setVals((m) => ({ ...m, [f.key]: v }))} />)}</div>}
            <div className="modal-actions">
              <button className="btn btn-pill btn-ghost" onClick={() => d.resolve(null)}>Cancel</button>
              {buttons.map((b) => <button key={b.id} className={`btn btn-pill ${b.danger ? 'btn-danger' : b.primary ? 'btn-primary' : 'btn-soft'}`} onClick={() => d.resolve({ button: b.id, values: vals })}>{b.label}</button>)}
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

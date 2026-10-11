import { useEffect, useState } from 'react'
import { Pencil } from 'lucide-react'
import { api, type DocInfo } from '../api'
import { useAuth } from '../auth'
import { Modal } from '../ui/Modal'
import { toast } from '../ui/Toast'

/** "Request edit access" for people who can only view: emails the owner, who can say yes from the Share dialog. */
export function RequestAccess({ info }: { info: DocInfo }) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  if (info.role !== 'viewer' || !user || info.kind === 'form') return null
  const send = async () => {
    setBusy(true)
    try { await api.requestAccess(info.id, msg.trim()); setSent(true); toast(`${info.owner ?? 'The owner'} has been emailed`); setOpen(false) }
    catch (e) { toast((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <>
      <button className="btn btn-pill btn-soft req-edit" onClick={() => setOpen(true)} disabled={sent}><Pencil size={16} /><span className="lbl">{sent ? 'Requested' : 'Request edit access'}</span></button>
      {open && (
        <Modal title="Request edit access" onClose={() => setOpen(false)} width={440}>
          <p className="muted">We’ll email {info.owner ?? 'the owner'} that you’d like to edit “{info.title}”. They can say yes from the Share dialog.</p>
          <label className="field"><textarea rows={3} maxLength={500} placeholder="Add a note (optional)" value={msg} onChange={(e) => setMsg(e.target.value)} style={{ width: '100%', resize: 'vertical', background: 'transparent', border: 0, outline: 0, color: 'inherit', font: 'inherit' }} /></label>
          <div className="modal-actions">
            <button className="btn btn-pill btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-pill btn-primary" disabled={busy} onClick={send}>{busy ? <span className="spinner sm" /> : 'Send request'}</button>
          </div>
        </Modal>
      )}
    </>
  )
}

/** A link from a request email or notification (/d/<id>?share=1) opens the Share dialog for the owner. */
export function useOpenShareFromUrl(canManage: boolean, setShare: (b: boolean) => void) {
  useEffect(() => {
    if (!canManage || new URLSearchParams(location.search).get('share') !== '1') return
    setShare(true); history.replaceState(null, '', location.pathname)
  }, [canManage, setShare])
}

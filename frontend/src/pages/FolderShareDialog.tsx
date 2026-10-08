import { useEffect, useState } from 'react'
import { Check, Copy, Eye, Folder as FolderIcon, Globe, Lock, Mail, Pencil, UserPlus, X } from 'lucide-react'
import { api, type Folder } from '../api'
import { Avatar } from '../ui/Avatar'
import { Modal } from '../ui/Modal'
import { Select } from '../ui/Select'
import { toast } from '../ui/Toast'

type R = 'viewer' | 'editor'
const RoleSelect = ({ value, onChange }: { value: R; onChange: (r: R) => void }) => (
  <Select label="Access" value={value} options={[{ value: 'viewer', label: 'Can view' }, { value: 'editor', label: 'Can edit' }]} onChange={onChange} />
)

/** Share a whole folder: everything inside it, now and later, including subfolders. */
export function FolderShareDialog({ folder, ownerName, ownerEmail, onClose, onSaved }: {
  folder: Folder; ownerName: string; ownerEmail: string; onClose: () => void; onSaved: () => void
}) {
  const [shares, setShares] = useState<{ email: string; role: R; name: string | null }[]>([])
  const [loaded, setLoaded] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<R>('viewer')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [access, setAccess] = useState<'restricted' | 'anyone'>(folder.link_access ?? 'restricted')
  const [linkRole, setLinkRole] = useState<R>(folder.link_role ?? 'viewer')
  const [copied, setCopied] = useState(false)

  useEffect(() => { api.getFolderSharing(folder.id).then((r) => { setShares(r.shares); setAccess(r.link_access); setLinkRole(r.link_role); setLoaded(true) }).catch((e) => setErr(e.message)) }, [folder.id])

  const add = () => {
    const e = email.trim().toLowerCase()
    if (!e) return
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { setErr('Enter a valid email address'); return }
    setErr('')
    setShares((l) => [...l.filter((s) => s.email !== e), { email: e, role, name: null }])
    setEmail('')
  }
  const copy = async () => {
    await navigator.clipboard.writeText(`${location.origin}/f/${folder.id}`)
    setCopied(true); setTimeout(() => setCopied(false), 1800)
  }
  const save = async () => {
    setBusy(true); setErr('')
    try {
      const pending = email.trim() ? [...shares, { email: email.trim().toLowerCase(), role, name: null }] : shares
      await api.putFolderSharing(folder.id, { shares: pending, link_access: access, link_role: linkRole })
      toast(pending.length || access === 'anyone' ? 'Folder sharing saved' : 'Folder is no longer shared')
      onSaved(); onClose()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <Modal title={`Share “${folder.name}”`} onClose={onClose} width={540}>
      <div className="share-body">
        <p className="muted folder-share-note"><FolderIcon size={16} />Everything in this folder, including subfolders and documents you add later, is shared with these people.</p>
        <div className="add-row">
          <label className="field"><Mail size={17} />
            <input placeholder="Add people by email" value={email} onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} />
          </label>
          <RoleSelect value={role} onChange={setRole} />
          <button className="btn btn-pill btn-soft" onClick={add}><UserPlus size={16} />Add</button>
        </div>
        <div className="people">
          <div className="person">
            <Avatar name={ownerName} color="#111111" /><div className="p-info"><b>{ownerName} (you)</b><span>{ownerEmail}</span></div>
            <span className="p-role">Owner</span>
          </div>
          {shares.map((s) => (
            <div className="person rise" key={s.email}>
              <Avatar name={s.name ?? s.email} color="#8b8aa5" />
              <div className="p-info"><b>{s.name ?? s.email}</b>{s.name && <span>{s.email}</span>}</div>
              <RoleSelect value={s.role} onChange={(r) => setShares((l) => l.map((x) => (x.email === s.email ? { ...x, role: r } : x)))} />
              <button className="icon-btn sm" aria-label="Remove" onClick={() => setShares((l) => l.filter((x) => x.email !== s.email))}><X size={16} /></button>
            </div>
          ))}
          {loaded && shares.length === 0 && <p className="muted side-empty">Not shared with anyone yet.</p>}
        </div>
        <h4>General access</h4>
        <div className="access-cards">
          {([
            ['restricted', 'Restricted', 'Only the people listed above can open it', <Lock size={18} key="l" />],
            ['anyone', 'Anyone with the link', 'No sign-in needed. They can browse everything inside', <Globe size={18} key="g" />],
          ] as const).map(([id, title, sub, icon]) => (
            <button key={id} className={`access-card ${access === id ? 'on' : ''}`} onClick={() => setAccess(id)}>
              <span className="a-ico">{icon}</span><span className="a-text"><b>{title}</b><span>{sub}</span></span>
              {access === id && <Check size={18} className="a-check" />}
            </button>
          ))}
        </div>
        {access === 'anyone' && (
          <div className="link-perm rise">
            <div className="link-perm-text"><b>What can people with the link do?</b>
              <span>{linkRole === 'editor' ? 'They can open and edit every document in this folder.' : 'They can open and read every document, but not change them.'}</span>
            </div>
            <div className="seg">
              <button className={linkRole === 'viewer' ? 'on' : ''} onClick={() => setLinkRole('viewer')}><Eye size={15} />View only</button>
              <button className={linkRole === 'editor' ? 'on' : ''} onClick={() => setLinkRole('editor')}><Pencil size={15} />Can edit</button>
            </div>
          </div>
        )}
        {err && <p className="form-error">{err}</p>}
        <div className="modal-actions">
          <button className="btn btn-pill btn-ghost" onClick={access === 'anyone' ? copy : onClose}>
            {access === 'anyone' ? <>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? 'Copied' : 'Copy link'}</> : 'Cancel'}
          </button>
          <button className="btn btn-pill btn-primary" disabled={busy} onClick={save}>{busy ? <span className="spinner sm" /> : 'Save'}</button>
        </div>
      </div>
    </Modal>
  )
}

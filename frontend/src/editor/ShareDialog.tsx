import { useEffect, useState } from 'react'
import { Check, Copy, Eye, Globe, KeyRound, Lock, Mail, Pencil, UserPlus, X } from 'lucide-react'
import { api, type DocInfo, type LinkAccess, type Sharing } from '../api'
import { useAuth } from '../auth'
import { Avatar } from '../ui/Avatar'
import { Select } from '../ui/Select'
import { Modal } from '../ui/Modal'
import { toast } from '../ui/Toast'
import { ZkShareDialog } from '../zk/ZkShareDialog'

type R = 'viewer' | 'editor' | 'manager'
const ACCESS: { id: LinkAccess; title: string; sub: string; icon: React.ReactNode }[] = [
  { id: 'restricted', title: 'Restricted', sub: 'Only the people listed above can open it', icon: <Lock size={18} /> },
  { id: 'anyone', title: 'Anyone with the link', sub: 'No sign-in needed', icon: <Globe size={18} /> },
  { id: 'password', title: 'Password protected', sub: 'Anyone with the link and the password', icon: <KeyRound size={18} /> },
]
const RoleSelect = ({ value, onChange, form }: { value: R; onChange: (r: R) => void; form?: boolean }) => (
  <Select label="Permission" value={value} onChange={onChange} options={[{ value: 'viewer', label: form ? 'Can fill out' : 'Can view' }, { value: 'editor', label: 'Can edit' }, { value: 'manager', label: 'Can manage' }]} />
)

/** Encrypted documents have their own dialog: sharing means handing out keys, and there are no links. */
export function ShareDialog(p: { info: DocInfo; onClose: () => void }) {
  return p.info.zk ? <ZkShareDialog {...p} /> : <PlainShareDialog {...p} />
}

function PlainShareDialog({ info, onClose }: { info: DocInfo; onClose: () => void }) {
  const { user } = useAuth()
  const owner = info.role === 'owner' || info.role === 'manager'   // both can change who has access; only the owner can delete
  const isOwner = info.role === 'owner'
  const isForm = info.kind === 'form'
  const [data, setData] = useState<Sharing | null>(null)
  const [access, setAccess] = useState<LinkAccess>(info.link.access)
  const [linkRole, setLinkRole] = useState<R>(info.link.role)
  const [password, setPassword] = useState('')
  const [shares, setShares] = useState<{ email: string; role: R; name: string | null }[]>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<R>(info.kind === 'form' ? 'viewer' : 'editor')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!owner) return
    api.getSharing(info.id).then((s) => {
      setData(s); setAccess(s.link_access); setLinkRole(s.link_role); setShares(s.shares)
    }).catch((e) => setErr(e.message))
  }, [info.id, owner])

  const add = () => {
    const e = email.trim().toLowerCase()
    if (!e) return
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { setErr('Enter a valid email address'); return }
    setErr('')
    setShares((l) => [...l.filter((s) => s.email !== e), { email: e, role, name: null }])
    setEmail('')
  }

  const copy = async () => {
    await navigator.clipboard.writeText(`${location.origin}/d/${info.id}`)
    setCopied(true); setTimeout(() => setCopied(false), 1800)
  }

  const save = async () => {
    setBusy(true); setErr('')
    try {
      const pending = email.trim() ? [...shares, { email: email.trim().toLowerCase(), role, name: null }] : shares
      const r = await api.putSharing(info.id, {
        link_access: access, link_role: isForm ? 'viewer' : linkRole, shares: pending,
        ...(access === 'password' && password ? { password } : {}),
      })
      setData(r); toast('Sharing settings saved'); onClose()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <Modal title={`Share “${info.title}”`} onClose={onClose} width={560}>
      {owner ? (
        <div className="share-body">
          <div className="add-row">
            <label className="field"><Mail size={17} />
              <input placeholder="Add people by email" value={email} onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} />
            </label>
            <RoleSelect value={role} onChange={setRole} form={isForm} />
            <button className="btn btn-pill btn-soft" onClick={add}><UserPlus size={16} />Add</button>
          </div>

          <div className="people">
            <div className="person">
              <Avatar name={info.owner ?? 'Owner'} color="#111111" /><div className="p-info"><b>{info.owner}{isOwner ? ' (you)' : ''}</b><span>{info.owner_email}</span></div>
              <span className="p-role">Owner</span>
            </div>
            {shares.map((s) => (
              <div className="person rise" key={s.email}>
                <Avatar name={s.name ?? s.email} color="#8b8aa5" />
                <div className="p-info"><b>{s.name ?? s.email}{user?.email === s.email ? ' (you)' : ''}</b>{s.name && <span>{s.email}</span>}</div>
                <RoleSelect form={isForm} value={s.role} onChange={(r) => setShares((l) => l.map((x) => (x.email === s.email ? { ...x, role: r } : x)))} />
                <button className="icon-btn sm" aria-label="Remove" onClick={() => setShares((l) => l.filter((x) => x.email !== s.email))}><X size={16} /></button>
              </div>
            ))}
          </div>

          <h4>General access</h4>
          <div className="access-cards">
            {ACCESS.map((a) => (
              <button key={a.id} className={`access-card ${access === a.id ? 'on' : ''}`} onClick={() => setAccess(a.id)}>
                <span className="a-ico">{a.icon}</span>
                <span className="a-text"><b>{a.title}</b><span>{a.sub}</span></span>
                {access === a.id && <Check size={18} className="a-check" />}
              </button>
            ))}
          </div>

          {access !== 'restricted' && isForm && (
            <div className="link-perm rise">
              <div className="link-perm-text"><b>People with the link can fill out this form</b>
                <span>Links never allow editing a form. To let someone edit it, add them above with “Can edit”.</span>
              </div>
            </div>
          )}
          {access !== 'restricted' && !isForm && (
            <div className="link-perm rise">
              <div className="link-perm-text"><b>What can people with the link do?</b>
                <span>{linkRole === 'editor' ? 'Anyone who opens the link can change this document.' : 'Anyone who opens the link can read but not change it.'}</span>
              </div>
              <div className="seg">
                <button className={linkRole === 'viewer' ? 'on' : ''} onClick={() => setLinkRole('viewer')}><Eye size={15} />View only</button>
                <button className={linkRole === 'editor' ? 'on' : ''} onClick={() => setLinkRole('editor')}><Pencil size={15} />Can edit</button>
              </div>
            </div>
          )}
          {access === 'password' && (
            <label className="field rise"><KeyRound size={17} />
              <input type="password" placeholder={data?.has_password ? 'Leave blank to keep the current password' : 'Choose a password'}
                value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </label>
          )}
          {err && <p className="form-error">{err}</p>}
          {!isOwner && <p className="muted manage-note">You can manage who has access. Only the owner can delete this {isForm ? 'form' : info.kind === 'sheet' ? 'spreadsheet' : info.kind === 'slides' ? 'presentation' : 'document'}.</p>}
          <div className="modal-actions">
            <button className="btn btn-pill btn-ghost" onClick={copy}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? 'Copied' : 'Copy link'}</button>
            <button className="btn btn-pill btn-primary" disabled={busy} onClick={save}>{busy ? <span className="spinner sm" /> : 'Save'}</button>
          </div>
        </div>
      ) : (
        <div className="share-body">
          <p className="muted">Only the owner can change sharing settings. You have <b>{info.role === 'editor' ? 'edit' : isForm ? 'fill-out' : 'view'}</b> access.</p>
          <div className="modal-actions">
            <button className="btn btn-pill btn-primary" onClick={copy}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? 'Copied' : 'Copy link'}</button>
          </div>
        </div>
      )}
    </Modal>
  )
}

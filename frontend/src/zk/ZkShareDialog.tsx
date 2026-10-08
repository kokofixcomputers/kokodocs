import { useEffect, useState } from 'react'
import { Check, Copy, Lock, Mail, ShieldCheck, UserPlus, X } from 'lucide-react'
import { api, request, type DocInfo, type Sharing } from '../api'
import { useAuth } from '../auth'
import { Avatar } from '../ui/Avatar'
import { Modal } from '../ui/Modal'
import { Select } from '../ui/Select'
import { toast } from '../ui/Toast'
import { hideBusy, showBusy } from './busy'
import { fingerprint } from './crypto'
import { keyFor, rotateKey, sealKeyFor } from './flows'
import { docKeyOf } from './session'

type R = 'viewer' | 'editor' | 'manager'
const RoleSelect = ({ value, onChange }: { value: R; onChange: (r: R) => void }) => (
  <Select label="Permission" value={value} onChange={onChange} options={[{ value: 'viewer', label: 'Can view' }, { value: 'editor', label: 'Can edit' }, { value: 'manager', label: 'Can manage' }]} />
)

/** Sharing an encrypted document: only with people who have encryption on, by giving each of them the document's key sealed to their public key. */
export function ZkShareDialog({ info, onClose }: { info: DocInfo; onClose: () => void }) {
  const { user } = useAuth()
  const owner = info.role === 'owner' || info.role === 'manager'
  const [data, setData] = useState<Sharing | null>(null)
  const [shares, setShares] = useState<{ email: string; role: R; name: string | null }[]>([])
  const [prints, setPrints] = useState<Record<string, string>>({})
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<R>('editor')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!owner) return
    api.getSharing(info.id).then((s) => { setData(s); setShares(s.shares) }).catch((e) => setErr(e.message))
  }, [info.id, owner])

  const add = async () => {
    const e = email.trim().toLowerCase()
    if (!e) return
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { setErr('Enter a valid email address'); return }
    setErr(''); setBusy(true)
    try {
      const k = await keyFor(e)   // fails with a plain explanation if they haven't turned encryption on
      setPrints((p) => ({ ...p, [e]: '' })); void fingerprint(k.pub).then((f) => setPrints((p) => ({ ...p, [e]: f })))
      setShares((l) => [...l.filter((s) => s.email !== e), { email: e, role, name: k.name }])
      setEmail('')
    } catch (x) { setErr((x as Error).message) } finally { setBusy(false) }
  }

  const save = async () => {
    const key = docKeyOf(info.id)
    if (!key) { setErr('The key to this document isn\'t available'); return }
    setBusy(true); setErr('')
    try {
      const have = new Set((data?.shares ?? []).map((s) => s.email))
      const body: { email: string; role: R; sealed?: string }[] = []
      for (const s of shares) body.push({ email: s.email, role: s.role, ...(have.has(s.email) ? {} : { sealed: await sealKeyFor((await keyFor(s.email)).pub, key) }) })
      const r = await request<Sharing & { removed: string[] }>(`/api/zk/docs/${info.id}/sharing`, { method: 'PUT', body: JSON.stringify({ shares: body }) }, info.id)
      if (r.removed.length) {   // someone lost access: a new key, so what they could still fetch is useless from now on
        showBusy('Re-encrypting…', 'Changing the document\'s key so the people you removed can\'t read anything new')
        try {
          const people = [info.owner_email, ...r.shares.map((s) => s.email)]
          const grants = await Promise.all(people.map(async (e) => ({ email: e, pub: (await keyFor(e)).pub })))
          await rotateKey(info, grants, info.title)
        } finally { hideBusy() }
      }
      toast('Sharing settings saved'); onClose()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <Modal title={`Share “${info.title}”`} onClose={onClose} width={560}>
      <div className="share-body">
        <p className="muted" style={{ margin: 0 }}><ShieldCheck size={15} style={{ verticalAlign: -3 }} /> This document is encrypted. It can only be shared with people who have turned on encryption, and there are no public links.</p>
        {owner ? (<>
          <div className="add-row">
            <label className="field"><Mail size={17} />
              <input placeholder="Add people by email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void add())} />
            </label>
            <RoleSelect value={role} onChange={setRole} />
            <button className="btn btn-pill btn-soft" disabled={busy} onClick={() => void add()}><UserPlus size={16} />Add</button>
          </div>
          <div className="people">
            <div className="person">
              <Avatar name={info.owner ?? 'Owner'} color="#111111" /><div className="p-info"><b>{info.owner}{info.role === 'owner' ? ' (you)' : ''}</b><span>{info.owner_email}</span></div>
              <span className="p-role">Owner</span>
            </div>
            {shares.map((s) => (
              <div className="person rise" key={s.email}>
                <Avatar name={s.name ?? s.email} color="#8b8aa5" />
                <div className="p-info"><b>{s.name ?? s.email}{user?.email === s.email ? ' (you)' : ''}</b><span>{s.name ? s.email : ''}{prints[s.email] ? <span className="zk-fp" title="Compare with what they see in Settings, Security, to be sure this key is really theirs"> {prints[s.email]}</span> : null}</span></div>
                <RoleSelect value={s.role} onChange={(r) => setShares((l) => l.map((x) => (x.email === s.email ? { ...x, role: r } : x)))} />
                <button className="icon-btn sm" aria-label="Remove" onClick={() => setShares((l) => l.filter((x) => x.email !== s.email))}><X size={16} /></button>
              </div>
            ))}
          </div>
          {err && <p className="form-error">{err}</p>}
          {info.role !== 'owner' && <p className="muted manage-note">You can manage who has access. Only the owner can delete this document.</p>}
          <div className="modal-actions">
            <button className="btn btn-pill btn-ghost" onClick={async () => { await navigator.clipboard.writeText(`${location.origin}/d/${info.id}`); setCopied(true); setTimeout(() => setCopied(false), 1800) }}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? 'Copied' : 'Copy link'}</button>
            <button className="btn btn-pill btn-primary" disabled={busy} onClick={save}>{busy ? <span className="spinner sm" /> : 'Save'}</button>
          </div>
          <p className="muted manage-note"><Lock size={13} style={{ verticalAlign: -2 }} /> The link only opens for people listed here. Removing someone changes the document's key, so they can't read what is written afterwards (they keep anything they already saw).</p>
        </>) : (
          <><p className="muted">Only the owner can change sharing settings.</p>
            <div className="modal-actions"><button className="btn btn-pill btn-primary" onClick={async () => { await navigator.clipboard.writeText(`${location.origin}/d/${info.id}`); setCopied(true); setTimeout(() => setCopied(false), 1800) }}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? 'Copied' : 'Copy link'}</button></div></>)}
        {!data && owner && !err && <span className="spinner" />}
      </div>
    </Modal>
  )
}

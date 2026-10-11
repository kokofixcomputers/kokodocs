import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { GitBranch, Loader2 } from 'lucide-react'
import { api, type DocInfo } from '../api'
import { askConfirm } from '../ui/Dialogs'
import { toast } from '../ui/Toast'

/** Fork a document, at a saved version or as it is now, into a new one of your own. */
export function BranchButton({ docId, title, versionId, icon = false }: { docId: string; title: string; versionId?: string; icon?: boolean }) {
  const nav = useNavigate()
  const [busy, setBusy] = useState(false)
  const name = title === 'this file' ? title : `“${title}”`
  const go = async () => {
    const ok = await askConfirm({ title: 'Branch this document?', text: versionId ? `This makes a new document from that saved version of ${name}. The original stays as it is.` : `This makes a copy of ${name} that you can change freely. The original stays as it is.`, label: 'Create branch' })
    if (!ok) return
    setBusy(true)
    try { const d = await api.branchDoc(docId, versionId); toast('Branch created'); nav(`/d/${d.id}`) }
    catch (e) { toast((e as Error).message) } finally { setBusy(false) }
  }
  return icon
    ? <button className="icon-btn" title="Branch: make a copy to experiment on" aria-label="Branch" onClick={go} disabled={busy}>{busy ? <Loader2 size={18} className="spin" /> : <GitBranch size={19} />}</button>
    : <button className="btn btn-soft btn-pill btn-sm" onClick={go} disabled={busy}>{busy ? <Loader2 size={14} className="spin" /> : <GitBranch size={14} />}Branch from this version</button>
}

/** "Branch of <original>" next to the title of a branch. */
export function BranchChip({ info }: { info: DocInfo }) {
  if (!info.branch) return null
  return <Link className="branch-chip" to={`/d/${info.branch.id}`} title={`Forked from “${info.branch.title}”${info.branch.label ? ` at ${info.branch.label}` : ''}`}><GitBranch size={13} />Branch of {info.branch.title || 'Untitled'}</Link>
}

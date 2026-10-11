import { useEffect, useMemo, useState } from 'react'
import * as Y from 'yjs'
import { GitCompareArrows } from 'lucide-react'
import { api, type DocSummary, type Version } from '../api'
import { Modal } from '../ui/Modal'
import { Select } from '../ui/Select'
import { DiffView, LayoutToggle, useSideBySide } from './VersionDiff'
import { diffLines, docLines } from './diff'
import { fullLabel } from './VersionHistory'

const load = async (fetcher: () => Promise<Uint8Array | ArrayBuffer>) => { const d = new Y.Doc(); Y.applyUpdate(d, new Uint8Array(await fetcher())); return d }

/** Compare this document with another one of yours, or with one of its own saved versions, side by side. */
export function CompareDialog({ docId, title, live, onClose }: { docId: string; title: string; live: Y.Doc; onClose: () => void }) {
  const [docs, setDocs] = useState<DocSummary[] | null>(null)
  const [versions, setVersions] = useState<Version[]>([])
  const [target, setTarget] = useState('')   // 'v:<version id>' or 'd:<doc id>'
  const [other, setOther] = useState<{ name: string; doc: Y.Doc } | null>(null)
  const [err, setErr] = useState('')
  const [side, setSide] = useSideBySide()

  useEffect(() => {
    let dead = false
    Promise.all([api.listDocs().catch(() => ({ mine: [], shared: [] })), api.listVersions(docId).catch(() => [] as Version[])]).then(([l, v]) => {
      if (dead) return
      setDocs([...l.mine, ...l.shared].filter((d) => d.id !== docId && d.kind === 'doc' && !d.zk))
      setVersions(v)
      if (v[0]) setTarget('v:' + v[0].id)
    })
    return () => { dead = true }
  }, [docId])

  useEffect(() => {
    if (!target) { setOther(null); return }
    let dead = false; setOther(null); setErr('')
    const [k, id] = [target.slice(0, 1), target.slice(2)]
    const name = k === 'v' ? (() => { const v = versions.find((x) => x.id === id); return v ? `${v.label ?? 'Saved version'} · ${fullLabel(v.created_at)}` : 'Saved version' })() : docs?.find((d) => d.id === id)?.title || 'Untitled'
    load(() => (k === 'v' ? api.versionData(docId, id) : api.docState(id))).then((doc) => { if (!dead) setOther({ name, doc }) }).catch((e) => { if (!dead) setErr(e.message || 'Could not load that document') })
    return () => { dead = true }
  }, [target, docId]) // eslint-disable-line react-hooks/exhaustive-deps

  const diff = useMemo(() => (other ? diffLines(docLines(other.doc), docLines(live), 3) : null), [other, live])
  const options = [
    ...versions.slice(0, 40).map((v) => ({ value: 'v:' + v.id, label: `Version: ${v.label ?? fullLabel(v.created_at)}` })),
    ...(docs ?? []).map((d) => ({ value: 'd:' + d.id, label: d.title || 'Untitled' })),
  ]

  return (
    <Modal title="Compare documents" onClose={onClose} width={1100}>
      <div className="cmp">
        <div className="cmp-bar">
          <span className="cmp-lbl">Compare “{title || 'Untitled'}” with</span>
          {options.length ? <Select label="Compare with" value={target || options[0].value} options={options} onChange={setTarget} /> : <span className="muted">{docs ? 'No other documents or saved versions yet.' : 'Loading…'}</span>}
          <LayoutToggle side={side} onChange={setSide} />
          {diff && !diff.same && <span className="vd-stats"><b className="add">+{diff.added}</b><b className="del">−{diff.removed}</b><b className="mod">~{diff.changed}</b></span>}
        </div>
        <p className="muted cmp-note">Left is the other document; right is this one. Green was added in this document, red is only in the other.</p>
        {err ? <p className="form-error">{err}</p> : !other && target ? <div className="splash small"><span className="spinner" /></div> : diff?.same ? (
          <div className="vd-empty"><GitCompareArrows size={30} /><b>No differences</b><span className="muted">The text is identical.</span></div>
        ) : diff ? <div className="cmp-scroll"><DiffView diff={diff} unit={['line', 'lines']} side={side} left={other!.name} right={`${title || 'Untitled'} (this document)`} /></div> : null}
      </div>
    </Modal>
  )
}

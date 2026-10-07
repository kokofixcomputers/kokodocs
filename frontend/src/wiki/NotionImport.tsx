import { useRef, useState } from 'react'
import { CheckCircle2, FileArchive, FolderTree, ImageIcon, Loader2, Upload } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { toast } from '../ui/Toast'
import { planSource, readSource, runImport, type RunResult, type Source } from './notionRun'
import type { Plan } from './notion'
import type * as Y from 'yjs'
import type { Tree } from './tree'

export function NotionImport({ ydoc, tree, upload, onClose, onOpen }: { ydoc: Y.Doc; tree: Tree; upload: (f: File) => Promise<string>; onClose: () => void; onOpen: (pageId: string) => void }) {
  const pick = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [src, setSrc] = useState<Source | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [images, setImages] = useState(true)
  const [wrap, setWrap] = useState(true)
  const [name, setName] = useState('Imported from Notion')
  const [progress, setProgress] = useState<{ done: number; total: number; what: string } | null>(null)
  const [result, setResult] = useState<RunResult | null>(null)
  const [drag, setDrag] = useState(false)

  const read = async (files: File[]) => {
    if (!files.length) return
    setErr(''); setBusy(true)
    try { const s = await readSource(files); setSrc(s); setPlan(planSource(s)) }
    catch (e) { setErr((e as Error).message); setSrc(null); setPlan(null) } finally { setBusy(false) }
  }
  const start = async () => {
    if (!src || !plan) return
    setErr(''); setBusy(true); setProgress({ done: 0, total: plan.items.length, what: 'Starting' })
    try { setResult(await runImport(plan, src, { ydoc, tree, upload, images, wrapper: wrap ? name.trim() || 'Imported from Notion' : null, onProgress: (done, total, what) => setProgress({ done, total, what }) })) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false); setProgress(null) }
  }
  const imgCount = plan ? plan.assets.length : 0

  return (
    <Modal title="Import from Notion" onClose={busy ? () => {} : onClose} width={580}>
      <div className="share-body nt-body">
        {result ? (
          <>
            <div className="nt-done"><CheckCircle2 size={34} /><b>Imported {result.pages} {result.pages === 1 ? 'page' : 'pages'}</b>
              <span>{result.folders} {result.folders === 1 ? 'folder' : 'folders'}{result.images ? `, ${result.images} ${result.images === 1 ? 'picture' : 'pictures'}` : ''}{result.skippedImages ? `. ${result.skippedImages} ${result.skippedImages === 1 ? 'picture was' : 'pictures were'} left out` : ''}.</span></div>
            <div className="modal-actions"><span /><span className="nt-btns">
              <button className="btn btn-pill btn-ghost" onClick={onClose}>Close</button>
              {result.first && <button className="btn btn-pill btn-primary" onClick={() => { onOpen(result.first!); onClose() }}>Open the first page</button>}</span></div>
          </>
        ) : !plan ? (
          <>
            <ol className="nt-steps">
              <li>In Notion, open the page or workspace, then <b>⋯ menu, Export</b>.</li>
              <li>Choose <b>Markdown &amp; CSV</b>, include sub-pages, and download the .zip.</li>
              <li>Drop that file here. It never leaves your browser except for the pictures and pages that go into this wiki.</li>
            </ol>
            <div className={`nt-drop ${drag ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); void read(Array.from(e.dataTransfer.files)) }} onClick={() => pick.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && pick.current?.click()}>
              {busy ? <Loader2 size={26} className="spin" /> : <Upload size={26} />}
              <b>{busy ? 'Reading the export' : 'Drop a Notion export here'}</b><span>or click to choose a .zip (or loose .md, .html and .csv files)</span>
            </div>
            <input ref={pick} type="file" multiple accept=".zip,.md,.html,.csv,.png,.jpg,.jpeg,.gif,.webp" hidden onChange={(e) => { void read(Array.from(e.target.files ?? [])); e.target.value = '' }} />
            {err && <p className="form-error">{err}</p>}
          </>
        ) : (
          <>
            <div className="nt-sum">
              <div><FileArchive size={18} /><b>{plan.pages}</b><span>{plan.pages === 1 ? 'page' : 'pages'}</span></div>
              <div><FolderTree size={18} /><b>{plan.folders}</b><span>{plan.folders === 1 ? 'folder' : 'folders'}</span></div>
              <div><ImageIcon size={18} /><b>{imgCount}</b><span>{imgCount === 1 ? 'picture' : 'pictures'}</span></div>
            </div>
            {plan.databases > 0 && <p className="muted hint" style={{ margin: 0 }}>{plan.databases} {plan.databases === 1 ? 'database becomes' : 'databases become'} a table page, with its rows as pages beside it (first 200 rows shown).</p>}
            <label className="nt-opt"><input type="checkbox" checked={images} onChange={(e) => setImages(e.target.checked)} />Import pictures (stored with this wiki and counted to its owner’s storage)</label>
            <label className="nt-opt"><input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} />Put everything in a folder called</label>
            {wrap && <label className="field compact"><input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} aria-label="Folder name" /></label>}
            {src && src.warnings.length > 0 && <p className="muted hint" style={{ margin: 0 }}>{src.warnings.slice(0, 3).join(' ')}</p>}
            {progress && (
              <div className="nt-progress" role="progressbar" aria-valuenow={progress.done} aria-valuemax={progress.total}>
                <div className="meter ok"><i style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} /></div>
                <span>{progress.what}: {progress.done} of {progress.total}</span>
              </div>)}
            {err && <p className="form-error">{err}</p>}
            <div className="modal-actions"><button className="btn btn-pill btn-ghost" disabled={busy} onClick={() => { setPlan(null); setSrc(null); setErr('') }}>Choose another file</button>
              <button className="btn btn-pill btn-primary" disabled={busy || !plan.pages} onClick={() => { void start().then(() => toast('Notion import finished')) }}>{busy ? <Loader2 size={16} className="spin" /> : null}Import {plan.pages} {plan.pages === 1 ? 'page' : 'pages'}</button></div>
          </>
        )}
      </div>
    </Modal>
  )
}

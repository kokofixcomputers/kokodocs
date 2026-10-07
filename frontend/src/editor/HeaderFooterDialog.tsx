import { useState } from 'react'
import { AlignCenter, AlignLeft, AlignRight } from 'lucide-react'
import { Modal } from '../ui/Modal'
import type { PageMeta } from './Pagination'

type Al = PageMeta['headerAlign']
const Align = ({ value, onChange }: { value: Al; onChange: (a: Al) => void }) => (
  <div className="seg mini">
    {([['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]] as const).map(([a, I]) => (
      <button key={a} className={value === a ? 'on' : ''} onClick={() => onChange(a)} aria-label={`Align ${a}`}><I size={16} /></button>
    ))}
  </div>
)

export function HeaderFooterDialog({ meta, onSave, onClose }: { meta: PageMeta; onSave: (m: PageMeta) => void; onClose: () => void }) {
  const [m, setM] = useState(meta)
  return (
    <Modal title="Header & footer" onClose={onClose}>
      <div className="share-body">
        <div className="hf-field">
          <div className="hf-head"><b>Header</b><Align value={m.headerAlign} onChange={(a) => setM({ ...m, headerAlign: a })} /></div>
          <label className="field"><input placeholder="Shown at the top of every page" value={m.header} onChange={(e) => setM({ ...m, header: e.target.value })} /></label>
        </div>
        <div className="hf-field">
          <div className="hf-head"><b>Footer</b><Align value={m.footerAlign} onChange={(a) => setM({ ...m, footerAlign: a })} /></div>
          <label className="field"><input placeholder="Shown at the bottom of every page" value={m.footer} onChange={(e) => setM({ ...m, footer: e.target.value })} /></label>
        </div>
        <p className="muted hint">Use <code>{'{page}'}</code> for the page number and <code>{'{pages}'}</code> for the page count. You can also double-click a header or footer on the page.</p>
        <div className="modal-actions">
          <button className="btn btn-pill btn-ghost" onClick={() => setM({ ...m, header: '', footer: 'Page {page} of {pages}', headerAlign: 'left', footerAlign: 'center' })}>Reset</button>
          <button className="btn btn-pill btn-primary" onClick={() => { onSave(m); onClose() }}>Apply</button>
        </div>
      </div>
    </Modal>
  )
}

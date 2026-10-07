import { useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Select } from '../ui/Select'
import { fromMatrix, toMatrix } from './matrix'
import type { ChartKind, El } from './themes'

const KINDS: { value: ChartKind; label: string }[] = [{ value: 'column', label: 'Columns' }, { value: 'bar', label: 'Bars' }, { value: 'line', label: 'Line' }, { value: 'area', label: 'Area' }, { value: 'pie', label: 'Pie' }]

/** Type the data for a chart straight into a grid: series names across the top, labels down the side. */
export function ChartDataDialog({ el, onSave, onClose }: { el: El; onSave: (patch: Partial<El>) => void; onClose: () => void }) {
  const [m, setM] = useState<string[][]>(() => { const x = toMatrix(el); return x.length ? x : [['', 'Series 1'], ['', '']] })
  const [kind, setKind] = useState<ChartKind>(el.chart ?? 'column')
  const [title, setTitle] = useState(el.text ?? '')
  const [legend, setLegend] = useState(el.legend !== false)
  const nr = m.length, nc = m[0]?.length ?? 1
  const set = (r: number, c: number, v: string) => setM((x) => x.map((row, i) => (i === r ? row.map((cell, j) => (j === c ? v : cell)) : row)))
  return (
    <Modal title="Chart data" onClose={onClose} width={640}>
      <div className="share-body">
        <div className="ps-row">
          <label className="ai-field" style={{ flex: 1, minWidth: 180 }}><span>Chart title</span><span className="field"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Optional" /></span></label>
          <div className="ai-field"><span>Type</span><Select label="Chart type" value={kind} options={KINDS} onChange={setKind} /></div>
        </div>
        <div className="data-grid-wrap">
          <table className="data-grid">
            <tbody>{m.map((row, r) => (
              <tr key={r}>{row.map((v, c) => (
                <td key={c} className={r === 0 || c === 0 ? 'head' : ''}>
                  <input value={v} placeholder={r === 0 && c === 0 ? '' : r === 0 ? `Series ${c}` : c === 0 ? `Label ${r}` : '0'} inputMode={r > 0 && c > 0 ? 'decimal' : 'text'} aria-label={`Row ${r + 1} column ${c + 1}`}
                    onChange={(e) => set(r, c, e.target.value)} />
                </td>))}</tr>))}
            </tbody>
          </table>
        </div>
        <div className="ps-row" style={{ alignItems: 'center' }}>
          <button className="btn btn-pill btn-soft btn-sm" onClick={() => setM((x) => [...x, Array(nc).fill('')])}><Plus size={14} />Row</button>
          <button className="btn btn-pill btn-ghost btn-sm" disabled={nr <= 2} onClick={() => setM((x) => x.slice(0, -1))}><Minus size={14} />Row</button>
          <button className="btn btn-pill btn-soft btn-sm" onClick={() => setM((x) => x.map((r) => [...r, '']))}><Plus size={14} />Series</button>
          <button className="btn btn-pill btn-ghost btn-sm" disabled={nc <= 2} onClick={() => setM((x) => x.map((r) => r.slice(0, -1)))}><Minus size={14} />Series</button>
          <label className="check-line" style={{ marginLeft: 'auto' }}><input type="checkbox" checked={legend} onChange={(e) => setLegend(e.target.checked)} />Legend</label>
        </div>
        {kind === 'pie' && <p className="muted hint" style={{ margin: 0 }}>A pie chart shows the first series only.</p>}
        <div className="modal-actions">
          <button className="btn btn-pill btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-pill btn-primary" onClick={() => { onSave({ cells: fromMatrix(m), nr, nc, chart: kind, text: title, legend }); onClose() }}>Save</button>
        </div>
      </div>
    </Modal>
  )
}

import { useState } from 'react'
import { RectangleHorizontal, RectangleVertical } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Select } from '../ui/Select'
import { DEFAULT_META, PAGE_SIZES, type PageMeta, type PageSize } from './Pagination'

const PRESETS = {
  normal: { label: 'Normal', mt: 88, mb: 88, ml: 96, mr: 96 },
  narrow: { label: 'Narrow', mt: 48, mb: 48, ml: 48, mr: 48 },
  wide: { label: 'Wide', mt: 96, mb: 96, ml: 144, mr: 144 },
} as const
const inch = (px: number) => Math.round((px / 96) * 100) / 100

function MarginField({ label, value, onChange }: { label: string; value: number; onChange: (px: number) => void }) {
  const [text, setText] = useState(String(inch(value)))
  return (
    <label className="ai-field"><span>{label}</span>
      <span className="field"><input inputMode="decimal" value={text} onChange={(e) => {
        setText(e.target.value)
        const n = parseFloat(e.target.value)
        if (isFinite(n)) onChange(Math.max(0.25, Math.min(2.5, n)) * 96)
      }} onBlur={() => setText(String(inch(value)))} /><em className="unit">in</em></span></label>
  )
}

export function PageSetupDialog({ meta, onSave, onClose }: { meta: PageMeta; onSave: (m: PageMeta) => void; onClose: () => void }) {
  const [m, setM] = useState<PageMeta>({ ...DEFAULT_META, ...meta })
  const active = (Object.keys(PRESETS) as (keyof typeof PRESETS)[]).find((k) => (['mt', 'mb', 'ml', 'mr'] as const).every((s) => Math.abs(PRESETS[k][s] - m[s]) < 1))
  const mm = PAGE_SIZES[m.size].mm
  return (
    <Modal title="Page setup" onClose={onClose} width={480}>
      <div className="share-body">
        <div className="ps-row">
          <label className="ai-field" style={{ flex: 1 }}><span>Paper size</span>
            <Select label="Paper size" value={m.size} onChange={(v) => setM({ ...m, size: v as PageSize })}
              options={(Object.keys(PAGE_SIZES) as PageSize[]).map((k) => ({ value: k, label: `${PAGE_SIZES[k].label} (${Math.round((PAGE_SIZES[k].mm[0] / 25.4) * 100) / 100} x ${Math.round((PAGE_SIZES[k].mm[1] / 25.4) * 100) / 100} in)` }))} /></label>
          <div className="ai-field"><span>Orientation</span>
            <div className="seg">
              <button className={m.orientation === 'portrait' ? 'on' : ''} onClick={() => setM({ ...m, orientation: 'portrait' })}><RectangleVertical size={15} />Portrait</button>
              <button className={m.orientation === 'landscape' ? 'on' : ''} onClick={() => setM({ ...m, orientation: 'landscape' })}><RectangleHorizontal size={15} />Landscape</button>
            </div></div>
        </div>
        <div className="ai-field"><span>Margins</span>
          <div className="chips">
            {(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map((k) => <button key={k} className={`chip ${active === k ? 'on' : ''}`} style={{ cursor: 'pointer' }} onClick={() => setM({ ...m, ...PRESETS[k] })}>{PRESETS[k].label}</button>)}
            {!active && <span className="chip on">Custom</span>}
          </div>
        </div>
        <div className="ps-margins" key={`${m.mt}-${m.mb}-${m.ml}-${m.mr}`}>
          <MarginField label="Top" value={m.mt} onChange={(v) => setM((x) => ({ ...x, mt: v }))} />
          <MarginField label="Bottom" value={m.mb} onChange={(v) => setM((x) => ({ ...x, mb: v }))} />
          <MarginField label="Left" value={m.ml} onChange={(v) => setM((x) => ({ ...x, ml: v }))} />
          <MarginField label="Right" value={m.mr} onChange={(v) => setM((x) => ({ ...x, mr: v }))} />
        </div>
        <p className="muted hint" style={{ margin: 0 }}>The header and footer sit inside the top and bottom margins. Page setup applies to the whole document and to everyone viewing it. {Math.round(mm[0])} x {Math.round(mm[1])} mm.</p>
        <div className="modal-actions">
          <button className="btn btn-pill btn-ghost" onClick={() => setM({ ...m, size: DEFAULT_META.size, orientation: DEFAULT_META.orientation, mt: 88, mb: 88, ml: 96, mr: 96 })}>Reset</button>
          <button className="btn btn-pill btn-primary" onClick={() => { onSave(m); onClose() }}>Apply</button>
        </div>
      </div>
    </Modal>
  )
}

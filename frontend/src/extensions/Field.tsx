import type { SettingField } from './runtime'

export const Toggle = ({ on, label, set }: { on: boolean; label: string; set: (v: boolean) => void }) => <button type="button" role="switch" aria-checked={on} aria-label={label} className={`toggle ${on ? 'on' : ''}`} onClick={() => set(!on)}><i /></button>

export function Field({ f, value, set }: { f: SettingField; value: unknown; set: (v: unknown) => void }) {
  const v = value ?? ''
  return (
    <label className={`ext-field2 ${f.type === 'toggle' ? 'row' : ''}`}>
      <span><b>{f.label}</b>{f.help && <em>{f.help}</em>}</span>
      {f.type === 'toggle' ? <Toggle on={!!value} label={f.label} set={set} />
        : f.type === 'select' ? <select className="st-select" value={String(v)} onChange={(e) => set(e.target.value)}>{(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        : f.type === 'longtext' ? <textarea rows={3} value={String(v)} maxLength={4000} onChange={(e) => set(e.target.value)} />
        : <input type={f.type === 'number' ? 'number' : f.type === 'color' ? 'color' : 'text'} value={String(v)} maxLength={500} onChange={(e) => set(f.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} />}
    </label>
  )
}

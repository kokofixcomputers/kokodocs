import { useState } from 'react'
import { Check, Laptop, RotateCcw, Smartphone } from 'lucide-react'
import { DEFAULT_BARS, HEADER_ITEMS, PRESETS, TOOLBAR_ITEMS, presetLists, profileSets, type BarProfile, type Preset } from '../editor/bars'
import { saveBars, usePrefs } from '../prefs'
import { Toggle } from '../extensions/Field'
import { toast } from '../ui/Toast'

/** Settings → Toolbar: which buttons the top bar and the formatting bar show, separately for computers and phones. The rest wait under ⋯. */
export function ToolbarSettings() {
  const { bars } = usePrefs()
  const [which, setWhich] = useState<'desktop' | 'mobile'>('desktop')
  const key = bars.same ? 'desktop' : which
  const p = bars[key]
  const save = (next: typeof bars) => { void saveBars(next).catch((e) => toast((e as Error).message)) }
  const setProfile = (np: BarProfile) => save({ ...bars, [key]: np })
  const choose = (preset: Preset) => {
    if (preset !== 'custom') { setProfile({ ...p, preset }); return }
    const from = p.preset === 'custom' ? { toolbar: p.toolbar, header: p.header } : presetLists(p.preset)   // Custom starts from what you have now
    setProfile({ preset: 'custom', ...from })
  }
  const flip = (list: 'toolbar' | 'header', id: string) => {
    const cur = new Set(p[list]); cur.has(id) ? cur.delete(id) : cur.add(id)
    setProfile({ ...p, preset: 'custom', [list]: [...cur] })
  }
  const sets = profileSets(p)

  return (
    <section className="st-section"><h1>Toolbar</h1>
      <div className="st-card">
        <div className="st-row"><div><b>Keep the bars tidy</b><span>Choose which buttons stay in the top bar and the formatting bar. Everything you hide is under the <b>⋯</b> button, so nothing is lost.</span></div></div>
        <div className="st-row"><div><b>Same on computers and phones</b><span>Turn off to give your phone its own, smaller set.</span></div>
          <span className="st-btns"><Toggle on={bars.same} label="Use the same toolbar on every device" set={(v) => save({ ...bars, same: v })} /></span></div>
      </div>

      {!bars.same && (
        <div className="seg bar-tabs" role="tablist">
          <button role="tab" aria-selected={which === 'desktop'} className={which === 'desktop' ? 'on' : ''} onClick={() => setWhich('desktop')}><Laptop size={15} />Computer</button>
          <button role="tab" aria-selected={which === 'mobile'} className={which === 'mobile' ? 'on' : ''} onClick={() => setWhich('mobile')}><Smartphone size={15} />Phone</button>
        </div>
      )}

      <div className="bar-presets">
        {PRESETS.map((x) => (
          <button key={x.id} className={`bar-preset ${p.preset === x.id ? 'on' : ''}`} onClick={() => choose(x.id)} aria-pressed={p.preset === x.id}>
            <b>{x.label}</b><span>{x.hint}</span>{p.preset === x.id && <Check size={16} />}
          </button>))}
      </div>

      <h2 className="st-sub">What is shown</h2>
      <div className="st-card">
        <h4 className="bar-h">Top bar</h4>
        <div className="bar-checks">{HEADER_ITEMS.map((i) => <label key={i.id}><input type="checkbox" checked={sets.header.has(i.id)} onChange={() => flip('header', i.id)} />{i.label}</label>)}</div>
        <h4 className="bar-h">Formatting bar</h4>
        <div className="bar-checks">{TOOLBAR_ITEMS.map((i) => <label key={i.id}><input type="checkbox" checked={sets.toolbar.has(i.id)} onChange={() => flip('toolbar', i.id)} />{i.label}</label>)}</div>
        <p className="muted" style={{ margin: '12px 0 0', fontSize: 12.5 }}>Ticking a box switches this layout to Custom. Share, your picture and the save status always stay.</p>
      </div>
      <div className="st-inline"><button className="btn btn-pill btn-ghost" onClick={() => save(DEFAULT_BARS)}><RotateCcw size={15} />Reset to the defaults</button></div>
    </section>
  )
}

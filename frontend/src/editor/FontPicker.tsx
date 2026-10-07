import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Clock, Search } from 'lucide-react'
import { CATEGORY_LABEL, FONTS, loadFont, loadFontPreview, fontStack, type FontCategory } from '../fonts'

const ROW = 46
const HEIGHT = 340
const RECENT_KEY = 'koko.recentFonts'

const readRecent = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') } catch { return [] } }

export function FontPicker({ value, onPick, resetLabel, onReset }: { value: string; onPick: (family: string) => void; resetLabel?: string; onReset?: () => void }) {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<FontCategory | 'all'>('all')
  const [top, setTop] = useState(0)
  const recent = useMemo(readRecent, [])
  const scroller = useRef<HTMLDivElement>(null)

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let l = FONTS.filter((f) => (cat === 'all' || f.category === cat) && (!needle || f.family.toLowerCase().includes(needle)))
    if (!needle && cat === 'all') {
      const set = new Set(recent)
      l = [...recent.map((r) => FONTS.find((f) => f.family === r)!).filter(Boolean), ...l.filter((f) => !set.has(f.family))]
    }
    return l
  }, [q, cat, recent])

  useEffect(() => { scroller.current?.scrollTo({ top: 0 }); setTop(0) }, [q, cat])

  const start = Math.max(0, Math.floor(top / ROW) - 3)
  const end = Math.min(list.length, start + Math.ceil(HEIGHT / ROW) + 7)
  useEffect(() => { for (let i = start; i < end; i++) loadFontPreview(list[i].family) }, [start, end, list])

  const pick = (family: string) => {
    loadFont(family)
    localStorage.setItem(RECENT_KEY, JSON.stringify([family, ...recent.filter((r) => r !== family)].slice(0, 6)))
    onPick(family)
  }

  return (
    <div className="font-picker">
      {onReset && <button type="button" className="font-reset" onClick={onReset}>{resetLabel ?? 'Default font'}</button>}
      <label className="field compact"><Search size={16} />
        <input autoFocus placeholder={`Search ${FONTS.length.toLocaleString()} fonts`} value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <div className="chips">
        {(Object.keys(CATEGORY_LABEL) as (FontCategory | 'all')[]).map((c) => (
          <button key={c} className={`chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{CATEGORY_LABEL[c]}</button>
        ))}
      </div>
      <div className="font-scroll" ref={scroller} style={{ height: HEIGHT }} onScroll={(e) => setTop(e.currentTarget.scrollTop)}>
        <div style={{ height: list.length * ROW, position: 'relative' }}>
          {list.slice(start, end).map((f, i) => (
            <button key={f.family} className={`font-row ${f.family === value ? 'on' : ''}`}
              style={{ top: (start + i) * ROW, height: ROW }} onClick={() => pick(f.family)}>
              <span className="font-name" style={{ fontFamily: fontStack(f.family) }}>{f.family}</span>
              {!q && cat === 'all' && recent.includes(f.family) && start + i < recent.length ? <Clock size={14} className="muted" /> : null}
              {f.family === value && <Check size={16} />}
            </button>
          ))}
          {list.length === 0 && <div className="empty-note">No fonts match “{q}”</div>}
        </div>
      </div>
    </div>
  )
}

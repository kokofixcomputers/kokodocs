import { useEffect, useRef, useState } from 'react'
import { Ban, Check, Pipette } from 'lucide-react'

const COLS = ['#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#efefef', '#ffffff']
const HUES = [
  ['#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#14b8a6', '#06b6d4'],
  ['#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e'],
  ['#fecaca', '#fed7aa', '#fde68a', '#fef08a', '#d9f99d', '#bbf7d0', '#99f6e4', '#a5f3fc'],
  ['#bae6fd', '#bfdbfe', '#c7d2fe', '#ddd6fe', '#e9d5ff', '#f5d0fe', '#fbcfe8', '#fecdd3'],
  ['#991b1b', '#9a3412', '#92400e', '#854d0e', '#3f6212', '#166534', '#115e59', '#155e75'],
  ['#075985', '#1e40af', '#3730a3', '#5b21b6', '#6b21a8', '#86198f', '#9d174d', '#9f1239'],
]

const ALL_PRESETS = new Set([...COLS, ...HUES.flat()])
const RECENT_KEY = 'koko.colors.recent'
const readRecent = (): string[] => { try { const a = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); return Array.isArray(a) ? a.filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 12) : [] } catch { return [] } }
const remember = (c: string) => {
  if (ALL_PRESETS.has(c.toLowerCase())) return
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([c.toLowerCase(), ...readRecent().filter((x) => x !== c.toLowerCase())].slice(0, 12))) } catch { /* private mode */ }
}

// ───────── colour math ─────────
type HSV = { h: number; s: number; v: number }
const clamp = (n: number, a = 0, b = 1) => Math.min(b, Math.max(a, n))
export function hexToHsv(hex: string): HSV {
  const n = parseInt(hex.slice(1), 16), r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let h = 0
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: ((h * 60) + 360) % 360, s: max ? d / max : 0, v: max }
}
export function hsvToHex({ h, s, v }: HSV): string {
  const f = (n: number) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)) }
  return '#' + [f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')
}
export function normHex(t: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(t.trim()); if (!m) return null
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]
  return '#' + h.toLowerCase()
}

/** Saturation/brightness square, hue slider, hex field and (where the browser has it) an eyedropper. Nothing is applied until you press Apply. */
function Advanced({ initial, onApply }: { initial: string; onApply: (c: string) => void }) {
  const [hsv, setHsv] = useState<HSV>(() => hexToHsv(initial))
  const [text, setText] = useState(initial)
  const sv = useRef<HTMLDivElement>(null), hue = useRef<HTMLDivElement>(null)
  const hex = hsvToHex(hsv)
  useEffect(() => { setText(hex) }, [hex])
  const drag = (el: React.RefObject<HTMLDivElement | null>, set: (x: number, y: number) => void) => (e: React.PointerEvent) => {
    e.preventDefault(); const box = el.current!; box.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent | React.PointerEvent) => { const r = box.getBoundingClientRect(); set(clamp((ev.clientX - r.left) / r.width), clamp((ev.clientY - r.top) / r.height)) }
    move(e)
    const mv = (ev: PointerEvent) => move(ev), up = () => { box.removeEventListener('pointermove', mv); box.removeEventListener('pointerup', up) }
    box.addEventListener('pointermove', mv); box.addEventListener('pointerup', up)
  }
  const eyedrop = async () => { try { const r = await new (window as unknown as { EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper().open(); const h = normHex(r.sRGBHex); if (h) setHsv(hexToHsv(h)) } catch { /* cancelled */ } }
  const hasDropper = typeof window !== 'undefined' && 'EyeDropper' in window
  return (
    <div className="cp-adv" onMouseDown={(e) => { if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault() }}>
      <div ref={sv} className="cp-sv" style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }} onPointerDown={drag(sv, (x, y) => setHsv((c) => ({ ...c, s: x, v: 1 - y })))} role="slider" aria-label="Saturation and brightness" aria-valuetext={hex}>
        <i style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }} />
      </div>
      <div ref={hue} className="cp-hue" onPointerDown={drag(hue, (x) => setHsv((c) => ({ ...c, h: x * 359.9 })))} role="slider" aria-label="Hue" aria-valuenow={Math.round(hsv.h)}>
        <i style={{ left: `${(hsv.h / 359.9) * 100}%`, background: `hsl(${hsv.h} 100% 50%)` }} />
      </div>
      <div className="cp-row">
        <span className="cp-prev" style={{ background: hex }} />
        <input className="cp-hex" value={text} spellCheck={false} aria-label="Hex color" maxLength={7}
          onChange={(e) => { setText(e.target.value); const h = normHex(e.target.value); if (h) setHsv(hexToHsv(h)) }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const h = normHex(text); if (h) onApply(h) } e.stopPropagation() }} />
        {hasDropper && <button className="cp-drop" onClick={eyedrop} aria-label="Pick a color from the screen" title="Pick from the screen"><Pipette size={15} /></button>}
      </div>
      <button className="btn btn-primary btn-pill btn-sm cp-apply" onClick={() => onApply(normHex(text) ?? hex)}><Check size={15} />Apply</button>
    </div>
  )
}

export function ColorPicker({ value, onPick, noneLabel = 'None' }: { value?: string | null; onPick: (c: string | null) => void; noneLabel?: string }) {
  const [recent, setRecent] = useState(readRecent)
  const [custom, setCustom] = useState(false)
  const pick = (c: string) => { remember(c); setRecent(readRecent()); onPick(c) }
  const swatch = (c: string, key = c) => (
    <button key={key} className={`swatch ${value?.toLowerCase() === c ? 'on' : ''}`} style={{ background: c }}
      onClick={() => pick(c)} aria-label={c} title={c} />
  )
  const cur = normHex(value ?? '') ?? recent[0] ?? '#6366f1'
  return (
    <div className="color-picker">
      <button className="menu-row" onClick={() => onPick(null)}><Ban size={16} />{noneLabel}</button>
      <div className="swatch-grid">
        {COLS.map((c) => swatch(c))}
        {HUES.flat().map((c) => swatch(c))}
      </div>
      {recent.length > 0 && (
        <>
          <div className="cp-label">Recent</div>
          <div className="swatch-grid cp-recent">{recent.map((c) => swatch(c, 'r' + c))}</div>
        </>
      )}
      <button className={`menu-row cp-toggle ${custom ? 'on' : ''}`} onClick={() => setCustom((v) => !v)} aria-expanded={custom}><Pipette size={16} />Custom color</button>
      {custom && <Advanced initial={cur} onApply={pick} />}
    </div>
  )
}

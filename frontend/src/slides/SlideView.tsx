import { useEffect, type CSSProperties, type ReactNode } from 'react'
import { fontStack, loadFont } from '../fonts'
import { emojiHtml } from '../emoji'
import { ChartSvg } from '../sheet/Charts'
import { chartData, dims } from './matrix'
import { H, W, PLACEHOLDER, resolveColor, cellKey, type El, type Slide, type Theme } from './themes'

export function useDeckFonts(slides: Slide[], theme: Theme) {
  const key = slides.flatMap((s) => s.els.map((e) => e.font ?? '')).join('|') + theme.head + theme.body
  useEffect(() => {
    loadFont(theme.head); loadFont(theme.body)
    slides.forEach((s) => s.els.forEach((e) => { if (e.font && e.font !== 'auto') loadFont(e.font) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}

export const elFont = (e: El, t: Theme) => (e.font && e.font !== 'auto' ? e.font : e.role === 'title' ? t.head : t.body)

function ShapeSvg({ e, t }: { e: El; t: Theme }) {
  const fill = e.fill === 'none' ? 'none' : resolveColor(e.fill, t, 'accent')
  const stroke = e.stroke && e.stroke !== 'none' ? resolveColor(e.stroke, t, 'fg') : 'none'
  const sw = e.strokeW ?? (e.shape === 'line' || e.shape === 'arrow' ? 6 : 0)
  const common = { fill, stroke, strokeWidth: sw, vectorEffect: 'non-scaling-stroke' as const }
  const w = e.w, h = e.h, p = sw / 2
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', overflow: 'visible' }}>
      {e.shape === 'ellipse' ? <ellipse cx={w / 2} cy={h / 2} rx={Math.max(0, w / 2 - p)} ry={Math.max(0, h / 2 - p)} {...common} />
        : e.shape === 'triangle' ? <polygon points={`${w / 2},${p} ${w - p},${h - p} ${p},${h - p}`} {...common} />
        : e.shape === 'line' ? <line x1={p} y1={h / 2} x2={w - p} y2={h / 2} {...common} fill="none" stroke={stroke === 'none' ? resolveColor('auto', t, 'fg') : stroke} strokeLinecap="round" />
        : e.shape === 'arrow' ? (
          <g stroke={stroke === 'none' ? resolveColor('auto', t, 'fg') : stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round">
            <line x1={p} y1={h / 2} x2={w - p} y2={h / 2} /><polyline points={`${w - Math.min(h, 40)},${Math.max(p, h / 2 - Math.min(h, 40) / 2)} ${w - p},${h / 2} ${w - Math.min(h, 40)},${Math.min(h - p, h / 2 + Math.min(h, 40) / 2)}`} />
          </g>)
        : <rect x={p} y={p} width={Math.max(0, w - sw)} height={Math.max(0, h - sw)} rx={e.shape === 'round' ? Math.min(w, h) * 0.12 : 0} {...common} />}
    </svg>
  )
}

export function TextBody({ e, t, placeholder }: { e: El; t: Theme; placeholder?: boolean }) {
  const text = e.text ?? ''
  const style: CSSProperties = {
    fontFamily: fontStack(elFont(e, t)), fontSize: e.size ?? 28, fontWeight: e.bold ? 700 : 400, fontStyle: e.italic ? 'italic' : 'normal',
    textDecoration: e.underline ? 'underline' : 'none', color: resolveColor(e.color, t, e.role === 'sub' ? 'muted' : 'fg'), textAlign: e.align ?? 'left', lineHeight: 1.25,
  }
  if (!text && placeholder) return <div style={{ ...style, opacity: 0.3 }}>{PLACEHOLDER[e.role ?? 'body'] ?? 'Text'}</div>
  if (e.bullets) {
    return (
      <div style={style}>{text.split('\n').map((l, i) => (
        <div key={i} className="sl-bullet" style={{ display: 'flex', gap: (e.size ?? 28) * 0.5, paddingBottom: (e.size ?? 28) * 0.3 }}>
          {l.trim() ? <span style={{ flex: 'none', color: resolveColor('accent', t) }}>•</span> : null}<span style={{ flex: 1, minWidth: 0 }} dangerouslySetInnerHTML={{ __html: emojiHtml(l.replace(/&/g, '&amp;').replace(/</g, '&lt;')) }} />
        </div>))}</div>)
  }
  return <div style={{ ...style, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }} dangerouslySetInnerHTML={{ __html: emojiHtml(text.replace(/&/g, '&amp;').replace(/</g, '&lt;')) }} />
}

const hexMix = (a: string, b: string, t: number) => {
  const p = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16)
  return '#' + [0, 1, 2].map((i) => Math.round(p(a, i) * (1 - t) + p(b, i) * t).toString(16).padStart(2, '0')).join('')
}
export const chartColors = (t: Theme) => [t.accent, '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'].map((c, i) => (i === 0 ? c : c))

export function TableView({ e, t, editable, onCell }: { e: El; t: Theme; editable?: boolean; onCell?: (r: number, c: number, text: string) => void }) {
  const { nr, nc } = dims(e)
  const size = e.size ?? 24, line = hexMix(t.bg, t.fg, 0.16), head = e.header !== false
  return (
    <table style={{ width: '100%', height: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontFamily: fontStack(elFont(e, t)), fontSize: size, color: resolveColor(e.color, t, 'fg') }}>
      <tbody>{Array.from({ length: nr }, (_, r) => (
        <tr key={r}>{Array.from({ length: nc }, (_v, c) => {
          const isHead = head && r === 0
          const v = e.cells?.[cellKey(r, c)] ?? ''
          return (
            <td key={c} data-r={r} data-c={c} ref={editable ? (el) => { if (el && el.dataset.init !== '1') { el.dataset.init = '1'; el.textContent = v } } : undefined}
              {...(editable ? { contentEditable: true, suppressContentEditableWarning: true } : {})}
              onBlur={editable ? (ev) => onCell?.(r, c, (ev.currentTarget.innerText ?? '').replace(/\n$/, '')) : undefined}
              style={{ border: `1.5px solid ${line}`, padding: `${size * 0.35}px ${size * 0.55}px`, verticalAlign: 'middle', textAlign: e.align ?? 'left', fontWeight: isHead || e.bold ? 700 : 400,
                background: isHead ? resolveColor('accent', t) : r % 2 === 0 ? 'transparent' : resolveColor('card', t), color: isHead ? resolveColor('accentInk', t) : undefined, whiteSpace: 'pre-wrap', wordBreak: 'break-word', outline: 'none' }}>
              {editable ? undefined : v}
            </td>)
        })}</tr>))}
      </tbody>
    </table>
  )
}
export function ChartView({ e, t }: { e: El; t: Theme }) {
  const k = 2   // the shared chart drawing uses small fixed type sizes; draw it at half size and scale up so labels read on a slide
  const d = chartData(e)
  const vars = { ['--ink' as string]: t.fg, ['--muted' as string]: t.muted, ['--grid' as string]: hexMix(t.bg, t.fg, 0.14), ['--sheet' as string]: t.bg } as CSSProperties
  return (
    <div style={{ width: e.w / k, height: e.h / k, transform: `scale(${k})`, transformOrigin: '0 0', ...vars }}>
      <ChartSvg type={e.chart ?? 'column'} data={d} w={e.w / k} h={e.h / k} title={e.text ?? ''} colors={chartColors(t)} legend={e.legend !== false && (d.series.length > 1 || e.chart === 'pie')} />
    </div>
  )
}

/** Static drawing of one element (no editing chrome). */
export function ElView({ e, t, placeholder, hideText }: { e: El; t: Theme; placeholder?: boolean; hideText?: boolean }) {
  const box: CSSProperties = { position: 'absolute', left: e.x, top: e.y, width: e.w, height: e.h, opacity: e.opacity ?? 1 }
  if (e.type === 'table') return hideText ? null : <div style={box}><TableView e={e} t={t} /></div>
  if (e.type === 'chart') return <div style={{ ...box, overflow: 'hidden' }}><ChartView e={e} t={t} /></div>
  if (e.type === 'image') return <div style={box}><img src={e.src} alt={e.alt ?? ''} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', borderRadius: 12 }} /></div>
  if (e.type === 'shape') return <div style={box}><ShapeSvg e={e} t={t} />{e.text ? <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, color: resolveColor(e.color, t, 'fg') }}><TextBody e={{ ...e, align: e.align ?? 'center' }} t={t} /></div> : null}</div>
  const justify = e.valign === 'middle' ? 'center' : e.valign === 'bottom' ? 'flex-end' : 'flex-start'
  return <div style={{ ...box, display: 'flex', flexDirection: 'column', justifyContent: justify, overflow: 'visible' }}>{hideText ? null : <TextBody e={e} t={t} placeholder={placeholder} />}</div>
}

/** A slide drawn at a given scale. `children` render on top (selection handles etc. in editing mode). */
export function SlideStage({ slide, theme, scale, className = '', children, placeholders, editingId }: { slide: Slide; theme: Theme; scale: number; className?: string; children?: ReactNode; placeholders?: boolean; editingId?: string | null }) {
  return (
    <div className={`slide-stage ${className}`} style={{ width: W * scale, height: H * scale }}>
      <div className="slide-surface" style={{ width: W, height: H, transform: `scale(${scale})`, background: slide.bg ?? theme.bg, color: theme.fg }}>
        {slide.els.map((e) => <ElView key={e.id} e={e} t={theme} placeholder={placeholders} hideText={editingId === e.id} />)}
        {children}
      </div>
    </div>
  )
}

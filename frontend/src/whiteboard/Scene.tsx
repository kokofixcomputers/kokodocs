import { memo } from 'react'
import { Loader2 } from 'lucide-react'
import { fontStack } from '../fonts'
import { linePath, partsOf, type Part } from './draw'
import { layout } from './text'
import { isLinear, isShape, type El } from './types'

const building = (e: El) => !!e.busy && Date.now() - e.busy < 4 * 60 * 1000
/** A page Koko wrote runs in a frame that cannot reach this site, and (by this policy) cannot send anything anywhere: no network calls, no outside scripts. Pictures and fonts may load. */
const POLICY = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob: https:; media-src data: blob: https:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src data: https://fonts.gstatic.com; script-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'">`
export const safePage = (html: string) => (/<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + POLICY) : /<html[^>]*>/i.test(html) ? html.replace(/<html[^>]*>/i, (m) => m + '<head>' + POLICY + '</head>') : POLICY + html)

const PathNode = ({ p }: { p: Part }) => (
  <path d={p.d} fill={p.fill} stroke={p.stroke} strokeWidth={p.sw} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={p.dash} pointerEvents="none" />
)

function TextNode({ e, bg }: { e: El; bg?: string }) {
  const L = layout(e)
  if (!L.lines.length || (L.lines.length === 1 && !L.lines[0])) return null
  const shape = isShape(e.type) || e.type === 'frame'
  const color = e.tc ?? e.stroke, ta = shape || e.type === 'arrow' || e.type === 'line' ? (e.ta ?? 'center') : (e.ta ?? 'left')
  let cx = 0, y0 = 0
  if (e.type === 'arrow' || e.type === 'line') { const m = linePath(e).mid; cx = m[0]; y0 = m[1] - L.h / 2 }
  else if (shape) { cx = ta === 'left' ? 10 : ta === 'right' ? e.w - 10 : e.w / 2; y0 = (e.h - L.h) / 2 }
  else { cx = ta === 'left' ? 0 : ta === 'right' ? e.w : e.w / 2; y0 = 0 }
  const lineLabel = e.type === 'arrow' || e.type === 'line'
  return (
    <g pointerEvents="none" fontFamily={fontStack(e.font ?? 'Caveat')} fontSize={e.size ?? 24} fontWeight={e.bold ? 700 : 400} fontStyle={e.italic ? 'italic' : 'normal'} fill={color}
       textAnchor={ta === 'left' ? 'start' : ta === 'right' ? 'end' : 'middle'}>
      {L.lines.map((l, i) => (
        <text key={i} x={cx} y={y0 + i * L.lh + L.lh / 2} dominantBaseline="central" style={{ whiteSpace: 'pre' }}
              {...(lineLabel ? { stroke: bg ?? '#fff', strokeWidth: 6, paintOrder: 'stroke', strokeLinejoin: 'round' } : {})}>{l || ' '}</text>
      ))}
    </g>
  )
}

export interface NodeProps { e: El; dx?: number; dy?: number; bg?: string; interactive?: boolean }

export const ElNode = memo(function ElNode({ e, dx = 0, dy = 0, bg, interactive }: NodeProps) {
  if (e.hide) return null
  const linear = isLinear(e.type)
  const tf = `translate(${e.x + dx} ${e.y + dy})${e.a && !linear ? ` rotate(${(e.a * 180) / Math.PI} ${e.w / 2} ${e.h / 2})` : ''}`
  let body: React.ReactNode
  if (e.type === 'image') body = <image href={e.src} width={e.w} height={e.h} preserveAspectRatio="none" pointerEvents="none" />
  else if (e.type === 'embed') body = (
    <foreignObject width={Math.max(1, e.w)} height={Math.max(1, e.h)} pointerEvents={interactive ? 'auto' : 'none'}>
      <div className="wb-embed" style={{ width: '100%', height: '100%' }}>
        <div className="wb-embed-bar"><span>{e.name || 'Website'}</span></div>
        {e.html ? <iframe title={e.name || 'Website made by Koko'} srcDoc={safePage(e.html)} sandbox="allow-scripts allow-forms allow-popups allow-modals" style={{ pointerEvents: interactive ? 'auto' : 'none' }} />
          : <div className="wb-embed-empty">{building(e) ? <><Loader2 size={18} className="spin" />Koko is building this…</> : 'Nothing here yet'}</div>}
        {building(e) && e.html && <div className="wb-embed-busy"><Loader2 size={16} className="spin" />Updating…</div>}
      </div>
    </foreignObject>)
  else if (e.type === 'frame') body = (
    <g pointerEvents="none">
      <rect width={e.w} height={e.h} fill={e.ai ? 'rgba(124,58,237,.05)' : 'none'} stroke={e.ai ? '#7c3aed' : '#9ca3af'} strokeWidth={1.5} strokeDasharray={e.ai ? '7 5' : undefined} rx={6} />
      <text x={2} y={-9} fontSize={13} fontFamily="Lexend, sans-serif" fill={e.ai ? '#7c3aed' : '#6b7280'} fontWeight={600}>{(e.ai ? '✨ ' : '') + (e.name || (e.ai ? 'AI frame' : 'Frame'))}</text>
    </g>)
  else if (e.type === 'text') body = <TextNode e={e} />
  else body = <>{partsOf(e).map((p, i) => <PathNode key={i} p={p} />)}{e.text ? <TextNode e={e} bg={bg} /> : null}</>
  return <g transform={tf} opacity={e.op / 100} data-id={e.id}>{body}</g>
})

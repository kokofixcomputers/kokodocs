import { useMemo, useRef, useState } from 'react'
import { BarChart3, LineChart, PieChart, AreaChart, ScatterChart, Trash2, Pencil, AlignHorizontalDistributeCenter } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { parseAddr } from './engine/refs'
import { CellError } from './engine/values'
import type { Chart, Rect, SheetModel } from './model'

export const CHART_COLORS = ['#4f6df5', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16']
export const CHART_TYPES: { id: Chart['type']; label: string; icon: typeof BarChart3 }[] = [
  { id: 'column', label: 'Column', icon: BarChart3 }, { id: 'bar', label: 'Bar', icon: AlignHorizontalDistributeCenter }, { id: 'line', label: 'Line', icon: LineChart },
  { id: 'area', label: 'Area', icon: AreaChart }, { id: 'pie', label: 'Pie', icon: PieChart }, { id: 'scatter', label: 'Scatter', icon: ScatterChart },
]

export function parseRangeText(s: string): Rect | null {
  const m = /^\s*(?:[^!]+!)?(\$?[A-Za-z]{1,3}\$?\d+)(?::(\$?[A-Za-z]{1,3}\$?\d+))?\s*$/.exec(s)
  if (!m) return null
  const a = parseAddr(m[1].replace(/\$/g, '')), b = m[2] ? parseAddr(m[2].replace(/\$/g, '')) : a
  if (!a || !b) return null
  return { r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) }
}

export interface Data { cats: string[]; series: { name: string; values: number[] }[] }
export function chartData(model: SheetModel, sheet: string, ch: Chart): Data | null {
  const R = parseRangeText(ch.range); if (!R) return null
  const rows: { text: string; num: number | null }[][] = []
  for (let r = R.r1; r <= R.r2; r++) {
    const row = []
    for (let c = R.c1; c <= R.c2; c++) { const d = model.display(sheet, r, c); row.push({ text: d.text, num: typeof d.v === 'number' ? d.v : d.v instanceof CellError ? null : (d.v !== null && d.v !== '' && !Number.isNaN(Number(d.v)) ? Number(d.v) : null) }) }
    rows.push(row)
  }
  if (!rows.length) return null
  const head = ch.headers ? rows[0] : null, body = ch.headers ? rows.slice(1) : rows
  if (!body.length) return null
  const ncol = rows[0].length
  if (ncol === 1) return { cats: body.map((_, i) => String(i + 1)), series: [{ name: head?.[0].text || 'Series 1', values: body.map((r) => r[0].num ?? 0) }] }
  return {
    cats: body.map((r) => r[0].text),
    series: Array.from({ length: ncol - 1 }, (_, j) => ({ name: head?.[j + 1].text || `Series ${j + 1}`, values: body.map((r) => r[j + 1].num ?? 0) })),
  }
}

const niceMax = (v: number) => { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p }
const fmt = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e4 ? `${(n / 1e3).toFixed(0)}k` : String(Number(n.toPrecision(4))))

export function ChartSvg({ type, data, w, h, title, stacked, colors, legend: showLegend }: { type: Chart['type']; data: Data; w: number; h: number; title: string; stacked?: boolean; colors?: string[]; legend?: boolean }) {
  const COL = colors ?? CHART_COLORS
  const pad = { l: 46, r: 16, t: title ? 38 : 16, b: 38 + (data.series.length > 1 ? 18 : 0) }
  const iw = Math.max(10, w - pad.l - pad.r), ih = Math.max(10, h - pad.t - pad.b)
  const n = data.cats.length
  const sums = data.cats.map((_, i) => data.series.reduce((s, x) => s + Math.max(0, x.values[i] ?? 0), 0))
  const maxV = type === 'pie' ? 1 : niceMax(Math.max(...(stacked ? sums : data.series.flatMap((s) => s.values)), 0)), minV = Math.min(0, ...data.series.flatMap((s) => s.values))
  const lo = minV < 0 ? -niceMax(-minV) : 0
  const y = (v: number) => pad.t + ih - ((v - lo) / (maxV - lo || 1)) * ih
  const ticks = Array.from({ length: 5 }, (_, i) => lo + ((maxV - lo) * i) / 4)
  const legend = (showLegend ?? data.series.length > 1) && data.series.length > 0 && (
    <g transform={`translate(${pad.l}, ${h - 14})`}>{data.series.map((s, i) => (
      <g key={i} transform={`translate(${i * 110}, 0)`}><rect width="10" height="10" y="-9" rx="2" fill={COL[i % COL.length]} /><text x="15" fontSize="11" fill="var(--muted)">{s.name.slice(0, 14)}</text></g>))}</g>
  )
  const titleEl = title && <text x={w / 2} y={22} textAnchor="middle" fontSize="14" fontWeight="600" fill="var(--ink)">{title}</text>

  if (type === 'pie') {
    const vals = data.series[0].values.map((v) => Math.max(0, v)), total = vals.reduce((s, v) => s + v, 0) || 1
    const cx = w / 2 - 40, cy = pad.t + ih / 2, rad = Math.min(iw, ih) / 2
    let a0 = -Math.PI / 2
    return (
      <svg width={w} height={h}>{titleEl}
        {vals.map((v, i) => {
          const a1 = a0 + (v / total) * Math.PI * 2, large = a1 - a0 > Math.PI ? 1 : 0
          const d = vals.length === 1 ? `M ${cx} ${cy - rad} A ${rad} ${rad} 0 1 1 ${cx - 0.01} ${cy - rad} Z` : `M ${cx} ${cy} L ${cx + rad * Math.cos(a0)} ${cy + rad * Math.sin(a0)} A ${rad} ${rad} 0 ${large} 1 ${cx + rad * Math.cos(a1)} ${cy + rad * Math.sin(a1)} Z`
          a0 = a1
          return <path key={i} d={d} fill={COL[i % COL.length]} stroke="var(--sheet)" strokeWidth="2"><title>{`${data.cats[i]}: ${v} (${((v / total) * 100).toFixed(1)}%)`}</title></path>
        })}
        <g transform={`translate(${cx + rad + 18}, ${pad.t + 6})`}>{data.cats.slice(0, 12).map((c, i) => (
          <g key={i} transform={`translate(0, ${i * 18})`}><rect width="10" height="10" y="-9" rx="2" fill={COL[i % COL.length]} /><text x="15" fontSize="11" fill="var(--muted)">{c.slice(0, 16)}</text></g>))}</g>
      </svg>
    )
  }

  if (type === 'bar') {
    const bx = (v: number) => pad.l + ((v - lo) / (maxV - lo || 1)) * iw
    const band = ih / Math.max(1, n), bw = (band * 0.7) / data.series.length
    return (
      <svg width={w} height={h}>{titleEl}
        {ticks.map((t, i) => <g key={i}><line x1={bx(t)} x2={bx(t)} y1={pad.t} y2={pad.t + ih} stroke="var(--grid)" /><text x={bx(t)} y={pad.t + ih + 14} textAnchor="middle" fontSize="10" fill="var(--muted)">{fmt(t)}</text></g>)}
        {data.cats.map((c, i) => <text key={i} x={pad.l - 6} y={pad.t + band * i + band / 2 + 3} textAnchor="end" fontSize="10" fill="var(--muted)">{c.slice(0, 8)}</text>)}
        {data.series.map((s, si) => s.values.map((v, i) => <rect key={`${si}-${i}`} x={bx(Math.min(0, v))} y={pad.t + band * i + band * 0.15 + si * bw} width={Math.abs(bx(v) - bx(0))} height={bw - 1} rx="2" fill={COL[si % COL.length]}><title>{`${s.name} · ${data.cats[i]}: ${v}`}</title></rect>))}
        {legend}
      </svg>
    )
  }

  const band = iw / Math.max(1, n)
  const xAt = (i: number) => pad.l + band * i + band / 2
  const grid = ticks.map((t, i) => <g key={i}><line x1={pad.l} x2={pad.l + iw} y1={y(t)} y2={y(t)} stroke="var(--grid)" /><text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="var(--muted)">{fmt(t)}</text></g>)
  const cats = data.cats.map((c, i) => (n <= 14 || i % Math.ceil(n / 14) === 0) && <text key={i} x={xAt(i)} y={pad.t + ih + 14} textAnchor="middle" fontSize="10" fill="var(--muted)">{c.slice(0, 8)}</text>)

  if (type === 'column') {
    const bw = (band * 0.7) / (stacked ? 1 : data.series.length)
    const acc = new Array(n).fill(0)
    return (
      <svg width={w} height={h}>{titleEl}{grid}{cats}
        {data.series.map((s, si) => s.values.map((v, i) => {
          const base = stacked ? acc[i] : 0; if (stacked) acc[i] += Math.max(0, v)
          const top = y(base + v), bottom = y(base)
          return <rect key={`${si}-${i}`} x={pad.l + band * i + band * 0.15 + (stacked ? 0 : si * bw)} y={Math.min(top, bottom)} width={Math.max(1, bw - 1)} height={Math.abs(bottom - top)} rx="2" fill={COL[si % COL.length]}><title>{`${s.name} · ${data.cats[i]}: ${v}`}</title></rect>
        }))}
        {legend}
      </svg>
    )
  }
  if (type === 'scatter') {
    const xs = data.cats.map((c) => Number(c)), numeric = xs.every((x) => !Number.isNaN(x))
    const xmin = numeric ? Math.min(...xs) : 0, xmax = numeric ? Math.max(...xs) : n - 1
    const sx = (i: number) => pad.l + ((numeric ? xs[i] : i) - xmin) / (xmax - xmin || 1) * iw
    return (
      <svg width={w} height={h}>{titleEl}{grid}
        {data.series.map((s, si) => s.values.map((v, i) => <circle key={`${si}-${i}`} cx={sx(i)} cy={y(v)} r="4" fill={COL[si % COL.length]} fillOpacity=".8"><title>{`${data.cats[i]}, ${v}`}</title></circle>))}
        {legend}
      </svg>
    )
  }
  return (
    <svg width={w} height={h}>{titleEl}{grid}{cats}
      {data.series.map((s, si) => {
        const pts = s.values.map((v, i) => `${xAt(i)},${y(v)}`).join(' ')
        return (
          <g key={si}>
            {type === 'area' && <polygon points={`${xAt(0)},${y(0)} ${pts} ${xAt(n - 1)},${y(0)}`} fill={COL[si % COL.length]} fillOpacity=".22" />}
            <polyline points={pts} fill="none" stroke={COL[si % COL.length]} strokeWidth="2.2" strokeLinejoin="round" />
            {s.values.map((v, i) => <circle key={i} cx={xAt(i)} cy={y(v)} r="3" fill={COL[si % COL.length]}><title>{`${s.name} · ${data.cats[i]}: ${v}`}</title></circle>)}
          </g>
        )
      })}
      {legend}
    </svg>
  )
}

/** Floating, draggable, resizable chart objects drawn on top of the grid. */
export function ChartLayer({ model, sheet, version, selected, setSelected, readOnly, onEdit }: {
  model: SheetModel; sheet: string; version: number; selected: string | null; setSelected: (id: string | null) => void; readOnly: boolean; onEdit: (c: Chart) => void
}) {
  const charts = model.charts(sheet)
  const [live, setLive] = useState<Record<string, Partial<Chart>>>({})
  const drag = useRef<{ id: string; mode: 'move' | 'size'; sx: number; sy: number; o: Chart } | null>(null)
  void version

  const start = (e: React.MouseEvent, c: Chart, mode: 'move' | 'size') => {
    if (readOnly) return
    e.preventDefault(); e.stopPropagation()
    setSelected(c.id)
    drag.current = { id: c.id, mode, sx: e.clientX, sy: e.clientY, o: c }
    const move = (ev: MouseEvent) => {
      const d = drag.current; if (!d) return
      const dx = ev.clientX - d.sx, dy = ev.clientY - d.sy
      setLive({ [d.id]: d.mode === 'move' ? { x: Math.max(0, d.o.x + dx), y: Math.max(0, d.o.y + dy) } : { w: Math.max(200, d.o.w + dx), h: Math.max(140, d.o.h + dy) } })
    }
    const up = () => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up)
      const d = drag.current; drag.current = null
      setLive((cur) => { if (d && cur[d.id]) model.updateChart(sheet, d.id, cur[d.id]); return {} })
    }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }

  return (
    <>
      {charts.map((c0) => {
        const c = { ...c0, ...live[c0.id] }
        const data = chartData(model, sheet, c)
        return (
          <div key={c.id} className={`sg-chart ${selected === c.id ? 'sel' : ''}`} style={{ left: c.x, top: c.y, width: c.w, height: c.h }} onMouseDown={(e) => { e.stopPropagation(); setSelected(c.id) }}>
            <div className="sg-chart-drag" onMouseDown={(e) => start(e, c, 'move')} />
            {data ? <ChartSvg type={c.type} data={data} w={c.w} h={c.h} title={c.title} stacked={c.stacked} /> : <div className="sg-chart-empty">Chart range {c.range} is not valid</div>}
            {selected === c.id && !readOnly && (
              <>
                <div className="sg-chart-tools">
                  <button title="Edit chart" aria-label="Edit chart" onClick={() => onEdit(c0)}><Pencil size={15} /></button>
                  <button title="Delete chart" aria-label="Delete chart" onClick={() => { model.removeChart(sheet, c.id); setSelected(null) }}><Trash2 size={15} /></button>
                </div>
                <div className="sg-chart-size" onMouseDown={(e) => start(e, c, 'size')} />
              </>
            )}
          </div>
        )
      })}
    </>
  )
}

export function ChartDialog({ initial, onSave, onClose }: { initial: Omit<Chart, 'id' | 'x' | 'y'> & { id?: string }; onSave: (c: Omit<Chart, 'id' | 'x' | 'y'>) => void; onClose: () => void }) {
  const [c, setC] = useState(initial)
  const valid = useMemo(() => !!parseRangeText(c.range), [c.range])
  return (
    <Modal title={initial.id ? 'Edit chart' : 'Insert chart'} onClose={onClose} width={480}>
      <div className="share-body">
        <div className="chart-types">
          {CHART_TYPES.map((t) => (
            <button key={t.id} className={c.type === t.id ? 'on' : ''} onClick={() => setC({ ...c, type: t.id })}><t.icon size={22} /><span>{t.label}</span></button>
          ))}
        </div>
        <label className="field compact"><input value={c.title} placeholder="Chart title" onChange={(e) => setC({ ...c, title: e.target.value })} /></label>
        <label className="field compact"><input value={c.range} placeholder="Data range, e.g. A1:C10" onChange={(e) => setC({ ...c, range: e.target.value })} spellCheck={false} /></label>
        {!valid && <p className="form-error">Enter a range like A1:C10</p>}
        <label className="chk"><input type="checkbox" checked={c.headers} onChange={(e) => setC({ ...c, headers: e.target.checked })} />First row has series names</label>
        {(c.type === 'column' || c.type === 'area') && <label className="chk"><input type="checkbox" checked={!!c.stacked} onChange={(e) => setC({ ...c, stacked: e.target.checked })} />Stacked</label>}
        <div className="modal-actions dlg-actions">
          <button className="btn btn-pill btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-pill btn-primary" disabled={!valid} onClick={() => { onSave(c); onClose() }}>{initial.id ? 'Save' : 'Insert'}</button>
        </div>
      </div>
    </Modal>
  )
}

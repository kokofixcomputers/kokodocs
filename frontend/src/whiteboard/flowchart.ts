import type { WhiteboardModel } from './model'
import { center, elbow, leave, type Pt } from './geometry'
import { fitText, layout } from './text'
import type { El, Head, ShapeKind } from './types'

/** Lay out a diagram from its steps and links: boxes in layers (a step is below, or to the right of, everything that leads to it) with square-cornered arrows between them. */
export interface FlowNode { id: string; label: string; kind?: string; fill?: string }
export interface FlowLink { from: string; to: string; label?: string; dashed?: boolean }
export interface FlowSpec { nodes: FlowNode[]; links: FlowLink[]; direction?: 'down' | 'right'; clean?: boolean; colors?: boolean }

const KIND: Record<string, { shape: ShapeKind; rad?: number; fill: string }> = {
  process: { shape: 'rect', rad: 14, fill: '#bfdbfe' }, start: { shape: 'rect', rad: 999, fill: '#bbf7d0' }, end: { shape: 'rect', rad: 999, fill: '#fecaca' }, decision: { shape: 'diamond', fill: '#fef08a' },
  data: { shape: 'parallelogram', fill: '#ddd6fe' }, database: { shape: 'cylinder', fill: '#99f6e4' }, document: { shape: 'document', fill: '#fed7aa' }, cloud: { shape: 'cloud', fill: '#e5e7eb' }, note: { shape: 'rect', fill: '#fef08a' },
}

/** make a shape big enough for its words */
export function sizeFor(e: El, wGiven = false, hGiven = false): El {
  if (!e.text) return e
  const k = e.type === 'diamond' ? 1.9 : e.type === 'ellipse' || e.type === 'cloud' ? 1.4 : e.type === 'triangle' ? 1.8 : e.type === 'hexagon' ? 1.25 : 1.12
  const probe = layout({ ...e, w: 100000, type: 'text', wrap: false } as El)
  let w = e.w, h = e.h
  if (!wGiven) w = Math.max(e.type === 'diamond' ? 170 : 130, Math.min(300, (probe.w + 36) * k))
  if (!hGiven) { const inner = layout({ ...e, w }); h = Math.max(e.type === 'diamond' ? 110 : 70, (inner.h + 28) * k) }
  return { ...e, w: Math.round(w), h: Math.round(h) }
}

export function arrowBetween(m: WhiteboardModel, from: El | undefined, to: El | undefined, o: { curve?: 'straight' | 'curved' | 'elbow'; text?: string; dashed?: boolean; clean?: boolean; he?: Head; kind?: 'arrow' | 'line'; p0?: Pt; p1?: Pt; stroke?: string } = {}): El {
  const p0 = from ? center(from) : o.p0 ?? [0, 0], p1 = to ? center(to) : o.p1 ?? [160, 0]
  const curve = o.curve ?? 'straight'
  let pts: Pt[] = [p0, p1]
  if (curve === 'elbow') pts = elbow(p0, p1, from, to)
  else { if (from) pts[0] = leave(from, p1); if (to) pts[1] = leave(to, p0) }
  const type = o.kind ?? 'arrow'
  return m.make(type, {
    x: pts[0][0], y: pts[0][1], pts: pts.map((q) => [q[0] - pts[0][0], q[1] - pts[0][1]] as Pt), curve, he: type === 'arrow' ? (o.he ?? 'arrow') : 'none', hs: 'none',
    ...(from ? { from: { id: from.id } } : {}), ...(to ? { to: { id: to.id } } : {}), ...(o.text ? { text: o.text, font: 'Caveat', size: 20 } : {}), ...(o.dashed ? { ss: 'dashed' as const } : {}), ...(o.clean ? { ro: 0 as const } : {}), ...(o.stroke ? { stroke: o.stroke } : {}),
  }, {})
}

export function buildFlowchart(m: WhiteboardModel, spec: FlowSpec, origin: Pt): { els: El[]; order: string[] } {
  const nodes = spec.nodes, links = spec.links
  if (!nodes.length) throw new Error('Give at least one node.')
  const ids = new Set(nodes.map((n) => String(n.id)))
  for (const l of links) if (!ids.has(String(l.from)) || !ids.has(String(l.to))) throw new Error(`The link ${l.from} → ${l.to} uses a name that is not in nodes.`)
  const layer = new Map<string, number>(), outs = new Map<string, string[]>()
  links.forEach((l) => outs.set(String(l.from), [...(outs.get(String(l.from)) ?? []), String(l.to)]))
  const incoming = new Set(links.map((l) => String(l.to)))
  const roots = nodes.map((n) => String(n.id)).filter((id) => !incoming.has(id)); if (!roots.length) roots.push(String(nodes[0].id))
  const visit = (id: string, depth: number, stack: Set<string>) => { if (stack.has(id) || (layer.get(id) ?? -1) >= depth) return; layer.set(id, depth); stack.add(id); (outs.get(id) ?? []).forEach((t) => visit(t, depth + 1, stack)); stack.delete(id) }
  roots.forEach((r) => visit(r, 0, new Set()))
  nodes.forEach((n) => { if (!layer.has(String(n.id))) layer.set(String(n.id), 0) })
  const rows = new Map<number, FlowNode[]>(); nodes.forEach((n) => { const l = layer.get(String(n.id))!; rows.set(l, [...(rows.get(l) ?? []), n]) })
  const right = spec.direction === 'right', clean = !!spec.clean, soft = spec.colors !== false
  const built = new Map<string, El>()
  for (const n of nodes) {
    const k = KIND[n.kind ?? 'process'] ?? KIND.process
    built.set(String(n.id), sizeFor(m.make(k.shape, { text: String(n.label), font: 'Caveat', size: 22, ta: 'center', ...(k.rad ? { rad: k.rad } : {}), ro: clean ? 0 : 1, ...(soft || n.fill ? { fill: n.fill ?? k.fill, fs: 'solid' as const } : {}) }, {})))
  }
  const GAP_MAIN = 90, GAP_CROSS = 60
  const lay = [...rows.keys()].sort((p, q) => p - q)
  const span = (n: FlowNode) => (right ? built.get(String(n.id))!.h : built.get(String(n.id))!.w)
  const thickOf = (n: FlowNode) => (right ? built.get(String(n.id))!.w : built.get(String(n.id))!.h)
  const totals = new Map<number, number>(); let widest = 0
  for (const li of lay) { const list = rows.get(li)!; const t = list.reduce((s, n) => s + span(n), 0) + (list.length - 1) * GAP_CROSS; totals.set(li, t); widest = Math.max(widest, t) }
  let main = right ? origin[0] : origin[1]
  for (const li of lay) {
    const list = rows.get(li)!
    let c = (right ? origin[1] : origin[0]) + (widest - totals.get(li)!) / 2
    const thick = Math.max(...list.map(thickOf))
    for (const n of list) {
      const e = built.get(String(n.id))!
      if (right) { e.x = main + (thick - e.w) / 2; e.y = c; c += e.h + GAP_CROSS } else { e.y = main + (thick - e.h) / 2; e.x = c; c += e.w + GAP_CROSS }
    }
    main += thick + GAP_MAIN
  }
  const arrows = links.map((l) => arrowBetween(m, built.get(String(l.from)), built.get(String(l.to)), { curve: 'elbow', text: l.label, dashed: l.dashed, clean }))
  return { els: [...built.values(), ...arrows], order: [...built.keys()] }
}

/** starting points for common diagrams */
export const TEMPLATES: { name: string; spec: FlowSpec }[] = [
  { name: 'Flowchart', spec: { nodes: [{ id: 'a', label: 'Start', kind: 'start' }, { id: 'b', label: 'Do something', kind: 'process' }, { id: 'c', label: 'Is it done?', kind: 'decision' }, { id: 'd', label: 'Fix it', kind: 'process' }, { id: 'e', label: 'Finish', kind: 'end' }], links: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'e', label: 'Yes' }, { from: 'c', to: 'd', label: 'No' }, { from: 'd', to: 'b', dashed: true }] } },
  { name: 'Process (left to right)', spec: { direction: 'right', nodes: [{ id: '1', label: 'Plan' }, { id: '2', label: 'Build' }, { id: '3', label: 'Test' }, { id: '4', label: 'Ship', kind: 'end' }], links: [{ from: '1', to: '2' }, { from: '2', to: '3' }, { from: '3', to: '4' }] } },
  { name: 'Org chart', spec: { nodes: [{ id: 'ceo', label: 'Director' }, { id: 'a', label: 'Design lead' }, { id: 'b', label: 'Engineering lead' }, { id: 'c', label: 'Marketing lead' }, { id: 'a1', label: 'Designer', kind: 'note' }, { id: 'b1', label: 'Developer', kind: 'note' }, { id: 'b2', label: 'Developer', kind: 'note' }], links: [{ from: 'ceo', to: 'a' }, { from: 'ceo', to: 'b' }, { from: 'ceo', to: 'c' }, { from: 'a', to: 'a1' }, { from: 'b', to: 'b1' }, { from: 'b', to: 'b2' }] } },
  { name: 'Decision tree', spec: { nodes: [{ id: 'q', label: 'Is the bug reproducible?', kind: 'decision' }, { id: 'y', label: 'Write a test', kind: 'process' }, { id: 'n', label: 'Ask for details', kind: 'process' }, { id: 'f', label: 'Fix and review', kind: 'process' }], links: [{ from: 'q', to: 'y', label: 'Yes' }, { from: 'q', to: 'n', label: 'No' }, { from: 'y', to: 'f' }] } },
  { name: 'System diagram', spec: { nodes: [{ id: 'u', label: 'User', kind: 'start' }, { id: 'w', label: 'Web app' }, { id: 'api', label: 'API' }, { id: 'db', label: 'Database', kind: 'database' }, { id: 'q', label: 'Queue', kind: 'cloud' }], links: [{ from: 'u', to: 'w' }, { from: 'w', to: 'api' }, { from: 'api', to: 'db' }, { from: 'api', to: 'q' }] } },
]
void fitText

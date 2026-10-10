import type { WhiteboardModel } from '../whiteboard/model'
import { absPts, center, elbow, leave, pageBox, union, type Pt } from '../whiteboard/geometry'
import { fitText, layout } from '../whiteboard/text'
import { buildFlowchart } from '../whiteboard/flowchart'
import { SHAPES, isLinear, isShape, type El, type Head, type ShapeKind } from '../whiteboard/types'
import { type Adapter, type Tool, MAX_RESULT_CHARS, clip, tool } from './adapter'
import { loadFont } from '../fonts'

export interface WhiteboardDeps {
  model: WhiteboardModel
  getSel: () => string[]
  setSel: (ids: string[]) => void
  getTitle: () => string
  canEdit: () => boolean
  docId: string
  getView: () => { x: number; y: number; z: number }
  setView: (v: { x: number; y: number; z: number }) => void
  fit: () => void
  size: () => { w: number; h: number }
  here: () => Pt
  bringFrameToLife: (frameId: string, instruction?: string) => Promise<string>
  reviseWebsite: (embedId: string, instruction: string) => Promise<string>
}

const SHAPE_KINDS = SHAPES.map((s) => s.kind)
const NAMED: Record<string, string> = { red: '#dc2626', orange: '#ea580c', yellow: '#facc15', green: '#16a34a', teal: '#0d9488', blue: '#2563eb', purple: '#7c3aed', pink: '#db2777', gray: '#6b7280', grey: '#6b7280', black: '#1e1e2e', white: '#ffffff', brown: '#92400e', none: 'transparent', transparent: 'transparent', lightblue: '#bfdbfe', lightgreen: '#bbf7d0', lightyellow: '#fef08a', lightred: '#fecaca', lightpink: '#fbcfe8', lightpurple: '#ddd6fe', lightgray: '#e5e7eb', lightgrey: '#e5e7eb', lightorange: '#fed7aa' }
/** a colour the model wrote (a name, #hex, rgb()) as a hex value, or undefined if it is not one */
function color(v: unknown): string | undefined {
  if (typeof v !== 'string' || !v.trim()) return undefined
  const s = v.trim().toLowerCase().replace(/[\s_-]/g, '')
  if (NAMED[s]) return NAMED[s]
  if (/^#[0-9a-f]{6}$/.test(s)) return s
  if (/^#[0-9a-f]{3}$/.test(s)) return '#' + [...s.slice(1)].map((c) => c + c).join('')
  try { const g = document.createElement('canvas').getContext('2d')!; g.fillStyle = '#010203'; g.fillStyle = v; const out = g.fillStyle; if (out !== '#010203') return out } catch { /* not a colour */ }
  return undefined
}
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : d)
const r = (n: number) => Math.round(n)
const HEADS: Head[] = ['none', 'arrow', 'triangle', 'dot', 'bar', 'diamond']

export function createWhiteboardAdapter(d: WhiteboardDeps): Adapter {
  const m = d.model
  const find = (v: unknown): El => {
    const e = m.get(String(v)) ?? m.read().find((x) => x.text && x.text.trim().toLowerCase() === String(v).trim().toLowerCase())
    if (!e) throw new Error(`There is nothing on the board with id “${v}”. Read the board for the ids.`)
    return e
  }

  /** one line about an element, for reading the board */
  const line = (e: El, byId: Map<string, El>): string => {
    const b = pageBox(e), z = m.read().indexOf(e) + 1
    const nm = (id?: string) => (id ? (byId.get(id)?.text?.trim().split('\n')[0] || byId.get(id)?.type || '?').slice(0, 30) : undefined)
    const bits: string[] = [`id ${e.id}`, e.type + (e.type === 'frame' && e.ai ? ' (AI frame)' : '')]
    if (e.type === 'arrow' || e.type === 'line') {
      const a = absPts(e)
      bits.push(`from ${e.from ? `“${nm(e.from.id)}” (${e.from.id})` : `(${r(a[0][0])}, ${r(a[0][1])})`} to ${e.to ? `“${nm(e.to.id)}” (${e.to.id})` : `(${r(a[a.length - 1][0])}, ${r(a[a.length - 1][1])})`}`)
    } else bits.push(`at (${r(b.x)}, ${r(b.y)}) size ${r(b.w)}×${r(b.h)}${e.a ? ` rotated ${r((e.a * 180) / Math.PI)}°` : ''}`)
    if (e.text?.trim()) bits.push(`text “${clip(e.text.trim().replace(/\n/g, ' / '), 120)}”`)
    if (e.name) bits.push(`name “${e.name}”`)
    if (e.type !== 'text' && e.type !== 'image' && e.type !== 'embed') { bits.push(`stroke ${e.stroke}`); if (e.fill !== 'transparent') bits.push(`fill ${e.fill}`) }
    if (e.text && (e.font || e.tc)) bits.push(`font ${e.font ?? 'default'} ${e.size ?? ''}px${e.tc && e.tc !== e.stroke ? ` colour ${e.tc}` : ''}`)
    if (e.grp) bits.push(`group ${e.grp}`)
    if (e.lock) bits.push('locked'); if (e.hide) bits.push('hidden')
    bits.push(`layer ${z} of ${m.read().length}`)
    return '- ' + bits.join(', ')
  }

  const readBoard: Tool = tool('read_board', 'Read what is on the whiteboard: every shape, text, arrow, picture and frame with its id, place, size, text, colours and layer (back to front; a higher layer is in front). Use "frame" to read only what is inside one frame, or "selected" to read only what the person has selected.',
    { frame: { type: 'string', description: 'Id (or name) of a frame to read the contents of' }, selected: { type: 'boolean' } }, [], {
      label: () => 'Read the whiteboard',
      run: (a) => {
        let list = m.read(); const byId = new Map(list.map((e) => [e.id, e]))
        if (a?.frame) { const f = list.find((e) => e.type === 'frame' && (e.id === a.frame || e.name?.toLowerCase() === String(a.frame).toLowerCase())); if (!f) throw new Error('There is no such frame.'); list = list.filter((e) => e.id !== f.id && pageBox(e).x >= f.x && pageBox(e).y >= f.y && pageBox(e).x + pageBox(e).w <= f.x + f.w && pageBox(e).y + pageBox(e).h <= f.y + f.h) }
        if (a?.selected) { const s = new Set(d.getSel()); list = list.filter((e) => s.has(e.id)) }
        if (!list.length) return 'The whiteboard is empty.'
        const b = union(list.filter((e) => !e.hide).map(pageBox))
        const out = `${list.length} things${b ? `, covering x ${r(b.x)} to ${r(b.x + b.w)} and y ${r(b.y)} to ${r(b.y + b.h)}` : ''}. x grows to the right and y grows downwards.\n` + list.map((e) => line(e, byId)).join('\n')
        return out.length > MAX_RESULT_CHARS ? out.slice(0, MAX_RESULT_CHARS) + '\n… (cut short)' : out
      },
    })

  /** make room-sized shapes for their words */
  const fitShape = (e: El, wGiven: boolean, hGiven: boolean): El => {
    if (!e.text) return e
    loadFont(e.font ?? 'Caveat')
    const k = e.type === 'diamond' ? 1.9 : e.type === 'ellipse' || e.type === 'cloud' ? 1.4 : e.type === 'triangle' ? 1.8 : e.type === 'hexagon' ? 1.25 : 1.12
    const probe = layout({ ...e, w: 100000, type: 'text', wrap: false } as El)
    let w = e.w, h = e.h
    if (!wGiven) w = Math.max(e.type === 'diamond' ? 170 : 130, Math.min(300, (probe.w + 36) * k))
    if (!hGiven) { const inner = layout({ ...e, w }); h = Math.max(e.type === 'diamond' ? 110 : 70, (inner.h + 28) * k) }
    return { ...e, w: r(w), h: r(h) }
  }

  const styleOf = (a: any, base: Partial<El> = {}): Partial<El> => {
    const o: Partial<El> = { ...base }
    const st = color(a.stroke ?? a.color), fl = color(a.fill ?? a.background)
    if (st) o.stroke = st; if (fl) { o.fill = fl; if (fl !== 'transparent' && !a.fill_style) o.fs = 'solid' }
    if (a.fill_style && ['solid', 'hachure', 'cross-hatch', 'zigzag', 'dots'].includes(a.fill_style)) o.fs = a.fill_style
    if (a.stroke_width !== undefined) o.sw = Math.max(1, Math.min(40, num(a.stroke_width, 2)))
    if (a.stroke_style && ['solid', 'dashed', 'dotted'].includes(a.stroke_style)) o.ss = a.stroke_style
    if (a.sketchiness !== undefined) { const k = ['clean', 'sketchy', 'messy'].indexOf(String(a.sketchiness)); o.ro = k >= 0 ? k : Math.max(0, Math.min(3, num(a.sketchiness, 1))) }
    if (a.opacity !== undefined) o.op = Math.max(5, Math.min(100, num(a.opacity, 100)))
    if (typeof a.font === 'string' && a.font.trim()) o.font = a.font.trim()
    if (a.font_size !== undefined) o.size = Math.max(8, Math.min(200, num(a.font_size, 24)))
    if (a.text_align && ['left', 'center', 'right'].includes(a.text_align)) o.ta = a.text_align
    const tc = color(a.text_color); if (tc) o.tc = tc
    if (a.bold !== undefined) o.bold = !!a.bold; if (a.italic !== undefined) o.italic = !!a.italic
    return o
  }
  const STYLE_PROPS = {
    stroke: { type: 'string', description: 'Outline colour: a name (red, blue…) or #hex' }, fill: { type: 'string', description: 'Fill colour (a name or #hex), or "none"' },
    fill_style: { type: 'string', enum: ['solid', 'hachure', 'cross-hatch', 'zigzag', 'dots'] }, stroke_width: { type: 'number', description: '1 to 40 (2 is normal)' }, stroke_style: { type: 'string', enum: ['solid', 'dashed', 'dotted'] },
    sketchiness: { type: 'string', description: 'How hand-drawn the lines look: clean, sketchy (default) or messy, or a number from 0 (clean) to 3' }, opacity: { type: 'number' },
    font: { type: 'string', description: 'Any Google font name, e.g. Caveat (handwriting, the default), Inter, Lora, Permanent Marker' }, font_size: { type: 'number' }, text_align: { type: 'string', enum: ['left', 'center', 'right'] },
    text_color: { type: 'string' }, bold: { type: 'boolean' }, italic: { type: 'boolean' },
  }

  /** the arrow between two things, from its ends */
  const makeArrow = (a: any, lookup: (v: unknown) => El | undefined): El => {
    const from = a.from !== undefined ? lookup(a.from) : undefined, to = a.to !== undefined ? lookup(a.to) : undefined
    let p0: Pt, p1: Pt
    if (from && to) { p0 = center(from); p1 = center(to) }
    else if (from) p1 = [num(a.x2, center(from)[0] + 160), num(a.y2, center(from)[1])], p0 = center(from)
    else if (to) p0 = [num(a.x1, center(to)[0] - 160), num(a.y1, center(to)[1])], p1 = center(to)
    else p0 = [num(a.x1, 0), num(a.y1, 0)], p1 = [num(a.x2, 160), num(a.y2, 0)]
    const type = a.kind === 'line' ? 'line' : 'arrow'
    const curve = ['straight', 'curved', 'elbow'].includes(a.curve) ? a.curve : 'straight'
    let pts: Pt[] = [p0, p1]
    if (curve === 'elbow') pts = elbow(p0, p1, from, to)
    else { if (from) pts[0] = leave(from, p1); if (to) pts[1] = leave(to, p0) }
    const he: Head = type === 'arrow' ? (HEADS.includes(a.end_head) ? a.end_head : 'arrow') : 'none'
    const o = m.make(type, { x: pts[0][0], y: pts[0][1], pts: pts.map((q) => [q[0] - pts[0][0], q[1] - pts[0][1]] as Pt), curve, he, hs: HEADS.includes(a.start_head) ? a.start_head : 'none', ...(from ? { from: { id: from.id } } : {}), ...(to ? { to: { id: to.id } } : {}), ...(a.text ? { text: String(a.text), font: 'Caveat', size: 20 } : {}) }, {})
    return { ...o, ...styleOf(a), ...(a.text && !a.font ? {} : {}) } as El
  }

  const addShapes: Tool = tool('add_shapes', `Draw shapes, text and arrows on the whiteboard. Each shape can hold its own text (set "text": it is drawn inside the shape, centred, on top of the fill). Arrows join shapes by "ref" (a name you give a shape in this call) or by the id of a shape already on the board, and follow the shapes when they are moved. Things are added in the order you list them, each in front of the last. Shape kinds: ${SHAPE_KINDS.join(', ')}.`, {
    shapes: { type: 'array', description: 'Shapes to draw', items: { type: 'object', properties: { ref: { type: 'string', description: 'A short name for arrows to use' }, shape: { type: 'string', enum: SHAPE_KINDS }, x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' }, text: { type: 'string' }, rounded: { type: 'boolean', description: 'Rectangles only: rounded corners' }, rotation_degrees: { type: 'number' }, ...STYLE_PROPS }, required: ['shape', 'x', 'y'] } },
    texts: { type: 'array', description: 'Free-standing text', items: { type: 'object', properties: { ref: { type: 'string' }, text: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, ...STYLE_PROPS }, required: ['text', 'x', 'y'] } },
    arrows: { type: 'array', description: 'Arrows or lines', items: { type: 'object', properties: { from: { type: 'string', description: 'ref or id of the shape it starts at' }, to: { type: 'string', description: 'ref or id of the shape it ends at' }, x1: { type: 'number' }, y1: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' }, kind: { type: 'string', enum: ['arrow', 'line'] }, curve: { type: 'string', enum: ['straight', 'curved', 'elbow'] }, text: { type: 'string', description: 'A label on the arrow' }, start_head: { type: 'string', enum: HEADS }, end_head: { type: 'string', enum: HEADS }, ...STYLE_PROPS } } },
  }, [], {
    edit: true,
    describe: (a) => ({ title: `Draw ${[a.shapes?.length && `${a.shapes.length} shape${a.shapes.length === 1 ? '' : 's'}`, a.texts?.length && `${a.texts.length} text${a.texts.length === 1 ? '' : 's'}`, a.arrows?.length && `${a.arrows.length} arrow${a.arrows.length === 1 ? '' : 's'}`].filter(Boolean).join(', ') || 'nothing'}`, detail: clip([...(a.shapes ?? []).map((s: any) => `${s.shape}${s.text ? ` “${s.text}”` : ''}`), ...(a.texts ?? []).map((t: any) => `text “${t.text}”`)].slice(0, 12).join('\n'), 300) }),
    run: (a) => {
      const refs = new Map<string, El>(), made: El[] = []
      for (const s of a.shapes ?? []) {
        const kind = (SHAPE_KINDS.includes(s.shape) ? s.shape : 'rect') as ShapeKind
        const base = styleOf(s, {}), rect = kind === 'rect'
        let e = m.make(kind, { x: num(s.x, 0), y: num(s.y, 0), w: num(s.w, 160), h: num(s.h, 100), font: 'Caveat', size: 24, ta: 'center', ...(rect && s.rounded ? { rad: 18 } : {}), ...(s.text ? { text: String(s.text) } : {}), ...(s.rotation_degrees ? { a: (num(s.rotation_degrees, 0) * Math.PI) / 180 } : {}) }, {})
        e = fitShape({ ...e, ...base } as El, s.w !== undefined, s.h !== undefined)
        if (s.ref) refs.set(String(s.ref), e)
        made.push(e)
      }
      for (const t of a.texts ?? []) {
        let e = m.make('text', { x: num(t.x, 0), y: num(t.y, 0), text: String(t.text ?? ''), font: 'Caveat', size: 24, ta: 'left', ...styleOf(t) }, {})
        e = { ...e, tc: (t.text_color && color(t.text_color)) || (t.color && color(t.color)) || (t.stroke && color(t.stroke)) || e.tc || '#1e1e2e' } as El
        loadFont(e.font ?? 'Caveat'); Object.assign(e, fitText(e))
        if (t.ref) refs.set(String(t.ref), e)
        made.push(e)
      }
      const look = (v: unknown) => refs.get(String(v)) ?? m.get(String(v))
      for (const ar of a.arrows ?? []) {
        for (const k of ['from', 'to']) if (ar[k] !== undefined && !look(ar[k])) throw new Error(`The arrow refers to “${ar[k]}”, which is not a ref in this call or an id on the board.`)
        made.push(makeArrow(ar, look))
      }
      if (!made.length) throw new Error('Nothing to draw: give shapes, texts or arrows.')
      const ids = m.add(made)
      d.setSel(ids)
      const b = union(made.map(pageBox)); if (b) ensureVisible(b)
      return `Added ${made.length} thing${made.length === 1 ? '' : 's'}.\n` + made.map((e, i) => `- ${[...refs.entries()].find(([, v]) => v === e)?.[0] ?? e.type}: id ${ids[i]}`).join('\n')
    },
  })

  /** bring new work into view if it landed off the screen */
  function ensureVisible(b: { x: number; y: number; w: number; h: number }) {
    const v = d.getView(), s = d.size()
    const x0 = b.x * v.z + v.x, y0 = b.y * v.z + v.y, x1 = (b.x + b.w) * v.z + v.x, y1 = (b.y + b.h) * v.z + v.y
    if (x0 < 0 || y0 < 0 || x1 > s.w || y1 > s.h) {
      const z = Math.max(0.1, Math.min(1.2, (s.w - 200) / Math.max(1, b.w), (s.h - 200) / Math.max(1, b.h)))
      d.setView({ z, x: s.w / 2 - (b.x + b.w / 2) * z, y: s.h / 2 - (b.y + b.h / 2) * z })
    }
  }

  const flowchart: Tool = tool('create_flowchart', 'Lay out a flowchart or diagram automatically from its steps and the links between them: boxes are placed in layers so arrows do not cross things. Use "start" and "end" kinds for rounded terminators, "decision" for diamonds, "data" for slanted boxes, "database" for a cylinder, "document" for a page, anything else is a rectangle.', {
    nodes: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', description: 'A short name used by the links' }, label: { type: 'string' }, kind: { type: 'string', enum: ['process', 'start', 'end', 'decision', 'data', 'database', 'document', 'cloud', 'note'] }, fill: { type: 'string' } }, required: ['id', 'label'] } },
    links: { type: 'array', items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string', description: 'e.g. Yes / No' }, dashed: { type: 'boolean' } }, required: ['from', 'to'] } },
    direction: { type: 'string', enum: ['down', 'right'] }, x: { type: 'number', description: 'Left edge of the diagram (default: the middle of the screen)' }, y: { type: 'number' }, style: { type: 'string', enum: ['sketchy', 'clean'] },
    colors: { type: 'boolean', description: 'Fill the boxes with soft colours (default true)' },
  }, ['nodes', 'links'], {
    edit: true,
    describe: (a) => ({ title: `Draw a flowchart with ${a.nodes?.length ?? 0} steps`, detail: clip((a.nodes ?? []).map((n: any) => n.label).join(' → '), 280) }),
    run: (a) => {
      const here = d.here()
      const { els, order } = buildFlowchart(m, { nodes: (a.nodes ?? []).slice(0, 80).map((n: any) => ({ ...n, fill: color(n.fill) })), links: (a.links ?? []).slice(0, 200), direction: a.direction === 'right' ? 'right' : 'down', clean: a.style === 'clean', colors: a.colors !== false }, [num(a.x, here[0] - 160), num(a.y, here[1] - 200)])
      const out = m.add(els); d.setSel(out)
      const b = union(els.map(pageBox)); if (b) ensureVisible(b)
      return `Drew ${order.length} steps and ${els.length - order.length} links.\n` + order.map((k, i) => `- ${k}: id ${out[i]}`).join('\n')
    },
  })

  const edit: Tool = tool('edit_things', 'Change things already on the board: move them, resize, recolour, change the text or font, rotate, or change what an arrow points at. Give each change as { id, ...properties }; only the properties you give change.', {
    changes: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' }, rotation_degrees: { type: 'number' }, text: { type: 'string' }, name: { type: 'string', description: 'Frames: the title' }, from: { type: 'string', description: 'Arrows: id of the shape it starts at ("" to detach)' }, to: { type: 'string' }, curve: { type: 'string', enum: ['straight', 'curved', 'elbow'] }, start_head: { type: 'string', enum: HEADS }, end_head: { type: 'string', enum: HEADS }, ...STYLE_PROPS }, required: ['id'] } },
  }, ['changes'], {
    edit: true,
    describe: (a) => ({ title: `Change ${a.changes?.length ?? 0} thing${a.changes?.length === 1 ? '' : 's'} on the board`, detail: clip((a.changes ?? []).map((c: any) => `${find(c.id).text?.slice(0, 20) || find(c.id).type}: ${Object.keys(c).filter((k) => k !== 'id').join(', ')}`).join('\n'), 300) }),
    run: (a) => {
      const upd: Record<string, Partial<El>> = {}
      for (const c of a.changes ?? []) {
        const e = find(c.id), p: Partial<El> = styleOf(c)
        if (c.x !== undefined) p.x = num(c.x, e.x); if (c.y !== undefined) p.y = num(c.y, e.y)
        if (!isLinear(e.type)) { if (c.w !== undefined) p.w = Math.max(4, num(c.w, e.w)); if (c.h !== undefined) p.h = Math.max(4, num(c.h, e.h)) }
        if (c.rotation_degrees !== undefined && !isLinear(e.type)) p.a = (num(c.rotation_degrees, 0) * Math.PI) / 180
        if (c.text !== undefined) { p.text = String(c.text); if (e.type === 'text') Object.assign(p, fitText({ ...e, ...p } as El)) }
        if (c.name !== undefined) p.name = String(c.name)
        if (c.curve && ['straight', 'curved', 'elbow'].includes(c.curve) && isLinear(e.type)) p.curve = c.curve
        if (HEADS.includes(c.start_head)) p.hs = c.start_head; if (HEADS.includes(c.end_head)) p.he = c.end_head
        if (c.from !== undefined) p.from = c.from ? { id: find(c.from).id } : undefined
        if (c.to !== undefined) p.to = c.to ? { id: find(c.to).id } : undefined
        if (p.font) loadFont(p.font)
        if (e.type === 'text' && (p.font || p.size || p.bold !== undefined)) Object.assign(p, fitText({ ...e, ...p } as El))
        if (e.type === 'draw' || isShape(e.type) || e.type === 'text' || isLinear(e.type) || e.type === 'frame' || e.type === 'image' || e.type === 'embed') upd[e.id] = p
      }
      m.updateMany(upd)
      return `Changed ${Object.keys(upd).length}.`
    },
  })

  const del: Tool = tool('delete_things', 'Remove things from the board by id. Arrows that were joined to them stay, unattached.', { ids: { type: 'array', items: { type: 'string' } } }, ['ids'], {
    edit: true, describe: (a) => ({ title: `Delete ${a.ids?.length ?? 0} thing${a.ids?.length === 1 ? '' : 's'}`, detail: clip((a.ids ?? []).map((i: string) => { const e = m.get(i); return e ? (e.text?.trim() || e.type) : i }).join(', '), 240) }),
    run: (a) => { const ids = (a.ids ?? []).map((i: string) => find(i).id); m.remove(ids); d.setSel(d.getSel().filter((i) => !ids.includes(i))); return `Deleted ${ids.length}.` },
  })

  const layers: Tool = tool('arrange_layers', 'Change what is in front of what, group things so they move together, lock them, or hide them. "front" and "back" move to the very top or bottom; "forward" and "backward" move one step. Text added later is in front of earlier shapes, so use this when something is hiding something else.', {
    ids: { type: 'array', items: { type: 'string' } }, action: { type: 'string', enum: ['front', 'back', 'forward', 'backward', 'group', 'ungroup', 'lock', 'unlock', 'hide', 'show'] },
  }, ['ids', 'action'], {
    edit: true, describe: (a) => ({ title: `${a.action} ${a.ids?.length ?? 0} thing${a.ids?.length === 1 ? '' : 's'}` }),
    run: (a) => {
      const ids = (a.ids ?? []).map((i: string) => find(i).id)
      if (['front', 'back', 'forward', 'backward'].includes(a.action)) m.reorder(ids, a.action)
      else if (a.action === 'group') m.group(ids); else if (a.action === 'ungroup') m.ungroup(ids)
      else if (a.action === 'lock' || a.action === 'unlock') m.updateMany(Object.fromEntries(ids.map((i: string) => [i, { lock: a.action === 'lock' }])))
      else m.updateMany(Object.fromEntries(ids.map((i: string) => [i, { hide: a.action === 'hide' }])))
      return 'Done.'
    },
  })

  const show: Tool = tool('show_on_screen', 'Scroll and zoom the person\'s view so that some things (or the whole board) are in sight.', { ids: { type: 'array', items: { type: 'string' }, description: 'Leave empty to fit everything' } }, [], {
    label: () => 'Move the view',
    run: (a) => {
      const list = (a.ids ?? []).length ? (a.ids as string[]).map((i) => find(i)) : null
      if (!list) { d.fit(); return 'Showing the whole board.' }
      const b = union(list.map(pageBox)); if (b) { const s = d.size(); const z = Math.max(0.1, Math.min(1.5, (s.w - 160) / Math.max(1, b.w), (s.h - 160) / Math.max(1, b.h))); d.setView({ z, x: s.w / 2 - (b.x + b.w / 2) * z, y: s.h / 2 - (b.y + b.h / 2) * z }) }
      return 'Done.'
    },
  })

  const frameTool: Tool = tool('add_frame', 'Draw a frame (a titled box) around an area. An "AI frame" is one you can turn into a working website with bring_frame_to_life: use it when the person sketched a screen inside it. Plain frames just group and label things.', {
    x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' }, name: { type: 'string' }, ai: { type: 'boolean', description: 'An AI frame (can be brought to life as a website)' },
  }, ['x', 'y', 'w', 'h'], {
    edit: true, describe: (a) => ({ title: `Add ${a.ai ? 'an AI ' : 'a '}frame${a.name ? ` “${a.name}”` : ''}` }),
    run: (a) => { const [id] = m.add([m.make('frame', { x: num(a.x, 0), y: num(a.y, 0), w: Math.max(40, num(a.w, 400)), h: Math.max(40, num(a.h, 300)), name: String(a.name ?? (a.ai ? 'AI frame' : 'Frame')), ai: !!a.ai, stroke: '#9ca3af', fill: 'transparent' })]); d.setSel([id]); return `Added the frame: id ${id}` },
  })
  const life: Tool = tool('bring_frame_to_life', 'Turn what is drawn inside a frame into a working website: Koko looks at the shapes, text, positions and colours inside it and builds the page it shows, placed beside the frame as an object the person can move, resize and try out. Takes a little while. Use read_board with the frame first if you need to know what is in it.', {
    frame: { type: 'string', description: 'Id of the frame' }, style: { type: 'string', enum: ['faithful', 'creative'], description: 'faithful (default): keep everything drawn exactly and only make it work; creative: treat the drawing as a brief and redesign it' }, instruction: { type: 'string', description: 'Anything extra to know, e.g. "a dark theme" or "for a bakery"' },
  }, ['frame'], {
    edit: true, describe: (a) => ({ title: 'Build a website from a frame', detail: clip(`${find(a.frame).name || 'Frame'}${a.instruction ? ` — ${a.instruction}` : ''}`, 200) }),
    label: () => 'Building the website', run: async (a) => { const f = find(a.frame); if (f.type !== 'frame') throw new Error('That is not a frame.'); if (a.style === 'creative' || a.style === 'faithful') m.update(f.id, { mode: a.style === 'creative' ? 'creative' : 'exact' }); return d.bringFrameToLife(f.id, a.instruction ? String(a.instruction) : undefined) },
  })
  const revise: Tool = tool('change_website', 'Change a website that was made from a frame (an "embed" on the board), as the person describes it.', { website: { type: 'string', description: 'Id of the website object' }, change: { type: 'string' } }, ['website', 'change'], {
    edit: true, describe: (a) => ({ title: 'Change the website', detail: clip(String(a.change ?? ''), 200) }), label: () => 'Changing the website',
    run: async (a) => { const e = find(a.website); if (e.type !== 'embed') throw new Error('That is not a website object.'); return d.reviseWebsite(e.id, String(a.change)) },
  })
  const bgTool: Tool = tool('set_board', 'Set the colour of the board itself, or rename it.', { background: { type: 'string' }, title: { type: 'string' } }, [], {
    edit: true, describe: (a) => ({ title: a.title ? `Rename the board to “${a.title}”` : 'Change the board colour' }),
    run: (a) => { const c = color(a.background); if (c) m.setMeta('bg', c === 'transparent' ? '#ffffff' : c); if (a.title) m.setMeta('title', String(a.title)); return 'Done.' },
  })

  const dump = (): string => {
    const list = m.read(), byId = new Map(list.map((e) => [e.id, e]))
    if (!list.length) return 'The board is empty.'
    const body = list.slice(-60).map((e) => line(e, byId)).join('\n')
    return `${list.length} things${list.length > 60 ? ' (the 60 in front are listed; read_board has the rest)' : ''}:\n${body}`
  }
  return {
    kind: 'whiteboard', noun: 'whiteboard', title: d.getTitle, canEdit: d.canEdit, undo: () => { m.undo.undo() },
    guide: `You are working on a whiteboard: an endless canvas of shapes, text, arrows, pictures and frames, drawn by hand-style by default. Coordinates are in pixels: x grows to the right and y grows downwards; the middle of the person's screen is given below. You can see the board as text: every thing's id, kind, position, size, text and colours.
- Look before you draw: read_board (or the listing in your context) shows what is there. Put new things in empty space (below or beside what exists) and never on top of other things unless asked. A normal shape is about 160×100; leave 60–90 px between things; keep related things aligned in rows or columns.
- Text goes inside shapes by setting the shape's "text" (it is centred and sized to fit). Use free text only for titles, captions and notes. Put titles above what they describe.
- Join shapes with arrows by id (or ref), not by guessing coordinates, so the arrows follow when shapes move. For flowcharts, process diagrams, org charts and mind maps with many steps use create_flowchart. Decisions are diamonds with arrows labelled Yes/No.
- Layers: things are stacked in the order they were added, so later things are in front. Text you add after a shape is above it; if something is hidden behind another, use arrange_layers.
- Colour: use a few soft fills for meaning (for example green for done, yellow for a warning), a dark outline, and the default handwriting font (Caveat) unless asked for another; any Google font name works.
- To recreate a sketch the person made, read the board and match its shapes, text, positions and sizes closely. If they want a sketched screen turned into a real website, use bring_frame_to_life on the frame around it (draw a frame with add_frame first if there is none); the result is a moveable website object beside the frame, which change_website can edit.
- Reply in a sentence or two saying what you drew; do not list ids.`,
    context: () => `The whiteboard is "${d.getTitle() || 'Untitled whiteboard'}". The middle of the person's screen is at (${r(d.here()[0])}, ${r(d.here()[1])}). ${d.getSel().length ? `They have selected: ${d.getSel().map((i) => { const e = m.get(i); return e ? `${e.type}${e.text ? ` “${clip(e.text, 24)}”` : ''} (${i})` : i }).join(', ')}.` : 'Nothing is selected.'}\n${dump()}`,
    suggestions: ['Draw a flowchart of how a bug gets fixed', 'Make a mind map about my project', 'Tidy up and align everything', 'Add a title and a legend'],
    tools: [readBoard, addShapes, flowchart, edit, del, layers, frameTool, life, revise, show, bgTool],
  }
}

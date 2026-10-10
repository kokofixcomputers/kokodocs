/** A whiteboard is a pile of elements on an endless canvas, each with a position, a size, a colour and a place in the stacking order. They live in the shared document,
 *  so everyone sees the same board and undo only takes back your own changes. */
export type ShapeKind = 'rect' | 'ellipse' | 'diamond' | 'triangle' | 'parallelogram' | 'hexagon' | 'cylinder' | 'star' | 'cloud' | 'document'
export type ElType = ShapeKind | 'line' | 'arrow' | 'draw' | 'text' | 'image' | 'frame' | 'embed'
export type FillStyle = 'solid' | 'hachure' | 'cross-hatch' | 'zigzag' | 'dots'
export type Head = 'none' | 'arrow' | 'triangle' | 'dot' | 'bar' | 'diamond'
export type Tool = 'select' | 'hand' | 'lasso' | ShapeKind | 'line' | 'arrow' | 'draw' | 'highlight' | 'text' | 'image' | 'frame' | 'aiframe' | 'eraser' | 'bucket'

export interface Bind { id: string }
export interface El {
  id: string; type: ElType
  x: number; y: number; w: number; h: number; a: number          // top-left corner, size, and angle in radians (about the middle)
  z: number                                                       // stacking order: higher is in front
  stroke: string; fill: string; fs: FillStyle; sw: number; ss: 'solid' | 'dashed' | 'dotted'
  ro: 0 | 1 | 2                                                   // how hand-drawn it looks: 0 clean, 1 sketchy, 2 very sketchy
  op: number; rad: number; seed: number
  // text: standalone text, the words inside a shape, or the label on an arrow
  text?: string; font?: string; size?: number; ta?: 'left' | 'center' | 'right'; bold?: boolean; italic?: boolean; tc?: string; wrap?: boolean
  // lines, arrows and pen strokes: points relative to x, y
  pts?: [number, number][]; hs?: Head; he?: Head; curve?: 'straight' | 'curved' | 'elbow'; from?: Bind; to?: Bind
  src?: string                                                    // image address
  html?: string; prompt?: string; busy?: number; frame?: string   // a website made by Koko: its page, what was asked, when it started being made, and the frame it came from
  name?: string; ai?: boolean; mode?: 'exact' | 'creative'                                     // frames: a title, and whether Koko can bring it to life
  hl?: boolean                                                    // pen strokes: a highlighter (wide and see-through)
  grp?: string; lock?: boolean; hide?: boolean
}

export interface Style {
  stroke: string; fill: string; fs: FillStyle; sw: number; ss: El['ss']; ro: El['ro']; op: number; rad: number
  font: string; size: number; ta: NonNullable<El['ta']>; tc: string; hs: Head; he: Head; curve: NonNullable<El['curve']>
}
export const DEFAULT_STYLE: Style = {
  stroke: '#1e1e2e', fill: 'transparent', fs: 'hachure', sw: 2, ss: 'solid', ro: 1, op: 100, rad: 0,
  font: 'Caveat', size: 24, ta: 'center', tc: '#1e1e2e', hs: 'none', he: 'arrow', curve: 'straight',
}

export const SHAPES: { kind: ShapeKind; label: string }[] = [
  { kind: 'rect', label: 'Rectangle' }, { kind: 'ellipse', label: 'Ellipse' }, { kind: 'diamond', label: 'Diamond' }, { kind: 'triangle', label: 'Triangle' },
  { kind: 'parallelogram', label: 'Data' }, { kind: 'hexagon', label: 'Hexagon' }, { kind: 'cylinder', label: 'Database' }, { kind: 'star', label: 'Star' },
  { kind: 'cloud', label: 'Cloud' }, { kind: 'document', label: 'Document' },
]
export const isShape = (t: ElType): t is ShapeKind => SHAPES.some((s) => s.kind === t)
export const isLinear = (t: ElType) => t === 'line' || t === 'arrow' || t === 'draw'
export const holdsText = (t: ElType) => isShape(t) || t === 'text' || t === 'arrow' || t === 'line'

export const PALETTE = ['#1e1e2e', '#6b7280', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0d9488', '#2563eb', '#7c3aed', '#db2777', '#ffffff']
export const FILLS = ['transparent', '#fecaca', '#fed7aa', '#fef08a', '#bbf7d0', '#99f6e4', '#bfdbfe', '#ddd6fe', '#fbcfe8', '#e5e7eb', '#ffffff', '#1e1e2e']

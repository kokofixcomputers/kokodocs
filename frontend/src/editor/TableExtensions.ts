import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import Table from '@tiptap/extension-table'
import { Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const bg = {
  backgroundColor: {
    default: null,
    parseHTML: (el: HTMLElement) => el.getAttribute('data-bg') || el.style.backgroundColor || null,
    renderHTML: (a: Record<string, any>) =>
      a.backgroundColor ? { 'data-bg': a.backgroundColor, style: `background-color: ${a.backgroundColor}` } : {},
  },
}

/** A cell's own outline: colour and thickness, drawn inside the cell on all four sides (so neighbouring cells don't fight over a shared edge). */
const cellBorder = {
  borderColor: {
    default: null,
    parseHTML: (el: HTMLElement) => el.getAttribute('data-bordercolor') || null,
    renderHTML: (a: Record<string, any>) => (a.borderColor ? { 'data-bordercolor': a.borderColor, 'data-borderwidth': String(a.borderWidth ?? 2), style: `box-shadow: inset 0 0 0 ${Number(a.borderWidth ?? 2)}px ${a.borderColor}` } : {}),
  },
  borderWidth: {
    default: null,
    parseHTML: (el: HTMLElement) => { const v = Number(el.getAttribute('data-borderwidth')); return Number.isFinite(v) && v > 0 ? v : null },
    renderHTML: () => ({}),
  },
}

export const KokoTableCell = TableCell.extend({
  addAttributes() { return { ...this.parent?.(), ...bg, ...cellBorder } },
})
export const KokoTableHeader = TableHeader.extend({
  addAttributes() { return { ...this.parent?.(), ...bg, ...cellBorder } },
})

export const TABLE_STYLES = [
  { id: 'default', label: 'Rounded', hint: 'Soft outline, shaded header' },
  { id: 'grid', label: 'Grid', hint: 'Square cells, every line shown' },
  { id: 'minimal', label: 'Minimal', hint: 'Only horizontal lines' },
  { id: 'accent', label: 'Accent header', hint: 'Header in the accent colour' },
  { id: 'dark', label: 'Dark header', hint: 'Strong dark header row' },
  { id: 'soft', label: 'Soft', hint: 'Light cells, no outline' },
] as const
export type TableStyleId = (typeof TABLE_STYLES)[number]['id']

/** The document's table, with a design (one of a few ready-made ones), optional alternating row shading, and an optional frozen first row (it stays in view when a long table scrolls). */
export const KokoTable = Table.extend({
  addAttributes() {
    const keep = (name: string, def: unknown) => ({
      default: def,
      parseHTML: (el: HTMLElement) => { const v = el.getAttribute(`data-${name}`); return v === null ? def : v === 'true' ? true : v === 'false' ? false : v },
      renderHTML: (a: Record<string, any>) => (a[name] === def ? {} : { [`data-${name}`]: String(a[name]) }),
    })
    return {
      ...this.parent?.(), tableStyle: keep('tablestyle', 'default'), banded: keep('banded', false), frozen: keep('frozen', false),
      // the lines of the whole table: a colour and a thickness (0 hides them); the cells read them as CSS variables
      tbColor: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute('data-tbcolor') || null, renderHTML: (a: Record<string, any>) => (a.tbColor ? { 'data-tbcolor': a.tbColor, style: `--tb-color: ${a.tbColor}` } : {}) },
      tbWidth: { default: null, parseHTML: (el: HTMLElement) => { const v = el.getAttribute('data-tbwidth'); return v === null ? null : Number(v) }, renderHTML: (a: Record<string, any>) => (a.tbWidth === null || a.tbWidth === undefined ? {} : { 'data-tbwidth': String(a.tbWidth), style: `--tb-width: ${a.tbWidth}px` }) },
    }
  },
  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      // the design is drawn by classes on the table's wrapper (the table view doesn't take its attributes onto the page by itself)
      new Plugin({
        props: {
          decorations: (state) => {
            const out: Decoration[] = []
            state.doc.descendants((node, pos) => {
              if (node.type.name !== 'table') return true
              const a = node.attrs as { tableStyle: string; banded: boolean; frozen: boolean; tbColor: string | null; tbWidth: number | null }
              const vars = `${a.tbColor ? `--tb-color:${a.tbColor};` : ''}${a.tbWidth === null || a.tbWidth === undefined ? '' : `--tb-width:${a.tbWidth}px;`}`
              out.push(Decoration.node(pos, pos + node.nodeSize, { class: `tbl-${a.tableStyle || 'default'}${a.banded ? ' tbl-banded' : ''}${a.frozen ? ' tbl-frozen' : ''}`, ...(vars ? { style: vars } : {}) }))
              return false
            })
            return out.length ? DecorationSet.create(state.doc, out) : null
          },
        },
      }),
    ]
  },
})

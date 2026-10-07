import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'

const bg = {
  backgroundColor: {
    default: null,
    parseHTML: (el: HTMLElement) => el.getAttribute('data-bg') || el.style.backgroundColor || null,
    renderHTML: (a: Record<string, any>) =>
      a.backgroundColor ? { 'data-bg': a.backgroundColor, style: `background-color: ${a.backgroundColor}` } : {},
  },
}

export const KokoTableCell = TableCell.extend({
  addAttributes() { return { ...this.parent?.(), ...bg } },
})
export const KokoTableHeader = TableHeader.extend({
  addAttributes() { return { ...this.parent?.(), ...bg } },
})

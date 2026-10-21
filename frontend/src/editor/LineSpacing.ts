import { Extension } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> { lineSpacing: { setLineHeight: (v: number | null) => ReturnType } }
}

export const LINE_HEIGHTS = [1, 1.15, 1.5, 2, 2.5, 3] as const

/** Line spacing for paragraphs and headings (a number: 1.5 means one and a half lines), kept in the document and carried into Word exports. */
export const LineSpacing = Extension.create({
  name: 'lineSpacing',
  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading'],
      attributes: {
        lineHeight: {
          default: null,
          parseHTML: (el) => { const v = parseFloat((el as HTMLElement).style.lineHeight); return Number.isFinite(v) && v > 0 && v < 10 ? v : null },
          renderHTML: (a) => (a.lineHeight ? { style: `line-height:${a.lineHeight}` } : {}),
        },
      },
    }]
  },
  addCommands() {
    return { setLineHeight: (v) => ({ commands }) => ['paragraph', 'heading'].map((t) => commands.updateAttributes(t, { lineHeight: v })).some(Boolean) }
  },
})

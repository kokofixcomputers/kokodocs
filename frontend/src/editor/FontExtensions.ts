import { Extension } from '@tiptap/core'
import { fontStack } from '../fonts'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontFamily: {
      setFontFamily: (family: string) => ReturnType
      unsetFontFamily: () => ReturnType
    }
    fontSize: {
      setFontSize: (pt: number) => ReturnType
      unsetFontSize: () => ReturnType
    }
  }
}

/** Stores the plain family name; renders a full CSS stack. */
export const FontFamily = Extension.create({
  name: 'fontFamily',
  addGlobalAttributes() {
    return [{
      types: ['textStyle'],
      attributes: {
        fontFamily: {
          default: null,
          parseHTML: (el) => el.style.fontFamily?.split(',')[0].replace(/["']/g, '').trim() || null,
          renderHTML: (a) => (a.fontFamily ? { style: `font-family: ${fontStack(a.fontFamily)}` } : {}),
        },
      },
    }]
  },
  addCommands() {
    return {
      setFontFamily: (family) => ({ chain }) => chain().setMark('textStyle', { fontFamily: family }).run(),
      unsetFontFamily: () => ({ chain }) => chain().setMark('textStyle', { fontFamily: null }).removeEmptyTextStyle().run(),
    }
  },
})

export const FontSize = Extension.create({
  name: 'fontSize',
  addGlobalAttributes() {
    return [{
      types: ['textStyle'],
      attributes: {
        fontSize: {
          default: null,
          parseHTML: (el) => { const m = /([\d.]+)pt/.exec(el.style.fontSize); return m ? Number(m[1]) : null },
          renderHTML: (a) => (a.fontSize ? { style: `font-size: ${a.fontSize}pt` } : {}),
        },
      },
    }]
  },
  addCommands() {
    return {
      setFontSize: (pt) => ({ chain }) => chain().setMark('textStyle', { fontSize: pt }).run(),
      unsetFontSize: () => ({ chain }) => chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run(),
    }
  },
})

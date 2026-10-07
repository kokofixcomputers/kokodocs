import { Node, mergeAttributes, wrappingInputRule } from '@tiptap/core'

export const CALLOUT_KINDS = ['note', 'info', 'tip', 'success', 'question', 'warning', 'danger', 'custom'] as const
export const CALLOUT_COLORS: Record<string, string> = { note: '#6b7280', info: '#2563eb', tip: '#0d9488', success: '#16a34a', question: '#7c3aed', warning: '#d97706', danger: '#dc2626', custom: '#a16207' }
export type CalloutKind = (typeof CALLOUT_KINDS)[number]
const ALIAS: Record<string, CalloutKind> = { hint: 'tip', important: 'info', caution: 'warning', attention: 'warning', error: 'danger', bug: 'danger', check: 'success', done: 'success', faq: 'question', help: 'question', abstract: 'note', summary: 'note', todo: 'note', example: 'note', quote: 'note', cite: 'note', failure: 'danger', fail: 'danger', missing: 'danger' }
export const calloutKind = (k: string): CalloutKind => { const l = k.toLowerCase(); return (CALLOUT_KINDS as readonly string[]).includes(l) ? (l as CalloutKind) : ALIAS[l] ?? 'note' }
export const CUSTOM_DEFAULT_BG = '#fff7d6'
const lum = (hex: string) => { const n = parseInt(hex.slice(1), 16), f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255) }
export const isDarkColor = (hex: string) => /^#[0-9a-f]{6}$/i.test(hex) && lum(hex) < 0.42
/** CSS variables for a custom callout: any background you choose, with text and accent that stay readable on it. */
export const customStyle = (bg?: string | null, accent?: string | null) => {
  const b = bg && /^#[0-9a-f]{6}$/i.test(bg) ? bg : CUSTOM_DEFAULT_BG, dark = isDarkColor(b)
  return `--cc:${accent && /^#[0-9a-f]{6}$/i.test(accent) ? accent : dark ? '#ffffff' : '#374151'};--cb:${b};${dark ? 'color:#f5f5f5;' : ''}`
}
export const defaultTitle = (k: string) => k.charAt(0).toUpperCase() + k.slice(1)

declare module '@tiptap/core' {
  interface Commands<ReturnType> { callout: { setCallout: (kind?: CalloutKind) => ReturnType } }
}

/** Obsidian-style callout: `> [!tip] Optional title`. A coloured box with a title and any blocks inside. */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      kind: { default: 'note', parseHTML: (el) => calloutKind(el.getAttribute('data-callout') ?? 'note'), renderHTML: (a) => ({ 'data-callout': a.kind }) },
      bg: { default: null, parseHTML: (el) => el.getAttribute('data-bg'), renderHTML: (a) => (a.bg ? { 'data-bg': a.bg } : {}) },
      accent: { default: null, parseHTML: (el) => el.getAttribute('data-accent'), renderHTML: (a) => (a.accent ? { 'data-accent': a.accent } : {}) },
      title: { default: '', parseHTML: (el) => el.getAttribute('data-title') ?? '', renderHTML: (a) => ({ 'data-title': a.title || defaultTitle(a.kind) }) },
    }
  },
  parseHTML() { return [{ tag: 'div[data-callout]' }] },
  renderHTML({ node, HTMLAttributes }) { return ['div', mergeAttributes({ class: 'callout' }, HTMLAttributes, node.attrs.kind === 'custom' ? { style: customStyle(node.attrs.bg, node.attrs.accent) } : {}), 0] },
  addCommands() {
    return { setCallout: (kind = 'note') => ({ commands }) => commands.wrapIn(this.name, { kind }) }
  },
  addInputRules() {
    return [wrappingInputRule({ find: /^\[!(\w+)\][+-]?\s$/, type: this.type, getAttributes: (m) => ({ kind: calloutKind(m[1]), title: ''}) })]
  },
})

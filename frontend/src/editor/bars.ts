import { useEffect, useState } from 'react'
import { usePrefs } from '../prefs'

/** Which buttons the top bar and the formatting bar show. Each button has a level: 1 = the essentials, 2 = what most people use, 3 = everything.
 *  A profile picks a level (or an exact list of buttons); everything it hides goes into the ⋯ menu. Desktop and phone can differ. */
export type Preset = 'essential' | 'standard' | 'everything' | 'custom'
export interface BarProfile { preset: Preset; toolbar: string[]; header: string[] }
export interface BarPrefs { same: boolean; desktop: BarProfile; mobile: BarProfile }
export type BarItem = { id: string; label: string; level: 1 | 2 | 3 }

export const TOOLBAR_ITEMS: BarItem[] = [
  { id: 'undo', label: 'Undo', level: 1 }, { id: 'redo', label: 'Redo', level: 1 }, { id: 'find', label: 'Find and replace', level: 2 }, { id: 'print', label: 'Print', level: 2 },
  { id: 'nonprint', label: 'Show non-printing characters', level: 3 }, { id: 'painter', label: 'Paint format', level: 3 },
  { id: 'style', label: 'Text style', level: 1 }, { id: 'font', label: 'Font', level: 1 }, { id: 'size', label: 'Font size', level: 1 },
  { id: 'bold', label: 'Bold', level: 1 }, { id: 'italic', label: 'Italic', level: 1 }, { id: 'underline', label: 'Underline', level: 1 }, { id: 'strike', label: 'Strikethrough', level: 2 },
  { id: 'color', label: 'Text colour', level: 2 }, { id: 'highlight', label: 'Highlight', level: 2 }, { id: 'link', label: 'Link', level: 1 },
  { id: 'align', label: 'Alignment', level: 2 }, { id: 'spacing', label: 'Line spacing', level: 2 }, { id: 'lists', label: 'Lists', level: 1 }, { id: 'quote', label: 'Quote', level: 2 },
  { id: 'table', label: 'Table', level: 2 }, { id: 'image', label: 'Image', level: 1 }, { id: 'scan', label: 'Scan a page', level: 3 }, { id: 'shape', label: 'Shapes', level: 3 },
  { id: 'command', label: 'Do something (AI)', level: 2 }, { id: 'fixfmt', label: 'Fix formatting', level: 3 }, { id: 'sticky', label: 'Sticky note', level: 3 }, { id: 'emoji', label: 'Emoji', level: 2 },
  { id: 'callout', label: 'Callout', level: 2 }, { id: 'equation', label: 'Equation', level: 3 }, { id: 'divider', label: 'Divider', level: 3 }, { id: 'code', label: 'Code', level: 3 },
  { id: 'sup', label: 'Superscript', level: 3 }, { id: 'sub', label: 'Subscript', level: 3 }, { id: 'clear', label: 'Clear formatting', level: 2 },
  { id: 'voice', label: 'Voice typing', level: 2 }, { id: 'headerfooter', label: 'Header & footer', level: 3 }, { id: 'pagesetup', label: 'Page setup', level: 3 },
]
export const HEADER_ITEMS: BarItem[] = [
  { id: 'comments', label: 'Comments', level: 1 }, { id: 'assistant', label: 'Assistant', level: 1 },
  { id: 'export', label: 'Download', level: 2 }, { id: 'history', label: 'Version history', level: 2 }, { id: 'proofread', label: 'Proofread', level: 2 },
  { id: 'compare', label: 'Compare', level: 3 }, { id: 'branch', label: 'Branch', level: 3 }, { id: 'insights', label: 'Insights', level: 3 }, { id: 'readaloud', label: 'Read aloud', level: 3 }, { id: 'theme', label: 'Light or dark', level: 3 },
]

const LEVEL: Record<Exclude<Preset, 'custom'>, number> = { essential: 1, standard: 2, everything: 3 }
export const PRESETS: { id: Preset; label: string; hint: string }[] = [
  { id: 'essential', label: 'Essentials', hint: 'Bold, italic, underline, font, size, lists, link, image. Everything else is under ⋯.' },
  { id: 'standard', label: 'Standard', hint: 'What most people use: adds colours, alignment, tables, comments and history.' },
  { id: 'everything', label: 'Everything', hint: 'Every button, always visible.' },
  { id: 'custom', label: 'Custom', hint: 'Pick exactly which buttons you want.' },
]

export const DEFAULT_BARS: BarPrefs = {
  same: false,
  desktop: { preset: 'standard', toolbar: [], header: [] },
  mobile: { preset: 'essential', toolbar: [], header: [] },
}

const ids = (items: BarItem[], level: number) => items.filter((i) => i.level <= level).map((i) => i.id)
const known = (list: string[], all: BarItem[]) => { const ok = new Set(all.map((i) => i.id)); return [...new Set(list)].filter((x) => ok.has(x)) }
/** The buttons a layout shows, in the order they appear. A preset uses the standard order; Custom uses the order you arranged. */
export function profileLists(p: BarProfile): { toolbar: string[]; header: string[] } {
  if (p.preset === 'custom') return { toolbar: known(p.toolbar, TOOLBAR_ITEMS), header: known(p.header, HEADER_ITEMS) }
  const lv = LEVEL[p.preset] ?? 2
  return { toolbar: ids(TOOLBAR_ITEMS, lv), header: ids(HEADER_ITEMS, lv) }
}
export function profileSets(p: BarProfile) {
  const l = profileLists(p)
  return { ...l, toolbarSet: new Set(l.toolbar), headerSet: new Set(l.header) }
}
/** The buttons a preset shows, as lists (what Custom starts from). */
export const presetLists = (preset: Exclude<Preset, 'custom'>) => ({ toolbar: ids(TOOLBAR_ITEMS, LEVEL[preset]), header: ids(HEADER_ITEMS, LEVEL[preset]) })

export function useIsPhone() {
  const q = '(max-width: 720px)'
  const [m, setM] = useState(() => typeof matchMedia === 'function' && matchMedia(q).matches)
  useEffect(() => { const mq = matchMedia(q), f = () => setM(mq.matches); mq.addEventListener('change', f); return () => mq.removeEventListener('change', f) }, [])
  return m
}

/** What to show right now, for this device. */
export function useBarLayout() {
  const { bars } = usePrefs()
  const phone = useIsPhone()
  const p = bars.same ? bars.desktop : phone ? bars.mobile : bars.desktop
  const sets = profileSets(p)
  return { toolbar: sets.toolbarSet, header: sets.headerSet, toolbarOrder: sets.toolbar, headerOrder: sets.header }
}

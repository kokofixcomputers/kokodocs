import { useSyncExternalStore } from 'react'
import { api } from './api'
import { DEFAULT_BARS, type BarPrefs } from './editor/bars'
import { setTrustHandler, stopAllExtensions, syncExtensions, type Extension } from './extensions/runtime'

/** A person's own settings that follow them between devices (text snippets, the writing helpers). Kept in memory and in this browser, so they work offline too. */
export interface Snippet { trigger: string; text: string }
export interface Writing { autocomplete: boolean; engine: 'device' | 'server'; fixFormatting: boolean; commandBar: boolean; linkPreviews: boolean; commandModel: string; completionModel: string }
const DEFAULT_WRITING: Writing = { autocomplete: false, engine: 'device', fixFormatting: true, commandBar: true, linkPreviews: true, commandModel: '', completionModel: '' }

const KEY = 'koko.prefs'
let prefs: Record<string, any> = (() => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') } catch { return {} } })()
let snap = { ...prefs }
const subs = new Set<() => void>()
const emit = () => { snap = { ...prefs }; try { localStorage.setItem(KEY, JSON.stringify(prefs)) } catch { /* ignore */ } subs.forEach((f) => f()) }

const runExtensions = () => { const e = getExtensions(); syncExtensions(e.items, e.theme, e.settings) }
export async function loadPrefs() { try { prefs = await api.prefs(); emit() } catch { /* offline: the saved copy is used */ } runExtensions(); void retireOnDeviceSuggestions() }
export function clearPrefs() { prefs = {}; emit(); stopAllExtensions() }

export type ExtSettings = Record<string, Record<string, unknown>>
export const getExtensions = (): { items: Extension[]; theme: string; settings: ExtSettings } => ({ items: Array.isArray(snap.extensions?.items) ? snap.extensions.items : [], theme: typeof snap.extensions?.theme === 'string' ? snap.extensions.theme : '', settings: snap.extensions?.settings && typeof snap.extensions.settings === 'object' ? snap.extensions.settings : {} })
/** Extensions follow the account: the list, each one's code and on/off state, and which of their themes is chosen. */
export async function saveExtensions(items: Extension[], theme: string, settings: ExtSettings = getExtensions().settings) { const v = { items, theme, settings }; await api.savePref('extensions', v); prefs.extensions = v; emit(); runExtensions() }
setTrustHandler((id) => { const e = getExtensions(); void saveExtensions(e.items.map((x) => (x.id === id ? { ...x, trusted: true } : x)), e.theme, e.settings).catch(() => {}) })   // an extension's request for full access, once you allowed it
if (prefs.extensions) queueMicrotask(runExtensions)   // a saved copy runs straight away, even offline

export const getSnippets = (): Snippet[] => (Array.isArray(snap.snippets) ? snap.snippets : [])
export const getWriting = (): Writing => ({ ...DEFAULT_WRITING, ...(snap.writing ?? {}) })

export async function saveSnippets(list: Snippet[]) { await api.savePref('snippets', list); prefs.snippets = list; emit() }
export const getBars = (): BarPrefs => { const b = snap.bars; return b && b.desktop && b.mobile ? { ...DEFAULT_BARS, ...b } : DEFAULT_BARS }
export async function saveBars(b: BarPrefs) { prefs.bars = b; emit(); await api.savePref('bars', b) }
export async function saveWriting(w: Partial<Writing>) { const next = { ...getWriting(), ...w }; prefs.writing = next; emit(); await api.savePref('writing', next); void retireOnDeviceSuggestions() }

/** The small on-device model (SmolLM) wasn't good enough to suggest text with: if suggestions are on and set to use it, turn them off and say so. */
let told = false
export async function retireOnDeviceSuggestions() {
  const w = getWriting()
  if (!w.autocomplete || w.engine !== 'device') return
  prefs.writing = { ...w, autocomplete: false }; emit()
  try { await api.savePref('writing', prefs.writing) } catch { /* offline: it is turned off here, and again on the next load */ }
  if (told) return
  told = true
  await new Promise((r) => setTimeout(r, 900))   // (the dialog host is mounted by now)
  const { askConfirm } = await import('./ui/Dialogs')
  await askConfirm({ title: 'Suggestions were turned off', text: 'Suggestions while you write were using the small model that runs on your device (SmolLM), which isn’t reliable enough to suggest text, so they have been switched off. You can turn them back on in Settings → Writing and choose the AI connection instead.', label: 'OK' })
}

export function usePrefs() {
  useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => snap)
  return { snippets: getSnippets(), writing: getWriting(), extensions: getExtensions(), bars: getBars() }
}

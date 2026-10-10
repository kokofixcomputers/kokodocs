import { useSyncExternalStore } from 'react'
import { api } from './api'

/** A person's own settings that follow them between devices (text snippets, the writing helpers). Kept in memory and in this browser, so they work offline too. */
export interface Snippet { trigger: string; text: string }
export interface Writing { autocomplete: boolean; engine: 'device' | 'server'; fixFormatting: boolean; commandBar: boolean }
const DEFAULT_WRITING: Writing = { autocomplete: false, engine: 'device', fixFormatting: true, commandBar: true }

const KEY = 'koko.prefs'
let prefs: Record<string, any> = (() => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') } catch { return {} } })()
let snap = { ...prefs }
const subs = new Set<() => void>()
const emit = () => { snap = { ...prefs }; try { localStorage.setItem(KEY, JSON.stringify(prefs)) } catch { /* ignore */ } subs.forEach((f) => f()) }

export async function loadPrefs() { try { prefs = await api.prefs(); emit() } catch { /* offline: the saved copy is used */ } }
export function clearPrefs() { prefs = {}; emit() }

export const getSnippets = (): Snippet[] => (Array.isArray(snap.snippets) ? snap.snippets : [])
export const getWriting = (): Writing => ({ ...DEFAULT_WRITING, ...(snap.writing ?? {}) })

export async function saveSnippets(list: Snippet[]) { await api.savePref('snippets', list); prefs.snippets = list; emit() }
export async function saveWriting(w: Partial<Writing>) { const next = { ...getWriting(), ...w }; prefs.writing = next; emit(); await api.savePref('writing', next) }

export function usePrefs() {
  useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => snap)
  return { snippets: getSnippets(), writing: getWriting() }
}

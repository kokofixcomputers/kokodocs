// The full-screen "Decrypting…" page: shown whenever keys are being opened or documents are being converted, so nothing looks frozen.
import { useSyncExternalStore } from 'react'

export interface Busy { title: string; detail?: string; done?: number; total?: number }
let state: Busy | null = null
const subs = new Set<() => void>()
const set = (s: Busy | null) => { state = s; subs.forEach((f) => f()) }

export const showBusy = (title: string, detail?: string) => set({ title, detail })
export const updateBusy = (patch: Partial<Busy>) => { if (state) set({ ...state, ...patch }) }
export const hideBusy = () => set(null)
export const useBusy = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => state)

/** Run something while the page is showing; always taken down afterwards (errors included). */
export async function whileBusy<T>(title: string, fn: () => Promise<T>, detail?: string): Promise<T> {
  showBusy(title, detail)
  try { return await fn() } finally { hideBusy() }
}

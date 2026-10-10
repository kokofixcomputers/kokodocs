import { useSyncExternalStore } from 'react'

/** The on-device suggestion model (see local.worker.ts): about 365 MB, downloaded when it is first wanted and kept by the browser, so afterwards it works offline.
 *  Nothing you write leaves the device. The worker is only started when a suggestion (or the Download button in Settings) asks for it. */
export const LOCAL_MODEL = { name: 'SmolLM2 360M', mb: 365, files: 'HuggingFaceTB/SmolLM2-360M-Instruct' }
export type LocalStatus = 'idle' | 'loading' | 'ready' | 'error'
interface Snap { status: LocalStatus; progress: number; device: string; error: string; downloaded: boolean }

const KEY = 'koko.localmodel'
const read = () => { try { return localStorage.getItem(KEY) === '1' } catch { return false } }
const write = (v: boolean) => { try { v ? localStorage.setItem(KEY, '1') : localStorage.removeItem(KEY) } catch { /* ignore */ } }

let snap: Snap = { status: 'idle', progress: 0, device: '', error: '', downloaded: read() }
const subs = new Set<() => void>()
const set = (p: Partial<Snap>) => { snap = { ...snap, ...p }; subs.forEach((f) => f()) }

let worker: Worker | null = null
let next = 1
const waiting = new Map<number, { ok: (v: string) => void; fail: (e: Error) => void }>()
let loading: Promise<void> | null = null

function spawn(): Worker {
  const w = new Worker(new URL('./local.worker.ts', import.meta.url), { type: 'module' })
  w.onmessage = (e: MessageEvent) => {
    const m = e.data as { type: string; id?: number; p?: number; text?: string; message?: string; device?: string }
    if (m.type === 'note') { console.warn(m.text); return }
    if (m.type === 'progress') { set({ progress: m.p ?? 0 }); return }
    const x = m.id !== undefined ? waiting.get(m.id) : undefined
    if (!x) return
    waiting.delete(m.id!)
    if (m.type === 'error') x.fail(new Error(m.message)); else x.ok(m.type === 'text' ? m.text ?? '' : m.device ?? '')
  }
  w.onerror = (e) => { waiting.forEach((x) => x.fail(new Error(e.message || 'The model stopped'))); waiting.clear(); worker = null; loading = null; set({ status: 'error', error: e.message || 'The model stopped' }) }
  return w
}
const ask = (m: object) => new Promise<string>((ok, fail) => { const id = next++; waiting.set(id, { ok, fail }); (worker ??= spawn()).postMessage({ ...m, id }) })

/** a graphics card the model can really use (one that does 16-bit maths): asked first, so the big file for it isn't fetched just to fail */
async function usableGpu(): Promise<boolean> {
  try {
    const g = (navigator as unknown as { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu
    const a = g ? await g.requestAdapter() : null
    return !!a && a.features.has('shader-f16')
  } catch { return false }
}

/** download (the first time) and start the model */
export function loadLocalModel(): Promise<void> {
  if (snap.status === 'ready') return Promise.resolve()
  loading ??= (async () => {
    set({ status: 'loading', error: '', progress: snap.downloaded ? 1 : 0 })
    try {
      const gpu = await usableGpu()
      const device = await ask({ type: 'load', cfg: gpu ? { device: 'webgpu', dtype: 'q4f16' } : { device: 'wasm', dtype: 'q8' } })
      write(true); set({ status: 'ready', progress: 1, device, downloaded: true })
    } catch (e) { loading = null; set({ status: 'error', error: (e as Error).message }); throw e }
  })()
  return loading
}

/** continue a piece of text (at most `max` new words/pieces); several calls queue up, and `cancel` stops the one running */
export async function completeLocal(prompt: string, max = 24, signal?: AbortSignal): Promise<string> {
  await loadLocalModel()
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  signal?.addEventListener('abort', cancelLocal, { once: true })
  try { return await ask({ type: 'complete', prompt, max }) } finally { signal?.removeEventListener('abort', cancelLocal) }
}
export const cancelLocal = () => worker?.postMessage({ type: 'cancel' })

/** forget the downloaded model */
export async function removeLocalModel() {
  worker?.terminate(); worker = null; loading = null; waiting.forEach((x) => x.fail(new Error('Removed'))); waiting.clear()
  try { await caches.delete('transformers-cache') } catch { /* nothing kept */ }
  write(false); set({ status: 'idle', progress: 0, device: '', error: '', downloaded: false })
}

export function useLocalModel(): Snap {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => snap)
}

import { useSyncExternalStore } from 'react'

/** The on-device suggestion model (see local.worker.ts): about 365 MB, downloaded when it is first wanted and kept by the browser, so afterwards it works offline.
 *  Nothing you write leaves the device. The worker is only started when a suggestion (or the Download button in Settings) asks for it. */
export type LocalKey = 'smollm' | 'llama'
export const LOCAL_MODELS: Record<LocalKey, { name: string; mb: number; id: string; note: string }> = {
  smollm: { name: 'SmolLM2 360M', mb: 365, id: 'HuggingFaceTB/SmolLM2-360M-Instruct', note: 'Small and quick. Short, plain continuations.' },
  llama: { name: 'Llama 3.2 1B', mb: 1240, id: 'onnx-community/Llama-3.2-1B', note: 'Bigger and better at writing, but about 3× the download and slower. Meta’s Llama 3.2 licence applies.' },
}
export type LocalStatus = 'idle' | 'loading' | 'ready' | 'error'
interface Snap { status: LocalStatus; progress: number; device: string; error: string; downloaded: boolean }

const keyOf = (k: LocalKey) => (k === 'smollm' ? 'koko.localmodel' : `koko.localmodel.${k}`)
const read = (k: LocalKey) => { try { return localStorage.getItem(keyOf(k)) === '1' } catch { return false } }
const write = (k: LocalKey, v: boolean) => { try { v ? localStorage.setItem(keyOf(k), '1') : localStorage.removeItem(keyOf(k)) } catch { /* ignore */ } }
let current: LocalKey = 'smollm'

let snap: Snap = { status: 'idle', progress: 0, device: '', error: '', downloaded: read('smollm') }
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

/** choose which model is used; a different one starts again (the old one is let go of to free memory) */
export function chooseLocalModel(k: LocalKey) {
  if (k === current) return
  current = k; worker?.terminate(); worker = null; loading = null; waiting.forEach((x) => x.fail(new Error('Changed model'))); waiting.clear()
  set({ status: 'idle', progress: 0, device: '', error: '', downloaded: read(k) })
}

/** download (the first time) and start the model */
export function loadLocalModel(k: LocalKey = current): Promise<void> {
  if (k !== current) chooseLocalModel(k)
  if (snap.status === 'ready') return Promise.resolve()
  loading ??= (async () => {
    set({ status: 'loading', error: '', progress: snap.downloaded ? 1 : 0 })
    try {
      const gpu = await usableGpu()
      const device = await ask({ type: 'load', model: LOCAL_MODELS[current].id, cfg: gpu ? { device: 'webgpu', dtype: 'q4f16' } : { device: 'wasm', dtype: 'q8' } })
      write(current, true); set({ status: 'ready', progress: 1, device, downloaded: true })
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
  try { const c = await caches.open('transformers-cache'); for (const r of await c.keys()) if (r.url.includes(LOCAL_MODELS[current].id)) await c.delete(r) } catch { /* nothing kept */ }
  write(current, false); set({ status: 'idle', progress: 0, device: '', error: '', downloaded: false })
}

export function useLocalModel(): Snap {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => snap)
}

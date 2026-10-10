/** A neural voice that runs on this device: Kokoro (82 million parameters, Apache 2.0), through kokoro-js. The model (about 90 MB) is downloaded the first time
 *  it is used and kept by the browser, so after that it works offline. Nothing about the document is sent anywhere. English only: other languages
 *  are read by the device's own voices. The code is only loaded when someone picks this voice. */
export const NEURAL_VOICES: { id: string; label: string }[] = [
  { id: 'af_heart', label: 'Heart (US, woman)' }, { id: 'af_bella', label: 'Bella (US, woman)' }, { id: 'af_nicole', label: 'Nicole (US, woman, calm)' }, { id: 'af_sarah', label: 'Sarah (US, woman)' }, { id: 'af_sky', label: 'Sky (US, woman)' },
  { id: 'am_michael', label: 'Michael (US, man)' }, { id: 'am_fenrir', label: 'Fenrir (US, man)' }, { id: 'am_puck', label: 'Puck (US, man)' },
  { id: 'bf_emma', label: 'Emma (UK, woman)' }, { id: 'bf_isabella', label: 'Isabella (UK, woman)' }, { id: 'bm_george', label: 'George (UK, man)' }, { id: 'bm_fable', label: 'Fable (UK, man)' },
]
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX'
const KEY_ON = 'koko.tts.neural', KEY_VOICE = 'koko.tts.neuralvoice'
const read = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string | null) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch { /* ignore */ } }

export const neuralChosen = () => read(KEY_ON) === '1'
export const setNeuralChosen = (on: boolean) => write(KEY_ON, on ? '1' : null)
export const neuralVoice = () => { const v = read(KEY_VOICE); return NEURAL_VOICES.some((x) => x.id === v) ? v! : 'af_heart' }
export const setNeuralVoice = (id: string) => write(KEY_VOICE, id)

/** The model lives in background workers (see neural.worker.ts), so downloading it, starting it and speaking never freeze the page. There are several copies, each
 *  making a different upcoming sentence at the same moment: making speech takes longer than saying it, so one copy alone falls behind. The first copy downloads the
 *  model (the browser keeps it); the others start from that saved copy once it is there. */
let ready = false
export const neuralReady = () => ready
interface Slot { w: Worker; ready: boolean; busy: number }
const pool: Slot[] = []
const waiting = new Map<number, { slot: Slot; ok: (v: unknown) => void; fail: (e: Error) => void }>()
let nextId = 1
let onProgress: ((p: number) => void) | undefined

/** how many copies: about half the processor's cores, at most 3; one where the model already uses several threads (the page is cross-origin isolated) or memory is short */
function wanted(): number {
  const cores = navigator.hardwareConcurrency || 4, mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8
  if (typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated) return 1
  return Math.max(1, Math.min(3, (cores >> 1) - 0, mem >= 4 ? 3 : 1))
}

function spawn(): Slot {
  const w = new Worker(new URL('./neural.worker.ts', import.meta.url), { type: 'module' })
  const slot: Slot = { w, ready: false, busy: 0 }
  const first = pool.length === 0
  w.onmessage = (e: MessageEvent) => {
    const m = e.data as { type: string; id?: number; p?: number; buf?: ArrayBuffer; message?: string; ms?: number }
    if (m.type === 'progress') { if (first) onProgress?.(m.p ?? 0); return }   // (only the first copy downloads)
    const x = m.id !== undefined ? waiting.get(m.id) : undefined
    if (!x) return
    waiting.delete(m.id!); x.slot.busy = Math.max(0, x.slot.busy - 1)
    if (m.type === 'error') x.fail(new Error(m.message))
    else {
      if (m.type === 'audio' && m.buf) {   // (for tuning: how long a sentence took to make, against how long it lasts)
        const v = new DataView(m.buf), secs = (m.buf.byteLength - 44) / (v.getUint32(24, true) * (v.getUint16(34, true) / 8))
        ;((window as unknown as { __neural?: object[] }).__neural ??= []).push({ ms: m.ms, secs: Math.round(secs * 100) / 100, copies: pool.filter((p) => p.ready).length })
      }
      x.ok(m.type === 'audio' ? new Blob([m.buf!], { type: 'audio/wav' }) : undefined)
    }
  }
  w.onerror = (e) => {
    const err = new Error(e.message || 'The voice could not start')
    waiting.forEach((x, id) => { if (x.slot === slot) { x.fail(err); waiting.delete(id) } })
    w.terminate(); const i = pool.indexOf(slot); if (i >= 0) pool.splice(i, 1)
  }
  pool.push(slot)
  return slot
}
function call<T>(slot: Slot, msg: object): Promise<T> {
  return new Promise<T>((ok, fail) => { const id = nextId++; slot.busy++; waiting.set(id, { slot, ok: ok as (v: unknown) => void, fail }); slot.w.postMessage({ ...msg, id }) })
}

let grown = false
/** once the first copy has the model, start the other copies in the background (they read it from the browser's saved copy) */
function grow() {
  if (grown) return
  grown = true
  for (let i = 1; i < wanted(); i++) {
    const s = spawn()
    call<void>(s, { type: 'load' }).then(() => { s.ready = true }).catch(() => { const k = pool.indexOf(s); if (k >= 0) pool.splice(k, 1) })
  }
}

/** download (the first time) and start the model; `progress` is 0 to 1 for the download */
export async function loadNeural(progress?: (p: number) => void): Promise<void> {
  if (ready) return
  if (progress) onProgress = progress
  const s = pool[0] ?? spawn()
  await call<void>(s, { type: 'load' })
  s.ready = true; ready = true
  grow()
}

export async function speakNeural(text: string, voice = neuralVoice()): Promise<Blob> {
  if (!pool.length) { ready = false; grown = false }   // every copy has stopped: start again
  await loadNeural()
  const s = pool.filter((p) => p.ready).sort((a, b) => a.busy - b.busy)[0] ?? pool[0]   // the copy with the least to do
  return call<Blob>(s, { type: 'speak', text, voice })
}

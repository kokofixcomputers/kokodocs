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

/** The model lives in a worker (see neural.worker.ts), so downloading it, starting it and speaking never freeze the page. */
let ready = false
export const neuralReady = () => ready
let worker: Worker | null = null
let nextId = 1
const waiting = new Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void }>()
let onProgress: ((p: number) => void) | undefined

function start(): Worker {
  if (worker) return worker
  const w = new Worker(new URL('./neural.worker.ts', import.meta.url), { type: 'module' })
  w.onmessage = (e: MessageEvent) => {
    const m = e.data as { type: string; id?: number; p?: number; buf?: ArrayBuffer; message?: string; ms?: number }
    if (m.type === 'progress') { onProgress?.(m.p ?? 0); return }
    const w = m.id !== undefined ? waiting.get(m.id) : undefined
    if (!w) return
    waiting.delete(m.id!)
    if (m.type === 'error') w.fail(new Error(m.message))
    else {
      if (m.type === 'audio' && m.buf) {   // (for tuning: how long a sentence took to make, against how long it lasts)
        const v = new DataView(m.buf), secs = (m.buf.byteLength - 44) / (v.getUint32(24, true) * (v.getUint16(34, true) / 8))
        ;((window as unknown as { __neural?: object[] }).__neural ??= []).push({ ms: m.ms, secs: Math.round(secs * 100) / 100 })
      }
      w.ok(m.type === 'audio' ? new Blob([m.buf!], { type: 'audio/wav' }) : undefined)
    }
  }
  w.onerror = (e) => { const err = new Error(e.message || 'The voice could not start'); waiting.forEach((x) => x.fail(err)); waiting.clear(); w.terminate(); worker = null }
  worker = w
  return w
}
function call<T>(msg: object): Promise<T> {
  return new Promise<T>((ok, fail) => { const id = nextId++; waiting.set(id, { ok: ok as (v: unknown) => void, fail }); start().postMessage({ ...msg, id }) })
}

/** download (the first time) and start the model; `progress` is 0 to 1 for the download */
export async function loadNeural(progress?: (p: number) => void): Promise<void> {
  if (ready) return
  if (progress) onProgress = progress
  await call<void>({ type: 'load' })
  ready = true
}

export async function speakNeural(text: string, voice = neuralVoice()): Promise<Blob> {
  const b = await call<Blob>({ type: 'speak', text, voice })
  ready = true
  return b
}

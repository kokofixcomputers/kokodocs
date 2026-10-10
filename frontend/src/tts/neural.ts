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

type Model = { generate(text: string, o: { voice: string }): Promise<{ toBlob(): Blob }> }
let model: Promise<Model> | null = null
let ready = false
export const neuralReady = () => ready

/** download (first time) and start the model; `progress` is 0 to 1 for the download */
export function loadNeural(progress?: (p: number) => void): Promise<Model> {
  model ??= (async () => {
    const { KokoroTTS, env } = await import('kokoro-js')
    try { env.wasmPaths = `${location.origin}/ocr/ort/` } catch { /* the runtime's own default */ }   // (the same local copy of the runtime that "Scan a page" uses)
    const files = new Map<string, { loaded: number; total: number }>()
    const m = await KokoroTTS.from_pretrained(MODEL, {
      dtype: 'q8', device: 'wasm',
      progress_callback: (e: { status?: string; file?: string; loaded?: number; total?: number }) => {
        if (e.status === 'progress' && e.file && e.total) { files.set(e.file, { loaded: e.loaded ?? 0, total: e.total }); let l = 0, t = 0; files.forEach((f) => { l += f.loaded; t += f.total }); progress?.(t ? l / t : 0) }
      },
    })
    ready = true
    return m as unknown as Model
  })().catch((e) => { model = null; throw e })   // a failed download can be tried again
  return model
}

let chain: Promise<unknown> = Promise.resolve()   // one sentence at a time: the model runs on one thread
export function speakNeural(text: string, voice = neuralVoice()): Promise<Blob> {
  const run = chain.then(async () => (await (await loadNeural()).generate(text, { voice })).toBlob())
  chain = run.catch(() => {})
  return run
}

/// <reference lib="webworker" />
/** The neural voice's model runs here, off the page's main thread (starting it and speaking a sentence take seconds of solid computing, which would freeze the page). */
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX'
type Model = { generate(text: string, o: { voice: string }): Promise<{ toBlob(): Blob }> }
let model: Promise<Model> | null = null

function load(): Promise<Model> {
  model ??= (async () => {
    const { KokoroTTS, env } = await import('kokoro-js')
    try { env.wasmPaths = `${self.location.origin}/ocr/ort/` } catch { /* the runtime's own default */ }
    const files = new Map<string, { loaded: number; total: number }>()
    const m = await KokoroTTS.from_pretrained(MODEL, {
      dtype: 'q8', device: 'wasm',
      progress_callback: (e: { status?: string; file?: string; loaded?: number; total?: number }) => {
        if (e.status === 'progress' && e.file && e.total) {
          files.set(e.file, { loaded: e.loaded ?? 0, total: e.total })
          let l = 0, t = 0; files.forEach((f) => { l += f.loaded; t += f.total })
          self.postMessage({ type: 'progress', p: t ? l / t : 0 })
        }
      },
    })
    return m as unknown as Model
  })().catch((e) => { model = null; throw e })
  return model
}

let queue: Promise<unknown> = Promise.resolve()
self.onmessage = (e: MessageEvent) => {
  const m = e.data as { type: 'load'; id: number } | { type: 'speak'; id: number; text: string; voice: string }
  queue = queue.then(async () => {
    try {
      if (m.type === 'load') { await load(); self.postMessage({ type: 'done', id: m.id }) }
      else {
        const audio = await (await load()).generate(m.text, { voice: m.voice })
        const buf = await audio.toBlob().arrayBuffer()
        self.postMessage({ type: 'audio', id: m.id, buf }, [buf])
      }
    } catch (err) { self.postMessage({ type: 'error', id: m.id, message: (err as Error)?.message ?? String(err) }) }
  })
}

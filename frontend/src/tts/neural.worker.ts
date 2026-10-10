/// <reference lib="webworker" />
/** The neural voice's model runs here, off the page's main thread (starting it and speaking a sentence take seconds of solid computing, which would freeze the page). */
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX'
type Model = { generate(text: string, o: { voice: string }): Promise<{ toBlob(): Blob }> }
let model: Promise<Model> | null = null
type Cfg = { device: 'wasm' | 'webgpu'; dtype: 'q8' | 'fp32' }   // (the 16-bit file is not used: on the graphics card it sounds like static)
let cfg: Cfg = { device: 'wasm', dtype: 'q8' }
let used: Cfg['device'] = 'wasm'   // what it ended up running on

function load(): Promise<Model> {
  model ??= (async () => {
    const { KokoroTTS, env } = await import('kokoro-js')
    try { env.wasmPaths = `${self.location.origin}/ocr/tts/` } catch { /* the runtime's own default */ }
    if (self.crossOriginIsolated) {   // (only possible when the site is cross-origin isolated, as the desktop app is: then the model can use several threads)
      try { const { env: t } = await import('@huggingface/transformers'); t.backends.onnx.wasm!.numThreads = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) >> 1)) } catch { /* one thread */ }
    }   // (the runtime build that matches this model, with WebGPU as well as the processor)
    const files = new Map<string, { loaded: number; total: number }>()
    const build = (c: Cfg) => KokoroTTS.from_pretrained(MODEL, {
      dtype: c.dtype, device: c.device,
      progress_callback: (e: { status?: string; file?: string; loaded?: number; total?: number }) => {
        if (e.status === 'progress' && e.file && e.total) {
          files.set(e.file, { loaded: e.loaded ?? 0, total: e.total })
          let l = 0, t = 0; files.forEach((f) => { l += f.loaded; t += f.total })
          self.postMessage({ type: 'progress', p: t ? l / t : 0 })
        }
      },
    })
    try { const m = (await build(cfg)) as unknown as Model; used = cfg.device; return m } catch (err) {
      if (cfg.device !== 'webgpu') throw err
      self.postMessage({ type: 'note', text: `The graphics card couldn't be used (${(err as Error)?.message ?? err}); using the processor.` })
      cfg = { device: 'wasm', dtype: 'q8' }; files.clear()
      const m = (await build(cfg)) as unknown as Model; used = 'wasm'; return m
    }
  })().catch((e) => { model = null; throw e })
  return model
}

let queue: Promise<unknown> = Promise.resolve()
self.onmessage = (e: MessageEvent) => {
  const m = e.data as { type: 'load'; id: number; cfg?: Cfg } | { type: 'speak'; id: number; text: string; voice: string; cfg?: Cfg }
  if (m.cfg && !model) cfg = m.cfg
  queue = queue.then(async () => {
    try {
      if (m.type === 'load') { await load(); self.postMessage({ type: 'done', id: m.id, device: used }) }
      else {
        const t0 = performance.now()
        let audio
        try { audio = await (await load()).generate(m.text, { voice: m.voice }) } catch (err) {
          if (used !== 'webgpu') throw err
          // the graphics card failed while speaking (out of memory, or the driver gave up): carry on with the processor
          self.postMessage({ type: 'note', text: `The graphics card stopped working (${(err as Error)?.message ?? err}); using the processor.` })
          model = null; cfg = { device: 'wasm', dtype: 'q8' }
          audio = await (await load()).generate(m.text, { voice: m.voice })
        }
        const buf = await audio.toBlob().arrayBuffer()
        self.postMessage({ type: 'audio', id: m.id, buf, ms: Math.round(performance.now() - t0) }, [buf])
      }
    } catch (err) { self.postMessage({ type: 'error', id: m.id, message: (err as Error)?.message ?? String(err) }) }
  })
}

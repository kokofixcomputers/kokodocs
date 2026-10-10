/// <reference lib="webworker" />
export {}   // (a module of its own, so its names stay out of the other workers)
/** The small language model for inline suggestions runs here, off the page's main thread. SmolLM2 360M (Apache 2.0, Hugging Face), through transformers.js. */
let MODEL = 'HuggingFaceTB/SmolLM2-360M-Instruct'   // (the base 360M model has no browser build; the instruct one continues text just as well)
type Gen = (prompt: string, o: Record<string, unknown>) => Promise<{ generated_text: string }[]>
type Cfg = { device: 'wasm' | 'webgpu'; dtype: 'q8' | 'q4f16' }
let cfg: Cfg = { device: 'wasm', dtype: 'q8' }
let used: Cfg['device'] = 'wasm'
let gen: Promise<Gen> | null = null
let stopper: { interrupt(): void; reset(): void } | null = null
let Stop: (new () => { interrupt(): void; reset(): void }) | null = null

function load(): Promise<Gen> {
  gen ??= (async () => {
    const t = await import('@huggingface/transformers')
    Stop = t.InterruptableStoppingCriteria as never
    try { t.env.backends.onnx.wasm!.wasmPaths = `${self.location.origin}/ocr/tts/` } catch { /* the runtime's own default */ }
    if (self.crossOriginIsolated) { try { t.env.backends.onnx.wasm!.numThreads = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) >> 1)) } catch { /* one thread */ } }
    const files = new Map<string, { loaded: number; total: number }>()
    const build = (c: Cfg) => t.pipeline('text-generation', MODEL, {
      device: c.device, dtype: c.dtype,
      progress_callback: (e: { status?: string; file?: string; loaded?: number; total?: number }) => {
        if (e.status === 'progress' && e.file && e.total) {
          files.set(e.file, { loaded: e.loaded ?? 0, total: e.total })
          let l = 0, tt = 0; files.forEach((f) => { l += f.loaded; tt += f.total })
          self.postMessage({ type: 'progress', p: tt ? l / tt : 0 })
        }
      },
    }) as unknown as Promise<Gen>
    try { const g = await build(cfg); used = cfg.device; return g } catch (err) {
      if (cfg.device !== 'webgpu') throw err
      self.postMessage({ type: 'note', text: `The graphics card couldn't be used (${(err as Error)?.message ?? err}); using the processor.` })
      cfg = { device: 'wasm', dtype: 'q8' }; files.clear()
      const g = await build(cfg); used = 'wasm'; return g
    }
  })().catch((e) => { gen = null; throw e })
  return gen
}

let queue: Promise<unknown> = Promise.resolve()
self.onmessage = (e: MessageEvent) => {
  const m = e.data as { type: 'load'; id: number; cfg?: Cfg; model?: string } | { type: 'complete'; id: number; prompt: string; max: number } | { type: 'cancel' }
  if (m.type === 'cancel') { stopper?.interrupt(); return }   // (not queued: it has to reach a generation that is running)
  if (m.type === 'load' && !gen) { if (m.cfg) cfg = m.cfg; if (m.model) MODEL = m.model }
  queue = queue.then(async () => {
    try {
      if (m.type === 'load') { await load(); self.postMessage({ type: 'done', id: m.id, device: used }) }
      else {
        const g = await load(), t0 = performance.now()
        stopper = Stop ? new Stop() : null
        const out = await g(m.prompt, { max_new_tokens: m.max, do_sample: false, repetition_penalty: 1.12, return_full_text: false, ...(stopper ? { stopping_criteria: stopper } : {}) })
        stopper = null
        self.postMessage({ type: 'text', id: m.id, text: out[0]?.generated_text ?? '', ms: Math.round(performance.now() - t0) })
      }
    } catch (err) { stopper = null; self.postMessage({ type: 'error', id: m.id, message: (err as Error)?.message ?? String(err) }) }
  })
}

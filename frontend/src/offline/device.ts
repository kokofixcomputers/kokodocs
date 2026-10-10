import { reader } from '../tts/reader'
import { resetNeural } from '../tts/neural'
import { idb } from './idb'
import { forgetEverything, outbox } from './store'

/** What KokoDocs keeps on this device, how much room each part takes, and how to free it. Nothing here is deleted from the server. */
export interface DeviceRow {
  id: string
  title: string
  detail: string
  bytes: number
  /** what asking to free it up does, in the confirmation */
  warn?: string
  /** why it can't be freed right now */
  blocked?: string
  free: () => Promise<void>
}

const sizeOf = async (res: Response) => { const n = Number(res.headers.get('content-length')); return n > 0 ? n : (await res.blob()).size }

/** the bytes of the files in one saved collection whose address matches, and a way to remove them */
async function cached(name: string | ((n: string) => boolean), test: (url: string) => boolean) {
  let bytes = 0, count = 0
  const names = typeof name === 'string' ? [name] : (await caches.keys()).filter(name)
  for (const n of names) {
    const c = await caches.open(n)
    for (const req of await c.keys()) {
      if (!test(req.url)) continue
      const res = await c.match(req); if (!res) continue
      bytes += await sizeOf(res).catch(() => 0); count++
    }
  }
  const remove = async () => { for (const n of names) { const c = await caches.open(n); for (const req of await c.keys()) if (test(req.url)) await c.delete(req) } }
  return { bytes, count, remove }
}

export interface Summary { used: number; quota: number }
export async function usage(): Promise<Summary | null> {
  try { const e = await navigator.storage.estimate(); return { used: e.usage ?? 0, quota: e.quota ?? 0 } } catch { return null }
}

export async function deviceRows(): Promise<DeviceRow[]> {
  const rows: DeviceRow[] = []
  const stopVoice = () => { reader.stop(); resetNeural() }   // (a voice that is being read from must let go of its files first)

  // the neural read-aloud voice (its model files are kept by the browser, by the library that runs it)
  if ('caches' in self) {
    const T = 'transformers-cache'
    const gpu = await cached(T, (u) => /\/onnx\/model\.onnx$/.test(u))
    const cpu = await cached(T, (u) => /\/onnx\/model_quantized\.onnx$/.test(u))
    const rest = await cached(T, (u) => !/\/onnx\/model(_quantized)?\.onnx$/.test(u))
    if (gpu.count) rows.push({ id: 'voice-gpu', title: 'Neural voice, graphics card version', detail: 'The model that reads aloud on a graphics card. It downloads again if you use it.', bytes: gpu.bytes, free: async () => { stopVoice(); await gpu.remove() } })
    if (cpu.count) rows.push({ id: 'voice-cpu', title: 'Neural voice, processor version', detail: 'The smaller model that reads aloud on the processor. It downloads again if you use it.', bytes: cpu.bytes, free: async () => { stopVoice(); await cpu.remove() } })
    if (rest.count) rows.push({ id: 'voice-misc', title: 'Neural voice, voices and settings', detail: 'The voices to choose from and the voice model\'s settings.', bytes: rest.bytes, free: async () => { stopVoice(); await rest.remove() } })

    // the app itself, kept by the site so it opens with no connection
    const app = await cached((n) => n.startsWith('koko-'), () => true)
    if (app.count) rows.push({ id: 'app', title: 'The app itself', detail: 'The site\'s own files, kept so it opens with no connection. They download again the next time you open it online.', bytes: app.bytes, free: app.remove })
  }

  // documents kept for working offline
  const docs = await idb.all<Uint8Array>('ydocs'), kv = await idb.all('kv')
  const pending = await outbox.count()
  const docBytes = docs.reduce((n, d) => n + (d.value?.byteLength ?? 0), 0) + kv.reduce((n, d) => n + JSON.stringify(d.value ?? '').length, 0)
  if (docs.length || docBytes > 2000) {
    rows.push({
      id: 'documents', title: 'Documents saved for offline use',
      detail: `${docs.length} document${docs.length === 1 ? '' : 's'} and your lists, so you can open and edit them with no connection.`, bytes: docBytes,
      warn: 'They are saved on this device again the next time you are online, unless you turn off the offline copy above.',
      blocked: pending ? `${pending} change${pending === 1 ? '' : 's'} made offline ${pending === 1 ? 'hasn\'t' : 'haven\'t'} reached the server yet. Connect first, so nothing is lost.` : undefined,
      free: async () => { await forgetEverything() },
    })
  }

  // the desktop app's interface: which version it is showing, and the newer one it downloaded (if any)
  if (window.kokoDesktop?.bundle) {
    const b = await window.kokoDesktop.bundle().catch(() => null)
    if (b?.downloadedBytes) rows.push({ id: 'desk-interface', title: 'Downloaded interface update', detail: `Version ${b.commit.slice(0, 7)}, downloaded after the app was built. Freeing it goes back to the interface that came with the app (it can be downloaded again).`, bytes: b.downloadedBytes, free: async () => { await window.kokoDesktop!.removeBundle!() } })
  }
  // the desktop app's own files
  const d = window.kokoDesktop
  if (d?.storage) {
    const s = await d.storage().catch(() => null)
    if (s) {
      if (s.appfiles) rows.push({ id: 'desk-app', title: 'Desktop app files', detail: 'A copy of the app\'s own files on disk, so the window opens with no connection. They download again within a minute of opening it online.', bytes: s.appfiles, free: async () => { await d.clear!('appfiles') } })
      if (s.cache) rows.push({ id: 'desk-cache', title: 'Temporary web cache', detail: 'Pictures and other things the window keeps to load faster.', bytes: s.cache, free: async () => { await d.clear!('cache') } })
    }
  }
  return rows.sort((a, b) => b.bytes - a.bytes)
}

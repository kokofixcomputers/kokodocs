import { api } from '../api'
import { toast } from '../ui/Toast'
import { loadNeural, neuralChosen, neuralReady, speakNeural } from './neural'

/** Read aloud: the page's text is cut into sentences, and a sentence at a time is spoken by the browser's own voices, or (if the administrator switched it on)
 *  by the server's voice, which is fetched a few sentences ahead. One reader for the whole app, so only one thing is ever speaking; the floating pill and the
 *  header buttons are views of it. */

export type Phase = 'idle' | 'loading' | 'playing' | 'paused'
export const RATES = [0.75, 0.9, 1, 1.15, 1.25, 1.5, 1.75, 2]
interface Unit { text: string; lang: string; range: Range }
export interface Snapshot { phase: Phase; index: number; total: number; rate: number; engine: 'browser' | 'server' | 'neural'; text: string; note: string }

const BLOCKS = 'p,h1,h2,h3,h4,h5,h6,li,td,th,pre,blockquote,figcaption,summary,dt,dd'
const SKIP = '.ProseMirror-widget,.ProseMirror-separator,.ProseMirror-gapcursor,[data-tts-skip],script,style'
const AHEAD = 6   // sentences made in advance (several copies of the neural voice make them side by side)

const hasWords = (s: string) => /[\p{L}\p{N}]/u.test(s)
function langOf(s: string): string {
  if (/[぀-ヿ]/.test(s)) return 'ja'
  if (/[가-힯]/.test(s)) return 'ko'
  if (/[一-鿿]/.test(s)) return 'zh'
  const d = (document.documentElement.lang || navigator.language || 'en').slice(0, 2).toLowerCase()
  return ['es', 'fr'].includes(d) ? d : 'en'
}

/** every sentence of the page's text, in order, each with the part of the page it came from (for the highlight) */
export function sentences(root: HTMLElement): Unit[] {
  const out: Unit[] = []
  const seg = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(document.documentElement.lang || undefined, { granularity: 'sentence' }) : null
  const blocks = [...root.querySelectorAll<HTMLElement>(BLOCKS)].filter((b) => !b.querySelector(BLOCKS) && !b.closest(SKIP) && b.getClientRects().length > 0)
  for (const b of blocks) {
    const nodes: { n: Text; at: number }[] = []
    let full = ''
    const w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT)
    for (let n = w.nextNode() as Text | null; n; n = w.nextNode() as Text | null) {
      if (n.parentElement?.closest(SKIP)) continue
      nodes.push({ n, at: full.length }); full += n.data
    }
    if (!hasWords(full)) continue
    const parts = seg ? [...seg.segment(full)].map((s) => ({ at: s.index, text: s.segment })) : (full.match(/[^.!?]+[.!?]*\s*/g) ?? [full]).reduce<{ at: number; text: string }[]>((a, t) => [...a, { at: a.length ? a[a.length - 1].at + a[a.length - 1].text.length : 0, text: t }], [])
    const locate = (off: number) => { let k = nodes.length - 1; while (k > 0 && nodes[k].at > off) k--; return { node: nodes[k].n, offset: Math.min(off - nodes[k].at, nodes[k].n.length) } }
    for (const p of parts) {
      const text = p.text.replace(/\s+/g, ' ').trim()
      if (!hasWords(text)) continue
      const start = locate(p.at), end = locate(p.at + p.text.trimEnd().length)
      const r = document.createRange()
      try { r.setStart(start.node, start.offset); r.setEnd(end.node, end.offset) } catch { continue }
      out.push({ text, lang: langOf(text), range: r })
    }
  }
  return out
}

const KEY_RATE = 'koko.tts.rate', KEY_VOICE = 'koko.tts.voice'
const read = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } }

export function voices(): SpeechSynthesisVoice[] { return typeof speechSynthesis === 'undefined' ? [] : speechSynthesis.getVoices() }
export function bestVoice(lang: string): SpeechSynthesisVoice | null {
  const all = voices().filter((v) => v.lang.toLowerCase().startsWith(lang))
  const saved = read(KEY_VOICE)
  const mine = saved && all.find((v) => v.voiceURI === saved)
  if (mine) return mine
  // the best-sounding voice, not just the system default (which is often the plain "Samantha"): downloaded premium and enhanced voices and Siri voices first
  const odd = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Deranged|Good News|Hysterical|Jester|Junior|Kathy|Organ|Princess|Ralph|Trinoids|Whisper|Wobble|Zarvox|Fred|Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley)\b/i
  const score = (v: SpeechSynthesisVoice) => (/premium/i.test(v.name) ? 5 : /enhanced|siri/i.test(v.name) ? 4 : /natural|neural/i.test(v.name) ? 4 : /google/i.test(v.name) ? 2 : 0) + (v.localService ? 1 : 0) - (odd.test(v.name) ? 6 : 0) - (/compact/i.test(v.voiceURI) ? 1 : 0)
  return [...all].sort((a, b) => score(b) - score(a))[0] ?? null
}
export const chosenVoice = () => read(KEY_VOICE) ?? ''
export function chooseVoice(uri: string) { write(KEY_VOICE, uri); reader.restartCurrent() }

class Reader {
  private units: Unit[] = []
  private end = 0
  private i = 0
  private phase: Phase = 'idle'
  private rate = Number(read(KEY_RATE)) || 1
  private engine: 'browser' | 'server' | 'neural' = 'browser'
  private note = ''
  private token = 0
  private audio: HTMLAudioElement | null = null
  private clips = new Map<number, Promise<string>>()
  private subs = new Set<() => void>()
  private first = 0
  private snap: Snapshot = this.make()
  private server: boolean | null = null

  subscribe = (f: () => void) => { this.subs.add(f); return () => { this.subs.delete(f) } }
  getSnapshot = () => this.snap
  private make(): Snapshot { return { phase: this.phase, index: this.i, total: Math.max(0, this.end - this.first), rate: this.rate, engine: this.engine, text: this.units[this.i]?.text ?? '', note: this.note } }
  private emit() { this.snap = this.make(); this.subs.forEach((f) => f()) }

  private async serverOn() {
    if (this.server === null) { try { this.server = (await api.ttsConfig()).engine === 'cloudflare' } catch { this.server = false } }
    return this.server
  }

  /** read what is selected, or the whole page. `plain` is true for encrypted documents: their text must stay on this device. */
  async start(opts: { plain: boolean }) {
    const root = document.querySelector<HTMLElement>('.ProseMirror')
    if (!root) { toast('There is nothing to read here.'); return }
    this.stop()
    let units = sentences(root)
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed && sel.rangeCount && root.contains(sel.anchorNode)) {
      const s = sel.getRangeAt(0)
      // sentences of one paragraph share a text node, so compare exact positions: a sentence is in if it overlaps the selection
      units = units.filter((u) => s.compareBoundaryPoints(Range.START_TO_END, u.range) > 0 && s.compareBoundaryPoints(Range.END_TO_START, u.range) < 0)   // starts before the selection ends, and ends after it starts
    }
    if (!units.length) { toast('There is nothing to read here.'); return }
    this.units = units; this.first = 0; this.end = units.length; this.i = 0
    this.engine = neuralChosen() ? 'neural' : !opts.plain && (await this.serverOn()) ? 'server' : 'browser'   // (the neural voice runs on this device, so it is fine for encrypted documents too)
    this.note = ''
    if (this.engine === 'browser' && typeof speechSynthesis === 'undefined') { toast("This browser can't read aloud."); return }
    this.phase = 'loading'; this.emit()
    void this.play(0)
  }

  private clear() { this.token++; try { speechSynthesis?.cancel() } catch { /* ignore */ } if (this.audio) { this.audio.onended = this.audio.onerror = null; this.audio.pause(); this.audio = null } }

  private async play(i: number) {
    const me = ++this.token
    if (i >= this.end) return this.stop()
    this.i = i; this.mark()
    const u = this.units[i]
    const dev = this.engine === 'browser' || (this.engine === 'neural' && u.lang !== 'en')   // (the neural voice speaks English; other languages use the device's voices)
    this.phase = dev ? 'playing' : 'loading'; this.emit()
    if (dev) {
      try { speechSynthesis.cancel() } catch { /* ignore */ }
      const s = new SpeechSynthesisUtterance(u.text)
      s.rate = this.rate; s.lang = u.lang
      const v = bestVoice(u.lang); if (v) s.voice = v
      s.onend = () => { if (me === this.token) void this.play(i + 1) }
      s.onerror = (e) => { if (me === this.token && e.error !== 'interrupted' && e.error !== 'canceled') void this.play(i + 1) }
      speechSynthesis.speak(s)
      return
    }
    try {
      if (this.engine === 'neural' && !neuralReady()) {   // the first time: the voice is downloaded (about 90 MB), with its progress shown in the pill
        this.note = 'Getting the voice ready…'; this.emit()
        await loadNeural((p) => { if (me === this.token) { this.note = `Downloading the voice… ${Math.round(p * 100)}%`; this.emit() } })
      }
      const mine = this.clip(i)   // (this one first: the voice makes them in the order asked)
      for (let k = 1; k <= AHEAD; k++) if (i + k < this.end) void this.clip(i + k).catch(() => {})   // the next sentences are already being made while this one is made and spoken
      const url = await mine
      if (this.note) { this.note = ''; this.emit() }
      if (me !== this.token) return
      const a = this.audio = new Audio(url)
      a.playbackRate = this.rate
      a.onended = () => { if (me === this.token) void this.play(i + 1) }
      a.onerror = () => { if (me === this.token) this.fallBack(i) }
      await a.play()
      if (me === this.token) { this.phase = 'playing'; this.emit() }
    } catch (e) {
      if (me === this.token) this.fallBack(i, (e as Error)?.message)
    }
  }

  /** the server voice failed: carry on with this device's voice from the same sentence */
  private fallBack(i: number, why?: string) {
    toast(`${this.engine === 'neural' ? 'The neural voice' : 'The server voice'} isn't working${why ? ` (${why})` : ''}. Using this device's voice instead.`)
    if (this.engine === 'server') this.server = false
    this.engine = 'browser'; this.clips.clear()
    void this.play(i)
  }

  private clip(i: number): Promise<string> {
    let c = this.clips.get(i)
    if (!c) {
      const u = this.units[i]
      c = (this.engine === 'neural' ? speakNeural(u.text) : api.ttsSpeak(u.text, u.lang)).then((b) => URL.createObjectURL(b))
      c.catch(() => this.clips.delete(i))
      this.clips.set(i, c)
    }
    return c
  }

  private mark() {
    const h = (window as unknown as { CSS?: { highlights?: Map<string, unknown> }; Highlight?: new (r: Range) => unknown })
    const u = this.units[this.i]
    if (h.CSS?.highlights && h.Highlight && u) {
      h.CSS.highlights.set('tts', new h.Highlight(u.range))
      const rect = u.range.getBoundingClientRect()
      if (rect.height && (rect.top < 90 || rect.bottom > window.innerHeight - 150)) u.range.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }

  pause() {
    if (this.phase !== 'playing' && this.phase !== 'loading') return
    if (this.engine !== 'browser' && this.audio) this.audio.pause(); else { this.token++; try { speechSynthesis.cancel() } catch { /* ignore */ } }   // (this device's voice restarts the sentence when you resume)
    this.phase = 'paused'; this.emit()
  }
  resume() {
    if (this.phase !== 'paused') return
    if (this.engine !== 'browser' && this.audio) { this.phase = 'playing'; this.emit(); void this.audio.play().catch(() => this.fallBack(this.i)) } else void this.play(this.i)
  }
  toggle() { if (this.phase === 'paused') this.resume(); else this.pause() }

  /** one sentence further or back; stays paused if it was paused */
  skip(d: number) {
    if (this.phase === 'idle') return
    const to = Math.max(this.first, Math.min(this.end - 1, this.i + d))
    const was = this.phase
    this.clear()
    if (was === 'paused') { this.i = to; this.audio = null; this.mark(); this.emit(); return }
    void this.play(to)
  }

  setRate(r: number) {
    this.rate = r; write(KEY_RATE, String(r))
    if (this.audio) this.audio.playbackRate = r
    else if (this.phase === 'playing' && this.engine === 'browser') void this.play(this.i)   // this device's voice can't change speed mid-sentence
    this.emit()
  }
  faster() { const k = RATES.findIndex((x) => x >= this.rate - 0.001); this.setRate(RATES[Math.min(RATES.length - 1, (k < 0 ? RATES.length - 1 : k) + 1)]) }
  slower() { const k = RATES.findIndex((x) => x >= this.rate - 0.001); this.setRate(RATES[Math.max(0, (k < 0 ? 1 : k) - 1)]) }

  restartCurrent() { if (this.phase === 'playing' && this.engine === 'browser') void this.play(this.i) }

  stop() {
    this.clear()
    for (const p of this.clips.values()) p.then((u) => URL.revokeObjectURL(u)).catch(() => {})
    this.clips.clear(); this.units = []; this.i = 0; this.end = 0; this.first = 0; this.phase = 'idle'
    ;(window as unknown as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights?.delete('tts')
    this.emit()
  }
}
export const reader = new Reader()

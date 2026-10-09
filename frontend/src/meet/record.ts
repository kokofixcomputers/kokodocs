import type { Peer } from './types'

/** Recording a meeting, in the browser of the person who pressed Record. Calls go between browsers, so there is no server-side copy of the media to
 *  save: this draws everyone's video into one picture (the spotlighted person if there is one, else a shared screen, else a grid), mixes everyone's
 *  audio, and uploads the result in pieces while it runs. Only people who agreed to be recorded are drawn and heard. */

export interface RecInput {
  peers: Peer[]
  spotlight: string | null
  consents: { yes: string[]; no: string[]; pending: string[] } | null   // who agreed (the recorder and the host always count)
}

const W = 1280, H = 720, FPS = 15
const MIMES = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4']
export const recordingMime = () => (typeof MediaRecorder === 'undefined' ? '' : MIMES.find((m) => MediaRecorder.isTypeSupported(m)) ?? '')
const hue = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h }
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?'

export class MeetingRecorder {
  private canvas = document.createElement('canvas')
  private g = this.canvas.getContext('2d')!
  private videos = new Map<string, HTMLVideoElement>()
  private audio: AudioContext | null = null
  private mix: MediaStreamAudioDestinationNode | null = null
  private sources = new Map<string, { node: MediaStreamAudioSourceNode; key: string }>()
  private rec: MediaRecorder | null = null
  private ticker: Worker | null = null
  private track: (MediaStreamTrack & { requestFrame?: () => void }) | null = null
  private flip = false
  private fallback: ReturnType<typeof setInterval> | null = null
  private queue: Promise<void> = Promise.resolve()
  private seq = 0
  private t0 = 0
  private stopped = false
  private failed = false
  id = ''
  required = false

  constructor(private code: string, private jt: string, private input: () => RecInput, private onFail: (message: string) => void) {
    this.canvas.width = W; this.canvas.height = H
  }

  get seconds() { return this.t0 ? (Date.now() - this.t0) / 1000 : 0 }

  async start(): Promise<void> {
    const mime = recordingMime()
    if (!mime) throw new Error("This browser can't record video.")
    const r = await fetch(`/api/meet/${encodeURIComponent(this.code)}/recordings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jt: this.jt, mime }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : j.detail?.message ?? "Recording couldn't start.")
    this.id = j.id; this.required = !!j.required
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    this.audio = new AC()
    if (this.audio.state === 'suspended') await this.audio.resume().catch(() => {})
    this.mix = this.audio.createMediaStreamDestination()
    const silence = this.audio.createConstantSource()   // an audio mix with nothing connected delivers no samples and the recorder would wait for them forever (a meeting where nobody's microphone is on)
    silence.offset.value = 0; silence.connect(this.mix); silence.start()
    this.sync(); this.draw()
    const stream = this.canvas.captureStream(FPS)
    this.track = stream.getVideoTracks()[0] as typeof this.track
    this.mix.stream.getAudioTracks().forEach((t) => stream.addTrack(t))
    this.rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1_800_000, audioBitsPerSecond: 96_000 })
    this.rec.ondataavailable = (e) => { if (e.data.size) this.upload(e.data) }
    this.t0 = Date.now()
    this.rec.start(4000)
    try {   // a worker's timer isn't slowed down when the tab is in the background
      this.ticker = new Worker(URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${Math.round(1000 / FPS)})`], { type: 'text/javascript' })))
      this.ticker.onmessage = () => { this.sync(); this.draw() }
    } catch { this.fallback = setInterval(() => { this.sync(); this.draw() }, 1000 / FPS) }
  }

  private upload(blob: Blob) {
    const seq = this.seq++
    this.queue = this.queue.then(async () => {
      if (this.failed) return
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const r = await fetch(`/api/meet/${encodeURIComponent(this.code)}/recordings/${this.id}/chunk?seq=${seq}`, { method: 'PUT', headers: { 'x-meet-ticket': this.jt, 'content-type': 'application/octet-stream' }, body: blob })
          if (r.ok) return
          if (r.status === 413) return this.fail("Recording stopped: the host's storage is full. What was recorded so far is saved.")
          if (r.status === 410 || r.status === 403) return this.fail('The recording ended.')
        } catch { /* try again */ }
        await new Promise((res) => setTimeout(res, 800 * (attempt + 1)))
      }
      this.fail("Recording stopped: the connection to the server was lost.")
    })
  }

  private fail(message: string) {
    if (this.failed || this.stopped) return
    this.failed = true
    this.onFail(message)
    this.shutdown()
  }

  /** Stop, send the last piece and say how long it was. */
  async stop(): Promise<void> {
    if (this.stopped) return
    const rec = this.rec
    if (rec && rec.state !== 'inactive') await new Promise<void>((res) => { rec.addEventListener('stop', () => res(), { once: true }); rec.stop() })
    await this.queue
    const ms = Math.round(this.seconds * 1000)
    this.shutdown()
    if (!this.failed && this.id) await fetch(`/api/meet/${encodeURIComponent(this.code)}/recordings/${this.id}/stop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jt: this.jt, duration_ms: ms }) }).catch(() => {})
  }

  /** Stop without telling the server (it has already ended the recording). */
  abandon() { this.failed = true; this.shutdown() }

  private shutdown() {
    this.stopped = true
    if (this.rec && this.rec.state !== 'inactive') { try { this.rec.stop() } catch { /* already stopped */ } }
    this.ticker?.terminate(); this.ticker = null
    if (this.fallback) clearInterval(this.fallback)
    this.sources.forEach((s) => { try { s.node.disconnect() } catch { /* gone */ } }); this.sources.clear()
    void this.audio?.close().catch(() => {}); this.audio = null
    this.videos.forEach((v) => { v.srcObject = null }); this.videos.clear()
  }

  // ---- who is in the recording
  private included(): Peer[] {
    const { peers, consents } = this.input()
    const ok = new Set(consents?.yes ?? [])
    return peers.filter((p) => p.self || ok.has(p.id))
  }

  private video(key: string, stream: MediaStream | null): HTMLVideoElement | null {
    if (!stream || !stream.getVideoTracks().length) { const v = this.videos.get(key); if (v) { v.srcObject = null; this.videos.delete(key) } return null }
    let v = this.videos.get(key)
    if (!v) { v = document.createElement('video'); v.muted = true; v.playsInline = true; this.videos.set(key, v) }
    if (v.srcObject !== stream) { v.srcObject = stream; void v.play().catch(() => {}) }
    return v
  }

  /** Keep the audio mix and the hidden videos in step with the people who are in the recording. */
  private sync() {
    if (!this.audio || !this.mix) return
    const want = new Map<string, { stream: MediaStream; key: string }>()
    for (const p of this.included()) {
      const s = p.self ? p.mic : p.audio ? p.stream : null
      const track = s?.getAudioTracks()[0]
      if (s && track) want.set(p.id, { stream: s, key: track.id })
    }
    for (const [id, s] of this.sources) if (!want.has(id) || want.get(id)!.key !== s.key) { try { s.node.disconnect() } catch { /* gone */ } this.sources.delete(id) }
    for (const [id, w] of want) if (!this.sources.has(id)) { const node = this.audio.createMediaStreamSource(new MediaStream(w.stream.getAudioTracks())); node.connect(this.mix); this.sources.set(id, { node, key: w.key }) }
  }

  // ---- the picture
  private draw() { this.paint(); this.track?.requestFrame?.() }

  private paint() {
    const g = this.g
    g.fillStyle = '#0d0d0f'; g.fillRect(0, 0, W, H)
    this.flip = !this.flip   // a picture that never changes (nobody has a camera on) would make the recorder send no frames at all: change one corner pixel, invisibly, and ask for a frame
    g.fillStyle = this.flip ? '#0e0e10' : '#0d0d0f'; g.fillRect(0, 0, 2, 2)
    const { spotlight } = this.input()
    const ps = this.included()
    const spot = spotlight ? ps.find((p) => p.id === spotlight) : null
    const sharer = ps.find((p) => p.screen && p.screenStream)
    if (spot || sharer) {
      const mainRect = { x: 12, y: 12, w: 1040, h: H - 24 }
      if (spot) this.tile(spot, 'cam', mainRect)
      else this.tile(sharer!, 'screen', mainRect)
      const rest = ps.filter((p) => !(spot && p.id === spot.id))
      const h = Math.min(140, (H - 24 - 8 * 4) / Math.min(5, Math.max(1, rest.length)))
      rest.slice(0, 5).forEach((p, i) => this.tile(p, 'cam', { x: 1064, y: 12 + i * (h + 8), w: 204, h }))
      return
    }
    const n = Math.max(1, ps.length), cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4, rows = Math.ceil(n / cols), gap = 10
    const w = (W - gap * (cols + 1)) / cols, h = (H - gap * (rows + 1)) / rows
    ps.forEach((p, i) => this.tile(p, 'cam', { x: gap + (i % cols) * (w + gap), y: gap + Math.floor(i / cols) * (h + gap), w, h }))
  }

  private tile(p: Peer, kind: 'cam' | 'screen', r: { x: number; y: number; w: number; h: number }) {
    const g = this.g
    g.save()
    g.beginPath(); g.roundRect(r.x, r.y, r.w, r.h, 14); g.clip()
    g.fillStyle = '#1b1b1f'; g.fillRect(r.x, r.y, r.w, r.h)
    const v = this.video(`${p.id}:${kind}`, kind === 'screen' ? p.screenStream : p.video ? p.stream : null)
    if (v && v.readyState >= 2 && v.videoWidth) {
      const s = kind === 'screen' ? Math.min(r.w / v.videoWidth, r.h / v.videoHeight) : Math.max(r.w / v.videoWidth, r.h / v.videoHeight)   // a screen is shown whole, a camera fills its tile
      const dw = v.videoWidth * s, dh = v.videoHeight * s
      if (kind === 'screen') { g.fillStyle = '#000'; g.fillRect(r.x, r.y, r.w, r.h) }
      g.drawImage(v, r.x + (r.w - dw) / 2, r.y + (r.h - dh) / 2, dw, dh)
    } else {
      const d = Math.min(96, r.h * 0.45)
      g.fillStyle = `hsl(${hue(p.name)} 45% 42%)`; g.beginPath(); g.arc(r.x + r.w / 2, r.y + r.h / 2, d / 2, 0, Math.PI * 2); g.fill()
      g.fillStyle = '#fff'; g.font = `600 ${Math.round(d * 0.36)}px Inter, system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'
      g.fillText(initials(p.name), r.x + r.w / 2, r.y + r.h / 2 + 1)
    }
    const label = kind === 'screen' ? `${p.name} is presenting` : p.name
    g.font = '500 17px Inter, system-ui, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle'
    const tw = g.measureText(label).width + (kind === 'cam' && !p.audio ? 26 : 0) + 20
    g.fillStyle = 'rgba(0,0,0,.6)'; g.beginPath(); g.roundRect(r.x + 10, r.y + r.h - 38, Math.min(tw, r.w - 20), 28, 14); g.fill()
    g.fillStyle = '#fff'; g.fillText((kind === 'cam' && !p.audio ? '\u{1F507} ' : '') + label, r.x + 20, r.y + r.h - 23, r.w - 40)
    g.restore()
  }
}

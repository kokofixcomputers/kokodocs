/** Microphone capture for voice typing: live level meter + a 16 kHz mono WAV at the end. No codecs, no ffmpeg. */

const WORKLET = `class Tap extends AudioWorkletProcessor { process(i) { const c = i[0] && i[0][0]; if (c) this.port.postMessage(c.slice(0)); return true } }
registerProcessor('koko-tap', Tap)`

export class Recorder {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private analyser: AnalyserNode | null = null
  private chunks: Float32Array[] = []
  private nodes: AudioNode[] = []
  private buf = new Float32Array(1024)
  startedAt = 0
  peak = 0

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = (this.ctx = new AC())
    if (ctx.state === 'suspended') await ctx.resume()
    const src = ctx.createMediaStreamSource(this.stream)
    const analyser = (this.analyser = ctx.createAnalyser())
    analyser.fftSize = 1024
    src.connect(analyser)
    const mute = ctx.createGain(); mute.gain.value = 0; mute.connect(ctx.destination)
    const onData = (c: Float32Array) => { this.chunks.push(c); for (let i = 0; i < c.length; i += 16) this.peak = Math.max(this.peak, Math.abs(c[i])) }
    try {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
      await ctx.audioWorklet.addModule(url)
      URL.revokeObjectURL(url)
      const tap = new AudioWorkletNode(ctx, 'koko-tap')
      tap.port.onmessage = (e) => onData(e.data as Float32Array)
      src.connect(tap); tap.connect(mute)
      this.nodes.push(tap)
    } catch {
      const sp = ctx.createScriptProcessor(4096, 1, 1)
      sp.onaudioprocess = (e) => onData(new Float32Array(e.inputBuffer.getChannelData(0)))
      src.connect(sp); sp.connect(mute)
      this.nodes.push(sp)
    }
    this.nodes.push(src, analyser, mute)
    this.startedAt = performance.now()
  }

  /** The last `seconds` of what has been said so far, as a 16 kHz WAV, while recording carries on (for the live preview). */
  snapshot(seconds = 14): Blob | null {
    if (!this.ctx || !this.chunks.length) return null
    const rate = this.ctx.sampleRate, want = Math.floor(seconds * rate)
    let n = 0, i = this.chunks.length
    while (i > 0 && n < want) n += this.chunks[--i].length
    const part = this.chunks.slice(i), total = part.reduce((s, c) => s + c.length, 0)
    const all = new Float32Array(total)
    let o = 0
    for (const c of part) { all.set(c, o); o += c.length }
    return encodeWav(downsample(all.length > want ? all.subarray(all.length - want) : all, rate, 16000), 16000)
  }

  /** 0..1 loudness right now (for the waveform). */
  level(): number {
    if (!this.analyser) return 0
    this.analyser.getFloatTimeDomainData(this.buf)
    let sum = 0
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i]
    return Math.min(1, Math.sqrt(sum / this.buf.length) * 5.5)
  }

  get seconds() { return (performance.now() - this.startedAt) / 1000 }

  /** Stop capturing and return the recording as a 16 kHz mono 16-bit WAV. */
  async finish(): Promise<Blob> {
    const rate = this.ctx?.sampleRate ?? 48000
    this.release()
    const total = this.chunks.reduce((n, c) => n + c.length, 0)
    const all = new Float32Array(total)
    let o = 0
    for (const c of this.chunks) { all.set(c, o); o += c.length }
    this.chunks = []
    return encodeWav(downsample(all, rate, 16000), 16000)
  }

  cancel() { this.release(); this.chunks = [] }

  private release() {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.nodes.forEach((n) => { try { n.disconnect() } catch { /* already gone */ } })
    this.nodes = []
    void this.ctx?.close().catch(() => {})
    this.ctx = null; this.stream = null; this.analyser = null
  }
}

/** Box-filter downsample (averaging avoids the harsh aliasing you get from just dropping samples). */
export function downsample(x: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return x
  const ratio = from / to, n = Math.floor(x.length / ratio), out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio), b = Math.min(x.length, Math.max(a + 1, Math.floor((i + 1) * ratio)))
    let s = 0
    for (let j = a; j < b; j++) s += x[j]
    out[i] = s / (b - a)
  }
  return out
}

export function encodeWav(samples: Float32Array, rate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2), v = new DataView(buf)
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) { const s = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true) }
  return new Blob([buf], { type: 'audio/wav' })
}

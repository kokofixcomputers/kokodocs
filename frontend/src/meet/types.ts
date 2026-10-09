/** What the meeting page needs from whatever carries the audio and video. Each provider (meshed browsers, Cloudflare RealtimeKit, ...)
 *  is one class implementing `Call`; the page never knows which one it is talking to. */
export interface Peer {
  id: string
  name: string
  self: boolean
  host: boolean
  audio: boolean
  video: boolean
  screen: boolean
  stream: MediaStream | null        // camera and microphone (the local one has no audio, so you never hear yourself)
  screenStream: MediaStream | null
}

export interface ChatMsg { id: string; from: string; name: string; text: string; ts: number; self: boolean }

export type CallStatus = 'connecting' | 'connected' | 'reconnecting' | 'closed'
/** Why a call stopped: the host ended it, you were removed, you left, or it could not be kept up. */
export type CallEnd = 'ended' | 'kicked' | 'left' | 'failed' | 'full'

export interface Call {
  readonly selfId: string
  readonly isHost: boolean
  readonly canModerate: boolean
  status(): CallStatus
  endReason(): CallEnd | null
  peers(): Peer[]
  chat(): ChatMsg[]
  /** Called whenever anything above changes. Returns the unsubscribe function. */
  subscribe(fn: () => void): () => void
  /** Called when a media device could not be used, with words fit to show. */
  onProblem(fn: (message: string) => void): () => void
  setMic(on: boolean): Promise<void>
  setCam(on: boolean): Promise<void>
  shareScreen(): Promise<void>
  stopScreen(): void
  send(text: string): void
  mute(peerId: string): void
  kick(peerId: string): void
  leave(): void
}

export interface LocalTracks { audio: MediaStreamTrack | null; video: MediaStreamTrack | null }

export class Emitter {
  private fns = new Set<() => void>()
  private problems = new Set<(m: string) => void>()
  subscribe(fn: () => void) { this.fns.add(fn); return () => { this.fns.delete(fn) } }
  onProblem(fn: (m: string) => void) { this.problems.add(fn); return () => { this.problems.delete(fn) } }
  protected changed() { this.fns.forEach((f) => f()) }
  protected problem(m: string) { this.problems.forEach((f) => f(m)) }
}

/** The words for a camera or microphone that could not be opened. */
export function deviceProblem(e: unknown, what: 'camera' | 'microphone' | 'screen'): string {
  const n = (e as DOMException)?.name
  if (n === 'NotAllowedError' || n === 'SecurityError') return what === 'screen' ? 'Screen sharing was cancelled.' : `Allow the ${what} for this site in your browser to use it.`
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return `No ${what} was found.`
  if (n === 'NotReadableError') return `The ${what} is being used by another app.`
  return `The ${what} could not be started.`
}

/** Watch whether anyone is talking in a stream. Calls back only when it flips. */
export function watchSpeaking(stream: MediaStream, on: (speaking: boolean) => void): () => void {
  const track = stream.getAudioTracks()[0]
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  if (!track || !AC) return () => {}
  let ctx: AudioContext | null = null
  try {
    ctx = new AC()
    const src = ctx.createMediaStreamSource(new MediaStream([track]))
    const an = ctx.createAnalyser(); an.fftSize = 512
    src.connect(an)
    const buf = new Uint8Array(an.fftSize)
    let last = false, quiet = 0
    const t = setInterval(() => {
      an.getByteTimeDomainData(buf)
      let peak = 0
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128))
      const loud = peak > 14
      quiet = loud ? 0 : quiet + 1
      const now = loud || (last && quiet < 5)   // hold for half a second so it doesn't flicker between words
      if (now !== last) { last = now; on(now) }
    }, 100)
    return () => { clearInterval(t); void ctx?.close() }
  } catch { void ctx?.close(); return () => {} }
}

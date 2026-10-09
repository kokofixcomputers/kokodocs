import type { MeetSettings } from '../api'

/** What the meeting page needs from a call. A call is two things working together: the *control channel* (who is here, the waiting room, chat,
 *  reactions, hands, polls, ... the same for every provider) and a *media* part (the audio and video, which is where providers differ). */
export type { MeetSettings }

export interface Peer {
  id: string
  cid: string
  name: string
  self: boolean
  host: boolean
  cohost: boolean
  guest: boolean                    // joined without an account
  manager: boolean
  audio: boolean
  video: boolean
  screen: boolean
  hand: number                      // 0 = hand down; otherwise the place in the queue (1 = first)
  stream: MediaStream | null        // camera and microphone (the local one has no audio, so you never hear yourself)
  screenStream: MediaStream | null
  mic: MediaStream | null           // the person's own microphone, to see when they talk (only for yourself; others are measured from `stream`)
}

export interface ChatMsg { id: string; from: string; name: string; text: string; ts: number; self: boolean; private?: boolean; to?: string; to_name?: string }
export interface PollView { id: string; q: string; options: string[]; multi: boolean; anonymous: boolean; open: boolean; counts: number[]; total: number; mine: number[]; names?: string[][] }
export interface Caption { id: string; from: string; name: string; text: string; ts: number }
export interface Waiting { id: string; name: string; reason: 'approval' | 'host'; guest?: boolean }
export type RoomSettings = MeetSettings & { locked?: boolean; captions_on?: boolean; recording_now?: { by: string; since: number; required: boolean } | null }
export interface Consents { yes: string[]; no: string[]; pending: string[] }
export type Answer = 'yes' | 'no' | null

export type CallStatus = 'connecting' | 'waiting' | 'connected' | 'reconnecting' | 'closed'
/** Why a call stopped. */
export type CallEnd = 'ended' | 'kicked' | 'blocked' | 'denied' | 'left' | 'failed' | 'full' | 'locked' | 'replaced' | 'declined'

export interface LocalTracks { audio: MediaStreamTrack | null; video: MediaStreamTrack | null; micId?: string; camId?: string }
export interface Devices { mics: MediaDeviceInfo[]; cams: MediaDeviceInfo[]; speakers: MediaDeviceInfo[]; mic: string; cam: string }

export interface Call {
  readonly code: string
  readonly name: string
  status(): CallStatus
  waitReason(): 'approval' | 'host' | null
  endReason(): CallEnd | null
  permanent(): boolean
  me(): { id: string; manager: boolean; owner: boolean; cohost: boolean }
  title(): string
  started(): number
  settings(): RoomSettings
  emojis(): string[]
  peers(): Peer[]
  spotlight(): string | null
  chat(): ChatMsg[]
  polls(): PollView[]
  waiting(): Waiting[]
  captions(): Caption[]
  /** Is the meeting being recorded, and was it me who pressed record? */
  recording(): { by: string; since: number; required: boolean; mine: boolean } | null
  /** My answer to "may we record you?" (null: not asked or not answered yet). The recorder and the host never need to answer. */
  consent(): Answer
  /** What the recorder knows about everyone's answers (managers only). */
  consents(): Consents | null
  answer(agree: boolean): void
  record(on: boolean): Promise<void>
  devices(): Promise<Devices>
  /** Called whenever anything above changes. Returns the unsubscribe function. */
  subscribe(fn: () => void): () => void
  /** Short messages for the person: a device that could not be used, "the host muted you", ... */
  onNotice(fn: (message: string) => void): () => void
  /** Someone sent a reaction. */
  onReact(fn: (from: string, emoji: string) => void): () => void
  setMic(on: boolean): Promise<void>
  setCam(on: boolean): Promise<void>
  shareScreen(): Promise<void>
  stopScreen(): void
  setDevice(kind: 'mic' | 'cam', id: string): Promise<void>
  react(emoji: string): void
  hand(up: boolean): void
  lowerHand(id: string | 'all'): void
  send(text: string, to?: string): void
  mute(id: string): void
  askUnmute(id: string): void
  camOff(id: string): void
  muteAll(allowUnmute: boolean): void
  kick(id: string, block?: boolean): void
  admit(id: string | 'all'): void
  deny(id: string): void
  lock(on: boolean): void
  captionsOn(on: boolean): void
  spotlightTo(id: string | null): void
  cohost(id: string, on: boolean): void
  poll(msg: { action: 'create'; q: string; options: string[]; multi: boolean; anonymous: boolean } | { action: 'close' | 'reopen' | 'delete'; id: string }): void
  vote(id: string, choices: number[]): void
  leave(): void
}

export class Emitter {
  private fns = new Set<() => void>()
  private notices = new Set<(m: string) => void>()
  subscribe(fn: () => void) { this.fns.add(fn); return () => { this.fns.delete(fn) } }
  onNotice(fn: (m: string) => void) { this.notices.add(fn); return () => { this.notices.delete(fn) } }
  protected changed() { this.fns.forEach((f) => f()) }
  protected notice(m: string) { this.notices.forEach((f) => f(m)) }
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

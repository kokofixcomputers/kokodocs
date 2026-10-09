import type { CPeer } from './control'
import type { Devices } from './types'

/** The audio and video part of a call: the only thing that differs between providers. The control channel (who is here, chat, ...) is the same for all. */
export interface MediaView {
  audio: boolean
  video: boolean
  screen: boolean
  stream: MediaStream | null          // camera + microphone for others; camera only for yourself
  screenStream: MediaStream | null
  mic?: MediaStream | null            // your own microphone (for "who is talking" and captions)
  net?: 'connecting' | 'connected' | 'failed'   // the link to this person: are their audio and video actually arriving?
  path?: 'direct' | 'relay' | null              // how the packets travel: straight between the browsers, or through a relay (TURN) server
}

export interface Media {
  start(): Promise<void>
  self(): MediaView
  /** How this person's audio and video look from here; null if unknown (the control channel's flags are used then). */
  peer(p: CPeer): MediaView | null
  subscribe(fn: () => void): () => void
  onNotice(fn: (m: string) => void): () => void
  setMic(on: boolean): Promise<void>
  setCam(on: boolean): Promise<void>
  shareScreen(): Promise<void>
  stopScreen(): void
  setDevice(kind: 'mic' | 'cam', id: string): Promise<void>
  devices(): Promise<Devices>
  stop(): void
  /** Try the connection to someone again from scratch. */
  retry?(peerId: string): void
  /** How loud this person is right now (0 to 1), from the call itself; null if this provider can't say. */
  level?(peerId: string): number | null
  /** A plain-text account of how this provider's connections are doing (for support). */
  report?(names: Record<string, string>): Promise<string>
}

export async function listDevices(current: { mic: string; cam: string }): Promise<Devices> {
  let all: MediaDeviceInfo[] = []
  try { all = await navigator.mediaDevices.enumerateDevices() } catch { /* none */ }
  const pick = (k: MediaDeviceKind) => all.filter((d) => d.kind === k)
  return { mics: pick('audioinput'), cams: pick('videoinput'), speakers: pick('audiooutput'), mic: current.mic, cam: current.cam }
}

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
}

export async function listDevices(current: { mic: string; cam: string }): Promise<Devices> {
  let all: MediaDeviceInfo[] = []
  try { all = await navigator.mediaDevices.enumerateDevices() } catch { /* none */ }
  const pick = (k: MediaDeviceKind) => all.filter((d) => d.kind === k)
  return { mics: pick('audioinput'), cams: pick('videoinput'), speakers: pick('audiooutput'), mic: current.mic, cam: current.cam }
}

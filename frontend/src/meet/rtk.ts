import type RealtimeKitClient from '@cloudflare/realtimekit'
import type { Control, CPeer } from './control'
import { listDevices, type Media, type MediaView } from './media'
import { deviceProblem, Emitter, type Devices, type LocalTracks } from './types'

/** Cloudflare RealtimeKit. The server created the meeting and a token for this person (Cloudflare's REST API, with the account's secret token, which
 *  never reaches the browser); this wraps Cloudflare's SDK as the audio-and-video part of a call. People are matched to the control channel by the
 *  connection id the server gave Cloudflare as their participant id. The SDK is loaded only when someone joins a RealtimeKit meeting. */

type Client = RealtimeKitClient
type Part = Client['participants']['joined'] extends Map<string, infer P> ? P : never

const stream = (...tracks: (MediaStreamTrack | undefined | null)[]) => {
  const t = tracks.filter(Boolean) as MediaStreamTrack[]
  return t.length ? new MediaStream(t) : null
}

export class RtkMedia extends Emitter implements Media {
  private c: Client | null = null
  private cache = new Map<string, { key: string; s: MediaStream | null }>()
  private watched = new Set<string>()

  constructor(private ctl: Control, private token: string, private local: LocalTracks) { super() }

  async start() {
    this.local.audio?.stop(); this.local.video?.stop()   // the SDK opens the devices itself
    const { default: Client } = await import('@cloudflare/realtimekit')
    const c = await Client.init({ authToken: this.token, defaults: { audio: !!this.local.audio, video: !!this.local.video } })
    await c.join()
    this.c = c
    const bump = () => this.changed()
    for (const e of ['audioUpdate', 'videoUpdate', 'screenShareUpdate'] as const) c.self.on(e, bump)
    const joined = c.participants.joined
    joined.on('participantJoined', (p: Part) => { this.watch(p); bump() })
    joined.on('participantLeft', (p: Part) => { this.watched.delete(p.id); this.cache.delete(p.id); bump() })
    for (const p of joined.values()) this.watch(p as Part)
    this.ctl.onForce((f) => { if (f.screen === false) this.stopScreen(); if (f.audio === false) void this.setMic(false); if (f.video === false) void this.setCam(false) })
    this.ctl.onMute(() => void this.setMic(false))
    this.ctl.onCamOff(() => void this.setCam(false))
    this.changed()
  }

  private watch(p: Part) {
    if (this.watched.has(p.id)) return
    this.watched.add(p.id)
    for (const e of ['audioUpdate', 'videoUpdate', 'screenShareUpdate'] as const) p.on(e, () => this.changed())
  }

  /** The same MediaStream object for the same tracks, so the page doesn't reattach videos on every update. */
  private mem(key: string, ...tracks: (MediaStreamTrack | undefined | null)[]): MediaStream | null {
    const k = tracks.map((t) => t?.id ?? '-').join('|')
    const e = this.cache.get(key)
    if (e && e.key === k) return e.s
    const s = stream(...tracks)
    this.cache.set(key, { key: k, s })
    return s
  }

  self(): MediaView {
    const s = this.c?.self
    if (!s) return { audio: false, video: false, screen: false, stream: null, screenStream: null, mic: null }
    return { audio: s.audioEnabled, video: s.videoEnabled, screen: s.screenShareEnabled,
      stream: s.videoEnabled ? this.mem('self:cam', s.videoTrack) : null, screenStream: s.screenShareEnabled ? this.mem('self:screen', s.screenShareTracks?.video) : null,
      mic: s.audioEnabled ? this.mem('self:mic', s.audioTrack) : null }
  }

  peer(p: CPeer): MediaView | null {
    if (!this.c) return null
    for (const d of this.c.participants.joined.values() as Iterable<Part>) {
      if (d.customParticipantId !== p.cid) continue
      return { audio: d.audioEnabled, video: d.videoEnabled, screen: d.screenShareEnabled,
        stream: this.mem(`${d.id}:cam`, d.videoEnabled ? d.videoTrack : null, d.audioEnabled ? d.audioTrack : null), screenStream: d.screenShareEnabled ? this.mem(`${d.id}:screen`, d.screenShareTracks?.video) : null }
    }
    return null
  }

  async setMic(on: boolean) { try { await (on ? this.c?.self.enableAudio() : this.c?.self.disableAudio()) } catch (e) { this.notice(deviceProblem(e, 'microphone')) } }
  async setCam(on: boolean) { try { await (on ? this.c?.self.enableVideo() : this.c?.self.disableVideo()) } catch (e) { this.notice(deviceProblem(e, 'camera')) } }
  async shareScreen() { try { await this.c?.self.enableScreenShare() } catch (e) { this.notice(deviceProblem(e, 'screen')) } }
  stopScreen() { void this.c?.self.disableScreenShare().catch(() => {}) }

  async setDevice(kind: 'mic' | 'cam', id: string) {
    const all = (await this.c?.self.getAllDevices()) ?? []
    const d = all.find((x) => x.deviceId === id && x.kind === (kind === 'mic' ? 'audioinput' : 'videoinput'))
    if (d) { try { await this.c?.self.setDevice(d as MediaDeviceInfo) } catch (e) { this.notice(deviceProblem(e, kind === 'mic' ? 'microphone' : 'camera')) } }
  }

  async devices(): Promise<Devices> { return listDevices({ mic: '', cam: '' }) }

  stop() { void this.c?.leave().catch(() => {}) }
}

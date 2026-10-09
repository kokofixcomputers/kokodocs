import type { Room as LkRoom, RemoteParticipant } from 'livekit-client'
import type { Control, CPeer } from './control'
import { listDevices, type Media, type MediaView } from './media'
import { deviceProblem, Emitter, type Devices, type LocalTracks } from './types'

/** LiveKit (open source; self-hosted or LiveKit Cloud). The server signed a join token for this person (it holds the key and secret); LiveKit's SDK connects
 *  to the address from the settings. Like the other SFUs: one upload, however many people are in the call. People are matched to the control channel by
 *  the connection id the server used as their LiveKit identity. The SDK is loaded only when someone joins a LiveKit meeting. */

type Lk = typeof import('livekit-client')
const stream = (...tracks: (MediaStreamTrack | undefined | null)[]) => {
  const t = tracks.filter(Boolean) as MediaStreamTrack[]
  return t.length ? new MediaStream(t) : null
}

export class LivekitMedia extends Emitter implements Media {
  private lk!: Lk
  private room: LkRoom | null = null
  private cache = new Map<string, { key: string; s: MediaStream | null }>()
  private micId: string
  private camId: string
  private error = ''

  constructor(private ctl: Control, private url: string, private token: string, private local: LocalTracks) {
    super()
    this.micId = local.micId ?? ''; this.camId = local.camId ?? ''
  }

  async start() {
    this.local.audio?.stop(); this.local.video?.stop()   // the SDK opens the devices itself
    const lk = this.lk = await import('livekit-client')
    const room = this.room = new lk.Room({ adaptiveStream: true, dynacast: true })
    const bump = () => this.changed()
    for (const e of [lk.RoomEvent.TrackSubscribed, lk.RoomEvent.TrackUnsubscribed, lk.RoomEvent.TrackMuted, lk.RoomEvent.TrackUnmuted, lk.RoomEvent.LocalTrackPublished,
      lk.RoomEvent.LocalTrackUnpublished, lk.RoomEvent.ParticipantConnected, lk.RoomEvent.ParticipantDisconnected, lk.RoomEvent.ConnectionStateChanged,
      lk.RoomEvent.Reconnecting, lk.RoomEvent.Reconnected, lk.RoomEvent.Disconnected]) (room as unknown as { on(e: string, f: () => void): void }).on(e as string, bump)
    await room.connect(this.url, this.token)
    this.ctl.onForce((f) => { if (f.screen === false) this.stopScreen(); if (f.audio === false) void this.setMic(false); if (f.video === false) void this.setCam(false) })
    this.ctl.onMute(() => void this.setMic(false))
    this.ctl.onCamOff(() => void this.setCam(false))
    if (this.local.audio) await this.setMic(true)
    if (this.local.video) await this.setCam(true)
    this.changed()
  }

  /** the same MediaStream object for the same tracks, so the page doesn't reattach videos on every update */
  private mem(key: string, ...tracks: (MediaStreamTrack | undefined | null)[]): MediaStream | null {
    const k = tracks.map((t) => t?.id ?? '-').join('|')
    const e = this.cache.get(key)
    if (e && e.key === k) return e.s
    const s = stream(...tracks)
    this.cache.set(key, { key: k, s })
    return s
  }

  private tr(p: { getTrackPublication(s: any): any } | undefined, source: 'microphone' | 'camera' | 'screen_share'): MediaStreamTrack | null {
    const pub = p?.getTrackPublication(source)
    return pub && !pub.isMuted ? pub.track?.mediaStreamTrack ?? null : null
  }

  self(): MediaView {
    const lp = this.room?.localParticipant
    if (!lp) return { audio: false, video: false, screen: false, stream: null, screenStream: null, mic: null }
    const a = this.tr(lp, 'microphone'), v = this.tr(lp, 'camera'), s = this.tr(lp, 'screen_share')
    return { audio: !!a, video: !!v, screen: !!s, stream: v ? this.mem('self:cam', v) : null, screenStream: s ? this.mem('self:screen', s) : null, mic: a ? this.mem('self:mic', a) : null }
  }

  private remote(p: CPeer): RemoteParticipant | undefined { return this.room?.remoteParticipants.get(p.cid) }

  peer(p: CPeer): MediaView | null {
    if (!this.room) return null
    const d = this.remote(p)
    const a = this.tr(d, 'microphone'), v = this.tr(d, 'camera'), s = this.tr(d, 'screen_share')
    const st = this.room.state
    const net = st === 'connected' ? (d ? 'connected' : 'connecting') : st === 'disconnected' ? 'failed' : 'connecting'
    return { audio: !!a, video: !!v, screen: !!s, stream: this.mem(`${p.cid}:cam`, v, a), screenStream: s ? this.mem(`${p.cid}:screen`, s) : null, net, path: null }
  }

  level(id: string): number | null {
    const cid = this.ctl.peers.get(id)?.cid
    const d = cid ? this.room?.remoteParticipants.get(cid) : undefined
    return d ? d.audioLevel : null
  }

  async report(names: Record<string, string>): Promise<string> {
    const r = this.room
    const out = [`Provider: LiveKit, ${this.url}`, `Connection: ${r?.state ?? 'not started'}`]
    if (this.error) out.push(`Last error: ${this.error}`)
    for (const d of r?.remoteParticipants.values() ?? []) {
      const who = [...this.ctl.peers.values()].find((p) => p.cid === d.identity)
      out.push(`${who ? names[who.id] ?? who.name : d.identity}: ${d.trackPublications.size} tracks, ${d.connectionQuality}`)
    }
    return out.join('\n')
  }

  async setMic(on: boolean) { try { await this.room?.localParticipant.setMicrophoneEnabled(on, on && this.micId ? { deviceId: { exact: this.micId } } : undefined) } catch (e) { this.error = (e as Error).message; this.notice(deviceProblem(e, 'microphone')) } this.changed() }
  async setCam(on: boolean) { try { await this.room?.localParticipant.setCameraEnabled(on, on && this.camId ? { deviceId: { exact: this.camId } } : undefined) } catch (e) { this.error = (e as Error).message; this.notice(deviceProblem(e, 'camera')) } this.changed() }
  async shareScreen() { try { await this.room?.localParticipant.setScreenShareEnabled(true) } catch (e) { this.notice(deviceProblem(e, 'screen')) } this.changed() }
  stopScreen() { void this.room?.localParticipant.setScreenShareEnabled(false).then(() => this.changed()).catch(() => {}) }

  async setDevice(kind: 'mic' | 'cam', id: string) {
    if (kind === 'mic') this.micId = id; else this.camId = id
    try { await this.room?.switchActiveDevice(kind === 'mic' ? 'audioinput' : 'videoinput', id) } catch (e) { this.notice(deviceProblem(e, kind === 'mic' ? 'microphone' : 'camera')) }
  }

  async devices(): Promise<Devices> { return listDevices({ mic: this.micId, cam: this.camId }) }

  stop() { void this.room?.disconnect().catch(() => {}) }
}

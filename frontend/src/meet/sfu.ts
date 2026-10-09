import { api } from '../api'
import type { Control, CPeer } from './control'
import { listDevices, type Media, type MediaView } from './media'
import { deviceProblem, Emitter, type Devices, type LocalTracks } from './types'

/** Cloudflare's SFU, and Metered's Global Cloud SFU (the same design with a different API: see `dialect`). Each person keeps ONE connection to Cloudflare: it sends their audio, camera and screen once, and receives everyone else's. That is
 *  one upload however many people are in the call (a mesh uploads a copy to every person). This server only relays the calls to Cloudflare's session API
 *  (it holds the app secret); who is in which Cloudflare session is announced over the meeting's control channel.
 *
 *  Like the mesh, there are three fixed sending slots (microphone, camera, screen) created once, so turning things on and off only swaps the track in a
 *  slot and nothing is renegotiated. A slot with nothing to send carries a silent or black placeholder, and the control channel's flags say whether to show it. */

const NAMES = ['mic', 'cam', 'screen'] as const
type Kind = (typeof NAMES)[number]
type Ids = Partial<Record<Kind, string>>
interface Remote { sid: string; tracks: Partial<Record<Kind, MediaStreamTrack>>; stream: MediaStream | null; screenStream: MediaStream | null; since: number; mids: Partial<Record<Kind, RTCRtpTransceiver>> }

const STUCK_MS = 15000

function silence(): MediaStreamTrack {
  const ctx = new AudioContext(), d = ctx.createMediaStreamDestination()
  const t = d.stream.getAudioTracks()[0]; t.enabled = true
  return t
}
function black(): MediaStreamTrack {
  const c = document.createElement('canvas'); c.width = 160; c.height = 90
  const g = c.getContext('2d')!; let n = 0
  const draw = () => { g.fillStyle = '#000'; g.fillRect(0, 0, 160, 90); g.fillStyle = n++ % 2 ? '#010101' : '#000'; g.fillRect(0, 0, 1, 1) }
  draw(); const t = c.captureStream(1).getVideoTracks()[0]
  window.setInterval(draw, 1000)   // a frame every second keeps the sending side alive
  return t
}

export class SfuMedia extends Emitter implements Media {
  private pc: RTCPeerConnection
  private slots: RTCRtpTransceiver[] = []
  private audio: MediaStreamTrack | null
  private video: MediaStreamTrack | null
  private screenTrack: MediaStreamTrack | null = null
  private screenMedia: MediaStream | null = null
  private ph: Record<Kind, MediaStreamTrack>
  private selfStream: MediaStream | null = null
  private selfScreen: MediaStream | null = null
  private selfMic: MediaStream | null = null
  private micId: string
  private camId: string
  private sid = ''
  private ready!: () => void
  private ok: Promise<void> = new Promise((r) => { this.ready = r })
  private ids: Ids = {}   // Metered names tracks by id, so ours are announced
  private known = new Set<string>()   // connection lines (mids) already assigned, Metered side
  private remotes = new Map<string, Remote>()
  private byMid = new Map<string, { peer: string; kind: Kind }>()
  private chain: Promise<void> = Promise.resolve()   // pulling tracks changes the one connection, so one at a time
  private stopped = false
  private error = ''

  constructor(private ctl: Control, private code: string, private jt: string, ice: RTCIceServer[], local: LocalTracks, private dialect: 'cloudflare' | 'metered' = 'cloudflare') {
    super()
    this.audio = local.audio; this.video = local.video
    this.micId = local.micId ?? ''; this.camId = local.camId ?? ''
    this.pc = new RTCPeerConnection({ iceServers: ice, bundlePolicy: 'max-bundle' })
    this.ph = { mic: silence(), cam: black(), screen: black() }
    this.rebuild()
  }

  async start() {
    const pc = this.pc
    this.ctl.onSignal((from, data) => void this.onSignal(from, data))
    this.ctl.onLeft((id) => { this.remotes.delete(id); this.changed() })
    this.ctl.onForce((f) => { if (f.screen === false) this.stopScreen(); if (f.audio === false) void this.setMic(false); if (f.video === false) void this.setCam(false) })
    this.ctl.onMute(() => void this.setMic(false))
    this.ctl.onCamOff(() => void this.setCam(false))
    this.ctl.onWelcome(() => this.announce(this.ctl.welcomePeers, false))   // the control channel reconnected: say again where we are
    pc.ontrack = (e) => {
      const m = e.transceiver.mid ? this.byMid.get(e.transceiver.mid) : undefined
      const r = m && this.remotes.get(m.peer)
      if (!m || !r) return
      r.tracks[m.kind] = e.track; r.mids[m.kind] = e.transceiver
      if (m.kind === 'screen') r.screenStream = new MediaStream([e.track])
      else r.stream = new MediaStream([r.tracks.mic, r.tracks.cam].filter(Boolean) as MediaStreamTrack[])
      this.changed()
    }
    pc.onconnectionstatechange = () => this.changed()
    this.slots = [
      pc.addTransceiver(this.audio ?? this.ph.mic, { direction: 'sendonly' }),
      pc.addTransceiver(this.video ?? this.ph.cam, { direction: 'sendonly' }),
      pc.addTransceiver(this.ph.screen, { direction: 'sendonly' }),
    ]
    await pc.setLocalDescription(await pc.createOffer())
    if (this.dialect === 'metered') {
      // the session starts with this offer; the tracks are then published by id (and a new offer)
      const first = await api.meetSfu<{ sessionId: string; sessionDescription: RTCSessionDescriptionInit }>(this.code, this.jt, 'session', 'POST', { sessionDescription: { type: 'offer', sdp: pc.localDescription!.sdp } })
      this.sid = first.sessionId
      await pc.setRemoteDescription(first.sessionDescription)
      this.slots.forEach((t, i) => { this.ids[NAMES[i]] = t.sender.track?.id })
      await pc.setLocalDescription(await pc.createOffer())
      const r = await api.meetSfu<{ sessionDescription: RTCSessionDescriptionInit }>(this.code, this.jt, `${this.sid}/tracks`, 'POST', {
        op: 'publish', sessionDescription: { type: 'offer', sdp: pc.localDescription!.sdp },
        tracks: this.slots.map((t, i) => ({ trackId: t.sender.track?.id, mid: t.mid, customTrackName: NAMES[i] })),
      })
      await pc.setRemoteDescription(r.sessionDescription)
      this.slots.forEach((t) => { if (t.mid) this.known.add(t.mid) })
    } else {
      const { sessionId } = await api.meetSfu<{ sessionId: string }>(this.code, this.jt, 'session')
      this.sid = sessionId
      const r = await api.meetSfu<{ sessionDescription: RTCSessionDescriptionInit }>(this.code, this.jt, `${sessionId}/tracks`, 'POST', {
        sessionDescription: { type: 'offer', sdp: pc.localDescription!.sdp },
        tracks: this.slots.map((t, i) => ({ location: 'local', mid: t.mid, trackName: NAMES[i] })),
      })
      await pc.setRemoteDescription(r.sessionDescription)
    }
    this.ready()
    this.announce(this.ctl.welcomePeers, false)
  }

  /** tell people which Cloudflare session carries us (ack: this answers someone who told us theirs) */
  private announce(ids: string[], ack: boolean) {
    for (const id of ids) if (this.ctl.peers.has(id)) this.ctl.send({ t: 'signal', to: id, data: { sfu: { sid: this.sid, ack, ids: this.ids } } })
  }

  private async onSignal(from: string, data: any) {
    const s = data?.sfu
    if (this.stopped || !s?.sid || !this.ctl.peers.has(from)) return
    await this.ok
    if (this.remotes.get(from)?.sid !== s.sid) this.pull(from, String(s.sid), (s.ids ?? {}) as Ids)
    if (!s.ack) this.announce([from], true)
  }

  private pull(peer: string, sid: string, ids: Ids) {
    this.remotes.set(peer, { sid, tracks: {}, stream: null, screenStream: null, since: Date.now(), mids: {} })
    window.setTimeout(() => { if (!this.stopped) this.changed() }, STUCK_MS + 100)
    this.chain = this.chain.then(async () => {
      if (this.stopped) return
      try {
        if (this.dialect === 'metered') {
          // one track at a time: the connection line each one arrives on is then the new one in the server's offer
          for (const kind of NAMES) {
            if (!ids[kind]) continue
            const r = await api.meetSfu<{ immediateRenegotiationRequired?: boolean; sessionDescription?: RTCSessionDescriptionInit }>(this.code, this.jt, `${this.sid}/tracks`, 'POST',
              { op: 'subscribe', tracks: [{ remoteSessionId: sid, remoteTrackId: ids[kind] }] })
            if (r.sessionDescription && r.immediateRenegotiationRequired !== false) {
              for (const m of r.sessionDescription.sdp!.matchAll(/^a=mid:(\S+)/gm)) if (!this.known.has(m[1])) { this.known.add(m[1]); this.byMid.set(m[1], { peer, kind }) }
              await this.pc.setRemoteDescription(r.sessionDescription)
              await this.pc.setLocalDescription(await this.pc.createAnswer())
              await api.meetSfu(this.code, this.jt, `${this.sid}/renegotiate`, 'PUT', { sessionDescription: { type: 'answer', sdp: this.pc.localDescription!.sdp } })
            }
          }
        } else {
          const r = await api.meetSfu<{ requiresImmediateRenegotiation?: boolean; sessionDescription?: RTCSessionDescriptionInit; tracks?: { mid?: string; trackName?: string; errorCode?: string }[] }>(
            this.code, this.jt, `${this.sid}/tracks`, 'POST', { tracks: NAMES.map((n) => ({ location: 'remote', sessionId: sid, trackName: n })) })
          for (const t of r.tracks ?? []) if (t.mid && !t.errorCode && NAMES.includes(t.trackName as Kind)) this.byMid.set(t.mid, { peer, kind: t.trackName as Kind })
          if (r.requiresImmediateRenegotiation && r.sessionDescription) {
            await this.pc.setRemoteDescription(r.sessionDescription)
            await this.pc.setLocalDescription(await this.pc.createAnswer())
            await api.meetSfu(this.code, this.jt, `${this.sid}/renegotiate`, 'PUT', { sessionDescription: { type: 'answer', sdp: this.pc.localDescription!.sdp } })
          }
        }
      } catch (e) { this.error = (e as Error).message; this.remotes.delete(peer); this.changed() }
    })
  }

  private rebuild() {
    this.selfStream = this.video ? new MediaStream([this.video]) : null
    this.selfScreen = this.screenTrack ? new MediaStream([this.screenTrack]) : null
    this.selfMic = this.audio ? new MediaStream([this.audio]) : null
  }

  private push() {
    void this.slots[0]?.sender.replaceTrack(this.audio ?? this.ph.mic).catch(() => {})
    void this.slots[1]?.sender.replaceTrack(this.video ?? this.ph.cam).catch(() => {})
    void this.slots[2]?.sender.replaceTrack(this.screenTrack ?? this.ph.screen).catch(() => {})
    this.rebuild(); this.changed()
  }

  self(): MediaView { return { audio: !!this.audio, video: !!this.video, screen: !!this.screenTrack, stream: this.selfStream, screenStream: this.selfScreen, mic: this.selfMic } }

  peer(p: CPeer): MediaView | null {
    const r = this.remotes.get(p.id)
    const up = this.pc.connectionState
    const net = up === 'failed' || up === 'closed' ? 'failed' : r?.stream || r?.screenStream ? 'connected' : r && Date.now() - r.since > STUCK_MS ? 'failed' : 'connecting'
    return { audio: p.audio, video: p.video, screen: p.screen, stream: r?.stream ?? null, screenStream: r?.screenStream ?? null, net, path: null }
  }

  level(id: string): number | null {
    const rx = this.remotes.get(id)?.mids.mic?.receiver
    const s = rx?.getSynchronizationSources?.()[0]
    return s?.audioLevel ?? null
  }

  async report(names: Record<string, string>): Promise<string> {
    const out = [`Provider: ${this.dialect === 'metered' ? 'Metered' : 'Cloudflare'} SFU, one connection (${this.pc.connectionState}, ICE ${this.pc.iceConnectionState}), session ${this.sid || 'none'}`]
    if (this.error) out.push(`Last error: ${this.error}`)
    const stats = await this.pc.getStats().catch(() => null)
    stats?.forEach((s: any) => { if (s.type === 'transport' && s.selectedCandidatePairId) { const p = (stats as any).get(s.selectedCandidatePairId); if (p) out.push(`Selected path: ${p.currentRoundTripTime ? Math.round(p.currentRoundTripTime * 1000) + ' ms' : ''}, sent ${p.bytesSent ?? 0} B, received ${p.bytesReceived ?? 0} B`) } })
    for (const [id, r] of this.remotes) out.push(`${names[id] ?? id}: session ${r.sid}, ${Object.keys(r.tracks).join(', ') || 'no tracks yet'}`)
    return out.join('\n')
  }

  private audioConstraint(): MediaTrackConstraints { return { echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...(this.micId ? { deviceId: { exact: this.micId } } : {}) } }
  private videoConstraint(): MediaTrackConstraints { return { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, ...(this.camId ? { deviceId: { exact: this.camId } } : {}) } }

  async setMic(on: boolean) {
    if (!on) { this.audio?.stop(); this.audio = null; this.push(); return }
    if (this.audio) return
    try {
      this.audio = (await navigator.mediaDevices.getUserMedia({ audio: this.audioConstraint() })).getAudioTracks()[0]
      this.audio.onended = () => { if (this.audio) { this.audio = null; this.push() } }
      this.push()
    } catch (e) { this.notice(deviceProblem(e, 'microphone')) }
  }

  async setCam(on: boolean) {
    if (!on) { this.video?.stop(); this.video = null; this.push(); return }
    if (this.video) return
    try {
      this.video = (await navigator.mediaDevices.getUserMedia({ video: this.videoConstraint() })).getVideoTracks()[0]
      this.video.onended = () => { if (this.video) { this.video = null; this.push() } }
      this.push()
    } catch (e) { this.notice(deviceProblem(e, 'camera')) }
  }

  async setDevice(kind: 'mic' | 'cam', id: string) {
    if (kind === 'mic') { this.micId = id; if (this.audio) { this.audio.stop(); this.audio = null; await this.setMic(true) } }
    else { this.camId = id; if (this.video) { this.video.stop(); this.video = null; await this.setCam(true) } }
  }

  async devices(): Promise<Devices> { return listDevices({ mic: this.audio?.getSettings().deviceId ?? this.micId, cam: this.video?.getSettings().deviceId ?? this.camId }) }

  async shareScreen() {
    if (this.screenTrack) return
    if (!navigator.mediaDevices.getDisplayMedia) { this.notice("This browser can't share the screen."); return }
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15 } }, audio: false })
      this.screenMedia = s; this.screenTrack = s.getVideoTracks()[0]
      this.screenTrack.onended = () => this.stopScreen()
      this.push()
    } catch (e) { this.notice(deviceProblem(e, 'screen')) }
  }

  stopScreen() {
    this.screenMedia?.getTracks().forEach((t) => t.stop())
    this.screenMedia = null; this.screenTrack = null
    this.push()
  }

  stop() {
    this.stopped = true
    this.pc.ontrack = this.pc.onconnectionstatechange = null
    this.pc.close()
    this.audio?.stop(); this.video?.stop(); this.screenMedia?.getTracks().forEach((t) => t.stop())
    this.audio = this.video = this.screenTrack = null
    Object.values(this.ph).forEach((t) => t.stop())
    this.rebuild()
  }
}

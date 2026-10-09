import type { Control, CPeer } from './control'
import { listDevices, type Media, type MediaView } from './media'
import { deviceProblem, Emitter, type Devices, type LocalTracks } from './types'

/** Browsers connected straight to each other (WebRTC). The control channel carries the offers, answers and network candidates between them; STUN and
 *  TURN servers (Cloudflare's, or yours) let people behind strict networks connect too.
 *
 *  Every connection has the same three media slots, in the same order: 0 microphone, 1 camera, 2 screen. They are created once, by the person who
 *  joined later (who is also the one who makes the offer, so the two sides never offer at the same moment). Turning things on and off only swaps what
 *  each slot sends, so nothing is ever renegotiated and a call never glitches when someone turns on their camera. */

interface Link {
  id: string
  pc: RTCPeerConnection
  initiator: boolean
  slots: RTCRtpTransceiver[]
  media: MediaStreamTrack[]     // microphone, camera
  queued: RTCIceCandidateInit[]
  stream: MediaStream | null
  screenStream: MediaStream | null
}

const SLOT = { mic: 0, cam: 1, screen: 2 }

export class MeshMedia extends Emitter implements Media {
  private links = new Map<string, Link>()
  private audio: MediaStreamTrack | null
  private video: MediaStreamTrack | null
  private screenTrack: MediaStreamTrack | null = null
  private screenMedia: MediaStream | null = null
  private selfStream: MediaStream | null = null
  private selfScreen: MediaStream | null = null
  private selfMic: MediaStream | null = null
  private micId: string
  private camId: string
  private stopped = false

  constructor(private ctl: Control, private ice: RTCIceServer[], local: LocalTracks) {
    super()
    this.audio = local.audio; this.video = local.video
    this.micId = local.micId ?? ''; this.camId = local.camId ?? ''
    this.rebuild()
  }

  async start() {
    this.ctl.onSignal((from, data) => void this.onSignal(from, data))
    this.ctl.onLeft((id) => { this.closeLink(id); this.changed() })
    this.ctl.onForce(() => this.stopScreen())
    this.ctl.onMute(() => void this.setMic(false))
    this.ctl.onCamOff(() => void this.setCam(false))
    this.ctl.onWelcome(() => { this.dropLinks(); this.callEveryone() })   // the control channel reconnected: start over with whoever is here
    this.callEveryone()
  }

  private callEveryone() { for (const id of this.ctl.welcomePeers) if (this.ctl.peers.has(id)) this.link(id, true) }

  private rebuild() {
    this.selfStream = this.video ? new MediaStream([this.video]) : null
    this.selfScreen = this.screenTrack ? new MediaStream([this.screenTrack]) : null
    this.selfMic = this.audio ? new MediaStream([this.audio]) : null
  }

  self(): MediaView { return { audio: !!this.audio, video: !!this.video, screen: !!this.screenTrack, stream: this.selfStream, screenStream: this.selfScreen, mic: this.selfMic } }
  peer(p: CPeer): MediaView | null {
    const l = this.links.get(p.id)
    return { audio: p.audio, video: p.video, screen: p.screen, stream: l?.stream ?? null, screenStream: l?.screenStream ?? null }
  }

  // ---- connections to each other person
  private link(id: string, initiator: boolean): Link {
    const existing = this.links.get(id)
    if (existing) return existing
    const pc = new RTCPeerConnection({ iceServers: this.ice })
    const l: Link = { id, pc, initiator, slots: [], media: [], queued: [], stream: null, screenStream: null }
    this.links.set(id, l)
    if (initiator) {
      l.slots = [pc.addTransceiver('audio', { direction: 'sendrecv' }), pc.addTransceiver('video', { direction: 'sendrecv' }), pc.addTransceiver('video', { direction: 'sendrecv' })]
      this.fill(l)
    }
    pc.onicecandidate = (e) => { if (e.candidate) this.ctl.send({ t: 'signal', to: id, data: { candidate: e.candidate.toJSON() } }) }
    pc.ontrack = (e) => {
      const i = l.slots.length ? l.slots.indexOf(e.transceiver) : pc.getTransceivers().indexOf(e.transceiver)
      if (i === SLOT.screen) l.screenStream = new MediaStream([e.track])
      else if (i === SLOT.mic || i === SLOT.cam) { l.media[i] = e.track; l.stream = new MediaStream(l.media.filter(Boolean)) }
      this.changed()
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' && initiator && this.links.get(id) === l) void this.offer(l, true)
      this.changed()
    }
    if (initiator) void this.offer(l)
    return l
  }

  private fill(l: Link) {
    void l.slots[SLOT.mic]?.sender.replaceTrack(this.audio).catch(() => {})
    void l.slots[SLOT.cam]?.sender.replaceTrack(this.video).catch(() => {})
    void l.slots[SLOT.screen]?.sender.replaceTrack(this.screenTrack).catch(() => {})
  }

  private async offer(l: Link, restart = false) {
    try {
      await l.pc.setLocalDescription(await l.pc.createOffer(restart ? { iceRestart: true } : undefined))
      this.ctl.send({ t: 'signal', to: l.id, data: { type: 'offer', sdp: l.pc.localDescription?.sdp } })
    } catch { /* the connection is gone; the next state change cleans up */ }
  }

  private async onSignal(from: string, data: any) {
    if (this.stopped || !this.ctl.peers.has(from)) return
    const l = this.link(from, false)
    try {
      if (data.type === 'offer') {
        await l.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp })
        if (!l.slots.length) {
          l.slots = l.pc.getTransceivers().slice(0, 3)
          for (const t of l.slots) t.direction = 'sendrecv'
          this.fill(l)
        }
        await l.pc.setLocalDescription(await l.pc.createAnswer())
        this.ctl.send({ t: 'signal', to: from, data: { type: 'answer', sdp: l.pc.localDescription?.sdp } })
        await this.flush(l)
      } else if (data.type === 'answer') {
        await l.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp })
        await this.flush(l)
      } else if (data.candidate) {
        if (l.pc.remoteDescription) await l.pc.addIceCandidate(data.candidate).catch(() => {})
        else l.queued.push(data.candidate)
      }
    } catch { /* a stale or malformed message */ }
  }

  private async flush(l: Link) { for (const c of l.queued.splice(0)) await l.pc.addIceCandidate(c).catch(() => {}) }

  private closeLink(id: string) {
    const l = this.links.get(id)
    if (!l) return
    this.links.delete(id)
    l.pc.ontrack = l.pc.onicecandidate = l.pc.onconnectionstatechange = null
    l.pc.close()
  }

  private dropLinks() { for (const id of [...this.links.keys()]) this.closeLink(id) }

  // ---- what the person controls
  private push() { for (const l of this.links.values()) this.fill(l); this.rebuild(); this.changed() }

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

  async devices(): Promise<Devices> {
    return listDevices({ mic: this.audio?.getSettings().deviceId ?? this.micId, cam: this.video?.getSettings().deviceId ?? this.camId })
  }

  async shareScreen() {
    if (this.screenTrack) return
    if (!navigator.mediaDevices.getDisplayMedia) { this.notice("This browser can't share the screen."); return }
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15 } }, audio: false })
      this.screenMedia = s
      this.screenTrack = s.getVideoTracks()[0]
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
    this.dropLinks()
    this.audio?.stop(); this.video?.stop(); this.screenMedia?.getTracks().forEach((t) => t.stop())
    this.audio = this.video = this.screenTrack = null
    this.rebuild()
  }
}

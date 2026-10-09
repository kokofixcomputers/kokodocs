import { getToken, type MeetJoin } from '../api'
import { deviceProblem, Emitter, type Call, type CallEnd, type CallStatus, type ChatMsg, type LocalTracks, type Peer } from './types'

/** Browsers connected straight to each other (WebRTC). The server only introduces them: it relays the offers, answers and network candidates
 *  over a WebSocket, and hands out STUN/TURN servers (Cloudflare's, or yours) so people behind strict networks can still connect.
 *
 *  Every connection has the same three media slots, in the same order: 0 microphone, 1 camera, 2 screen. They are created once, by the person
 *  who joined later (who is also the one who makes the offer, so the two sides never offer at the same moment). Turning things on and off only
 *  swaps what each slot sends, so nothing is ever renegotiated and a call never glitches when someone turns on their camera. */

interface Info { name: string; host: boolean; audio: boolean; video: boolean; screen: boolean }
interface Link {
  id: string
  pc: RTCPeerConnection
  initiator: boolean
  slots: RTCRtpTransceiver[]
  media: MediaStreamTrack[]     // microphone, camera
  screen: MediaStreamTrack | null
  queued: RTCIceCandidateInit[]
  stream: MediaStream | null
  screenStream: MediaStream | null
}

const SLOT = { mic: 0, cam: 1, screen: 2 }
const RETRY = [1000, 2000, 4000, 8000, 8000, 15000]

export class MeshCall extends Emitter implements Call {
  selfId = ''
  isHost = false
  private ws: WebSocket | null = null
  private state: CallStatus = 'connecting'
  private end: CallEnd | null = null
  private info = new Map<string, Info>()
  private links = new Map<string, Link>()
  private messages: ChatMsg[] = []
  private ice: RTCIceServer[]
  private audio: MediaStreamTrack | null
  private video: MediaStreamTrack | null
  private screenTrack: MediaStreamTrack | null = null
  private screenMedia: MediaStream | null = null
  private selfStream: MediaStream | null = null
  private selfScreen: MediaStream | null = null
  private retries = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private ping: ReturnType<typeof setInterval> | null = null
  private done = false

  constructor(private code: string, private join: MeetJoin, local: LocalTracks, private signedIn: boolean) {
    super()
    this.ice = join.ice_servers ?? []
    this.audio = local.audio
    this.video = local.video
    this.isHost = join.host
    this.rebuildSelf()
    this.connect()
  }

  get canModerate() { return this.isHost }
  status() { return this.state }
  endReason() { return this.end }
  chat() { return this.messages }

  // ---- what the page shows
  peers(): Peer[] {
    const me: Peer = { id: this.selfId || 'self', name: this.join.name, self: true, host: this.isHost, audio: !!this.audio, video: !!this.video,
      screen: !!this.screenTrack, stream: this.selfStream, screenStream: this.selfScreen }
    const others = [...this.info].map(([id, i]) => {
      const l = this.links.get(id)
      return { id, name: i.name, self: false, host: i.host, audio: i.audio, video: i.video, screen: i.screen, stream: l?.stream ?? null, screenStream: l?.screenStream ?? null } as Peer
    })
    return [me, ...others]
  }

  private rebuildSelf() {
    const t = [this.video].filter(Boolean) as MediaStreamTrack[]   // no microphone in your own tile: you never hear yourself
    this.selfStream = t.length ? new MediaStream(t) : null
    this.selfScreen = this.screenTrack ? new MediaStream([this.screenTrack]) : null
  }

  // ---- the signalling socket
  private connect() {
    if (this.done) return
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const q = new URLSearchParams()
    const t = this.signedIn ? getToken() : null
    if (t) q.set('token', t); else q.set('name', this.join.name)
    const ws = new WebSocket(`${proto}://${location.host}/ws/meet/${encodeURIComponent(this.code)}?${q}`)
    this.ws = ws
    ws.onmessage = (e) => { try { this.onMessage(JSON.parse(e.data)) } catch { /* ignore malformed */ } }
    ws.onclose = (e) => {
      if (ws !== this.ws || this.done) return
      if (this.ping) clearInterval(this.ping)
      this.dropLinks()
      if (e.code === 4410) return this.finish('ended')
      if (e.code === 4411) return this.finish('kicked')
      if (e.code === 4409) return this.finish('full')
      if (e.code === 4403) return this.finish('failed')
      this.state = 'reconnecting'; this.changed()
      if (this.retries >= RETRY.length) return this.finish('failed')
      this.timer = setTimeout(() => this.connect(), RETRY[this.retries++])
    }
    this.ping = setInterval(() => { if (ws.readyState === 1) ws.send('{"t":"ping"}') }, 25000)
  }

  private send_(m: object) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m)) }

  private onMessage(m: any) {
    switch (m.t) {
      case 'welcome': {
        this.selfId = m.id; this.isHost = !!m.host; this.state = 'connected'; this.retries = 0
        this.info.clear()
        for (const p of m.peers as ({ id: string } & Info)[]) this.info.set(p.id, p)
        if (!this.messages.length) this.messages = (m.chat ?? []).map((c: any) => this.toChat(c))
        this.sendState()
        for (const p of m.peers) this.link(p.id, true)   // we are the newcomer: we call everyone already here
        this.changed(); break
      }
      case 'joined': this.info.set(m.peer.id, m.peer); this.changed(); break
      case 'left': this.info.delete(m.id); this.closeLink(m.id); this.changed(); break
      case 'state': { const i = this.info.get(m.id); if (i) { i.audio = !!m.audio; i.video = !!m.video; i.screen = !!m.screen; this.changed() } break }
      case 'signal': void this.onSignal(m.from, m.data); break
      case 'chat': this.messages = [...this.messages, this.toChat(m)].slice(-200); this.changed(); break
      case 'mute': void this.setMic(false); this.problem('The host muted you.'); break
      case 'kicked': this.finish('kicked'); break
      case 'ended': this.finish('ended'); break
      case 'full': this.finish('full'); break
    }
  }

  private toChat(c: any): ChatMsg { return { id: c.id, from: c.from, name: c.name, text: c.text, ts: c.ts, self: c.from === this.selfId } }

  // ---- connections to each other person
  private link(id: string, initiator: boolean): Link {
    const existing = this.links.get(id)
    if (existing) return existing
    const pc = new RTCPeerConnection({ iceServers: this.ice })
    const l: Link = { id, pc, initiator, slots: [], media: [], screen: null, queued: [], stream: null, screenStream: null }
    this.links.set(id, l)
    if (initiator) {
      l.slots = [pc.addTransceiver('audio', { direction: 'sendrecv' }), pc.addTransceiver('video', { direction: 'sendrecv' }), pc.addTransceiver('video', { direction: 'sendrecv' })]
      this.fill(l)
    }
    pc.onicecandidate = (e) => { if (e.candidate) this.send_({ t: 'signal', to: id, data: { candidate: e.candidate.toJSON() } }) }
    pc.ontrack = (e) => {
      const i = l.slots.length ? l.slots.indexOf(e.transceiver) : pc.getTransceivers().indexOf(e.transceiver)
      if (i === SLOT.screen) { l.screen = e.track; l.screenStream = new MediaStream([e.track]) }
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
      const o = await l.pc.createOffer(restart ? { iceRestart: true } : undefined)
      await l.pc.setLocalDescription(o)
      this.send_({ t: 'signal', to: l.id, data: { type: 'offer', sdp: l.pc.localDescription?.sdp } })
    } catch { /* the connection is gone; the next state change will clean up */ }
  }

  private async onSignal(from: string, data: any) {
    if (!this.info.has(from)) return
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
        this.send_({ t: 'signal', to: from, data: { type: 'answer', sdp: l.pc.localDescription?.sdp } })
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

  private async flush(l: Link) {
    for (const c of l.queued.splice(0)) await l.pc.addIceCandidate(c).catch(() => {})
  }

  private closeLink(id: string) {
    const l = this.links.get(id)
    if (!l) return
    this.links.delete(id)
    l.pc.ontrack = l.pc.onicecandidate = l.pc.onconnectionstatechange = null
    l.pc.close()
  }

  private dropLinks() { for (const id of [...this.links.keys()]) this.closeLink(id) }

  // ---- what the person controls
  private sendState() { this.send_({ t: 'state', audio: !!this.audio, video: !!this.video, screen: !!this.screenTrack }) }
  private pushTracks() { for (const l of this.links.values()) this.fill(l); this.rebuildSelf(); this.sendState(); this.changed() }

  async setMic(on: boolean) {
    if (!on) { this.audio?.stop(); this.audio = null; this.pushTracks(); return }
    if (this.audio) return
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      this.audio = s.getAudioTracks()[0]
      this.audio.onended = () => { if (this.audio) { this.audio = null; this.pushTracks() } }
      this.pushTracks()
    } catch (e) { this.problem(deviceProblem(e, 'microphone')) }
  }

  async setCam(on: boolean) {
    if (!on) { this.video?.stop(); this.video = null; this.pushTracks(); return }
    if (this.video) return
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } })
      this.video = s.getVideoTracks()[0]
      this.video.onended = () => { if (this.video) { this.video = null; this.pushTracks() } }
      this.pushTracks()
    } catch (e) { this.problem(deviceProblem(e, 'camera')) }
  }

  async shareScreen() {
    if (this.screenTrack) return
    if (!navigator.mediaDevices.getDisplayMedia) { this.problem("This browser can't share the screen."); return }
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15 } }, audio: false })
      this.screenMedia = s
      this.screenTrack = s.getVideoTracks()[0]
      this.screenTrack.onended = () => this.stopScreen()
      this.pushTracks()
    } catch (e) { this.problem(deviceProblem(e, 'screen')) }
  }

  stopScreen() {
    this.screenMedia?.getTracks().forEach((t) => t.stop())
    this.screenMedia = null; this.screenTrack = null
    this.pushTracks()
  }

  send(text: string) { if (text.trim()) this.send_({ t: 'chat', text }) }
  mute(id: string) { this.send_({ t: 'mute', to: id }) }
  kick(id: string) { this.send_({ t: 'kick', to: id }) }

  private finish(why: CallEnd) {
    if (this.end) return
    this.end = why; this.state = 'closed'
    this.teardown(); this.changed()
  }

  private teardown() {
    this.done = true
    if (this.timer) clearTimeout(this.timer)
    if (this.ping) clearInterval(this.ping)
    this.dropLinks()
    this.audio?.stop(); this.video?.stop(); this.screenMedia?.getTracks().forEach((t) => t.stop())
    this.audio = this.video = this.screenTrack = null
    this.rebuildSelf()
    const ws = this.ws; this.ws = null
    if (ws) { ws.onclose = null; ws.close() }
  }

  leave() {
    if (!this.end) { this.end = 'left'; this.state = 'closed' }
    this.teardown(); this.changed()
  }
}

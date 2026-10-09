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

/** Metered's server refuses a description that repeats an `a=msid:` line (Safari writes some twice). Only the copy that is sent is changed: a repeat inside one
 *  media section, or the same line in a later section, is dropped. */
export function tidy(sdp: string): string {
  const out: string[] = []
  const before = new Set<string>()   // lines of earlier media sections
  let mine = new Set<string>()
  for (const l of sdp.split(/\r?\n/)) {
    if (l.startsWith('m=')) { mine.forEach((x) => before.add(x)); mine = new Set() }
    if (l.startsWith('a=msid:')) { if (mine.has(l) || before.has(l)) continue; mine.add(l) }
    out.push(l)
  }
  return out.join('\r\n')
}

function silence(): MediaStreamTrack {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) throw new Error("this browser can't make the silent audio the call service needs (no AudioContext)")
  const ctx = new AC(), d = ctx.createMediaStreamDestination()
  // an oscillator at zero volume keeps the track live (some browsers give a dead track otherwise)
  const g = ctx.createGain(); g.gain.value = 0
  const o = ctx.createOscillator(); o.connect(g); g.connect(d); o.start()
  void ctx.resume().catch(() => {})
  const t = d.stream.getAudioTracks()[0]
  if (!t) throw new Error("this browser gave no silent audio track")
  return t
}
function black(): MediaStreamTrack {
  const c = document.createElement('canvas'); c.width = 160; c.height = 90
  if (typeof c.captureStream !== 'function') throw new Error("this browser can't make the blank video the call service needs (no canvas capture)")
  const g = c.getContext('2d')!; let n = 0
  const draw = () => { g.fillStyle = '#000'; g.fillRect(0, 0, 160, 90); g.fillStyle = n++ % 2 ? '#010101' : '#000'; g.fillRect(0, 0, 1, 1) }
  draw(); const t = c.captureStream(1).getVideoTracks()[0]
  if (!t) throw new Error('this browser gave no blank video track')
  window.setInterval(draw, 1000)   // a frame every second keeps the sending side alive
  return t
}

export class SfuMedia extends Emitter implements Media {
  private pc: RTCPeerConnection
  private rx: RTCPeerConnection      // the connection others' tracks arrive on: the same one for Cloudflare; for Metered a second one, as its documentation does it (one session sends, another receives)
  private rxSid = ''
  private expect: { peer: string; kind: Kind } | null = null   // the track being subscribed to right now (Metered): whatever arrives during that is it
  private hooked = false
  private restarts: number[] = []
  private restarting = false
  private downTimer: number | undefined
  private ice: RTCIceServer[]
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
  private failed = new Set<string>()   // people whose tracks could not be fetched
  private error = ''

  constructor(private ctl: Control, private code: string, private jt: string, ice: RTCIceServer[], local: LocalTracks, private dialect: 'cloudflare' | 'metered' = 'cloudflare') {
    super()
    this.audio = local.audio; this.video = local.video
    this.micId = local.micId ?? ''; this.camId = local.camId ?? ''
    this.ice = ice
    this.pc = this.rx = new RTCPeerConnection({ iceServers: ice, bundlePolicy: 'max-bundle' })
    this.ph = { mic: silence(), cam: black(), screen: black() }
    this.rebuild()
  }

  async start() {
    let stage = 'preparing'
    try { await this.begin((x) => { stage = x }) } catch (e) { throw new Error(`${stage}: ${(e as Error).message}`) }
  }

  private async begin(at: (stage: string) => void) {
    const pc = this.pc
    if (!this.hooked) {
      this.hooked = true
      this.ctl.onSignal((from, data) => void this.onSignal(from, data))
      this.ctl.onLeft((id) => { this.remotes.delete(id); this.changed() })
      this.ctl.onForce((f) => { if (f.screen === false) this.stopScreen(); if (f.audio === false) void this.setMic(false); if (f.video === false) void this.setCam(false) })
      this.ctl.onMute(() => void this.setMic(false))
      this.ctl.onCamOff(() => void this.setCam(false))
      this.ctl.onWelcome(() => this.announce(this.ctl.welcomePeers, false))   // the control channel reconnected: say again where we are
    }
    this.wire(pc)
    const addSlots = () => {
      this.slots = [
        pc.addTransceiver(this.audio ?? this.ph.mic, { direction: 'sendonly' }),
        pc.addTransceiver(this.video ?? this.ph.cam, { direction: 'sendonly' }),
        pc.addTransceiver(this.ph.screen, { direction: 'sendonly' }),
      ]
    }
    if (this.dialect === 'metered') {
      // as Metered's own quickstart does it: the session starts with a bare offer (one empty video line), then the tracks are published by id with a new offer
      pc.addTransceiver('video')
      at('creating the session')
      await pc.setLocalDescription(await pc.createOffer())
      const first = await api.meetSfu<{ sessionId: string; sessionDescription: RTCSessionDescriptionInit }>(this.code, this.jt, 'session', 'POST', { sessionDescription: { type: 'offer', sdp: tidy(pc.localDescription!.sdp) } })
      this.sid = first.sessionId
      await pc.setRemoteDescription(first.sessionDescription)
      for (const t of pc.getTransceivers()) if (t.mid) this.known.add(t.mid)
      at('adding your tracks')
      addSlots()
      await pc.setLocalDescription(await pc.createOffer())
      this.slots.forEach((t, i) => { this.ids[NAMES[i]] = t.sender.track?.id })
      at('publishing your tracks')
      const r = await api.meetSfu<{ sessionDescription: RTCSessionDescriptionInit }>(this.code, this.jt, `${this.sid}/tracks`, 'POST', {
        op: 'publish', sessionDescription: { type: 'offer', sdp: tidy(pc.localDescription!.sdp) },
        tracks: this.slots.map((t, i) => ({ trackId: t.sender.track?.id, mid: t.mid, customTrackName: NAMES[i] })),
      })
      await pc.setRemoteDescription(r.sessionDescription)
      this.known.clear()   // (mids are counted per connection: the receiving one starts fresh)
      at('opening the receiving session')
      const rx = this.rx = new RTCPeerConnection({ iceServers: this.ice, bundlePolicy: 'max-bundle' })
      this.wire(rx)
      rx.addTransceiver('video', { direction: 'recvonly' })
      await rx.setLocalDescription(await rx.createOffer())
      const second = await api.meetSfu<{ sessionId: string; sessionDescription: RTCSessionDescriptionInit }>(this.code, this.jt, 'session', 'POST', { sessionDescription: { type: 'offer', sdp: tidy(rx.localDescription!.sdp) } })
      this.rxSid = second.sessionId
      await rx.setRemoteDescription(second.sessionDescription)
      for (const t of rx.getTransceivers()) if (t.mid) this.known.add(t.mid)
    } else {
      at('creating the session')
      addSlots()
      await pc.setLocalDescription(await pc.createOffer())
      const { sessionId } = await api.meetSfu<{ sessionId: string }>(this.code, this.jt, 'session')
      this.sid = this.rxSid = sessionId
      const r = await api.meetSfu<{ sessionDescription: RTCSessionDescriptionInit }>(this.code, this.jt, `${sessionId}/tracks`, 'POST', {
        sessionDescription: { type: 'offer', sdp: tidy(pc.localDescription!.sdp) },
        tracks: this.slots.map((t, i) => ({ location: 'local', mid: t.mid, trackName: NAMES[i] })),
      })
      await pc.setRemoteDescription(r.sessionDescription)
    }
    this.ready()
    this.announce(this.restarts.length ? [...this.ctl.peers.keys()] : this.ctl.welcomePeers, false)
  }

  /** hand received tracks to the right person (the connection line they arrive on says whose and which) */
  private wire(c: RTCPeerConnection) {
    c.ontrack = (e) => {
      const m = this.expect ?? (e.transceiver.mid ? this.byMid.get(e.transceiver.mid) : undefined)
      const r = m && this.remotes.get(m.peer)
      if (!m || !r) return
      if ((m.kind === 'mic') !== (e.track.kind === 'audio')) return   // not the kind we asked for
      if (e.transceiver.mid) this.byMid.set(e.transceiver.mid, m)
      r.tracks[m.kind] = e.track; r.mids[m.kind] = e.transceiver
      if (m.kind === 'screen') r.screenStream = new MediaStream([e.track])
      else r.stream = new MediaStream([r.tracks.mic, r.tracks.cam].filter(Boolean) as MediaStreamTrack[])
      this.changed()
    }
    c.onconnectionstatechange = () => {
      this.changed()
      window.clearTimeout(this.downTimer)
      if (c !== this.pc && c !== this.rx) return
      if (c.connectionState === 'failed') void this.restart()
      else if (c.connectionState === 'disconnected') this.downTimer = window.setTimeout(() => { if (c.connectionState !== 'connected') void this.restart() }, 6000)
    }
  }

  /** a connection to the call service died: start both over (new sessions) and tell everyone where we are now; they fetch us again and we fetch them */
  private async restart() {
    if (this.stopped || this.restarting) return
    const now = Date.now()
    this.restarts = this.restarts.filter((t) => now - t < 120_000)
    if (this.restarts.length >= 6) { this.error = 'the connection to the call service keeps dropping (the network may be blocking its UDP traffic)'; this.changed(); return }
    this.restarts.push(now); this.restarting = true
    try {
      for (const c of new Set([this.pc, this.rx])) { c.ontrack = c.onconnectionstatechange = null; c.close() }
      this.pc = this.rx = new RTCPeerConnection({ iceServers: this.ice, bundlePolicy: 'max-bundle' })
      this.remotes.clear(); this.byMid.clear(); this.known.clear(); this.slots = []; this.ids = {}; this.error = ''
      this.ok = new Promise((r) => { this.ready = r })
      this.changed()
      await this.begin(() => {})
    } catch (e) {
      this.error = `couldn't reconnect: ${(e as Error).message}`; this.changed()
      window.setTimeout(() => { this.restarting = false; void this.restart() }, 4000)
      return
    } finally { if (!this.error) this.restarting = false }
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

  private pull(peer: string, sid: string, ids: Ids) {   // (ids: what the other side announced; Metered's own list is used for subscribing)
    this.failed.delete(peer)
    this.remotes.set(peer, { sid, tracks: {}, stream: null, screenStream: null, since: Date.now(), mids: {} })
    window.setTimeout(() => { if (!this.stopped) this.changed() }, STUCK_MS + 100)
    this.chain = this.chain.then(async () => {
      if (this.stopped) return
      try {
        if (this.dialect === 'metered') {
          // one track at a time: the connection line each one arrives on is then the new one in the server's offer
          // the ids to ask for are the ones Metered itself lists for that session (found by the names we gave the tracks)
          let listed: { items?: { trackId?: string; customTrackName?: string }[] } = {}
          for (let i = 0; i < 6; i++) {   // their tracks may take a moment to appear after they publish
            listed = await api.meetSfu(this.code, this.jt, `${this.rxSid}/tracks`, 'POST', { op: 'list', sessionId: sid })
            if (listed.items?.length) break
            await new Promise((r) => setTimeout(r, 1000))
          }
          const found: Ids = {}
          for (const t of listed.items ?? []) if (t.trackId && NAMES.includes(t.customTrackName as Kind)) found[t.customTrackName as Kind] = t.trackId
          if (!Object.keys(found).length) {   // the names weren't kept: they were published in order (microphone, camera, screen), so the order of the lines says which is which
            const all = (listed.items ?? []).filter((t: any) => t.trackId).sort((x: any, y: any) => Number(x.mid) - Number(y.mid)) as { trackId: string; trackKind?: string }[]
            const vids = all.filter((t) => t.trackKind !== 'audio')
            const au = all.find((t) => t.trackKind === 'audio')
            if (au) found.mic = au.trackId
            if (vids[0]) found.cam = vids[0].trackId
            if (vids[1]) found.screen = vids[1].trackId
          }
          if (!Object.keys(found).length) throw new Error(`Metered lists no tracks for that person (it said: ${JSON.stringify(listed).slice(0, 200)})`)
          const failures: string[] = []
          let got = 0
          for (const kind of NAMES) {
            if (!found[kind]) continue
            ids = { ...ids, [kind]: found[kind] }
            try {
              // right after they publish, Metered can fail (500) to find media that hasn't started flowing yet: ask again for a few seconds
              let r: { immediateRenegotiationRequired?: boolean; sessionDescription?: RTCSessionDescriptionInit } | null = null
              for (let i = 0; ; i++) {
                try { r = await api.meetSfu(this.code, this.jt, `${this.rxSid}/tracks`, 'POST', { op: 'subscribe', tracks: [{ remoteSessionId: sid, remoteTrackId: ids[kind] }] }); break }
                catch (e) { if (i >= 5) throw e; await new Promise((x) => setTimeout(x, 1000 + i * 700)) }
              }
              if (r && r.sessionDescription && r.immediateRenegotiationRequired !== false) {
                this.expect = { peer, kind }
                try { await this.rx.setRemoteDescription(r.sessionDescription) } finally { this.expect = null }
                await this.rx.setLocalDescription(await this.rx.createAnswer())
                await api.meetSfu(this.code, this.jt, `${this.rxSid}/renegotiate`, 'PUT', { sessionDescription: { type: 'answer', sdp: tidy(this.rx.localDescription!.sdp) } })
              }
              got++
            } catch (e) { failures.push(`${kind}: ${(e as Error).message}`) }   // the other tracks are still worth having
          }
          if (!got) throw new Error(failures.join('; '))
          if (failures.length) { this.error = `some tracks could not be received (${failures.join('; ')})`; this.changed() }
        } else {
          const r = await api.meetSfu<{ requiresImmediateRenegotiation?: boolean; sessionDescription?: RTCSessionDescriptionInit; tracks?: { mid?: string; trackName?: string; errorCode?: string }[] }>(
            this.code, this.jt, `${this.rxSid}/tracks`, 'POST', { tracks: NAMES.map((n) => ({ location: 'remote', sessionId: sid, trackName: n })) })
          for (const t of r.tracks ?? []) if (t.mid && !t.errorCode && NAMES.includes(t.trackName as Kind)) this.byMid.set(t.mid, { peer, kind: t.trackName as Kind })
          if (r.requiresImmediateRenegotiation && r.sessionDescription) {
            await this.rx.setRemoteDescription(r.sessionDescription)
            await this.rx.setLocalDescription(await this.rx.createAnswer())
            await api.meetSfu(this.code, this.jt, `${this.rxSid}/renegotiate`, 'PUT', { sessionDescription: { type: 'answer', sdp: tidy(this.rx.localDescription!.sdp) } })
          }
        }
      } catch (e) {
        this.error = (e as Error).message; this.failed.add(peer); this.remotes.delete(peer); this.changed()
        this.notice(`Couldn't receive ${this.ctl.peers.get(peer)?.name ?? 'someone'}'s audio and video: ${this.error}`)
      }
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
    const up = this.rx.connectionState === 'failed' || this.pc.connectionState === 'failed' ? 'failed' : this.rx.connectionState
    const net = up === 'failed' || up === 'closed' || this.failed.has(p.id) ? 'failed' : r?.stream || r?.screenStream ? 'connected' : r && Date.now() - r.since > STUCK_MS ? 'failed' : 'connecting'
    return { audio: p.audio, video: p.video, screen: p.screen, stream: r?.stream ?? null, screenStream: r?.screenStream ?? null, net, path: null }
  }

  /** what is wrong right now, in words: the service's own error, else the state of the one connection, else what was (not) received */
  problem() {
    if (this.error) return this.error
    const pc = this.pc
    for (const [n, c] of [['sending', pc], ['receiving', this.rx]] as const) if (c.connectionState !== 'connected') return `the ${n} connection to the call service is "${c.connectionState}" (network "${c.iceConnectionState}"), so nothing can be sent or received. A firewall or VPN may be blocking its UDP traffic`
    const got = [...this.remotes.entries()].filter(([, r]) => !r.stream && !r.screenStream).map(([id, r]) => `${this.ctl.peers.get(id)?.name ?? id} (subscribed to ${this.pulled(id)} tracks)`)
    return got.length ? `connected, but no audio or video arrived for ${got.join(', ')}` : ''
  }
  private pulled(id: string) { return [...this.byMid.values()].filter((m) => m.peer === id).length }

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
    out.push(`Receiving connection: ${this.rx === this.pc ? 'the same' : `${this.rx.connectionState}, ICE ${this.rx.iceConnectionState}, session ${this.rxSid}`}`, `Transceivers: ${pc_summary(this.rx)}`, `Signalling state: ${this.pc.signalingState}`, `Connection lines assigned to people: ${[...this.byMid.entries()].map(([m, v]) => `${m}=${names[v.peer] ?? v.peer}/${v.kind}`).join(', ') || 'none'}`)
    for (const [id, r] of this.remotes) out.push(`${names[id] ?? id}: session ${r.sid}, ${Object.keys(r.tracks).join(', ') || 'no tracks yet'}`)
    const p = this.problem(); if (p) out.push(`Problem: ${p}`)
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
    window.clearTimeout(this.downTimer)
    for (const c of new Set([this.pc, this.rx])) { c.ontrack = c.onconnectionstatechange = null; c.close() }
    this.audio?.stop(); this.video?.stop(); this.screenMedia?.getTracks().forEach((t) => t.stop())
    this.audio = this.video = this.screenTrack = null
    Object.values(this.ph).forEach((t) => t.stop())
    this.rebuild()
  }
}

function pc_summary(pc: RTCPeerConnection) {
  return pc.getTransceivers().map((t) => `${t.mid ?? '-'}:${t.direction}/${t.currentDirection ?? '-'} ${t.receiver.track?.kind ?? ''}${t.receiver.track?.muted ? ' muted' : ''}`).join(' | ')
}

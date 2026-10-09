import { api, type MeetTicket } from '../api'
import { Captioner } from './captions'
import { Control } from './control'
import { listDevices, type Media } from './media'
import { MeshMedia } from './mesh'
import { RtkMedia } from './rtk'
import { Emitter, type Call, type Caption, type CallEnd, type CallStatus, type ChatMsg, type Devices, type LocalTracks, type Peer, type PollView, type RoomSettings, type Waiting } from './types'

/** A call as the meeting page sees it: the control channel (who is here, the waiting room, chat, reactions, polls, ...) joined to the audio-and-video
 *  part (direct between browsers, or Cloudflare RealtimeKit). Audio and video only start once the room has let you in. */
export class Session extends Emitter implements Call {
  private ctl: Control
  private media: Media | null = null
  private starting = false
  private sent = ''
  private captioner: Captioner | null = null
  private captionMic: MediaStream | null = null
  private ended = false

  constructor(readonly code: string, private ticket: MeetTicket, private local: LocalTracks) {
    super()
    const ctl = (this.ctl = new Control(code, ticket))
    ctl.subscribe(() => { this.changed(); void this.syncCaptions() })
    ctl.onNoticeFrom = (m) => this.notice(m)
    ctl.onWelcome(() => { this.sent = ''; void this.startMedia(); this.syncState() })
  }

  get name() { return this.ticket.name }

  private async startMedia() {
    if (this.media || this.starting || this.ended) return
    this.starting = true
    try {
      const mc = await api.meetMedia(this.code, this.ticket.jt)
      if (this.ended) return
      const m = mc.provider === 'realtimekit' ? new RtkMedia(this.ctl, mc.auth_token ?? '', this.local) : new MeshMedia(this.ctl, mc.ice_servers ?? [], this.local)
      m.subscribe(() => { this.syncState(); this.changed(); void this.syncCaptions() })
      m.onNotice((t) => this.notice(t))
      await m.start()
      this.media = m
      const s = this.ctl.settings
      if (!this.ctl.me.manager) {   // what the meeting asks of people when they arrive
        if (s.mute_on_entry) await m.setMic(false)
        if (s.cam_off_on_entry) await m.setCam(false)
      }
      this.syncState(); this.changed()
    } catch (e) {
      this.notice(`Audio and video couldn't start: ${(e as Error).message}`)
      this.local.audio?.stop(); this.local.video?.stop()
    } finally { this.starting = false }
  }

  private syncState() {
    const v = this.media?.self()
    if (!v) return
    const key = `${+v.audio}${+v.video}${+v.screen}`
    if (key === this.sent) return
    this.sent = key
    this.ctl.send({ t: 'state', audio: v.audio, video: v.video, screen: v.screen })
  }

  private async syncCaptions() {
    const want = !!this.ctl.settings.captions_on && !this.ended
    const mic = want ? this.media?.self().mic ?? null : null
    if (mic === this.captionMic) return
    this.captioner?.stop(); this.captioner = null; this.captionMic = mic
    if (!mic) return
    const c = new Captioner(mic, async (wav) => { await api.meetCaption(this.code, this.ticket.jt, wav) })
    this.captioner = c
    try { await c.start() } catch { this.captioner = null }
  }

  // ---- what the page reads
  status(): CallStatus { return this.ctl.status }
  waitReason() { return this.ctl.waitReason }
  endReason(): CallEnd | null { return this.ctl.end }
  permanent() { return this.ticket.permanent }
  me() { const m = this.ctl.me; return { id: m.id, manager: m.manager, owner: m.owner, cohost: m.cohost } }
  title() { return this.ctl.title || this.ticket.title }
  started() { return this.ctl.started }
  settings(): RoomSettings { return this.ctl.settings }
  emojis() { return this.ctl.emojis }
  spotlight() { return this.ctl.spotlight }
  chat(): ChatMsg[] { return this.ctl.chat }
  polls(): PollView[] { return this.ctl.polls }
  waiting(): Waiting[] { return this.ctl.waiting }
  captions(): Caption[] { return this.ctl.captions }
  devices(): Promise<Devices> { return this.media?.devices() ?? listDevices({ mic: '', cam: '' }) }

  peers(): Peer[] {
    const c = this.ctl, v = this.media?.self()
    const hand = (id: string) => c.hands.indexOf(id) + 1
    const me: Peer = { id: c.me.id || 'self', cid: c.me.cid, name: this.ticket.name, self: true, host: c.me.owner, cohost: c.me.cohost, manager: c.me.manager,
      audio: !!v?.audio, video: !!v?.video, screen: !!v?.screen, hand: hand(c.me.id), stream: v?.stream ?? null, screenStream: v?.screenStream ?? null, mic: v?.mic ?? null }
    const others = [...c.peers.values()].map((p) => {
      const m = this.media?.peer(p)
      return { id: p.id, cid: p.cid, name: p.name, self: false, host: p.host, cohost: p.cohost, manager: p.host || p.cohost, audio: m?.audio ?? p.audio, video: m?.video ?? p.video,
        screen: m?.screen ?? p.screen, hand: hand(p.id), stream: m?.stream ?? null, screenStream: m?.screenStream ?? null, mic: null } as Peer
    })
    return [me, ...others]
  }

  // ---- what the person does
  async setMic(on: boolean) {
    if (on && !this.ctl.me.manager && !this.ctl.settings.unmute) { this.notice('The host has turned off unmuting. Raise your hand to ask.'); return }
    await this.media?.setMic(on)
  }
  async setCam(on: boolean) { await this.media?.setCam(on) }
  async shareScreen() {
    if (this.ctl.settings.share === 'host' && !this.ctl.me.manager) { this.notice('Only the host can share their screen in this meeting.'); return }
    await this.media?.shareScreen()
  }
  stopScreen() { this.media?.stopScreen() }
  async setDevice(kind: 'mic' | 'cam', id: string) { await this.media?.setDevice(kind, id) }
  react(emoji: string) { this.ctl.send({ t: 'react', emoji }) }
  onReact(fn: (from: string, emoji: string) => void) { return this.ctl.onReact(fn) }
  hand(up: boolean) { this.ctl.send({ t: 'hand', up }) }
  lowerHand(id: string) { this.ctl.send(id === 'all' ? { t: 'lower', all: true } : { t: 'lower', id }) }
  send(text: string, to?: string) { if (text.trim()) this.ctl.send({ t: 'chat', text, ...(to ? { to } : {}) }) }
  mute(id: string) { this.ctl.send({ t: 'mute', to: id }) }
  askUnmute(id: string) { this.ctl.send({ t: 'unmute-ask', to: id }) }
  camOff(id: string) { this.ctl.send({ t: 'camoff', to: id }) }
  muteAll(allowUnmute: boolean) { this.ctl.send({ t: 'mute-all', allow_unmute: allowUnmute }) }
  kick(id: string, block = false) { this.ctl.send({ t: 'kick', to: id, block }) }
  admit(id: string) { this.ctl.send(id === 'all' ? { t: 'admit', all: true } : { t: 'admit', id }) }
  deny(id: string) { this.ctl.send({ t: 'deny', id }) }
  lock(on: boolean) { this.ctl.send({ t: 'lock', on }) }
  captionsOn(on: boolean) { this.ctl.send({ t: 'captions', on }) }
  spotlightTo(id: string | null) { this.ctl.send({ t: 'spotlight', id }) }
  cohost(id: string, on: boolean) { this.ctl.send({ t: 'cohost', to: id, on }) }
  poll(msg: Parameters<Call['poll']>[0]) { this.ctl.send({ t: 'poll', ...msg }) }
  vote(id: string, choices: number[]) { this.ctl.send({ t: 'vote', id, choices }) }

  leave() {
    this.ended = true
    this.captioner?.stop(); this.captioner = null
    this.media?.stop()
    this.local.audio?.stop(); this.local.video?.stop()
    this.ctl.leave()
  }
}

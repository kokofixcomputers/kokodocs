import type { MeetTicket } from '../api'
import { Emitter, type Answer, type Caption, type CallEnd, type CallStatus, type ChatMsg, type Consents, type PollView, type RoomSettings, type Waiting } from './types'

export interface CPeer { id: string; cid: string; name: string; host: boolean; cohost: boolean; guest?: boolean; audio: boolean; video: boolean; screen: boolean }
export interface Me { id: string; cid: string; owner: boolean; cohost: boolean; manager: boolean }

const RETRY = [1000, 2000, 4000, 8000, 8000, 15000]
const gid = () => { try { let g = sessionStorage.getItem('koko.gid'); if (!g) { g = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem('koko.gid', g) } return g } catch { return '' } }

/** The control socket of a meeting: everything except audio and video. Reconnects by itself (with the same ticket, so a drop doesn't send you back to
 *  the waiting room). The room's state lives here; the page just reads it. */
export class Control extends Emitter {
  status: CallStatus = 'connecting'
  waitReason: 'approval' | 'host' | null = null
  end: CallEnd | null = null
  endedPermanent = false
  me: Me = { id: '', cid: '', owner: false, cohost: false, manager: false }
  peers = new Map<string, CPeer>()
  welcomePeers: string[] = []           // who was already here when we came in (we call them; later arrivals call us)
  settings = {} as RoomSettings
  title = ''
  started = 0
  spotlight: string | null = null
  hands: string[] = []
  chat: ChatMsg[] = []
  polls: PollView[] = []
  waiting: Waiting[] = []
  captions: Caption[] = []
  consents: Consents | null = null
  myConsent: Answer = null
  emojis: string[] = []
  private ws: WebSocket | null = null
  private retries = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private ping: ReturnType<typeof setInterval> | null = null
  private done = false
  private signalFn: ((from: string, data: any) => void) | null = null
  private signalQueue: [string, any][] = []
  private welcomeFns = new Set<() => void>()
  private reactFns = new Set<(from: string, emoji: string) => void>()
  private leftFns = new Set<(id: string) => void>()
  onNoticeFrom: ((m: string) => void) | null = null
  private forceFn: ((screen: boolean) => void) | null = null
  private muteFn: (() => void) | null = null
  private camOffFn: (() => void) | null = null

  constructor(private code: string, private t: MeetTicket) {
    super()
    this.connect()
  }

  // ---- hooks for the media part and the page
  onSignal(fn: (from: string, data: any) => void) { this.signalFn = fn; for (const [f, d] of this.signalQueue.splice(0)) fn(f, d) }
  onWelcome(fn: () => void) { this.welcomeFns.add(fn); return () => { this.welcomeFns.delete(fn) } }
  onReact(fn: (from: string, emoji: string) => void) { this.reactFns.add(fn); return () => { this.reactFns.delete(fn) } }
  onLeft(fn: (id: string) => void) { this.leftFns.add(fn); return () => { this.leftFns.delete(fn) } }
  onForce(fn: (screen: boolean) => void) { this.forceFn = fn }
  onMute(fn: () => void) { this.muteFn = fn }
  onCamOff(fn: () => void) { this.camOffFn = fn }

  send(m: object) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m)) }

  private connect() {
    if (this.done) return
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/ws/meet/${encodeURIComponent(this.code)}?jt=${encodeURIComponent(this.t.jt)}&gid=${encodeURIComponent(gid())}`)
    this.ws = ws
    ws.onmessage = (e) => { try { this.on(JSON.parse(e.data)) } catch { /* ignore malformed */ } }
    ws.onclose = (e) => {
      if (ws !== this.ws || this.done) return
      if (this.ping) clearInterval(this.ping)
      const why: Record<number, CallEnd> = { 4410: 'ended', 4411: 'kicked', 4412: this.end ?? 'denied', 4413: 'locked', 4415: 'declined', 4409: 'full', 4414: 'replaced', 4403: 'failed' }
      if (why[e.code]) return this.finish(why[e.code])
      this.status = 'reconnecting'; this.peers.clear(); this.changed()
      if (this.retries >= RETRY.length) return this.finish('failed')
      this.timer = setTimeout(() => this.connect(), RETRY[this.retries++])
    }
    this.ping = setInterval(() => { if (ws.readyState === 1) ws.send('{"t":"ping"}') }, 25000)
  }

  private toChat = (c: any): ChatMsg => ({ id: c.id, from: c.from, name: c.name, text: c.text, ts: c.ts, self: c.from === this.me.id, private: c.private, to: c.to, to_name: c.to_name })

  private on(m: any) {
    switch (m.t) {
      case 'waiting': this.status = 'waiting'; this.waitReason = m.reason; if (m.title) this.title = m.title; this.changed(); break
      case 'welcome': {
        this.me = m.me; this.status = 'connected'; this.waitReason = null; this.retries = 0
        this.peers = new Map((m.peers as CPeer[]).map((p) => [p.id, p]))
        this.welcomePeers = [...this.peers.keys()]
        this.settings = m.settings; this.title = m.title; this.started = m.started; this.spotlight = m.spotlight; this.hands = m.hands; this.emojis = m.emojis
        this.polls = m.polls; this.waiting = m.waiting ?? []
        this.myConsent = m.consent === true ? 'yes' : m.consent === false ? 'no' : null
        if (!this.chat.length) this.chat = (m.chat as any[]).map(this.toChat)
        this.changed(); this.welcomeFns.forEach((f) => f()); break
      }
      case 'joined': this.peers.set(m.peer.id, m.peer); this.changed(); break
      case 'left': this.peers.delete(m.id); this.hands = this.hands.filter((h) => h !== m.id); this.leftFns.forEach((f) => f(m.id)); this.changed(); break
      case 'state': { const p = this.peers.get(m.id); if (p) { p.audio = !!m.audio; p.video = !!m.video; p.screen = !!m.screen; this.changed() } break }
      case 'signal': if (this.signalFn) this.signalFn(m.from, m.data); else this.signalQueue.push([m.from, m.data]); break
      case 'chat': { const c = this.toChat(m); this.chat = [...this.chat, c].slice(-300); this.changed(); break }
      case 'react': this.reactFns.forEach((f) => f(m.from, m.emoji)); break
      case 'hands': this.hands = m.order; this.changed(); break
      case 'settings': {
        const was = this.settings.recording_now?.since
        this.settings = m.settings; if (m.title) this.title = m.title
        if (was !== this.settings.recording_now?.since) { this.myConsent = null; if (!this.settings.recording_now) this.consents = null }   // a new recording asks everyone again
        this.changed(); break
      }
      case 'consents': this.consents = { yes: m.yes, no: m.no, pending: m.pending }; this.changed(); break
      case 'declined': this.finish('declined'); break
      case 'spotlight': this.spotlight = m.id; this.changed(); break
      case 'waiting-list': this.waiting = m.list; this.changed(); break
      case 'polls': this.polls = m.polls; this.changed(); break
      case 'cohost': { const p = this.peers.get(m.id); if (p) p.cohost = m.on; this.changed(); break }
      case 'role': this.me = { ...this.me, manager: m.manager, cohost: m.cohost }; this.waiting = m.waiting ?? []; this.changed(); this.onNoticeFrom?.(m.cohost ? 'You are now a co-host.' : 'You are no longer a co-host.'); break
      case 'caption': this.captions = [...this.captions, { id: `${m.ts}-${m.from}`, from: m.from, name: m.name, text: m.text, ts: m.ts }].slice(-200); this.changed(); break
      case 'notice': this.onNoticeFrom?.(m.text); break
      case 'mute': this.muteFn?.(); this.onNoticeFrom?.(m.by ? `${m.by} muted you.` : 'You were muted.'); break
      case 'camoff': this.camOffFn?.(); this.onNoticeFrom?.(m.by ? `${m.by} turned off your camera.` : 'Your camera was turned off.'); break
      case 'unmute-ask': this.onNoticeFrom?.(`${m.by || 'The host'} asked you to unmute.`); break
      case 'force': this.forceFn?.(m.screen); if (m.text) this.onNoticeFrom?.(m.text); break
      case 'kicked': this.finish(m.blocked ? 'blocked' : 'kicked'); break
      case 'denied': this.finish(m.why === 'removed' ? 'blocked' : 'denied'); break
      case 'locked': this.finish('locked'); break
      case 'full': this.finish('full'); break
      case 'replaced': this.finish('replaced'); break
      case 'ended': this.endedPermanent = !!m.permanent; this.finish('ended'); break
    }
  }

  finish(why: CallEnd) {
    if (this.end) return
    this.end = why; this.status = 'closed'
    this.teardown(); this.changed()
  }

  private teardown() {
    this.done = true
    if (this.timer) clearTimeout(this.timer)
    if (this.ping) clearInterval(this.ping)
    const ws = this.ws; this.ws = null
    if (ws) { ws.onclose = null; ws.close() }
  }

  leave() {
    if (!this.end) { this.end = 'left'; this.status = 'closed' }
    this.teardown(); this.changed()
  }
}

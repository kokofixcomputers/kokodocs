import type RealtimeKitClient from '@cloudflare/realtimekit'
import type { MeetJoin } from '../api'
import { deviceProblem, Emitter, type Call, type CallEnd, type CallStatus, type ChatMsg, type LocalTracks, type Peer } from './types'

/** Cloudflare RealtimeKit. The server created the meeting and a token for this person (Cloudflare's REST API, with the account's secret token,
 *  which never reaches the browser); this wraps Cloudflare's SDK in the same shape as every other provider. The SDK is loaded only when someone
 *  actually joins a RealtimeKit meeting, so it costs nothing for everyone else. */

type Client = RealtimeKitClient
type Part = Client['participants']['joined'] extends Map<string, infer P> ? P : never

const stream = (...tracks: (MediaStreamTrack | undefined | null)[]) => {
  const t = tracks.filter(Boolean) as MediaStreamTrack[]
  return t.length ? new MediaStream(t) : null
}

export class RtkCall extends Emitter implements Call {
  private state: CallStatus = 'connected'
  private end: CallEnd | null = null
  private messages: ChatMsg[] = []
  private cache = new Map<string, { key: string; cam: MediaStream | null; screen: MediaStream | null }>()
  private watched = new Set<string>()

  private constructor(private c: Client, private join: MeetJoin) {
    super()
    const bump = () => this.changed()
    const self = c.self
    for (const e of ['audioUpdate', 'videoUpdate', 'screenShareUpdate'] as const) self.on(e, bump)
    self.on('roomLeft', ({ state }) => this.finish(state === 'kicked' ? 'kicked' : state === 'ended' ? 'ended' : state === 'left' ? 'left' : 'failed'))
    const joined = c.participants.joined
    joined.on('participantJoined', (p: Part) => { this.watch(p); bump() })
    joined.on('participantLeft', (p: Part) => { this.watched.delete(p.id); this.cache.delete(p.id); bump() })
    joined.on('participantsUpdate' as never, bump as never)
    for (const p of joined.values()) this.watch(p as Part)
    c.chat.on('chatUpdate', () => {
      this.messages = c.chat.messages.filter((m) => m.type === 'text').map((m) => ({
        id: m.id, from: m.userId, name: m.displayName, text: (m as { message: string }).message, ts: m.timeMs ?? new Date(m.time).getTime(), self: m.userId === c.self.userId }))
      bump()
    })
  }

  static async start(join: MeetJoin, local: LocalTracks): Promise<RtkCall> {
    local.audio?.stop(); local.video?.stop()   // the SDK opens the devices itself
    const { default: Client } = await import('@cloudflare/realtimekit')
    const c = await Client.init({ authToken: join.auth_token ?? '', defaults: { audio: !!local.audio, video: !!local.video } })
    await c.join()
    return new RtkCall(c, join)
  }

  private watch(p: Part) {
    if (this.watched.has(p.id)) return
    this.watched.add(p.id)
    for (const e of ['audioUpdate', 'videoUpdate', 'screenShareUpdate'] as const) p.on(e, () => this.changed())
  }

  get selfId() { return this.c.self.id }
  get isHost() { return this.join.host }
  get canModerate() { const p = this.c.self.permissions; return !!(p.kickParticipant || p.canDisableParticipantAudio) }
  status() { return this.state }
  endReason() { return this.end }
  chat() { return this.messages }

  peers(): Peer[] {
    const s = this.c.self
    const me: Peer = { id: s.id, name: this.join.name, self: true, host: this.join.host, audio: s.audioEnabled, video: s.videoEnabled, screen: s.screenShareEnabled,
      stream: s.videoEnabled ? this.mem(s.id, 'cam', s.videoTrack) : null, screenStream: s.screenShareEnabled ? this.mem(s.id, 'screen', s.screenShareTracks?.video) : null }
    const others = [...this.c.participants.joined.values()].map((p) => {
      const d = p as Part
      return { id: d.id, name: d.name, self: false, host: !!(d as unknown as { isHost?: boolean }).isHost, audio: d.audioEnabled, video: d.videoEnabled, screen: d.screenShareEnabled,
        stream: this.mem(d.id, 'cam', d.videoEnabled ? d.videoTrack : null, d.audioEnabled ? d.audioTrack : null), screenStream: d.screenShareEnabled ? this.mem(d.id, 'screen', d.screenShareTracks?.video) : null } as Peer
    })
    return [me, ...others]
  }

  /** The same MediaStream object for the same tracks, so the page doesn't reattach videos on every update. */
  private mem(id: string, kind: 'cam' | 'screen', ...tracks: (MediaStreamTrack | undefined | null)[]): MediaStream | null {
    const key = tracks.map((t) => t?.id ?? '-').join('|')
    const e = this.cache.get(`${id}:${kind}`) as { key: string; cam: MediaStream | null } | undefined
    if (e && e.key === key) return e.cam
    const m = stream(...tracks)
    this.cache.set(`${id}:${kind}`, { key, cam: m, screen: null })
    return m
  }

  async setMic(on: boolean) { try { await (on ? this.c.self.enableAudio() : this.c.self.disableAudio()) } catch (e) { this.problem(deviceProblem(e, 'microphone')) } }
  async setCam(on: boolean) { try { await (on ? this.c.self.enableVideo() : this.c.self.disableVideo()) } catch (e) { this.problem(deviceProblem(e, 'camera')) } }
  async shareScreen() { try { await this.c.self.enableScreenShare() } catch (e) { this.problem(deviceProblem(e, 'screen')) } }
  stopScreen() { void this.c.self.disableScreenShare().catch(() => {}) }
  send(text: string) { if (text.trim()) void this.c.chat.sendTextMessage(text.slice(0, 2000)).catch(() => this.problem("That message couldn't be sent.")) }
  mute(id: string) { void this.c.participants.joined.get(id)?.disableAudio().catch(() => this.problem("You can't mute that person.")) }
  kick(id: string) { void this.c.participants.joined.get(id)?.kick().catch(() => this.problem("You can't remove that person.")) }

  private finish(why: CallEnd) {
    if (this.end) return
    this.end = why; this.state = 'closed'; this.changed()
  }

  leave() {
    this.finish('left')
    void this.c.leave().catch(() => {})
  }
}

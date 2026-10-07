import * as Y from 'yjs'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness'
import { getDocToken, getToken } from './api'

const MSG_UPDATE = 0
const MSG_AWARENESS = 1
const MSG_PING = 2

export type ConnStatus = 'connecting' | 'connected' | 'disconnected' | 'offline' | 'denied'

/** Sent on `window` whenever the connection changes, so one notice can tell people what is going on (see ui/SyncNotices.tsx). */
export interface ConnDetail { docId: string; status: ConnStatus | 'closed'; pending: number; everConnected: boolean }
/** Sent when reconnecting finished and what changed while away has been merged. */
export interface MergeDetail { docId: string; local: boolean; remote: boolean; away: number }

const PING_EVERY = 10_000
const PONG_WITHIN = 6_000
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i])

/** Minimal Yjs provider speaking the KokoDocs relay protocol (see backend/app/collab.py).
 *
 *  Going offline for a while is fine: edits made meanwhile stay in this Y.Doc, and when the connection is back the whole
 *  state is exchanged both ways. Yjs merges the two histories, so nothing either side typed is lost and both end up identical.
 *  What this class adds is noticing quickly (browser offline events, a heartbeat for connections that die silently),
 *  reconnecting at once when the network returns, and saying what happened. */
export class KokoProvider {
  awareness: Awareness
  status: ConnStatus = 'connecting'
  synced = false
  /** edits made while not connected, waiting to be sent */
  pending = 0
  private ws: WebSocket | null = null
  private retry = 0
  private timer: number | undefined
  private closed = false
  private everConnected = false
  private listeners = new Set<() => void>()
  private ping: number | undefined
  private pong: number | undefined
  private lostAt = 0
  private catchingUp = false
  private localAtOpen = false
  private vecAtOpen: Uint8Array | null = null

  constructor(public docId: string, public doc: Y.Doc, private readOnly: boolean) {
    this.awareness = new Awareness(doc)
    doc.on('update', this.onDocUpdate)
    this.awareness.on('update', this.onAwarenessUpdate)
    window.addEventListener('beforeunload', this.onUnload)
    window.addEventListener('offline', this.onOffline)
    window.addEventListener('online', this.onOnline)
    document.addEventListener('visibilitychange', this.onVisible)
    this.connect()
  }

  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  private emit() { this.listeners.forEach((l) => l()) }
  private announce(status: ConnStatus | 'closed' = this.status) {
    window.dispatchEvent(new CustomEvent<ConnDetail>('koko:conn', { detail: { docId: this.docId, status, pending: this.pending, everConnected: this.everConnected } }))
  }
  private setStatus(s: ConnStatus) { this.status = s; this.emit(); this.announce() }

  private connect() {
    if (this.closed || this.ws) return
    window.clearTimeout(this.timer)
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { this.setStatus('offline'); return }   // the online event will bring us back
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const q = new URLSearchParams()
    const t = getToken(); if (t) q.set('token', t)
    const dt = getDocToken(this.docId); if (dt) q.set('doc_token', dt)
    const ws = new WebSocket(`${proto}://${location.host}/ws/docs/${this.docId}?${q}`)
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    if (this.status !== 'disconnected') this.setStatus('connecting')

    ws.onopen = () => {
      this.retry = 0
      // remember what we had, so we can tell afterwards whether the server taught us anything new
      this.vecAtOpen = Y.encodeStateVector(this.doc)
      this.localAtOpen = this.pending > 0
      this.catchingUp = this.everConnected && this.lostAt > 0
      if (!this.readOnly) this.send(MSG_UPDATE, Y.encodeStateAsUpdate(this.doc))
      if (this.awareness.getLocalState()) this.send(MSG_AWARENESS, encodeAwarenessUpdate(this.awareness, [this.doc.clientID]))
      this.everConnected = true
      this.pending = 0
      this.setStatus('connected')
      this.startHeartbeat()
    }
    ws.onmessage = (e) => {
      window.clearTimeout(this.pong)
      const data = new Uint8Array(e.data as ArrayBuffer)
      const body = data.subarray(1)
      if (data[0] === MSG_UPDATE) {
        Y.applyUpdate(this.doc, body, this)
        if (!this.synced) { this.synced = true; this.emit() }
        if (this.catchingUp) {   // the first state after coming back: did it bring anything we didn't have?
          this.catchingUp = false
          const remote = !!this.vecAtOpen && !sameBytes(this.vecAtOpen, Y.encodeStateVector(this.doc))
          const away = Date.now() - this.lostAt
          if (!this.readOnly && (remote || this.localAtOpen) && away > 1500) {
            window.dispatchEvent(new CustomEvent<MergeDetail>('koko:merged', { detail: { docId: this.docId, local: this.localAtOpen, remote, away } }))
          }
          this.lostAt = 0
        }
      } else if (data[0] === MSG_AWARENESS) {
        applyAwarenessUpdate(this.awareness, body, this)
      }
    }
    ws.onclose = (e) => this.lost(ws, e.code)
  }

  /** The socket is gone (closed, errored, or judged dead). Clean up and plan the next try. */
  private lost(ws: WebSocket, code = 1006) {
    if (this.ws !== ws) return
    this.ws = null
    this.stopHeartbeat()
    ws.onopen = ws.onmessage = ws.onclose = null
    try { ws.close() } catch { /* already closed */ }
    // drop remote cursors; they are re-sent on reconnect
    const others = Array.from(this.awareness.getStates().keys()).filter((id) => id !== this.doc.clientID)
    removeAwarenessStates(this.awareness, others, this)
    if (this.closed) return
    if (code === 4403) { this.setStatus('denied'); return }
    if (code === 4002) { window.dispatchEvent(new Event('koko:access-changed')); return }
    if (!this.lostAt) this.lostAt = Date.now()
    this.setStatus(navigator.onLine === false ? 'offline' : 'disconnected')
    if (navigator.onLine === false) return   // wait for the online event instead of retrying into the void
    this.timer = window.setTimeout(() => this.connect(), Math.min(5000, 300 * 1.7 ** this.retry++))
  }

  // ── noticing trouble quickly ──
  private startHeartbeat() {
    this.stopHeartbeat()
    this.ping = window.setInterval(() => this.probe(), PING_EVERY)
  }
  private stopHeartbeat() { window.clearInterval(this.ping); window.clearTimeout(this.pong) }
  /** Ask the server for a reply; if none comes soon the connection is dead even though the browser hasn't noticed. */
  private probe() {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    window.clearTimeout(this.pong)
    this.pong = window.setTimeout(() => { if (this.ws === ws) this.lost(ws) }, PONG_WITHIN)
    this.send(MSG_PING, new Uint8Array([0]))
  }
  private onOffline = () => {
    if (!this.lostAt) this.lostAt = Date.now()
    window.clearTimeout(this.timer)
    if (this.ws) this.lost(this.ws)
    else this.setStatus('offline')
  }
  private onOnline = () => {
    if (this.closed) return
    this.retry = 0
    window.clearTimeout(this.timer)
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.probe()   // it may be a dead socket from before the drop
    else if (!this.ws) this.connect()
  }
  private onVisible = () => {   // a phone waking up, or switching back to this tab
    if (document.visibilityState !== 'visible' || this.closed) return
    if (this.ws?.readyState === WebSocket.OPEN) this.probe()
    else if (!this.ws && navigator.onLine !== false) { this.retry = 0; this.connect() }
  }

  private send(type: number, payload: Uint8Array) {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    const out = new Uint8Array(payload.length + 1)
    out[0] = type
    out.set(payload, 1)
    this.ws.send(out)
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this || this.readOnly) return
    if (this.ws?.readyState !== WebSocket.OPEN) { this.pending++; this.announce() }   // kept in the doc; sent in full when we reconnect
    this.send(MSG_UPDATE, update)
  }

  private onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === this) return
    const mine = [...added, ...updated, ...removed].filter((id) => id === this.doc.clientID)
    if (mine.length) this.send(MSG_AWARENESS, encodeAwarenessUpdate(this.awareness, mine))
  }

  private onUnload = () => removeAwarenessStates(this.awareness, [this.doc.clientID], 'unload')

  destroy() {
    this.closed = true
    window.clearTimeout(this.timer)
    this.stopHeartbeat()
    window.removeEventListener('beforeunload', this.onUnload)
    window.removeEventListener('offline', this.onOffline)
    window.removeEventListener('online', this.onOnline)
    document.removeEventListener('visibilitychange', this.onVisible)
    this.doc.off('update', this.onDocUpdate)
    removeAwarenessStates(this.awareness, [this.doc.clientID], 'destroy')
    this.awareness.destroy()
    const ws = this.ws; this.ws = null
    if (ws) { ws.onopen = ws.onmessage = ws.onclose = null; ws.close() }
    this.announce('closed')
    this.listeners.clear()
  }
}

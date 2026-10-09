import { useEffect, useMemo, useRef, useState } from 'react'
import { Crown, Hand, MicOff, Pin, Star } from 'lucide-react'
import { useContextMenu } from '../ui/ContextMenu'
import { personItems } from './Panels'
import { getSpeaker, hue, initials, onSpeaker } from './util'
import { watchSpeaking, type Call, type Peer } from './types'

type Kind = 'cam' | 'screen'

function Tile({ call, peer, kind, pinned, spotlight, onPin, onTalk, onMessage, big }: { call: Call; peer: Peer; kind: Kind; pinned: boolean; spotlight: boolean; onPin: () => void; onTalk: (id: string, v: boolean) => void; onMessage: (id: string) => void; big?: boolean }) {
  const ctx = useContextMenu()
  const el = useRef<HTMLVideoElement>(null)
  const [talking, setTalking] = useState(false)
  const stream = kind === 'screen' ? peer.screenStream : peer.stream
  useEffect(() => {
    const v = el.current
    if (!v) return
    if (v.srcObject !== stream) v.srcObject = stream
    if (stream) void v.play().catch(() => {})
  }, [stream])
  useEffect(() => {   // sound out of the speaker picked in the call
    const apply = () => { const v = el.current as (HTMLVideoElement & { setSinkId?: (id: string) => Promise<void> }) | null; if (v?.setSinkId && !peer.self) void v.setSinkId(getSpeaker()).catch(() => {}) }
    apply()
    return onSpeaker(apply)
  }, [peer.self])
  const heard = kind === 'cam' ? (peer.self ? peer.mic : peer.audio ? peer.stream : null) : null
  useEffect(() => {
    if (!heard) { setTalking(false); onTalk(peer.id, false); return }
    return watchSpeaking(heard, (v) => { setTalking(v); onTalk(peer.id, v) })
  }, [heard, peer.id])
  const showVideo = kind === 'screen' ? !!stream : peer.video && !!stream
  return (
    <div {...ctx.bind(() => personItems(call, peer, { onMessage, pin: { pinned, toggle: onPin } }))} className={`meet-tile ${kind} ${talking ? 'talking' : ''} ${peer.self && kind === 'cam' ? 'self' : ''} ${big ? 'big' : ''}`}>
      {ctx.node}
      <video ref={el} autoPlay playsInline muted={peer.self || kind === 'screen'} className={showVideo ? '' : 'off'} />
      {!showVideo && <div className="meet-avatar" style={{ '--h': hue(peer.name) } as React.CSSProperties}>{initials(peer.name)}</div>}
      {peer.hand > 0 && kind === 'cam' && <span className="meet-hand" title="Hand raised"><Hand size={15} />{peer.hand}</span>}
      <button className={`meet-pin ${pinned ? 'on' : ''}`} onClick={onPin} aria-label={pinned ? 'Unpin' : 'Pin to the main view'} title={pinned ? 'Unpin' : 'Pin to the main view'}><Pin size={14} /></button>
      <div className="meet-label">
        {kind === 'cam' && !peer.audio && <MicOff size={14} />}
        <span>{kind === 'screen' ? `${peer.self ? 'You are' : peer.name + ' is'} presenting` : peer.self ? `${peer.name} (you)` : peer.name}</span>
        {peer.host && kind === 'cam' && <Crown size={13} aria-label="Host" />}
        {peer.cohost && kind === 'cam' && <Star size={13} aria-label="Co-host" />}
        {spotlight && kind === 'cam' && <i className="meet-tag">Spotlight</i>}
      </div>
    </div>
  )
}

/** The tiles. Gallery: everyone the same size. Otherwise one person (the spotlight, a pin, someone sharing their screen, or the active speaker) is big
 *  and everyone else is in a strip beside it. */
export function Stage({ call, peers, spotlight, layout, hideSelf, onMessage }: { call: Call; peers: Peer[]; spotlight: string | null; layout: 'gallery' | 'speaker'; hideSelf: boolean; onMessage: (id: string) => void }) {
  const [pin, setPin] = useState<string | null>(null)   // "id:kind"
  const [talk, setTalk] = useState<Record<string, boolean>>({})
  const lastTalker = useRef<string | null>(null)
  const onTalk = (id: string, v: boolean) => { if (v) lastTalker.current = id; setTalk((t) => (t[id] === v ? t : { ...t, [id]: v })) }
  void talk

  const shown = hideSelf && peers.length > 1 ? peers.filter((p) => !p.self) : peers
  const main = useMemo(() => {
    const byKey = (k: string | null) => { if (!k) return null; const [id, kind] = k.split(':'); const p = shown.find((x) => x.id === id); return p ? { peer: p, kind: kind as Kind } : null }
    const spot = spotlight ? shown.find((p) => p.id === spotlight) : null
    if (spot) return { peer: spot, kind: 'cam' as Kind }
    const pinned = byKey(pin)
    if (pinned && (pinned.kind === 'cam' || pinned.peer.screenStream)) return pinned
    const sharer = shown.find((p) => p.screen && p.screenStream)
    if (sharer) return { peer: sharer, kind: 'screen' as Kind }
    if (layout === 'speaker' && shown.length > 1) {
      const talker = shown.find((p) => p.id === lastTalker.current && !p.self) ?? shown.find((p) => !p.self) ?? shown[0]
      return { peer: talker, kind: 'cam' as Kind }
    }
    return null
  }, [shown, spotlight, pin, layout, Object.values(talk).join('')])   // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string, kind: Kind) => setPin((p) => (p === `${id}:${kind}` ? null : `${id}:${kind}`))
  const tile = (p: Peer, kind: Kind, big = false) => (
    <Tile key={`${p.id}:${kind}`} call={call} onMessage={onMessage} peer={p} kind={kind} big={big} pinned={pin === `${p.id}:${kind}`} spotlight={spotlight === p.id} onPin={() => toggle(p.id, kind)} onTalk={onTalk} />)

  if (main) {
    const rest = shown.filter((p) => !(main.kind === 'cam' && p.id === main.peer.id))
    return (
      <div className="meet-spot">
        <div className="meet-main">{tile(main.peer, main.kind, true)}</div>
        <div className="meet-strip">{rest.map((p) => tile(p, 'cam'))}</div>
      </div>)
  }
  const cols = shown.length <= 1 ? 1 : shown.length <= 4 ? 2 : shown.length <= 9 ? 3 : 4
  return <div className="meet-grid" style={{ '--cols': cols } as React.CSSProperties}>{shown.map((p) => tile(p, 'cam'))}</div>
}

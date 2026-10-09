import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Check, Copy, Crown, LockOpen, MessageSquare, Mic, MicOff, MonitorUp, MonitorX, PhoneOff, Send, UserX, Users, Video, VideoOff, X } from 'lucide-react'
import { api, ApiError, type MeetInfo, type MeetJoin } from '../api'
import { useAuth } from '../auth'
import { Popover } from '../ui/Popover'
import { askConfirm } from '../ui/Dialogs'
import { toast } from '../ui/Toast'
import { MeshCall } from './mesh'
import { RtkCall } from './rtk'
import { deviceProblem, watchSpeaking, type Call, type LocalTracks, type Peer } from './types'
import './meet.css'

const hue = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h }
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?'
const canShare = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="meet-shell">{children}</div>
}

function Notice({ title, text, children }: { title: string; text?: string; children?: React.ReactNode }) {
  return (
    <Shell>
      <div className="meet-card rise">
        <h1>{title}</h1>
        {text && <p className="muted">{text}</p>}
        <div className="meet-actions">{children}</div>
      </div>
    </Shell>
  )
}

export function MeetPage() {
  const { code = '' } = useParams()
  const { user, loading } = useAuth()
  const [info, setInfo] = useState<MeetInfo | null>(null)
  const [err, setErr] = useState('')
  const [call, setCall] = useState<Call | null>(null)
  const [rejoin, setRejoin] = useState(0)

  useEffect(() => {
    if (loading) return
    setErr(''); setInfo(null)
    api.meetInfo(code).then(setInfo).catch((e: Error) => setErr(e.message))
  }, [code, loading, user?.id, rejoin])
  useEffect(() => { document.title = info ? `${info.title} · Meet` : 'Meet' }, [info])

  if (loading || (!info && !err)) return <Shell><span className="spinner" /></Shell>
  if (err || !info) return <Notice title="Can't open this meeting" text={err || 'Something went wrong.'}><Link className="btn btn-primary btn-pill" to="/">Go home</Link></Notice>
  if (info.ended) return <Notice title="This meeting has ended" text="The host closed it, so the link no longer works."><Link className="btn btn-primary btn-pill" to="/">Go home</Link></Notice>
  if (call) return <InCall key={rejoin} code={code} info={info} call={call} onDone={() => { setCall(null); setRejoin((n) => n + 1) }} />
  return <Lobby code={code} info={info} onJoined={setCall} />
}

// ───────────────────────────── before joining

function Lobby({ code, info, onJoined }: { code: string; info: MeetInfo; onJoined: (c: Call) => void }) {
  const { user } = useAuth()
  const [name, setName] = useState('')
  const [mic, setMic] = useState(false)
  const [cam, setCam] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const tracks = useRef<LocalTracks>({ audio: null, video: null })
  const [preview, setPreview] = useState<MediaStream | null>(null)
  const video = useRef<HTMLVideoElement>(null)
  const pending = useRef<Promise<unknown>[]>([])   // devices still starting: joining waits for them so they aren't lost

  useEffect(() => { if (video.current) video.current.srcObject = preview }, [preview])
  useEffect(() => () => { tracks.current.audio?.stop(); tracks.current.video?.stop() }, [])
  const refresh = () => setPreview(tracks.current.video ? new MediaStream([tracks.current.video]) : null)

  const toggleMic = () => { const p = micToggle(); pending.current.push(p); return p }
  const toggleCam = () => { const p = camToggle(); pending.current.push(p); return p }
  const micToggle = async () => {
    if (mic) { tracks.current.audio?.stop(); tracks.current.audio = null; setMic(false); return }
    try { tracks.current.audio = (await navigator.mediaDevices.getUserMedia({ audio: true })).getAudioTracks()[0]; setMic(true) } catch (e) { toast(deviceProblem(e, 'microphone')) }
  }
  const camToggle = async () => {
    if (cam) { tracks.current.video?.stop(); tracks.current.video = null; setCam(false); refresh(); return }
    try { tracks.current.video = (await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } })).getVideoTracks()[0]; setCam(true); refresh() } catch (e) { toast(deviceProblem(e, 'camera')) }
  }

  const join = async () => {
    const who = (user?.name ?? name).trim()
    if (!who) { setError('Enter your name'); return }
    setBusy(true); setError('')
    try {
      await Promise.allSettled(pending.current)
      const j: MeetJoin = await api.meetJoin(code, who)
      const local = tracks.current
      tracks.current = { audio: null, video: null }   // handed over: the call owns them now
      setPreview(null)
      if (j.provider === 'realtimekit') onJoined(await RtkCall.start(j, local))
      else onJoined(new MeshCall(code, j, local, !!user))
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'Could not join')
      setBusy(false)
    }
  }

  if (!user && info.can_join === false) {
    return <Notice title="Sign in to join" text={`${info.host_name || 'The host'} only lets signed-in people into this meeting.`}>
      <Link className="btn btn-primary btn-pill" to="/login" state={{ from: `/m/${code}` }}>Sign in</Link></Notice>
  }

  return (
    <Shell>
      <div className="meet-lobby rise">
        <div className="meet-preview">
          <video ref={video} autoPlay playsInline muted className={preview ? '' : 'off'} />
          {!preview && <div className="meet-avatar big" style={{ '--h': hue(user?.name ?? (name || 'x')) } as React.CSSProperties}>{initials(user?.name ?? name)}</div>}
          <div className="meet-preview-bar">
            <button className={`meet-ctl ${mic ? '' : 'off'}`} onClick={toggleMic} aria-label={mic ? 'Turn off microphone' : 'Turn on microphone'}>{mic ? <Mic size={20} /> : <MicOff size={20} />}</button>
            <button className={`meet-ctl ${cam ? '' : 'off'}`} onClick={toggleCam} aria-label={cam ? 'Turn off camera' : 'Turn on camera'}>{cam ? <Video size={20} /> : <VideoOff size={20} />}</button>
          </div>
        </div>
        <div className="meet-join">
          <h1>{info.title}</h1>
          <p className="muted">Hosted by {info.host_name || 'someone'}</p>
          {user ? <p className="meet-as">Joining as <b>{user.name}</b></p> : (
            <label className="meet-name"><span>Your name</span>
              <span className="field"><input value={name} maxLength={60} placeholder="Name" autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void join()} /></span></label>)}
          {error && <p className="form-error">{error}</p>}
          <button className="btn btn-primary btn-pill btn-lg" disabled={busy} onClick={join}>{busy ? <span className="spinner sm" /> : 'Join now'}</button>
          {!user && <p className="muted small">Have an account? <Link to="/login" state={{ from: `/m/${code}` }}>Sign in</Link></p>}
          <p className="meet-enc"><LockOpen size={14} />Calls aren't end-to-end encrypted.</p>
        </div>
      </div>
    </Shell>
  )
}

// ───────────────────────────── in the call

function useCall(call: Call) {
  const [, force] = useReducer((n: number) => n + 1, 0)
  useEffect(() => call.subscribe(force), [call])
  useEffect(() => call.onProblem((m) => toast(m)), [call])
}

function Tile({ peer, kind, onPick }: { peer: Peer; kind: 'cam' | 'screen'; onPick?: () => void }) {
  const el = useRef<HTMLVideoElement>(null)
  const [talking, setTalking] = useState(false)
  const stream = kind === 'screen' ? peer.screenStream : peer.stream
  useEffect(() => {
    const v = el.current
    if (!v) return
    if (v.srcObject !== stream) v.srcObject = stream
    if (stream) void v.play().catch(() => {})
  }, [stream])
  useEffect(() => {
    if (kind !== 'cam' || peer.self || !stream || !peer.audio) { setTalking(false); return }
    return watchSpeaking(stream, setTalking)
  }, [stream, peer.self, peer.audio, kind])
  const showVideo = kind === 'screen' ? !!stream : peer.video && !!stream
  return (
    <div className={`meet-tile ${kind} ${talking ? 'talking' : ''} ${peer.self && kind === 'cam' ? 'self' : ''}`} onClick={onPick}>
      <video ref={el} autoPlay playsInline muted={peer.self || kind === 'screen'} className={showVideo ? '' : 'off'} />
      {!showVideo && <div className="meet-avatar" style={{ '--h': hue(peer.name) } as React.CSSProperties}>{initials(peer.name)}</div>}
      <div className="meet-label">
        {kind === 'cam' && !peer.audio && <MicOff size={14} />}
        <span>{kind === 'screen' ? `${peer.self ? 'You are' : peer.name + ' is'} presenting` : peer.self ? `${peer.name} (you)` : peer.name}</span>
        {peer.host && kind === 'cam' && <Crown size={13} aria-label="Host" />}
      </div>
    </div>
  )
}

function InCall({ code, info, call, onDone }: { code: string; info: MeetInfo; call: Call; onDone: () => void }) {
  useCall(call)
  const nav = useNavigate()
  const [panel, setPanel] = useState<'chat' | 'people' | null>(null)
  const [read, setRead] = useState(0)
  const [text, setText] = useState('')
  const [copied, setCopied] = useState(false)
  const log = useRef<HTMLDivElement>(null)

  const status = call.status(), end = call.endReason()
  const peers = call.peers()
  const msgs = call.chat()
  const me = peers[0]

  useEffect(() => {   // keep the screen awake while on a call
    let lock: { release: () => Promise<void> } | null = null
    const get = async () => { try { lock = await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen') ?? null } catch { /* not allowed */ } }
    void get()
    const vis = () => { if (document.visibilityState === 'visible') void get() }
    document.addEventListener('visibilitychange', vis)
    return () => { document.removeEventListener('visibilitychange', vis); void lock?.release() }
  }, [])
  const alive = useRef(true)
  useEffect(() => {   // leaving the page by any route ends your part of the call (the short delay lets React's dev double-mount pass)
    alive.current = true
    const bye = () => call.leave()
    window.addEventListener('pagehide', bye)
    return () => { window.removeEventListener('pagehide', bye); alive.current = false; setTimeout(() => { if (!alive.current) call.leave() }, 80) }
  }, [call])
  useEffect(() => { if (panel === 'chat') setRead(msgs.length) }, [panel, msgs.length])
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }) }, [msgs.length, panel])

  const link = `${location.origin}/m/${code}`
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { toast(link) } }
  const submit = () => { if (text.trim()) { call.send(text); setText('') } }
  const leave = () => { call.leave(); onDone() }
  const endAll = async () => {
    if (!(await askConfirm({ title: 'End the meeting for everyone?', text: 'Everyone is disconnected and the link stops working.', label: 'End for everyone', danger: true }))) return
    try { await api.meetEnd(code) } catch (e) { toast((e as Error).message) }
    call.leave(); onDone()
  }

  const stage = useMemo(() => {
    const screens = peers.filter((p) => p.screen && p.screenStream)
    return { screens, spot: screens[0] ?? null }
  }, [peers])

  if (end && end !== 'left') {
    const t = { ended: ['The host ended this meeting', ''], kicked: ['You were removed from this meeting', ''], failed: ['The connection was lost', "We couldn't reconnect you."], full: ['This meeting is full', 'Try again in a moment.'] } as Record<string, [string, string]>
    const [title, sub] = t[end] ?? ['The call stopped', '']
    return <Notice title={title} text={sub}>
      {end !== 'ended' && end !== 'kicked' && <button className="btn btn-primary btn-pill" onClick={onDone}>Rejoin</button>}
      <button className="btn btn-ghost btn-pill" onClick={() => nav('/')}>Leave</button></Notice>
  }

  const cols = peers.length <= 1 ? 1 : peers.length <= 4 ? 2 : peers.length <= 9 ? 3 : 4
  const camTiles = peers.map((p) => <Tile key={p.id} peer={p} kind="cam" />)
  const unread = Math.max(0, msgs.length - read)

  return (
    <div className="meet-call">
      <header className="meet-top">
        <div className="meet-title"><b>{info.title}</b><button className="meet-code" onClick={copy} title="Copy the meeting link">{code}{copied ? <Check size={13} /> : <Copy size={13} />}</button></div>
        <span className="meet-chip" title="Audio and video aren't end-to-end encrypted: the call service can carry them."><LockOpen size={13} />Not encrypted</span>
        {status === 'reconnecting' && <span className="meet-chip warn"><span className="spinner sm" />Reconnecting…</span>}
      </header>

      <div className="meet-body">
        <main className={`meet-stage ${stage.spot ? 'spot' : ''}`} style={{ '--cols': cols } as React.CSSProperties}>
          {status === 'connecting' ? <div className="meet-wait"><span className="spinner" />Connecting…</div> : stage.spot ? (
            <>
              <div className="meet-main"><Tile peer={stage.spot} kind="screen" /></div>
              <div className="meet-strip">{camTiles}</div>
            </>
          ) : <div className="meet-grid">{camTiles}</div>}
          {status !== 'connecting' && peers.length === 1 && (
            <div className="meet-alone"><p>You're the only one here.</p><button className="btn btn-soft btn-pill btn-sm" onClick={copy}>{copied ? <Check size={15} /> : <Copy size={15} />}Copy the link</button></div>)}
        </main>

        {panel && (
          <aside className="meet-panel" aria-label={panel === 'chat' ? 'Chat' : 'People'}>
            <div className="meet-panel-head">
              <div className="tabs">
                <button className={panel === 'chat' ? 'on' : ''} onClick={() => setPanel('chat')}>Chat</button>
                <button className={panel === 'people' ? 'on' : ''} onClick={() => setPanel('people')}>People ({peers.length})</button>
              </div>
              <button className="icon-btn sm" onClick={() => setPanel(null)} aria-label="Close"><X size={16} /></button>
            </div>
            {panel === 'chat' ? (
              <>
                <div className="meet-log" ref={log}>
                  {msgs.length === 0 && <p className="muted center">Messages are only kept while the meeting is open.</p>}
                  {msgs.map((m) => (
                    <div key={m.id} className={`meet-msg ${m.self ? 'mine' : ''}`}>
                      <div className="meta"><b>{m.self ? 'You' : m.name}</b><time>{new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
                      <p>{m.text}</p>
                    </div>))}
                </div>
                <form className="meet-send" onSubmit={(e) => { e.preventDefault(); submit() }}>
                  <span className="field"><input value={text} maxLength={2000} placeholder="Message everyone" onChange={(e) => setText(e.target.value)} /></span>
                  <button className="icon-btn" type="submit" aria-label="Send" disabled={!text.trim()}><Send size={18} /></button>
                </form>
              </>
            ) : (
              <div className="meet-people">
                {peers.map((p) => (
                  <div key={p.id} className="meet-person">
                    <span className="meet-avatar sm" style={{ '--h': hue(p.name) } as React.CSSProperties}>{initials(p.name)}</span>
                    <span className="name">{p.self ? `${p.name} (you)` : p.name}{p.host && <Crown size={13} aria-label="Host" />}</span>
                    {!p.audio && <MicOff size={15} className="muted" />}
                    {call.canModerate && !p.self && (<>
                      {p.audio && <button className="icon-btn sm" title="Mute" aria-label={`Mute ${p.name}`} onClick={() => call.mute(p.id)}><MicOff size={15} /></button>}
                      <button className="icon-btn sm" title="Remove from meeting" aria-label={`Remove ${p.name}`} onClick={() => void askConfirm({ title: `Remove ${p.name}?`, text: 'They are disconnected, and can rejoin with the link.', label: 'Remove', danger: true }).then((y) => y && call.kick(p.id))}><UserX size={15} /></button>
                    </>)}
                  </div>))}
                <button className="btn btn-soft btn-pill btn-sm" onClick={copy}>{copied ? <Check size={15} /> : <Copy size={15} />}Copy the meeting link</button>
              </div>
            )}
          </aside>)}
      </div>

      <footer className="meet-bar">
        <button className={`meet-ctl ${me?.audio ? '' : 'off'}`} onClick={() => void call.setMic(!me?.audio)} aria-label={me?.audio ? 'Mute' : 'Unmute'} title={me?.audio ? 'Mute' : 'Unmute'}>{me?.audio ? <Mic size={20} /> : <MicOff size={20} />}</button>
        <button className={`meet-ctl ${me?.video ? '' : 'off'}`} onClick={() => void call.setCam(!me?.video)} aria-label={me?.video ? 'Turn off camera' : 'Turn on camera'} title={me?.video ? 'Turn off camera' : 'Turn on camera'}>{me?.video ? <Video size={20} /> : <VideoOff size={20} />}</button>
        {canShare && <button className={`meet-ctl ${me?.screen ? 'on' : ''}`} onClick={() => (me?.screen ? call.stopScreen() : void call.shareScreen())} aria-label={me?.screen ? 'Stop presenting' : 'Present your screen'} title={me?.screen ? 'Stop presenting' : 'Present your screen'}>{me?.screen ? <MonitorX size={20} /> : <MonitorUp size={20} />}</button>}
        <button className={`meet-ctl ${panel === 'chat' ? 'on' : ''}`} onClick={() => setPanel(panel === 'chat' ? null : 'chat')} aria-label="Chat" title="Chat"><MessageSquare size={20} />{unread > 0 && panel !== 'chat' && <i className="meet-dot">{unread > 9 ? '9+' : unread}</i>}</button>
        <button className={`meet-ctl ${panel === 'people' ? 'on' : ''}`} onClick={() => setPanel(panel === 'people' ? null : 'people')} aria-label="People" title="People"><Users size={20} /></button>
        {info.is_host ? (
          <Popover align="end" trigger={({ toggle }) => <button className="meet-ctl hang" onClick={toggle} aria-label="Leave"><PhoneOff size={20} /></button>}>
            {(close) => (
              <div className="menu wide">
                <button onClick={() => { close(); leave() }}><PhoneOff size={17} />Leave, the meeting continues</button>
                <button className="danger" onClick={() => { close(); void endAll() }}><X size={17} />End for everyone</button>
              </div>)}
          </Popover>
        ) : <button className="meet-ctl hang" onClick={leave} aria-label="Leave" title="Leave"><PhoneOff size={20} /></button>}
      </footer>
    </div>
  )
}

/** The meeting code in whatever someone pasted: the code itself or a whole link. */
export function parseMeetCode(input: string): string | null {
  const m = input.toLowerCase().match(/[a-z2-9]{3}-[a-z2-9]{4}-[a-z2-9]{3}/)
  return m ? m[0] : null
}

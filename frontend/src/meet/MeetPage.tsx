import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Circle, Clock, LockOpen, Mic, MicOff, Settings2, Video, VideoOff } from 'lucide-react'
import { api, ApiError, type MeetInfo } from '../api'
import { useAuth } from '../auth'
import { Modal } from '../ui/Modal'
import { toast } from '../ui/Toast'
import { Logo } from '../ui/Logo'
import { ConsentModal } from './Consent'
import { DevicePicker } from './Devices'
import { InCall } from './InCall'
import { Session } from './session'
import { deviceProblem, type Call, type LocalTracks } from './types'
import { hue, initials, useCall } from './util'
import './meet.css'

export { parseMeetCode } from './util'

const NAME_KEY = 'koko.meetname'
const readName = () => { try { return localStorage.getItem(NAME_KEY) ?? '' } catch { return '' } }

/** The page around everything before the call: a bar with the KokoDocs name and a way back, then the content. */
function Shell({ children }: { children: React.ReactNode }) {
  const nav = useNavigate()
  const { user } = useAuth()
  const back = () => { if (window.history.length > 1) nav(-1); else nav('/') }
  return (
    <div className="meet-page">
      <header className="meet-site">
        <button className="btn btn-ghost btn-pill btn-sm" onClick={back} aria-label="Go back"><ArrowLeft size={15} />Back</button>
        <Link to="/" className="brand" aria-label="KokoDocs home"><Logo size={28} /><span>KokoDocs</span></Link>
        <span className="grow" />
        {!user && <Link to="/login" className="btn btn-soft btn-pill btn-sm">Sign in</Link>}
      </header>
      <div className="meet-shell">{children}</div>
    </div>
  )
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
  const [round, setRound] = useState(0)
  const [captions, setCaptions] = useState(false)

  useEffect(() => {
    if (loading) return
    setErr(''); setInfo(null)
    api.meetInfo(code).then(setInfo).catch((e: Error) => setErr(e.message))
    api.meetConfig().then((c) => setCaptions(c.captions)).catch(() => {})
  }, [code, loading, user?.id, round])
  useEffect(() => { document.title = info ? `${info.title} · Meet` : 'Meet' }, [info])

  if (loading || (!info && !err)) return <Shell><span className="spinner" /></Shell>
  if (err || !info) return <Notice title="Can't open this meeting" text={err || 'Something went wrong.'}><Link className="btn btn-primary btn-pill" to="/">Go home</Link></Notice>
  if (info.ended) return <Notice title="This meeting has ended" text="The host closed it, so the link no longer works."><Link className="btn btn-primary btn-pill" to="/">Go home</Link></Notice>
  if (call) return <Joined key={round} call={call} info={info} captions={captions} onDone={() => { setCall(null); setRound((n) => n + 1) }} />
  return <Lobby code={code} info={info} onJoined={setCall} />
}

// ───────────────────────────── before joining

function Lobby({ code, info, onJoined }: { code: string; info: MeetInfo; onJoined: (c: Call) => void }) {
  const { user } = useAuth()
  const [name, setName] = useState(readName())
  const [passcode, setPasscode] = useState('')
  const [askPass, setAskPass] = useState(info.has_passcode && !info.is_host && !info.is_cohost)
  const [mic, setMic] = useState(false)
  const [cam, setCam] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [devices, setDevices] = useState(false)
  const [asking, setAsking] = useState(false)
  const tracks = useRef<LocalTracks>({ audio: null, video: null })
  const ids = useRef({ mic: '', cam: '' })
  const [preview, setPreview] = useState<MediaStream | null>(null)
  const video = useRef<HTMLVideoElement>(null)
  const pending = useRef<Promise<unknown>[]>([])   // devices still starting: joining waits for them so they aren't lost

  useEffect(() => { if (video.current) video.current.srcObject = preview }, [preview])
  useEffect(() => () => { tracks.current.audio?.stop(); tracks.current.video?.stop() }, [])
  const refresh = () => setPreview(tracks.current.video ? new MediaStream([tracks.current.video]) : null)

  const getMic = async () => { tracks.current.audio?.stop(); tracks.current.audio = (await navigator.mediaDevices.getUserMedia({ audio: ids.current.mic ? { deviceId: { exact: ids.current.mic } } : true })).getAudioTracks()[0]; setMic(true) }
  const getCam = async () => { tracks.current.video?.stop(); tracks.current.video = (await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, ...(ids.current.cam ? { deviceId: { exact: ids.current.cam } } : {}) } })).getVideoTracks()[0]; setCam(true); refresh() }
  const run = (p: Promise<unknown>) => { pending.current.push(p); return p }
  const toggleMic = () => run((async () => {
    if (mic) { tracks.current.audio?.stop(); tracks.current.audio = null; setMic(false); return }
    try { await getMic() } catch (e) { toast(deviceProblem(e, 'microphone')) }
  })())
  const toggleCam = () => run((async () => {
    if (cam) { tracks.current.video?.stop(); tracks.current.video = null; setCam(false); refresh(); return }
    try { await getCam() } catch (e) { toast(deviceProblem(e, 'camera')) }
  })())

  const join = async (agreed?: boolean) => {
    const who = (user?.name ?? name).trim()
    if (!who) { setError('Enter your name'); return }
    const watched = !!info.recording && !info.is_host && agreed === undefined
    if (watched) { setError(''); setAsking(true); return }   // the meeting is being recorded: ask before they even join
    setBusy(true); setError('')
    try {
      await Promise.allSettled(pending.current)
      const ticket = await api.meetJoin(code, who, passcode)
      if (!user) { try { localStorage.setItem(NAME_KEY, who) } catch { /* not saved */ } }
      const local: LocalTracks = { ...tracks.current, micId: ids.current.mic, camId: ids.current.cam }
      tracks.current = { audio: null, video: null }   // handed over: the call owns them now
      setPreview(null)
      onJoined(new Session(code, ticket, local, agreed))
    } catch (e) {
      if (e instanceof ApiError && e.code === 'passcode') setAskPass(true)
      setError(e instanceof Error ? e.message : 'Could not join')
      setBusy(false)
    }
  }

  if (!user && info.can_join === false) {
    return <Notice title="Sign in to join" text={`${info.host_name || 'The host'} hasn't allowed people without an account into this meeting. Sign in, or ask them to allow guests.`}>
      <Link className="btn btn-primary btn-pill" to="/login" state={{ from: `/m/${code}` }}>Sign in</Link></Notice>
  }
  const who = user?.name ?? name
  return (
    <Shell>
      <div className="meet-lobby rise">
        <div>
          <div className="meet-preview">
            <video ref={video} autoPlay playsInline muted className={preview ? '' : 'off'} />
            {!preview && <div className="meet-avatar big" style={{ '--h': hue(who || 'x') } as React.CSSProperties}>{initials(who)}</div>}
            <div className="meet-preview-bar">
              <button className={`meet-ctl ${mic ? '' : 'off'}`} onClick={toggleMic} aria-label={mic ? 'Turn off microphone' : 'Turn on microphone'}>{mic ? <Mic size={20} /> : <MicOff size={20} />}</button>
              <button className={`meet-ctl ${cam ? '' : 'off'}`} onClick={toggleCam} aria-label={cam ? 'Turn off camera' : 'Turn on camera'}>{cam ? <Video size={20} /> : <VideoOff size={20} />}</button>
              <button className="meet-ctl" onClick={() => setDevices(true)} aria-label="Choose microphone, camera and speaker" title="Devices"><Settings2 size={20} /></button>
            </div>
          </div>
        </div>
        <div className="meet-join">
          <h1>{info.title}</h1>
          <p className="muted">Hosted by {info.host_name || 'someone'}{info.permanent ? ' · permanent meeting' : ''}{info.is_cohost ? ' · you are a co-host' : ''}</p>
          {info.recording && !info.is_host && <p className="meet-hint rec"><Circle size={12} fill="currentColor" />This meeting is being recorded.</p>}
          {info.approval && !info.is_host && !info.is_cohost && <p className="meet-hint"><Clock size={14} />The host will let you in.</p>}
          {user ? <p className="meet-as">Joining as <b>{user.name}</b></p> : (
            <label className="meet-name"><span>What should we call you?</span>
              <span className="field"><input value={name} maxLength={60} placeholder="Your name" autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void join()} /></span>
              <span className="muted small">You're joining without an account. The host and everyone else will see this name.</span></label>)}
          {askPass && (
            <label className="meet-name"><span>Meeting passcode</span>
              <span className="field"><input type="password" value={passcode} maxLength={64} placeholder="Passcode" autoComplete="off" onChange={(e) => setPasscode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void join()} /></span></label>)}
          {error && <p className="form-error">{error}</p>}
          <button className="btn btn-primary btn-pill btn-lg" disabled={busy} onClick={() => void join()}>{busy ? <span className="spinner sm" /> : info.approval && !info.is_host && !info.is_cohost ? 'Ask to join' : 'Join now'}</button>
          {!user && <p className="muted small">Have an account? <Link to="/login" state={{ from: `/m/${code}` }}>Sign in</Link></p>}
          <p className="meet-enc"><LockOpen size={14} />Calls aren't end-to-end encrypted.</p>
        </div>
      </div>
      {asking && <ConsentModal required={info.recording?.required ?? false} onAnswer={(a) => { setAsking(false); if (!a && info.recording?.required) setError("You can't join this meeting without agreeing to be recorded."); else void join(a) }} />}
      {devices && (
        <Modal title="Microphone, camera and speaker" onClose={() => setDevices(false)} width={440}>
          <div className="share-body">
            <DevicePicker load={async () => {
              const { listDevices } = await import('./media')
              return listDevices({ mic: tracks.current.audio?.getSettings().deviceId ?? '', cam: tracks.current.video?.getSettings().deviceId ?? '' })
            }}
              onMic={(id) => { ids.current.mic = id; if (mic) void run(getMic().catch((e) => toast(deviceProblem(e, 'microphone')))) }}
              onCam={(id) => { ids.current.cam = id; if (cam) void run(getCam().catch((e) => toast(deviceProblem(e, 'camera')))) }} />
          </div>
        </Modal>)}
    </Shell>
  )
}

// ───────────────────────────── in the room (or waiting for it)

const ENDS: Record<string, [string, string, boolean]> = {
  ended: ['The host ended this meeting', '', true],
  kicked: ['You were removed from this meeting', '', true],
  blocked: ['You were removed from this meeting', "You can't come back to it during this session.", false],
  denied: ["The host didn't let you in", '', false],
  declined: ['You left the meeting', "You didn't agree to be recorded, and this meeting requires everyone to.", false],
  locked: ['This meeting is locked', 'The host has stopped new people from joining.', true],
  full: ['This meeting is full', 'Try again in a moment.', true],
  failed: ['The connection was lost', "We couldn't reconnect you.", true],
  replaced: ['You joined from somewhere else', 'This meeting is open in another window or device.', false],
  left: ['You left the meeting', '', true],
}

function Joined({ call, info, captions, onDone }: { call: Call; info: MeetInfo; captions: boolean; onDone: () => void }) {
  useCall(call)
  const nav = useNavigate()
  const alive = useRef(true)
  useEffect(() => {   // leaving the page by any route ends your part of the call (the short delay lets React's dev double-mount pass)
    alive.current = true
    const bye = () => call.leave()
    window.addEventListener('pagehide', bye)
    return () => { window.removeEventListener('pagehide', bye); alive.current = false; setTimeout(() => { if (!alive.current) call.leave() }, 80) }
  }, [call])

  const status = call.status(), end = call.endReason()
  if (end) {
    const [title, text, again] = ENDS[end] ?? ['The call stopped', '', true]
    return <Notice title={title} text={end === 'ended' && call.permanent() ? 'This meeting stays open. You can join it again with the same link.' : text}>
      {again && <button className="btn btn-primary btn-pill" onClick={onDone}>{end === 'left' ? 'Rejoin' : 'Join again'}</button>}
      <button className="btn btn-ghost btn-pill" onClick={() => nav('/')}>Go home</button></Notice>
  }
  if (status === 'waiting') {
    const host = call.waitReason() === 'host'
    return (
      <Notice title={host ? 'Waiting for the host to start' : 'Waiting for the host to let you in'} text={`${call.title()} · you'll join automatically.`}>
        <span className="spinner" />
        <button className="btn btn-ghost btn-pill" onClick={() => { call.leave(); onDone() }}>Cancel</button></Notice>)
  }
  if (status === 'connecting') return <Shell><div className="meet-wait"><span className="spinner" />Joining…</div></Shell>
  return <InCall call={call} info={info} captionsAvailable={captions} onLeave={onDone} />
}

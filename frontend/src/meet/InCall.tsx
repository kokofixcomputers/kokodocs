import { useEffect, useMemo, useRef, useState } from 'react'
import { BarChart3, Captions, Circle, FileText, Lock as LockIcon, Presentation as PresentIcon, UserRound, Check, Copy, Hand, LayoutGrid, Lock, LockOpen, Maximize, MessageSquare, Mic, MicOff, MonitorUp, MonitorX, MoreVertical, PhoneOff, Settings2, Smile, SquareUser, Users, Video, VideoOff, Volume2, X, Keyboard, Download, EyeOff, Info } from 'lucide-react'
import { api, type MeetInfo, type MeetSettings } from '../api'
import { Modal } from '../ui/Modal'
import { Popover } from '../ui/Popover'
import { askConfirm } from '../ui/Dialogs'
import { toast } from '../ui/Toast'
import { ConsentModal } from './Consent'
import { ReportDialog } from './ReportDialog'
import { useAuth } from '../auth'
import { DevicePicker } from './Devices'
import { handsPipPref, setHandsPipPref, useHandsPip } from './HandsPip'
import { PersonPerms } from './PersonPerms'
import { SharePicker } from './SharePicker'
import { ChatPanel, PeoplePanel, PollsPanel } from './Panels'
import { SettingsForm } from './SettingsForm'
import { Stage } from './Stage'
import type { Call, Peer } from './types'
import { canShare, clock, download, inviteText, useCall } from './util'

type Panel = 'chat' | 'people' | 'polls' | null

function beep() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new AC(), o = ctx.createOscillator(), g = ctx.createGain()
    o.frequency.value = 880; g.gain.value = 0.06; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.14)
    setTimeout(() => void ctx.close(), 400)
  } catch { /* no sound */ }
}

function useTick(ms: number) { const [, set] = useState(0); useEffect(() => { const t = setInterval(() => set((n) => n + 1), ms); return () => clearInterval(t) }, [ms]) }

/** Emoji that float up the screen. */
function Floaters({ call }: { call: Call }) {
  const [items, setItems] = useState<{ k: number; emoji: string; name: string; x: number }[]>([])
  useEffect(() => call.onReact((from, emoji) => {
    const name = call.peers().find((p) => p.id === from)?.name ?? ''
    const k = Math.random()
    setItems((l) => [...l.slice(-30), { k, emoji, name, x: 6 + Math.random() * 70 }])
    setTimeout(() => setItems((l) => l.filter((i) => i.k !== k)), 3600)
  }), [call])
  return <div className="meet-floaters" aria-hidden>{items.map((i) => <div key={i.k} className="meet-float" style={{ left: `${i.x}%` }}><span>{i.emoji}</span><small>{i.name}</small></div>)}</div>
}

function Shortcuts({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [['M', 'Mute or unmute'], ['V', 'Camera on or off'], ['S', 'Present your screen'], ['H', 'Raise or lower your hand'], ['C', 'Chat'], ['P', 'People'], ['F', 'Full screen'], ['Esc', 'Close the side panel']]
  return <Modal title="Keyboard shortcuts" onClose={onClose} width={380}><div className="meet-keys">{rows.map(([k, d]) => <div key={k}><kbd>{k}</kbd><span>{d}</span></div>)}</div></Modal>
}

function MeetingSettings({ code, call, onClose }: { code: string; call: Call; onClose: () => void }) {
  const [s, setS] = useState<MeetSettings | null>(null)
  const [cfg, setCfg] = useState({ guests: true, captions: true })
  useEffect(() => { void api.meetMine().then((l) => { const m = l.find((x) => x.code === code); if (m?.settings) setS(m.settings) }); void api.meetConfig().then(setCfg) }, [code])
  const change = (patch: Partial<MeetSettings>) => { setS((x) => (x ? { ...x, ...patch } : x)); api.meetEdit(code, { settings: patch }).catch((e) => toast((e as Error).message)) }
  return (
    <Modal title="Meeting settings" onClose={onClose} width={520}>
      <div className="share-body">
        <div className="switch-row"><div><b>Lock the meeting</b><span>Nobody new can join until you unlock it.</span></div>
          <button role="switch" aria-checked={!!call.settings().locked} aria-label="Lock the meeting" className={`toggle ${call.settings().locked ? 'on' : ''}`} onClick={() => call.lock(!call.settings().locked)} /></div>
        {s ? <SettingsForm s={s} onChange={change} guestsAllowed={cfg.guests} captionsAvailable={cfg.captions} /> : <span className="spinner" />}
        <p className="muted small">Changes apply right away, and are saved to this meeting. <a href={`/meetings/${code}#cohosts`} target="_blank" rel="noreferrer">Open the full settings page</a> to set co-hosts, a passcode and more.</p>
      </div>
    </Modal>)
}

export function InCall({ call, info, onLeave, captionsAvailable }: { call: Call; info: MeetInfo; onLeave: () => void; captionsAvailable: boolean }) {
  useCall(call)
  useTick(1000)
  const [panel, setPanel] = useState<Panel>(null)
  const [chatTo, setChatTo] = useState('')
  const [layout, setLayout] = useState<'gallery' | 'speaker'>('gallery')
  const [hideSelf, setHideSelf] = useState(false)
  const [showCaps, setShowCaps] = useState(true)
  const [modal, setModal] = useState<null | 'settings' | 'keys' | 'devices' | 'record' | 'report'>(null)
  const [reask, setReask] = useState(false)
  const [permsFor, setPermsFor] = useState<Peer | null>(null)
  const [picker, setPicker] = useState<null | 'collab' | 'present'>(null)
  const [recBusy, setRecBusy] = useState(false)
  const [needAll, setNeedAll] = useState(false)
  const [copied, setCopied] = useState(false)
  const seen = useRef({ chat: 0, polls: 0, waiting: 0 })
  const [unread, setUnread] = useState({ chat: 0, polls: 0 })

  const peers = call.peers(), me = call.me(), s = call.settings(), status = call.status()
  const self = peers[0]
  const msgs = call.chat(), polls = call.polls(), waiting = call.waiting()
  const code = call.code
  const { user } = useAuth()
  const [soundBlocked, setSoundBlocked] = useState(false)
  useEffect(() => { const on = () => setSoundBlocked(true); window.addEventListener('koko:sound-blocked', on); return () => window.removeEventListener('koko:sound-blocked', on) }, [])
  const [joinedAt] = useState(() => Date.now())
  const pip = useHandsPip(call, call.me().manager)
  const [pipPref, setPipPref] = useState(handsPipPref())
  const rec = call.recording()
  const perms = call.perms()
  const sharing = call.share()
  const mineShare = !!sharing && (sharing.by_id === me.id || me.manager)
  const mode = s.recording
  const canRecord = mode === 'managers' ? me.manager : mode === 'host' ? me.owner : false
  const inCharge = !!rec?.mine || me.owner   // the recorder and the host are never asked to agree
  const mustAnswer = !!rec && !inCharge && call.consent() === null

  // unread counters and the waiting-room alert
  useEffect(() => {
    if (panel === 'chat') seen.current.chat = msgs.length
    if (panel === 'polls') seen.current.polls = polls.length
    setUnread({ chat: Math.max(0, msgs.length - seen.current.chat), polls: Math.max(0, polls.length - seen.current.polls) })
  }, [msgs.length, polls.length, panel])
  useEffect(() => {
    if (!me.manager) { seen.current.waiting = 0; return }
    if (waiting.length > seen.current.waiting) { toast(`${waiting[waiting.length - 1].name} is waiting to join`); beep() }
    seen.current.waiting = waiting.length
  }, [waiting.length, me.manager]) // eslint-disable-line react-hooks/exhaustive-deps

  const handCount = peers.filter((p) => p.hand > 0).length
  const lastHands = useRef(0)
  useEffect(() => {   // a manager who isn't looking at the meeting hears when a hand goes up
    if (me.manager && handCount > lastHands.current && (document.hidden || pip.isOpen)) beep()
    lastHands.current = handCount
  }, [handCount, me.manager]) // eslint-disable-line react-hooks/exhaustive-deps

  // keep the screen awake
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null
    const get = async () => { try { lock = await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen') ?? null } catch { /* not allowed */ } }
    void get()
    const vis = () => { if (document.visibilityState === 'visible') void get() }
    document.addEventListener('visibilitychange', vis)
    return () => { document.removeEventListener('visibilitychange', vis); void lock?.release() }
  }, [])

  const toggleHand = () => call.hand(!(self?.hand))
  const toggleShare = () => (self?.screen ? call.stopScreen() : void call.shareScreen())
  const open = (p: Panel) => setPanel((cur) => (cur === p ? null : p))
  const fullscreen = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen().catch(() => {}) }

  useEffect(() => {   // keyboard shortcuts
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) || e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 'm') void call.setMic(!self?.audio)
      else if (k === 'v') void call.setCam(!self?.video)
      else if (k === 's' && canShare) toggleShare()
      else if (k === 'h') toggleHand()
      else if (k === 'c') open('chat')
      else if (k === 'p') open('people')
      else if (k === 'f') fullscreen()
      else if (k === 'escape') setPanel(null)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  })

  const link = `${location.origin}/m/${code}`
  const copy = async () => { try { await navigator.clipboard.writeText(inviteText(call.title(), code, info.passcode)); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { toast(link) } }
  const leave = () => { call.leave(); onLeave() }
  const endAll = async () => {
    const perm = call.permanent()
    if (!(await askConfirm({ title: perm ? 'End this session for everyone?' : 'End the meeting for everyone?', text: perm ? 'Everyone is disconnected. The meeting stays on your account with the same link and settings.' : 'Everyone is disconnected and the link stops working.', label: 'End for everyone', danger: true }))) return
    try { await api.meetEnd(code) } catch (e) { toast((e as Error).message) }
    leave()
  }

  const recent = useMemo(() => call.captions().filter((c) => Date.now() - c.ts < 7000).slice(-3), [call.captions().length, Math.floor(Date.now() / 1000)]) // eslint-disable-line react-hooks/exhaustive-deps
  const capsOn = !!s.captions_on
  const startRecording = async () => {
    setRecBusy(true)
    try {
      if (me.owner && needAll !== !!s.record_consent) await api.meetEdit(code, { settings: { record_consent: needAll } })
      await call.record(true)
      setModal(null)
    } catch (e) { toast((e as Error).message) } finally { setRecBusy(false) }
  }
  const transcript = () => {
    const t0 = call.started()
    download(`${call.title() || 'meeting'} transcript.txt`, call.captions().map((c) => `[${clock(c.ts - t0)}] ${c.name}: ${c.text}`).join('\n'))
  }

  const moreMenu = (close: () => void) => {
    const go = (f: () => void) => () => { close(); f() }
    return (
      <div className="menu wide">
        <button className="meet-only-m" onClick={go(toggleHand)}><Hand size={17} />{self?.hand ? 'Lower your hand' : 'Raise your hand'}</button>
        <button className="meet-only-m" onClick={go(() => open('polls'))}><BarChart3 size={17} />Polls</button>
        <button onClick={go(() => setLayout(layout === 'gallery' ? 'speaker' : 'gallery'))}>{layout === 'gallery' ? <SquareUser size={17} /> : <LayoutGrid size={17} />}{layout === 'gallery' ? 'Speaker view' : 'Gallery view'}</button>
        <button onClick={go(() => setHideSelf(!hideSelf))}><EyeOff size={17} />{hideSelf ? 'Show my video' : 'Hide my video from me'}</button>
        <button onClick={go(fullscreen)}><Maximize size={17} />Full screen</button>
        <button onClick={go(() => setModal('devices'))}><Volume2 size={17} />Microphone, camera and speaker</button>
        {canRecord && (rec ? (rec.mine ? <button onClick={go(() => void call.record(false))}><Circle size={17} />Stop recording</button> : null) : <button onClick={go(() => { setNeedAll(!!s.record_consent); setModal('record') })}><Circle size={17} />Record the meeting</button>)}
        {s.captions && captionsAvailable && (<>
          <div className="menu-sep" />
          {me.manager && <button onClick={go(() => call.captionsOn(!capsOn))}><Captions size={17} />{capsOn ? 'Stop live captions' : 'Start live captions for everyone'}</button>}
          {capsOn && <button onClick={go(() => setShowCaps(!showCaps))}><Captions size={17} />{showCaps ? 'Hide captions for me' : 'Show captions'}</button>}
          {call.captions().length > 0 && <button onClick={go(transcript)}><Download size={17} />Download the transcript</button>}
        </>)}
        {me.manager && (<>
          <div className="menu-sep" />
          <button onClick={go(() => call.lock(!s.locked))}>{s.locked ? <LockOpen size={17} /> : <Lock size={17} />}{s.locked ? 'Unlock the meeting' : 'Lock the meeting'}</button>
          <button onClick={go(() => void askConfirm({ title: 'Mute everyone?', text: "Everyone except hosts is muted. They can unmute themselves unless you change that in the meeting settings.", label: 'Mute everyone' }).then((y) => y && call.muteAll(s.unmute)))}><MicOff size={17} />Mute everyone</button>
          {me.owner && <button onClick={go(() => { api.meetEdit(code, { settings: { guests: !s.guests } }).then(() => toast(s.guests ? 'Only signed-in people can join now.' : 'People without an account can join now.')).catch((e) => toast((e as Error).message)) })}><UserRound size={17} />{s.guests ? 'Stop allowing people without an account' : 'Allow people without an account'}</button>}
          {me.owner && <button onClick={go(() => setModal('settings'))}><Settings2 size={17} />Meeting settings</button>}
        </>)}
        {me.manager && pip.supported && (<>
          <div className="menu-sep" />
          <button onClick={go(() => (pip.isOpen ? pip.close() : void pip.open()))}><Hand size={17} />{pip.isOpen ? 'Close the raised hands window' : 'Pop out raised hands'}</button>
          <button onClick={go(() => { setHandsPipPref(!pipPref); setPipPref(!pipPref); toast(!pipPref ? 'Raised hands will pop out when you switch away. Reload the meeting to apply.' : 'Raised hands will stay in the meeting.') })}><Hand size={17} />{pipPref ? 'Stop popping out when I switch away' : 'Pop out when I switch away'}</button>
        </>)}
        <div className="menu-sep" />
        <button onClick={go(() => setModal('report'))}><Info size={17} />Connection details</button>
        <button onClick={go(() => void copy())}><Info size={17} />Copy the invite</button>
        <button onClick={go(() => setModal('keys'))}><Keyboard size={17} />Keyboard shortcuts</button>
      </div>)
  }

  const waitingBadge = me.manager ? waiting.length : 0
  return (
    <div className="meet-call">
      <header className="meet-top">
        <div className="meet-title"><b>{call.title()}</b><button className="meet-code" onClick={copy} title="Copy the invite">{code}{copied ? <Check size={13} /> : <Copy size={13} />}</button></div>
        <span className="meet-chip" title="People in the meeting"><Users size={13} />{peers.length}</span>
        <span className="meet-chip" title="How long the meeting has run">{clock(Date.now() - call.started())}</span>
        {s.locked && <span className="meet-chip warn"><Lock size={13} />Locked</span>}
        {capsOn && <span className="meet-chip"><Captions size={13} />Captions</span>}
        {rec && (inCharge
          ? <span className="meet-chip rec" title={rec.mine ? 'You are recording this meeting' : `${rec.by} is recording this meeting`}><i />Recording {clock(Date.now() - rec.since)}</span>
          : <button className="meet-chip rec" onClick={() => setReask(true)} title="Click to change your answer"><i />Recording · {call.consent() === 'yes' ? "you're in it" : call.consent() === 'no' ? "you're not in it" : 'waiting for your answer'}</button>)}
        <span className="meet-chip" title="Audio and video aren't end-to-end encrypted: the call service can carry them."><LockOpen size={13} />Not encrypted</span>
        {status === 'reconnecting' && <span className="meet-chip warn"><span className="spinner sm" />Reconnecting…</span>}
      </header>

      {soundBlocked && (
        <div className="meet-banner" role="alert">Your browser blocked the sound from this meeting. <button className="btn btn-soft btn-sm btn-pill" onClick={() => { window.dispatchEvent(new Event('koko:sound-retry')); setSoundBlocked(false) }}>Turn the sound on</button></div>)}
      {peers.some((p) => !p.self && p.net === 'failed') && (
        <div className="meet-banner" role="alert">Can't connect to {peers.filter((p) => !p.self && p.net === 'failed').map((p) => p.name).join(', ')}. Direct calls are blocked between your networks.
          {user?.is_admin ? <> Turn on the free relay in <a href="/admin#meet" target="_blank" rel="noreferrer">Admin → Meetings</a> to fix this for everyone.</> : <> Ask the person who runs this site to turn on a relay server for meetings.</>}</div>)}
      <div className="meet-body">
        <main className="meet-stage">
          <Stage call={call} peers={peers} spotlight={call.spotlight()} layout={layout} hideSelf={hideSelf} onMessage={(id) => { setChatTo(id); setPanel('chat') }} onPerms={setPermsFor} />
          {peers.length === 1 && <div className="meet-alone"><p>You're the only one here.</p><button className="btn btn-soft btn-pill btn-sm" onClick={copy}>{copied ? <Check size={15} /> : <Copy size={15} />}Copy the invite</button></div>}
          <Floaters call={call} />
          {capsOn && showCaps && recent.length > 0 && <div className="meet-caps" aria-live="polite">{recent.map((c) => <p key={c.id}><b>{c.name}</b> {c.text}</p>)}</div>}
        </main>

        {panel && (
          <aside className="meet-panel" aria-label={panel}>
            <div className="meet-panel-head">
              <div className="tabs">
                <button className={panel === 'chat' ? 'on' : ''} onClick={() => setPanel('chat')}>Chat{unread.chat > 0 && <i className="meet-dot inline">{unread.chat}</i>}</button>
                <button className={panel === 'people' ? 'on' : ''} onClick={() => setPanel('people')}>People{waitingBadge > 0 && <i className="meet-dot inline">{waitingBadge}</i>}</button>
                <button className={panel === 'polls' ? 'on' : ''} onClick={() => setPanel('polls')}>Polls{unread.polls > 0 && <i className="meet-dot inline">{unread.polls}</i>}</button>
              </div>
              <button className="icon-btn sm" onClick={() => setPanel(null)} aria-label="Close"><X size={16} /></button>
            </div>
            {panel === 'chat' && <ChatPanel call={call} peers={peers} to={chatTo} setTo={setChatTo} />}
            {panel === 'people' && <PeoplePanel call={call} peers={peers} onMessage={(id) => { setChatTo(id); setPanel('chat') }} onPerms={setPermsFor} />}
            {panel === 'polls' && <PollsPanel call={call} />}
          </aside>)}
      </div>

      {!self?.audio && peers.length > 1 && perms.mic && Date.now() - joinedAt < 20000 && <div className="meet-muted-pill"><MicOff size={14} />You're muted. Press M or the microphone to talk.</div>}
      <footer className="meet-bar">
        <button className={`meet-ctl ${self?.audio ? '' : 'off'} ${!perms.mic && !self?.audio ? 'locked' : ''}`} onClick={() => void call.setMic(!self?.audio)} aria-label={self?.audio ? 'Mute' : 'Unmute'} title={!perms.mic && !self?.audio ? 'The host has turned off unmuting. Raise your hand to ask.' : self?.audio ? 'Mute (M)' : 'Unmute (M)'}>{self?.audio ? <Mic size={20} /> : <MicOff size={20} />}{!perms.mic && !self?.audio && <LockIcon size={11} className="lk" />}</button>
        <button className={`meet-ctl ${self?.video ? '' : 'off'} ${!perms.camera && !self?.video ? 'locked' : ''}`} onClick={() => void call.setCam(!self?.video)} aria-label={self?.video ? 'Turn off camera' : 'Turn on camera'} title={!perms.camera && !self?.video ? "You can't turn your camera on in this meeting" : self?.video ? 'Turn off camera (V)' : 'Turn on camera (V)'}>{self?.video ? <Video size={20} /> : <VideoOff size={20} />}{!perms.camera && !self?.video && <LockIcon size={11} className="lk" />}</button>
        <Popover trigger={({ toggle }) => <button className={`meet-ctl ${self?.screen || mineShare ? 'on' : ''}`} onClick={toggle} aria-label="Share" title="Share your screen, or a document"><MonitorUp size={20} /></button>}>
          {(close) => (
            <div className="menu wide">
              {sharing && mineShare ? <button className="danger" onClick={() => { close(); call.stopShare() }}><X size={17} />{sharing.kind === 'present' ? 'Stop presenting' : 'Stop sharing the document'}</button> : null}
              {self?.screen ? <button className="danger" onClick={() => { close(); call.stopScreen() }}><MonitorX size={17} />Stop presenting your screen</button> : null}
              {canShare && !self?.screen && <button disabled={!perms.screen || !!sharing} onClick={() => { close(); void call.shareScreen() }}><MonitorUp size={17} />Share your screen{!perms.screen ? ' (not allowed)' : ''}</button>}
              <button disabled={!perms.collab || (!!sharing && !mineShare)} onClick={() => { close(); setPicker('collab') }}><FileText size={17} />Edit a document together…{!perms.collab ? ' (not allowed)' : ''}</button>
              <button disabled={!perms.present || (!!sharing && !mineShare)} onClick={() => { close(); setPicker('present') }}><PresentIcon size={17} />Present slides…{!perms.present ? ' (not allowed)' : ''}</button>
            </div>)}
        </Popover>
        {(s.reactions || perms.react) && perms.react && (
          <Popover trigger={({ toggle }) => <button className="meet-ctl" onClick={toggle} aria-label="Reactions" title="Reactions"><Smile size={20} /></button>}>
            {(close) => <div className="meet-emojis">{call.emojis().map((e) => <button key={e} onClick={() => { call.react(e); close() }} aria-label={`React ${e}`}>{e}</button>)}</div>}
          </Popover>)}
        <button className={`meet-ctl meet-hide-m ${self?.hand ? 'on' : ''}`} onClick={toggleHand} aria-label={self?.hand ? 'Lower your hand' : 'Raise your hand'} title="Raise or lower your hand (H)"><Hand size={20} /></button>
        {canRecord && <button className={`meet-ctl meet-hide-m ${rec?.mine ? 'recording' : ''}`} disabled={!!rec && !rec.mine} onClick={() => (rec?.mine ? void call.record(false) : (setNeedAll(!!s.record_consent), setModal('record')))} aria-label={rec?.mine ? 'Stop recording' : 'Record the meeting'} title={rec?.mine ? 'Stop recording' : rec ? `${rec.by} is recording` : 'Record the meeting'}><Circle size={18} fill={rec?.mine ? 'currentColor' : 'none'} /></button>}
        <button className={`meet-ctl ${panel === 'chat' ? 'on' : ''}`} onClick={() => open('chat')} aria-label="Chat" title="Chat (C)"><MessageSquare size={20} />{unread.chat > 0 && panel !== 'chat' && <i className="meet-dot">{unread.chat > 9 ? '9+' : unread.chat}</i>}</button>
        <button className={`meet-ctl ${panel === 'people' ? 'on' : ''}`} onClick={() => open('people')} aria-label="People" title="People (P)"><Users size={20} />{waitingBadge > 0 && <i className="meet-dot">{waitingBadge}</i>}</button>
        <button className={`meet-ctl meet-hide-m ${panel === 'polls' ? 'on' : ''}`} onClick={() => open('polls')} aria-label="Polls" title="Polls"><BarChart3 size={20} />{unread.polls > 0 && panel !== 'polls' && <i className="meet-dot">{unread.polls}</i>}</button>
        <Popover align="end" trigger={({ toggle }) => <button className="meet-ctl" onClick={toggle} aria-label="More" title="More"><MoreVertical size={20} /></button>}>{moreMenu}</Popover>
        {me.owner ? (
          <Popover align="end" trigger={({ toggle }) => <button className="meet-ctl hang" onClick={toggle} aria-label="Leave"><PhoneOff size={20} /></button>}>
            {(close) => (
              <div className="menu wide">
                <button onClick={() => { close(); leave() }}><PhoneOff size={17} />Leave, the meeting carries on</button>
                <button className="danger" onClick={() => { close(); void endAll() }}><X size={17} />{call.permanent() ? 'End the session for everyone' : 'End for everyone'}</button>
              </div>)}
          </Popover>
        ) : <button className="meet-ctl hang" onClick={leave} aria-label="Leave" title="Leave"><PhoneOff size={20} /></button>}
      </footer>

      {pip.node}
      {modal === 'report' && <ReportDialog call={call} onClose={() => setModal(null)} />}
      {picker && <SharePicker call={call} mode={picker} onClose={() => setPicker(null)} />}
      {permsFor && <PersonPerms call={call} peer={permsFor} onClose={() => setPermsFor(null)} />}
      {modal === 'settings' && <MeetingSettings code={code} call={call} onClose={() => setModal(null)} />}
      {modal === 'keys' && <Shortcuts onClose={() => setModal(null)} />}
      {modal === 'record' && (
        <Modal title="Record this meeting?" onClose={() => setModal(null)} width={460}>
          <div className="share-body meet-consent">
            <p>Your browser records the call (everyone's video and voice, or the spotlighted person, or a shared screen) and uploads it as it goes. Keep this tab open while recording. It is saved to <b>{me.owner ? 'your' : `${info.host_name}'s`} storage</b> and counts against it.</p>
            <p>Everyone is told and asked to agree. People who don't agree are left out of the recording.</p>
            <label className="check"><input type="checkbox" checked={needAll} disabled={!me.owner} onChange={(e) => setNeedAll(e.target.checked)} />Remove people who don't agree{!me.owner && ' (only the host can change this)'}</label>
            <div className="modal-actions"><button className="btn btn-pill btn-ghost" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-pill btn-primary" disabled={recBusy} onClick={() => void startRecording()}>{recBusy ? <span className="spinner sm" /> : <><Circle size={14} fill="currentColor" />Start recording</>}</button></div>
          </div>
        </Modal>)}
      {rec && (mustAnswer || reask) && <ConsentModal by={rec.by} required={rec.required} again={reask && !mustAnswer} onAnswer={(a) => { call.answer(a); setReask(false) }} />}
      {modal === 'devices' && (
        <Modal title="Microphone, camera and speaker" onClose={() => setModal(null)} width={440}>
          <div className="share-body"><DevicePicker load={() => call.devices()} onMic={(id) => void call.setDevice('mic', id)} onCam={(id) => void call.setDevice('cam', id)} /></div>
        </Modal>)}
    </div>
  )
}

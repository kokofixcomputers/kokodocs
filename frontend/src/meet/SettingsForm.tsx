import type { MeetSettings } from '../api'
import { Select } from '../ui/Select'

export const Row = ({ on, set, label, hint, disabled }: { on: boolean; set: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) => (
  <div className="switch-row"><div><b>{label}</b>{hint && <span>{hint}</span>}</div>
    <button role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={`toggle ${on ? 'on' : ''}`} onClick={() => set(!on)} /></div>)

export const Pick = ({ label, hint, value, options, onChange }: { label: string; hint?: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) => (
  <div className="switch-row"><div><b>{label}</b>{hint && <span>{hint}</span>}</div><Select label={label} value={value} options={options} onChange={onChange} /></div>)

const SIZES = [{ value: '0', label: 'No limit' }, ...[2, 4, 6, 8, 12, 20, 50, 100].map((n) => ({ value: String(n), label: `${n} people` }))]

interface P { s: MeetSettings; onChange: (patch: Partial<MeetSettings>) => void; guestsAllowed?: boolean; captionsAvailable?: boolean }

/** Who gets in. */
export function AccessSettings({ s, onChange, guestsAllowed = true }: P) {
  return (
    <>
      <Row on={s.approval} set={(v) => onChange({ approval: v })} label="Host approves everyone who joins" hint="People wait until you (or a co-host) let them in." />
      <Row on={s.host_first} set={(v) => onChange({ host_first: v })} label="Wait for the host" hint="Nobody gets in before you or a co-host arrive." />
      <Row on={s.guests && guestsAllowed} disabled={!guestsAllowed} set={(v) => onChange({ guests: v })} label="People without an account can join" hint={guestsAllowed ? 'Anyone with the link can join by typing a name. You see them marked as guests. Off: only signed-in people can join.' : 'Turned off for the whole server.'} />
      <Pick label="Most people at once" value={String(s.max)} options={SIZES} onChange={(v) => onChange({ max: Number(v) })} />
    </>)
}

const WHO = (host: string) => [{ value: 'all', label: 'Everyone' }, { value: 'host', label: host }]

/** What people may do (everyone, unless the host sets it differently for one person during the meeting). */
export function PermissionSettings({ s, onChange }: P) {
  return (
    <>
      <h4>Audio and video</h4>
      <Row on={s.unmute} set={(v) => onChange({ unmute: v })} label="People can unmute themselves" hint="Off: hosts unmute people, or people raise a hand to ask." />
      <Row on={s.camera} set={(v) => onChange({ camera: v })} label="People can turn on their camera" />
      <Pick label="Who can share their screen" value={s.share} options={WHO('Only the host')} onChange={(v) => onChange({ share: v as MeetSettings['share'] })} />
      <h4>Talking</h4>
      <Pick label="Who can chat" value={s.chat} options={[{ value: 'all', label: 'Everyone' }, { value: 'host', label: 'Only the host' }, { value: 'off', label: 'No one' }]} onChange={(v) => onChange({ chat: v as MeetSettings['chat'] })} />
      <Row on={s.reactions} set={(v) => onChange({ reactions: v })} label="Reactions" />
      <h4>Documents and presentations</h4>
      <Pick label="Who can share a document to edit together" value={s.collab} options={WHO('Only the host')} onChange={(v) => onChange({ collab: v as MeetSettings['collab'] })} />
      <Pick label="Who can present a presentation" value={s.present} options={WHO('Only the host')} onChange={(v) => onChange({ present: v as MeetSettings['present'] })} />
      <Row on={s.edit_shared} set={(v) => onChange({ edit_shared: v })} label="People can edit shared documents" hint="Off: they can watch and follow along, but not type." />
      <Row on={s.seek} set={(v) => onChange({ seek: v })} label="People can browse slides on their own" hint="While someone presents, they can look at other slides and jump back to the presenter." />
    </>)
}

/** What people start with, recording, and captions. */
export function InMeetingSettings({ s, onChange, captionsAvailable = true }: P) {
  return (
    <>
      <h4>When people arrive</h4>
      <Row on={s.mute_on_entry} set={(v) => onChange({ mute_on_entry: v })} label="Microphone off" />
      <Row on={s.cam_off_on_entry} set={(v) => onChange({ cam_off_on_entry: v })} label="Camera off" />
      <h4>Recording and captions</h4>
      <Pick label="Who can record" hint="Recordings are saved to the host's storage. Everyone is told, and asked to agree." value={s.recording} options={[{ value: 'off', label: 'No one' }, { value: 'host', label: 'Only the host' }, { value: 'managers', label: 'Host and co-hosts' }]} onChange={(v) => onChange({ recording: v as MeetSettings['recording'] })} />
      <Row on={s.record_consent} set={(v) => onChange({ record_consent: v })} label="Everyone must agree to be recorded" hint={s.record_consent ? 'People who say no are removed from the meeting.' : 'People can say no and stay: they are left out of the recording.'} />
      <Row on={s.captions && captionsAvailable} disabled={!captionsAvailable} set={(v) => onChange({ captions: v })} label="Live captions" hint={captionsAvailable ? 'The host can switch them on during the meeting.' : "This server can't turn speech into text."} />
    </>)
}

/** All of a meeting's settings in one list (used inside a meeting, where they take effect at once). */
export function SettingsForm(p: P) {
  return (
    <div className="meet-settings">
      <h4>Who gets in</h4>
      <AccessSettings {...p} />
      <PermissionSettings {...p} />
      <InMeetingSettings {...p} />
    </div>
  )
}

export const DEFAULT_SETTINGS: MeetSettings = {
  approval: false, host_first: false, guests: false, mute_on_entry: false, cam_off_on_entry: false, chat: 'all', share: 'all', reactions: true, unmute: true, captions: true, max: 0, recording: 'host', record_consent: false,
  camera: true, collab: 'all', present: 'all', edit_shared: true, seek: true,
}

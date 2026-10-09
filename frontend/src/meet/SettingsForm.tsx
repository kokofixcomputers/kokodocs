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
      <Row on={s.guests && guestsAllowed} disabled={!guestsAllowed} set={(v) => onChange({ guests: v })} label="People without an account can join" hint={guestsAllowed ? undefined : 'Turned off for the whole server.'} />
      <Pick label="Most people at once" value={String(s.max)} options={SIZES} onChange={(v) => onChange({ max: Number(v) })} />
    </>)
}

/** What people start with, and what they may do. */
export function InMeetingSettings({ s, onChange, captionsAvailable = true }: P) {
  return (
    <>
      <h4>When people arrive</h4>
      <Row on={s.mute_on_entry} set={(v) => onChange({ mute_on_entry: v })} label="Microphone off" />
      <Row on={s.cam_off_on_entry} set={(v) => onChange({ cam_off_on_entry: v })} label="Camera off" />
      <h4>During the meeting</h4>
      <Pick label="Who can chat" value={s.chat} options={[{ value: 'all', label: 'Everyone' }, { value: 'host', label: 'Only the host' }, { value: 'off', label: 'No one' }]} onChange={(v) => onChange({ chat: v as MeetSettings['chat'] })} />
      <Pick label="Who can share their screen" value={s.share} options={[{ value: 'all', label: 'Everyone' }, { value: 'host', label: 'Only the host' }]} onChange={(v) => onChange({ share: v as MeetSettings['share'] })} />
      <Row on={s.unmute} set={(v) => onChange({ unmute: v })} label="People can unmute themselves" />
      <Row on={s.reactions} set={(v) => onChange({ reactions: v })} label="Reactions" />
      <Row on={s.captions && captionsAvailable} disabled={!captionsAvailable} set={(v) => onChange({ captions: v })} label="Live captions" hint={captionsAvailable ? 'The host can switch them on during the meeting.' : "This server can't turn speech into text."} />
    </>)
}

/** All of a meeting's settings in one list (used inside a meeting, where they take effect at once). */
export function SettingsForm(p: P) {
  return (
    <div className="meet-settings">
      <h4>Who gets in</h4>
      <AccessSettings {...p} />
      <InMeetingSettings {...p} />
    </div>
  )
}

export const DEFAULT_SETTINGS: MeetSettings = {
  approval: false, host_first: false, guests: true, mute_on_entry: false, cam_off_on_entry: false, chat: 'all', share: 'all', reactions: true, unmute: true, captions: true, max: 0,
}

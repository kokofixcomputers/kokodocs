import { useEffect, useState } from 'react'
import { Select } from '../ui/Select'
import { getSpeaker, setSpeaker } from './util'
import type { Devices } from './types'

const label = (d: MediaDeviceInfo, i: number, what: string) => d.label || `${what} ${i + 1}`

/** Pick the microphone, camera and speaker. Used before joining and inside the call. */
export function DevicePicker({ load, onMic, onCam }: { load: () => Promise<Devices>; onMic: (id: string) => void; onCam: (id: string) => void }) {
  const [d, setD] = useState<Devices | null>(null)
  const [mic, setMic] = useState('')
  const [cam, setCam] = useState('')
  const [spk, setSpk] = useState(getSpeaker())
  useEffect(() => { void load().then((x) => { setD(x); setMic(x.mic || x.mics[0]?.deviceId || ''); setCam(x.cam || x.cams[0]?.deviceId || '') }) }, [load])
  if (!d) return <span className="spinner sm" style={{ borderColor: 'var(--accent-soft-2)', borderTopColor: 'var(--accent)' }} />
  const opts = (list: MediaDeviceInfo[], what: string) => (list.length ? list.map((x, i) => ({ value: x.deviceId, label: label(x, i, what) })) : [{ value: '', label: 'Default' }])
  return (
    <div className="meet-devices">
      <div><span>Microphone</span><Select label="Microphone" value={mic} options={opts(d.mics, 'Microphone')} onChange={(v) => { setMic(v); onMic(v) }} /></div>
      <div><span>Camera</span><Select label="Camera" value={cam} options={opts(d.cams, 'Camera')} onChange={(v) => { setCam(v); onCam(v) }} /></div>
      {'setSinkId' in HTMLMediaElement.prototype && d.speakers.length > 0 && (
        <div><span>Speaker</span><Select label="Speaker" value={spk} options={[{ value: '', label: 'Default' }, ...d.speakers.map((x, i) => ({ value: x.deviceId, label: label(x, i, 'Speaker') }))]} onChange={(v) => { setSpk(v); setSpeaker(v) }} /></div>)}
    </div>)
}

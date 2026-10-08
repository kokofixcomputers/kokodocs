import { Lock, LockOpen } from 'lucide-react'
import { openSettings } from '../ui/settingsStore'

/** Says, inside every file, whether it is encrypted (only people with the key can read it, not even the server) or not. */
export function EncryptionBadge({ info }: { info: { zk?: boolean; kind: string } }) {
  const on = !!info.zk
  const why = on ? 'Encrypted: its contents can only be read by the people it is shared with, not by the server or its administrator.'
    : info.kind === 'form' ? 'Not encrypted. Forms can’t be encrypted: people fill them in without an account, so the server has to read them.'
    : 'Not encrypted: the server can read it. You can encrypt your documents in Settings, Security.'
  return (
    <button type="button" className={`enc-badge ${on ? 'on' : ''}`} title={why} aria-label={on ? 'Encrypted' : 'Not encrypted'} onClick={() => openSettings('security')}>
      {on ? <Lock size={13} /> : <LockOpen size={13} />}<span>{on ? 'Encrypted' : 'Not encrypted'}</span>
    </button>
  )
}

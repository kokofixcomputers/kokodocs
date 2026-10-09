import { Modal } from '../ui/Modal'
import { PERM_LABELS, type Call, type Peer, type PermKey } from './types'

const KEYS: PermKey[] = ['mic', 'camera', 'screen', 'chat', 'react', 'collab', 'present', 'edit', 'seek']
const GROUPS: { title: string; keys: PermKey[] }[] = [
  { title: 'Audio and video', keys: ['mic', 'camera', 'screen'] },
  { title: 'Talking', keys: ['chat', 'react'] },
  { title: 'Documents and presentations', keys: ['collab', 'present', 'edit', 'seek'] },
]

/** What one person may do, over the meeting's defaults. For each thing: use the meeting's setting, always allow, or never allow. */
export function PersonPerms({ call, peer, onClose }: { call: Call; peer: Peer; onClose: () => void }) {
  const ov = call.overrides()[peer.id] ?? {}
  const count = KEYS.filter((k) => ov[k] !== undefined).length
  return (
    <Modal title={`What ${peer.name} can do`} onClose={onClose} width={520}>
      <div className="share-body meet-perms">
        <p className="muted small">By default {peer.name} can do what the meeting's settings say. Change one for them alone, for this meeting.{count > 0 && <> <button className="link-btn" onClick={() => KEYS.forEach((k) => ov[k] !== undefined && call.setPerm(peer.id, k, null))}>Reset all {count}</button></>}</p>
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h4>{g.title}</h4>
            {g.keys.map((k) => {
              const cur = ov[k] === undefined ? 'default' : ov[k] ? 'allow' : 'deny'
              const set = (v: 'default' | 'allow' | 'deny') => call.setPerm(peer.id, k, v === 'default' ? null : v === 'allow')
              return (
                <div key={k} className="perm-row">
                  <div><b>{PERM_LABELS[k].label}</b>{PERM_LABELS[k].hint && <span>{PERM_LABELS[k].hint}</span>}</div>
                  <div className="seg" role="radiogroup" aria-label={PERM_LABELS[k].label}>
                    {(['default', 'allow', 'deny'] as const).map((v) => (
                      <button key={v} role="radio" aria-checked={cur === v} className={cur === v ? `on ${v}` : ''} onClick={() => set(v)}>{v === 'default' ? 'Meeting default' : v === 'allow' ? 'Allow' : "Don't allow"}</button>))}
                  </div>
                </div>)
            })}
          </section>))}
      </div>
    </Modal>)
}

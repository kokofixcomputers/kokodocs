import { Clock } from 'lucide-react'
import { Select } from './Select'

export type Expiry = 'keep' | 'never' | '7d' | '30d'

/** "Link expires" picker shared by the document and folder share dialogs. `current` is the stored expiry (seconds), if any. */
export function LinkExpiry({ value, onChange, current }: { value: Expiry; onChange: (v: Expiry) => void; current: number | null | undefined }) {
  const date = current ? new Date(current * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''
  const options: { value: Expiry; label: string }[] = [
    ...(current ? [{ value: 'keep' as Expiry, label: `Expires ${date}` }] : []),
    { value: 'never', label: 'Never expires' },
    { value: '7d', label: 'Expires in 7 days' },
    { value: '30d', label: 'Expires in 30 days' },
  ]
  const v = value === 'keep' && !current ? 'never' : value
  return (
    <div className="link-perm rise">
      <div className="link-perm-text"><b><Clock size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />Link expiry</b>
        <span>After that the link goes back to Restricted. People you added by name keep their access.</span>
      </div>
      <Select label="Link expiry" value={v} options={options} onChange={onChange} />
    </div>
  )
}

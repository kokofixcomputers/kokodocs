import { useEffect, useState } from 'react'
import { HardDrive } from 'lucide-react'
import { api, type Storage } from '../api'

export const fmtBytes = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`)
/** ok below 70%, warn to 90%, hot above */
export const tier = (used: number, limit: number) => { const p = limit ? used / limit : 0; return p >= 0.9 ? 'hot' : p >= 0.7 ? 'warn' : 'ok' }

/** Storage used out of the user's limit, as a bar that turns amber then red as it fills. */
export function StorageMeter({ refreshKey, onClick }: { refreshKey?: unknown; onClick?: () => void }) {
  const [st, setSt] = useState<Storage | null>(null)
  useEffect(() => { api.myStorage().then(setSt).catch(() => {}) }, [refreshKey])
  if (!st) return null
  const pct = st.limit ? Math.min(100, (st.used / st.limit) * 100) : 0
  const t = tier(st.used, st.limit)
  return (
    <button type="button" className={`storage-meter ${t}`} onClick={onClick} title="Storage used by your documents, history, images and form uploads">
      <HardDrive size={16} />
      <span className="sm-label"><b>{fmtBytes(st.used)}</b>{st.limit ? ` of ${fmtBytes(st.limit)}` : ' used'}</span>
      {st.limit > 0 && <span className="meter" role="progressbar" aria-label="Storage used" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${Math.max(pct, 2)}%` }} /></span>}
      {t === 'hot' && st.limit > 0 && <em>{st.used >= st.limit ? 'Full' : 'Almost full'}</em>}
    </button>
  )
}

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Search as SearchIcon } from 'lucide-react'
import { api, type SearchHit } from '../api'
import { useAuth } from '../auth'
import { KindIcon } from './KindIcon'

/** Debounced content search; returns null until there is something to show. */
export function useContentSearch(q: string, enabled = true): { hits: SearchHit[] | null; busy: boolean } {
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const t = q.trim()
    if (!enabled || t.length < 2) { setHits(null); setBusy(false); return }
    const ac = new AbortController(); setBusy(true)
    const id = window.setTimeout(() => { api.search(t, ac.signal).then((r) => { setHits(r); setBusy(false) }).catch((e) => { if (e.name !== 'AbortError') { setHits([]); setBusy(false) } }) }, 220)
    return () => { window.clearTimeout(id); ac.abort() }
  }, [q, enabled])
  return { hits, busy }
}

/** "…the [[zebrafish]] migration…" -> highlighted text */
export function Snippet({ text }: { text: string }): ReactNode {
  return <>{text.split(/(\[\[.*?\]\])/g).map((p, i) => (p.startsWith('[[') ? <mark key={i}>{p.slice(2, -2)}</mark> : p))}</>
}

export function HitRow({ hit, active, onOpen, onHover }: { hit: SearchHit; active?: boolean; onOpen: () => void; onHover?: () => void }) {
  return (
    <button className={`hit-row ${active ? 'on' : ''}`} onClick={onOpen} onMouseEnter={onHover}>
      <i className={`k-${hit.kind}`}><KindIcon kind={hit.kind} size={16} /></i>
      <span className="hit-text"><b>{hit.title || 'Untitled'}</b>{hit.snippet && <em><Snippet text={hit.snippet} /></em>}</span>
      <span className="hit-meta">{hit.owner}</span>
    </button>
  )
}

/** Ctrl+K (or Cmd+K) anywhere: find a file by title or by what is written inside it. */
export function SearchPalette() {
  const { user } = useAuth()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const { hits, busy } = useContentSearch(q, open)

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k' && user) { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o) } }
    const o = () => setOpen(true)
    window.addEventListener('keydown', k, true); window.addEventListener('koko:search', o)
    return () => { window.removeEventListener('keydown', k, true); window.removeEventListener('koko:search', o) }
  }, [user])
  useEffect(() => { if (open) { setQ(''); setSel(0); setTimeout(() => input.current?.focus(), 30) } }, [open])
  useEffect(() => setSel(0), [hits])
  if (!open || !user) return null
  const go = (h: SearchHit) => { setOpen(false); nav(`/d/${h.id}`) }
  return createPortal(
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="palette" role="dialog" aria-label="Search">
        <label className="palette-input"><SearchIcon size={18} />
          <input ref={input} value={q} placeholder="Search titles and everything written inside your files" onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false)
              else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min((hits?.length ?? 1) - 1, s + 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)) }
              else if (e.key === 'Enter' && hits?.[sel]) go(hits[sel])
            }} />
          {busy && <span className="spinner sm" style={{ borderColor: 'var(--accent-soft-2)', borderTopColor: 'var(--accent)' }} />}
        </label>
        <div className="palette-list">
          {!hits && <p className="palette-hint">Type at least two letters. Use the arrow keys and Enter to open a file.</p>}
          {hits && hits.length === 0 && !busy && <p className="palette-hint">Nothing found for “{q.trim()}”.</p>}
          {hits?.map((h, i) => <HitRow key={h.id} hit={h} active={i === sel} onOpen={() => go(h)} onHover={() => setSel(i)} />)}
        </div>
      </div>
    </div>, document.body)
}

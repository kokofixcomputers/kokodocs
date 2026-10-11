import { useState } from 'react'
import { FileText } from 'lucide-react'

export interface PageTarget { id: string; title: string; path: string }

/** Pick a wiki page to link to (in a wiki, a link points at a page, not at a heading). */
export function PagePicker({ pages, current, onPick }: { pages: PageTarget[]; current?: string | null; onPick: (p: PageTarget) => void }) {
  const [q, setQ] = useState('')
  const s = q.trim().toLowerCase()
  const list = s ? pages.filter((p) => p.title.toLowerCase().includes(s) || p.path.toLowerCase().includes(s)) : pages
  return (
    <div className="page-pick">
      <input className="pp-search" placeholder="Search pages" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && list[0]) { e.preventDefault(); onPick(list[0]) } }} aria-label="Search pages" />
      <div className="heading-pick" role="listbox" aria-label="Pages in this wiki">
        {list.map((p) => (
          <button key={p.id} type="button" role="option" aria-selected={p.id === current} className={p.id === current ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(p)} title={p.path ? `${p.path} › ${p.title}` : p.title}>
            <FileText size={14} /><span className="hp-text">{p.title}{p.path && <em className="pp-path">{p.path}</em>}</span>
          </button>))}
        {!list.length && <p className="hp-empty">{pages.length ? 'No page matches.' : 'This wiki has no pages yet.'}</p>}
      </div>
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { Bird, Clock, Flag, Hand, Lightbulb, Pizza, Plane, Search, Shapes, Smile, Trophy } from 'lucide-react'
import { Popover } from '../ui/Popover'
import { TBtn } from './Toolbar'
import { emojiUrl, loadEmojiPack, prefetchEmojiPack } from '../emoji'
import { type Emo, loadEmojiIndex } from './emojiData'

const GROUPS: { id: number; name: string; icon: typeof Smile }[] = [
  { id: 0, name: 'Smileys', icon: Smile }, { id: 1, name: 'People', icon: Hand }, { id: 3, name: 'Animals & nature', icon: Bird }, { id: 4, name: 'Food & drink', icon: Pizza },
  { id: 5, name: 'Travel', icon: Plane }, { id: 6, name: 'Activities', icon: Trophy }, { id: 7, name: 'Objects', icon: Lightbulb }, { id: 8, name: 'Symbols', icon: Shapes }, { id: 9, name: 'Flags', icon: Flag },
]
const TONES = ['#f5c542', '#f7d7b5', '#e0b48a', '#c18e63', '#8d5a3b', '#4a2f21']
const RECENT_KEY = 'koko.emoji.recent'

const load = async () => (await loadEmojiIndex()).list
const readRecent = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') } catch { return [] } }

function Panel({ editor, close }: { editor: Editor; close: () => void }) {
  const [all, setAll] = useState<Emo[] | null>(null)
  const [q, setQ] = useState('')
  const [group, setGroup] = useState<number>(() => (readRecent().length ? -1 : 0))
  const [tone, setTone] = useState(() => Number(localStorage.getItem('koko.emoji.tone') ?? 0))
  const [recent, setRecent] = useState(readRecent)
  const [hover, setHover] = useState<Emo | null>(null)
  const search = useRef<HTMLInputElement>(null)
  // wait for the emoji data and the image pack together, so the grid appears fully drawn instead of filling in one by one
  useEffect(() => { void Promise.all([load(), loadEmojiPack()]).then(([d]) => setAll(d)); search.current?.focus() }, [])

  const show = (e: Emo) => (tone > 0 && e.skins?.find((s) => { const m = s.hexcode.match(/1F3F[B-F]/g); return m?.length === 1 && m[0] === `1F3F${'BCDEF'[tone - 1]}` })?.unicode) || e.unicode
  const list = useMemo(() => {
    if (!all) return []
    const s = q.trim().toLowerCase()
    if (s) {
      const byLabel = all.filter((e) => e.label.toLowerCase().includes(s))
      const byTag = all.filter((e) => !byLabel.includes(e) && e.tags?.some((t) => t.toLowerCase().startsWith(s)))
      return [...byLabel, ...byTag].slice(0, 160)
    }
    if (group === -1) return recent.map((u) => all.find((e) => e.unicode === u || e.skins?.some((k) => k.unicode === u)) && ({ unicode: u, label: '', hexcode: u } as Emo)).filter(Boolean) as Emo[]
    return all.filter((e) => e.group === group)
  }, [all, q, group, recent])

  const pick = (e: Emo) => {
    const u = group === -1 && !q ? e.unicode : show(e)
    editor.chain().focus().insertContent({ type: 'emoji', attrs: { char: u } }).run()
    const next = [u, ...recent.filter((r) => r !== u)].slice(0, 24)
    setRecent(next); try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* private mode */ }
    close()
  }
  const setT = (t: number) => { setTone(t); try { localStorage.setItem('koko.emoji.tone', String(t)) } catch { /* private mode */ } }

  return (
    <div className="emoji-panel">
      <label className="field emoji-search"><Search size={15} /><input ref={search} placeholder="Search emoji" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      {!q && (
        <div className="emoji-tabs">
          {recent.length > 0 && <button className={group === -1 ? 'on' : ''} title="Recent" aria-label="Recent" onClick={() => setGroup(-1)}><Clock size={16} /></button>}
          {GROUPS.map((g) => <button key={g.id} className={group === g.id ? 'on' : ''} title={g.name} aria-label={g.name} onClick={() => setGroup(g.id)}><g.icon size={16} /></button>)}
        </div>
      )}
      <div className="emoji-grid" role="grid">
        {!all ? <span className="spinner sm" style={{ margin: 20 }} /> : list.length === 0 ? <p className="muted" style={{ padding: 12, margin: 0, fontSize: 13 }}>No emoji found.</p>
          : list.map((e) => <button key={e.hexcode} onMouseEnter={() => setHover(e)} onClick={() => pick(e)} title={e.label} aria-label={e.label || e.unicode}><img src={emojiUrl(group === -1 && !q ? e.unicode : show(e))} alt={group === -1 && !q ? e.unicode : show(e)} draggable={false} /></button>)}
      </div>
      <div className="emoji-foot">
        <span className="emoji-name">{hover?.label ?? ''}</span>
        <div className="emoji-tones" role="group" aria-label="Skin tone">
          {TONES.map((c, i) => <button key={c} className={tone === i ? 'on' : ''} style={{ background: c }} aria-label={i === 0 ? 'Default tone' : `Skin tone ${i}`} onClick={() => setT(i)} />)}
        </div>
      </div>
    </div>
  )
}

export function EmojiButton({ editor }: { editor: Editor }) {
  useEffect(() => { prefetchEmojiPack(); const t = setTimeout(() => void load(), 1500); return () => clearTimeout(t) }, [])
  return (
    <Popover className="pop-emoji" trigger={({ toggle }) => <span onMouseEnter={() => { void loadEmojiPack(); void load() }} onFocus={() => { void loadEmojiPack(); void load() }}><TBtn icon={<Smile size={17} />} label="Insert emoji" onClick={toggle} /></span>}>
      {(close) => <Panel editor={editor} close={close} />}
    </Popover>
  )
}

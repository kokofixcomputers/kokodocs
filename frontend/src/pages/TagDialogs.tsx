import { useMemo, useRef, useState } from 'react'
import { Pencil, Plus, Tag as TagIcon, Trash2 } from 'lucide-react'
import { api } from '../api'
import { askConfirm, askText } from '../ui/Dialogs'
import { Modal } from '../ui/Modal'
import { toast } from '../ui/Toast'
import { MAX_TAGS, TagChip, cleanTags } from '../ui/tags'

export interface TagCount { name: string; count: number }

/** Put tags on one file or folder: type and press Enter (or a comma), or tap one of your existing tags. */
export function TagDialog({ title, initial, all, onSave, onClose }: { title: string; initial: string[]; all: TagCount[]; onSave: (tags: string[]) => Promise<void>; onClose: () => void }) {
  const [tags, setTags] = useState<string[]>(initial)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const add = (raw: string) => { setTags((t) => cleanTags([...t, ...raw.split(',')])); setText(''); input.current?.focus() }
  const suggestions = useMemo(() => {
    const have = new Set(tags.map((t) => t.toLowerCase())), q = text.trim().toLowerCase()
    return all.filter((t) => !have.has(t.name.toLowerCase()) && (!q || t.name.toLowerCase().includes(q))).slice(0, 24)
  }, [all, tags, text])
  const full = tags.length >= MAX_TAGS
  const save = async () => {
    const final = cleanTags([...tags, ...text.split(',')])
    setBusy(true)
    try { await onSave(final); onClose() } catch (e) { toast((e as Error).message || 'Could not save the tags'); setBusy(false) }
  }
  return (
    <Modal title={`Tags for “${title.length > 40 ? title.slice(0, 39) + '…' : title}”`} onClose={onClose} width={480}>
      <form className="share-body tag-dlg" onSubmit={(e) => { e.preventDefault(); void save() }}>
        <div className="tag-entry" onClick={() => input.current?.focus()}>
          {tags.map((t) => <TagChip key={t} name={t} onRemove={() => setTags((x) => x.filter((y) => y !== t))} />)}
          <input ref={input} autoFocus value={text} maxLength={30} disabled={full} placeholder={full ? `Up to ${MAX_TAGS} tags` : tags.length ? 'Add another…' : 'Type a tag and press Enter'} aria-label="Add a tag"
            onChange={(e) => { if (e.target.value.includes(',')) add(e.target.value); else setText(e.target.value) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && text.trim()) { e.preventDefault(); add(text) }
              else if (e.key === 'Backspace' && !text && tags.length) setTags((t) => t.slice(0, -1))
            }} />
        </div>
        {suggestions.length > 0 && (
          <div className="tag-sug"><span className="muted">{text.trim() ? 'Matching tags' : 'Your tags'}</span>
            <div className="tag-sug-list">{suggestions.map((t) => <button key={t.name} type="button" className="tag-sug-btn" disabled={full} onClick={() => add(t.name)}><Plus size={12} /><TagChip name={t.name} /><em>{t.count}</em></button>)}</div>
          </div>
        )}
        <p className="muted tag-note">Tags are just for you. Nobody you share this with sees them.</p>
        <div className="modal-actions"><button type="button" className="btn btn-pill btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-pill btn-primary" disabled={busy}>{busy ? <span className="spinner sm" /> : 'Save'}</button></div>
      </form>
    </Modal>
  )
}

/** Every tag you use, with how many items carry it. Rename one (renaming onto another merges them) or remove it everywhere. */
export function TagManager({ tags, onChanged, onClose }: { tags: TagCount[]; onChanged: () => void; onClose: () => void }) {
  const rename = async (t: TagCount) => {
    const n = await askText({ title: 'Rename tag', value: t.name, label: 'Rename' })
    if (!n || n === t.name) return
    try { await api.renameTag(t.name, n); onChanged() } catch (e) { toast((e as Error).message) }
  }
  const remove = async (t: TagCount) => {
    if (!(await askConfirm({ title: `Remove “${t.name}”?`, text: `It comes off ${t.count} ${t.count === 1 ? 'item' : 'items'}. The files and folders themselves are not touched.`, label: 'Remove tag', danger: true }))) return
    try { await api.deleteTag(t.name); onChanged() } catch (e) { toast((e as Error).message) }
  }
  return (
    <Modal title="Manage tags" onClose={onClose} width={460}>
      <div className="share-body tag-dlg">
        {tags.length === 0 ? <p className="muted">No tags yet. Right-click a file or folder and choose <b>Tags…</b> to add one.</p> : (
          <div className="tag-mgr">{tags.map((t) => (
            <div key={t.name} className="tag-mgr-row"><TagChip name={t.name} /><span className="muted">{t.count} {t.count === 1 ? 'item' : 'items'}</span>
              <button className="icon-btn sm" aria-label={`Rename ${t.name}`} title="Rename" onClick={() => void rename(t)}><Pencil size={15} /></button>
              <button className="icon-btn sm" aria-label={`Remove ${t.name}`} title="Remove everywhere" onClick={() => void remove(t)}><Trash2 size={15} /></button></div>))}</div>
        )}
        <div className="modal-actions"><span /><button className="btn btn-pill btn-primary" onClick={onClose}><TagIcon size={15} />Done</button></div>
      </div>
    </Modal>
  )
}

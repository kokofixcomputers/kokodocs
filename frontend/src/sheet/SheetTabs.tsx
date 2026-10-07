import { useState } from 'react'
import { Copy, Pencil, Plus, Trash2 } from 'lucide-react'
import { askConfirm, askText } from '../ui/Dialogs'
import { Popover } from '../ui/Popover'
import { toast } from '../ui/Toast'
import type { SheetModel, Tab } from './model'

const TAB_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#64748b']

export function SheetTabs({ model, tabs, active, setActive, readOnly }: { model: SheetModel; tabs: Tab[]; active: string; setActive: (id: string) => void; readOnly: boolean }) {
  const [dragId, setDragId] = useState<string | null>(null)
  const rename = async (t: Tab) => {
    const n = await askText({ title: 'Rename sheet', value: t.name })
    if (n && n !== t.name) { if (tabs.some((x) => x.id !== t.id && x.name.toLowerCase() === n.toLowerCase())) toast('A sheet with that name already exists'); else model.renameTab(t.id, n) }
  }
  const remove = async (t: Tab) => {
    if (tabs.length <= 1) { toast("A spreadsheet needs at least one sheet"); return }
    if (await askConfirm({ title: `Delete “${t.name}”?`, text: 'The sheet and everything in it will be deleted. Formulas elsewhere that point at it will show #REF!.', danger: true, label: 'Delete sheet' })) {
      if (active === t.id) setActive(tabs.find((x) => x.id !== t.id)!.id)
      model.deleteTab(t.id)
    }
  }
  return (
    <div className="stabs">
      {!readOnly && <button className="icon-btn sm" title="Add sheet" aria-label="Add sheet" onClick={() => setActive(model.addTab())}><Plus size={17} /></button>}
      <div className="stabs-list">
        {tabs.map((t, i) => (
          <Popover key={t.id} className="pop-menu" align="start" trigger={({ toggle }) => (
            <button className={`stab ${t.id === active ? 'on' : ''}`} draggable={!readOnly} style={t.color ? { boxShadow: `inset 0 -3px 0 ${t.color}` } : undefined}
              onClick={() => setActive(t.id)} onDoubleClick={() => !readOnly && rename(t)}
              onContextMenu={(e) => { e.preventDefault(); if (!readOnly) toggle() }}
              onDragStart={() => setDragId(t.id)} onDragOver={(e) => { if (dragId && dragId !== t.id) e.preventDefault() }}
              onDrop={() => { if (dragId && dragId !== t.id) model.moveTab(dragId, i); setDragId(null) }}>{t.name}</button>)}>
            {(close) => (
              <div className="menu">
                <button onClick={() => { close(); rename(t) }}><Pencil size={16} />Rename</button>
                <button onClick={() => { close(); const id = model.duplicateTab(t.id); if (id) setActive(id) }}><Copy size={16} />Duplicate</button>
                <div className="menu-colors">{TAB_COLORS.map((c) => <button key={c} style={{ background: c }} aria-label={c} onClick={() => { close(); model.setTabColor(t.id, c) }} />)}<button className="none" onClick={() => { close(); model.setTabColor(t.id, undefined) }}>None</button></div>
                <button className="danger" onClick={() => { close(); remove(t) }}><Trash2 size={16} />Delete</button>
              </div>)}
          </Popover>
        ))}
      </div>
    </div>
  )
}

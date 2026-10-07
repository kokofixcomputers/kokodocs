import { useEffect } from 'react'
import DOMPurify from 'dompurify'
import type { Editor } from '@tiptap/react'
import {
  Bold, ClipboardPaste, Copy, ExternalLink, Italic, Link2, MessageSquarePlus, RemoveFormatting, Scissors, Search, Strikethrough, TextSelect, Underline as UnderlineIcon, Unlink,
} from 'lucide-react'
import { useContextMenu, type CtxItem } from '../ui/ContextMenu'
import { askText } from '../ui/Dialogs'
import { toast } from '../ui/Toast'
import { applyIssue, type Issue } from './Proofread'

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
const mod = MAC ? '⌘' : 'Ctrl+'
const normalizeLink = (u: string) => (/^(https?:|mailto:)/i.test(u.trim()) ? u.trim() : `https://${u.trim()}`)
const KIND = { spelling: 'Spelling', grammar: 'Grammar', style: 'Style' } as const

/** Paste from the clipboard (browsers only allow it from a click like this one, and may ask first). */
async function pasteFromClipboard(editor: Editor, plain: boolean) {
  try {
    if (!plain && navigator.clipboard.read) {
      for (const item of await navigator.clipboard.read()) {
        if (item.types.includes('text/html')) {
          const html = await (await item.getType('text/html')).text()
          editor.chain().focus().insertContent(DOMPurify.sanitize(html)).run(); return
        }
      }
    }
    const text = (await navigator.clipboard.readText()).replace(/\r\n?/g, '\n')
    const lines = text.split('\n')
    editor.chain().focus().insertContent(lines.length > 1 ? lines.map((l) => ({ type: 'paragraph', content: l ? [{ type: 'text', text: l }] : [] })) : text).run()
  } catch { toast(`Your browser blocked reading the clipboard. Press ${mod}V to paste.`) }
}

/** Right-click menu for text in a document: spelling fixes, link actions, cut/copy/paste, formatting, comment, and table tools. */
export function DocContextMenu({ editor, issues, recheck, ignore, onComment, onFind }: {
  editor: Editor; issues: Issue[]; recheck: () => void; ignore: (i: Issue) => void; onComment?: () => void; onFind: () => void
}) {
  const ctx = useContextMenu()
  const { show } = ctx

  useEffect(() => {
    const dom = editor.view.dom as HTMLElement
    const onCtx = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('.pg-zone, .pg-first, .pg-last, input, textarea')) return   // page header and footer areas keep the browser's own menu
      e.preventDefault()
      const view = editor.view
      const at = view.posAtCoords({ left: e.clientX, top: e.clientY })?.pos
      const sel = editor.state.selection
      const img = t.closest('img:not(.emoji)')
      if (img && !img.closest('.ProseMirror-selectednode')) { const p = view.posAtDOM(img, 0); editor.commands.setNodeSelection(p) }
      else if (!img && at != null && (sel.empty || at < sel.from || at > sel.to)) editor.commands.setTextSelection(at)   // like any editor: the right-click moves the cursor unless it is inside your selection
      const can = editor.isEditable
      const { from, to, empty } = editor.state.selection
      const picked = !empty
      const items: CtxItem[] = []

      // spelling and grammar: the suggestions come first, like a word processor
      const pos = at ?? from
      const issue = issues.find((i) => pos >= i.from && pos <= i.to)
      if (issue && can) {
        items.push({ heading: `${KIND[issue.kind]}: ${issue.message}` })
        issue.suggestions.slice(0, 5).forEach((s) => items.push({ label: s === ' ' ? 'Use a single space' : s, onClick: () => applyIssue(editor, issue, s, recheck) }))
        if (!issue.suggestions.length) items.push({ label: 'No suggestions', onClick: () => {}, disabled: true })
        items.push({ label: 'Ignore', onClick: () => ignore(issue) }, { sep: true })
      }

      // links
      const href = editor.isActive('link') ? String(editor.getAttributes('link').href ?? '') : ''
      if (href) {
        items.push({ label: 'Open link', icon: <ExternalLink size={16} />, onClick: () => { window.open(href, '_blank', 'noopener,noreferrer') } },
          { label: 'Copy link address', icon: <Copy size={16} />, onClick: () => { void navigator.clipboard.writeText(href).then(() => toast('Link copied')) } })
        if (can) items.push({ label: 'Edit link…', icon: <Link2 size={16} />, onClick: () => void editLink(editor, href) },
          { label: 'Remove link', icon: <Unlink size={16} />, onClick: () => { editor.chain().focus().extendMarkRange('link').unsetLink().run() } })
        items.push({ sep: true })
      }

      // clipboard
      items.push(
        { label: 'Cut', icon: <Scissors size={16} />, hint: `${mod}X`, disabled: !can || !picked, onClick: () => { editor.view.focus(); document.execCommand('cut') } },
        { label: 'Copy', icon: <Copy size={16} />, hint: `${mod}C`, disabled: !picked, onClick: () => { editor.view.focus(); document.execCommand('copy') } },
        { label: 'Paste', icon: <ClipboardPaste size={16} />, hint: `${mod}V`, disabled: !can, onClick: () => void pasteFromClipboard(editor, false) },
        { label: 'Paste as plain text', hint: `${mod}Shift+V`, disabled: !can, onClick: () => void pasteFromClipboard(editor, true) },
        { label: 'Select all', icon: <TextSelect size={16} />, hint: `${mod}A`, onClick: () => { editor.chain().focus().selectAll().run() } },
      )

      if (can) {
        const c = () => editor.chain().focus()
        items.push({ sep: true },
          { label: 'Bold', icon: <Bold size={16} />, hint: `${mod}B`, checked: editor.isActive('bold') || undefined, onClick: () => { c().toggleBold().run() } },
          { label: 'Italic', icon: <Italic size={16} />, hint: `${mod}I`, checked: editor.isActive('italic') || undefined, onClick: () => { c().toggleItalic().run() } },
          { label: 'Underline', icon: <UnderlineIcon size={16} />, hint: `${mod}U`, checked: editor.isActive('underline') || undefined, onClick: () => { c().toggleUnderline().run() } },
          { label: 'Strikethrough', icon: <Strikethrough size={16} />, checked: editor.isActive('strike') || undefined, onClick: () => { c().toggleStrike().run() } },
          { label: 'Clear formatting', icon: <RemoveFormatting size={16} />, onClick: () => { c().unsetAllMarks().clearNodes().run() } },
        )
        if (!href) items.push({ label: 'Link…', icon: <Link2 size={16} />, hint: picked ? undefined : 'add at cursor', onClick: () => void editLink(editor, '') })
      }
      if (picked && onComment) items.push({ label: 'Comment', icon: <MessageSquarePlus size={16} />, onClick: onComment })

      // tables
      if (can && editor.isActive('table')) {
        const c = () => editor.chain().focus()
        items.push({ sep: true }, { heading: 'Table' },
          { label: 'Insert row above', onClick: () => { c().addRowBefore().run() } }, { label: 'Insert row below', onClick: () => { c().addRowAfter().run() } },
          { label: 'Insert column left', onClick: () => { c().addColumnBefore().run() } }, { label: 'Insert column right', onClick: () => { c().addColumnAfter().run() } },
          { label: 'Merge cells', onClick: () => { c().mergeCells().run() } }, { label: 'Split cell', onClick: () => { c().splitCell().run() } },
          { label: 'Delete row', danger: true, onClick: () => { c().deleteRow().run() } }, { label: 'Delete column', danger: true, onClick: () => { c().deleteColumn().run() } },
          { label: 'Delete table', danger: true, onClick: () => { c().deleteTable().run() } })
      }
      items.push({ sep: true }, { label: 'Find and replace…', icon: <Search size={16} />, hint: `${mod}F`, onClick: onFind })
      show(e.clientX, e.clientY, items)
    }
    dom.addEventListener('contextmenu', onCtx)
    return () => dom.removeEventListener('contextmenu', onCtx)
  }, [editor, issues, recheck, ignore, onComment, onFind, show])

  return ctx.node
}

async function editLink(editor: Editor, current: string) {
  const v = await askText({ title: current ? 'Edit link' : 'Add a link', value: current, placeholder: 'https://…', label: 'Apply' })
  if (v === null) return
  const chain = editor.chain().focus().extendMarkRange('link')
  if (!v.trim()) chain.unsetLink().run(); else chain.setLink({ href: normalizeLink(v) }).run()
}


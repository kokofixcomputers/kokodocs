import { useEffect, useRef, useState } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { Fragment } from '@tiptap/pm/model'
import { Plugin, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { AlertCircle, ExternalLink, GripVertical, Globe, Link2, LayoutPanelTop, MonitorPlay, Trash2 } from 'lucide-react'
import { api, type LinkPreview } from '../api'
import { getWriting } from '../prefs'
import { embedFor, soleUrl } from './linkEmbeds'

/** A pasted web address turns into a rich preview: a player or embedded page (YouTube, Vimeo, Spotify, X, …) or a card with the page's title, text and picture.
 *  The little switch on it goes back to a plain link, and forward again, any time. */
type Mode = 'embed' | 'card' | 'link'

export function embedAt(view: EditorView, from: number, to: number, url: string): boolean {
  const { state } = view, type = state.schema.nodes.linkEmbed, para = state.schema.nodes.paragraph
  if (!type) return false
  const $f = state.doc.resolve(from), parent = $f.parent   // (from is the position just before the line being replaced)
  const node = type.create({ url, mode: embedFor(url) ? 'embed' : 'card' })
  const content = Fragment.from([node, para.create()])
  const idx = $f.index()
  if (!parent.canReplace(idx, idx + 1, content)) return false
  const tr = state.tr.replaceWith(from, to, content)
  tr.setSelection(TextSelection.near(tr.doc.resolve(from + node.nodeSize + 1)))
  view.dispatch(tr.scrollIntoView())
  return true
}

function Switch({ mode, can, on }: { mode: Mode; can: boolean; on: (m: Mode) => void }) {
  const items: { m: Mode; label: string; icon: React.ReactNode; hide?: boolean }[] = [
    { m: 'embed', label: 'Show it here (player or page)', icon: <MonitorPlay size={14} />, hide: !can },
    { m: 'card', label: 'Show a preview card', icon: <LayoutPanelTop size={14} /> },
    { m: 'link', label: 'Show just the link', icon: <Link2 size={14} /> },
  ]
  return (
    <span className="le-switch" role="group" aria-label="How this link is shown">
      {items.filter((i) => !i.hide).map((i) => <button key={i.m} type="button" className={mode === i.m ? 'on' : ''} title={i.label} aria-label={i.label} aria-pressed={mode === i.m} onMouseDown={(e) => e.preventDefault()} onClick={() => on(i.m)}>{i.icon}</button>)}
    </span>
  )
}

function EmbedView({ node, updateAttributes, deleteNode, editor, selected }: NodeViewProps) {
  const a = node.attrs as { url: string; mode: Mode; title: string; description: string; image: string; site: string; favicon: string }
  const embed = embedFor(a.url)
  const mode: Mode = a.mode === 'embed' && !embed ? 'card' : a.mode
  const editable = editor.isEditable
  const [local, setLocal] = useState<LinkPreview | null>(null)
  const [failed, setFailed] = useState(false)
  const asked = useRef('')
  const have = a.title || local?.title
  useEffect(() => {
    if (mode !== 'card' || a.title || asked.current === a.url) return
    asked.current = a.url
    let live = true
    api.linkPreview(a.url).then((p) => {
      if (!live) return
      if (editable) updateAttributes({ title: p.title, description: p.description, image: p.image, site: p.site, favicon: p.favicon }); else setLocal(p)
    }).catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [mode, a.url, a.title, editable, updateAttributes])
  const host = (() => { try { return new URL(a.url).hostname.replace(/^www\./, '') } catch { return a.url } })()
  const d = a.title ? a : local ?? { title: '', description: '', image: '', site: host, favicon: '' }
  const bar = (
    <span className="le-bar" contentEditable={false}>
      {editable && <span className="le-grip" data-drag-handle title="Drag to move"><GripVertical size={14} /></span>}
      <a className="le-open" href={a.url} target="_blank" rel="noopener noreferrer nofollow" title="Open in a new tab"><ExternalLink size={13} /></a>
      {editable && <Switch mode={mode} can={!!embed} on={(m) => updateAttributes({ mode: m })} />}
      {editable && <button type="button" className="le-x" title="Remove" aria-label="Remove" onMouseDown={(e) => e.preventDefault()} onClick={() => deleteNode()}><Trash2 size={13} /></button>}
    </span>
  )
  return (
    <NodeViewWrapper className={`le le-m-${mode} ${selected ? 'selected' : ''}`} contentEditable={false} data-link-embed="">
      {mode === 'link' && (
        <span className="le-line"><Link2 size={15} /><a href={a.url} target="_blank" rel="noopener noreferrer nofollow">{a.url}</a>{bar}</span>
      )}
      {mode === 'embed' && embed && (
        <div className="le-frame-wrap">
          <div className="le-cap"><span>{embed.provider}</span>{bar}</div>
          <div className={`le-frame ${embed.wide ? 'wide' : ''}`} style={embed.wide ? undefined : { height: embed.h }}>
            <iframe src={embed.src} title={`${embed.provider}: ${a.url}`} loading="lazy" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture; web-share"
              sandbox="allow-scripts allow-same-origin allow-popups allow-presentation allow-forms"
              {...({ credentialless: 'true' } as object)} />
          </div>
        </div>
      )}
      {mode === 'card' && (
        <div className={`le-card ${d.image ? 'has-img' : ''}`}>
          <a className="le-card-main" href={a.url} target="_blank" rel="noopener noreferrer nofollow">
            <span className="le-text">
              <span className="le-site">{d.favicon ? <img src={d.favicon} alt="" width={14} height={14} referrerPolicy="no-referrer" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} /> : <Globe size={14} />}{d.site || host}</span>
              <b className="le-title">{have ? d.title : failed ? host : 'Loading preview…'}</b>
              {d.description && <span className="le-desc">{d.description}</span>}
              {failed && !have && <span className="le-desc"><AlertCircle size={13} /> No preview available for this page.</span>}
              <span className="le-url">{a.url}</span>
            </span>
            {d.image && <img className="le-img" src={d.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />}
          </a>
          {bar}
        </div>
      )}
    </NodeViewWrapper>
  )
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> { linkEmbed: { setLinkEmbed: (url: string) => ReturnType } }
}

export const LinkEmbed = Node.create({
  name: 'linkEmbed',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  priority: 200,
  addAttributes() {
    const text = (k: string, d = '') => ({ default: d, parseHTML: (el: HTMLElement) => el.getAttribute(`data-${k}`) ?? d, renderHTML: (a: Record<string, unknown>) => (a[k] ? { [`data-${k}`]: String(a[k]) } : {}) })
    return { url: text('url'), mode: text('mode', 'card'), title: text('title'), description: text('description'), image: text('image'), site: text('site'), favicon: text('favicon') }
  },
  parseHTML() { return [{ tag: 'div[data-link-embed]' }] },
  // the plain link stays in the saved page, so exports, search and readers without previews still get the address
  renderHTML({ node, HTMLAttributes }) { return ['div', mergeAttributes({ 'data-link-embed': '' }, HTMLAttributes), ['a', { href: node.attrs.url }, node.attrs.title || node.attrs.url]] },
  renderText({ node }) { return node.attrs.url },
  addCommands() {
    return { setLinkEmbed: (url) => ({ view, state }) => { const $f = state.selection.$from; return $f.parent.type.name === 'paragraph' && embedAt(view, $f.before(), $f.after(), url) } }
  },
  addNodeView() { return ReactNodeViewRenderer(EmbedView, { stopEvent: ({ event }) => !(event.type === 'dragstart') }) },
  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        handlePaste: (view, event) => {
          if (!view.editable || !getWriting().linkPreviews) return false
          const url = soleUrl(event.clipboardData?.getData('text/plain') ?? '')
          if (!url) return false
          const { selection } = view.state, $f = selection.$from
          // only on an empty line of its own: a link pasted into a sentence stays an ordinary link
          if (!selection.empty || $f.parent.type.name !== 'paragraph' || $f.parent.content.size !== 0) return false
          const done = embedAt(view, $f.before(), $f.after(), url)
          if (done) event.preventDefault()
          return done
        },
      },
    })]
  },
})

import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { Node, type Editor, type Range } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { Plugin } from '@tiptap/pm/state'
import { Check, ChevronDown, Code2, Copy, Globe, Loader2, Plus, Send, Server, Tag, Table2, Trash2, Webhook } from 'lucide-react'
import { api } from '../api'
import { useAuth } from '../auth'
import { Popover } from '../ui/Popover'
import { askText } from '../ui/Dialogs'
import { toast } from '../ui/Toast'
import type { SlashItem } from '../editor/SlashMenu'
import { METHODS, NetworkFailure, build, badgeTone, fmtSize, pretty, sendDirect, statusTone, toCurl, toFetch, toPython, type BodyType, type KV, type Method, type Reply, type ReqSpec, type Vars } from './request'

/** What the blocks need from the page around them: the variables a request can use. */
export const WikiContext = createContext<{ vars: Vars }>({ vars: {} })

// ── small pieces ──────────────────────────────────────────────────────────────

export const MethodBadge = ({ method }: { method: string }) => <span className="wk-badge" data-tone={badgeTone(method)}>{method.toUpperCase()}</span>

export function KVEditor({ rows, onChange, editable, k, v }: { rows: KV[]; onChange: (r: KV[]) => void; editable: boolean; k: string; v: string }) {
  const set = (i: number, patch: Partial<KV>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  if (!editable && !rows.length) return <p className="wk-empty">None</p>
  return (
    <div className="wk-kv">
      {rows.map((r, i) => (
        <div key={i} className={`wk-kv-row ${r.off ? 'off' : ''}`}>
          {editable && <input type="checkbox" checked={!r.off} onChange={(e) => set(i, { off: !e.target.checked })} aria-label="Include" />}
          <input value={r.k} placeholder={k} readOnly={!editable} spellCheck={false} onChange={(e) => set(i, { k: e.target.value })} />
          <input value={r.v} placeholder={v} readOnly={!editable} spellCheck={false} onChange={(e) => set(i, { v: e.target.value })} />
          {editable && <button className="icon-btn sm" aria-label="Remove" onClick={() => onChange(rows.filter((_, j) => j !== i))}><Trash2 size={14} /></button>}
        </div>))}
      {editable && <button className="wk-add" onClick={() => onChange([...rows, { k: '', v: '' }])}><Plus size={14} />Add</button>}
    </div>
  )
}

/** Light JSON colouring for replies and examples. Anything that isn't JSON is shown as plain text. */
function Code({ text }: { text: string }) {
  const parts = useMemo(() => {
    if (text.length > 120_000) return [text]
    const out: ReactNode[] = []
    const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g
    let last = 0, m: RegExpExecArray | null, n = 0
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(text.slice(last, m.index))
      const cls = m[1] ? (m[2] ? 'k' : 's') : m[3] ? 'b' : 'n'
      out.push(<span key={n++} className={`tk-${cls}`}>{m[1] ?? m[0]}</span>)
      if (m[2]) out.push(m[2])
      last = m.index + m[0].length
    }
    out.push(text.slice(last))
    return out
  }, [text])
  return <pre className="wk-code"><code>{parts}</code></pre>
}

const copy = async (t: string, what: string) => { try { await navigator.clipboard.writeText(t); toast(`${what} copied`) } catch { toast('Couldn’t copy') } }

// ── the request block ─────────────────────────────────────────────────────────

type Tab = 'params' | 'headers' | 'body' | 'example'

function ApiView({ node, updateAttributes, editor, selected }: NodeViewProps) {
  const a = node.attrs as ReqSpec & { example: string; title: string }
  const editable = editor.isEditable
  // people who can only read the wiki can still change the request to try their own values; that stays in their browser
  const [draft, setDraft] = useState<Partial<ReqSpec> | null>(null)
  const base: ReqSpec = { method: a.method, url: a.url, query: a.query, headers: a.headers, body: a.body, bodyType: a.bodyType }
  const spec: ReqSpec = editable || !draft ? base : { ...base, ...draft }
  const { vars } = useContext(WikiContext)
  const { user } = useAuth()
  const [tab, setTab] = useState<Tab>(a.query.length ? 'params' : a.body ? 'body' : 'params')
  const [reply, setReply] = useState<Reply | null>(null)
  const [rtab, setRtab] = useState<'body' | 'headers'>('body')
  const [err, setErr] = useState<{ text: string; network?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const built = useMemo(() => build(spec, vars), [spec.method, spec.url, spec.query, spec.headers, spec.body, spec.bodyType, vars])  // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (viaServer = false) => {
    if (built.error) { setErr({ text: built.error }); return }
    setBusy(true); setErr(null)
    abort.current?.abort(); abort.current = new AbortController()
    try {
      if (viaServer) {
        const r = await api.wikiProxy({ method: built.method, url: built.url, headers: built.headers, body: built.body })
        setReply({ status: r.status, statusText: r.status_text, ms: r.ms, size: r.size, headers: r.headers, body: r.binary ? '' : r.body, binary: r.binary, via: 'server' })
      } else setReply(await sendDirect(built, abort.current.signal))
      setRtab('body')
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      setErr({ text: (e as Error).message, network: e instanceof NetworkFailure })
    } finally { setBusy(false) }
  }
  const upd = (p: Partial<ReqSpec & { example: string; title: string }>) => { if (editable) updateAttributes(p); else if (!('example' in p) && !('title' in p)) setDraft((d) => ({ ...d, ...p })) }
  const body = reply ? pretty(reply.body, reply.headers['content-type']) : ''
  const nParams = spec.query.filter((q) => !q.off && q.k).length, nHeaders = spec.headers.filter((q) => !q.off && q.k).length

  return (
    <NodeViewWrapper className={`wk-api ${selected ? 'selected' : ''}`} data-method={spec.method.toLowerCase()} contentEditable={false}>
      <div className="wk-api-bar">
        <select className="wk-badge wk-method-select" data-tone={badgeTone(spec.method)} value={spec.method} aria-label="Method" onChange={(e) => upd({ method: e.target.value as Method })}>
          {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <input className="wk-url" value={spec.url} spellCheck={false} placeholder="{{baseUrl}}/path" aria-label="Address" onChange={(e) => upd({ url: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void send(false) } }} />
        <button className="btn btn-pill btn-primary btn-sm wk-send" disabled={busy} onClick={() => send(false)}>{busy ? <Loader2 size={15} className="spin" /> : <Send size={15} />}Send</button>
      </div>
      {(editable || a.title) && <input className="wk-api-title" value={a.title} readOnly={!editable} placeholder="Short description (optional)" onChange={(e) => upd({ title: e.target.value })} />}

      <div className="wk-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'params'} className={tab === 'params' ? 'on' : ''} onClick={() => setTab('params')}>Parameters{nParams > 0 && <b>{nParams}</b>}</button>
        <button role="tab" aria-selected={tab === 'headers'} className={tab === 'headers' ? 'on' : ''} onClick={() => setTab('headers')}>Headers{nHeaders > 0 && <b>{nHeaders}</b>}</button>
        <button role="tab" aria-selected={tab === 'body'} className={tab === 'body' ? 'on' : ''} onClick={() => setTab('body')}>Body{spec.bodyType !== 'none' && spec.body && <b>•</b>}</button>
        {(editable || a.example) && <button role="tab" aria-selected={tab === 'example'} className={tab === 'example' ? 'on' : ''} onClick={() => setTab('example')}>Example response</button>}
        <span className="wk-tabs-gap" />
        {!editable && draft && <button className="wk-link-btn" onClick={() => setDraft(null)} title="Go back to the request as written in the wiki">Reset</button>}
        <Popover align="end" trigger={({ toggle }) => <button className="wk-link-btn" onClick={toggle}><Code2 size={15} />Code<ChevronDown size={13} /></button>}>
          {(close) => (
            <div className="menu">
              <button onClick={() => { close(); void copy(toCurl(built), 'cURL command') }}><Copy size={15} />Copy as cURL</button>
              <button onClick={() => { close(); void copy(toFetch(built), 'fetch code') }}><Copy size={15} />Copy as JavaScript</button>
              <button onClick={() => { close(); void copy(toPython(built), 'Python code') }}><Copy size={15} />Copy as Python</button>
            </div>)}
        </Popover>
      </div>
      <div className="wk-pane">
        {tab === 'params' && <KVEditor rows={spec.query} editable k="name" v="value" onChange={(query) => upd({ query })} />}
        {tab === 'headers' && <KVEditor rows={spec.headers} editable k="Header" v="value" onChange={(headers) => upd({ headers })} />}
        {tab === 'body' && (
          <div className="wk-body">
            <div className="seg wk-seg">{(['none', 'json', 'text', 'form'] as BodyType[]).map((t) => (
              <button key={t} className={spec.bodyType === t ? 'on' : ''} onClick={() => upd({ bodyType: t })}>{t === 'none' ? 'None' : t === 'json' ? 'JSON' : t === 'text' ? 'Text' : 'Form'}</button>))}</div>
            {spec.bodyType !== 'none' && (
              <>
                <textarea value={spec.body} spellCheck={false} rows={Math.min(14, Math.max(4, spec.body.split('\n').length + 1))} placeholder={spec.bodyType === 'json' ? '{\n  "name": "Ada"\n}' : spec.bodyType === 'form' ? 'name=Ada&role=admin' : ''} onChange={(e) => upd({ body: e.target.value })} />
                {spec.bodyType === 'json' && <button className="wk-link-btn" onClick={() => { try { upd({ body: JSON.stringify(JSON.parse(spec.body), null, 2) }) } catch { toast('That isn’t valid JSON yet') } }}>Format JSON</button>}
              </>)}
          </div>)}
        {tab === 'example' && (editable
          ? <textarea className="wk-example" value={a.example} spellCheck={false} rows={Math.min(16, Math.max(5, a.example.split('\n').length + 1))} placeholder="Paste a sample reply here, or send the request above and use “Save as example”." onChange={(e) => upd({ example: e.target.value })} />
          : <Code text={a.example} />)}
      </div>
      {built.missing.length > 0 && <p className="wk-note"><Tag size={13} />Uses {built.missing.map((m) => `{{${m}}}`).join(', ')}. Set {built.missing.length > 1 ? 'them' : 'it'} under Variables.</p>}

      {err && (
        <div className="wk-error" role="alert">
          <span>{err.text}</span>
          {err.network && (user
            ? <button className="btn btn-pill btn-soft btn-sm" disabled={busy} onClick={() => send(true)}><Server size={14} />Send from KokoDocs server</button>
            : <span className="muted">Sign in to send it through the KokoDocs server instead.</span>)}
        </div>)}
      {reply && (
        <div className="wk-reply">
          <div className="wk-reply-head">
            <span className="wk-status" data-tone={statusTone(reply.status)}>{reply.status} {reply.statusText}</span>
            <span>{reply.ms} ms</span><span>{fmtSize(reply.size)}</span>
            <span className="wk-via" title={reply.via === 'server' ? 'Sent from the KokoDocs server' : 'Sent from your browser'}>{reply.via === 'server' ? <Server size={13} /> : <Globe size={13} />}{reply.via === 'server' ? 'Server' : 'Browser'}</span>
            <span className="wk-tabs-gap" />
            <div className="seg wk-seg"><button className={rtab === 'body' ? 'on' : ''} onClick={() => setRtab('body')}>Body</button><button className={rtab === 'headers' ? 'on' : ''} onClick={() => setRtab('headers')}>Headers</button></div>
            {rtab === 'body' && !reply.binary && <button className="icon-btn sm" aria-label="Copy reply" onClick={() => void copy(body, 'Reply')}><Copy size={15} /></button>}
            {editable && rtab === 'body' && !reply.binary && <button className="wk-link-btn" onClick={() => { upd({ example: body }); setTab('example'); toast('Saved as the example response') }}><Check size={14} />Save as example</button>}
            <button className="icon-btn sm" aria-label="Clear reply" onClick={() => setReply(null)}>×</button>
          </div>
          {rtab === 'body'
            ? (reply.binary ? <p className="wk-empty">Binary reply ({fmtSize(reply.size)}), not shown.</p> : <Code text={body.length > 200_000 ? body.slice(0, 200_000) + '\n… (cut off)' : body || '(empty)'} />)
            : <div className="wk-headers">{Object.entries(reply.headers).map(([k, v]) => <div key={k}><b>{k}</b><span>{v}</span></div>)}</div>}
        </div>)}
    </NodeViewWrapper>
  )
}

const kvAttr = { default: [] as KV[], renderHTML: () => ({}) }
/** The request block's data shape on its own, with no screen: the assistant edits pages through a hidden editor that uses this. */
export const ApiRequestSchema = Node.create({
  name: 'apiRequest',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      method: { default: 'GET' }, url: { default: '{{baseUrl}}/' }, query: kvAttr, headers: kvAttr, body: { default: '' }, bodyType: { default: 'none' }, example: { default: '' }, title: { default: '' },
    }
  },
  parseHTML() { return [{ tag: 'div[data-wk-api]', getAttrs: (el) => { try { return JSON.parse((el as HTMLElement).getAttribute('data-wk-api') || '{}') } catch { return false } } }] },
  renderHTML({ node }) { return ['div', { 'data-wk-api': JSON.stringify(node.attrs), class: 'wk-api-static' }, `${node.attrs.method} ${node.attrs.url}`] },
})
export const ApiRequest = ApiRequestSchema.extend({
  addNodeView() { return ReactNodeViewRenderer(ApiView, { stopEvent: ({ event }) => !(event.type === 'dragstart') }) },
})

// ── badges ────────────────────────────────────────────────────────────────────

/** A small coloured label inside a sentence: an HTTP method, "Required", "Deprecated", "Beta", or any word. Double-click to rename. */
export const WikiBadge = Node.create({
  name: 'wikiBadge',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() { return { label: { default: 'NEW', parseHTML: (el) => el.getAttribute('data-label') ?? el.textContent ?? '' } } },
  parseHTML() { return [{ tag: 'span[data-wk-badge]' }] },
  renderHTML({ node }) { return ['span', { class: 'wk-badge', 'data-wk-badge': '', 'data-label': node.attrs.label, 'data-tone': badgeTone(node.attrs.label) }, String(node.attrs.label)] },
  addProseMirrorPlugins() {
    const editor = this.editor
    return [new Plugin({
      props: {
        handleDoubleClickOn(view, _pos, node, nodePos) {
          if (node.type.name !== 'wikiBadge' || !editor.isEditable) return false
          void askText({ title: 'Badge text', value: node.attrs.label, label: 'Save' }).then((v) => { if (v) view.dispatch(view.state.tr.setNodeMarkup(nodePos, undefined, { label: v.slice(0, 24) })) })
          return true
        },
      },
    })]
  },
})

// ── "/" menu entries ─────────────────────────────────────────────────────────

const cell = (t: string, header = false) => ({ type: header ? 'tableHeader' : 'tableCell', content: [{ type: 'paragraph', content: t ? [{ type: 'text', text: t }] : [] }] })
const row = (cells: string[], header = false) => ({ type: 'tableRow', content: cells.map((c) => cell(c, header)) })
const put = (e: Editor, r: Range, content: object) => e.chain().focus().deleteRange(r).insertContent(content).run()
const badge = (label: string, hint: string, keys: string): SlashItem => ({ title: `Badge: ${label}`, hint, keys: `badge label tag ${keys}`, icon: Tag, run: (e, r) => put(e, r, [{ type: 'wikiBadge', attrs: { label } }, { type: 'text', text: ' ' }]) })

export const wikiSlashItems: SlashItem[] = [
  { title: 'API request', hint: 'A request you can edit and send', keys: 'api endpoint request http try rest send curl', icon: Webhook, run: (e, r) => put(e, r, { type: 'apiRequest' }) },
  { title: 'Parameters table', hint: 'Name, type, required, description', keys: 'params fields table schema arguments', icon: Table2, run: (e, r) => put(e, r, { type: 'table', content: [row(['Name', 'Type', 'Required', 'Description'], true), row(['', 'string', 'Yes', '']), row(['', 'string', 'No', ''])] }) },
  { title: 'Response codes table', hint: 'Status codes and what they mean', keys: 'status http errors codes responses table', icon: Table2, run: (e, r) => put(e, r, { type: 'table', content: [row(['Status', 'Meaning'], true), row(['200', 'Success']), row(['400', 'Bad request']), row(['401', 'Unauthorized']), row(['404', 'Not found'])] }) },
  ...(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const).map((m) => badge(m, 'Coloured method label', m.toLowerCase())),
  badge('Required', 'Red label', 'mandatory'), badge('Optional', 'Green label', ''), badge('Deprecated', 'Amber label', 'old legacy'), badge('Beta', 'Blue label', 'preview experimental'), badge('New', 'Green label', ''),
]

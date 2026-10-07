import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, CheckCircle2, FileText, Info, Lock, LogIn, Paperclip, Send, X } from 'lucide-react'
import { DatePicker } from '../ui/DatePicker'
import { Select } from '../ui/Select'
import { Popover } from '../ui/Popover'
import { ColorPicker } from '../editor/ColorPicker'
import { isDarkColor } from '../editor/Callout'
import { TimePicker } from '../ui/TimePicker'
import { MediaView } from './MediaView'
import { type Answers, type FormItem, type PublicForm } from './model'
import { computeFlow } from './flow'
import { checkAll, checkItem } from './validate'

type Other = Record<string, { on: boolean; text: string }>
export type SubmitResult = { ok: true } | { ok: false; message: string; errors?: Record<string, string> }

/** The form as the person filling it sees it: pages, validation, thank-you screen. */
/** The form with its own accent colour: the header bar, buttons, progress and selected answers all follow it. */
export function Fill(props: Parameters<typeof FillInner>[0]) {
  const c = props.form.accent && /^#[0-9a-f]{6}$/i.test(props.form.accent) ? props.form.accent : null
  const vars = c ? { ['--accent' as string]: c, ['--accent-ink' as string]: isDarkColor(c) ? '#ffffff' : '#111111', ['--accent-soft' as string]: `color-mix(in srgb, ${c} 12%, var(--surface))`, ['--accent-soft-2' as string]: `color-mix(in srgb, ${c} 24%, var(--surface))` } : undefined
  return <div className={c ? 'fm-themed' : undefined} style={vars}><FillInner {...props} /></div>
}

export type UploadFn = (itemId: string, file: File) => Promise<{ id: string; name: string; size: number }>

function FillInner({ form, signedIn, signInTo, submitted, preview, onSubmit, uploadFile }: {
  form: PublicForm; signedIn: boolean; signInTo: string; submitted?: boolean; preview?: boolean
  onSubmit: (answers: Answers) => Promise<SubmitResult>; uploadFile?: UploadFn
}) {
  const [page, setPage] = useState(0)
  const [answers, setAnswers] = useState<Answers>({})
  const [other, setOther] = useState<Other>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [files, setFiles] = useState<Record<string, { name: string; size: number }>>({})   // what was attached, for display
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [banner, setBanner] = useState('')
  const top = useRef<HTMLDivElement>(null)

  // the answers as they will be sent: "Other" replaces the option with whatever was typed
  const composed = (): Answers => {
    const out: Answers = {}
    for (const it of form.items) {
      const o = other[it.id], a = answers[it.id]
      if (it.type === 'radio') out[it.id] = o?.on ? o.text.trim() : (a as string) ?? ''
      else if (it.type === 'checkbox') out[it.id] = [...((a as string[]) ?? []), ...(o?.on && o.text.trim() ? [o.text.trim()] : [])]
      else if (a !== undefined) out[it.id] = a
    }
    return out
  }
  const flow = useMemo(() => computeFlow(form.items, composed()), [form.items, answers, other])   // eslint-disable-line react-hooks/exhaustive-deps
  const { pages, path, visible } = flow
  const set = (id: string, v: string | string[]) => { setAnswers((a) => ({ ...a, [id]: v })); setErrors((e) => { if (!e[id]) return e; const n = { ...e }; delete n[id]; return n }) }
  const setOtherFor = (id: string, v: { on: boolean; text: string }) => { setOther((o) => ({ ...o, [id]: v })); setErrors((e) => { if (!e[id]) return e; const n = { ...e }; delete n[id]; return n }) }
  const scrollTop = () => top.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })

  if (done) {
    return (
      <div className="fm-card fm-done rise">
        <CheckCircle2 size={40} />
        <h2>{preview ? 'Preview complete' : 'Response recorded'}</h2>
        <p className="muted">{preview ? 'Nothing was saved. This is what people see after they submit.' : ''}</p>
        <p className="fm-confirm">{form.confirmation || 'Your response has been recorded. Thank you!'}</p>
        {(!form.oneResponse || preview) && <button className="btn btn-pill btn-ghost" onClick={() => { setDone(false); setAnswers({}); setFiles({}); setOther({}); setErrors({}); setPage(0); setBanner('') }}>{preview ? 'Start over' : 'Submit another response'}</button>}
      </div>
    )
  }
  if (!preview && !form.accepting) return <div className="fm-card fm-done rise"><Lock size={34} /><h2>Not accepting responses</h2><p className="muted">The owner has closed this form.</p></div>
  if (!preview && (form.requireLogin || form.oneResponse) && !signedIn) {
    return (
      <div className="fm-card fm-done rise"><LogIn size={34} /><h2>Sign in to respond</h2><p className="muted">{form.oneResponse ? 'This form accepts one response per person.' : 'The owner wants to know who responds.'}</p>
        <Link className="btn btn-pill btn-primary" to="/login" state={{ from: signInTo }}>Sign in</Link></div>
    )
  }
  if (!preview && submitted && form.oneResponse) return <div className="fm-card fm-done rise"><CheckCircle2 size={34} /><h2>You already responded</h2><p className="muted">This form accepts one response per person.</p></div>

  const pos = Math.max(0, path.indexOf(page))
  const cur = pages[path[pos] ?? 0]
  const last = pos >= path.length - 1
  const visibleCount = path.length
  const shownItems = cur.items.filter((i) => visible.has(i.id))

  const validate = (its: FormItem[]) => {
    const all = composed(); const e = checkAll(its.filter((i) => visible.has(i.id)), all)
    for (const it of its.filter((i) => visible.has(i.id))) { const o = other[it.id]; if (o?.on && !o.text.trim() && (it.type === 'radio')) e[it.id] = 'Type your answer for “Other”' }
    return e
  }
  const next = () => { const e = validate(shownItems); setErrors(e); if (Object.keys(e).length) { setBanner('Fix the highlighted questions to continue'); return } setBanner(''); setPage(path[pos + 1]); setTimeout(scrollTop, 0) }
  const submit = async () => {
    const e = validate(form.items); setErrors(e)
    const bad = path.find((pi) => pages[pi].items.some((i) => e[i.id])) ?? -1
    if (bad >= 0) { setPage(bad); setBanner('Fix the highlighted questions to submit'); setTimeout(scrollTop, 0); return }
    setBusy(true); setBanner('')
    const all = composed(), sent: Answers = {}
    for (const k of Object.keys(all)) if (visible.has(k)) sent[k] = all[k]
    const r = preview ? ({ ok: true } as SubmitResult) : await onSubmit(sent)
    setBusy(false)
    if (r.ok) { setDone(true); setTimeout(scrollTop, 0); return }
    if (r.errors) { setErrors(r.errors); const b = path.find((pi) => pages[pi].items.some((i) => r.errors![i.id])); if (b !== undefined) setPage(b) }
    setBanner(r.message)
  }

  return (
    <div className="fm-fill" ref={top}>
      {pos === 0 && (
        <div className="fm-card fm-head rise">
          <h1>{form.title || 'Untitled form'}</h1>
          {form.description && <p className="fm-desc">{form.description}</p>}
          {form.items.some((i) => i.required && visible.has(i.id)) && <p className="fm-req-note"><span className="fm-star">*</span> Required</p>}
        </div>
      )}
      {cur.head && (
        <div className="fm-card fm-pagehead rise"><h2>{cur.head.title}</h2>{cur.head.help && <p className="fm-desc">{cur.head.help}</p>}</div>
      )}
      {pages.length > 1 && <div className="fm-progress" role="progressbar" aria-valuemin={1} aria-valuemax={visibleCount} aria-valuenow={pos + 1}><i style={{ width: `${((pos + 1) / visibleCount) * 100}%` }} /><span>Page {pos + 1} of {visibleCount}</span></div>}
      {shownItems.map((it) => (
        <Question key={it.id} it={it} value={answers[it.id]} other={other[it.id]} error={errors[it.id]}
          onChange={(v) => set(it.id, v)} onOther={(v) => setOtherFor(it.id, v)}
          file={files[it.id]} onFile={(m) => { setFiles((f) => { const n = { ...f }; if (m) n[it.id] = { name: m.name, size: m.size }; else delete n[it.id]; return n }); set(it.id, m ? m.id : '') }}
          upload={uploadFile ? (f) => uploadFile(it.id, f) : preview ? async (f) => ({ id: 'preview', name: f.name, size: f.size }) : undefined}
          onBlur={() => { const e = checkItem(it, composed()[it.id]); if (e && answers[it.id] !== undefined) setErrors((x) => ({ ...x, [it.id]: e })) }} />
      ))}
      {banner && <p className="form-error fm-banner" role="alert">{banner}</p>}
      <div className="fm-nav">
        {pos > 0 ? <button className="btn btn-pill btn-ghost" onClick={() => { setPage(path[pos - 1]); setBanner(''); setTimeout(scrollTop, 0) }}><ArrowLeft size={16} />Back</button> : <span />}
        {last
          ? <button className="btn btn-pill btn-primary btn-lg" disabled={busy} onClick={submit}>{busy ? <span className="spinner sm" /> : <><Send size={16} />{preview ? 'Submit (preview)' : 'Submit'}</>}</button>
          : <button className="btn btn-pill btn-primary btn-lg" onClick={next}>Next<ArrowRight size={16} /></button>}
      </div>
    </div>
  )
}

function Question({ it, value, other, error, onChange, onOther, onBlur, file, onFile, upload }: {
  it: FormItem; value: string | string[] | undefined; other?: { on: boolean; text: string }; error?: string
  onChange: (v: string | string[]) => void; onOther: (v: { on: boolean; text: string }) => void; onBlur: () => void
  file?: { name: string; size: number }; onFile: (m: { id: string; name: string; size: number } | null) => void; upload?: (f: File) => Promise<{ id: string; name: string; size: number }>
}) {
  if (it.type === 'media') return <MediaView it={it} />
  if (it.type === 'info') return <div className="fm-card fm-info"><Info size={20} /><p>{it.title}</p></div>
  if (it.type === 'section') return <div className="fm-card fm-section"><h3>{it.title}</h3>{it.help && <p className="fm-desc">{it.help}</p>}</div>
  const str = typeof value === 'string' ? value : ''
  const arr = Array.isArray(value) ? value : []
  const id = `q-${it.id}`
  const input = (() => {
    switch (it.type) {
      case 'date': return <DatePicker id={id} ariaLabel={it.title} value={str} min={typeof it.min === 'string' ? it.min : undefined} max={typeof it.max === 'string' ? it.max : undefined} onChange={onChange} onClose={onBlur} />
      case 'time': return <TimePicker id={id} ariaLabel={it.title} value={str} onChange={onChange} onClose={onBlur} />
      case 'short': case 'email': case 'url': case 'number':
        return <input id={id} className="fm-input" type={it.type === 'short' ? 'text' : it.type === 'number' ? 'text' : it.type} inputMode={it.type === 'number' ? 'decimal' : undefined}
          placeholder={it.placeholder || (it.type === 'email' ? 'name@example.com' : it.type === 'url' ? 'https://' : it.type === 'number' ? '0' : 'Your answer')}
          value={str} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} maxLength={it.maxLen ? undefined : 2000} autoComplete="off" />
      case 'color': return <ColorInput id={id} value={str} onChange={onChange} onClose={onBlur} />
      case 'file': return <FileInput it={it} id={id} meta={str ? file : undefined} onFile={onFile} upload={upload} />
      case 'long': return <textarea id={id} className="fm-input fm-area" rows={4} placeholder={it.placeholder || 'Your answer'} value={str} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} maxLength={10000} />
      case 'select': return <Select label={it.title} className="fm-select" value={str} onChange={(v) => onChange(v)} options={[{ value: '', label: 'Choose…' }, ...(it.options ?? []).map((o) => ({ value: o, label: o }))]} />
      case 'radio': return (
        <div className="fm-opts" role="radiogroup" aria-labelledby={`${id}-t`}>
          {(it.options ?? []).map((o) => (
            <label key={o} className={`fm-opt ${!other?.on && str === o ? 'on' : ''}`}><input type="radio" name={id} checked={!other?.on && str === o} onChange={() => { onChange(o); onOther({ on: false, text: other?.text ?? '' }) }} /><i className="fm-mark round" />{o}</label>
          ))}
          {it.other && (
            <label className={`fm-opt ${other?.on ? 'on' : ''}`}><input type="radio" name={id} checked={!!other?.on} onChange={() => onOther({ on: true, text: other?.text ?? '' })} /><i className="fm-mark round" />Other
              {other?.on && <input className="fm-other" autoFocus placeholder="Type your answer" value={other.text} onChange={(e) => onOther({ on: true, text: e.target.value })} />}
            </label>)}
          {str && !it.required && !other?.on && <button type="button" className="fm-clear" onClick={() => onChange('')}>Clear selection</button>}
        </div>)
      case 'checkbox': return (
        <div className="fm-opts" role="group" aria-labelledby={`${id}-t`}>
          {(it.options ?? []).map((o) => (
            <label key={o} className={`fm-opt ${arr.includes(o) ? 'on' : ''}`}><input type="checkbox" checked={arr.includes(o)} onChange={() => onChange(arr.includes(o) ? arr.filter((x) => x !== o) : [...arr, o])} /><i className="fm-mark"><Check size={13} strokeWidth={3} /></i>{o}</label>
          ))}
          {it.other && (
            <label className={`fm-opt ${other?.on ? 'on' : ''}`}><input type="checkbox" checked={!!other?.on} onChange={() => onOther({ on: !other?.on, text: other?.text ?? '' })} /><i className="fm-mark"><Check size={13} strokeWidth={3} /></i>Other
              {other?.on && <input className="fm-other" autoFocus placeholder="Type your answer" value={other.text} onChange={(e) => onOther({ on: true, text: e.target.value })} />}
            </label>)}
        </div>)
      case 'scale': {
        const lo = it.scaleMin ?? 1, hi = it.scaleMax ?? 5
        const nums = Array.from({ length: Math.max(0, hi - lo + 1) }, (_, i) => lo + i)
        return (
          <div className="fm-scale" role="radiogroup" aria-labelledby={`${id}-t`}>
            {it.minLabel && <span className="fm-end">{it.minLabel}</span>}
            <div className="fm-scale-row">{nums.map((n) => <button type="button" key={n} role="radio" aria-checked={str === String(n)} className={str === String(n) ? 'on' : ''} onClick={() => onChange(str === String(n) && !it.required ? '' : String(n))}>{n}</button>)}</div>
            {it.maxLabel && <span className="fm-end">{it.maxLabel}</span>}
          </div>)
      }
      default: return null
    }
  })()
  return (
    <div className={`fm-card fm-q rise ${error ? 'bad' : ''}`}>
      <label id={`${id}-t`} htmlFor={id} className="fm-q-title">{it.title}{it.required && <span className="fm-star" aria-label="required"> *</span>}</label>
      {it.help && <p className="fm-q-help">{it.help}</p>}
      {input}
      {error && <p className="fm-err" role="alert">{error}</p>}
    </div>
  )
}


const FILE_HINT: Record<string, string> = { images: 'PNG, JPEG, GIF or WebP', pdf: 'PDF', docs: 'documents, spreadsheets, slides, PDF or text' }
const ACCEPT_ATTR: Record<string, string> = { images: 'image/png,image/jpeg,image/gif,image/webp', pdf: 'application/pdf,.pdf', docs: '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.txt,.csv,.md,.rtf' }
const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`)

/** Attach one file: choose or drop it, it uploads straight away, and can be replaced or removed before submitting. */
function FileInput({ it, id, meta, onFile, upload }: { it: FormItem; id: string; meta?: { name: string; size: number }; onFile: (m: { id: string; name: string; size: number } | null) => void; upload?: (f: File) => Promise<{ id: string; name: string; size: number }> }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const max = Math.min(3, Math.max(0.1, it.maxMB ?? 3)) * 1048576
  const take = async (f: File | undefined) => {
    if (!f || !upload) return
    setErr('')
    if (f.size === 0) return setErr('That file is empty')
    if (f.size > max) return setErr(`That file is larger than ${+(max / 1048576).toFixed(1)} MB`)
    setBusy(true)
    try { onFile(await upload(f)) } catch (e) { setErr((e as Error).message || 'Upload failed') } finally { setBusy(false); if (input.current) input.current.value = '' }
  }
  return (
    <div className="fm-file">
      <input ref={input} id={id} type="file" hidden accept={it.accept ? ACCEPT_ATTR[it.accept] : undefined} onChange={(e) => take(e.target.files?.[0])} />
      {meta ? (
        <div className="fm-file-done"><FileText size={20} /><span className="fm-file-name"><b>{meta.name}</b><em>{fmtSize(meta.size)}</em></span>
          <button type="button" className="btn btn-pill btn-soft btn-sm" onClick={() => input.current?.click()} disabled={busy}>Replace</button>
          <button type="button" className="icon-btn sm" aria-label="Remove file" onClick={() => { setErr(''); onFile(null) }}><X size={16} /></button></div>
      ) : (
        <button type="button" className={`fm-drop ${over ? 'over' : ''}`} disabled={busy || !upload} onClick={() => input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files?.[0]) }}>
          {busy ? <span className="spinner sm" style={{ borderTopColor: 'var(--ink)' }} /> : <Paperclip size={20} />}
          <span><b>{busy ? 'Uploading…' : 'Choose a file'}</b>{busy ? '' : ' or drop it here'}</span>
          <em>Up to {+(max / 1048576).toFixed(1)} MB{it.accept ? ` · ${FILE_HINT[it.accept]}` : ''}</em>
        </button>
      )}
      {err && <p className="fm-err" role="alert">{err}</p>}
    </div>
  )
}

/** Pick a colour with the same picker documents use (presets, recent colours, any custom colour). The answer is a hex value like #1f6feb. */
function ColorInput({ id, value, onChange, onClose }: { id: string; value: string; onChange: (v: string) => void; onClose: () => void }) {
  return (
    <Popover className="fm-color-pop" onOpenChange={(o) => { if (!o) onClose() }}
      trigger={({ toggle, open }) => (
        <button type="button" id={id} className={`dp-btn fm-color-btn ${open ? 'open' : ''} ${value ? '' : 'empty'}`} aria-haspopup="dialog" aria-expanded={open} onClick={toggle}>
          <i className="fm-sw big" style={value ? { background: value } : undefined} /><span>{value ? value.toUpperCase() : 'Pick a colour'}</span>
        </button>)}>
      {(close) => <ColorPicker value={value || null} noneLabel="Clear" onPick={(c) => { onChange(c ?? ''); close() }} />}
    </Popover>
  )
}

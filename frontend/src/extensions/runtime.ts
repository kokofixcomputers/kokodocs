/** Extensions: small JavaScript programs a person adds in Settings. Each runs inside its own sandboxed iframe (no access to the page, the account, cookies or the network);
 *  the only way out is the `koko` API below, whose results the app applies itself (a theme's colours, HTML that the editor parses, a block's markup that is cleaned first). */
import { useSyncExternalStore } from 'react'

export interface Extension { id: string; name: string; code: string; enabled: boolean; trusted?: boolean }   // trusted: runs in the page itself, without the sandbox
export interface ExtField { key: string; label: string; type?: 'text' | 'number' | 'color' | 'longtext' }
export interface SettingField { key: string; label: string; type: 'text' | 'longtext' | 'number' | 'toggle' | 'select' | 'color'; default?: unknown; options?: { value: string; label: string }[]; help?: string }
export interface ExtError { at: number; where: string; message: string }
export interface ExtTheme { key: string; ext: string; id: string; name: string; base: 'light' | 'dark'; vars: Record<string, string>; css: string }
export interface ExtSlash { key: string; ext: string; fn: string; title: string; hint: string; keys: string }
export interface ExtBlock { key: string; ext: string; id: string; title: string; hint: string; defaults: Record<string, unknown>; fields: ExtField[] }
export interface ExtDialog { id: number; ext: string; extName: string; spec: any; resolve: (v: unknown) => void }
interface Live { frame?: HTMLIFrameElement; receive?: (m: any) => void; trusted: boolean; code: string; ready: boolean; error: string; css: string; pending: Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void; t: number }> }

/** The `koko` API and its message handling, written once as source text: the sandbox runs it inside the iframe, an unsandboxed extension runs it in the page. */
const CORE = `function core(post) {
  const fns = {}; let n = 0, aid = 0, values = {}, schema = []; const watchers = [], asks = new Map()
  const bad = (where, msg) => post({ t: 'error', where, error: msg })
  const str = (v, d = '') => (typeof v === 'string' ? v : d)
  const ask = (spec) => new Promise((res) => { const id = ++aid; asks.set(id, res); post({ t: 'dialog', id, spec }) })
  const koko = {
    fullAccess: false,
    theme(t) { post({ t: 'theme', id: str(t.id, 'theme'), name: str(t.name, 'Theme'), base: t.base === 'light' ? 'light' : 'dark', vars: t.vars || {}, css: str(t.css) }) },
    css(s) { post({ t: 'css', css: str(s) }) },
    settings(list) { schema = Array.isArray(list) ? list : []; post({ t: 'settings', fields: schema }) },
    get(k) { if (k in values) return values[k]; const f = schema.find((x) => x.key === k); return f ? f.default : undefined },
    onChange(cb) { if (typeof cb === 'function') watchers.push(cb) },
    slash(o) { if (!o || typeof o.run !== 'function') return bad('invalid', 'koko.slash needs a run() function'); const fn = 's' + n++; fns[fn] = o.run; post({ t: 'slash', fn, title: str(o.title, 'Extension'), hint: str(o.hint), keys: str(o.keys) }) },
    block(o) { if (!o || !o.id || typeof o.render !== 'function') return bad('invalid', 'koko.block needs an id and a render() function'); fns['r:' + o.id] = o.render; post({ t: 'block', id: str(o.id), title: str(o.title, o.id), hint: str(o.hint), defaults: o.defaults || {}, fields: o.fields || [] }) },
    toast(s) { post({ t: 'toast', text: str(s) }) },
    alert(message, o) { o = o || {}; return ask({ kind: 'alert', message: str(message), title: str(o.title), okLabel: str(o.okLabel) }).then(() => undefined) },
    confirm(message, o) { o = o || {}; return ask({ kind: 'confirm', message: str(message), title: str(o.title), okLabel: str(o.okLabel), cancelLabel: str(o.cancelLabel), danger: !!o.danger }) },
    prompt(message, o) { o = o || {}; return ask({ kind: 'prompt', message: str(message), title: str(o.title), value: str(o.value), placeholder: str(o.placeholder), multiline: !!o.multiline, okLabel: str(o.okLabel) }) },
    modal(o) { o = o || {}; return ask({ kind: 'modal', title: str(o.title), html: str(o.html), fields: Array.isArray(o.fields) ? o.fields : [], buttons: Array.isArray(o.buttons) ? o.buttons : [], width: Number(o.width) || 0 }) },
    requestFullAccess(reason) { return koko.fullAccess ? Promise.resolve(true) : ask({ kind: 'trust', reason: str(reason) }) },
  }
  return async function receive(m) {
    if (!m) return
    if (m.t === 'settings') { values = m.values || {}; watchers.forEach((cb) => { try { cb(values) } catch (err) { bad('runtime', 'onChange: ' + String(err && err.message || err)) } }) }
    if (m.t === 'dialogResult') { const r = asks.get(m.id); if (r) { asks.delete(m.id); r(m.value) } }
    if (m.t === 'run') { values = m.settings || {}; koko.fullAccess = !!m.trusted; try { new Function('koko', m.code)(koko); post({ t: 'ready' }) } catch (err) { bad('load', String(err && err.message || err)) } }
    if (m.t === 'call') { try { const v = await fns[m.fn](m.arg); post({ t: 'result', id: m.id, value: v === undefined ? null : v }) } catch (err) { post({ t: 'result', id: m.id, error: String(err && err.message || err) }) } }
  }
}`

const PRELUDE = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'"><script>
const post = (m) => parent.postMessage(m, '*')
const receive = (${CORE})(post)
addEventListener('message', (e) => { if (e.source === parent) receive(e.data) })
addEventListener('error', (e) => post({ t: 'error', where: 'runtime', error: String(e.message || e.error) }))
addEventListener('unhandledrejection', (e) => post({ t: 'error', where: 'runtime', error: String(e.reason && e.reason.message || e.reason) }))
post({ t: 'loaded' })
<\/script>`

/** Send a message to a running extension, whichever way it runs. */
const send = (l: Live, m: unknown) => { if (l.frame) l.frame.contentWindow?.postMessage(m, '*'); else queueMicrotask(() => l.receive?.(m)) }

const live = new Map<string, Live>()
let themes: ExtTheme[] = [], slashes: ExtSlash[] = [], blocks: ExtBlock[] = []
let errorLog: Record<string, ExtError[]> = {}
let schemas: Record<string, SettingField[]> = {}
let settingValues: Record<string, Record<string, unknown>> = {}
let settingsRev = 0
let version = 0
const subs = new Set<() => void>()
const emit = () => { version++; subs.forEach((f) => f()) }
let seq = 0

// ── popups an extension asks for ──
let dialogs: ExtDialog[] = []
const recent: Record<string, number[]> = {}
const declined = new Set<string>()
let trustHandler: ((id: string) => void) | null = null
export const setTrustHandler = (fn: (id: string) => void) => { trustHandler = fn }
export const grantTrust = (id: string) => trustHandler?.(id)
/** Show what an extension asked for (a message, a question, a form, a request for full access). The text is the extension's; the window and its buttons are the app's, and always name the extension. */
function openDialog(ext: Extension, l: Live, id: number, spec: any) {
  const reply = (value: unknown) => send(l, { t: 'dialogResult', id, value })
  const now = Date.now(), r = (recent[ext.id] = (recent[ext.id] ?? []).filter((t) => now - t < 60000))
  if (r.length >= 8) { logError(ext.id, 'popup', 'Too many popups in a minute, the rest were skipped'); reply(null); return }
  r.push(now)
  if (spec?.kind === 'trust') { if (ext.trusted) { reply(true); return } if (declined.has(ext.id)) { reply(false); return } }
  const d: ExtDialog = { id: ++seq, ext: ext.id, extName: ext.name, spec: spec ?? {}, resolve: (v) => { dialogs = dialogs.filter((x) => x !== d); emit(); if (spec?.kind === 'trust') { if (v) grantTrust(ext.id); else if (v === false) declined.add(ext.id) } reply(v) } }
  dialogs = [...dialogs, d]; emit()
}

function handle(ext: Extension, l: Live, m: any) {
  switch (m.t) {
    case 'loaded': send(l, { t: 'run', code: l.code, settings: settingValues[ext.id] ?? {}, trusted: false }); break
    case 'dialog': openDialog(ext, l, m.id, m.spec); break
    case 'ready': l.ready = true; emit(); break
    case 'error': l.error = String(m.error); logError(ext.id, String(m.where ?? 'runtime'), String(m.error)); break
    case 'settings': schemas = { ...schemas, [ext.id]: cleanFields(m.fields, ext.id) }; emit(); break
    case 'theme': { const dropped = Object.keys(m.vars && typeof m.vars === 'object' ? m.vars : {}).filter((k) => !(k in cleanVars(m.vars))); if (dropped.length) logError(ext.id, 'invalid', `Theme “${String(m.name).slice(0, 30)}”: ignored ${dropped.slice(0, 5).join(', ')}${dropped.length > 5 ? '…' : ''} (names must start with -- and values can't contain ; { } or url())`) } themes = [...themes.filter((t) => t.key !== `${ext.id}:${m.id}`), { key: `${ext.id}:${m.id}`, ext: ext.id, id: String(m.id).slice(0, 40), name: String(m.name).slice(0, 60), base: m.base, vars: cleanVars(m.vars), css: String(m.css).slice(0, 20000) }]; emit(); applySelected(); break
    case 'css': l.css = String(m.css).slice(0, 40000); paintCss(); break
    case 'slash': slashes = [...slashes, { key: `${ext.id}:${m.fn}`, ext: ext.id, fn: m.fn, title: String(m.title).slice(0, 60), hint: String(m.hint).slice(0, 120), keys: String(m.keys).slice(0, 120) }]; emit(); break
    case 'block': blocks = [...blocks.filter((b) => b.key !== `${ext.id}:${m.id}`), { key: `${ext.id}:${m.id}`, ext: ext.id, id: String(m.id).slice(0, 40), title: String(m.title).slice(0, 60), hint: String(m.hint).slice(0, 120), defaults: m.defaults && typeof m.defaults === 'object' ? m.defaults : {}, fields: Array.isArray(m.fields) ? m.fields.slice(0, 12).map((f: any) => ({ key: String(f.key), label: String(f.label ?? f.key), type: ['text', 'number', 'color', 'longtext'].includes(f.type) ? f.type : 'text' })) : [] }]; emit(); break
    case 'toast': import('../ui/Toast').then((t) => t.toast(`${ext.name}: ${String(m.text).slice(0, 200)}`)); break
    case 'result': { const p = l.pending.get(m.id); if (p) { l.pending.delete(m.id); window.clearTimeout(p.t); m.error ? p.fail(new Error(m.error)) : p.ok(m.value) } break }
  }
}

const TYPES = ['text', 'longtext', 'number', 'toggle', 'select', 'color']
export function cleanFields(raw: unknown, ext: string): SettingField[] {
  const out: SettingField[] = []
  for (const f of Array.isArray(raw) ? raw.slice(0, 40) : []) {
    if (!f || typeof f.key !== 'string' || !f.key) { logError(ext, 'invalid', 'A setting needs a key'); continue }
    if (!TYPES.includes(f.type)) { logError(ext, 'invalid', `Setting “${String(f.key).slice(0, 30)}” has an unknown type`); continue }
    out.push({ key: f.key.slice(0, 40), label: String(f.label ?? f.key).slice(0, 80), type: f.type, default: f.default, help: typeof f.help === 'string' ? f.help.slice(0, 200) : undefined,
      options: f.type === 'select' && Array.isArray(f.options) ? f.options.slice(0, 40).map((o: any) => typeof o === 'string' ? { value: o, label: o } : { value: String(o.value), label: String(o.label ?? o.value) }) : undefined })
  }
  return out
}

/** Keep a short list of what went wrong in each extension, so one that misbehaves can be found and fixed. Nothing here ever reaches the page itself. */
export function logError(ext: string, where: string, message: string) {
  errorLog = { ...errorLog, [ext]: [{ at: Date.now(), where, message: message.slice(0, 400) }, ...(errorLog[ext] ?? [])].slice(0, 20) }
  emit()
}
export function clearErrors(ext: string) { const { [ext]: _, ...rest } = errorLog; errorLog = rest; emit() }

const cleanVars = (v: unknown): Record<string, string> => {
  const out: Record<string, string> = {}
  if (v && typeof v === 'object') for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (/^--[\w-]{1,40}$/.test(k) && typeof val === 'string' && val.length < 200 && !/[;{}]|url\s*\(/i.test(val)) out[k] = val
  return out
}

function startLocal(ext: Extension) {
  const l: Live = { trusted: true, code: ext.code, ready: false, error: '', css: '', pending: new Map() }
  l.receive = (new Function(`return ${CORE}`)() as (post: (m: unknown) => void) => (m: unknown) => void)((m) => queueMicrotask(() => handle(ext, l, m)))
  live.set(ext.id, l)
  send(l, { t: 'run', code: ext.code, settings: settingValues[ext.id] ?? {}, trusted: true })
}

function start(ext: Extension) {
  if (ext.trusted) { startLocal(ext); return }
  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-scripts')   // no allow-same-origin: it cannot reach this page, its storage or cookies
  frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden'
  frame.srcdoc = PRELUDE
  const l: Live = { frame, trusted: false, code: ext.code, ready: false, error: '', css: '', pending: new Map() }
  const on = (e: MessageEvent) => { if (e.source === frame.contentWindow) handle(ext, l, e.data) }
  window.addEventListener('message', on)
  ;(frame as any)._off = () => window.removeEventListener('message', on)
  live.set(ext.id, l)
  document.body.appendChild(frame)
  window.setTimeout(() => { if (live.get(ext.id) === l && !l.ready && !l.error) logError(ext.id, 'load', 'It did not finish starting within 6 seconds (an endless loop?)') }, 6000)
}

function stop(id: string) {
  const l = live.get(id); if (!l) return
  ;(l.frame as any)?._off?.(); l.frame?.remove(); dialogs.filter((d) => d.ext === id).forEach((d) => d.resolve(null)); l.pending.forEach((p) => { window.clearTimeout(p.t); p.fail(new Error('Extension stopped')) })
  live.delete(id)
  themes = themes.filter((t) => t.ext !== id); slashes = slashes.filter((s) => s.ext !== id); blocks = blocks.filter((b) => b.ext !== id)
  { const { [id]: _s, ...rest } = schemas; schemas = rest }
  paintCss(); emit()
}

let items: Extension[] = []
/** Make the running extensions match the saved list (called when settings load or change). */
export function syncExtensions(list: Extension[], theme: string, settings: Record<string, Record<string, unknown>> = {}) {
  items = list; selected = theme
  const before = settingValues; settingValues = settings
  const want = new Map(list.filter((e) => e.enabled).map((e) => [e.id, e]))
  for (const [id, l] of [...live]) { const w = want.get(id); if (!w || w.code !== l.code || !!w.trusted !== l.trusted) stop(id) }
  for (const [id, e] of want) if (!live.has(id)) start(e)
  for (const [id, l] of live) if (l.ready && JSON.stringify(before[id] ?? {}) !== JSON.stringify(settings[id] ?? {})) { send(l, { t: 'settings', values: settings[id] ?? {} }); settingsRev++ }
  if (!want.size) applySelected()
  emit()
}
export const stopAllExtensions = () => { for (const id of [...live]) stop(id[0]); selected = ''; settingValues = {}; errorLog = {}; applySelected() }
/** Stop an extension and start it again with its current code (the Restart button). */
export function restartExtension(id: string) { const e = items.find((x) => x.id === id); if (!e || !e.enabled) return; stop(id); clearErrors(id); start(e) }

/** Ask a running extension to compute something (a slash command's text, a block's markup). Gives up after 4 seconds. */
export function callExt(ext: string, fn: string, arg?: unknown): Promise<any> {
  const l = live.get(ext)
  if (!l || !l.ready) return Promise.reject(new Error('The extension is not running'))
  return new Promise((ok, fail) => {
    const id = ++seq
    const where = fn.startsWith('r:') ? `block “${fn.slice(2)}”` : `“/” command ${slashes.find((x) => x.ext === ext && x.fn === fn)?.title ?? fn}`
    const t = window.setTimeout(() => { l.pending.delete(id); logError(ext, where, 'It took longer than 4 seconds'); fail(new Error('The extension took too long')) }, 4000)
    l.pending.set(id, { ok, fail: (e) => { logError(ext, where, e.message); fail(e) }, t })
    send(l, { t: 'call', id, fn, arg })
  })
}

// ── themes and extra CSS ──
const THEME_KEY = 'koko.exttheme'
let selected = ''
const styleEl = (id: string) => { let s = document.getElementById(id) as HTMLStyleElement | null; if (!s) { s = document.createElement('style'); s.id = id; document.head.appendChild(s) } return s }
function paintCss() { styleEl('koko-ext-css').textContent = [...live.values()].map((l) => l.css).join('\n') }

export const extThemeBase = (): 'light' | 'dark' | null => { try { return (JSON.parse(localStorage.getItem(THEME_KEY) ?? 'null') as { base: 'light' | 'dark' } | null)?.base ?? null } catch { return null } }

function paintTheme(t: { id: string; base: 'light' | 'dark'; vars: Record<string, string>; css: string } | null) {
  const root = document.documentElement
  if (!t) { root.removeAttribute('data-koko-theme'); styleEl('koko-ext-theme').textContent = ''; return }
  styleEl('koko-ext-theme').textContent = `:root[data-koko-theme][data-theme]{${Object.entries(t.vars).map(([k, v]) => `${k}:${v}`).join(';')}}\n${t.css}`
  root.setAttribute('data-koko-theme', t.id); root.dataset.theme = t.base
}

/** Called once at start-up with the last chosen theme, so the page doesn't flash the default colours first. */
export function paintCachedTheme() {
  try { const c = JSON.parse(localStorage.getItem(THEME_KEY) ?? 'null'); if (c) paintTheme(c) } catch { /* nothing cached */ }
}

function applySelected() {
  const t = themes.find((x) => x.key === selected)
  if (t) { paintTheme({ id: t.key, base: t.base, vars: t.vars, css: t.css }); try { localStorage.setItem(THEME_KEY, JSON.stringify({ id: t.key, base: t.base, vars: t.vars, css: t.css })) } catch { /* ignore */ } }
  else if (!selected || ![...live.values()].some((l) => !l.ready)) { paintTheme(null); try { localStorage.removeItem(THEME_KEY) } catch { /* ignore */ } window.dispatchEvent(new Event('koko:theme')) }
}
export function setSelectedTheme(key: string) { selected = key; applySelected(); window.dispatchEvent(new Event('koko:theme')) }

export function useExtensions() {
  useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => version)
  return { items, themes, slashes, blocks, errorLog, schemas, dialogs, rev: settingsRev, selected, running: (id: string) => !!live.get(id)?.ready }
}
export const extState = () => ({ themes, slashes, blocks, items, live, rev: settingsRev })
export const subscribeExt = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }

/** HTML that an extension returned for a block: scripts, styles, frames, forms and event handlers are removed before it is shown. */
export function sanitizeHtml(html: string): DocumentFragment {
  const doc = new DOMParser().parseFromString(`<body>${html}`, 'text/html')
  doc.querySelectorAll('script,style,link,meta,base,iframe,frame,object,embed,form,input,button,textarea,select,svg script,template').forEach((n) => n.remove())
  doc.body.querySelectorAll('*').forEach((el) => {
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase(), v = a.value.trim().toLowerCase()
      if (n.startsWith('on') || n === 'srcdoc' || n === 'formaction' || ((n === 'href' || n === 'src' || n === 'xlink:href') && /^(javascript|vbscript|data:text)/.test(v)) || (n === 'style' && /url\s*\(|expression|@import/.test(v))) el.removeAttribute(a.name)
    }
    if (el.tagName === 'A') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer nofollow') }
    if (el.tagName === 'IMG') { const s = el.getAttribute('src') ?? ''; if (!/^(https:|data:image\/)/i.test(s)) el.removeAttribute('src') }
  })
  const frag = document.createDocumentFragment(); frag.append(...doc.body.childNodes)
  return frag
}

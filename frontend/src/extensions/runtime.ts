/** Extensions: small JavaScript programs a person adds in Settings. Each runs inside its own sandboxed iframe (no access to the page, the account, cookies or the network);
 *  the only way out is the `koko` API below, whose results the app applies itself (a theme's colours, HTML that the editor parses, a block's markup that is cleaned first). */
import { useSyncExternalStore } from 'react'

export interface Extension { id: string; name: string; code: string; enabled: boolean }
export interface ExtField { key: string; label: string; type?: 'text' | 'number' | 'color' | 'longtext' }
export interface ExtTheme { key: string; ext: string; id: string; name: string; base: 'light' | 'dark'; vars: Record<string, string>; css: string }
export interface ExtSlash { key: string; ext: string; fn: string; title: string; hint: string; keys: string }
export interface ExtBlock { key: string; ext: string; id: string; title: string; hint: string; defaults: Record<string, unknown>; fields: ExtField[] }
interface Live { frame: HTMLIFrameElement; code: string; ready: boolean; error: string; css: string; pending: Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void; t: number }> }

const PRELUDE = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'"><script>
const post = (m) => parent.postMessage(m, '*'); const fns = {}; let n = 0
const str = (v, d = '') => (typeof v === 'string' ? v : d)
const koko = {
  theme(t) { post({ t: 'theme', id: str(t.id, 'theme'), name: str(t.name, 'Theme'), base: t.base === 'light' ? 'light' : 'dark', vars: t.vars || {}, css: str(t.css) }) },
  css(s) { post({ t: 'css', css: str(s) }) },
  slash(o) { const fn = 's' + n++; fns[fn] = o.run; post({ t: 'slash', fn, title: str(o.title, 'Extension'), hint: str(o.hint), keys: str(o.keys) }) },
  block(o) { fns['r:' + o.id] = o.render; post({ t: 'block', id: str(o.id), title: str(o.title, o.id), hint: str(o.hint), defaults: o.defaults || {}, fields: o.fields || [] }) },
  toast(s) { post({ t: 'toast', text: str(s) }) },
}
addEventListener('message', async (e) => {
  const m = e.data; if (e.source !== parent || !m) return
  if (m.t === 'run') { try { new Function('koko', m.code)(koko); post({ t: 'ready' }) } catch (err) { post({ t: 'error', error: String(err && err.message || err) }) } }
  if (m.t === 'call') { try { const v = await fns[m.fn](m.arg); post({ t: 'result', id: m.id, value: v === undefined ? null : v }) } catch (err) { post({ t: 'result', id: m.id, error: String(err && err.message || err) }) } }
})
post({ t: 'loaded' })
<\/script>`

const live = new Map<string, Live>()
let themes: ExtTheme[] = [], slashes: ExtSlash[] = [], blocks: ExtBlock[] = []
let errors: Record<string, string> = {}
let version = 0
const subs = new Set<() => void>()
const emit = () => { version++; subs.forEach((f) => f()) }
let seq = 0

function handle(ext: Extension, l: Live, m: any) {
  switch (m.t) {
    case 'loaded': l.frame.contentWindow?.postMessage({ t: 'run', code: l.code }, '*'); break
    case 'ready': l.ready = true; emit(); break
    case 'error': l.error = String(m.error).slice(0, 300); errors = { ...errors, [ext.id]: l.error }; emit(); break
    case 'theme': themes = [...themes.filter((t) => t.key !== `${ext.id}:${m.id}`), { key: `${ext.id}:${m.id}`, ext: ext.id, id: String(m.id).slice(0, 40), name: String(m.name).slice(0, 60), base: m.base, vars: cleanVars(m.vars), css: String(m.css).slice(0, 20000) }]; emit(); applySelected(); break
    case 'css': l.css = String(m.css).slice(0, 40000); paintCss(); break
    case 'slash': slashes = [...slashes, { key: `${ext.id}:${m.fn}`, ext: ext.id, fn: m.fn, title: String(m.title).slice(0, 60), hint: String(m.hint).slice(0, 120), keys: String(m.keys).slice(0, 120) }]; emit(); break
    case 'block': blocks = [...blocks.filter((b) => b.key !== `${ext.id}:${m.id}`), { key: `${ext.id}:${m.id}`, ext: ext.id, id: String(m.id).slice(0, 40), title: String(m.title).slice(0, 60), hint: String(m.hint).slice(0, 120), defaults: m.defaults && typeof m.defaults === 'object' ? m.defaults : {}, fields: Array.isArray(m.fields) ? m.fields.slice(0, 12).map((f: any) => ({ key: String(f.key), label: String(f.label ?? f.key), type: ['text', 'number', 'color', 'longtext'].includes(f.type) ? f.type : 'text' })) : [] }]; emit(); break
    case 'toast': import('../ui/Toast').then((t) => t.toast(`${ext.name}: ${String(m.text).slice(0, 200)}`)); break
    case 'result': { const p = l.pending.get(m.id); if (p) { l.pending.delete(m.id); window.clearTimeout(p.t); m.error ? p.fail(new Error(m.error)) : p.ok(m.value) } break }
  }
}

const cleanVars = (v: unknown): Record<string, string> => {
  const out: Record<string, string> = {}
  if (v && typeof v === 'object') for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (/^--[\w-]{1,40}$/.test(k) && typeof val === 'string' && val.length < 200 && !/[;{}]|url\s*\(/i.test(val)) out[k] = val
  return out
}

function start(ext: Extension) {
  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-scripts')   // no allow-same-origin: it cannot reach this page, its storage or cookies
  frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden'
  frame.srcdoc = PRELUDE
  const l: Live = { frame, code: ext.code, ready: false, error: '', css: '', pending: new Map() }
  const on = (e: MessageEvent) => { if (e.source === frame.contentWindow) handle(ext, l, e.data) }
  window.addEventListener('message', on)
  ;(frame as any)._off = () => window.removeEventListener('message', on)
  live.set(ext.id, l)
  document.body.appendChild(frame)
}

function stop(id: string) {
  const l = live.get(id); if (!l) return
  ;(l.frame as any)._off?.(); l.frame.remove(); l.pending.forEach((p) => { window.clearTimeout(p.t); p.fail(new Error('Extension stopped')) })
  live.delete(id)
  themes = themes.filter((t) => t.ext !== id); slashes = slashes.filter((s) => s.ext !== id); blocks = blocks.filter((b) => b.ext !== id)
  if (errors[id]) { const { [id]: _, ...rest } = errors; errors = rest }
  paintCss(); emit()
}

let items: Extension[] = []
/** Make the running extensions match the saved list (called when settings load or change). */
export function syncExtensions(list: Extension[], theme: string) {
  items = list; selected = theme
  const want = new Map(list.filter((e) => e.enabled).map((e) => [e.id, e]))
  for (const [id, l] of [...live]) { const w = want.get(id); if (!w || w.code !== l.code) stop(id) }
  for (const [id, e] of want) if (!live.has(id)) start(e)
  if (!want.size) applySelected()
  emit()
}
export const stopAllExtensions = () => { for (const id of [...live]) stop(id[0]); selected = ''; applySelected() }

/** Ask a running extension to compute something (a slash command's text, a block's markup). Gives up after 4 seconds. */
export function callExt(ext: string, fn: string, arg?: unknown): Promise<any> {
  const l = live.get(ext)
  if (!l || !l.ready) return Promise.reject(new Error('The extension is not running'))
  return new Promise((ok, fail) => {
    const id = ++seq
    const t = window.setTimeout(() => { l.pending.delete(id); fail(new Error('The extension took too long')) }, 4000)
    l.pending.set(id, { ok, fail, t })
    l.frame.contentWindow?.postMessage({ t: 'call', id, fn, arg }, '*')
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
  return { items, themes, slashes, blocks, errors, selected, running: (id: string) => !!live.get(id)?.ready }
}
export const extState = () => ({ themes, slashes, blocks, items, live })
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

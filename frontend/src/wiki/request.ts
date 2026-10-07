/** Everything about a "Try it" request that doesn't need a browser: filling in {{variables}}, building the URL, headers and body,
 *  turning it into a cURL / fetch / Python snippet, and describing the reply. Kept free of React so it can be tested. */

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const
export type Method = (typeof METHODS)[number]
export interface KV { k: string; v: string; off?: boolean }
export type BodyType = 'none' | 'json' | 'text' | 'form'
export interface ReqSpec { method: Method; url: string; query: KV[]; headers: KV[]; body: string; bodyType: BodyType }
export type Vars = Record<string, string>

export const emptySpec = (): ReqSpec => ({ method: 'GET', url: '{{baseUrl}}/', query: [], headers: [], body: '', bodyType: 'none' })

/** Replace {{name}} with its value. Names that aren't defined are left as they are and reported back. */
export function interpolate(text: string, vars: Vars): { text: string; missing: string[] } {
  const missing: string[] = []
  const out = text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, name: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, name) && vars[name] !== '') return vars[name]
    if (!missing.includes(name)) missing.push(name)
    return m
  })
  return { text: out, missing }
}

const active = (l: KV[]) => l.filter((x) => !x.off && x.k.trim())

export interface Built { url: string; method: Method; headers: Record<string, string>; body?: string; missing: string[]; error?: string }

export function build(spec: ReqSpec, vars: Vars): Built {
  const missing: string[] = []
  const fill = (s: string) => { const r = interpolate(s, vars); r.missing.forEach((m) => { if (!missing.includes(m)) missing.push(m) }); return r.text }
  let url = fill(spec.url.trim())
  const q = active(spec.query).map((p) => `${encodeURIComponent(fill(p.k.trim()))}=${encodeURIComponent(fill(p.v))}`)
  if (q.length) url += (url.includes('?') ? (/[?&]$/.test(url) ? '' : '&') : '?') + q.join('&')
  const headers: Record<string, string> = {}
  for (const h of active(spec.headers)) headers[fill(h.k.trim())] = fill(h.v)
  const has = (n: string) => Object.keys(headers).some((k) => k.toLowerCase() === n)
  let body: string | undefined
  if (spec.bodyType !== 'none' && spec.method !== 'GET' && spec.method !== 'HEAD' && spec.body !== '') {
    body = fill(spec.body)
    if (!has('content-type')) headers['Content-Type'] = spec.bodyType === 'json' ? 'application/json' : spec.bodyType === 'form' ? 'application/x-www-form-urlencoded' : 'text/plain'
  }
  let error: string | undefined
  if (!/^https?:\/\//i.test(url)) error = missing.length ? `Set ${missing.map((m) => `{{${m}}}`).join(', ')} in Variables first` : 'The address needs to start with http:// or https://'
  else if (spec.bodyType === 'json' && body) { try { JSON.parse(body) } catch { error = 'The body isn’t valid JSON' } }
  return { url, method: spec.method, headers, body, missing, error }
}

const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
export function toCurl(b: Built): string {
  const parts = ['curl']
  if (b.method !== 'GET') parts.push(`-X ${b.method}`)
  parts.push(sq(b.url))
  for (const [k, v] of Object.entries(b.headers)) parts.push(`-H ${sq(`${k}: ${v}`)}`)
  if (b.body !== undefined) parts.push(`-d ${sq(b.body)}`)
  return parts.join(' \\\n  ')
}
export function toFetch(b: Built): string {
  const opts: string[] = []
  if (b.method !== 'GET') opts.push(`  method: ${JSON.stringify(b.method)},`)
  const hs = Object.entries(b.headers)
  if (hs.length) opts.push(`  headers: {\n${hs.map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n')}\n  },`)
  if (b.body !== undefined) opts.push(`  body: ${JSON.stringify(b.body)},`)
  return `const res = await fetch(${JSON.stringify(b.url)}${opts.length ? `, {\n${opts.join('\n')}\n}` : ''})\nconsole.log(res.status, await res.text())`
}
export function toPython(b: Built): string {
  const lines = ['import requests', '']
  const args = [JSON.stringify(b.url)]
  const hs = Object.entries(b.headers)
  if (hs.length) { lines.push(`headers = {\n${hs.map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n')}\n}`); args.push('headers=headers') }
  if (b.body !== undefined) { lines.push(`data = ${JSON.stringify(b.body)}`); args.push('data=data') }
  lines.push(`res = requests.${b.method.toLowerCase()}(${args.join(', ')})`, 'print(res.status_code, res.text)')
  return lines.join('\n')
}

export type Tone = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'ok' | 'warn' | 'danger' | 'info' | 'neutral'
/** Colour family for a badge label: HTTP methods get their own colours, and a few common words (Required, Deprecated, Beta…) get meaning. */
export function badgeTone(label: string): Tone {
  const l = label.trim().toLowerCase()
  if (['get', 'post', 'put', 'patch', 'delete'].includes(l)) return l as Tone
  if (l === 'head' || l === 'options') return 'neutral'
  if (['required', 'breaking', 'removed'].includes(l)) return 'danger'
  if (['deprecated', 'legacy', 'warning'].includes(l)) return 'warn'
  if (['new', 'stable', 'ok', 'optional', 'recommended'].includes(l)) return 'ok'
  if (['beta', 'preview', 'experimental', 'alpha', 'internal'].includes(l)) return 'info'
  return 'neutral'
}
export const statusTone = (code: number): 'ok' | 'info' | 'warn' | 'danger' => (code >= 500 ? 'danger' : code >= 400 ? 'warn' : code >= 300 ? 'info' : 'ok')

export const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`)

/** Pretty-print JSON replies; anything else is shown as it came. */
export function pretty(text: string, contentType = ''): string {
  if (/json/i.test(contentType) || /^\s*[{[]/.test(text)) { try { return JSON.stringify(JSON.parse(text), null, 2) } catch { /* not JSON */ } }
  return text
}

export interface Reply { status: number; statusText: string; ms: number; size: number; headers: Record<string, string>; body: string; binary: boolean; via: 'browser' | 'server' }

export class NetworkFailure extends Error {}

export async function sendDirect(b: Built, signal?: AbortSignal): Promise<Reply> {
  const t0 = performance.now()
  let res: Response
  try { res = await fetch(b.url, { method: b.method, headers: b.headers, body: b.body, signal, redirect: 'follow' }) }
  catch (e) { if ((e as Error).name === 'AbortError') throw e; throw new NetworkFailure('The browser couldn’t complete the request. This is usually the server not allowing requests from other websites (CORS).') }
  const buf = await res.arrayBuffer()
  const ctype = res.headers.get('content-type') ?? ''
  const binary = !!ctype && !/json|text|xml|javascript|html|yaml|x-www-form/i.test(ctype)
  const headers: Record<string, string> = {}
  res.headers.forEach((v, k) => { headers[k] = v })
  return { status: res.status, statusText: res.statusText, ms: Math.round(performance.now() - t0), size: buf.byteLength, headers, body: binary ? '' : new TextDecoder().decode(buf), binary, via: 'browser' }
}

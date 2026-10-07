import type { Answers, FormItem } from './model'

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const URL_RE = /^https?:\/\/[^\s/$.?#][^\s]*$/i
const num = (v: unknown) => (v === undefined || v === null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)
const unsafePattern = (p: string) => /\([^)]*[+*][^)]*\)\s*[+*{]/.test(p)   // (a+)+ style, refuse like the server does

/** Error message for one answer, or null. Mirrors backend/app/forms.py so both sides agree. */
export function checkItem(it: FormItem, raw: string | string[] | undefined): string | null {
  const blank = raw === undefined || raw === '' || (Array.isArray(raw) && raw.length === 0) || (typeof raw === 'string' && !raw.trim())
  if (blank) return it.required ? 'This question is required' : null
  const t = it.type
  if (t === 'checkbox') {
    const v = Array.isArray(raw) ? raw : [raw]
    const lo = num(it.minSel), hi = num(it.maxSel)
    if (lo && v.length < lo) return `Choose at least ${lo}`
    if (hi && v.length > hi) return `Choose at most ${hi}`
    return null
  }
  if (t === 'color') return /^#[0-9a-f]{6}$/i.test(String(raw).trim()) ? null : 'Pick a colour'
  if (t === 'file') return null   // the upload itself was checked when it was sent
  const s = String(raw).trim()
  if (t === 'radio' || t === 'select') return null
  if (t === 'scale') { const n = Number(s), lo = it.scaleMin ?? 1, hi = it.scaleMax ?? 5; return Number.isInteger(n) && n >= lo && n <= hi ? null : 'Choose a value on the scale' }
  if (t === 'number') {
    const n = Number(s)
    if (!Number.isFinite(n)) return 'Enter a number'
    if (it.integer && !Number.isInteger(n)) return 'Enter a whole number'
    const lo = num(it.min), hi = num(it.max)
    if (lo !== null && n < lo) return `Must be at least ${it.min}`
    if (hi !== null && n > hi) return `Must be at most ${it.max}`
    return null
  }
  if (t === 'email' && !EMAIL.test(s)) return 'Enter a valid email address'
  if (t === 'url' && !URL_RE.test(s)) return 'Enter a valid link starting with http:// or https://'
  if (t === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return 'Enter a valid date'
    if (typeof it.min === 'string' && it.min && s < it.min) return `Must be on or after ${it.min}`
    if (typeof it.max === 'string' && it.max && s > it.max) return `Must be on or before ${it.max}`
    return null
  }
  if (t === 'time') return /^\d{2}:\d{2}$/.test(s) ? null : 'Enter a valid time'
  if (t === 'short' || t === 'long' || t === 'email' || t === 'url') {
    const lo = num(it.minLen), hi = num(it.maxLen)
    if (lo && s.length < lo) return `Use at least ${lo} characters`
    if (hi && s.length > hi) return `Use at most ${hi} characters`
    if (it.pattern && it.pattern.length <= 200 && !unsafePattern(it.pattern) && s.length <= 2000) {
      try { if (!new RegExp(it.pattern).test(s)) return it.patternMsg || "That doesn't match the expected format" } catch { /* bad pattern: ignore */ }
    }
  }
  return null
}

export function checkAll(items: FormItem[], answers: Answers): Record<string, string> {
  const out: Record<string, string> = {}
  for (const it of items) {
    if (it.type === 'section' || it.type === 'info' || it.type === 'media' || it.type === 'page') continue
    const e = checkItem(it, answers[it.id]); if (e) out[it.id] = e
  }
  return out
}

/** Is this pattern something the editor should warn about? */
export function patternProblem(p: string): string | null {
  if (!p) return null
  if (p.length > 200) return 'Too long (200 characters max)'
  if (unsafePattern(p)) return 'This pattern could be very slow, so it will be ignored'
  try { new RegExp(p); return null } catch { return 'Not a valid pattern' }
}

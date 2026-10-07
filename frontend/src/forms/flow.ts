import { paginate, type Answers, type Cond, type FormItem } from './model'

/** Form logic. Mirrored in backend/app/forms.py (compute_flow): keep both in step.
 *  - an item with `showIf` is only shown when its rules hold, judged by the answers to earlier, visible questions
 *  - a single/dropdown question can send the filler to a later page (or straight to the end) based on the chosen option
 *  Hidden questions and skipped pages are never required and their answers are not submitted. */

export const OPS: { value: Cond['op']; label: string; needsValue: boolean }[] = [
  { value: 'is', label: 'is', needsValue: true }, { value: 'isnot', label: 'is not', needsValue: true },
  { value: 'contains', label: 'contains', needsValue: true }, { value: 'gt', label: 'is greater than', needsValue: true }, { value: 'lt', label: 'is less than', needsValue: true },
  { value: 'filled', label: 'is answered', needsValue: false }, { value: 'empty', label: 'is empty', needsValue: false },
]

const blank = (v: string | string[] | undefined) => v === undefined || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'string' && !v.trim())

export function ruleHolds(rule: Cond, answer: string | string[] | undefined): boolean {
  const b = blank(answer), v = rule.v ?? ''
  switch (rule.op) {
    case 'filled': return !b
    case 'empty': return b
    case 'is': return !b && (Array.isArray(answer) ? answer.includes(v) : String(answer) === v)
    case 'isnot': return b || (Array.isArray(answer) ? !answer.includes(v) : String(answer) !== v)
    case 'contains': return !b && (Array.isArray(answer) ? answer.some((a) => a.toLowerCase().includes(v.toLowerCase())) : String(answer).toLowerCase().includes(v.toLowerCase()))
    case 'gt': case 'lt': {
      if (b || Array.isArray(answer) || v.trim() === '') return false
      const x = Number(answer), y = Number(v)
      if (!Number.isFinite(x) || !Number.isFinite(y)) return false
      return rule.op === 'gt' ? x > y : x < y
    }
    default: return true
  }
}

export interface Flow { pages: ReturnType<typeof paginate>; path: number[]; visible: Set<string> }

export function computeFlow(items: FormItem[], answers: Answers): Flow {
  const pages = paginate(items)
  const ids = new Set(items.map((i) => i.id))
  const visible = new Set<string>()
  const holds = (it: FormItem) => {
    const s = it.showIf
    if (!s || !s.rules?.length) return true
    const live = s.rules.filter((r) => ids.has(r.q))       // a rule about a deleted question is ignored
    if (!live.length) return true
    const res = live.map((r) => ruleHolds(r, visible.has(r.q) ? answers[r.q] : undefined))
    return s.match === 'any' ? res.some(Boolean) : res.every(Boolean)
  }
  const path: number[] = []
  let i = 0
  while (i < pages.length) {
    const page = pages[i]
    if (i > 0 && page.head && !holds(page.head)) { i++; continue }
    const shown = page.items.filter((it) => { const ok = holds(it); if (ok) visible.add(it.id); return ok })
    if (i > 0 && page.items.length > 0 && shown.length === 0) { i++; continue }
    path.push(i)
    let next = i + 1
    for (const it of shown) {
      if (it.type !== 'radio' && it.type !== 'select') continue
      const a = answers[it.id]
      const target = typeof a === 'string' && it.jumps ? it.jumps[a] : undefined
      if (!target) continue
      if (target === 'submit') { next = pages.length; break }
      const j = pages.findIndex((p) => p.head?.id === target)
      if (j > i) next = j
      break
    }
    i = next
  }
  return { pages, path, visible }
}

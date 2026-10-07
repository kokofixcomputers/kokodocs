import { parseDateString, parseNumberString, ymdToSerial } from './values'

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const LISTS = [WEEKDAYS, MONTHS]

const matchCase = (like: string, s: string) => (like === like.toUpperCase() ? s.toUpperCase() : like[0] === like[0].toUpperCase() ? s[0].toUpperCase() + s.slice(1) : s)
const iso = (serial: number) => {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/**
 * Extend a 1-D list of raw cell texts by `count` more items (forward), or `count` items before the first (backward).
 * Handles number series, dates, "Item 1" text-with-number, month / weekday names; anything else repeats.
 */
export function extendSeries(src: string[], count: number, backward = false): string[] {
  const n = src.length
  const out: string[] = []
  const at = (i: number) => (backward ? -(i + 1) : n + i) // logical index of the i-th generated item
  const cyc = (idx: number) => src[((idx % n) + n) % n]

  // numbers
  const nums = src.map((s) => (s.trim() !== '' && !parseDateString(s) ? parseNumberString(s) : null))
  if (n >= 2 && nums.every((x) => x !== null)) {
    const v = nums as number[]
    const step = (v[n - 1] - v[0]) / (n - 1)
    const fmt = (x: number) => String(Number(x.toPrecision(12)))
    const pct = src[0].trim().endsWith('%')
    for (let i = 0; i < count; i++) { const x = v[0] + step * at(i); out.push(pct ? fmt(x * 100) + '%' : fmt(x)) }
    return out
  }
  // dates
  const dates = src.map((s) => parseDateString(s))
  if (dates.every((d) => d !== null)) {
    const d = dates as number[]
    const step = n >= 2 ? (d[n - 1] - d[0]) / (n - 1) : 1
    for (let i = 0; i < count; i++) out.push(iso(d[0] + step * at(i)))
    return out
  }
  // month / weekday names (single or sequence)
  for (const list of LISTS) {
    const idx = src.map((s) => list.findIndex((m) => m === s.toLowerCase() || m.slice(0, 3) === s.toLowerCase()))
    if (idx.every((i) => i >= 0)) {
      const full = src.map((s) => s.length > 3)
      const step = n >= 2 ? ((idx[n - 1] - idx[0] + list.length) % list.length) / (n - 1) || 1 : 1
      for (let i = 0; i < count; i++) {
        const k = (((Math.round(idx[0] + step * at(i))) % list.length) + list.length) % list.length
        const name = full[0] ? list[k] : list[k].slice(0, 3)
        out.push(matchCase(src[0], name))
      }
      return out
    }
  }
  // text ending in a number: "Item 1", "Q3", "Row-07"
  const tn = src.map((s) => /^(.*?)(\d+)$/.exec(s))
  if (tn.every((m) => m) && tn.every((m) => m![1] === tn[0]![1]) && (tn[0]![1] !== '' || n >= 2 || tn[0]![2].startsWith('0'))) {
    const vals = tn.map((m) => Number(m![2])), width = tn[0]![2].length, padded = tn[0]![2].startsWith('0') && width > 1
    const step = n >= 2 ? (vals[n - 1] - vals[0]) / (n - 1) : 1
    for (let i = 0; i < count; i++) {
      const x = Math.round(vals[0] + step * at(i))
      if (x < 0) { out.push(cyc(at(i))); continue }
      out.push(tn[0]![1] + (padded ? String(x).padStart(width, '0') : String(x)))
    }
    return out
  }
  for (let i = 0; i < count; i++) out.push(cyc(at(i)))
  return out
}

export { ymdToSerial }

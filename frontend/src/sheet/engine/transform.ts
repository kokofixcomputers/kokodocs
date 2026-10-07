import { refToString, type RefTok } from './refs'
import { tokenize } from './tokenizer'

/** Rewrite every cell/range reference inside a formula. Return null from `f` to turn the reference into #REF!. */
export function mapRefs(formula: string, f: (ref: RefTok) => RefTok | null): string {
  if (formula[0] !== '=') return formula
  let toks
  try { toks = tokenize(formula.slice(1)) } catch { return formula }
  return '=' + toks.map((t) => {
    if (t.t !== 'ref' || !t.ref) return t.text
    const out = f(t.ref)
    return out ? refToString(out) : '#REF!'
  }).join('')
}

/** Relative references move by (dr, dc); $-absolute parts stay. Used by copy/paste and autofill. */
export function shiftFormula(formula: string, dr: number, dc: number): string {
  if (!dr && !dc) return formula
  return mapRefs(formula, (t) => {
    const r1 = t.a1r ? t.r1 : t.r1 + dr, c1 = t.a1c ? t.c1 : t.c1 + dc
    const r2 = t.r2 === Infinity ? Infinity : t.a2r ? t.r2 : t.r2 + dr
    const c2 = t.c2 === Infinity ? Infinity : t.a2c ? t.c2 : t.c2 + dc
    if (r1 < 0 || c1 < 0 || r2 < 0 || c2 < 0) return null
    return { ...t, r1, c1, r2, c2 }
  })
}

export type Axis = 'row' | 'col'
/**
 * Adjust references after rows/columns were inserted (count > 0) or deleted (count < 0) at index `at` on
 * `targetSheet`. `sheetOf` resolves a reference's explicit sheet name to an id (undefined = the formula's own sheet).
 */
export function adjustForStructure(formula: string, formulaSheet: string, targetSheet: string, sheetOf: (name: string) => string | undefined,
  axis: Axis, at: number, count: number): string {
  return mapRefs(formula, (t) => {
    const sheet = t.sheet ? sheetOf(t.sheet) : formulaSheet
    if (sheet !== targetSheet) return t
    if ((axis === 'row' && t.kind === 'col') || (axis === 'col' && t.kind === 'row')) return t
    const lo = axis === 'row' ? t.r1 : t.c1, hi = axis === 'row' ? t.r2 : t.c2
    let nlo: number, nhi: number
    if (count > 0) {
      nlo = lo >= at ? lo + count : lo
      nhi = hi === Infinity ? Infinity : hi >= at ? hi + count : hi
    } else {
      const n = -count, end = at + n
      nlo = lo < at ? lo : lo >= end ? lo - n : at
      nhi = hi === Infinity ? Infinity : hi < at ? hi : hi >= end ? hi - n : at - 1
      if (nhi !== Infinity && nlo > nhi) return null
    }
    return axis === 'row' ? { ...t, r1: nlo, r2: nhi } : { ...t, c1: nlo, c2: nhi }
  })
}

/** Rename a sheet inside formulas (newName undefined = sheet deleted -> #REF!). */
export function renameSheetInFormula(formula: string, oldName: string, newName: string | undefined): string {
  return mapRefs(formula, (t) => {
    if (!t.sheet || t.sheet.toLowerCase() !== oldName.toLowerCase()) return t
    return newName === undefined ? null : { ...t, sheet: newName }
  })
}

import { colIndex, type RefTok } from './refs'

export type TokType = 'num' | 'str' | 'bool' | 'err' | 'ref' | 'fn' | 'name' | 'op' | 'lp' | 'rp' | 'comma' | 'semi' | 'lb' | 'rb' | 'ws'
export interface Tok { t: TokType; text: string; num?: number; ref?: RefTok }

const SHEET = `(?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)!`
const CELL = `\\$?[A-Za-z]{1,3}\\$?\\d+`
const COLR = `\\$?[A-Za-z]{1,3}`
const ROWR = `\\$?\\d+`
const REF_RE = new RegExp(`(${SHEET})?(?:(${CELL})(?::(${CELL}))?|(${COLR}):(${COLR})|(${ROWR}):(${ROWR}))`, 'y')
const NUM_RE = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y
const STR_RE = /"(?:[^"]|"")*"/y
const ERR_RE = /#(?:NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|CIRC!|SPILL!|ERROR!)/y
const IDENT_RE = /[A-Za-z_\\][A-Za-z0-9_.]*/y
const WS_RE = /\s+/y
const OPS = ['<>', '<=', '>=', '=', '<', '>', '+', '-', '*', '/', '^', '&', '%', ':', '@']

function cellParts(s: string) {
  const m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.exec(s)!
  return { ac: !!m[1], c: colIndex(m[2]), ar: !!m[3], r: Number(m[4]) - 1 }
}
const unquote = (s: string) => (s.startsWith("'") ? s.slice(1, -1).replace(/''/g, "'") : s)

export class FormulaSyntaxError extends Error {}

/** Tokenize a formula body (without the leading "="). Tokens concatenate back to the exact input. */
export function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  const match = (re: RegExp) => { re.lastIndex = i; return re.exec(src) }
  while (i < src.length) {
    let m: RegExpExecArray | null
    if ((m = match(WS_RE))) { out.push({ t: 'ws', text: m[0] }); i += m[0].length; continue }
    if ((m = match(STR_RE))) { out.push({ t: 'str', text: m[0] }); i += m[0].length; continue }
    if ((m = match(ERR_RE))) { out.push({ t: 'err', text: m[0] }); i += m[0].length; continue }
    if ((m = match(REF_RE))) {
      const next = src[i + m[0].length]
      if (!(next && /[A-Za-z0-9_.(]/.test(next))) {
        const sheet = m[1] ? unquote(m[1].slice(0, -1)) : undefined
        let ref: RefTok
        if (m[2]) {
          const a = cellParts(m[2])
          if (m[3]) {
            const b = cellParts(m[3])
            ref = { sheet, kind: 'range', r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c),
              a1r: a.r <= b.r ? a.ar : b.ar, a1c: a.c <= b.c ? a.ac : b.ac, a2r: a.r <= b.r ? b.ar : a.ar, a2c: a.c <= b.c ? b.ac : a.ac }
          } else ref = { sheet, kind: 'cell', r1: a.r, c1: a.c, r2: a.r, c2: a.c, a1r: a.ar, a1c: a.ac, a2r: a.ar, a2c: a.ac }
        } else if (m[4]) {
          const a = colIndex(m[4].replace('$', '')), b = colIndex(m[5].replace('$', ''))
          ref = { sheet, kind: 'col', r1: 0, r2: Infinity, c1: Math.min(a, b), c2: Math.max(a, b), a1r: false, a2r: false, a1c: m[4].startsWith('$'), a2c: m[5].startsWith('$') }
        } else {
          const a = Number(m[6].replace('$', '')) - 1, b = Number(m[7].replace('$', '')) - 1
          ref = { sheet, kind: 'row', c1: 0, c2: Infinity, r1: Math.min(a, b), r2: Math.max(a, b), a1c: false, a2c: false, a1r: m[6].startsWith('$'), a2r: m[7].startsWith('$') }
        }
        out.push({ t: 'ref', text: m[0], ref }); i += m[0].length; continue
      }
    }
    if ((m = match(NUM_RE))) { out.push({ t: 'num', text: m[0], num: Number(m[0]) }); i += m[0].length; continue }
    if ((m = match(IDENT_RE))) {
      const text = m[0]; i += text.length
      let j = i
      while (j < src.length && /\s/.test(src[j])) j++
      if (src[j] === '(') out.push({ t: 'fn', text })
      else if (/^(true|false)$/i.test(text)) out.push({ t: 'bool', text })
      else out.push({ t: 'name', text })
      continue
    }
    const ch = src[i]
    const op = OPS.find((o) => src.startsWith(o, i))
    if (op) { out.push({ t: 'op', text: op }); i += op.length; continue }
    if (ch === '(') out.push({ t: 'lp', text: ch })
    else if (ch === ')') out.push({ t: 'rp', text: ch })
    else if (ch === ',') out.push({ t: 'comma', text: ch })
    else if (ch === ';') out.push({ t: 'semi', text: ch })
    else if (ch === '{') out.push({ t: 'lb', text: ch })
    else if (ch === '}') out.push({ t: 'rb', text: ch })
    else throw new FormulaSyntaxError(`Unexpected character "${ch}"`)
    i++
  }
  return out
}

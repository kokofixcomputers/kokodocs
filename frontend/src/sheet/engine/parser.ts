import type { RefTok } from './refs'
import { FormulaSyntaxError, tokenize, type Tok } from './tokenizer'

export type Node =
  | { k: 'num'; v: number } | { k: 'str'; v: string } | { k: 'bool'; v: boolean } | { k: 'err'; v: string }
  | { k: 'ref'; ref: RefTok } | { k: 'name'; name: string } | { k: 'empty' }
  | { k: 'call'; name: string; args: Node[] }
  | { k: 'un'; op: '-' | '+'; a: Node } | { k: 'pct'; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'arr'; rows: Node[][] }

// Excel precedence: comparison < & < +,- < *,/ < ^ ; unary minus binds tighter than ^ (so -2^2 = 4); % postfix tightest
const BIN: Record<string, [number, boolean]> = {
  '=': [1, false], '<>': [1, false], '<': [1, false], '>': [1, false], '<=': [1, false], '>=': [1, false],
  '&': [2, false], '+': [3, false], '-': [3, false], '*': [4, false], '/': [4, false], '^': [5, false],
}
const UNARY_BP = 6

export function parse(formula: string): Node {
  const toks = tokenize(formula.startsWith('=') ? formula.slice(1) : formula).filter((t) => t.t !== 'ws')
  let p = 0
  const peek = () => toks[p]
  const next = () => toks[p++]
  const expect = (t: Tok['t'], what: string) => { const k = next(); if (!k || k.t !== t) throw new FormulaSyntaxError(`Expected ${what}`); return k }

  function expr(minBp: number): Node {
    let left = prefix()
    for (;;) {
      const t = peek()
      if (!t) break
      if (t.t === 'op' && t.text === '%') { next(); left = { k: 'pct', a: left }; continue }
      if (t.t !== 'op') break
      const info = BIN[t.text]
      if (!info || info[0] < minBp) break
      next()
      const right = expr(info[0] + 1)
      left = { k: 'bin', op: t.text, a: left, b: right }
    }
    return left
  }

  function prefix(): Node {
    const t = next()
    if (!t) throw new FormulaSyntaxError('Unexpected end of formula')
    switch (t.t) {
      case 'num': return { k: 'num', v: t.num! }
      case 'str': return { k: 'str', v: t.text.slice(1, -1).replace(/""/g, '"') }
      case 'bool': return { k: 'bool', v: t.text.toUpperCase() === 'TRUE' }
      case 'err': return { k: 'err', v: t.text }
      case 'ref': return { k: 'ref', ref: t.ref! }
      case 'name': return { k: 'name', name: t.text }
      case 'op':
        if (t.text === '-' || t.text === '+') return { k: 'un', op: t.text, a: expr(UNARY_BP) }
        if (t.text === '@') return expr(UNARY_BP)
        throw new FormulaSyntaxError(`Unexpected "${t.text}"`)
      case 'lp': { const e = expr(0); expect('rp', '")"'); return e }
      case 'lb': {
        const rows: Node[][] = [[]]
        for (;;) {
          rows[rows.length - 1].push(expr(0))
          const s = next()
          if (!s) throw new FormulaSyntaxError('Missing "}"')
          if (s.t === 'comma') continue
          if (s.t === 'semi') { rows.push([]); continue }
          if (s.t === 'rb') break
          throw new FormulaSyntaxError('Bad array constant')
        }
        return { k: 'arr', rows }
      }
      case 'fn': {
        expect('lp', '"("')
        const args: Node[] = []
        if (peek()?.t === 'rp') { next(); return { k: 'call', name: t.text.toUpperCase(), args } }
        for (;;) {
          const n = peek()
          if (!n) throw new FormulaSyntaxError('Missing ")"')
          if (n.t === 'comma' || n.t === 'semi' || n.t === 'rp') args.push({ k: 'empty' })
          else args.push(expr(0))
          const s = next()
          if (!s) throw new FormulaSyntaxError('Missing ")"')
          if (s.t === 'comma' || s.t === 'semi') continue
          if (s.t === 'rp') break
          throw new FormulaSyntaxError('Expected "," or ")"')
        }
        return { k: 'call', name: t.text.toUpperCase(), args }
      }
      default: throw new FormulaSyntaxError(`Unexpected "${t.text}"`)
    }
  }

  const ast = expr(0)
  if (p < toks.length) throw new FormulaSyntaxError(`Unexpected "${toks[p].text}"`)
  return ast
}

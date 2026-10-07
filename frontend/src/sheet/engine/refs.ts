/** A1-style addressing helpers. Rows/cols are zero-based internally. */
export const colName = (c: number): string => {
  let s = ''
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}
export const colIndex = (s: string): number => {
  let n = 0
  for (const ch of s.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64
  return n - 1
}
export const addr = (r: number, c: number) => `${colName(c)}${r + 1}`

export interface RefTok {
  sheet?: string
  r1: number; c1: number; r2: number; c2: number   // r2 / c2 may be Infinity for whole-column / whole-row refs
  a1r: boolean; a1c: boolean; a2r: boolean; a2c: boolean // $-absolute flags for the two corners
  kind: 'cell' | 'range' | 'col' | 'row'
}

export const quoteSheet = (name: string) => (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`)

const cellStr = (r: number, c: number, ar: boolean, ac: boolean) => `${ac ? '$' : ''}${colName(c)}${ar ? '$' : ''}${r + 1}`
export function refToString(t: RefTok): string {
  const sh = t.sheet ? `${quoteSheet(t.sheet)}!` : ''
  switch (t.kind) {
    case 'cell': return sh + cellStr(t.r1, t.c1, t.a1r, t.a1c)
    case 'range': return `${sh}${cellStr(t.r1, t.c1, t.a1r, t.a1c)}:${cellStr(t.r2, t.c2, t.a2r, t.a2c)}`
    case 'col': return `${sh}${t.a1c ? '$' : ''}${colName(t.c1)}:${t.a2c ? '$' : ''}${colName(t.c2)}`
    case 'row': return `${sh}${t.a1r ? '$' : ''}${t.r1 + 1}:${t.a2r ? '$' : ''}${t.r2 + 1}`
  }
}

/** Parse "A1", "$B$2" (no sheet prefix). */
export function parseAddr(s: string): { r: number; c: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(s.trim())
  return m ? { r: Number(m[2]) - 1, c: colIndex(m[1]) } : null
}

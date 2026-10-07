/** Parse delimited text (CSV or TSV) with quoted fields. */
export function parseDelimited(text: string, delim: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cur = '', q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += ch
    } else if (ch === '"' && cur === '') q = true
    else if (ch === delim) { row.push(cur); cur = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cur); rows.push(row); row = []; cur = ''
    } else cur += ch
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row) }
  return rows
}

export function toDelimited(rows: string[][], delim: string): string {
  const esc = (s: string) => (s.includes(delim) || /["\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  return rows.map((r) => r.map(esc).join(delim)).join('\n')
}

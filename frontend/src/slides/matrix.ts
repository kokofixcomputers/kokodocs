import { cellKey, type El } from './themes'

export const dims = (e: El) => ({ nr: Math.max(1, e.nr ?? 1), nc: Math.max(1, e.nc ?? 1) })
export function toMatrix(e: El): string[][] {
  const { nr, nc } = dims(e)
  return Array.from({ length: nr }, (_, r) => Array.from({ length: nc }, (_v, c) => e.cells?.[cellKey(r, c)] ?? ''))
}
export function fromMatrix(m: string[][]): Record<string, string> {
  const out: Record<string, string> = {}
  m.forEach((row, r) => row.forEach((v, c) => { if (v !== '') out[cellKey(r, c)] = v }))
  return out
}
export const num = (s: string) => { const n = parseFloat(String(s).replace(/[,$%\s]/g, '')); return Number.isFinite(n) ? n : 0 }
export interface ChartData { cats: string[]; series: { name: string; values: number[] }[] }
export function chartData(e: El): ChartData {
  const m = toMatrix(e)
  const cats = m.slice(1).map((r) => r[0] || '')
  const series = (m[0] ?? []).slice(1).map((name, j) => ({ name: name || `Series ${j + 1}`, values: m.slice(1).map((r) => num(r[j + 1] ?? '')) }))
  return { cats: cats.length ? cats : [''], series: series.length ? series : [{ name: 'Series 1', values: [0] }] }
}
export type TableOp = 'addRow' | 'delRow' | 'addCol' | 'delCol'
export function applyTableOp(e: El, op: TableOp, at: number): { cells: Record<string, string>; nr: number; nc: number } {
  const m = toMatrix(e), { nr, nc } = dims(e)
  if (op === 'addRow') m.splice(at + 1, 0, Array(nc).fill(''))
  else if (op === 'delRow' && nr > 1) m.splice(at, 1)
  else if (op === 'addCol') m.forEach((r) => r.splice(at + 1, 0, ''))
  else if (op === 'delCol' && nc > 1) m.forEach((r) => r.splice(at, 1))
  return { cells: fromMatrix(m), nr: m.length, nc: m[0]?.length ?? 1 }
}

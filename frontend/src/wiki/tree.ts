/** The wiki's table of contents: a flat map of id -> entry, where `parent` points at a folder (or null for the top level) and `pos`
 *  orders siblings. Pure functions so every client computes the same thing from the same shared map. */
export interface Entry { t: 'page' | 'folder'; title: string; parent: string | null; pos: number; method?: string }
export type Tree = Record<string, Entry>

export const children = (tree: Tree, parent: string | null): string[] =>
  Object.keys(tree).filter((id) => tree[id].parent === parent).sort((a, b) => tree[a].pos - tree[b].pos || a.localeCompare(b))

export function descendants(tree: Tree, id: string): string[] {
  const out: string[] = []
  const walk = (p: string) => { for (const c of children(tree, p)) { out.push(c); walk(c) } }
  walk(id)
  return out
}

export const ancestors = (tree: Tree, id: string): string[] => {
  const out: string[] = []
  let cur = tree[id]?.parent ?? null
  for (let i = 0; cur && tree[cur] && i < 100; i++) { out.unshift(cur); cur = tree[cur].parent }
  return out
}

export const nextPos = (tree: Tree, parent: string | null) => { const ks = children(tree, parent); return ks.length ? tree[ks[ks.length - 1]].pos + 1 : 1 }

/** Where an entry goes when dropped in `parent` just before `before` (or last). Returns null for a move that would put a folder inside itself. */
export function place(tree: Tree, id: string, parent: string | null, before: string | null): { parent: string | null; pos: number } | null {
  if (parent === id || (parent && descendants(tree, id).includes(parent))) return null
  if (parent && tree[parent]?.t !== 'folder') return null
  const sibs = children(tree, parent).filter((s) => s !== id)
  const i = before ? sibs.indexOf(before) : -1
  if (i < 0) return { parent, pos: sibs.length ? tree[sibs[sibs.length - 1]].pos + 1 : 1 }
  const hi = tree[sibs[i]].pos, lo = i > 0 ? tree[sibs[i - 1]].pos : hi - 2
  return { parent, pos: (lo + hi) / 2 }
}

/** Pages in reading order (folders open into their pages), for the previous / next links. */
export function reading(tree: Tree): string[] {
  const out: string[] = []
  const walk = (p: string | null) => { for (const c of children(tree, p)) { if (tree[c].t === 'page') out.push(c); else walk(c) } }
  walk(null)
  return out
}

export const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4)

// Loaded only when the assistant asks for an icon: it pulls in the whole Lucide set as its own chunk.
import { createElement, type ComponentType } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import * as L from 'lucide-react'

const all = L as unknown as Record<string, unknown>
const isIcon = (v: unknown): v is ComponentType<Record<string, unknown>> => !!v && typeof v === 'object' && '$$typeof' in (v as object)
const pascal = (s: string) => s.trim().replace(/Icon$/, '').split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('')
const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Za-z])([0-9])/g, '$1-$2').toLowerCase()

const names = (() => { const seen = new Set<string>(); for (const k of Object.keys(all)) if (isIcon(all[k]) && !/Icon$/.test(k) && !/^Lucide/.test(k) && k !== 'icons') seen.add(kebab(k)); return [...seen].sort() })()

export function searchIcons(query: string, limit = 24): string[] {
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  if (!words.length) return []
  const hit = names.filter((n) => words.every((w) => n.includes(w)))
  if (hit.length || words.length > 1 || words[0].length < 5) return hit.slice(0, limit)
  const stem = words[0].slice(0, Math.max(4, words[0].length - 2))   // a near miss like "rockett" still finds "rocket"
  return names.filter((n) => n.includes(stem)).slice(0, limit)
}

/** The SVG markup for a Lucide icon, in one colour, or null when there is no icon with that name. */
export function lucideSvg(name: string, color: string, strokeWidth: number): string | null {
  const key = pascal(name), c = all[key] ?? all[key + 'Icon']
  if (!isIcon(c)) return null
  const host = document.createElement('div'), root = createRoot(host)
  flushSync(() => root.render(createElement(c, { size: 24, color, strokeWidth, absoluteStrokeWidth: false })))
  const svg = host.querySelector('svg')
  if (!svg) { root.unmount(); return null }
  svg.removeAttribute('class'); svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const out = svg.outerHTML
  root.unmount()
  return out
}

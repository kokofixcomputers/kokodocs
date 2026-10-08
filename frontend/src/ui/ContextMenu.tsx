import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Ban, Check } from 'lucide-react'
import { viewBottom, viewRight } from './viewport'

export type CtxItem =
  | { label: string; icon?: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean; hint?: string; checked?: boolean }
  | { sep: true }
  | { heading: string }
  | { colors: string[]; current?: string | null; noneLabel?: string; onPick: (c: string | null) => void }

interface Open { x: number; y: number; items: CtxItem[] }
const LONG_PRESS = 520

/** A right-click menu: appears at the pointer, closes on outside click, Esc, scroll or resize, and works from the keyboard
 *  (the Menu key or Shift+F10 on a focused row, then arrows and Enter). On touch screens a long press opens it, since phones
 *  don't send a right-click. Spread `bind(() => items)` onto any element, and render `node` once. */
export function useContextMenu() {
  const [open, setOpen] = useState<Open | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const start = useRef<{ x: number; y: number } | null>(null)
  const swallowClick = useRef(false)

  const show = useCallback((x: number, y: number, items: CtxItem[]) => { window.clearTimeout(timer.current); setOpen({ x, y, items }) }, [])
  const close = useCallback(() => setOpen(null), [])

  const bind = useCallback((getItems: () => CtxItem[]) => ({
    onContextMenu: (e: React.MouseEvent) => {
      const items = getItems()
      if (!items.length) return
      e.preventDefault(); e.stopPropagation()
      let { clientX: x, clientY: y } = e
      if (!x && !y) { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); x = r.left + 48; y = r.bottom - 8 }   // opened with the keyboard
      show(x, y, items)
    },
    onTouchStart: (e: React.TouchEvent) => {
      if (e.touches.length !== 1) return
      const t = e.touches[0]; start.current = { x: t.clientX, y: t.clientY }
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        const items = getItems(); if (!items.length || !start.current) return
        swallowClick.current = true   // the tap that ends this press must not also open the row
        if ('vibrate' in navigator) try { navigator.vibrate(12) } catch { /* not allowed */ }
        show(start.current.x, start.current.y, items)
      }, LONG_PRESS)
    },
    onTouchMove: (e: React.TouchEvent) => {
      const t = e.touches[0], s = start.current
      if (s && Math.hypot(t.clientX - s.x, t.clientY - s.y) > 10) window.clearTimeout(timer.current)   // it's a scroll, not a press
    },
    onTouchEnd: () => window.clearTimeout(timer.current),
    onTouchCancel: () => window.clearTimeout(timer.current),
    onClickCapture: (e: React.MouseEvent) => { if (swallowClick.current) { swallowClick.current = false; e.preventDefault(); e.stopPropagation() } },
  }), [show])

  const node = open ? <ContextMenuView open={open} onClose={close} /> : null
  return { bind, node, close, show }
}

function ContextMenuView({ open, onClose }: { open: Open; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {   // keep the whole menu on screen: flip to the other side of the pointer when it would run off an edge
    const el = box.current; if (!el) return
    const w = el.offsetWidth, h = el.offsetHeight, vw = viewRight(), vh = viewBottom()
    let left = open.x, top = open.y
    if (left + w > vw - 8) left = Math.max(8, open.x - w)
    if (top + h > vh - 8) top = Math.max(8, open.y - h)
    setPos({ left, top })
  }, [open])

  useEffect(() => {
    const away = (e: Event) => { if (!box.current?.contains(e.target as Node)) onClose() }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }
    window.addEventListener('mousedown', away, true)
    window.addEventListener('touchstart', away, true)
    window.addEventListener('contextmenu', away, true)   // a right-click somewhere else replaces this menu (its own handler then opens the new one)
    window.addEventListener('keydown', esc, true)
    // scrolling the page closes the menu (it would be left floating over the wrong place), but scrolling inside the menu must not
    const scrolled = (e: Event) => { if (!box.current?.contains(e.target as Node)) onClose() }
    window.addEventListener('scroll', scrolled, true); window.addEventListener('resize', onClose); window.addEventListener('blur', onClose)
    // a wheel over a menu that doesn't need scrolling would scroll the page behind it (and so close it): keep it still
    const wheel = (e: WheelEvent) => { const el = box.current; if (el && el.scrollHeight <= el.clientHeight + 1) e.preventDefault() }
    box.current?.addEventListener('wheel', wheel, { passive: false })
    const boxEl = box.current
    return () => {
      boxEl?.removeEventListener('wheel', wheel)
      window.removeEventListener('mousedown', away, true); window.removeEventListener('touchstart', away, true); window.removeEventListener('contextmenu', away, true)
      window.removeEventListener('keydown', esc, true); window.removeEventListener('scroll', scrolled, true); window.removeEventListener('resize', onClose); window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  // focus the first item once the menu is on screen (a hidden element can't take focus), so arrows and Enter work straight away
  useEffect(() => { if (pos) box.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true }) }, [pos])

  const keys = (e: React.KeyboardEvent) => {
    const btns = Array.from(box.current?.querySelectorAll<HTMLButtonElement>('button.ctx-item:not(:disabled)') ?? [])
    const i = btns.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length]?.focus() }
    else if (e.key === 'Home') { e.preventDefault(); btns[0]?.focus() }
    else if (e.key === 'End') { e.preventDefault(); btns[btns.length - 1]?.focus() }
    else if (e.key === 'Tab') { e.preventDefault(); onClose() }
  }

  return createPortal(
    <div ref={box} className="popover ctx-menu" role="menu" onKeyDown={keys} onContextMenu={(e) => e.preventDefault()}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, visibility: pos ? 'visible' : 'hidden' }}>
      <div className="menu">
        {open.items.map((it, i) => {
          if ('sep' in it) return <div key={i} className="menu-sep" role="separator" />
          if ('heading' in it) return <div key={i} className="ctx-heading">{it.heading}</div>
          if ('colors' in it) return (
            <div key={i} className="menu-colors" role="group" aria-label="Colour">
              {it.colors.map((c) => <button key={c} type="button" className={`swatch ${it.current === c ? 'on' : ''}`} style={{ background: c }} title="Colour" aria-label={`Colour ${c}`} onClick={() => { onClose(); it.onPick(c) }} />)}
              <button type="button" className="swatch none" title={it.noneLabel ?? 'Default colour'} aria-label={it.noneLabel ?? 'Default colour'} onClick={() => { onClose(); it.onPick(null) }}><Ban size={12} /></button>
            </div>)
          return (
            <button key={i} type="button" role={it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'} aria-checked={it.checked} className={`ctx-item ${it.danger ? 'danger' : ''}`} disabled={it.disabled} onClick={() => { onClose(); it.onClick() }}>
              {it.checked ? <Check size={16} /> : it.icon}<span className="ctx-label">{it.label}</span>{it.hint && <em className="ctx-hint">{it.hint}</em>}
            </button>)
        })}
      </div>
    </div>, document.body)
}

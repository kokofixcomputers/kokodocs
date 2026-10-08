import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { viewBottom, viewRight } from './viewport'

interface Props {
  trigger: (api: { open: boolean; toggle: () => void }) => ReactNode
  children: (close: () => void) => ReactNode
  align?: 'start' | 'end'
  className?: string
  onOpenChange?: (open: boolean) => void
}

/** Portal popover anchored to its trigger; closes on outside click / Escape. */
export function Popover({ trigger, children, align = 'start', className = '', onOpenChange }: Props) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLSpanElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  const set = useCallback((v: boolean) => { setOpen(v); onOpenChange?.(v) }, [onOpenChange])

  useLayoutEffect(() => {
    if (!open || !anchor.current || !panel.current) return
    const place = () => {
      if (!anchor.current || !panel.current) return
      const a = anchor.current.getBoundingClientRect()
      const p = panel.current.getBoundingClientRect()
      let left = align === 'end' ? a.right - p.width : a.left
      const vr = viewRight(), vb = viewBottom()
      left = Math.max(8, Math.min(left, vr - p.width - 8))
      let top = a.bottom + 8
      const bar = anchor.current.closest('.ed-toolbar-wrap')?.getBoundingClientRect()   // from a toolbar at the bottom, clear the whole bar, not just the button
      if (top + p.height > vb - 8) top = Math.max(8, Math.min((bar ? bar.top : a.top) - p.height - 8, vb - p.height - 8))   // no room below (a bottom toolbar, or the keyboard): open upwards
      if (top + p.height > vb - 8) top = Math.max(8, vb - p.height - 8)
      setPos((cur) => (cur && cur.top === top && cur.left === left ? cur : { top, left }))
    }
    place()
    // content can grow after opening (the colour picker's custom section), so keep it on screen
    const ro = new ResizeObserver(place); ro.observe(panel.current)
    return () => ro.disconnect()
  }, [open, align])

  useEffect(() => {
    if (!open) { setPos(null); return }
    const down = (e: MouseEvent) => {
      const t = e.target as Node
      if (!panel.current?.contains(t) && !anchor.current?.contains(t)) set(false)
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && set(false)
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [open, set])

  return (
    <>
      <span ref={anchor} className="pop-anchor">{trigger({ open, toggle: () => set(!open) })}</span>
      {open && createPortal(
        <div ref={panel} className={`popover ${className}`}
          style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, visibility: pos ? 'visible' : 'hidden' }}
          onMouseDown={(e) => { if (!(e.target as HTMLElement).closest('input,textarea,select')) e.preventDefault() }}>
          {children(() => set(false))}
        </div>, document.body)}
    </>
  )
}

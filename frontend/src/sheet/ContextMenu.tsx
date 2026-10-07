import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface MenuItem { label: string; onClick?: () => void; danger?: boolean; sep?: boolean; disabled?: boolean; hint?: string }

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key); window.addEventListener('blur', onClose)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); window.removeEventListener('blur', onClose) }
  }, [onClose])
  const [pos, setPos] = useState({ left: x, top: y })
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 0, w = ref.current?.offsetWidth ?? 240
    setPos({ left: Math.max(8, Math.min(x, window.innerWidth - w - 8)), top: Math.max(8, Math.min(y, window.innerHeight - h - 8)) })
  }, [x, y, items.length])
  return (
    <div ref={ref} className="popover ctx-menu" style={{ left: pos.left, top: pos.top }} onMouseDown={(e) => e.preventDefault()}>
      <div className="menu">
        {items.map((it, i) => it.sep ? <div key={i} className="menu-sep" /> : (
          <button key={i} className={it.danger ? 'danger' : ''} disabled={it.disabled} onClick={() => { onClose(); it.onClick?.() }}>
            <span>{it.label}</span>{it.hint && <em>{it.hint}</em>}
          </button>
        ))}
      </div>
    </div>
  )
}

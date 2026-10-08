import { useEffect, useState } from 'react'

/** On a phone, size the editor to the part of the screen the on-screen keyboard leaves free, so the caret is never hidden under it and
 *  the formatting bar (at the bottom of the editor) sits right above the keyboard. Android Chrome does the resizing itself through the
 *  viewport setting in index.html; iPhones need it done by hand. Does nothing on computers. */
export function KeyboardFit() {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv || !matchMedia('(pointer: coarse)').matches) return
    const root = document.documentElement
    const set = () => {
      const covered = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
      const open = covered > 80 || (vv.offsetTop > 0 && vv.height < window.innerHeight - 80)
      root.style.setProperty('--vv-h', `${Math.round(vv.height)}px`)
      root.style.setProperty('--vv-top', `${Math.round(vv.offsetTop)}px`)
      root.style.setProperty('--kb', `${covered}px`)   // how much of the bottom the keyboard covers, for things that float above it
      if (root.classList.contains('kb-open') !== open) { root.classList.toggle('kb-open', open); window.dispatchEvent(new CustomEvent('koko:keyboard', { detail: open })) }
    }
    set()
    vv.addEventListener('resize', set); vv.addEventListener('scroll', set)

    // iOS draws its Cut / Copy / Paste callout above the selection, and only below it when there is no room above. Keep a selected
    // piece of text (or a caret just tapped) out of the lowest part of the visible page so the callout never lands on our bar.
    let tapped = 0, timer: number | undefined
    const touched = () => { tapped = Date.now() }
    const lift = () => {
      if (!root.classList.contains('kb-open')) return
      const sel = getSelection(); if (!sel || !sel.rangeCount) return
      const node = sel.anchorNode, el = node && (node.nodeType === 1 ? (node as HTMLElement) : node.parentElement)
      if (!el?.closest('.ProseMirror')) return
      if (sel.isCollapsed && Date.now() - tapped > 600) return   // typing is left to the editor; only a tap or a selection is moved
      const box = el.closest<HTMLElement>('.canvas, .wiki-body'); if (!box) return
      const rect = sel.getRangeAt(0).getBoundingClientRect(); if (!rect.height && !rect.top) return
      const b = box.getBoundingClientRect(), room = Math.min(b.bottom, vv.offsetTop + vv.height) - b.top
      const limit = b.top + room * 0.5   // the selection should end in the upper half
      if (rect.bottom > limit) box.scrollBy({ top: rect.bottom - limit, behavior: 'auto' })
    }
    const changed = () => { window.clearTimeout(timer); timer = window.setTimeout(lift, 120) }
    document.addEventListener('touchend', touched, true); document.addEventListener('selectionchange', changed)
    return () => { document.removeEventListener('touchend', touched, true); document.removeEventListener('selectionchange', changed); window.clearTimeout(timer); vv.removeEventListener('resize', set); vv.removeEventListener('scroll', set); root.classList.remove('kb-open'); root.style.removeProperty('--kb') }
  }, [])
  return null
}

/** True while the on-screen keyboard is showing. */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(() => typeof document !== 'undefined' && document.documentElement.classList.contains('kb-open'))
  useEffect(() => {
    const f = (e: Event) => setOpen(!!(e as CustomEvent).detail)
    window.addEventListener('koko:keyboard', f)
    return () => window.removeEventListener('koko:keyboard', f)
  }, [])
  return open
}

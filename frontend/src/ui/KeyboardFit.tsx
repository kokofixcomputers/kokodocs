import { useEffect } from 'react'

/** On a phone, size the editor to the part of the screen the on-screen keyboard leaves free, so the caret is never hidden under it and
 *  the page isn't pushed around when the keyboard opens. (Android Chrome does this itself through the viewport setting in index.html;
 *  iPhones need it done by hand.) Does nothing on computers. */
export function KeyboardFit() {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv || !matchMedia('(pointer: coarse)').matches) return
    const root = document.documentElement
    const set = () => {
      const covered = window.innerHeight - vv.height - vv.offsetTop
      const open = covered > 80 || (vv.offsetTop > 0 && vv.height < window.innerHeight - 80)
      root.style.setProperty('--vv-h', `${Math.round(vv.height)}px`)
      root.style.setProperty('--vv-top', `${Math.round(vv.offsetTop)}px`)
      root.classList.toggle('kb-open', open)
    }
    set()
    vv.addEventListener('resize', set); vv.addEventListener('scroll', set)
    return () => { vv.removeEventListener('resize', set); vv.removeEventListener('scroll', set); root.classList.remove('kb-open') }
  }, [])
  return null
}

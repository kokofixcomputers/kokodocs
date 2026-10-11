/** iPhones zoom the page in when you tap a text area whose letters come out smaller than 16 px on screen, and the editor's own zoom (anything under 100%) makes them smaller.
 *  While a text field has focus the page's maximum zoom is pinned to 1, which stops that jump; when focus leaves, pinching works again. */
export function stopIosFocusZoom() {
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const meta = document.querySelector('meta[name="viewport"]')
  if (!ios || !meta) return
  const normal = meta.getAttribute('content') ?? 'width=device-width, initial-scale=1.0'
  let timer: number | undefined
  const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
  document.addEventListener('focusin', (e) => {
    if (!typing(e.target)) return
    window.clearTimeout(timer)
    meta.setAttribute('content', `${normal}, maximum-scale=1`)
  })
  document.addEventListener('focusout', () => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => meta.setAttribute('content', normal), 400)   // (moving from one field to the next shouldn't flicker)
  })
}

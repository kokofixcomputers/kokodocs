/** Open the browser's print dialog for a prepared HTML page (choose "Save as PDF" as the destination). */
export function printHtml(html: string): Promise<void> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none'
    let done = false
    const cleanup = () => { if (done) return; done = true; setTimeout(() => frame.remove(), 500); resolve() }
    frame.onload = async () => {
      const win = frame.contentWindow, doc = frame.contentDocument
      if (!win || !doc) return cleanup()
      try {
        await Promise.race([doc.fonts.ready, new Promise((r) => setTimeout(r, 6000))]) // web fonts
        await Promise.race([Promise.all(Array.from(doc.images).map((i) => (i.complete ? null : i.decode().catch(() => null)))), new Promise((r) => setTimeout(r, 6000))])
        await new Promise((r) => setTimeout(r, 150))
      } catch { /* print anyway */ }
      win.addEventListener('afterprint', cleanup)
      win.focus()
      win.print()
      setTimeout(cleanup, 120000)
    }
    frame.srcdoc = html
    document.body.appendChild(frame)
  })
}

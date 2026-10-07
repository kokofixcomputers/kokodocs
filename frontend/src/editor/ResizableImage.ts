import Image from '@tiptap/extension-image'
import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'

const MIN = 40

/** Inline image (works inside table cells) with drag-to-resize corner handles. */
export const ResizableImage = Image.extend({
  draggable: true,
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => Number(el.getAttribute('width')) || null,
        renderHTML: (a) => (a.width ? { width: a.width, style: `width:${a.width}px` } : {}),
      },
    }
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let current = node
      const wrap = document.createElement('span')
      wrap.className = 'img-wrap'
      const img = document.createElement('img')
      img.draggable = false
      const apply = () => {
        img.src = current.attrs.src
        img.alt = current.attrs.alt ?? ''
        img.style.width = current.attrs.width ? `${current.attrs.width}px` : ''
      }
      apply()
      wrap.appendChild(img)

      const dirs = ['nw', 'ne', 'sw', 'se'] as const
      const badge = document.createElement('span')
      badge.className = 'img-size'
      wrap.appendChild(badge)

      dirs.forEach((dir) => {
        const h = document.createElement('span')
        h.className = `img-handle ${dir}`
        h.addEventListener('pointerdown', (e) => {
          if (!editor.isEditable) return
          e.preventDefault(); e.stopPropagation()
          h.setPointerCapture(e.pointerId)
          const startX = e.clientX
          const startW = img.offsetWidth
          const k = (img.getBoundingClientRect().width / (img.offsetWidth || 1)) || 1
          const sign = dir.endsWith('e') ? 1 : -1
          const limit = (wrap.closest('td,th,.ProseMirror') as HTMLElement | null)?.clientWidth ?? 800
          let w = startW
          wrap.classList.add('resizing')
          const move = (ev: PointerEvent) => {
            w = Math.round(Math.min(limit - 8, Math.max(MIN, startW + (sign * (ev.clientX - startX)) / k)))
            img.style.width = `${w}px`
            badge.textContent = `${w}px`
          }
          const up = () => {
            h.removeEventListener('pointermove', move)
            h.removeEventListener('pointerup', up)
            wrap.classList.remove('resizing')
            const pos = getPos()
            if (typeof pos === 'number') {
              editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, width: w }))
            }
          }
          h.addEventListener('pointermove', move)
          h.addEventListener('pointerup', up)
        })
        wrap.appendChild(h)
      })

      return {
        dom: wrap,
        update(n) {
          if (n.type !== current.type) return false
          current = n
          apply()
          return true
        },
        selectNode() { wrap.classList.add('selected') },
        deselectNode() { wrap.classList.remove('selected') },
        stopEvent: (e) => (e.target as HTMLElement).classList?.contains('img-handle') ?? false,
        ignoreMutation: () => true,
      }
    }
  },
})

export const ImageUpload = Extension.create<{ upload: (file: File) => Promise<string>; importUrl: (url: string) => Promise<string> }>({
  name: 'imageUpload',
  addOptions() { return { upload: async () => '', importUrl: async (u: string) => u } },
  addProseMirrorPlugins() {
    const { editor } = this
    const insert = async (files: File[], pos?: number) => {
      for (const f of files) {
        try {
          const src = await this.options.upload(f)
          const chain = editor.chain().focus()
          if (pos != null) chain.insertContentAt(pos, { type: 'image', attrs: { src, width: 360 } })
          else chain.setImage({ src, width: 360 } as any)
          chain.run()
        } catch (err) {
          window.dispatchEvent(new CustomEvent('koko:toast', { detail: (err as Error).message }))
        }
      }
    }
    const toast = (m: string) => window.dispatchEvent(new CustomEvent('koko:toast', { detail: m }))
    /** Google Docs, Word and web pages put pictures on the clipboard as links to their own servers (or embedded data). Keep our own copy of each. */
    const pasteHtml = async (html: string) => {
      const doc = new DOMParser().parseFromString(html, 'text/html')
      const found = Array.from(doc.querySelectorAll('img')).filter((i) => /^(https?:|data:image\/)/i.test(i.getAttribute('src') ?? ''))
      let failed = 0
      toast(`Importing ${Math.min(found.length, 12)} picture${found.length === 1 ? '' : 's'}…`)
      await Promise.all(found.map(async (img, n) => {
        if (n >= 12) { img.remove(); failed++; return }
        try {
          const src = img.getAttribute('src')!
          const mine = src.startsWith('data:') ? await this.options.upload(await (await fetch(src)).blob().then((b) => new File([b], 'pasted.' + (b.type.split('/')[1] || 'png').replace('jpeg', 'jpg'), { type: b.type }))) : await this.options.importUrl(src)
          img.setAttribute('src', mine)
          const w = Number(img.getAttribute('width')) || 360
          img.setAttribute('width', String(Math.max(40, Math.min(w, 624))))
          img.removeAttribute('height'); img.removeAttribute('style'); img.removeAttribute('srcset')
        } catch { failed++; img.remove() }
      }))
      if (failed) toast(`${failed} picture${failed === 1 ? '' : 's'} couldn’t be imported`)
      editor.chain().focus().insertContent(doc.body.innerHTML).run()
    }
    const images = (list?: FileList | null) => Array.from(list ?? []).filter((f) => f.type.startsWith('image/'))
    return [new Plugin({
      props: {
        handlePaste: (_v, e) => {
          const f = images(e.clipboardData?.files)
          if (f.length) { insert(f); return true }
          const html = e.clipboardData?.getData('text/html') ?? ''
          if (!/<img\b/i.test(html)) return false   // no pictures: the normal paste does the job
          const probe = new DOMParser().parseFromString(html, 'text/html')
          if (!Array.from(probe.querySelectorAll('img')).some((i) => /^(https?:|data:image\/)/i.test(i.getAttribute('src') ?? ''))) return false
          void pasteHtml(html)
          return true
        },
        handleDrop: (view, e) => {
          const f = images((e as DragEvent).dataTransfer?.files)
          if (!f.length) return false
          const at = view.posAtCoords({ left: (e as DragEvent).clientX, top: (e as DragEvent).clientY })
          insert(f, at?.pos); return true
        },
      },
    })]
  },
})

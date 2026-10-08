import { imageBlob } from '../zk/images'
export function safeName(title: string, fallback = 'Untitled') {
  const t = (title || fallback).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
  return t || fallback
}

export function saveBlob(blob: Blob, filename: string) {
  const a = document.createElement('a')
  const url = URL.createObjectURL(blob)
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export interface PMNode {
  type: string
  attrs?: Record<string, any>
  content?: PMNode[]
  marks?: { type: string; attrs?: Record<string, any> }[]
  text?: string
}

/** Every Google font family used by text in the document. */
export function usedFonts(doc: PMNode): string[] {
  const out = new Set<string>()
  const walk = (n: PMNode) => {
    n.marks?.forEach((m) => { if (m.type === 'textStyle' && m.attrs?.fontFamily) out.add(m.attrs.fontFamily) })
    n.content?.forEach(walk)
  }
  walk(doc)
  return [...out]
}

export interface ImageData { data: Uint8Array; type: 'png' | 'jpg' | 'gif'; width: number; height: number }

/** Fetch an image and normalise it to PNG/JPEG bytes with its real size (browser only). */
export async function loadImageData(src: string): Promise<ImageData | null> {
  try {
    const blob = await imageBlob(src)
    if (!blob) return null
    const bmp = await createImageBitmap(blob)
    if (blob.type === 'image/jpeg') return { data: new Uint8Array(await blob.arrayBuffer()), type: 'jpg', width: bmp.width, height: bmp.height }
    const canvas = document.createElement('canvas')
    canvas.width = bmp.width; canvas.height = bmp.height
    canvas.getContext('2d')!.drawImage(bmp, 0, 0)
    const png = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
    if (!png) return null
    return { data: new Uint8Array(await png.arrayBuffer()), type: 'png', width: bmp.width, height: bmp.height }
  } catch { return null }
}

export async function toDataUrl(src: string): Promise<string | null> {
  try {
    const blob = await imageBlob(src)
    if (!blob) return null
    return await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(blob) })
  } catch { return null }
}

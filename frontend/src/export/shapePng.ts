import { DOMSerializer } from '@tiptap/pm/model'
import { cleanShape, shapeSpec } from '../editor/shapes'

/** A shape as PNG bytes (browser only), for formats that can't hold a drawing, like Word. Drawn at twice the size so it stays crisp. */
export async function shapeToPng(attrs: Record<string, unknown>): Promise<{ data: Uint8Array; width: number; height: number } | null> {
  try {
    const a = cleanShape(attrs as never)
    const svg = DOMSerializer.renderSpec(document, shapeSpec(a) as never).dom as unknown as SVGElement
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }))
    const img = new Image(); img.src = url; await img.decode()
    const canvas = document.createElement('canvas'); canvas.width = Math.round(a.w * 2); canvas.height = Math.round(a.h * 2)
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    URL.revokeObjectURL(url)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
    return blob ? { data: new Uint8Array(await blob.arrayBuffer()), width: a.w, height: a.h } : null
  } catch { return null }
}

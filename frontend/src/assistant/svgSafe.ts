/** Cleaning up SVG the assistant writes by hand: keep drawing elements and presentation attributes, drop everything that could run code or load something. */
const TAGS = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'defs', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'title', 'desc'])
const ATTRS = new Set(['viewbox', 'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'points', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit', 'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule', 'clip-rule', 'transform', 'id', 'offset', 'stop-color', 'stop-opacity', 'gradientunits', 'gradienttransform', 'clip-path', 'preserveaspectratio', 'xmlns'])
const MAX = 24000

export function cleanSvg(markup: string): string {
  if (markup.length > MAX) throw new Error(`That SVG is too long (${markup.length} characters, most is ${MAX}). Draw it with fewer, simpler shapes.`)
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml')
  const root = doc.documentElement
  if (doc.querySelector('parsererror') || root.localName !== 'svg') throw new Error('That is not valid SVG. It must be one <svg viewBox="0 0 24 24" …> element with well-formed markup.')
  if (!root.getAttribute('viewBox')) throw new Error('The <svg> needs a viewBox, for example viewBox="0 0 24 24".')
  const walk = (el: Element) => {
    for (const child of [...el.children]) {
      if (!TAGS.has(child.localName.toLowerCase())) { child.remove(); continue }
      walk(child)
    }
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase(), v = a.value
      if (!ATTRS.has(n) || /url\(\s*(?!#)/i.test(v) || /javascript:|data:|<|&#/i.test(v)) el.removeAttribute(a.name)
    }
  }
  walk(root)
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  return new XMLSerializer().serializeToString(root)
}

export const svgDataUrl = (svg: string) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)

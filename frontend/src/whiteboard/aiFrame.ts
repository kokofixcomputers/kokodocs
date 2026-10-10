import { streamChat, type ChatMessage } from '../assistant/llm'
import { absPts, pageBox, type Box } from './geometry'
import { pngBlob } from './export'
import type { WhiteboardModel } from './model'
import type { El } from './types'

/** "Bring to life": Koko looks at what is drawn inside a frame (as a picture and as a list of what is where) and builds the website it shows. */
const BASE = `You are an expert front-end developer. A person sketched a screen on a whiteboard and boxed it in a frame. Build the working website or app that sketch shows, as ONE self-contained HTML file.
Read the drawing like a designer: a box with text in it is usually a button, card, input field, menu item or heading depending on its shape and size; a wide box at the top is a header or navigation; a box with a cross or scribble is an image placeholder (use a soft gradient or inline SVG, not a missing picture); small boxes in a row are tabs or icons; arrows between boxes mean "this goes to that" (a link, a step or a flow); freehand scribbles are rough ideas for pictures, charts or icons (draw something fitting with inline SVG).
Make it work: buttons, tabs, menus, toggles, forms and lists should respond to clicks with plain JavaScript (a calculator calculates, a to-do list adds and removes). Keep state in variables, not storage or the network.
Technical rules: all CSS and JavaScript inline. No external libraries, scripts or frameworks; no network requests (they are blocked). You may use Google Fonts with a <link>, and plain colours or inline SVG for pictures. The page is shown in a window of the size given; fill it and let it adapt if resized (relative units, flexbox or grid).
Reply with ONLY the complete HTML document, starting with <!DOCTYPE html>. No explanation and no code fences.`

const EXACT = `
HOW CLOSELY TO FOLLOW THE SKETCH: as closely as possible, with the fewest design changes. Treat the drawing as the finished design and only make it function.
- Every shape, button, box and piece of text that is drawn must appear in the page, in the same place, in the same order, at the same relative size and with the same words, exactly as written (including odd spelling and symbols).
- Keep the drawn colours, fills, rounded or square corners and overall look. Do not restyle, rename, reorder, add or remove anything, and do not add sections, headings, logos, footers or copy that were not drawn. If something is not drawn, it is not on the page.
- Only add what is needed to make the drawn parts work: for a calculator, every key drawn is on the page exactly as drawn and each one does what its label says.
- Where the drawing is rough (wobbly lines, uneven gaps), tidy it into straight, aligned boxes without changing the arrangement.`
const CREATIVE = `
HOW CLOSELY TO FOLLOW THE SKETCH: the sketch is a brief, not a blueprint. Be inventive and make it genuinely good.
- Keep the purpose, every function and every piece of content the sketch shows (all the features drawn must exist and work), and keep its general structure.
- But you are free to design it: choose a modern, polished visual style, a colour palette, typography, spacing, icons, shadows, hover states and small animations; improve the layout and hierarchy; and add thoughtful details a real product would have (empty states, helpful micro-copy, keyboard support, nice transitions), as long as they fit what the person is making.
- Do not copy the roughness or the colours of the drawing unless they are clearly intentional.`
const systemFor = (mode: 'exact' | 'creative') => BASE + (mode === 'creative' ? CREATIVE : EXACT)

const r = (n: number) => Math.round(n)
function describe(frame: El, list: El[]): string {
  const f = pageBox(frame)
  const rel = (b: Box) => `x ${r(b.x - f.x)}, y ${r(b.y - f.y)}, ${r(b.w)}×${r(b.h)}`
  const byId = new Map(list.map((e) => [e.id, e]))
  const nm = (id?: string) => (id ? (byId.get(id)?.text?.trim().split('\n')[0] || byId.get(id)?.type || '?') : undefined)
  const out = list.map((e, i) => {
    const b = pageBox(e), bits: string[] = [`${i + 1}. ${e.type}`]
    if (e.type === 'arrow' || e.type === 'line') {
      const a = absPts(e)
      bits.push(`from ${e.from ? `“${nm(e.from.id)}”` : `(${r(a[0][0] - f.x)}, ${r(a[0][1] - f.y)})`} to ${e.to ? `“${nm(e.to.id)}”` : `(${r(a[a.length - 1][0] - f.x)}, ${r(a[a.length - 1][1] - f.y)})`}`)
    } else bits.push(rel(b) + (e.a ? `, rotated ${r((e.a * 180) / Math.PI)}°` : ''))
    if (e.text?.trim()) bits.push(`text “${e.text.trim().replace(/\n/g, ' / ')}”${e.size ? ` (${e.size}px ${e.font ?? ''}${e.bold ? ' bold' : ''})` : ''}`)
    if (e.type !== 'text' && e.type !== 'image') { bits.push(`outline ${e.stroke}`); if (e.fill !== 'transparent') bits.push(`filled ${e.fill}`); if (e.rad) bits.push('rounded corners'); if (e.ss !== 'solid') bits.push(e.ss) }
    if (e.type === 'text' && e.tc) bits.push(`colour ${e.tc}`)
    return '   ' + bits.join(', ')
  })
  return `The frame is ${r(f.w)}×${r(f.h)} px. Everything inside it, from back (1) to front, with positions measured from the frame's top-left corner:\n${out.join('\n') || '   (nothing is drawn inside)'}`
}

const dataUrl = (b: Blob) => new Promise<string>((ok, bad) => { const f = new FileReader(); f.onload = () => ok(String(f.result)); f.onerror = () => bad(new Error('Could not read the picture')); f.readAsDataURL(b) })
/** the page out of a reply: without any fence or chatter around it */
export function extractHtml(text: string): string {
  let t = text.trim()
  const fence = /```(?:html)?\s*\n([\s\S]*?)```/i.exec(t); if (fence) t = fence[1].trim()
  const start = t.search(/<!doctype html|<html[\s>]/i); if (start > 0) t = t.slice(start)
  const end = t.toLowerCase().lastIndexOf('</html>'); if (end > 0) t = t.slice(0, end + 7)
  if (!/<(html|body|div|main|section|header)[\s>]/i.test(t)) throw new Error('Koko did not send back a web page. Try again, or describe the frame in its name.')
  if (!/<!doctype/i.test(t) && !/<html/i.test(t)) t = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${t}</body></html>`
  return t.length > 400_000 ? t.slice(0, 400_000) : t
}

async function ask(messages: ChatMessage[], onProgress?: (n: number) => void, signal?: AbortSignal): Promise<string> {
  const c = new AbortController(); const abort = () => c.abort(); signal?.addEventListener('abort', abort, { once: true })
  try { return (await streamChat(messages, [], c.signal, (t) => onProgress?.(t.length))).content } finally { signal?.removeEventListener('abort', abort) }
}

export interface LifeOpts { instruction?: string; onProgress?: (chars: number) => void; signal?: AbortSignal; bg: string; mode?: 'exact' | 'creative' }
/** Make (or remake) the website for an AI frame. Returns the id of the website object, which sits to the right of the frame. */
export async function bringToLife(model: WhiteboardModel, frameId: string, o: LifeOpts): Promise<string> {
  const frame = model.get(frameId)
  if (!frame || frame.type !== 'frame') throw new Error('Pick a frame first.')
  const f = pageBox(frame), mode = o.mode ?? frame.mode ?? 'exact'
  const inside = model.read().filter((e) => e.id !== frame.id && !e.hide && e.type !== 'embed' && e.type !== 'frame' && (() => { const b = pageBox(e); return b.x >= f.x - 2 && b.y >= f.y - 2 && b.x + b.w <= f.x + f.w + 2 && b.y + b.h <= f.y + f.h + 2 })())
  if (!inside.length) throw new Error('There is nothing drawn inside that frame yet. Draw the screen you want inside it, then try again.')
  // the website object: made first, so everyone sees that it is being built
  let emb = model.read().find((e) => e.type === 'embed' && e.frame === frame.id)
  const W = Math.max(480, Math.round(f.w)), H = Math.max(340, Math.round(f.h))
  let id = emb?.id
  if (!id) [id] = model.add([model.make('embed', { x: f.x + f.w + 60, y: f.y, w: W, h: H + 26, frame: frame.id, name: frame.name && frame.name !== 'AI frame' ? frame.name : 'Website', busy: Date.now(), fill: 'transparent' })])
  else model.update(id, { busy: Date.now() })
  try {
    const userText = `${describe(frame, inside)}\n\nThe page will be shown in a window of ${W}×${H} px.${frame.name && !/^(AI frame|Frame)$/i.test(frame.name) ? `\nThe person named the frame: “${frame.name}”.` : ''}${o.instruction ? `\nExtra instruction: ${o.instruction}` : ''}`
    let img: string | null = null
    try { img = await dataUrl(await pngBlob(model.read().filter((e) => e.type !== 'embed'), o.bg, 1.5, { x: f.x, y: f.y, w: f.w, h: f.h }, 1400)) } catch { img = null }
    const withImage: ChatMessage[] = [{ role: 'system', content: systemFor(mode) }, { role: 'user', content: [{ type: 'text', text: 'Here is the frame as a picture, and below it a list of exactly what is in it.\n\n' + userText }, { type: 'image_url', image_url: { url: img } }] as unknown as string }]
    const textOnly: ChatMessage[] = [{ role: 'system', content: systemFor(mode) }, { role: 'user', content: userText }]
    let reply: string
    try { reply = img ? await ask(withImage, o.onProgress, o.signal) : await ask(textOnly, o.onProgress, o.signal) } catch (e) {
      if (!img || o.signal?.aborted) throw e
      reply = await ask(textOnly, o.onProgress, o.signal)   // the model may not be able to see pictures: the list of shapes is enough to work from
    }
    const html = extractHtml(reply)
    model.update(id, { html, busy: undefined, prompt: o.instruction, w: emb?.w ?? W, h: emb?.h ?? H + 26 })
    return id
  } catch (e) { model.update(id, { busy: undefined }); throw e }
}

/** Change a website Koko made, as asked ("make the header dark", "add a pricing section"). */
export async function reviseSite(model: WhiteboardModel, embedId: string, instruction: string, o: Omit<LifeOpts, 'instruction'>): Promise<void> {
  const e = model.get(embedId)
  if (!e || e.type !== 'embed' || !e.html) throw new Error('There is no website to change.')
  model.update(embedId, { busy: Date.now() })
  try {
    const reply = await ask([
      { role: 'system', content: 'You are an expert front-end developer editing a single-file website. Apply the requested change to the HTML you are given and reply with ONLY the complete updated HTML document (starting with <!DOCTYPE html>). Keep everything else exactly as it is. All CSS and JavaScript stay inline; no external scripts; no network requests.' },
      { role: 'user', content: `Change to make: ${instruction}\n\nCurrent page:\n${e.html}` },
    ], o.onProgress, o.signal)
    model.update(embedId, { html: extractHtml(reply), busy: undefined, prompt: instruction })
  } catch (err) { model.update(embedId, { busy: undefined }); throw err }
}

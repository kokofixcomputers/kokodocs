import { api } from '../../api'
import { streamChat } from '../../assistant/llm'

/** One question to the AI model the person has connected (Settings → Assistant): a system line and a user message in, the answer out.
 *  `stopAfter` cuts the answer off once it is that long (for short suggestions). */
export async function askModel(system: string, user: string, signal: AbortSignal, onText?: (t: string) => void, stopAfter = 0): Promise<string> {
  const stop = new AbortController()
  const abort = () => stop.abort(); signal.addEventListener('abort', abort, { once: true })
  let seen = ''
  try {
    const r = await streamChat([{ role: 'system', content: system }, { role: 'user', content: user }], [], stop.signal, (t) => {
      seen = t; onText?.(t)
      if (stopAfter && t.length >= stopAfter) stop.abort()
    })
    return r.content
  } catch (e) {
    if (stopAfter && !signal.aborted && seen) return seen   // (we cut it off ourselves)
    throw e
  } finally { signal.removeEventListener('abort', abort) }
}

let ready: { at: number; ok: boolean } | null = null
/** is an AI model connected? (asked at most once a minute) */
export async function aiConnected(): Promise<boolean> {
  if (ready && Date.now() - ready.at < 60000) return ready.ok
  try { ready = { at: Date.now(), ok: (await api.aiSettings()).configured } } catch { ready = { at: Date.now(), ok: false } }
  return ready.ok
}
export const forgetAiState = () => { ready = null }

/** what a suggestion should look like: the first line only, finishing the sentence being written (it stops at the first full stop, question or exclamation mark),
 *  not a repeat of what is already written, short, and joined properly to what is there */
export function tidySuggestion(before: string, raw: string): string {
  let s = raw.replace(/\r/g, '').replace(/^["“'`]+/, '')
  s = s.split('\n')[0]
  const tail = before.slice(-24)
  if (tail.length >= 8 && s.startsWith(tail)) s = s.slice(tail.length)   // the model began again from what was already there
  if (/\s$/.test(before)) s = s.replace(/^\s+/, '')
  else if (/^[a-z]/i.test(s) && /[a-z]$/i.test(before) === false) s = s.replace(/^(?=\w)/, ' ')   // after punctuation, a word needs a space
  const end = /^(.*?[.!?])(?=\s|$)/.exec(s)   // a sentence at a time
  if (end) s = end[1]
  else { const w = s.split(/\s+/); if (w.length > 14) s = w.slice(0, 14).join(' ') }
  if (s.length > 150) { const cut = s.slice(0, 150), sp = cut.lastIndexOf(' '); s = sp > 60 ? cut.slice(0, sp) : cut }
  s = s.replace(/\s+$/, '')
  return /[\p{L}\p{N}]/u.test(s) && s.trim().length >= 2 ? s : ''
}

export const AUTOCOMPLETE_SYSTEM = "You are the autocomplete in a professional text editor. Finish the sentence the user is in the middle of, then stop at the end of that sentence. Write in a polished, professional tone with correct grammar and punctuation (commas, apostrophes and a closing full stop, question mark or exclamation mark), even when the user's own text is casual or has typos: for example \"hi there how are you do\" continues as \"ing today?\". Reply with ONLY the words that come next, as plain text: no quotes, no explanation, no new line, no slang or abbreviations, and never repeat the text you were given."

/** the on-device model only continues text, so the text is put after a few polished sentences to set the tone: professional, complete, properly punctuated */
export const POLISHED_PREFIX = "Professional correspondence, written in polite, complete sentences with correct grammar and punctuation:\n\nHi there, how are you doing today? I hope this message finds you well.\nThank you for reaching out, and I would be happy to help you with your request.\nPlease let me know if you have any questions, and I will respond as soon as possible.\n\n"

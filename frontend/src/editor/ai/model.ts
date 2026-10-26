import { api } from '../../api'
import { streamChat } from '../../assistant/llm'

/** One question to the AI model the person has connected (Settings → Assistant): a system line and a user message in, the answer out.
 *  `stopAfter` cuts the answer off once it is that long (for short suggestions). */
export async function askModel(system: string, user: string, signal: AbortSignal, onText?: (t: string) => void, stopAfter = 0, modelId?: string): Promise<string> {
  const stop = new AbortController()
  const abort = () => stop.abort(); signal.addEventListener('abort', abort, { once: true })
  let seen = ''
  try {
    const r = await streamChat([{ role: 'system', content: system }, { role: 'user', content: user }], [], stop.signal, (t) => {
      seen = t; onText?.(t)
      if (stopAfter && t.length >= stopAfter) stop.abort()
    }, modelId || undefined)
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


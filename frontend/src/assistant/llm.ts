import { aiChatRequest } from '../api'

export interface ToolCall { id: string; name: string; arguments: string }
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}
export interface ToolSpec { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }

const MAX_MESSAGES = 160, MAX_CHARS = 320000
const size = (m: ChatMessage) => (m.content?.length ?? 0) + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0)

/** What to send: the whole conversation while it is small, and once it grows (every tool call is two messages, so a long design session
 *  passes the server's limit quickly) the oldest turns are left out. Cuts only fall on a person's message, so a tool call is never
 *  separated from its result, and a note tells the model that earlier steps were dropped. The saved conversation keeps everything. */
export function fitHistory(msgs: ChatMessage[]): ChatMessage[] {
  let total = msgs.reduce((n, m) => n + size(m), 0)
  if (msgs.length <= MAX_MESSAGES && total <= MAX_CHARS) return msgs
  let start = 0
  while (start < msgs.length - 1 && (msgs.length - start > MAX_MESSAGES || total > MAX_CHARS)) {
    let next = start + 1
    while (next < msgs.length && msgs[next].role !== 'user') next++
    if (next >= msgs.length) {   // the newest turn alone is too long: cut at an assistant step instead, with its results going too
      next = start + 1
      while (next < msgs.length - 1 && msgs[next].role !== 'assistant') next++
      if (next >= msgs.length - 1) break
    }
    for (let i = start; i < next; i++) total -= size(msgs[i])
    start = next
  }
  if (start === 0) return msgs
  const kept = msgs.slice(start)
  while (kept.length > 1 && kept[0].role === 'tool') kept.shift()
  return [{ role: 'user', content: '[The earlier part of this conversation was left out to keep it short. What is on the page may have changed since: read it again with your tools before relying on earlier results.]' }, ...kept]
}

/** Stream one completion from the proxy, calling onText with the growing reply. Handles providers that don't stream. */
export async function streamChat(messages: ChatMessage[], tools: ToolSpec[], signal: AbortSignal, onText: (t: string) => void, modelId?: string | null): Promise<{ content: string; toolCalls: ToolCall[] }> {
  const res = await aiChatRequest({ messages, tools: tools.length ? tools : undefined, ...(modelId ? { model_id: modelId } : {}) }, signal)
  if (!res.ok) {
    let msg = res.statusText
    try { const j = await res.json(); msg = typeof j.detail === 'string' ? j.detail : j.detail?.message ?? msg } catch { /* keep status text */ }
    throw new Error(msg)
  }
  let content = ''
  const calls = new Map<number, ToolCall>()
  const take = (delta: any) => {
    if (!delta) return
    if (typeof delta.content === 'string' && delta.content) { content += delta.content; onText(content) }
    for (const tc of delta.tool_calls ?? []) {
      const i = tc.index ?? 0
      const cur = calls.get(i) ?? { id: '', name: '', arguments: '' }
      if (tc.id) cur.id = tc.id
      if (tc.function?.name) cur.name += tc.function.name
      if (tc.function?.arguments) cur.arguments += tc.function.arguments
      calls.set(i, cur)
    }
  }
  if ((res.headers.get('content-type') ?? '').includes('application/json')) {
    const j = await res.json()
    const m = j.choices?.[0]?.message
    take({ content: m?.content, tool_calls: (m?.tool_calls ?? []).map((t: any, i: number) => ({ index: i, ...t })) })
  } else {
    const reader = res.body!.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let idx: number
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1)
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (!data || data === '[DONE]') continue
        try { take(JSON.parse(data).choices?.[0]?.delta) } catch { /* partial or keep-alive line */ }
      }
    }
  }
  const toolCalls = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, c], i) => ({ ...c, id: c.id || `call_${Date.now().toString(36)}_${i}` })).filter((c) => c.name)
  return { content, toolCalls }
}

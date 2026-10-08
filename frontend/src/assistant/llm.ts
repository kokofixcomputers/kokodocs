import { aiChatRequest } from '../api'

export interface ToolCall { id: string; name: string; arguments: string }
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}
export interface ToolSpec { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }

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

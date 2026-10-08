import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type AiConversationInfo, type AiFilesMode, type AiSettings, type User } from '../api'
import { crossTools } from './crossTools'
import { type Adapter, type ProposalItem } from './adapter'
import { type ChatMessage, streamChat } from './llm'

export interface PCall { id: string; name: string; args: any; item: ProposalItem; state?: 'done' | 'error'; note?: string }
export type Item =
  | { k: 'user'; id: string; text: string }
  | { k: 'assistant'; id: string; text: string }
  | { k: 'activity'; id: string; text: string; status: 'run' | 'done' | 'error' }
  | { k: 'proposal'; id: string; calls: PCall[]; status: 'pending' | 'approved' | 'skipped'; kind?: 'edit' | 'read' }
  | { k: 'notice'; id: string; text: string }

const SESSION_KEY = 'koko-ai-approve-edits'
const READ_KEY = 'koko-ai-approve-reads'
const MAX_STEPS = 14
let seq = 0
const uid = () => `${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`
const readSession = () => { try { return sessionStorage.getItem(SESSION_KEY) === '1' } catch { return false } }
const readReadSession = () => { try { return sessionStorage.getItem(READ_KEY) === '1' } catch { return false } }

function systemPrompt(a: Adapter, user: User, filesMode: AiFilesMode) {
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  return `You are Koko, a capable colleague who works alongside ${user.name} inside KokoDocs. They have opened a ${a.noun} called “${a.title()}” and you can see all of it through your tools.
Today is ${today}.

How to work:
- Talk like a thoughtful coworker: direct, warm, concise. No filler, no sign-offs, no emojis.
- Look before you act. Read the ${a.noun} with your tools instead of guessing or asking the user to paste things.
- For questions, just answer from what you read. For changes, make them with your edit tools; the user approves them first, so say briefly what you are about to do and why.
- Do the whole task. When a request needs several edits, make them all, then summarize what you changed in a sentence or two.
- If something is ambiguous and a wrong guess would be costly, ask one short question. Otherwise pick a sensible default and mention it.
- If an edit fails or the user skips it, adapt: re-read, try another approach, or ask.
- Reply in Markdown (short paragraphs, bullets, bold, tables or code only when they help).
${a.canEdit() ? '' : '- This user can only view the file, so you cannot edit it. Offer suggestions as text instead.\n'}${filesMode === 'off' ? '' : `- ${user.name} has let you look at their OTHER files (search_other_files, read_other_file). Use that when the question needs something from elsewhere, such as a number, a decision or a plan written in another file, or when they point at one. It is read only: never try to change another file. Look only as much as the task needs, say which files you used (by name), and if a lookup is declined, carry on without it.\n`}
${a.guide}`
}

export function useAssistant(adapter: Adapter, docId: string, user: User, settings: AiSettings | null) {
  const [items, setItems] = useState<Item[]>([])
  const [busy, setBusy] = useState(false)
  const [sessionApprove, setSessionApprove] = useState(readSession)
  const [filesMode, setFilesModeState] = useState<AiFilesMode>('off')
  const [readApprove, setReadApprove] = useState(readReadSession)
  const [convId, setConvId] = useState(uid)
  const [title, setTitle] = useState('')
  const [history, setHistory] = useState<AiConversationInfo[]>([])
  const msgs = useRef<ChatMessage[]>([])
  const abort = useRef<AbortController | null>(null)
  const waiting = useRef(new Map<string, (d: 'approve' | 'skip') => void>())
  const ad = useRef(adapter); ad.current = adapter
  const approveRef = useRef(sessionApprove); approveRef.current = sessionApprove
  const modelRef = useRef(settings?.selected ?? null); modelRef.current = settings?.selected ?? null   // the model picked in the chat box, sent with every request
  const modeRef = useRef(filesMode); modeRef.current = filesMode
  const readApproveRef = useRef(readApprove); readApproveRef.current = readApprove
  const toolsNow = () => [...ad.current.tools, ...(modeRef.current !== 'off' ? crossTools(docId) : [])]
  useEffect(() => { api.aiFilesMode().then((r) => setFilesModeState(r.mode)).catch(() => {}) }, [])
  const setFilesMode = useCallback(async (m: AiFilesMode) => { const prev = modeRef.current; setFilesModeState(m); try { await api.setAiFilesMode(m) } catch (e) { setFilesModeState(prev); throw e } }, [])
  const itemsRef = useRef(items); itemsRef.current = items
  const idRef = useRef(convId); idRef.current = convId
  const titleRef = useRef(title); titleRef.current = title
  const dirty = useRef(false)

  const patch = useCallback((id: string, f: (i: Item) => Item) => setItems((l) => l.map((i) => (i.id === id ? f(i) : i))), [])
  const add = useCallback((i: Item) => setItems((l) => [...l, i]), [])

  const refreshHistory = useCallback(() => { api.aiConversations(docId).then(setHistory).catch(() => {}) }, [docId])
  useEffect(refreshHistory, [refreshHistory])

  const save = useCallback(async () => {
    if (!dirty.current || !itemsRef.current.length) return
    dirty.current = false
    const clean = itemsRef.current.filter((i) => !(i.k === 'proposal' && i.status === 'pending')).map((i) => (i.k === 'activity' && i.status === 'run' ? { ...i, status: 'done' as const } : i))
    try { await api.saveAiConversation(docId, idRef.current, titleRef.current || 'New conversation', [{ items: clean, messages: msgs.current }]); refreshHistory() } catch { /* offline; try again next turn */ }
  }, [docId, refreshHistory])

  const stop = useCallback(() => {
    abort.current?.abort()
    waiting.current.forEach((r) => r('skip')); waiting.current.clear()
  }, [])
  useEffect(() => () => { stop(); void save() }, [stop, save])

  const decide = useCallback((id: string, d: 'approve' | 'session' | 'skip') => {
    if (d === 'session') {
      const isRead = itemsRef.current.some((i) => i.k === 'proposal' && i.id === id && i.kind === 'read')
      if (isRead) { try { sessionStorage.setItem(READ_KEY, '1') } catch { /* private mode */ } setReadApprove(true); readApproveRef.current = true }
      else { try { sessionStorage.setItem(SESSION_KEY, '1') } catch { /* private mode */ } setSessionApprove(true); approveRef.current = true }
    }
    const r = waiting.current.get(id); waiting.current.delete(id)
    r?.(d === 'skip' ? 'skip' : 'approve')
  }, [])
  const revokeSession = useCallback(() => { try { sessionStorage.removeItem(SESSION_KEY) } catch { /* ignore */ } setSessionApprove(false) }, [])
  const revokeReads = useCallback(() => { try { sessionStorage.removeItem(READ_KEY) } catch { /* ignore */ } setReadApprove(false); readApproveRef.current = false }, [])

  const exec = async (name: string, rawArgs: string): Promise<{ ok: boolean; text: string; args: any }> => {
    const t = toolsNow().find((x) => x.spec.function.name === name)
    if (!t) return { ok: false, text: `Unknown tool “${name}”.`, args: {} }
    let args: any = {}
    try { args = rawArgs.trim() ? JSON.parse(rawArgs) : {} } catch { return { ok: false, text: 'The arguments were not valid JSON. Try again.', args: {} } }
    try { return { ok: true, text: await t.run(args), args } } catch (e) { return { ok: false, text: (e as Error).message || 'That failed.', args } }
  }

  const run = useCallback(async (userText: string) => {
    const a = ad.current
    const ac = new AbortController(); abort.current = ac
    setBusy(true); dirty.current = true
    if (!titleRef.current) { const t = userText.replace(/\s+/g, ' ').trim(); setTitle(t.length > 48 ? t.slice(0, 47) + '…' : t) }
    add({ k: 'user', id: uid(), text: userText })
    msgs.current.push({ role: 'user', content: userText })
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const sys: ChatMessage = { role: 'system', content: systemPrompt(a, user, modeRef.current) + `\n\nCurrent state: ${a.context()}` }
        const aid = uid()
        let started = false
        const { content, toolCalls } = await streamChat([sys, ...msgs.current], a.canEdit() ? toolsNow().map((t) => t.spec) : toolsNow().filter((t) => !t.edit).map((t) => t.spec), ac.signal, (txt) => {
          if (!started) { started = true; add({ k: 'assistant', id: aid, text: txt }) } else patch(aid, (i) => ({ ...i, text: txt }) as Item)
        }, modelRef.current)
        msgs.current.push({ role: 'assistant', content: content || null, ...(toolCalls.length && { tool_calls: toolCalls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: c.arguments } })) }) })
        if (!toolCalls.length) { if (!content.trim() && !started) add({ k: 'notice', id: uid(), text: 'The model sent an empty reply.' }); break }

        let i = 0
        while (i < toolCalls.length) {
          const tc = toolCalls[i]
          const t = toolsNow().find((x) => x.spec.function.name === tc.name)
          if (t?.edit && a.canEdit()) {
            // gather the consecutive run of edits into one approval
            const group = [] as typeof toolCalls
            while (i < toolCalls.length && toolsNow().find((x) => x.spec.function.name === toolCalls[i].name)?.edit) group.push(toolCalls[i++])
            const pcalls: PCall[] = group.map((c) => {
              let args: any = {}; try { args = c.arguments.trim() ? JSON.parse(c.arguments) : {} } catch { /* reported on run */ }
              const tool = toolsNow().find((x) => x.spec.function.name === c.name)!
              let item: ProposalItem; try { item = tool.describe?.(args) ?? { title: c.name } } catch { item = { title: c.name } }
              return { id: c.id, name: c.name, args, item }
            })
            const pid = uid()
            let decision: 'approve' | 'skip' = 'approve'
            const auto = approveRef.current
            add({ k: 'proposal', id: pid, calls: pcalls, status: auto ? 'approved' : 'pending' })
            if (!auto) decision = await new Promise((res) => { waiting.current.set(pid, res); ac.signal.addEventListener('abort', () => res('skip'), { once: true }) })
            if (decision === 'skip' || ac.signal.aborted) {
              patch(pid, (x) => ({ ...x, status: 'skipped' }) as Item)
              for (const c of group) msgs.current.push({ role: 'tool', tool_call_id: c.id, content: 'The user declined this edit. Do not retry it; ask what they would prefer, or continue without it.' })
              if (ac.signal.aborted) throw new DOMException('aborted', 'AbortError')
              continue
            }
            patch(pid, (x) => ({ ...x, status: 'approved' }) as Item)
            for (const c of group) {
              const r = await exec(c.name, c.arguments)
              patch(pid, (x) => x.k === 'proposal' ? { ...x, calls: x.calls.map((p) => p.id === c.id ? { ...p, state: r.ok ? 'done' : 'error', note: r.ok ? undefined : r.text } : p) } : x)
              msgs.current.push({ role: 'tool', tool_call_id: c.id, content: r.text })
            }
          } else {
            i++
            const aidAct = uid()
            let args: any = {}; try { args = tc.arguments.trim() ? JSON.parse(tc.arguments) : {} } catch { /* reported by exec */ }
            if (t?.access && modeRef.current === 'ask' && !readApproveRef.current) {   // the person asked to be asked first
              let card: ProposalItem; try { card = (await t.prepare?.(args)) ?? { title: tc.name } } catch (e) { card = { title: tc.name, detail: (e as Error).message } }
              const pid = uid()
              add({ k: 'proposal', id: pid, kind: 'read', status: 'pending', calls: [{ id: tc.id, name: tc.name, args, item: card }] })
              const decision: 'approve' | 'skip' = await new Promise((res) => { waiting.current.set(pid, res); ac.signal.addEventListener('abort', () => res('skip'), { once: true }) })
              patch(pid, (x) => ({ ...x, status: decision === 'skip' ? 'skipped' : 'approved' }) as Item)
              if (decision === 'skip' || ac.signal.aborted) {
                msgs.current.push({ role: 'tool', tool_call_id: tc.id, content: 'The user declined to let you look at their other files for this. Do not ask again for the same thing; carry on without it.' })
                if (ac.signal.aborted) throw new DOMException('aborted', 'AbortError')
                continue
              }
            }
            const label = t?.edit ? 'Tried to edit' : t?.label?.(args) ?? tc.name.replace(/_/g, ' ')
            add({ k: 'activity', id: aidAct, text: label, status: 'run' })
            const r = t?.edit ? { ok: false, text: 'This user has view-only access; you cannot edit.' } : await exec(tc.name, tc.arguments)
            patch(aidAct, (x) => ({ ...x, status: r.ok ? 'done' : 'error', text: r.ok ? (x as any).text : `${(x as any).text}: ${r.text}` }) as Item)
            msgs.current.push({ role: 'tool', tool_call_id: tc.id, content: r.text })
          }
          if (ac.signal.aborted) throw new DOMException('aborted', 'AbortError')
        }
        if (step === MAX_STEPS - 1) add({ k: 'notice', id: uid(), text: 'I stopped after many steps. Ask me to keep going if there is more to do.' })
      }
    } catch (e) {
      const err = e as Error
      if (err.name === 'AbortError') add({ k: 'notice', id: uid(), text: 'Stopped.' })
      else add({ k: 'notice', id: uid(), text: err.message || 'Something went wrong.' })
      // keep tool_call/tool message pairing valid for the next turn
      const last = msgs.current[msgs.current.length - 1]
      if (last?.role === 'assistant' && last.tool_calls) for (const c of last.tool_calls) msgs.current.push({ role: 'tool', tool_call_id: c.id, content: 'Cancelled.' })
    } finally {
      abort.current = null; setBusy(false); setTimeout(() => void save(), 50)
    }
  }, [add, patch, user, save])

  const send = useCallback((text: string) => { const t = text.trim(); if (t && !busy) void run(t) }, [busy, run])

  const reset = useCallback((id: string) => { setItems([]); msgs.current = []; setConvId(id); setTitle(''); dirty.current = false }, [])
  const newConversation = useCallback(async () => { stop(); await save(); reset(uid()) }, [stop, save, reset])
  const openConversation = useCallback(async (cid: string) => {
    stop(); await save()
    try {
      const c = await api.aiConversation(docId, cid)
      const d = (c.data?.[0] ?? {}) as { items?: Item[]; messages?: ChatMessage[] }
      setItems(d.items ?? []); msgs.current = d.messages ?? []; setConvId(cid); setTitle(c.title); dirty.current = false
    } catch (e) { add({ k: 'notice', id: uid(), text: (e as Error).message }) }
  }, [docId, stop, save, add])
  const removeConversation = useCallback(async (cid: string) => {
    await api.deleteAiConversation(docId, cid).catch(() => {})
    if (cid === idRef.current) reset(uid())
    refreshHistory()
  }, [docId, refreshHistory, reset])

  return { items, busy, send, stop, decide, sessionApprove, revokeSession, filesMode, setFilesMode, readApprove, revokeReads, history, convId, title, newConversation, openConversation, removeConversation, configured: !!settings?.configured }
}

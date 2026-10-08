// Koko conversations in an encrypted document: kept encrypted with a key derived from the master key, so only this person can read them
// (not the server, and not the other people who share the document).
import { hkdf, openText, sealText } from './crypto'
import { zkMaster } from './session'

async function key(): Promise<Uint8Array> {
  const m = zkMaster(); if (!m) throw new Error('Your encryption keys are locked')
  return hkdf(m, 'koko-zk-conversations-v1')
}
const dataAad = (doc: string, cid: string) => `conv:${doc}:${cid}`
const titleAad = (doc: string, cid: string) => `convt:${doc}:${cid}`

/** What to send to the server in place of a conversation's title and messages. (The title is cut short so its encrypted form still fits.) */
export async function sealConversation(doc: string, cid: string, title: string, data: unknown[]) {
  const k = await key()
  return { title: await sealText(k, title.slice(0, 60), titleAad(doc, cid)), data: [{ zk: await sealText(k, JSON.stringify(data), dataAad(doc, cid)) }] }
}
export async function openConversationTitle(doc: string, cid: string, enc: string): Promise<string> {
  try { return await openText(await key(), enc, titleAad(doc, cid)) } catch { return 'Conversation' }
}
export async function openConversation(doc: string, cid: string, data: unknown[]): Promise<unknown[]> {
  const first = data?.[0] as { zk?: string } | undefined
  if (!first?.zk) return data ?? []
  try { return JSON.parse(await openText(await key(), first.zk, dataAad(doc, cid))) } catch { return [] }
}

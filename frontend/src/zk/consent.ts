// Koko and voice typing have to send what you give them through the server to an AI or speech service. In an encrypted document that is
// the one thing that gets past the encryption, so it is only done after the person has said yes (once per browser session).
import { askConfirm } from '../ui/Dialogs'

export type Via = 'koko' | 'voice' | 'ocr'
const key = (w: Via) => `koko.zk.consent.${w}`
export const hasConsent = (w: Via) => { try { return sessionStorage.getItem(key(w)) === '1' } catch { return false } }
export const grantConsent = (w: Via) => { try { sessionStorage.setItem(key(w), '1') } catch { /* asked again next time */ } }

export const WHY: Record<Via, { title: string; text: string; label: string }> = {
  koko: { title: 'Use Koko in an encrypted document?', label: 'Use Koko',
    text: 'Koko works by sending the text of this document, and what you ask, through the server to your AI service. The server passes it along without keeping it, but it can see it while it does, and the AI service sees it too. The document itself stays encrypted where it is stored. Koko\'s conversations are kept encrypted with a key only you have.' },
  ocr: { title: 'Send this picture to the AI provider?', label: 'Send it',
    text: 'To read the page, the picture is sent through the server to your AI service. The server passes it along without keeping it, but it can see it while it does, and so can the service. The text that comes back is added to the document, which stays encrypted where it is stored. Reading it on this device sends nothing anywhere.' },
  voice: { title: 'Use voice typing in an encrypted document?', label: 'Use voice typing',
    text: 'To turn speech into text, your recording is sent through the server to the speech service. The server passes it along without keeping it, but it can hear it while it does. What you say is then typed into the document, which stays encrypted where it is stored.' },
}

export async function ensureConsent(w: Via): Promise<boolean> {
  if (hasConsent(w)) return true
  const ok = await askConfirm({ ...WHY[w] })
  if (ok) grantConsent(w)
  return ok
}

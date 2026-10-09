import { useEffect, useReducer } from 'react'
import { toast } from '../ui/Toast'
import type { Call } from './types'

/** Re-render whenever the call changes, and show its short notices as toasts. */
export function useCall(call: Call) {
  const [, force] = useReducer((n: number) => n + 1, 0)
  useEffect(() => call.subscribe(force), [call])
  useEffect(() => call.onNotice((m) => toast(m)), [call])
}

export const hue = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h }
export const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?'
export const canShare = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia

export const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return `${h ? h + ':' : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** The meeting code in whatever someone pasted: the code itself or a whole link. */
export function parseMeetCode(input: string): string | null {
  const m = input.toLowerCase().match(/[a-z2-9]{3}-[a-z2-9]{4}-[a-z2-9]{3}/)
  return m ? m[0] : null
}

export const inviteText = (title: string, code: string, passcode?: string) =>
  `Join my meeting: ${title}\n${location.origin}/m/${code}${passcode ? `\nPasscode: ${passcode}` : ''}`

export function download(name: string, text: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

// Where sound should come out (the speaker picked in the call). Videos listen for changes.
let speaker = ''
const listeners = new Set<() => void>()
export const getSpeaker = () => speaker
export const setSpeaker = (id: string) => { speaker = id; listeners.forEach((f) => f()) }
export const onSpeaker = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f) } }

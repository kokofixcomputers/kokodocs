import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { api } from '../api'
import { toast } from '../ui/Toast'
import { docKeyOf } from '../zk/session'
import { Recorder } from './recorder'

export interface Shortcut { code: string; ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }
export type Phase = 'idle' | 'listening' | 'transcribing'

const KEY = 'koko.voiceShortcut'
const LIVE_KEY = 'koko.voiceLive'
export const loadLive = () => { try { return localStorage.getItem(LIVE_KEY) !== 'off' } catch { return true } }
const MAX_SECONDS = 120
const MIN_SECONDS = 0.4
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const MODIFIER_CODES = /^(Control|Alt|Shift|Meta)(Left|Right)$/

// Hold Right Ctrl. (Rebind from the mic menu if your keyboard has none, e.g. a MacBook.)
export const DEFAULT_SHORTCUT: Shortcut = { code: 'ControlRight', ctrl: false, alt: false, shift: false, meta: false }
const LONE_HOLD_MS = 220 // a bare modifier only starts recording after a short hold, so Right Ctrl+C etc. still work

export function loadShortcut(): Shortcut {
  try { const s = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (s && typeof s.code === 'string') return s } catch { /* default */ }
  return DEFAULT_SHORTCUT
}

const CODE_NAMES: Record<string, string> = { Space: 'Space', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl', AltLeft: isMac ? 'Left ⌥' : 'Left Alt', AltRight: isMac ? 'Right ⌥' : 'Right Alt', ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', MetaLeft: isMac ? 'Left ⌘' : 'Left Win', MetaRight: isMac ? 'Right ⌘' : 'Right Win', Backquote: '`', Backslash: '\\', Slash: '/', Period: '.', Comma: ',' }
export function shortcutLabel(s: Shortcut): string {
  const parts: string[] = []
  if (isMac) { if (s.ctrl) parts.push('⌃'); if (s.alt) parts.push('⌥'); if (s.shift) parts.push('⇧'); if (s.meta) parts.push('⌘') }
  else { if (s.ctrl) parts.push('Ctrl'); if (s.alt) parts.push('Alt'); if (s.shift) parts.push('Shift'); if (s.meta) parts.push('Win') }
  const name = CODE_NAMES[s.code] ?? s.code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow/, '')
  parts.push(name)
  return isMac ? parts.join('') : parts.join(' + ')
}

const modsHeld = (e: KeyboardEvent) => ({ ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey })
function matches(e: KeyboardEvent, s: Shortcut) {
  if (e.code !== s.code) return false
  const lone = MODIFIER_CODES.test(s.code) // a bare modifier like Right Alt: its own modifier flag is set while held
  const m = modsHeld(e)
  if (lone) return true
  return m.ctrl === s.ctrl && m.alt === s.alt && m.shift === s.shift && m.meta === s.meta
}
/** Which physical keys must stay down for the shortcut to stay active. */
function stillHeld(e: KeyboardEvent, s: Shortcut) {
  if (e.code === s.code) return false
  if (MODIFIER_CODES.test(s.code)) return true
  return !((e.key === 'Control' && s.ctrl) || (e.key === 'Alt' && s.alt) || (e.key === 'Shift' && s.shift) || (e.key === 'Meta' && s.meta))
}

/** `fieldsOnly`: for pages with no text editor (boards): dictation starts only while the cursor is in a text box, and goes into it. */
export function useVoiceTyping({ editor, docId, enabled: wanted, fieldsOnly = false }: { editor: Editor | null; docId: string; enabled: boolean; fieldsOnly?: boolean }) {
  const encrypted = !!docKeyOf(docId)   // the recording would have to go to the server to be turned into text
  const enabled = wanted && !encrypted
  const [phase, setPhase] = useState<Phase>('idle')
  const [shortcut, setShortcutState] = useState<Shortcut>(loadShortcut)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [draft, setDraft] = useState('')   // a rough live transcript while the key is held
  const [serverDraft, setServerDraft] = useState(false)   // the server can write previews (small local model, switched on by the admin)
  const [live, setLiveState] = useState(loadLive)          // and this person wants to see them
  const canDraft = serverDraft && live
  const setLive = useCallback((v: boolean) => { setLiveState(v); try { localStorage.setItem(LIVE_KEY, v ? 'on' : 'off') } catch { /* ignore */ } }, [])
  const rec = useRef<Recorder | null>(null)
  const phaseRef = useRef<Phase>('idle')
  const viaKey = useRef(false)
  const pending = useRef<number | undefined>(undefined)
  const timer = useRef<number | undefined>(undefined)
  const setP = (p: Phase) => { phaseRef.current = p; setPhase(p); if (p === 'idle') setDraft('') }

  // Live preview: every moment or so, send the last few seconds to the small local model and show what it heard.
  // It only ever displays; what gets inserted is the better transcript made when you finish. One request at a time, and a
  // failure (model still downloading, server busy) just stops previews for this recording.
  useEffect(() => {
    if (phase !== 'listening' || !canDraft) return
    let stopped = false, busy = false, lastLen = -1
    const ac = new AbortController()
    const tick = async () => {
      const r = rec.current
      if (stopped || busy || !r || r.seconds < 0.8) return
      const wav = r.snapshot(); if (!wav || wav.size === lastLen) return
      lastLen = wav.size; busy = true
      try { const t = (await api.transcribeDraft(docId, wav, ac.signal)).trim(); if (!stopped) setDraft(t) }
      catch { if (!ac.signal.aborted) stopped = true }
      finally { busy = false }
    }
    const id = window.setInterval(() => void tick(), 900)
    return () => { stopped = true; ac.abort(); window.clearInterval(id) }
  }, [phase, canDraft, docId])

  useEffect(() => { api.sttStatus().then((s) => { setAvailable(s.available && !encrypted); setServerDraft(!!s.draft && !encrypted) }).catch(() => setAvailable(false)) }, [encrypted])

  const target = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  /** Type into a plain text field (like the assistant's message box) when that is where the user was focused. */
  const insertIntoField = (el: HTMLInputElement | HTMLTextAreaElement, text: string) => {
    const v = el.value, a = el.selectionStart ?? v.length, b = el.selectionEnd ?? a
    const lead = a > 0 && !/\s/.test(v[a - 1]) && !/^[.,;:!?)\]]/.test(text) ? ' ' : ''
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, v.slice(0, a) + lead + text + ' ' + v.slice(b))
    el.dispatchEvent(new Event('input', { bubbles: true }))
    const pos = a + lead.length + text.length + 1
    el.focus(); el.setSelectionRange(pos, pos)
  }
  const insert = useCallback((text: string) => {
    const t = target.current; target.current = null
    if (t && t.isConnected) { insertIntoField(t, text); return }
    if (!editor || editor.isDestroyed) return
    const { from } = editor.state.selection
    const before = from > 1 ? editor.state.doc.textBetween(Math.max(0, from - 1), from, '\n', ' ') : ''
    const lead = before && !/\s/.test(before) && !/^[.,;:!?)\]]/.test(text) ? ' ' : ''
    editor.chain().focus().insertContent(lead + text + ' ').run()
  }, [editor])

  const stop = useCallback(async (send = true) => {
    const r = rec.current
    if (!r || phaseRef.current !== 'listening') return
    window.clearTimeout(timer.current)
    rec.current = null
    const secs = r.seconds, peak = r.peak
    if (!send || secs < MIN_SECONDS) { r.cancel(); setP('idle'); return }
    setP('transcribing')
    try {
      const wav = await r.finish()
      if (peak < 0.01) { toast("Didn't hear anything. Check your microphone."); return }
      const text = (await api.transcribe(docId, wav)).trim()
      if (!text) toast("Didn't catch that. Try speaking a little closer to the mic.")
      else insert(text)
    } catch (e) {
      toast((e as Error).message || 'Voice typing failed')
    } finally { setP('idle') }
  }, [docId, insert])

  const start = useCallback(async (fromKey: boolean) => {
    if (!enabled || phaseRef.current !== 'idle') return
    if (available === false) { toast("Voice typing isn't set up on this server yet. An admin needs to add a speech provider (see the README)."); return }
    viaKey.current = fromKey
    const ae = document.activeElement
    target.current = (ae instanceof HTMLTextAreaElement || (ae instanceof HTMLInputElement && /^(text|search|url|)$/.test(ae.type))) && !ae.closest('.ProseMirror') && !ae.readOnly ? ae : null
    if (fieldsOnly && !target.current) { if (!fromKey) toast('Click into a text box first, then dictate.'); return }   // nowhere to put the words
    setP('listening')
    const r = new Recorder()
    rec.current = r
    try {
      await r.start()
      if ((phaseRef.current as Phase) !== 'listening') { r.cancel(); return } // released before the mic finished opening
      timer.current = window.setTimeout(() => { toast('Reached the 2 minute limit'); void stop() }, MAX_SECONDS * 1000)
    } catch (e) {
      rec.current = null; r.cancel(); setP('idle')
      const name = (e as DOMException).name
      toast(name === 'NotAllowedError' ? 'Microphone access is blocked. Allow it in your browser’s site settings.' : name === 'NotFoundError' ? 'No microphone found.' : 'Could not start the microphone.')
    }
  }, [enabled, available, stop, fieldsOnly])

  // push-to-talk: hold the shortcut, speak, release
  useEffect(() => {
    if (!enabled || capturing) return
    const lone = MODIFIER_CODES.test(shortcut.code)
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && phaseRef.current === 'listening') { e.preventDefault(); void stop(false); return }
      if (e.repeat) { if (matches(e, shortcut)) e.preventDefault(); return }
      if (matches(e, shortcut)) {
        if (lone) { window.clearTimeout(pending.current); pending.current = window.setTimeout(() => { pending.current = undefined; void start(true) }, LONE_HOLD_MS); return }
        e.preventDefault(); e.stopPropagation(); void start(true)
      } else if (lone && pending.current !== undefined) { window.clearTimeout(pending.current); pending.current = undefined } // part of a normal shortcut
    }
    const up = (e: KeyboardEvent) => {
      if (lone && e.code === shortcut.code && pending.current !== undefined) { window.clearTimeout(pending.current); pending.current = undefined; return }
      if (!viaKey.current || phaseRef.current !== 'listening') return
      if (!stillHeld(e, shortcut)) { e.preventDefault(); void stop(true) }
    }
    const blur = () => { window.clearTimeout(pending.current); pending.current = undefined; if (viaKey.current && phaseRef.current === 'listening') void stop(false) }
    window.addEventListener('keydown', down, true); window.addEventListener('keyup', up, true); window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up, true); window.removeEventListener('blur', blur) }
  }, [enabled, capturing, shortcut, start, stop])

  useEffect(() => () => { window.clearTimeout(timer.current); rec.current?.cancel() }, [])

  /** Click-to-start / click-to-stop for people who can't hold a key (or on touch devices). */
  const toggle = useCallback(() => { if (phaseRef.current === 'listening') void stop(true); else void start(false) }, [start, stop])
  const cancel = useCallback(() => void stop(false), [stop])
  const setShortcut = useCallback((s: Shortcut) => { setShortcutState(s); try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* ignore */ } }, [])

  return { phase, draft, canDraft, serverDraft, live, setLive, shortcut, setShortcut, available, toggle, cancel, capturing, setCapturing, recorder: rec, enabled }
}
export type Voice = ReturnType<typeof useVoiceTyping>

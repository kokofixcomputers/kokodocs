import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, Mic, Keyboard } from 'lucide-react'
import { Popover } from '../ui/Popover'
import { DEFAULT_SHORTCUT, shortcutLabel, type Shortcut, type Voice } from './useVoiceTyping'

const MOD = /^(Control|Alt|Shift|Meta)(Left|Right)$/

/** Press the combination you want to hold. Lone modifiers (like Right Alt) and F-keys work too. */
export function Capture({ onDone, onCancel }: { onDone: (s: Shortcut) => void; onCancel: () => void }) {
  const [pressed, setPressed] = useState<string>('')
  useEffect(() => {
    let lone: string | null = null
    const down = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation()
      if (e.key === 'Escape') { onCancel(); return }
      if (e.repeat) return
      if (MOD.test(e.code)) { lone = e.code; setPressed(e.key); return }
      lone = null
      const s: Shortcut = { code: e.code, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey }
      const fkey = /^F\d{1,2}$/.test(e.code)
      if (!fkey && !(s.ctrl || s.alt || s.meta)) { setPressed('Add Ctrl, Alt or ⌘ so it does not type letters'); return }
      onDone(s)
    }
    const up = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation()
      if (lone && e.code === lone) onDone({ code: lone, ctrl: false, alt: false, shift: false, meta: false })
    }
    window.addEventListener('keydown', down, true); window.addEventListener('keyup', up, true)
    return () => { window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up, true) }
  }, [onDone, onCancel])
  return <div className="vc-capture"><Keyboard size={18} /><b>Press the keys to hold</b><span>{pressed || 'Esc to cancel'}</span></div>
}

export function VoiceControl({ voice, editable }: { voice: Voice; editable: boolean }) {
  const on = voice.phase !== 'idle'
  const unavailable = voice.available === false
  return (
    <Popover className="vc-menu" onOpenChange={(o) => { if (!o) voice.setCapturing(false) }} trigger={({ toggle }) => (
      <button type="button" className={`tb-btn ${on ? 'on' : ''}`} title={`Voice typing (hold ${shortcutLabel(voice.shortcut)})`} aria-label="Voice typing"
        disabled={!editable} onMouseDown={(e) => e.preventDefault()} onClick={toggle}><Mic size={17} /></button>)}>
      {(close) => (
        <div className="vc-body">
          <div className="vc-title"><Mic size={18} /><h4>Voice typing</h4></div>
          {voice.capturing ? (
            <Capture onDone={(s) => { voice.setShortcut(s); voice.setCapturing(false) }} onCancel={() => voice.setCapturing(false)} />
          ) : (
            <>
              <p className="vc-hint">Hold <kbd>{shortcutLabel(voice.shortcut)}</kbd>, speak, then let go. What you said is typed at the cursor.</p>
              {unavailable && <p className="vc-warn"><AlertCircle size={16} />Voice typing isn't set up on this server. An admin needs to add a speech provider (see the README).</p>}
              <button className="btn btn-pill btn-primary btn-sm vc-main" disabled={unavailable} onClick={() => { close(); voice.toggle() }}>{on ? 'Stop and insert' : 'Start dictating'}</button>
              {voice.serverDraft && (
                <label className="vc-live"><input type="checkbox" checked={voice.live} onChange={(e) => voice.setLive(e.target.checked)} /><span><b>Show words while I speak</b><em>A quick preview in the pill. The final text is still the more accurate version.</em></span></label>)}
              <div className="vc-row">
                <button className="vc-link" onClick={() => voice.setCapturing(true)}>Change shortcut</button>
                {shortcutLabel(voice.shortcut) !== shortcutLabel(DEFAULT_SHORTCUT) && <button className="vc-link" onClick={() => voice.setShortcut(DEFAULT_SHORTCUT)}>Reset</button>}
              </div>
            </>
          )}
        </div>)}
    </Popover>
  )
}

/** Phones have no push-to-talk key, so a floating mic button starts and stops dictation with a tap. */
export function VoiceFab({ voice, editable }: { voice: Voice; editable: boolean }) {
  if (!editable || voice.phase !== 'idle' || voice.available === false) return null
  // portalled: React must not insert/remove siblings next to the editor's floating menus, which move their own DOM nodes
  return createPortal(<button type="button" className="voice-fab" aria-label="Start voice typing" onMouseDown={(e) => e.preventDefault()} onClick={() => voice.toggle()}><Mic size={22} /></button>, document.body)
}

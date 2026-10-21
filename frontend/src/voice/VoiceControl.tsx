import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, ChevronDown, Mic, Keyboard } from 'lucide-react'
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
    <>
      <button type="button" className={`tb-btn ${on ? 'on' : ''}`} title={on ? 'Stop dictating' : `Dictate: click and talk (or hold ${shortcutLabel(voice.shortcut)})`} aria-label={on ? 'Stop voice typing' : 'Start voice typing'} aria-pressed={on}
        disabled={!editable || unavailable} onMouseDown={(e) => e.preventDefault()} onClick={() => voice.toggle()}><Mic size={17} /></button>
      <Popover className="vc-menu" onOpenChange={(o) => { if (!o) voice.setCapturing(false) }} trigger={({ toggle }) => (
        <button type="button" className="tb-btn vc-more" title="Voice typing options" aria-label="Voice typing options" disabled={!editable} onMouseDown={(e) => e.preventDefault()} onClick={toggle}><ChevronDown size={14} /></button>)}>
        {() => (
          <div className="vc-body">
            <div className="vc-title"><Mic size={18} /><h4>Voice typing</h4></div>
            {voice.capturing ? (
              <Capture onDone={(s) => { voice.setShortcut(s); voice.setCapturing(false) }} onCancel={() => voice.setCapturing(false)} />
            ) : (
              <>
                <p className="vc-hint">Click the microphone and just talk: your words appear in the page at the cursor each time you pause. Click it again (or press Esc) to stop. You can also hold <kbd>{shortcutLabel(voice.shortcut)}</kbd> while you speak.</p>
                {unavailable && <p className="vc-warn"><AlertCircle size={16} />Voice typing isn't set up on this server. An admin needs to add a speech provider (see the README).</p>}
                {voice.serverDraft && (
                  <div className="vc-live"><span><b>Show words as I speak</b><em>Draws a quick guess in the page while you are still talking. Each phrase is replaced by the more accurate text when you pause.</em></span><button type="button" role="switch" aria-checked={voice.live} aria-label="Show words as I speak" className={`toggle ${voice.live ? 'on' : ''}`} onClick={() => voice.setLive(!voice.live)}><i /></button></div>)}
                <div className="vc-row">
                  <button className="vc-link" onClick={() => voice.setCapturing(true)}>Change shortcut</button>
                  {shortcutLabel(voice.shortcut) !== shortcutLabel(DEFAULT_SHORTCUT) && <button className="vc-link" onClick={() => voice.setShortcut(DEFAULT_SHORTCUT)}>Reset</button>}
                </div>
              </>
            )}
          </div>)}
      </Popover>
    </>
  )
}

/** Phones have no push-to-talk key, so a floating mic button starts and stops dictation with a tap. */
export function VoiceFab({ voice, editable }: { voice: Voice; editable: boolean }) {
  const shown = editable && voice.phase === 'idle' && voice.available !== false
  // a class on the page, so the zoom pill can move aside (a :has() selector on the root would be re-checked on every keystroke, and has crashed Safari)
  useEffect(() => { if (!shown) return; const r = document.documentElement; r.classList.add('has-voice-fab'); return () => r.classList.remove('has-voice-fab') }, [shown])
  if (!shown) return null
  // portalled: React must not insert/remove siblings next to the editor's floating menus, which move their own DOM nodes
  return createPortal(<button type="button" className="voice-fab" aria-label="Start voice typing" onMouseDown={(e) => e.preventDefault()} onClick={() => voice.toggle()}><Mic size={22} /></button>, document.body)
}

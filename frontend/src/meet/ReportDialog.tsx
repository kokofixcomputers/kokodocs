import { useEffect, useState } from 'react'
import { Copy } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { toast } from '../ui/Toast'
import type { Call } from './types'

/** What the video tiles on this page are doing right now (is each one playing, with a picture, with sound, and is something drawn over it). */
function tiles(): string {
  return [...document.querySelectorAll<HTMLElement>('.meet-tile')].map((t) => {
    const v = t.querySelector('video')
    const who = t.querySelector('.meet-label')?.textContent?.trim() ?? '?'
    const tr = v?.srcObject instanceof MediaStream ? v.srcObject.getTracks().map((k) => `${k.kind} ${k.readyState}${k.muted ? ' muted' : ''}`).join(', ') : 'no stream'
    const over = ['.meet-netfail', '.meet-blackcam', '.meet-connecting'].filter((s) => t.querySelector(s)).join(' ')
    return `${who}: ${v ? `${v.videoWidth}x${v.videoHeight}, ${v.paused ? 'PAUSED' : 'playing'}, ${v.muted ? 'muted' : `volume ${v.volume}`}, ${v.classList.contains('off') ? 'hidden (camera off)' : 'shown'}` : 'no video element'}; tracks: ${tr}${over ? `; covered by ${over}` : ''}`
  }).join('\n')
}

export function ReportDialog({ call, onClose }: { call: Call; onClose: () => void }) {
  const [text, setText] = useState('Collecting…')
  useEffect(() => {
    let dead = false
    call.report().then((r) => { if (!dead) setText(`${r}\n\nVideo tiles on this page:\n${tiles()}`) }).catch((e) => setText(`Could not collect the report: ${(e as Error).message}`))
    return () => { dead = true }
  }, [call])
  return (
    <Modal title="Connection details" onClose={onClose} width={640}>
      <div className="share-body">
        <p className="muted small">If calls aren't working, copy this and send it to whoever is helping. It has no passwords and no call content.</p>
        <pre className="meet-report">{text}</pre>
        <div className="modal-actions"><button className="btn btn-pill btn-ghost" onClick={onClose}>Close</button>
          <button className="btn btn-pill btn-primary" onClick={() => { void navigator.clipboard.writeText(text).then(() => toast('Copied')).catch(() => toast('Select the text and copy it')) }}><Copy size={15} />Copy</button></div>
      </div>
    </Modal>)
}

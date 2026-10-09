import { Circle } from 'lucide-react'
import { Modal } from '../ui/Modal'

/** "This meeting is being recorded. Do you agree?" Shown before joining a meeting that is already being recorded, and to everyone in the meeting when a
 *  recording starts. It can't be closed without answering. When everyone must agree, saying no means leaving. */
export function ConsentModal({ by, required, again, onAnswer }: { by?: string; required: boolean; again?: boolean; onAnswer: (agree: boolean) => void }) {
  return (
    <Modal title="This meeting is being recorded" onClose={() => {}} width={460}>
      <div className="share-body meet-consent">
        <p className="rec-line"><Circle size={12} fill="currentColor" />{by ? `${by} is recording this meeting.` : 'This meeting is being recorded.'}</p>
        <p>If you agree, your video and your voice are in the recording. It is saved to the host's storage, and the host decides who can see it.{again ? ' You can change your answer at any time.' : ''}</p>
        {required
          ? <p><b>The host requires everyone to agree.</b> If you don't, you'll be removed from the meeting.</p>
          : <p>If you don't agree you can stay in the meeting, but your video and your voice are left out of the recording.</p>}
        <div className="modal-actions">
          <button className={`btn btn-pill ${required ? 'btn-danger' : 'btn-ghost'}`} onClick={() => onAnswer(false)}>{required ? "Don't agree and leave" : "Don't agree"}</button>
          <button className="btn btn-pill btn-primary" autoFocus onClick={() => onAnswer(true)}>Agree</button>
        </div>
      </div>
    </Modal>)
}

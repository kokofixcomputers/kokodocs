import { useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Pause, Play, SkipBack, SkipForward, Square, Volume2, X, Minus, Plus, Loader2 } from 'lucide-react'
import { Popover } from '../ui/Popover'
import { Select } from '../ui/Select'
import { bestVoice, chooseVoice, chosenVoice, reader, voices } from './reader'
import { NEURAL_VOICES, neuralChosen, neuralVoice, setNeuralChosen, setNeuralVoice } from './neural'
import './tts.css'

const useReader = () => useSyncExternalStore(reader.subscribe, reader.getSnapshot)

/** The "read aloud" button for the top bar of a document or wiki. `plain`: this document is encrypted, so its text stays on this device (the device's own voice). */
export function ReadAloud({ plain }: { plain: boolean }) {
  const s = useReader()
  const on = s.phase !== 'idle'
  const [list, setList] = useState(voices())
  const [neural, setNeural] = useState(neuralChosen())
  const [nv, setNv] = useState(neuralVoice())
  useEffect(() => {
    if (typeof speechSynthesis === 'undefined') return
    const f = () => setList(voices()); speechSynthesis.addEventListener?.('voiceschanged', f); f()
    return () => speechSynthesis.removeEventListener?.('voiceschanged', f)
  }, [])
  useEffect(() => () => reader.stop(), [])   // leaving the page ends the reading
  const lang = (document.documentElement.lang || navigator.language || 'en').slice(0, 2).toLowerCase()
  const mine = list.filter((v) => v.lang.toLowerCase().startsWith(lang))
  const shown = mine.length ? mine : list   // (no voice for this language: show them all)
  const cur = chosenVoice() || bestVoice(lang)?.voiceURI || ''
  const mac = /Mac/.test(navigator.platform)
  return (
    <Popover className="tts-menu" trigger={({ toggle }) => (
      <button type="button" className={`icon-btn ${on ? 'active' : ''}`} title="Read aloud" aria-label="Read aloud" onMouseDown={(e) => e.preventDefault()} onClick={toggle}><Volume2 size={19} /></button>)}>
      {(close) => (
        <div className="tts-body">
          <div className="tts-title"><Volume2 size={18} /><h4>Read aloud</h4></div>
          <p className="tts-hint">Reads the page, or just what you have selected{plain ? ', using your device’s own voice (encrypted documents never leave it)' : ''}.</p>
          <button type="button" className="btn btn-primary btn-pill tts-go" onMouseDown={(e) => e.preventDefault()} onClick={() => { close(); if (on) reader.stop(); else void reader.start({ plain }) }}>
            {on ? <><Square size={15} />Stop reading</> : <><Play size={15} />Start reading</>}</button>
          <div className="tts-field"><span>Voice</span>
            <Select label="Kind of voice" value={neural ? 'neural' : 'device'} onChange={(v) => { setNeural(v === 'neural'); setNeuralChosen(v === 'neural'); if (on) reader.stop() }}
              options={[{ value: 'device', label: 'This device’s voices' }, { value: 'neural', label: 'Neural voice (English, natural)' }]} /></div>
          {neural ? (
            <>
              <div className="tts-field"><span>Neural voice</span>
                <Select label="Neural voice" value={nv} options={NEURAL_VOICES.map((v) => ({ value: v.id, label: v.label }))} onChange={(v) => { setNv(v); setNeuralVoice(v); if (on) reader.stop() }} /></div>
              <p className="tts-hint small">Runs on this device and works offline. The first time it downloads the voice (about 90 MB); after that it starts right away. Other languages are read with the device’s voices.</p>
            </>
          ) : (
            <>
              {shown.length > 0 && <div className="tts-field"><span>Device voice</span>
                <Select label="Voice" value={cur} options={shown.map((v) => ({ value: v.voiceURI, label: `${v.name}${v.localService ? '' : ' (online)'}` }))} onChange={(v) => chooseVoice(v)} /></div>}
              <p className="tts-hint small">{mac ? 'Plainer voices like Samantha are the system default. For a better one, download a Premium or Enhanced voice in System Settings → Accessibility → Spoken Content → System Voice → Manage Voices, or use the neural voice above.' : 'The voices come from your system, so the quality depends on it. The neural voice above sounds more natural.'}</p>
            </>)}
        </div>)}
    </Popover>
  )
}

/** The floating pill while something is being read: play or pause, a sentence back and forward, slower and faster. */
export function TtsPill() {
  const s = useReader()
  if (s.phase === 'idle') return null
  const n = Math.min(s.total, s.index + 1)
  return createPortal(
    <div className="tts-pill" role="region" aria-label="Reading aloud">
      <span className="tp-btns">
        <button type="button" aria-label="Previous sentence" title="Previous sentence" onMouseDown={(e) => e.preventDefault()} onClick={() => reader.skip(-1)}><SkipBack size={17} /></button>
        <button type="button" className="main" aria-label={s.phase === 'paused' ? 'Play' : 'Pause'} title={s.phase === 'paused' ? 'Play' : 'Pause'} onMouseDown={(e) => e.preventDefault()} onClick={() => reader.toggle()}>
          {s.phase === 'loading' ? <Loader2 size={20} className="spin" /> : s.phase === 'paused' ? <Play size={20} /> : <Pause size={20} />}</button>
        <button type="button" aria-label="Next sentence" title="Next sentence" onMouseDown={(e) => e.preventDefault()} onClick={() => reader.skip(1)}><SkipForward size={17} /></button>
      </span>
      <span className="tp-speed">
        <button type="button" aria-label="Slower" title="Slower" onMouseDown={(e) => e.preventDefault()} onClick={() => reader.slower()}><Minus size={15} /></button>
        <b>{s.rate.toFixed(s.rate % 1 === 0 ? 1 : 2).replace(/0$/, '')}×</b>
        <button type="button" aria-label="Faster" title="Faster" onMouseDown={(e) => e.preventDefault()} onClick={() => reader.faster()}><Plus size={15} /></button>
      </span>
      <span className="tp-text"><b>{s.phase === 'paused' ? 'Paused' : s.note || 'Reading aloud'}</b><em>{n} of {s.total}</em></span>
      <button type="button" className="tp-x" aria-label="Stop" title="Stop" onMouseDown={(e) => e.preventDefault()} onClick={() => reader.stop()}><X size={18} /></button>
    </div>, document.body)
}

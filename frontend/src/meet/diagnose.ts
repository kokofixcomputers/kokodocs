import { useEffect, useRef, useState } from 'react'

/** Is the camera sending a black picture? (The wrong camera, such as an infrared one that some laptops list first; a covered lens; or a camera another app has.)
 *  Looks at a few frames from the live video and says yes only if every one of them is black. */
export function useBlackCamera(stream: MediaStream | null): boolean {
  const [black, setBlack] = useState(false)
  const track = stream?.getVideoTracks()[0] ?? null
  useEffect(() => {
    setBlack(false)
    if (!track || track.readyState !== 'live') return
    const v = document.createElement('video')
    v.muted = true; v.playsInline = true; v.srcObject = new MediaStream([track]); void v.play().catch(() => {})
    const c = document.createElement('canvas'); c.width = 32; c.height = 18
    const g = c.getContext('2d', { willReadFrequently: true })
    let seen = 0, dark = 0
    const t = setInterval(() => {
      if (!g || v.readyState < 2 || !v.videoWidth) return
      g.drawImage(v, 0, 0, 32, 18)
      const d = g.getImageData(0, 0, 32, 18).data
      let sum = 0, peak = 0
      for (let i = 0; i < d.length; i += 4) { const l = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; sum += l; if (l > peak) peak = l }
      seen++
      if (sum / (d.length / 4) < 2.5 && peak < 20) dark++; else { dark = 0; setBlack(false) }
      if (seen >= 5 && dark >= 5) setBlack(true)
    }, 500)
    return () => { clearInterval(t); v.srcObject = null }
  }, [track])
  return black
}

/** How loud the microphone is right now (0 to 1), and whether it has stayed silent for a few seconds since it was turned on. */
export function useMicLevel(track: MediaStreamTrack | null): { level: number; silent: boolean } {
  const [state, setState] = useState({ level: 0, silent: false })
  const heard = useRef(false)
  useEffect(() => {
    heard.current = false
    setState({ level: 0, silent: false })
    if (!track || track.readyState !== 'live') return
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    let ctx: AudioContext | null = null
    try {
      ctx = new AC()
      const an = ctx.createAnalyser(); an.fftSize = 512
      ctx.createMediaStreamSource(new MediaStream([track])).connect(an)
      const buf = new Uint8Array(an.fftSize)
      const started = Date.now()
      const t = setInterval(() => {
        an.getByteTimeDomainData(buf)
        let peak = 0
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128))
        const level = Math.min(1, peak / 60)
        if (level > 0.04) heard.current = true
        setState((s) => (Math.abs(s.level - level) < 0.03 && s.silent === (!heard.current && Date.now() - started > 4000) ? s : { level, silent: !heard.current && Date.now() - started > 4000 }))
      }, 100)
      return () => { clearInterval(t); void ctx?.close() }
    } catch { void ctx?.close(); return }
  }, [track])
  return state
}

/** Choose the next camera in the list (for a one-click "try another camera"). */
export async function nextCamera(currentId: string): Promise<string | null> {
  try {
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput')
    if (cams.length < 2) return null
    const i = cams.findIndex((c) => c.deviceId === currentId)
    return cams[(i + 1) % cams.length].deviceId
  } catch { return null }
}

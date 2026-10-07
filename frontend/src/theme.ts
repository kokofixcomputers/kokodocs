import { useCallback, useEffect, useState } from 'react'

/** What the person chose. "system" follows the device, and is what you get until you pick light or dark. */
export type ThemePref = 'light' | 'dark' | 'system'
const KEY = 'koko.theme'

const readPref = (): ThemePref => {
  try { const s = localStorage.getItem(KEY); if (s === 'light' || s === 'dark' || s === 'system') return s } catch { /* private mode */ }
  return 'system'
}
const systemDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches

export function useTheme() {
  const [pref, setPrefState] = useState<ThemePref>(readPref)
  const [sysDark, setSysDark] = useState(systemDark)
  const theme: 'light' | 'dark' = pref === 'system' ? (sysDark ? 'dark' : 'light') : pref

  useEffect(() => {
    const sync = () => setPrefState(readPref())
    window.addEventListener('koko:theme', sync)
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const onSys = (e: MediaQueryListEvent) => setSysDark(e.matches)
    mq.addEventListener('change', onSys)
    return () => { window.removeEventListener('koko:theme', sync); mq.removeEventListener('change', onSys) }
  }, [])
  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])

  const setPref = useCallback((p: ThemePref) => {
    try { localStorage.setItem(KEY, p) } catch { /* private mode */ }
    setPrefState(p)
    window.dispatchEvent(new Event('koko:theme'))
  }, [])
  /** The sun/moon button: flips between light and dark (an explicit choice, so it stops following the system). */
  const toggle = useCallback(() => setPref(theme === 'light' ? 'dark' : 'light'), [theme, setPref])
  return { theme, pref, setPref, toggle }
}

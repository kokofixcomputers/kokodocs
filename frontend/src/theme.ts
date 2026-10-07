import { useEffect, useState } from 'react'

type Theme = 'light' | 'dark'
const get = (): Theme => {
  const s = localStorage.getItem('koko.theme') as Theme | null
  return s ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
}
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(get)
  useEffect(() => {
    const sync = () => setTheme(get())
    window.addEventListener('koko:theme', sync)
    return () => window.removeEventListener('koko:theme', sync)
  }, [])
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('koko.theme', theme)
    window.dispatchEvent(new Event('koko:theme'))
  }, [theme])
  return { theme, setTheme, toggle: () => setTheme((t) => (t === 'light' ? 'dark' : 'light')) }
}

import { useEffect, useState } from 'react'
import { Info } from 'lucide-react'

export function Toaster() {
  const [items, setItems] = useState<{ id: number; text: string }[]>([])
  useEffect(() => {
    const on = (e: Event) => {
      const id = Math.random()
      setItems((l) => [...l, { id, text: String((e as CustomEvent).detail) }])
      setTimeout(() => setItems((l) => l.filter((i) => i.id !== id)), 4000)
    }
    window.addEventListener('koko:toast', on)
    return () => window.removeEventListener('koko:toast', on)
  }, [])
  return (
    <div className="toasts">
      {items.map((i) => <div key={i.id} className="toast"><Info size={16} />{i.text}</div>)}
    </div>
  )
}
export const toast = (text: string) => window.dispatchEvent(new CustomEvent('koko:toast', { detail: text }))

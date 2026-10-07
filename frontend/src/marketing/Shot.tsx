import { ShieldCheck } from 'lucide-react'

/** Product screenshots live in /public/shots as <name>.jpg and <name>-dark.jpg; the one that matches the theme is shown. */
const SIZE: Record<string, [number, number]> = {
  'voice-typing': [760, 440], dashboard: [2160, 1650], wiki: [2160, 1725], 'phone-doc': [975, 2110], 'phone-dashboard': [975, 2110],
}
const dims = (n: string) => SIZE[n] ?? [2160, 1350]

export function Shot({ name, alt, eager = false, ext = 'jpg' }: { name: string; alt: string; eager?: boolean; ext?: 'jpg' | 'gif' }) {
  const [w, h] = dims(name)
  return (
    <>
      <img className="shot shot-light" src={`/shots/${name}.${ext}`} alt={alt} width={w} height={h} loading={eager ? 'eager' : 'lazy'} decoding="async" />
      <img className="shot shot-dark" src={`/shots/${name}-dark.${ext}`} alt={alt} width={w} height={h} loading={eager ? 'eager' : 'lazy'} decoding="async" />
    </>
  )
}

/** A browser window around a screenshot. */
export function Frame({ name, alt, url = 'docs.example.com', eager, ext }: { name: string; alt: string; url?: string; eager?: boolean; ext?: 'jpg' | 'gif' }) {
  return (
    <div className="win" role="figure" aria-label={alt}>
      <div className="win-bar"><span className="dots"><i /><i /><i /></span><span className="win-url"><ShieldCheck size={12} />{url}</span><span className="win-gap" /></div>
      <div className="win-body"><Shot name={name} alt={alt} eager={eager} ext={ext} /></div>
    </div>
  )
}

/** A phone around a screenshot. */
export function Phone({ name, alt }: { name: string; alt: string }) {
  return <div className="phone" role="figure" aria-label={alt}><div className="phone-screen"><Shot name={name} alt={alt} /></div></div>
}

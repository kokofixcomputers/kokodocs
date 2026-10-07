import { ShieldCheck } from 'lucide-react'

/** Product screenshots live in /public/shots as <name>.jpg and <name>-dark.jpg; the one that matches the theme is shown. */
const SIZE: Record<string, [number, number]> = {
  dashboard: [2160, 1650], wiki: [2160, 1725], 'phone-doc': [975, 2110], 'phone-dashboard': [975, 2110],
}
const dims = (n: string) => SIZE[n] ?? [2160, 1350]

export function Shot({ name, alt, eager = false }: { name: string; alt: string; eager?: boolean }) {
  const [w, h] = dims(name)
  return (
    <>
      <img className="shot shot-light" src={`/shots/${name}.jpg`} alt={alt} width={w} height={h} loading={eager ? 'eager' : 'lazy'} decoding="async" />
      <img className="shot shot-dark" src={`/shots/${name}-dark.jpg`} alt={alt} width={w} height={h} loading={eager ? 'eager' : 'lazy'} decoding="async" />
    </>
  )
}

/** A browser window around a screenshot. */
export function Frame({ name, alt, url = 'docs.example.com', eager }: { name: string; alt: string; url?: string; eager?: boolean }) {
  return (
    <div className="win" role="figure" aria-label={alt}>
      <div className="win-bar"><span className="dots"><i /><i /><i /></span><span className="win-url"><ShieldCheck size={12} />{url}</span><span className="win-gap" /></div>
      <div className="win-body"><Shot name={name} alt={alt} eager={eager} /></div>
    </div>
  )
}

/** A phone around a screenshot. */
export function Phone({ name, alt }: { name: string; alt: string }) {
  return <div className="phone" role="figure" aria-label={alt}><div className="phone-screen"><Shot name={name} alt={alt} /></div></div>
}

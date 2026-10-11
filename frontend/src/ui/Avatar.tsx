import { useEffect, useState } from 'react'

/** Only our own picture addresses are ever drawn (a name or colour travels between people, so an address could too). */
const OK = /^\/api\/avatars\/[A-Za-z0-9]+\?v=\d+$/

export function Avatar({ name, color, size = 30, ring, src }: { name: string; color?: string; size?: number; ring?: boolean; src?: string | null }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?'
  const [bad, setBad] = useState(false)
  useEffect(() => { setBad(false) }, [src])
  const pic = src && OK.test(src) && !bad ? src : null
  return (
    <span className={`avatar ${ring ? 'ring' : ''} ${pic ? 'has-pic' : ''}`} title={name} data-tip={name}
      style={{ width: size, height: size, background: color, fontSize: size * 0.4 }}>
      {pic ? <img src={pic} alt="" width={size} height={size} draggable={false} onError={() => setBad(true)} /> : initials}
    </span>
  )
}

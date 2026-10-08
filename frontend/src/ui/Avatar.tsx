export function Avatar({ name, color, size = 30, ring }: { name: string; color: string; size?: number; ring?: boolean }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?'
  return (
    <span className={`avatar ${ring ? 'ring' : ''}`} title={name} data-tip={name}
      style={{ width: size, height: size, background: color, fontSize: size * 0.4 }}>{initials}</span>
  )
}

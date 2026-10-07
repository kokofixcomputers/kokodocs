import { FileText } from 'lucide-react'
export function Logo({ size = 34 }: { size?: number }) {
  return (
    <span className="logo-mark" style={{ width: size, height: size, borderRadius: size * 0.32 }}>
      <FileText size={size * 0.56} strokeWidth={2.4} />
    </span>
  )
}

import { useEffect, useMemo, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { Clock3, Gauge, Mic } from 'lucide-react'
import { api, type Version } from '../api'
import { analyse, type Insights } from './insights'

const textBlocks = (editor: Editor): string[] => {
  const out: string[] = []
  editor.state.doc.descendants((n) => {
    if (n.type.name === 'codeBlock') return false
    if (n.isTextblock) { out.push(n.textBetween(0, n.content.size, ' ', ' ')); return false }
    return true
  })
  return out
}

const hue = (v: number) => `hsl(${Math.round(clamp(v) * 1.2)} 70% 46%)`   // 0 red … 120 green
const clamp = (v: number) => Math.max(0, Math.min(100, v))

/** A ring that fills to `value` (0–100). */
function Ring({ value, size = 112, stroke = 11, color, children }: { value: number; size?: number; stroke?: number; color?: string; children: React.ReactNode }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, v = clamp(value)
  return (
    <div className="ins-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color ?? hue(v)} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${(c * v) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dasharray .6s ease, stroke .6s' }} />
      </svg>
      <div className="ins-ring-in">{children}</div>
    </div>
  )
}

function Spark({ points }: { points: number[] }) {
  if (points.length < 2) return <p className="ins-muted">Save a few versions and the trend will draw here.</p>
  const w = 260, h = 64, max = Math.max(...points, 1), min = Math.min(...points, 0)
  const x = (i: number) => (i / (points.length - 1)) * (w - 8) + 4, y = (v: number) => h - 6 - ((v - min) / Math.max(1, max - min)) * (h - 14)
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(' ')
  return (
    <svg className="ins-spark" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Word count over ${points.length} versions`}>
      <polygon points={`4,${h - 4} ${line} ${w - 4},${h - 4}`} fill="var(--accent-soft)" />
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(points.length - 1)} cy={y(points[points.length - 1])} r="3.5" fill="currentColor" />
    </svg>
  )
}

const fmtMin = (m: number) => (m < 1 ? '<1 min' : `${Math.round(m)} min`)

export function InsightsPanel({ editor, docId, refreshKey }: { editor: Editor; docId: string; refreshKey: number }) {
  const [res, setRes] = useState<Insights>(() => analyse(textBlocks(editor)))
  const [versions, setVersions] = useState<Version[] | null>(null)
  useEffect(() => {
    let t: number | undefined
    const run = () => { window.clearTimeout(t); t = window.setTimeout(() => setRes(analyse(textBlocks(editor))), 500) }
    editor.on('update', run); run()
    return () => { editor.off('update', run); window.clearTimeout(t) }
  }, [editor])
  useEffect(() => { let dead = false; api.listVersions(docId).then((v) => { if (!dead) setVersions(v) }).catch(() => { if (!dead) setVersions([]) }); return () => { dead = true } }, [docId, refreshKey])

  const trend = useMemo(() => [...(versions ?? [])].sort((a, b) => a.created_at - b.created_at).slice(-30).map((v) => v.words), [versions])
  const trendAll = [...trend, res.words]
  const delta = trend.length ? res.words - trend[0] : 0
  const empty = res.words < 10
  const sent = clamp((res.sentiment + 1) * 50)
  const maxB = Math.max(1, ...res.buckets)

  return (
    <div className="side-body ins">
      <div className="side-title"><Gauge size={18} /><h3>Insights</h3></div>
      {empty ? <p className="side-empty">Write a few sentences and your scores will appear here.</p> : (
        <>
          <div className="ins-hero">
            <Ring value={res.score} size={150} stroke={14}><b className="ins-big">{res.score}</b><span>Writing score</span></Ring>
            <p className="ins-hero-note">{res.score >= 75 ? 'Clear and easy to follow.' : res.score >= 55 ? 'Solid. A few shorter sentences would help.' : 'Dense in places. Try shorter sentences and simpler words.'}</p>
          </div>
          <div className="ins-rings">
            <div className="ins-card"><Ring value={res.ease}><b>{res.ease}</b></Ring><h4>Readability</h4><span>{res.easeLabel} · grade {res.grade}</span></div>
            <div className="ins-card"><Ring value={sent} color={`hsl(${Math.round(sent * 1.2)} 65% 48%)`}><b>{res.sentiment > 0 ? '+' : ''}{Math.round(res.sentiment * 100)}</b></Ring><h4>Tone</h4><span>{res.sentimentLabel}</span></div>
            <div className="ins-card"><Ring value={res.variety}><b>{res.variety}</b></Ring><h4>Variety</h4><span>{res.unique.toLocaleString()} different words</span></div>
          </div>
          <div className="ins-tiles">
            <div><b>{res.words.toLocaleString()}</b><span>words</span></div>
            <div><b>{res.sentences.toLocaleString()}</b><span>sentences</span></div>
            <div><b>{res.avgSentence}</b><span>words per sentence</span></div>
            <div><b>{res.longSentences}</b><span>very long sentences</span></div>
          </div>
          <div className="ins-times"><span><Clock3 size={15} />{fmtMin(res.readMin)} to read</span><span><Mic size={15} />{fmtMin(res.speakMin)} to say</span></div>
          <h4 className="ins-h">Sentence lengths</h4>
          <div className="ins-bars" role="img" aria-label="How many sentences are short, medium, long and very long">
            {(['1–10', '11–20', '21–30', '31+'] as const).map((l, i) => (
              <div key={l} className="ins-bar"><i style={{ height: `${(res.buckets[i] / maxB) * 100}%`, background: i === 3 ? 'hsl(8 70% 52%)' : i === 2 ? 'hsl(38 85% 50%)' : 'hsl(140 55% 42%)' }} /><b>{res.buckets[i]}</b><span>{l}</span></div>
            ))}
          </div>
          <h4 className="ins-h">Word count over time</h4>
          <Spark points={trendAll} />
          {trend.length > 0 && <p className="ins-muted">{delta === 0 ? 'The same as your earliest saved version.' : `${delta > 0 ? '+' : '−'}${Math.abs(delta).toLocaleString()} words since your earliest saved version.`}</p>}
          {res.top.length > 0 && (<><h4 className="ins-h">Words you lean on</h4><div className="ins-words">{res.top.map((t) => <span key={t.word}>{t.word}<em>{t.n}</em></span>)}</div></>)}
        </>
      )}
    </div>
  )
}

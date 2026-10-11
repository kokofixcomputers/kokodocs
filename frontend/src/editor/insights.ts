/** Writing analysis that runs in the browser: nothing about the text leaves the page. */
export interface Insights {
  words: number; sentences: number; paragraphs: number; chars: number
  ease: number; grade: number; easeLabel: string
  sentiment: number; sentimentLabel: string; pos: number; neg: number
  variety: number; unique: number
  avgSentence: number; longSentences: number; buckets: number[]
  readMin: number; speakMin: number
  top: { word: string; n: number }[]
  score: number
}

const STOP = new Set(('a an and are as at be been but by can could did do does for from had has have he her his how i if in into is it its just may me more my no not of on one or our out she so some than that the their them then there these they this to too up us was we were what when which who will with would you your about after all also any because both each few get got him over said same should such very while where why').split(' '))
const POS = new Set(('good great excellent amazing awesome wonderful fantastic love loved lovely like liked best better happy glad joy joyful pleased delighted pleasant nice beautiful brilliant perfect success successful succeed win won winning positive benefit benefits helpful help improve improved improvement strong stronger easy fun enjoy enjoyed exciting excited hope hopeful proud thank thanks grateful welcome safe secure clear clean fast efficient reliable trust valuable worth recommend impressive outstanding superb ideal smooth growth gain gains progress opportunity opportunities agree congratulations celebrate cheerful bright calm confident creative elegant fresh generous gentle healthy honest kind lucky peace powerful rich simple support supported stable thrive').split(' '))
const NEG = new Set(('bad terrible awful horrible worst worse sad unhappy angry upset hate hated dislike poor fail failed failure failing lose lost loss problem problems issue issues bug bugs broken wrong error errors mistake mistakes difficult hard hardly slow weak painful pain hurt harm risk risks danger dangerous threat fear afraid worry worried concern concerns doubt trouble crisis disaster useless boring annoying confusing confused unclear messy dirty unsafe insecure expensive costly delay delayed late reject rejected refuse refused deny denied complaint complain stress stressful tired exhausted ugly nasty cruel angry blame guilty shame sorry unfortunately impossible lack lacking missing negative decline drop dropped crash crashed violation fraud attack abuse conflict fight war death dead kill').split(' '))
const NEGATORS = new Set(["not", "no", "never", "n't", "without", "hardly", "cannot", "dont", "doesnt", "isnt", "wasnt", "wont", "cant", "didnt", "arent"])

export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '')
  if (!w) return 0
  if (w.length <= 3) return 1
  const m = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '').match(/[aeiouy]{1,2}/g)
  return Math.max(1, m ? m.length : 1)
}

const easeLabel = (e: number) => e >= 90 ? 'Very easy' : e >= 80 ? 'Easy' : e >= 70 ? 'Fairly easy' : e >= 60 ? 'Plain English' : e >= 50 ? 'Fairly hard' : e >= 30 ? 'Hard' : 'Very hard'
const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v))

export function analyse(paragraphs: string[]): Insights {
  const text = paragraphs.join('\n')
  const sentences = paragraphs.flatMap((p) => p.split(/(?<=[.!?…])\s+|\n+/)).map((s) => s.trim()).filter((s) => /[\p{L}\p{N}]/u.test(s))
  const tokens = (text.toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu) ?? []).map((t) => t.replace(/’/g, "'"))
  const words = tokens.length
  const syl = tokens.reduce((n, t) => n + syllables(t), 0)
  const sLens = sentences.map((s) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).length)
  const avgSentence = sentences.length ? words / sentences.length : 0
  const ease = words < 3 ? 0 : clamp(206.835 - 1.015 * avgSentence - 84.6 * (syl / words))
  const grade = words < 3 ? 0 : Math.max(0, 0.39 * avgSentence + 11.8 * (syl / words) - 15.59)

  let pos = 0, neg = 0
  tokens.forEach((t, i) => {
    const flip = NEGATORS.has(tokens[i - 1]) || NEGATORS.has(tokens[i - 2])
    if (POS.has(t)) flip ? neg++ : pos++
    else if (NEG.has(t)) flip ? pos++ : neg++
  })
  const evidence = pos + neg
  const sentiment = evidence ? ((pos - neg) / evidence) * Math.min(1, evidence / 6) : 0

  const uniq = new Set(tokens)
  const win = 50
  let variety: number
  if (words <= win) variety = words ? uniq.size / words : 0
  else { let sum = 0, n = 0; for (let i = 0; i + win <= words; i += 10) { sum += new Set(tokens.slice(i, i + win)).size / win; n++ } variety = sum / n }

  const freq = new Map<string, number>()
  for (const t of tokens) if (t.length > 2 && !STOP.has(t) && !/^\d+$/.test(t)) freq.set(t, (freq.get(t) ?? 0) + 1)
  const top = [...freq].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([word, n]) => ({ word, n }))

  const buckets = [0, 0, 0, 0]
  for (const l of sLens) buckets[l <= 10 ? 0 : l <= 20 ? 1 : l <= 30 ? 2 : 3]++
  const lengthBalance = sentences.length ? 100 - clamp(Math.abs(avgSentence - 16) * 4) : 0
  const varietyScore = clamp(((variety - 0.4) / 0.5) * 100)
  const score = words < 10 ? 0 : Math.round(ease * 0.45 + varietyScore * 0.3 + lengthBalance * 0.25)

  return {
    words, sentences: sentences.length, paragraphs: paragraphs.filter((p) => p.trim()).length, chars: text.length,
    ease: Math.round(ease), grade: Math.round(grade * 10) / 10, easeLabel: words < 3 ? '—' : easeLabel(ease),
    sentiment, sentimentLabel: evidence < 2 ? 'Neutral' : sentiment > 0.25 ? 'Positive' : sentiment < -0.25 ? 'Negative' : 'Balanced', pos, neg,
    variety: Math.round(varietyScore), unique: uniq.size,
    avgSentence: Math.round(avgSentence * 10) / 10, longSentences: sLens.filter((l) => l > 30).length, buckets,
    readMin: words / 230, speakMin: words / 130, top, score,
  }
}

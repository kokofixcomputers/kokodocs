// Copies the Twemoji SVGs into public/twemoji so they ship with the app (no CDN, works offline).
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
const from = 'node_modules/@twemoji/svg', to = 'public/twemoji'
if (existsSync(from) && !(existsSync(to) && readdirSync(to).length > 3000)) {
  mkdirSync(to, { recursive: true })
  for (const f of readdirSync(from)) if (f.endsWith('.svg')) cpSync(`${from}/${f}`, `${to}/${f}`)
  console.log('twemoji copied')
}

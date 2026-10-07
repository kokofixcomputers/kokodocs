// Packs every Twemoji SVG into one text file ("code<TAB>svg" per line) that the app loads as a single lazy chunk,
// so the emoji picker needs no per-emoji requests. Raw SVG text gzips about 30% smaller than base64 would.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
const from = 'node_modules/@twemoji/svg', out = 'src/generated/emoji-pack.txt'
if (existsSync(from)) {
  const files = readdirSync(from).filter((f) => f.endsWith('.svg')).sort()
  const stamp = files.length + ':' + statSync(`${from}/${files[0]}`).mtimeMs
  const prev = existsSync(out + '.stamp') ? readFileSync(out + '.stamp', 'utf8') : ''
  if (prev !== stamp || !existsSync(out) || !existsSync('src/generated/emoji-codes.ts')) {
    mkdirSync('src/generated', { recursive: true })
    writeFileSync('src/generated/emoji-codes.ts', `export default ${JSON.stringify(files.map((f) => f.slice(0, -4)).join(' '))}\n`)   // tiny list so the app knows which emoji have artwork
    mkdirSync('src/generated', { recursive: true })
    writeFileSync(out, files.map((f) => `${f.slice(0, -4)}\t${readFileSync(`${from}/${f}`, 'utf8').replace(/\s*\n\s*/g, '')}`).join('\n'))
    writeFileSync(out + '.stamp', stamp)
    console.log(`emoji pack: ${files.length} emoji`)
  }
}

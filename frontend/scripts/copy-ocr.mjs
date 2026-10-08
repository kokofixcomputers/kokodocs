// Copies the in-browser text reader (Tesseract) into public/ocr so "Scan a page" works on this device with no CDN and offline:
// the worker, the engine (three builds, the browser picks the fastest it supports) and the English language data.
import { cpSync, existsSync, mkdirSync } from 'node:fs'
const core = 'node_modules/tesseract.js-core', out = 'public/ocr'
const files = [
  ['node_modules/tesseract.js/dist/worker.min.js', `${out}/worker.min.js`],
  [`${core}/tesseract-core-relaxedsimd-lstm.wasm.js`, `${out}/tesseract-core-relaxedsimd-lstm.wasm.js`],
  [`${core}/tesseract-core-simd-lstm.wasm.js`, `${out}/tesseract-core-simd-lstm.wasm.js`],
  [`${core}/tesseract-core-lstm.wasm.js`, `${out}/tesseract-core-lstm.wasm.js`],
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', `${out}/lang/eng.traineddata.gz`],
]
if (files.every(([, to]) => existsSync(to))) process.exit(0)
mkdirSync(`${out}/lang`, { recursive: true })
for (const [from, to] of files) if (existsSync(from)) cpSync(from, to)
console.log('ocr files copied')

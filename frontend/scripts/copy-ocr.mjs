// Copies the in-browser text reader (Tesseract) into public/ocr so "Scan a page" works on this device with no CDN and offline:
// PaddleOCR (the text-finding model, two reading models kept in ocr-models/, and the ONNX runtime that runs them) and Tesseract (the worker,
// the engine in three builds, English data), which is the fallback and reads the scripts PaddleOCR's bundled models don't.
import { cpSync, existsSync, mkdirSync } from 'node:fs'
const core = 'node_modules/tesseract.js-core', out = 'public/ocr'
const files = [
  ['node_modules/tesseract.js/dist/worker.min.js', `${out}/worker.min.js`],
  [`${core}/tesseract-core-relaxedsimd-lstm.wasm.js`, `${out}/tesseract-core-relaxedsimd-lstm.wasm.js`],
  [`${core}/tesseract-core-simd-lstm.wasm.js`, `${out}/tesseract-core-simd-lstm.wasm.js`],
  [`${core}/tesseract-core-lstm.wasm.js`, `${out}/tesseract-core-lstm.wasm.js`],
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', `${out}/lang/eng.traineddata.gz`],
  ['node_modules/@gutenye/ocr-models/assets/ch_PP-OCRv4_det_infer.onnx', `${out}/paddle/ch_PP-OCRv4_det_infer.onnx`],
  ...['en_PP-OCRv4_rec_infer.onnx', 'en_dict.txt', 'latin_PP-OCRv3_rec_infer.onnx', 'latin_dict.txt'].map((f) => [`ocr-models/${f}`, `${out}/paddle/${f}`]),
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', `${out}/ort/ort-wasm-simd-threaded.mjs`],
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', `${out}/ort/ort-wasm-simd-threaded.wasm`],
  // the read-aloud voice's own runtime: the version it was built with (the processor build; the voice no longer uses the graphics card)
  ['node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', `${out}/tts/ort-wasm-simd-threaded.mjs`],
  ['node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', `${out}/tts/ort-wasm-simd-threaded.wasm`],
]
if (files.every(([, to]) => existsSync(to))) process.exit(0)
mkdirSync(`${out}/lang`, { recursive: true }); mkdirSync(`${out}/paddle`, { recursive: true }); mkdirSync(`${out}/ort`, { recursive: true }); mkdirSync(`${out}/tts`, { recursive: true })
for (const [from, to] of files) if (existsSync(from)) cpSync(from, to)
console.log('ocr files copied')

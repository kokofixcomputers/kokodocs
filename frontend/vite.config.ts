import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** Gives every build an id (a hash of the names of everything it produced; the names already carry each file's content hash).
 *  It is written into index.html, and into `version.js`, a file whose name never changes: open pages fetch it now and then and,
 *  when its id differs from the one they were loaded with, know the site has been updated. */
function buildStamp(): Plugin {
  let id = '', out = ''
  return {
    name: 'koko-build-stamp',
    apply: 'build',
    configResolved(c) { out = resolve(c.root, c.build.outDir) },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        id = createHash('sha1').update(Object.keys(ctx.bundle ?? {}).filter((n) => !n.endsWith('.html')).sort().join('\n')).digest('hex').slice(0, 16)
        return html.replace('</head>', `  <meta name="koko-build" content="${id}" />\n  </head>`)
      },
    },
    closeBundle() { if (id) writeFileSync(join(out, 'version.js'), `window.__KOKO_BUILD__ = "${id}"\n`) },
  }
}

/** Writes `sw.js` (the service worker that keeps the app on the device): the template with this build's id and the list of files to keep.
 *  The emoji, text-recognition and screenshot folders and wasm files are left out; those are kept the first time they're used. */
function serviceWorker(): Plugin {
  let out = ''
  return {
    name: 'koko-service-worker',
    apply: 'build',
    configResolved(c) { out = resolve(c.root, c.build.outDir) },
    closeBundle() {
      const files: string[] = []
      const walk = (dir: string, rel: string) => {
        for (const n of readdirSync(join(dir))) {
          const full = join(dir, n), r = rel + '/' + n
          if (statSync(full).isDirectory()) { if (!/^\/(twemoji|ocr|shots)$/.test(r)) walk(full, r) }
          else if (!r.endsWith('.wasm') && statSync(full).size < 16_000_000 && !['/sw.js', '/version.js', '/index.html'].includes(r)) files.push(r)   // (editors load some big files; only the wasm of the page reader is left to be kept when first used)
        }
      }
      walk(out, '')
      const id = Date.now().toString(36) + '-' + createHash('sha1').update(files.join('\n')).digest('hex').slice(0, 8)
      const src = readFileSync(resolve(__dirname, 'sw/sw.js'), 'utf8').replace('__BUILD__', id).replace('__PRECACHE__', JSON.stringify(['/index.html', ...files]))
      writeFileSync(join(out, 'sw.js'), src)
    },
  }
}

/** The ONNX runtime comes in two builds: processor only (about half the size) and one that can also use the graphics card (WebGPU). "Scan a page" only needs the processor
 *  one, so that is what a plain `import 'onnxruntime-web'` becomes, except inside the read-aloud voice's library, which has its own copy of the runtime and can use the card. */
function ortBuilds(): Plugin {
  return {
    name: 'ort-builds',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (source !== 'onnxruntime-web') return null
      const voice = !!importer && /[\\/]@huggingface[\\/]transformers[\\/]/.test(importer)
      return this.resolve(voice ? 'onnxruntime-web/webgpu' : 'onnxruntime-web/wasm', importer, { ...options, skipSelf: true })
    },
  }
}

/** js-clipper (used by the page reader to cut out lines of text) is saved in a Latin-1 encoding that the bundler refuses to read as UTF-8. */
function latin1Clipper(): Plugin {
  return { name: 'js-clipper-latin1', enforce: 'pre', load(id) { if (/js-clipper[\\/]clipper\.js/.test(id)) return readFileSync(id.split('?')[0], 'latin1') } }
}

export default defineConfig({
  plugins: [react(), buildStamp(), serviceWorker(), latin1Clipper(), ortBuilds()],
  worker: { plugins: () => [ortBuilds()] },   // (background workers are built with their own plugin list)
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/ws': { target: 'ws://127.0.0.1:8000', ws: true },
    },
  },
})

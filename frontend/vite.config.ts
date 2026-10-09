import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
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

/** js-clipper (used by the page reader to cut out lines of text) is saved in a Latin-1 encoding that the bundler refuses to read as UTF-8. */
function latin1Clipper(): Plugin {
  return { name: 'js-clipper-latin1', enforce: 'pre', load(id) { if (/js-clipper[\\/]clipper\.js/.test(id)) return readFileSync(id.split('?')[0], 'latin1') } }
}

export default defineConfig({
  plugins: [react(), buildStamp(), latin1Clipper()],
  resolve: { alias: { 'onnxruntime-web': 'onnxruntime-web/wasm' } },   // the CPU-only build (about half the size: the page reader doesn't use the GPU)
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/ws': { target: 'ws://127.0.0.1:8000', ws: true },
    },
  },
})

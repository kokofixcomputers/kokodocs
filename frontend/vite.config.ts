import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
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

export default defineConfig({
  plugins: [react(), buildStamp()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/ws': { target: 'ws://127.0.0.1:8000', ws: true },
    },
  },
})

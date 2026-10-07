import { Link } from 'react-router-dom'
import { Check, Copy } from 'lucide-react'
import { Cta, MarketingLayout } from '../marketing/Layout'
import { toast } from '../ui/Toast'

const CADDY = `docs.example.com {
    reverse_proxy 127.0.0.1:8000
}`
const NGINX = `server {
    server_name docs.example.com;
    client_max_body_size 20m;
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;       # live editing uses WebSockets
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }
}`
const SERVICE = `[Service]
User=kokodocs
WorkingDirectory=/opt/kokodocs/backend
Environment=KOKO_DATA_DIR=/var/lib/kokodocs
ExecStart=/opt/kokodocs/backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --proxy-headers
Restart=on-failure`

function Code({ text, label }: { text: string; label?: string }) {
  return (
    <div className="mk-code">
      {label && <span>{label}</span>}
      <button className="icon-btn sm" aria-label="Copy" onClick={() => { void navigator.clipboard.writeText(text).then(() => toast('Copied')) }}><Copy size={15} /></button>
      <pre><code>{text}</code></pre>
    </div>
  )
}

const ENV: [string, string][] = [
  ['KOKO_DATA_DIR', 'Where the database, uploads and signing secret live (default backend/data).'],
  ['KOKO_SECRET', 'Signing secret for sessions. Generated once if you leave it out.'],
  ['KOKO_ADMIN_EMAILS', 'Comma-separated emails that are admins.'],
  ['KOKO_AI_URL, KOKO_AI_KEY, KOKO_AI_MODEL', 'An optional default assistant connection for everyone. People can add their own in Settings.'],
  ['KOKO_LANGUAGETOOL_URL', 'Use your own LanguageTool server for deeper grammar checks.'],
  ['MISTRAL_API_KEY, OPENAI_API_KEY, KOKO_STT_URL', 'A speech-to-text provider for voice typing. A fully local option needs no key.'],
  ['KOKO_CORS', 'Allowed origins if the frontend is hosted on another domain.'],
]

export function SelfHost() {
  return (
    <MarketingLayout title="Self-host guide - KokoDocs">
      <section className="mk-page-head">
        <span className="mk-eyebrow">Self-host guide</span>
        <h1>Up and running in minutes</h1>
        <p>KokoDocs is one Python process with a SQLite database. No queue, no separate search service, no containers required.</p>
        <Cta ghost={false}>Create a free account</Cta>
      </section>

      <div className="mk-doc">
        <section>
          <h2><b>1</b>What you need</h2>
          <ul className="mk-ticks"><li><Check size={16} />A small Linux or macOS machine (a cheap VPS is plenty)</li><li><Check size={16} />Python 3 and, to build the interface, Node.js</li><li><Check size={16} />A domain name pointing at it, for HTTPS</li></ul>
        </section>
        <section>
          <h2><b>2</b>Start it</h2>
          <p>From the project folder, one script sets up a virtual environment, builds the frontend and serves everything on port 8000.</p>
          <Code label="Terminal" text="./start.sh" />
          <p>Open <code>http://localhost:8000</code>, create an account, and you are in. Data is kept in <code>backend/data</code> (or wherever <code>KOKO_DATA_DIR</code> points).</p>
        </section>
        <section>
          <h2><b>3</b>Run it as a service</h2>
          <p>For a server, run it under systemd, listening on localhost only, and let a reverse proxy handle HTTPS.</p>
          <Code label="kokodocs.service" text={SERVICE} />
        </section>
        <section>
          <h2><b>4</b>Put it behind HTTPS</h2>
          <p>Live editing carries your session over a WebSocket, so use HTTPS in production. With Caddy it is three lines and certificates are automatic:</p>
          <Code label="Caddyfile" text={CADDY} />
          <p>With nginx, make sure WebSocket upgrades and the forwarded headers pass through:</p>
          <Code label="nginx" text={NGINX} />
        </section>
        <section>
          <h2><b>5</b>Make yourself the admin</h2>
          <p>Accounts whose email is listed in <code>KOKO_ADMIN_EMAILS</code> can open the admin panel at <code>/admin</code>: manage people, set a default storage quota, turn sign-ups on or off, and connect email and Google sign-in.</p>
        </section>
        <section>
          <h2><b>6</b>Optional extras</h2>
          <div className="mk-env">
            {ENV.map(([k, v]) => <div key={k}><code>{k}</code><span>{v}</span></div>)}
          </div>
        </section>
        <section>
          <h2><b>7</b>Back up and upgrade</h2>
          <p>Everything is in the data folder, so back it up like any other files. To upgrade, replace the application files and restart: the database updates itself on start and keeps your documents.</p>
        </section>
        <p className="mk-doc-end">Questions about what it can do? See the <Link to="/features">full feature list</Link>.</p>
      </div>
    </MarketingLayout>
  )
}

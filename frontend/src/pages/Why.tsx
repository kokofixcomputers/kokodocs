import { Link } from 'react-router-dom'
import { Check, KeyRound, Lock, Minus, ServerCog, Sparkles, Wallet, WifiOff } from 'lucide-react'
import { Cta, MarketingLayout } from '../marketing/Layout'
import { Phone, Shot } from '../marketing/Shot'

const REASONS = [
  { icon: ServerCog, title: 'You own the whole thing', text: 'Documents, sheets, slides, forms, wikis and boards live in one SQLite database and one uploads folder on a machine you choose. Back it up, move it, or delete it. Nobody else holds a copy.' },
  { icon: Wallet, title: 'No seats, no upsell wall', text: 'There is no licence key, per-person fee or locked tier in the software. Every feature is on for everyone. Your costs are the server and, if you want one, an AI provider.' },
  { icon: Sparkles, title: 'An assistant on your terms', text: 'Connect the model you trust, or none. It reads your files with tools, and every edit waits for your approval. Keys are encrypted at rest and never sent back to the browser.' },
  { icon: Lock, title: 'Private by default', text: 'New files are restricted to you. Sharing is by person, link, password or folder, and roles are enforced on the server. Spelling and grammar run locally unless you say otherwise.' },
  { icon: WifiOff, title: 'Kind to bad connections', text: 'Lose signal mid-sentence and keep typing. When you are back, your edits and everyone else’s merge, and a short notice tells you what happened.' },
  { icon: KeyRound, title: 'Grown-up account security', text: 'Two-factor sign-in with recovery codes, single sign-on with Google, GitHub or your own provider, email confirmation, rate limits and an admin panel for people, files and quotas.' },
]

const ROWS: [string, string, string, string][] = [
  ['Where your files live', 'On your server', 'Google’s cloud', 'The provider’s cloud'],
  ['Cost', 'Free software, you pay for the machine', 'Free with a Google account (storage is shared with Gmail and Photos); paid Workspace plans per person', 'Per person, per month, by tier'],
  ['AI assistant', 'Any OpenAI-compatible model you choose, optional, asks before it edits', 'Gemini, Google’s own model; the fuller features need a paid plan', 'The provider’s model, usually on a higher tier'],
  ['Spelling and grammar', 'Built in and offline, eight English variants', 'Built in, runs in Google’s cloud, many languages', 'Cloud checking'],
  ['Documents, sheets, slides, forms', 'All six, including wikis and boards, in one app', 'Separate apps (Docs, Sheets, Slides, Forms) that share Drive', 'Often separate products'],
  ['Kanban boards and roadmaps', 'A file type of its own: custom and required fields, table, roadmap and calendar views, comments on cards', 'Not a file type in Drive', 'Usually a separate product'],
  ['Voice typing', 'Your pick: Groq, Mistral, OpenAI, any compatible server, or local on your own machine', 'Built in, in Chrome only', 'Varies'],
  ['API and developer docs', 'Wiki pages with request blocks readers can send', 'No request blocks; Google Sites for simple pages', 'Not included'],
  ['Offline edits', 'Merged cleanly when you reconnect, with a notice', 'Offline mode in Chrome, which you turn on first', 'Varies'],
  ['Your formats', 'Word, Excel, PowerPoint, Markdown, HTML, CSV and PDF in and out', 'Word, PDF, Markdown, HTML, text and more out; Office files in and out', 'Varies'],
  ['Customising it', 'It is your server and your code', 'Not possible', 'Not possible'],
]

export function Why() {
  return (
    <MarketingLayout title="Why KokoDocs">
      <section className="mk-page-head">
        <span className="mk-eyebrow">Why KokoDocs</span>
        <h1>The workspace you can actually own</h1>
        <p>Most office suites are a subscription with your files as the hostage. KokoDocs is the same kind of tool, built to run where you decide, with nothing hidden behind a plan.</p>
        <Cta>Create a free account</Cta>
      </section>

      <section className="mk-sec">
        <div className="mk-reasons">
          {REASONS.map((r) => <article key={r.title} className="feat"><span className="feat-ico"><r.icon size={20} /></span><h3>{r.title}</h3><p>{r.text}</p></article>)}
        </div>
      </section>

      <section className="mk-sec">
        <div className="mk-head"><span className="mk-eyebrow">Side by side</span><h2>KokoDocs, Google Docs and a typical hosted suite</h2><p className="lead">The Google Docs column describes its public features at the time of writing and changes as Google updates it, so check Google for the latest. “Typical hosted suite” is a generalisation, not a claim about any one product.</p></div>
        <div className="mk-table" role="table" aria-label="Comparison">
          <div className="mk-tr head" role="row"><span role="columnheader" /><span role="columnheader">KokoDocs</span><span role="columnheader">Google Docs</span><span role="columnheader">Typical hosted suite</span></div>
          {ROWS.map(([k, a, g, b]) => (
            <div className="mk-tr" role="row" key={k}><span role="rowheader">{k}</span><span role="cell" data-col="KokoDocs"><Check size={15} />{a}</span><span role="cell" className="dim" data-col="Google Docs"><Minus size={15} />{g}</span><span role="cell" className="dim" data-col="Typical hosted suite"><Minus size={15} />{b}</span></div>
          ))}
        </div>
      </section>

      <section className="mk-spot">
        <div className="mk-spot-copy">
          <span className="mk-eyebrow">Made to be used</span>
          <h2>Familiar, so there is nothing to learn</h2>
          <p>If you have used a modern office suite you already know where things are: the toolbar, the share button, the version history, the comments. The same shortcuts work, and a cheat sheet is one keypress away.</p>
          <ul className="mk-ticks"><li><Check size={16} />Toolbar, menus and right-click where you expect them</li><li><Check size={16} />Press ? for every shortcut</li><li><Check size={16} />Light and dark, on desktop and phone</li></ul>
          <Link to="/features" className="mk-more">See every feature</Link>
        </div>
        <div className="mk-spot-shot mk-why-phones"><Phone name="phone-doc" alt="A document on a phone" /><div className="phone-pair"><Phone name="phone-dashboard" alt="The documents screen on a phone" /></div></div>
      </section>

      <section className="mk-sec mk-note">
        <div className="mk-card-note">
          <Shot name="settings" alt="Storage settings" />
        </div>
        <div className="mk-note-copy">
          <h3>Honest about the trade-off</h3>
          <p>Running it yourself means you are the admin: you keep the server updated, put it behind HTTPS and take your own backups. It is a small, single-process app, so that is a short list, and the <Link to="/self-host">self-host guide</Link> walks through it.</p>
        </div>
      </section>

      <section className="home-end"><h2>Try it with your own files.</h2><Cta ghost={false}>Create your account</Cta></section>
    </MarketingLayout>
  )
}

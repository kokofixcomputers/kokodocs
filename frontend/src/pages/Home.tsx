import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight, BookOpen, Bot, Check, ClipboardList, FileDown, FolderTree, History, Keyboard, Languages, ListChecks, Mic, Moon, Presentation, ServerCog, ShieldCheck, Smartphone,
  Sparkles, SpellCheck, Table2, Tags, Users, FileText, HardDrive, Webhook, Kanban,
} from 'lucide-react'
import { Cta, MarketingLayout, useSignup } from '../marketing/Layout'
import { Frame, Phone, Shot } from '../marketing/Shot'
import { MicTest } from '../marketing/MicTest'

const TOOLS = [
  { id: 'docs', icon: FileText, name: 'Documents', shot: 'doc', url: 'docs.example.com/d/q3-launch-plan', title: 'Write like it is a real page', text: 'A calm, fast editor for everything from meeting notes to long reports.', bullets: ['Pages with headers, footers and page numbers', 'Tables with merged cells, callouts, checklists and images', '1,950 fonts, comments, mentions and live cursors', 'Import Word, Markdown and HTML; export PDF, Word and more'], link: '/features#documents' },
  { id: 'sheets', icon: Table2, name: 'Spreadsheets', shot: 'sheet', url: 'docs.example.com/d/launch-budget', title: 'A real formula engine', text: 'Numbers you can trust, with charts that update as you type.', bullets: ['370+ functions, arrays and spilling formulas', 'Charts, merged cells, frozen panes and number formats', 'Copy and paste to and from Excel and Google Sheets', 'Open and save .xlsx and CSV'], link: '/features#spreadsheets' },
  { id: 'slides', icon: Presentation, name: 'Presentations', shot: 'slides', url: 'docs.example.com/d/investor-pitch', title: 'Decks that look designed', text: 'Start from a theme and layout, then make it yours.', bullets: ['Themes, layouts, shapes, tables and charts', 'Speaker notes and a full-screen presenter mode', 'Transitions and your choice of fonts', 'Import and export PowerPoint'], link: '/features#slides' },
  { id: 'forms', icon: ClipboardList, name: 'Forms', shot: 'form', url: 'docs.example.com/d/customer-feedback', title: 'Ask, collect, understand', text: 'Build a form together, share a link, and read the answers as charts.', bullets: ['13 question types, pages, media and file uploads', 'Show-if rules and jumps, with validation on the server too', 'Summary charts, one-by-one view, table and CSV export', 'Accent colour that themes the whole form'], link: '/features#forms' },
  { id: 'wikis', icon: BookOpen, name: 'Wikis', shot: 'wiki', url: 'docs.example.com/d/api-reference', title: 'Documentation people can try', text: 'A sidebar of pages and folders, and request blocks readers can send.', bullets: ['Collapsible contents, drag to reorder', 'Request blocks with a Send button, cURL, JavaScript and Python', 'Badges, variables and parameter tables', 'Version history, assistant and voice typing too'], link: '/features#wikis' },
  { id: 'boards', icon: Kanban, name: 'Boards', shot: 'board', url: 'docs.example.com/d/q3-launch-board', title: 'Plan work your way', text: 'A kanban board you shape with your own fields, then see as a table, a roadmap or a calendar.', bullets: ['Drag cards between columns, with a finger too', 'Your own fields: select, multi select, date, number, checkbox, link', 'Mark a field required, with limits for numbers and dates', 'Comments and @mentions on every card'], link: '/features#boards' },
] as const

const SPOTS = [
  { icon: Users, eyebrow: 'Collaboration', shot: 'share', title: 'Edit together without stepping on toes', text: 'See everyone’s cursor and changes the moment they happen. Go offline, keep typing, and your edits merge cleanly when you are back.', bullets: ['Live cursors and presence avatars', 'Comments with @mentions, notifications and optional email', 'Viewer, Editor and “Can manage” roles, per person or per link', 'Password-protected links and whole-folder sharing'] },
  { icon: Bot, eyebrow: 'Assistant', shot: 'assistant', title: 'An assistant that asks before it edits', text: 'Ask it to read, summarise, rewrite or build. Every change shows up as a card you approve first, so nothing happens behind your back.', bullets: ['Works with any OpenAI-compatible model, including your own', 'Reads and edits documents, spreadsheets, slides and wikis', 'Shows exactly what it will change, then waits', 'Your key is stored encrypted and never sent back to the browser'] },
  { icon: History, eyebrow: 'History', shot: 'history', title: 'Nothing gets lost', text: 'Every file keeps its history. Compare any version to the one before it, or to now, and restore with one click.', bullets: ['Automatic and named versions', 'A clear “what changed” view, line by line', 'Restoring keeps a copy of what you replaced', 'A recycle bin that holds deleted files for 30 days'] },
  { icon: SpellCheck, eyebrow: 'Writing', shot: 'proofread', title: 'Proofreading that speaks your English', text: 'Spelling and grammar checks run on your own server. Choose US, UK, Canadian, Australian and other variants, so “colour” is right when it should be.', bullets: ['Eight English variants, with suggestions in your spelling', 'Optional LanguageTool server for deeper grammar rules', 'Right-click menus, a slash menu and keyboard shortcuts'] },
  { icon: Webhook, eyebrow: 'Wikis', shot: 'wiki', title: 'API docs with a Try it button', text: 'Readers can change the address, headers or body and press Send. Their changes stay in their browser, and your docs stay as you wrote them.', bullets: ['Method badges, status and timing, formatted replies', 'Variables for the server address, and private ones for tokens', 'A server fallback for APIs that block browser requests', 'Not tied to one API: it is just an HTTP request you can document'] },
  { icon: Kanban, eyebrow: 'Boards', shot: 'board-roadmap', title: 'One board, four ways to look at it', text: 'The same cards as columns, a sortable table, a roadmap with bars between dates, or a calendar. Drag a bar to reschedule it.', bullets: ['Pick which date fields start and end each bar', 'Zoom the roadmap by days, weeks or months', 'Download the table as CSV', 'Cards missing a required field are flagged'] },
  { icon: HardDrive, eyebrow: 'Control', shot: 'settings', title: 'Know where every byte is', text: 'See what takes up space, by file and by kind. Identical pictures are stored once, and admins set limits per person.', bullets: ['A colour-coded storage breakdown for you and for each file', 'Duplicate pictures merged automatically', 'Two-factor sign-in, Google sign-in and email confirmation', 'An admin panel for people, files and server settings'] },
] as const

const GRID = [
  { icon: ListChecks, title: 'Nested checklists', text: 'Tick the last child and the parent ticks itself, with a dash while some are left.' },
  { icon: Tags, title: 'Folders and tags', text: 'Colour-coded folders, tags with their own sections, stars and recent files.' },
  { icon: FolderTree, title: 'Search inside files', text: 'Find a title or a sentence inside any document, sheet, slide or wiki.' },
  { icon: FileDown, title: 'Take it anywhere', text: 'PDF, Word, Markdown, HTML, Excel, CSV, JSON and PowerPoint.' },
  { icon: Languages, title: '1,950 fonts', text: 'The full Google Fonts catalogue, previewed in its own typeface.' },
  { icon: Keyboard, title: 'Shortcuts for everything', text: 'Press ? anywhere to see the shortcuts for the file you are in.' },
  { icon: Moon, title: 'Light and dark', text: 'Follows your system, or switch any time. Even the settings page.' },
  { icon: Smartphone, title: 'Works on a phone', text: 'Long-press for menus, tap to dictate, and pages that reflow to fit.' },
  { icon: ShieldCheck, title: 'Private by default', text: 'Restricted to the people you choose, with roles enforced on the server.' },
] as const

const STATS = [['6', 'kinds of file in one place'], ['370+', 'spreadsheet functions'], ['1,950', 'fonts to choose from'], ['8', 'English spelling variants']]

const FAQ = [
  ['Is it free?', 'KokoDocs is software you run on your own server, so there is no subscription and no per-person fee. You only pay for the machine it runs on, and for an AI provider if you choose to connect one.'],
  ['Where are my documents stored?', 'On your server, in a single folder with a SQLite database and your uploaded files. Nothing is sent to us. Spelling and grammar checks run on your server too, unless you point them at a LanguageTool server you choose.'],
  ['Which AI models can the assistant use?', 'Any service that speaks the OpenAI chat format: Mistral, OpenAI, OpenRouter, Groq or a local Ollama, for example. You add your own key under Settings, and it is stored encrypted. Without a key the assistant simply stays off.'],
  ['Can I bring my Word, Excel and PowerPoint files?', 'Yes. Word, Markdown, HTML and text open as documents, Excel and CSV as spreadsheets, and PowerPoint as presentations. Everything exports back out too.'],
  ['Does it work on my phone?', 'Yes. The editors reflow to fit, menus open with a long-press, and there is a floating microphone button for dictation.'],
  ['What happens if I lose my connection?', 'Keep typing. Your changes are kept in the page, and when you are back online they are merged with everyone else’s, with a short notice about what happened.'],
  ['Can people sign in with Google or GitHub?', 'Yes. In the admin panel you can add Google, GitHub, GitLab, Microsoft or Discord with a client ID and secret, or any OAuth 2.0 / OpenID Connect provider such as Keycloak, Authentik or Okta by pasting its address. Email sign-up with confirmation codes and two-factor sign-in are built in as well.'],
] as const

export function Home() {
  const [tool, setTool] = useState<(typeof TOOLS)[number]['id']>('docs')
  const t = TOOLS.find((x) => x.id === tool)!
  const signup = useSignup()
  return (
    <MarketingLayout>
      <section className="home-hero">
        <span className="home-pill"><Sparkles size={14} />Documents, sheets, slides, forms, wikis, boards and an AI coworker</span>
        <h1>Your whole workspace,<br />on your own terms.</h1>
        <p>A fast, modern home for the things you write, calculate, present and document. Real-time collaboration, an assistant that asks before it edits, and everything you expect from the big names, running on a server you control.</p>
        <Cta>{signup ? 'Create a free account' : 'Sign in'}</Cta>
        <div className="home-stage"><Frame name="doc" alt="A KokoDocs document with a goal callout, a nested checklist and live collaborators" url="docs.example.com/d/q3-launch-plan" eager /></div>
        <ul className="mk-trust">
          <li><ServerCog size={16} />Self-hosted</li><li><Users size={16} />Real-time</li><li><ShieldCheck size={16} />Role-based sharing</li><li><FileDown size={16} />Open file formats</li><li><Bot size={16} />Bring your own AI</li>
        </ul>
      </section>

      <section className="mk-stats" aria-label="At a glance">
        {STATS.map(([n, l]) => <div key={l}><b>{n}</b><span>{l}</span></div>)}
      </section>

      <section id="tools" className="mk-sec">
        <div className="mk-head"><span className="mk-eyebrow">One place for all of it</span><h2>Six tools that feel like one</h2><p className="lead">Same look, same sharing, same history and the same assistant in every one of them.</p></div>
        <div className="mk-tabs" role="tablist">
          {TOOLS.map((x) => <button key={x.id} role="tab" aria-selected={tool === x.id} className={tool === x.id ? 'on' : ''} onClick={() => setTool(x.id)}><x.icon size={17} />{x.name}</button>)}
        </div>
        <div className="mk-tool" key={t.id}>
          <div className="mk-tool-copy">
            <h3>{t.title}</h3><p>{t.text}</p>
            <ul className="mk-ticks">{t.bullets.map((b) => <li key={b}><Check size={16} />{b}</li>)}</ul>
            <Link to={t.link} className="mk-more">More about {t.name.toLowerCase()}<ArrowRight size={16} /></Link>
          </div>
          <div className="mk-tool-shot"><Frame name={t.shot} alt={`${t.name} in KokoDocs`} url={t.url} /></div>
        </div>
      </section>

      {SPOTS.map((s, i) => (
        <section key={s.title} className={`mk-spot ${i % 2 ? 'flip' : ''}`}>
          <div className="mk-spot-copy">
            <span className="mk-eyebrow"><s.icon size={15} />{s.eyebrow}</span>
            <h2>{s.title}</h2><p>{s.text}</p>
            <ul className="mk-ticks">{s.bullets.map((b) => <li key={b}><Check size={16} />{b}</li>)}</ul>
          </div>
          <div className="mk-spot-shot"><Frame name={s.shot} alt={s.title} /></div>
        </section>
      ))}

      <section id="voice" className="mk-spot mk-gif">
        <div className="mk-spot-copy">
          <span className="mk-eyebrow"><Mic size={15} />Voice typing</span>
          <h2>Just say it</h2>
          <p>Hold a key, or tap the microphone on your phone, and talk. When you let go, your words land at the cursor, ready to edit like anything else you typed.</p>
          <ul className="mk-ticks">
            <li><Check size={16} />Push to talk with a key you choose (Right Ctrl by default)</li>
            <li><Check size={16} />Runs on Groq (Whisper large v3 or the faster turbo), Mistral, OpenAI, any compatible server, or fully on your own machine</li>
            <li><Check size={16} />Your admin picks the provider once, and it works for everyone</li>
          </ul>
          <div className="mk-voice-card"><MicTest /></div>
        </div>
        <div className="mk-spot-shot"><Frame name="voice-typing" ext="gif" alt="Holding a key, speaking, and the sentence appearing in a document" url="docs.example.com/d/weekly-sync" /></div>
      </section>

      <section className="mk-sec mk-devices">
        <div className="mk-head"><span className="mk-eyebrow">Everywhere you work</span><h2>On your phone, and easy on the eyes</h2><p className="lead">Menus open with a long-press, pages reflow to fit, and dark mode is a first-class citizen, not an afterthought.</p></div>
        <div className="mk-device-row">
          <Phone name="phone-doc" alt="A document on a phone" />
          <div className="mk-dark"><Frame name="dashboard" alt="The documents screen with folders, tags and templates" url="docs.example.com" /></div>
          <Phone name="phone-dashboard" alt="The documents screen on a phone" />
        </div>
      </section>

      <section id="features" className="home-features">
        <h2>And all the little things</h2>
        <p className="lead">The details that make a workspace pleasant to live in.</p>
        <div className="feat-grid">
          {GRID.map((f) => <article key={f.title} className="feat"><span className="feat-ico"><f.icon size={20} /></span><h3>{f.title}</h3><p>{f.text}</p></article>)}
        </div>
        <Link to="/features" className="btn btn-pill btn-ghost btn-lg" style={{ marginTop: 28 }}>Browse the full feature list<ArrowRight size={18} /></Link>
      </section>

      <section className="mk-sec mk-faq">
        <div className="mk-head"><span className="mk-eyebrow">Questions</span><h2>Good to know</h2></div>
        <div className="mk-faq-list">
          {FAQ.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
        </div>
        <p className="mk-faq-more">Want the details on running it? <Link to="/self-host">Read the self-host guide</Link> or <Link to="/why">see why people choose it</Link>.</p>
      </section>

      <section className="home-end">
        <h2>Ready when you are.</h2>
        <p className="lead" style={{ marginBottom: 0 }}>Make an account in a few seconds and bring your first file with you.</p>
        <Cta ghost={false}>Create your account</Cta>
      </section>
    </MarketingLayout>
  )
}

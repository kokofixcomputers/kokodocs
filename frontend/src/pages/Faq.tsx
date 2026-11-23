import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, Lightbulb, Search, X } from 'lucide-react'
import { Cta, MarketingLayout } from '../marketing/Layout'
import { Frame } from '../marketing/Shot'

type Cat = 'Sharing' | 'Writing' | 'History' | 'Spreadsheets' | 'Wikis' | 'Settings'
interface Item { id: string; cat: Cat; q: string; intro?: string; steps?: ReactNode[]; tip?: ReactNode; shot?: { name: string; alt: string; url?: string; ext?: 'jpg' | 'gif' }; text?: string }

const B = ({ children }: { children: ReactNode }) => <b>{children}</b>

const ITEMS: Item[] = [
  { id: 'share-button', cat: 'Sharing', q: 'Where is the Share button?',
    intro: 'Everywhere you would look for it.',
    steps: [<>In your file list, every file and folder you own has a <B>Share</B> button on its row, next to the ⋯ menu.</>, <>Inside a file, <B>Share</B> is the dark button at the top right.</>, <>You can also right-click a file or folder in the list and choose <B>Share…</B>.</>],
    tip: 'People who can only view or edit a file do not see Share: only owners and managers can change who has access.',
    shot: { name: 'faq-dashboard', alt: 'The file list, with a Share button on every row', url: 'docs.example.com' } },
  { id: 'share-files', cat: 'Sharing', q: 'How do I share a file with someone?',
    steps: [<>Open the file and press <B>Share</B>.</>, <>Type the person’s email, pick <B>Can view</B>, <B>Can edit</B> or <B>Can manage</B>, and press <B>Add</B>.</>, <>Press <B>Save</B>. The file appears under <B>Shared with me</B> for them, and they get a notification.</>],
    tip: <><B>Can manage</B> lets someone change who has access. Only the owner can delete the file.</>,
    shot: { name: 'faq-share-file', alt: 'The Share dialog for a document, with two people added', url: 'docs.example.com/d/q3-launch-plan' } },
  { id: 'share-folders', cat: 'Sharing', q: 'How do I share a whole folder?',
    steps: [<>In <B>My documents</B>, press <B>Share</B> on the folder’s row.</>, <>Add people by email, or choose <B>Anyone with the link</B> and press <B>Copy link</B>.</>, <>Press <B>Save</B>. Everything inside the folder, including subfolders and files you add later, is shared too.</>],
    tip: <>A folder link looks like <code>/f/…</code> and opens a page that lists what is inside. Individual files can still have their own, stricter sharing.</>,
    shot: { name: 'faq-share-folder', alt: 'The Share dialog for a folder', url: 'docs.example.com' } },
  { id: 'link-expiry', cat: 'Sharing', q: 'Can I make a share link stop working after a while?',
    steps: [<>Press <B>Share</B> on a file or folder and choose <B>Anyone with the link</B> (or <B>Password protected</B> on a file).</>, <>Under <B>Link expiry</B>, pick <B>Never</B>, <B>7 days</B> or <B>30 days</B>, then press <B>Save</B>.</>, <>When the date passes, the link goes back to <B>Restricted</B> on its own and you get a notification. People you added by name keep their access.</>],
    shot: { name: 'faq-link-expiry', alt: 'The Link expiry menu in the Share dialog', url: 'docs.example.com/d/launch-checklist' } },
  { id: 'password-link', cat: 'Sharing', q: 'How do I protect a link with a password?',
    steps: [<>Press <B>Share</B> and choose <B>Password protected</B>.</>, <>Type a password (4 characters or more) and press <B>Save</B>.</>, <>Send people the link and the password separately. They are asked for the password before the file opens.</>],
    tip: 'Leave the password box empty when you save again to keep the current one.' },
  { id: 'request-access', cat: 'Sharing', q: 'I can only view a file. How do I ask for permission to edit?',
    steps: [<>Sign in, then press <B>Request edit access</B> in the top bar.</>, <>Add a short note if you like and press <B>Send request</B>.</>, <>The owner gets a notification (and an email, if email is set up) with a link that opens their Share dialog, where they can give you <B>Can edit</B>.</>],
    tip: 'You can send a few requests per hour for the same file.',
    shot: { name: 'faq-request-access', alt: 'The Request edit access box on a view-only document', url: 'docs.example.com/d/q3-launch-plan' } },
  { id: 'roles', cat: 'Sharing', q: 'What is the difference between view, edit and manage?',
    steps: [<><B>Can view</B>: read the file, comment, and make a copy of it as a branch. Nothing they do changes your file.</>, <><B>Can edit</B>: change the content, and see the version history.</>, <><B>Can manage</B>: everything an editor can, plus changing who has access. The owner is the only one who can delete the file.</>] },
  { id: 'voice', cat: 'Writing', q: 'How do I type with my voice?',
    steps: [<>Click the microphone in the toolbar once, and talk. Your words appear at the cursor each time you pause.</>, <>Click it again (or press <B>Esc</B>) to stop. You can also hold the shortcut key while you speak. The small arrow next to the microphone has the options.</>, <>On a phone, use the round microphone button that floats over the page.</>],
    tip: 'Voice typing needs a speech provider to be set up by the server’s admin. Your recording is sent to that provider to be turned into text.',
    shot: { name: 'voice-typing', ext: 'gif', alt: 'Speaking and the sentence appearing in a document', url: 'docs.example.com/d/weekly-sync' } },
  { id: 'equations', cat: 'Writing', q: 'How do I write an equation?',
    steps: [<>Type <code>/</code> and choose <B>Equation</B> (own line) or <B>Inline equation</B>, or press the Σ button.</>, <>Type LaTeX, or use the buttons for fractions, roots, sums and Greek letters. The result is drawn as you type.</>, <>Press <B>Done</B>. Click an equation any time to edit it.</>],
    tip: <>Shortcut: typing <code>$x^2$</code> makes an inline equation, and <code>$$</code> plus a space starts a block one.</>,
    shot: { name: 'faq-equation', alt: 'The equation editor with a live preview', url: 'docs.example.com/d/launch-checklist' } },
  { id: 'insights', cat: 'Writing', q: 'How readable is my writing? What can I improve?',
    steps: [<>Press the gauge button in the top bar (under <B>⋯</B> in the standard layout) to open <B>Insights</B>.</>, <>You get a writing score, readability, tone and vocabulary variety as rings, plus sentence lengths and a word-count trend.</>, <>The <B>What you can improve</B> list says what to change: long sentences, passive voice, repeated words and so on.</>],
    tip: 'Everything is worked out in your browser. Your text is not sent anywhere for this.',
    shot: { name: 'faq-insights', alt: 'The Insights panel with score rings', url: 'docs.example.com/d/q3-launch-plan' } },
  { id: 'toolbar', cat: 'Writing', q: 'The toolbar is crowded. Can I change what it shows?',
    steps: [<>Open <B>Settings → Toolbar</B> (or press <B>Customize toolbar…</B> in any ⋯ menu).</>, <>Start from <B>Essentials</B>, <B>Standard</B> or <B>Everything</B>, then drag buttons in the preview to reorder them, drag one to <B>Hidden under ⋯</B> to tuck it away, or click one below to bring it back.</>, <>Computers and phones can have different layouts, or turn on <B>Same on computers and phones</B>.</>],
    shot: { name: 'faq-toolbar', alt: 'The Toolbar settings with a drag-and-drop preview', url: 'docs.example.com' } },
  { id: 'download', cat: 'Writing', q: 'How do I download a file as Word, PDF or Markdown?',
    steps: [<>Press the download button in the top bar.</>, <>Choose <B>PDF</B>, <B>Word (.docx)</B>, <B>Markdown</B>, <B>Web page</B> or <B>Plain text</B>.</>, <>To keep a complete copy you can open again later, use <B>Download as .kokodocs</B> in the ⋯ menu of the file list.</>],
    shot: { name: 'faq-export', alt: 'The download menu', url: 'docs.example.com/d/q3-launch-plan' } },
  { id: 'spacing', cat: 'Writing', q: 'How do I change line spacing?',
    steps: [<>Select the paragraphs you want to change.</>, <>Press the line spacing button (up and down arrows) and pick 1.0, 1.15, 1.5, double or more. <B>Default</B> puts it back.</>],
    tip: 'Line spacing is kept when you download the file as a Word document.' },
  { id: 'versions', cat: 'History', q: 'How do I get an older version back?',
    steps: [<>Press the clock button in the top bar to open <B>Version history</B>.</>, <>Pick a version. <B>Show changes</B> highlights what is different from the one before it, or from now.</>, <>Press <B>Restore this version</B>. A copy of the current file is saved first, so you can always go back.</>],
    shot: { name: 'faq-history', alt: 'Version history with named versions', url: 'docs.example.com/d/q3-launch-plan' } },
  { id: 'compare', cat: 'History', q: 'How do I compare two documents, or try changes without breaking the original?',
    steps: [<>Press the compare button in the top bar (under <B>⋯</B> in the standard layout) and pick another document or one of this file’s saved versions. Changes are shown side by side, in colour.</>, <>To experiment, press <B>Branch</B> to make your own copy (or <B>Branch from this version</B> in a version preview). The copy remembers where it came from and links back.</>],
    shot: { name: 'faq-compare', alt: 'Two versions of a document side by side', url: 'docs.example.com/d/q3-launch-plan' } },
  { id: 'hide-columns', cat: 'Spreadsheets', q: 'How do I hide columns in a spreadsheet?',
    steps: [<>Click a column letter (drag or Shift-click to pick several) and right-click.</>, <>Choose <B>Hide columns</B>. They collapse out of view and keep their data, formulas and width.</>, <>Click the small <B>◂▸</B> handle where they were, or right-click and choose <B>Show all hidden columns</B>, to bring them back.</>],
    tip: 'Hidden columns still count in formulas, and everyone who opens the sheet sees the same columns.',
    shot: { name: 'faq-hide-columns', alt: 'The right-click menu on two selected spreadsheet columns', url: 'docs.example.com/d/launch-budget' } },
  { id: 'wiki-links', cat: 'Wikis', q: 'How do I link one wiki page to another?',
    steps: [<>Select some text and press the <B>Link</B> button.</>, <>Pick a page from the list under <B>Or link to a page in this wiki</B>. You can search it by name.</>, <>The page you linked to lists the page under <B>Linked from</B>, so people can find their way back.</>],
    tip: 'The search box in the page list looks inside page text too, not only titles.',
    shot: { name: 'faq-wiki-links', alt: 'Choosing a wiki page to link to', url: 'docs.example.com/d/team-handbook' } },
  { id: 'extensions', cat: 'Settings', q: 'Can I add my own features, themes or blocks?',
    steps: [<>Open <B>Settings → Extensions</B>, press <B>New extension</B> or start from an example such as Rosé Pine.</>, <>Extensions are small JavaScript programs that follow your account. They can add a colour theme, a <code>/</code> command or a new kind of block, and they can have their own settings and popups.</>, <>By default they run in a sealed sandbox with no access to your account or the internet. An extension can ask for full access, and you decide.</>],
    shot: { name: 'faq-extensions', alt: 'The Extensions settings with a theme and three extensions', url: 'docs.example.com' } },
  { id: 'where-files', cat: 'Settings', q: 'Where are my files stored?',
    steps: [<>On the server your KokoDocs runs on: documents in its database and pictures in its uploads folder.</>, <>If you want your files somewhere you control, <B>Settings → Extended storage</B> can keep them in your own WebDAV, S3 or folder instead, one <code>.kokodocs</code> file per document.</>] },
  { id: 'offline', cat: 'Settings', q: 'What happens if I lose my connection?',
    steps: [<>Keep typing. Your edits are kept in your browser.</>, <>When you are back online they are merged with anyone else’s changes, and a short notice tells you what happened.</>] },
]

const CATS: ('All' | Cat)[] = ['All', 'Sharing', 'Writing', 'History', 'Spreadsheets', 'Wikis', 'Settings']
const text = (n: ReactNode): string => (typeof n === 'string' || typeof n === 'number' ? String(n) : Array.isArray(n) ? n.map(text).join(' ') : n && typeof n === 'object' && 'props' in n ? text((n as { props: { children?: ReactNode } }).props.children) : '')
const hay = (i: Item) => [i.q, i.intro ?? '', i.cat, ...(i.steps ?? []).map(text), text(i.tip)].join(' ').toLowerCase()
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

function Entry({ item, open, onToggle, index }: { item: Item; open: boolean; onToggle: () => void; index: number }) {
  const ref = useRef<HTMLElement>(null)
  return (
    <article ref={ref} id={item.id} className={`faq-item ${open ? 'open' : ''}`} style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}>
      <h3>
        <button type="button" className="faq-q" aria-expanded={open} aria-controls={`${item.id}-panel`} id={`${item.id}-btn`} onClick={onToggle}>
          <span className="faq-cat">{item.cat}</span><span className="faq-qt">{item.q}</span><ChevronDown className="faq-chev" size={20} aria-hidden />
        </button>
      </h3>
      <div className="faq-panel" id={`${item.id}-panel`} role="region" aria-labelledby={`${item.id}-btn`} {...(open ? {} : { inert: true })}>
        <div className="faq-clip">
          <div className="faq-body">
            {item.intro && <p className="faq-intro">{item.intro}</p>}
            {item.steps && <ol className="faq-steps">{item.steps.map((s, i) => <li key={i} style={{ transitionDelay: open ? `${120 + i * 70}ms` : '0ms' }}><span>{i + 1}</span><div>{s}</div></li>)}</ol>}
            {item.tip && <p className="faq-tip"><Lightbulb size={16} aria-hidden /><span>{item.tip}</span></p>}
            {item.shot && <div className="faq-shot"><Frame name={item.shot.name} alt={item.shot.alt} url={item.shot.url} ext={item.shot.ext} /></div>}
            <p className="faq-link"><a href={`#${item.id}`} onClick={(e) => { e.preventDefault(); void navigator.clipboard?.writeText(`${location.origin}/faq#${item.id}`) }}>Copy a link to this answer</a></p>
          </div>
        </div>
      </div>
    </article>
  )
}

export function Faq() {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<'All' | Cat>('All')
  const [open, setOpen] = useState<Set<string>>(() => { const h = decodeURIComponent(location.hash.slice(1)); return new Set(ITEMS.some((i) => i.id === h) ? [h] : []) })
  const needle = q.trim().toLowerCase()
  const list = useMemo(() => ITEMS.filter((i) => (cat === 'All' || i.cat === cat) && (!needle || needle.split(/\s+/).every((w) => hay(i).includes(w)))), [cat, needle])

  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  useEffect(() => {   // an address like /faq#share-folders opens that answer and brings it into view
    const go = () => { const h = decodeURIComponent(location.hash.slice(1)); if (!ITEMS.some((i) => i.id === h)) return; setOpen((s) => new Set(s).add(h)); window.setTimeout(() => document.getElementById(h)?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' }), 120) }
    go(); window.addEventListener('hashchange', go); return () => window.removeEventListener('hashchange', go)
  }, [])
  useEffect(() => { if (needle) setOpen(new Set(list.slice(0, 3).map((i) => i.id))) }, [needle])   // eslint-disable-line react-hooks/exhaustive-deps

  const allOpen = list.length > 0 && list.every((i) => open.has(i.id))
  return (
    <MarketingLayout title="FAQ · KokoDocs">
      <section className="mk-page-head faq-head">
        <span className="mk-eyebrow">Help and questions</span>
        <h1>How do I…?</h1>
        <p>Short answers with pictures of the real thing. Open a question, follow the steps, and if you are still stuck, the self-host guide and the features page cover the rest.</p>
        <label className="faq-search"><Search size={18} aria-hidden /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: share, voice, hide columns…" aria-label="Search the FAQ" />{q && <button type="button" aria-label="Clear search" onClick={() => setQ('')}><X size={16} /></button>}</label>
        <div className="faq-cats" role="tablist" aria-label="Topics">
          {CATS.map((c) => <button key={c} role="tab" aria-selected={cat === c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{c}</button>)}
        </div>
      </section>

      <section className="mk-sec faq-sec">
        <div className="faq-bar">
          <span>{list.length} {list.length === 1 ? 'question' : 'questions'}</span>
          <button type="button" onClick={() => setOpen(allOpen ? new Set() : new Set(list.map((i) => i.id)))}>{allOpen ? 'Collapse all' : 'Expand all'}</button>
        </div>
        <div className="faq-list">
          {list.map((i, k) => <Entry key={i.id} item={i} open={open.has(i.id)} onToggle={() => toggle(i.id)} index={k} />)}
          {!list.length && <div className="faq-none"><Search size={26} /><b>Nothing matches “{q}”</b><span>Try a shorter word, or <button type="button" onClick={() => { setQ(''); setCat('All') }}>show every question</button>.</span></div>}
        </div>
      </section>

      <section className="home-end"><h2>Still have a question?</h2><p className="faq-end-p">Browse <Link to="/features">every feature</Link>, read why people <Link to="/why">choose KokoDocs</Link>, or run your own with the <Link to="/self-host">self-host guide</Link>.</p><Cta ghost={false}>Create a free account</Cta></section>
    </MarketingLayout>
  )
}

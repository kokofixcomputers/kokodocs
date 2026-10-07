import { Link } from 'react-router-dom'
import { BookOpen, Bot, Check, ClipboardList, FileText, FolderTree, Presentation, ShieldCheck, Table2, Users } from 'lucide-react'
import { Cta, MarketingLayout } from '../marketing/Layout'
import { Frame } from '../marketing/Shot'

interface Group { id: string; icon: typeof FileText; name: string; lead: string; shot?: string; url?: string; items: [string, string][] }

const GROUPS: Group[] = [
  { id: 'documents', icon: FileText, name: 'Documents', lead: 'A rich editor that stays out of your way, with real pages when you need them.', shot: 'doc', url: 'docs.example.com/d/q3-launch-plan', items: [
    ['Real pages', 'Paper sizes, orientation and margins, with a header and footer on every page and page-number tokens.'],
    ['Tables', 'Resizable columns, merged and split cells, cell colours, and quick join-with-neighbour buttons that work on a phone.'],
    ['Callouts and checklists', 'Info, tip, warning and custom callouts. Checklists nest, and a parent shows a dash until every child is done, then ticks itself.'],
    ['Images', 'Upload, drag in or paste from Google Docs and Word. Pictures are fetched and kept with the file, resized with handles, and stored once if you add them again.'],
    ['Fonts and text', 'The full Google Fonts catalogue (1,950 families), sizes, colours, highlights, links with a hover preview, sub and superscript.'],
    ['Slash menu', 'Type / to insert headings, lists, tables, callouts, code, dividers, images and the date.'],
    ['Find and replace', 'A search bar with replace, and a word count that shows what you have selected.'],
    ['Import and export', 'Open Word (with colours, sizes, fonts, lists, tables and images), Markdown, HTML and text. Save as PDF, Word, Markdown, HTML or plain text.'],
  ] },
  { id: 'spreadsheets', icon: Table2, name: 'Spreadsheets', lead: 'A proper formula engine, not a table with delusions.', shot: 'sheet', url: 'docs.example.com/d/launch-budget', items: [
    ['Formulas', '370+ functions, ranges, cross-sheet references, array math, and dynamic arrays like FILTER, SORT and UNIQUE that spill.'],
    ['Charts', 'Column, bar, line, area, pie and scatter charts that follow your data and live on the sheet.'],
    ['Layout', 'Merged cells, frozen panes, resizable rows and columns, borders, number formats and cell styles.'],
    ['Editing', 'Fill handle and series, sort, undo and redo, multiple sheets and live cursors.'],
    ['Excel friendly', 'Copy and paste to and from Excel and Google Sheets. Open and save .xlsx with formulas and formatting, plus CSV, TSV, JSON and HTML.'],
    ['Comments', 'Comment on any cell and mention a teammate.'],
  ] },
  { id: 'slides', icon: Presentation, name: 'Presentations', lead: 'Start from a theme, pick a layout, and have a deck in minutes.', shot: 'slides', url: 'docs.example.com/d/investor-pitch', items: [
    ['Themes and layouts', 'Title, stats, cards, steps, two columns, quotes, charts and more, in themes you can switch with one click.'],
    ['Everything on the slide', 'Text, shapes, images, tables and charts, with fonts for headings and body.'],
    ['Present', 'A full-screen show with transitions, plus speaker notes only you can see.'],
    ['PowerPoint', 'Import .pptx and export back to PowerPoint.'],
    ['Right-click menus', 'Duplicate, bring to front, edit data and comment from a context menu on any element or thumbnail.'],
  ] },
  { id: 'forms', icon: ClipboardList, name: 'Forms', lead: 'Build together, share a link, and read the answers as charts.', shot: 'form', url: 'docs.example.com/d/customer-feedback', items: [
    ['Question types', 'Short answer, paragraph, single and multiple choice (with Other), dropdown, number, email, link, date, time, linear scale, colour and file upload.'],
    ['Logic', 'Show a question only when earlier answers say so, or jump to another section based on a choice. The same rules run in the browser and on the server.'],
    ['Validation', 'Required, lengths, patterns with your own message, number and date ranges, and min or max selections.'],
    ['Pages and media', 'Multi-page forms, headings, info blocks, images and videos by link.'],
    ['File uploads', 'Up to 3 MB per file, counted to the form owner’s storage, never served inline.'],
    ['Responses', 'A summary with charts, a one-at-a-time view, a table, and a formula-safe CSV export.'],
    ['Access', 'Anyone who can view a form fills it out. Only people you add as editors or managers see responses.'],
  ] },
  { id: 'wikis', icon: BookOpen, name: 'Wikis', lead: 'Documentation with a sidebar, and request blocks readers can send.', shot: 'wiki', url: 'docs.example.com/d/api-reference', items: [
    ['A real sidebar', 'Pages and collapsible folders you can drag to reorder, with a filter, breadcrumbs, previous and next links and an “on this page” outline.'],
    ['Request blocks', 'Method, address, parameters, headers and a JSON, text or form body, with Send, status, timing and formatted replies. Copy as cURL, JavaScript or Python.'],
    ['Try it, safely', 'Readers can change the request and send it. Their changes stay in their browser and never alter the wiki.'],
    ['Variables', '{{baseUrl}} and friends. Shared ones live in the wiki; private ones such as tokens stay on your device.'],
    ['Badges and tables', 'GET, POST, Required, Deprecated, Beta and any label of your own, plus starter parameter and response-code tables.'],
    ['Everything else', 'Version history with page-by-page comparison, the assistant with tools for pages, folders and requests, and voice typing.'],
  ] },
  { id: 'assistant', icon: Bot, name: 'Assistant, voice and proofreading', lead: 'Help when you want it, quiet when you do not.', shot: 'assistant', url: 'docs.example.com/d/q3-launch-plan', items: [
    ['Bring your own model', 'Connect any OpenAI-compatible service under Settings. The key is stored encrypted and never returned to the browser.'],
    ['Approval first', 'The assistant reads freely but shows each edit as a card you approve, or approve for the session.'],
    ['Knows each file', 'It has tools for documents, spreadsheets, slides and wikis, and keeps a history of past conversations.'],
    ['Voice typing', 'Hold a key (Right Ctrl by default, and you can change it) or tap the microphone on a phone, and your words land at the cursor.'],
    ['Proofreading', 'A built-in offline spelling and grammar checker with one-click fixes, in eight English variants. Optional LanguageTool for more.'],
  ] },
  { id: 'collaboration', icon: Users, name: 'Collaboration and sharing', lead: 'Share exactly as much as you mean to.', items: [
    ['Live', 'Cursors, presence avatars and conflict-free simultaneous editing. Connection hiccups are repaired and explained.'],
    ['Works offline-ish', 'Edits made while disconnected are kept and merged when you reconnect, so nobody’s typing is lost.'],
    ['Roles', 'Viewer, Editor, Can manage (sharing and form responses) and Owner. Roles are enforced on the server, not just hidden in the page.'],
    ['Links', 'Anyone with the link, a password, or only specific email addresses. A link can never grant edit access to a form.'],
    ['Folders', 'Share a whole folder, and everything inside inherits it, including later additions.'],
    ['Comments and mentions', 'Threaded comments on text, cells and slides, resolve and reopen, @mentions with notifications.'],
  ] },
  { id: 'organise', icon: FolderTree, name: 'Organise and find', lead: 'A documents screen that keeps up with you.', shot: 'dashboard', url: 'docs.example.com', items: [
    ['Folders and tags', 'Colour-coded nested folders, tags that get their own collapsible sections, newest or oldest first, and filters by tag.'],
    ['Search', 'Search titles and the text inside every file, including wiki pages and form questions.'],
    ['Templates', 'Meeting notes, a project plan, a budget, an invoice, a pitch deck and more, or describe what you need and let the assistant draft it.'],
    ['Right-click everywhere', 'Context menus for files, folders, text, cells and slides, and long-press on touch screens.'],
    ['Stars and recent', 'Star what matters and jump back to what you opened lately.'],
    ['Shortcuts', 'Press ? or Ctrl+/ for the shortcuts of the file you are in.'],
    ['Recycle bin', 'Deleted files wait 30 days and can be restored.'],
  ] },
  { id: 'security', icon: ShieldCheck, name: 'Security and admin', lead: 'The boring, important parts, done properly.', shot: 'settings', url: 'docs.example.com', items: [
    ['Sign-in', 'Bcrypt passwords, optional email confirmation, Google sign-in and TOTP two-factor with recovery codes.'],
    ['Hardened', 'Rate limits on sign-in and uploads, public-only fetching for links and imports, and size limits on everything people send.'],
    ['Storage', 'Per-person limits, a colour-coded breakdown by file and kind, and identical pictures stored only once.'],
    ['Admin panel', 'Manage people, reset passwords and two-factor, look at every file read-only, and set SMTP, Google and quota settings.'],
    ['Your data', 'One SQLite database and one uploads folder. Back it up like any other files.'],
  ] },
]

export function Features() {
  return (
    <MarketingLayout title="Features - KokoDocs">
      <section className="mk-page-head">
        <span className="mk-eyebrow">Features</span>
        <h1>Everything in the box</h1>
        <p>Five kinds of file, one assistant, and the details that make them feel finished. Jump to a section:</p>
        <nav className="mk-chips" aria-label="Sections">{GROUPS.map((g) => <a key={g.id} href={`#${g.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(g.id)?.scrollIntoView({ behavior: 'smooth' }) }}><g.icon size={15} />{g.name.split(',')[0].split(' and ')[0]}</a>)}</nav>
      </section>
      {GROUPS.map((g, i) => (
        <section key={g.id} id={g.id} className={`mk-feature ${i % 2 ? 'alt' : ''}`}>
          <div className="mk-feature-in">
            <header><span className="feat-ico"><g.icon size={20} /></span><h2>{g.name}</h2><p>{g.lead}</p></header>
            {g.shot && <div className="mk-feature-shot"><Frame name={g.shot} alt={`${g.name} in KokoDocs`} url={g.url} /></div>}
            <dl className="mk-list">
              {g.items.map(([k, v]) => <div key={k}><dt><Check size={15} />{k}</dt><dd>{v}</dd></div>)}
            </dl>
          </div>
        </section>
      ))}
      <section className="home-end"><h2>See it for yourself.</h2><p className="lead" style={{ marginBottom: 0 }}>Or read <Link to="/why">why it exists</Link> and <Link to="/self-host">how to run it</Link>.</p><Cta ghost={false}>Create your account</Cta></section>
    </MarketingLayout>
  )
}

# KokoDocs

A modern collaborative document editor. React + TypeScript frontend, Python (FastAPI) backend.

## Run it

```bash
./start.sh      # builds the frontend, serves everything on http://localhost:8000
./dev.sh        # dev mode: API on :8000, Vite on http://localhost:5173
```

Data (SQLite database, uploaded images, signing secret) lives in `backend/data/`.

## What's in it

- **Accounts**: sign up / sign in (bcrypt passwords, JWT sessions, login rate limiting).
- **Editor**: bold, italic, underline, strikethrough, super/subscript, text color, highlight, links, headings 1-6,
  font sizes, alignment, bullet/numbered lists, checklists, quotes, code, dividers.
- **Fonts**: the full Google Fonts catalog (1,950 families), searchable and previewed in their own typeface,
  loaded on demand (also for fonts other people apply).
- **Tables**: rounded, resizable columns, header row, merge/split, cell colors, add/remove rows and columns.
- **Images**: upload, paste or drag in; resize with corner handles; works inside table cells.
- **Pages**: Letter-size pages with a header and footer on every page (`{page}` / `{pages}` tokens),
  shared live between collaborators. Double-click a header/footer to edit it.
- **Document tabs sidebar**: all headings, click to jump.
- **Spelling & grammar**: sidebar with suggestions and in-text underlines.
- **Realtime**: Yjs CRDT over WebSockets. Live cursors with names, presence avatars, conflict-free simultaneous
  editing, reconnect with backoff. The server persists the merged document.
- **Version history**: automatic versions while you edit (about every 10 minutes, and when a session ends), plus
  named versions on demand. Preview any version and restore it; a "Before restoring" copy is saved first.
- **Folders**: nested folders, move via menu or drag and drop. Share a whole folder with people by email
  (view or edit), or with an "anyone with the link" URL (`/f/<id>`, no account needed). Everything inside,
  including subfolders and later additions, inherits that access.
- **Recycle bin**: deleting is reversible for 30 days (restore or delete forever). Folders deleted with documents
  inside send those documents to the bin.
- **Export**: the Download button in the top bar. Documents: PDF, Word (.docx), Markdown, HTML, plain text.
  Spreadsheets: Excel (.xlsx, with formulas and formatting), CSV (as shown, or plain values), TSV, JSON, HTML, PDF.
  PDF opens the browser print window (choose "Save as PDF"), keeping fonts, tables, images and your page
  headers/footers with page numbers. Word and Excel files are generated in the browser and load on demand.
- **Voice typing**: hold a key (Right Ctrl by default; changeable, F-keys and lone
  modifiers work), speak, release. A floating pill with a live waveform shows while you talk, then the text is typed
  at the cursor. Also available as a click-to-dictate button in the toolbar. See "Voice typing setup" below.
- **Spreadsheets** (KokoSheets): New menu -> New spreadsheet. A real formula engine (parser, ranges, cross-sheet
  references, array math, dynamic arrays like FILTER/SORT/UNIQUE that spill, 370+ functions), multiple sheets,
  fill handle and series, copy/paste (also to and from Excel / Google Sheets), number formats, borders, merge,
  freeze panes, resize, sort, charts, CSV import and export, undo, live cursors. Same sharing, folders, bin and
  version history as documents. The engine and model are unit tested: `cd frontend && npm test`.
- **Sharing**: add people by email (viewer/editor), anyone-with-link (viewer/editor), password-protected link,
  or restricted to specific email addresses (they must sign in with that address). Viewers are read-only
  server-side, not just in the UI.

## Configuration (environment variables)

| Variable | Purpose |
| --- | --- |
| `KOKO_SECRET` | JWT signing secret (otherwise generated once into `backend/data/.secret`) |
| `KOKO_DATA_DIR` | Where the database and uploads live |
| `KOKO_CORS` | Comma-separated allowed origins if the frontend is hosted elsewhere |
| `KOKO_LANGUAGETOOL_URL` | Optional [LanguageTool](https://languagetool.org) server for much stronger grammar checking |

Proofreading uses a built-in offline checker by default, so document text never leaves your server.
Point `KOKO_LANGUAGETOOL_URL` at a self-hosted LanguageTool for deeper grammar rules.

## Voice typing setup

The browser records a short WAV and the server turns it into text. Pick one provider (first configured wins,
or force one with `KOKO_STT_PROVIDER=mistral|openai|openai-compatible|local`):

| Provider | How to enable | Notes |
| --- | --- | --- |
| Mistral (Voxtral) | `MISTRAL_API_KEY=...` | model `voxtral-mini-latest`; change with `KOKO_STT_MODEL` |
| OpenAI | `OPENAI_API_KEY=...` | model `whisper-1` (or `KOKO_STT_MODEL`) |
| Any OpenAI-compatible server | `KOKO_STT_URL=https://host/v1` (+ `KOKO_STT_KEY`, `KOKO_STT_MODEL`) | e.g. a self-hosted Whisper server |
| Local, no key, audio never leaves your server | `pip install -r requirements-local.txt` | `KOKO_WHISPER_MODEL`: `tiny.en` (~75 MB), `base.en` (~150 MB, default), `small.en` (~480 MB). CPU only |

`KOKO_STT_LANGUAGE=en` pins the language (otherwise auto-detected for remote providers; local `*.en` models are English).
Only people who can edit a document can use it, and requests are rate limited (20 per minute per person).

## Layout

```
backend/app/   main.py  routes.py (REST)  collab.py (WebSocket sync)  access.py (permissions)  proofread.py
frontend/src/  editor/ (Tiptap extensions, toolbar, dialogs)  pages/  collab.ts  fonts.ts
```

## Upgrading

The database upgrades itself on start (new tables and columns are added, existing documents are kept).

## Known limits

- Pagination breaks between blocks (a paragraph is never split across pages; a table taller than a page overflows).
- Printing uses the browser's own pagination, so on-screen headers/footers are not reproduced in the printout yet.
- Put it behind HTTPS in production (the WebSocket carries the session token as a query parameter).

## AI assistant, comments, admin

- **Assistant** (Assistant button in documents and spreadsheets): connect any OpenAI-compatible service under the gear icon, or set a server default with `KOKO_AI_URL`, `KOKO_AI_KEY`, `KOKO_AI_MODEL`. Keys are stored encrypted (derived from `SECRET`). Local model servers (Ollama, LM Studio) need `KOKO_AI_ALLOW_PRIVATE=1`.
- **Comments**: select text, click Comment, use `@email` to mention someone.
- **Callouts**: toolbar button, or type `[!tip] ` at the start of a line. Markdown `> [!tip] Title` is understood by the assistant and exported.
- **Custom callouts**: pick "Custom" in the callout type menu, then set the Background and Accent colours with the colour picker (recents included). Dark backgrounds automatically get light text; colours carry into HTML and DOCX exports.
- **Forms**: *New form* creates a form you build with others in real time. Question types: short answer, paragraph, single choice and multiple choice (checkboxes, both with "Other"), dropdown, number, email, link, date, time, linear scale, plus headings, info blocks (text only, nothing to answer), image and video blocks (images by upload or link; videos only by link: YouTube, Vimeo or a direct .mp4/.webm, never hosted here) and page breaks for multi-page forms. Per-question validation: required, min/max length, a regex pattern with your own error message, number min/max/whole numbers, date range (with a built-in calendar picker), and min/max selections. Validation runs in the browser and again on the server. Anyone who can **view** a form fills it out (people you add as "Can fill out", or anyone with the link / password); only "Can edit" people can change it or read responses, and a link can never grant edit access on a form. Settings: close the form, require sign-in, one response per person, confirmation message. The Responses tab has a summary with charts, a one-at-a-time view, a table, delete, and CSV export (formula-safe). `KOKO_FORM_RATE` sets submissions per minute per person/IP per form (default 20).
- **Right-click menus**: every file and folder in My documents, Shared with me, Starred, the recycle bin and the Recent cards has a context menu (Open, Open in a new tab, Star, Tags, Copy link, Share, Rename, Move, Delete or Restore, and a colour row for folders). Right-clicking empty space in My documents offers *New document, spreadsheet, presentation, form* and *folder*. It also opens with the Menu key or Shift+F10 on a focused row, with arrows and Enter to choose, and on phones with a long press. (`frontend/src/ui/ContextMenu.tsx`)
- **Tags and sorting**: tag any file or folder (*Tags…* in the right-click or ⋯ menu): up to 12 per item, 30 characters each, shown as coloured chips on the row (click one to filter by it). Tags are personal, like stars: nobody you share with sees them, and you can tag files shared with you. Above the list: **Newest** / **Oldest** (by last modified; folders by created) and **Tags**, which gives every tag its own collapsible section (an item with two tags appears in both, untagged ones are last; your choice and which sections are closed are remembered). *Filter by tag* narrows the list, and *Manage tags…* renames (renaming onto an existing tag merges them) or removes a tag everywhere. (`backend/app/tags.py`, `frontend/src/pages/TagDialogs.tsx`; tests: `test_tags.py`, `tags.test.ts`)
- **Can manage role**: a fourth access level between *Can edit* and the owner. A manager can do everything an editor can, change who has access (add, remove, promote, link settings), and on forms see and delete responses; managers also delete other people's comments. Only the owner can delete a file, restore it from the recycle bin, or erase it. A manager saving the list can never lock themselves out, the owner can't be removed or demoted, and a link can never grant manage (or, on forms, even edit). Available on documents, spreadsheets, presentations and forms; folders still share as view or edit. (`access.py`; test: `test_manager.py`)
- **Colours in forms**: a *Colour* question lets people pick a colour with the same picker documents use (presets, recent colours, any custom colour); the answer is a hex code, shown with a swatch in the responses and counted by colour in the summary. Separately, *Settings, Appearance, Accent colour* themes the whole form for everyone who fills it out: the header bar, buttons, progress bar and selected answers follow it, with readable text chosen automatically. Invalid colours are rejected on the server, and never passed on as styling.
- **Share dialogs on phones**: the share dialogs (documents, forms, folders) fit the screen: the address field gets its own line with the permission and Add button underneath, long addresses are shortened with an ellipsis, and the access cards wrap their text instead of scrolling sideways.
- **Word count pill**: a pill floats at the bottom of every document with its words and pages (and how many people are editing). While you have text selected it turns dark and shows the selection's words and characters ("9 words · 43 characters · selected of 26"), counting several table cells together; hover it for the count without spaces. It's shown on phones too (above the size and microphone buttons) and never intercepts clicks. (`frontend/src/editor/StatsPill.tsx`)
- **HTML export is self-contained**: emoji are drawn with Twemoji artwork and callouts keep their icons, with nothing fetched from KokoDocs. Only what the document uses is included: each emoji used appears once in the page's CSS (as a small inline SVG) however often it is repeated, and only the icons of the callout kinds present are added. The emoji character stays as the text of each emoji, so copying, searching and screen readers still work, and emoji inside code stay plain text. The PDF print view uses the same page, so printed emoji match. (`frontend/src/export/htmlAssets.ts`, test: `export-assets.test.ts`.) Also fixed: typing an emoji inside a code block no longer splits the block.
- **Irregular tables**: in documents, cells can span several columns or rows, so rows can have different numbers of cells. Put the cursor in a cell and use *Join with the cell to the right* or *below* (no dragging, so it works on a phone), or drag across cells and press *Merge cells*; *Split cell* undoes it. Word export keeps the spans, and Word import reads them, including rows that start later, end early or have fewer cells than the grid (those stretch their first or last cell over the gap, because the editor's tables are rectangular). Markdown export (which has no merged cells) keeps columns aligned by leaving the covered cells blank. Test: `frontend/tests/tables.test.ts`.
- **Dropped connections**: if you go offline (or the connection dies) and a friend keeps editing, nothing is lost. Your edits stay in the open document, and when you reconnect both sides are exchanged and merged by Yjs, so both of you end up with identical text containing everyone's changes (two people typing in the same spot are both kept, in a stable order). The provider (`frontend/src/collab.ts`) reacts to the browser's online/offline events straight away, uses a heartbeat (`ping` frames the server echoes, see `collab.py`) to spot a connection that died silently within about 6 to 16 seconds, reconnects within a fraction of a second once the network is back, and tells you what is going on: the status chip says *Offline* or *Reconnecting*, after two seconds a pill says how many changes are waiting, and on return a message says whether others' edits were merged in. Limits: edits live in the open tab, so closing or reloading the page while offline loses what hasn't synced yet (saving them on the device is the next step), and only documents, spreadsheets, presentations and form building sync this way.
- **Link pill**: pointing at (or tapping) a link in a document shows a small dark pill under it with the address and buttons to open, copy, edit or remove the link. Editing happens inside the pill; read-only viewers only get open and copy.
- **Word import**: `.docx` files are read directly (`frontend/src/import/docx.ts`) so formatting survives: fonts (Word's own fonts are mapped to look-alikes such as Calibri to Carlito, Times New Roman to Tinos), sizes, text and highlight colours (including theme colours), bold, italic, underline, strike, super and subscript, capitals, alignment, headings, nested bullet and numbered lists, links, tables with merged and shaded cells, and pictures. Not imported: text boxes, headers and footers, footnotes, indentation and spacing, tracked deletions. If a file can't be read this way, the older plain converter takes over. Test: `frontend/tests/docx-import.test.ts`.
- **File uploads on forms**: a *File upload* question lets people attach one file of up to 3 MB (the question can lower that to 1 or 2 MB, and limit it to images, PDFs, or documents and PDFs). Files are stored in `data/form-files/` under random names, count toward the **form owner's** storage (the uploader's doesn't change), and are removed when the response, the form, or the owner's account is deleted. Only people who can edit the form can download them, always as an attachment (never displayed in the browser). Programs, scripts, web pages and SVGs are refused whatever the question allows, "images" and "PDF" questions check the file really is one, and uploads nobody submitted are swept after 24 hours. If the owner is out of space the visitor sees a polite "can't accept files right now" without learning anything about the owner's quota. `KOKO_FORM_UPLOAD_RATE` sets uploads per minute per person/IP per form (default 12). Tests: `backend/tests/test_form_files.py`.
- **Presentation fonts**: text in slides can use any of the ~1,950 Google Fonts through the same searchable picker as documents, and *Fonts* in the toolbar sets the heading and body font for the whole deck (text with its own font keeps it). The assistant can set fonts too.
- **Form logic**: any block can be set to "Show only if…" one or more earlier answers (is, is not, contains, greater/less than, answered, empty; match all or any). Single-choice and dropdown questions can send people to a later page, or straight to submit, depending on the option picked. Hidden questions and skipped pages are never required and their answers are never stored. The same rules run in the browser (`frontend/src/forms/flow.ts`) and on the server (`compute_flow` in `backend/app/forms.py`), with identical test cases on both sides; change one, change the other.
- **Pickers**: dates and times use KokoDocs' own pickers (`ui/DatePicker.tsx`, `ui/TimePicker.tsx`) instead of the browser's.
- **Keyboard shortcuts**: press `?` (when not typing) or Ctrl/Cmd+/ anywhere for a cheat sheet that opens on the tab for the file you're in.
- **Compare versions**: in Version history, open a version and press *Show changes* to see what that version changed, or what has changed since it. Documents are compared line by line with word-level highlights; spreadsheets by cell; presentations by slide element.
- **How versions are stored**: a version keeps only what changed since the one before it (Yjs edit records), with a full copy every 20 versions so opening one never replays a long chain. Each version is checked against its recorded state when it is rebuilt, and when it is saved, so damage is caught rather than served. Pruning old automatic versions folds their changes into the next one. History saved by older releases is converted automatically, once, in the background after the first start (verified version by version). SQLite keeps the file size until you reclaim it: stop the app and run `sqlite3 backend/data/kokodocs.sqlite3 VACUUM` if you want the space back on disk. Tests: `backend/.venv/bin/python backend/tests/test_version_deltas.py` (needs no server).
- **Mention emails**: `@email` in a comment emails that person (unless they turned it off in Account security) as soon as the admin has saved an SMTP host and From address; unlike sign-up codes, it doesn't wait for a test email. People who are on the share list but have no account yet are emailed too. An address that isn't shared on the file is never emailed (so comments can't be used to send mail to strangers), and the commenter gets a toast saying so. Mentioning yourself also emails you, which is handy for testing. Every skipped or failed mention is written to the server log ("Mention of … skipped", "Mention email to … failed/not sent"). Test: `backend/tests/test_mention_email.py` (needs the server and `tests/mock_smtp.py 2525`).
- **Admin panel** at `/admin`: accounts whose email is in `KOKO_ADMIN_EMAILS` (default `koko@kokodev.cc`) are admins and can promote, suspend, reset passwords for and delete users. Registration has no email verification, so create that account first on a new server.

### Sign-in options (admin panel, Settings tab)
- **Sign-ups**: a switch that closes registration for everyone, including Google. Existing users can still sign in.
- **Google sign-in**: create an OAuth client (Web application) in Google Cloud Console, add the redirect URI shown in Settings (`https://your-domain/api/auth/google/callback`), paste the client ID and secret. The secret is stored encrypted. If the shown URI is wrong behind your proxy, set the Public URL. Make sure nginx forwards `X-Forwarded-Proto` and `Host`.
- **Two-factor (TOTP)**: every user can turn it on under avatar menu, Account security (QR code, manual key, 8 one-time recovery codes). Admins can reset a user's 2FA from the Users tab.
- **Moderation**: the Files tab lists everyone's documents and spreadsheets (including recycle bin), lets admins open any file read-only, and delete files permanently.

### Storage limits
Each user gets 500 MB by default (documents, spreadsheets, version history and uploaded images; files shared with you count against their owner). Admins change the default under Admin, Settings, and set a custom limit per user (0 = unlimited) with the drive icon in the Users tab. Uploads and manual versions that would pass the limit are refused, automatic history stops being saved, and live editing is never cut off. Users see their usage under Account security.

### Email (optional)
Admin, Settings, Email (SMTP): enter your mail server, then press "Send test email to me". Once a test email is delivered, email switches on: new accounts must confirm their address with a 6-digit code (valid 10 minutes, 5 tries, resend every 30 seconds), and a "Forgot password?" link appears on the sign-in page. Changing any SMTP setting switches it off until the next successful test, so a broken mail setup can't lock people out of signing up. Without email configured, nothing changes. Google sign-ups skip the code because Google already verifies the address. The SMTP password is stored encrypted.

### Emoji
Emoji are drawn with Twemoji SVGs, self-hosted (nothing is fetched from a CDN). `npm run build` packs all of them into one lazy chunk (`emoji-pack`, about 1.5 MB over the wire) that the editor loads quietly when idle, so the picker opens instantly with no per-emoji requests; the individual files in `frontend/public/twemoji` remain as a fallback. The backend now gzips text responses (the JS bundles shrink about 70%), which this chunk relies on; if you put nginx in front, make sure it doesn't strip `Content-Encoding`. In documents each emoji is a small node that exports back to the plain character (Markdown, text, Word, HTML).

### Presentations
Dashboard, New, New presentation. Slides are 16:9 with text boxes, shapes, images, six themes, 13 layouts (title, bullets, two columns, three cards, key numbers, one big number, quote, steps, split, section, closing), speaker notes and fade or slide transitions. Drag to move, use the handles to resize (hold Shift to keep proportions), double-click text to edit, Ctrl+C/V/D to copy, paste and duplicate, and arrow keys to nudge. **Present** plays the deck full screen (arrow keys, space or tap to move, N for notes, Esc to leave). Download as PowerPoint (.pptx), PDF (one slide per page), or a Markdown/text outline. Live editing with other people, sharing, version history, the recycle bin and the assistant work the same as for documents (comments are not available on slides yet).

### Search, notifications, import, comments everywhere
- **Search** (Ctrl/Cmd+K anywhere, or the search box on the documents screen): finds files by title and by what is written inside them (document text, spreadsheet cell values, slide text and speaker notes). Uses SQLite FTS5, updated whenever a file is saved; files that predate it are indexed in the background at start-up. Only files you own or were shared directly (or via a shared folder) appear; public-link files don't show up in strangers' results.
- **Notifications**: the bell on the documents screen lists mentions, comments on your files and replies to your threads, and new shares. When email is set up, a mention also sends an email (each person can switch that off under Account security).
- **Import** (New, Import a file, or drop a file on the documents screen): Word (.docx, with pictures), Markdown, HTML and text become documents; Excel (.xlsx, with formulas, bold, fills, column widths and every sheet) and CSV/TSV become spreadsheets; PowerPoint (.pptx: text, shapes, pictures, tables, notes; charts are skipped) becomes a presentation. Parsing happens in the browser.
- **Comments on spreadsheets and slides**: select a cell (or a slide or an element), open Comments and write. Cells get a yellow corner, slides a badge and pin; mentions, replies and notifications work as in documents.
- **Slides** can now contain **tables** (type straight in, Tab and Enter move between cells) and **charts** whose data you type into a small grid (columns, bars, line, area, pie). Both export to PowerPoint as native, editable tables and charts.

### Templates, starred and recent
On the documents screen, "Start something new" offers a few popular templates, and "All templates" opens the gallery: 14 templates across documents (meeting notes, project plan, one-page report, weekly to-do, cover letter, study notes), spreadsheets (monthly budget with working totals, project tracker, weekly schedule, invoice, grade book) and presentations (pitch deck, weekly update, class presentation), plus blank files and a "describe what you need" box that opens a new file with the assistant already drafting it. Templates are defined in `frontend/src/templates/catalog.ts` (add yours there). The star next to any file keeps it in the Starred tab, and the Recent row remembers what you opened lately.

## Settings page

Avatar menu, *Settings* (or `Ctrl+,` / `Cmd+,`) opens a full-page settings screen with a sidebar, floating above whatever you were doing (Esc or the round close button returns you; on phones it becomes a list that opens each section). Sections: **My account** (display name, sign out, delete account), **Security** (password, Google link, two-factor), **Notifications**, **Storage** (a multi-colour bar for text and data, images, form uploads and version history, with the size of each, then every file you own with its own coloured bar and breakdown; bin items are marked; `GET /api/me/storage/items`), **Appearance** (light, dark or match system, and the shortcut sheet), **AI assistant** (your own connection) and **Voice typing** (push-to-talk key). `PUT /api/me/profile` changes the display name.

## Wikis

*New wiki* creates a documentation site: a collapsible **contents sidebar** of pages and folders (drag to reorder or drop into a folder, right-click for rename, move, delete and a method badge shown next to the page), a filter box, breadcrumbs, previous/next links, and an "On this page" outline. Pages use the same editor as documents (live cursors, tables, images, callouts, code). Type `/` for the extras:

- **API request** blocks: method, address, parameters, headers and a JSON/text/form body, a **Send** button with status, time, size, pretty-printed body and headers, **Copy as cURL / JavaScript / Python**, and a saved *example response*. Nothing about it is tied to one API, it is just an HTTP request you can document.
- **Badges** inside text (GET, POST, PUT, PATCH, DELETE, Required, Optional, Deprecated, Beta, New, or any word; double-click to rename), and starter **Parameters** and **Response codes** tables.
- **Variables** (top bar): `{{baseUrl}}` style placeholders for requests. Shared variables live in the wiki; *Only in this browser* variables (an API key, say) are kept on your device and never saved in the wiki.

Anyone who can open the wiki can change a request's address, headers, parameters or body and press Send; for people who can only view it the changes stay in their own browser (a *Reset* button restores what the author wrote). Requests go straight from the browser; if the other server doesn't allow that (CORS), signed-in people get a *Send from KokoDocs server* button that uses `POST /api/wiki/proxy`. The proxy only reaches the public internet (loopback, private, link-local and cloud-metadata addresses are refused, redirects are checked hop by hop), caps replies at 2 MB and 20 seconds, drops cookies, and is rate limited to 60 calls a minute per person. Wikis share and search like other files, and page text is searchable from the documents screen.

**Version history** works as in documents (automatic versions, named versions, restore with a "Before restoring" copy saved first). Opening a version shows that version's own contents list and pages, read-only; *Show changes* compares it with the one before it or with now, page by page. Restoring puts back every page, folder, the wiki title and shared variables as an ordinary edit, so people editing at the time see it happen.

**Assistant** (the Assistant button, once you have connected a model under Settings): it reads the contents (`list_pages`), searches all pages, and reads pages as Markdown. Request blocks appear as a fenced `api-request` block holding their settings as JSON, and badges as `[[badge:Required]]`. With your approval it creates and reorders pages and folders, edits, inserts or rewrites text on any page (not only the open one), adds and edits request blocks, sets method badges and shared variables, and renames or deletes items. It never sees private variable values, never sends requests, and is told not to put keys into shared variables or request blocks.

## Right-click menus and pasting

Documents, slides, sheets and the files list have context menus (long-press on touch). Pasting from Google Docs, Word or a web page brings pictures along: remote images are fetched by the server (`POST /api/docs/{id}/images/import`, public addresses only, 12 MB limit, counted to the owner's quota) and stored with the document so they keep showing when the original link expires. `KOKO_IMPORT_ALLOW_PRIVATE=1` lifts the public-only rule and exists for the tests only; never set it in production.

## Nested checklists

In documents and wikis, press Tab inside a checklist item to nest it under the item above (Shift+Tab moves it back out), or use the indent buttons that appear in the toolbar while the cursor is in a list. A parent shows a dash while only some of its children are done, ticks itself automatically when the last child is ticked, and un-ticks again if one is cleared. Ticking a parent ticks everything under it.

## Duplicate pictures

Pictures are stored once per owner. Adding the same picture again (same bytes), in the same file or another one, reuses the stored copy: it gets the same address and uses no extra storage. A picture is only deleted when the last file using it is permanently deleted. Existing uploads are fingerprinted automatically the first time the new version starts (pictures stored twice before this update stay as they are). Different people never share a copy, so quotas stay per person.

Every time the server starts it also looks for pictures a person already has stored twice (older versions did that) and merges them in the background: the oldest copy is kept, byte-for-byte verified, and each duplicate address becomes an alias to it, so documents that point at either address keep working while the extra file is deleted and the person's storage goes down. The server log reports what was freed. Pictures belonging to different people are never merged.

## Spelling variants

The Spelling & grammar panel has a **Language** menu: English (US), UK, Canada, Australia, New Zealand, South Africa, Ireland and India (it starts on your browser's language when that is one of them, and remembers your choice on that device). With the built-in checker, UK, Australia, New Zealand, South Africa, Ireland and India accept British spellings (colour, centre, organise or organize, travelling, catalogue, aluminium…) and flag American-only ones with the British form as the suggestion; Canada accepts both; US keeps flagging British spellings but now suggests the American word first. The chosen code is also sent to LanguageTool when `KOKO_LANGUAGETOOL_URL` is set. Rules live in `backend/app/dialects.py`; `python tests/test_dialects.py` (from `backend/`) checks them.

## Public pages

Signed-out visitors see a marketing site: the home page (product tour with a tab for each kind of file, six feature spotlights, phone and dark-mode views, FAQ), `/features` (every feature by area), `/why` (why self-host, plus a side-by-side table) and `/self-host` (run it, systemd, Caddy and nginx snippets, the main settings). The screenshots are real captures of the app in `frontend/public/shots/` (including `board` and `board-roadmap` for boards) (`<name>.jpg` and `<name>-dark.jpg`; the one matching the visitor's theme is shown). To refresh them after the interface changes, replace those files with new captures at the same names.

## Shapes in documents

The toolbar's shapes button (or `/shape` in the slash menu) drops a rectangle, rounded rectangle, ellipse, triangle, diamond, hexagon, star, arrow or line into the text, like a picture. Click one to open its menu: change the shape, fill colour, outline colour and thickness, type a label (or double-click it), and align it. Drag the corner to resize (hold Shift to keep the proportions). Shapes also work in table cells and wikis. They are saved as part of the document, appear as real SVG in HTML and PDF export, and become pictures in Word export.

## Importing from Notion

In a wiki, the upload-arrow button above the contents opens **Import from Notion**. In Notion choose ⋯, *Export*, format **Markdown & CSV** (include sub-pages), and drop the downloaded .zip in (large exports arrive as zips inside a zip, which is fine; loose .md, .html and .csv files work too). You see how many pages, folders and pictures were found, then choose whether to bring the pictures and whether to put everything in one folder.

What comes across: the page tree (a page with sub-pages becomes a folder holding the page and its children), headings, lists, checklists, tables, code, quotes, links, callouts (the emoji picks note, tip, warning and so on), toggles (as a bold title and its content), pictures (uploaded to the wiki, identical ones stored once), links between pages (rewritten to open the imported page), databases (the table as a page, up to 200 rows, with each row as a page whose properties are a small table). Files such as PDFs are not imported, and the page says where they were. The conversion happens in your browser, and nothing is sent anywhere except the pages and pictures that go into the wiki. The page list and text conversion are covered by `frontend/tests/notion.test.ts`.

The built-in spell checker leaves short forms alone: units and measures (km, cm, ft, kg, mph, GB, GHz, dpi, kWh…), times (am, pm), days and months (Mon, Jan, Sept), titles and company endings (Dr., Prof., Ltd.), everyday abbreviations (etc., approx., avg., dept., info), and ones attached to a number (5km, 10am, 2nd, 4x). The list is `SHORT_FORMS` in `backend/app/proofread.py`; add your own there.

## Wiki tabs and toolbar buttons

Wiki pages can hold **Tabs**: a row of panels that show one at a time, for things like cURL / JavaScript / Python or Windows / macOS. Each panel holds any blocks (text, tables, code, request blocks). Click a tab to switch (readers' choice is just their own view), double-click a tab name to rename it, use + to add a panel and × to remove the open one. Insert them from the toolbar, or type `/tabs`. In Markdown (the assistant, exports) they are written `:::tabs`, then `::tab Title` followed by the panel's content for each panel, then `:::`.

The wiki editor's formatting toolbar also has buttons for the things that used to need the `/` menu: **API request**, **Tabs**, **Badge** (a menu of GET, POST, Required, Beta and so on) and **Parameters table**.

## Theme

Settings, Appearance offers **System**, **Light** and **Dark**. System is the default: it follows the device and changes live when the device switches (for example at sunset). The sun/moon button in every header flips between light and dark and counts as an explicit choice, so it stops following the system until you pick System again. The theme is applied before the page paints, so there is no flash of the wrong one.

## Voice typing from the admin dashboard

Admin, Settings, **Voice typing**: choose the provider from a dropdown (Automatic, **Groq**, Mistral, OpenAI, any OpenAI-compatible server, or Local), paste its API key, pick a model and Save. The key is stored encrypted and never shown again; **Test** sends a second of silence to the service so a wrong key or model shows up there. For Groq the models are `whisper-large-v3-turbo` (the default, fast) and `whisper-large-v3` (most accurate). Local runs faster-whisper on the server (choose tiny.en to large-v3; `pip install -r requirements-local.txt`) and audio never leaves it. An optional language code (like `en`) pins the language; empty detects it. A choice made here wins over the environment variables; "Automatic" falls back to them (`GROQ_API_KEY` is now recognised too). Tests: `backend/tests/test_stt_admin.py`.

## Voice typing on the public pages

The home page has its own **Voice typing** section (and `/features#voice` a matching one): a looping GIF of holding a key, speaking and the sentence appearing, in light and dark (`frontend/public/shots/voice-typing.gif` and `voice-typing-dark.gif`), and a **Test your microphone** button that shows the sound coming in as a live waveform. The test only listens in the browser: nothing is recorded, saved or sent, and it stops by itself after 30 seconds. The GIFs are drawn from `frontend/src/marketing/VoiceDemo.tsx`; with `npm run dev` the page `/__demo/voice?t=<milliseconds>` shows any moment of it, which is how the frames are captured (then joined with ffmpeg at 12 frames a second).

## Hugging Face models on disk (local voice typing)

With the **Local** provider selected, Admin, Settings, Voice typing shows **Models on this server**: everything stored on disk with its size, a **Use** button, a bin button that deletes it from disk (freeing the space, including the shared weights file), and **Add a Hugging Face model** (a name like `Systran/faster-distil-whisper-small.en`, or paste the page link). It downloads in the background with a progress bar. Models are kept in `<data folder>/stt-models` (change with `KOKO_STT_MODELS_DIR`; limit per model `KOKO_STT_MODEL_MAX_MB`, default 4096), and the server needs internet access to add one.

Local voice typing runs faster-whisper, so a model must be in **CTranslate2** format (a `model.bin` next to `config.json`) and public. The original `distil-whisper/distil-small.en` is not: adding it explains that and offers the converted `Systran/faster-distil-whisper-small.en` with a button. Models downloaded before this feature, into the default Hugging Face cache, are not listed; they download again into the new folder the first time they are used. Tests: `backend/tests/test_stt_models.py` (downloads a 75 MB model, so it needs internet).

Wiki pages are proofread like documents: a **Proofread** button in the wiki's top bar (with a count) opens the Spelling & grammar panel, mistakes are underlined, and right-clicking one offers the fixes. The same language menu (US, UK, Canadian and other English) applies. In a Tabs block, click the open tab's name again (or the pencil) to type a new name in place; Enter saves, Escape cancels, and an empty name keeps the old one.

## Phones: steady scrolling

Documents and wiki pages keep what you are reading in the same place when the page above it changes height (someone else typing above you, page breaks moving, pictures loading): `frontend/src/editor/ScrollAnchor.ts` remembers which block is at the top of the screen and scrolls back by however far it moved. Safari on iPhones has no scroll anchoring of its own, which is where this showed most. Smooth scrolling was taken off the page area, so scroll corrections happen instantly instead of as a visible glide. While the on-screen keyboard is open the editor is sized to the space above it (`ui/KeyboardFit.tsx`, and `interactive-widget=resizes-content` for Android Chrome), so the caret is never hidden under the keyboard. Your own typing is left to the editor, which keeps the caret in view.

## Phones: the formatting bar above the keyboard

In documents and wikis on a phone, the formatting bar is a floating pill at the very bottom of the page (the header stays at the top). When the on-screen keyboard opens, the pill rides just above it, so you can change text size, add checklists, pick colours and so on without ever closing the keyboard. Pressing or dragging the pill sideways to reach more buttons does not take focus from the page, so the caret and keyboard stay put (`keepFocus` in `frontend/src/editor/Toolbar.tsx`). Menus opened from the bar open upwards, clear of the bar, inside the visible area (`ui/Popover.tsx`, `ui/viewport.ts`). A *Hide keyboard* button at the end of the bar is the one way to close it, besides tapping out of the page. While the keyboard is open the header actions and word-count pill step aside. A selected picture or shape is scrolled into view with its menu. Sheets, slides and forms do not use this bar yet. Checked in a phone-sized emulation (`mobilebar` script); the real iPhone keyboard could not be tried.

To keep iOS's Cut / Copy / Paste callout (drawn above the selection) off the bar, a selection or freshly tapped caret near the bottom is scrolled into the upper half of the visible page while the keyboard is open (`ui/KeyboardFit.tsx`). Typing is not moved.

## Boards (kanban)

*New → New board* makes a kanban board: columns you can rename, recolour, reorder and delete (a deleted column's cards move to its neighbour), and cards you drag between and within columns (mouse anywhere on the card; on a phone by the grip at its corner so the column still scrolls). Several people can work on one board live, and a *Filter cards* box narrows what is shown. Viewers see everything but can't change it.

**Custom fields** (the *Fields* tab) are the details every card carries: text, number, date, single select, multi select, checkbox and link. For each field you choose its name, whether it is **required** (a card can't be added until it is filled in, and cards that miss it show a warning chip), whether it shows on the card face, and limits: a number's minimum and maximum, a date's earliest and latest (or *No past dates*), and the options and colours of selects. A new board starts with *Priority* and *Due date*. Cards also have a description, held as plain text.

Code: `frontend/src/board/{model.ts,BoardEditor.tsx,board.css}`; the board is a Yjs doc (`colOrder`/`cols`, `fieldOrder`/`fields`, `cards`). Tests: `backend/tests/test_board.py`. **Views** (tabs along the top, remembered per browser; all show the same cards and share the *Filter cards* box):
- **Board**: the kanban columns.
- **Table**: one row per card with every field, click a header to sort (again to reverse, a third time to clear), *Download CSV*.
- **Roadmap**: a timeline grouped by column. Pick which date fields are the *Start* and *End* (or one field, so cards are single days); drag a bar to move it and its edges to change the dates; zoom by days, weeks or months. Cards without dates are listed under the timeline. The choice of fields is shared with everyone on the board.
- **Calendar**: a month grid placing cards on a chosen date field; the **+** on a day adds a card with that date filled in.

**Comments**: every card has its own comment thread, in a column on the right of the card dialog (underneath it on a phone), with @mentions that notify like comments in documents, a count on the card, and your own comments deletable. They are ordinary comments whose anchor is `{card: <id>}`; deleting a card deletes its comments.

Not yet: version history, rich-text descriptions, grouping or colouring the board by a field other than the column.

## Comments arrive over the websocket

Comments are no longer polled. When one is added, resolved or deleted, the server sends a 2-byte frame (type 3) down the document's existing websocket to everyone connected (`notify_comments` in `backend/app/collab.py`, called from `backend/app/comments.py`). The browser answers by fetching the list once (`koko:comments` event from `frontend/src/collab.ts`, handled in `useComments`), and does the same when the socket reconnects, so anything said while you were away appears. Comments in documents, spreadsheets, presentations and boards all use this.

## Live voice preview

While you hold the dictation key, the usual one-line pill shows the newest words as you say them (the start fades away as it fills), with a small waveform beside it. The preview is written by a small model on your own server (faster-whisper `tiny.en`, or `tiny` when a language other than English is set), so it costs nothing and sends no audio to a third party. About once a second the browser sends the last 14 seconds to `POST /api/docs/{id}/transcribe/draft`, one request at a time. It is only shown: when you release the key, the whole recording goes to the provider the admin chose, and *that* text is what is inserted. Drafts can therefore differ a little from the final text.

It needs `faster-whisper` on the server (`pip install -r requirements-local.txt`); without it the pill keeps its old look (waveform and label). Whichever provider the admin picked, the preview always comes from a small local model: the tiny one by default, or any model already downloaded on the server that the admin chooses under *Admin → Voice typing → Live preview → Model that writes the live preview* (a bigger one is more accurate but slower, so the preview may lag, and it uses more memory while loaded; an English-only model is not used when a different language is set, the multilingual tiny is then). Admins can switch it off for everyone under *Admin → Voice typing → Live preview while speaking*, and each person can turn it off for themselves (the mic menu in the editor, or *Settings → Voice typing → Show words while I speak*; remembered in the browser). The first preview downloads the tiny model (about 75 MB) if it isn't there yet. Previews have their own, larger rate limit than the final transcription. Tests: `backend/tests/test_stt_draft.py`.

## Emoji that fail to load heal themselves

Emoji are pictures: drawn from the embedded pack once it has loaded, and before that from individual files (`/twemoji/<code>.svg`). A picture that failed (its file missing on the server, the server restarting during an update, a dropped connection) used to stay a broken-image icon until the page was reloaded. `installEmojiRecovery()` in `frontend/src/emoji.ts` now swaps a failed picture to the pack at once, so **the `twemoji` folder isn't needed on the server** (it's only a fallback while the pack loads, and a few early emoji may show a moment late without it). If the pack can't load either, it retries the file twice, then shows the plain emoji character. A missing `/twemoji/` file gets a real 404 rather than the app's home page, and real files are cached for a year.

## Telling open pages the site was updated

Every build gets an id (a hash of the names of everything it produced) that is written into `index.html` (`<meta name="koko-build">`) and into `dist/version.js`, a file whose name never changes (the plugin is in `frontend/vite.config.ts`). Open pages fetch `/version.js` every minute, when they come to the front, and when they come back online (`frontend/src/ui/UpdateNotice.tsx`). If its id differs from the one the page was loaded with, a small "KokoDocs was updated" pill with a **Reload** button appears. It doesn't reload by itself, because that could interrupt someone typing in a form. The one exception: if a lazy-loaded file has vanished (which happens to pages left open across an update), the page reloads once on its own, since it is broken anyway; if that doesn't help it shows the button instead of looping. The server sends `version.js` with `Cache-Control: no-store`; if you put a cache or CDN in front, make sure it doesn't hold on to that one file.

## Spelling dictionary

The built-in checker used to know only everyday speech (about 100,000 words), so *typescript*, *emojis* and most software words were flagged. It now also learns a full English word list (SCOWL, the dictionary behind LibreOffice and Firefox, about 88,000 words with all their forms) and 34,000 software terms (programming languages, frameworks, tools, companies, file formats; from cspell-dicts), about 196,000 words in all. British-only spellings (*colour*) are kept in a separate list, accepted when proofreading in a British-family English and still flagged in American English. Typical typos (*recieve*, *definately*, *seperate*, *untill*) are still caught; I checked 100 common ones against the lists, and `tools/build_words.py` leaves out a few words that are more often typos than words.

The lists are in `backend/app/words/` (committed, so a server needs no internet) and are rebuilt with `python tools/build_words.py`. To add your own words (names, product terms), put them in a text file, one per line, and set `KOKO_EXTRA_WORDS=/path/to/words.txt`, or add them to `backend/app/words/extra.txt`. Tests: `backend/tests/test_words.py`. Loading them adds about 0.1 s at start and some tens of MB of memory.

`POST /api/docs/{id}/proofread` follows document access like everything else: the owner, anyone the document is shared with (even as a viewer), and people with an open link or the password token can use it, so people editing through a link with no account can proofread; strangers can't. It is limited to 240 requests a minute per person (or per address when signed out). Test: `backend/tests/test_proofread_auth.py`.

## Memory

- **Speech models unload when idle.** A loaded Whisper model keeps its memory (the tiny one about 100 to 230 MB, `small.en` several hundred) until the server restarts. Admins can switch unloading on or off, and choose after how many minutes unused a model is dropped (1 to 1440), under *Admin → Voice typing → Free memory when idle*; the *Models on this server* list under it shows which models are in memory right now (a green *in memory* tag, what each is used for, how long since it was last used and when it will drop), the server's memory use, and **Free** / **Free all now** buttons that drop them immediately (`POST /api/admin/stt/unload`). It refreshes itself every few seconds. A dropped model loads again (a second or two) the next time someone dictates, and Linux is asked to hand the freed memory back. The default is on, after 3 minutes; until an admin chooses, `KOKO_STT_IDLE_SECONDS` sets it (`0` = off). The check runs every 30 seconds, so a drop can come up to half a minute late. The Python libraries behind the models (onnxruntime, ctranslate2, numpy) stay loaded, so some memory is never returned. Test: `backend/tests/test_stt_idle_admin.py`.
- **The spelling word lists are stored as hashes.** The extra words (about 36,000 beyond the built-in 160,000) are kept as 64-bit hashes rather than as dictionary entries, which brought their cost from about 76 MB down to about 29 MB. They can't be listed back, so they have no frequency and sort after common words in suggestions.
- If memory is tight, choose a smaller model (`base.en` instead of `small.en`) and delete models you don't use under Voice typing; the live preview already uses only the tiny one.

The **Reload** button on the update pill goes the extra mile: it first fetches the page again bypassing caches, then reloads; if the pill comes back for the same update within two minutes (a browser, proxy or CDN is still handing out the old index page), the next press opens the address with a throwaway `_v` parameter that no cache can have seen, and the parameter is removed again once the page has loaded. The button shows "Reloading…" while it works. The pill sits below the iPhone notch and status bar and stays on screen when the keyboard is open. And if a page's own script file has vanished after an update (an old cached index page), `index.html` reloads it once, round the cache, instead of leaving a blank page.

## The admin panel

`/admin` (also *Settings → Admin panel*) is a page of its own with a sidebar, like Settings but easy to tell apart: a dark rail with an *Admin* badge and an accent bar on the current section. Sections: **Overview** (counts, and a status list whose rows jump to the section that controls them), **Users**, **Files**, **Access & storage** (sign-ups, default storage), **Email**, **Google sign-in** and **Voice typing**. Each section has its own address (`/admin#email`), so you can bookmark or link to one. On a phone the sidebar is the list and tapping a section opens it, with a back button. Code: `frontend/src/pages/AdminPage.tsx`; the styles are the `.ad-*` rules in `app.css`.

## The assistant can look at your other files, if you let it

Koko normally sees only the file you have open. Under the assistant's header there is an **Other files** control with three settings, saved per person on the server: **Off** (the default; Koko isn't even offered the tools), **Ask first** (every time it wants to look, a card says what it wants, for instance *Search your other files for "marmoset"* or *Read "Boss plan"*, and you choose *Allow*, *Allow for this session* or *Don't*) and **Allowed** (it looks when it needs to; the activity feed still shows each file it read). Koko is told to say which files it used, and if you decline it carries on without them.

It is read only: two tools, `search_other_files` and `read_other_file`, with no way to change another file. It can only reach files the person can open themselves (their own, shared with them, or in a shared folder; public-link files they haven't been given are left out), and every lookup is checked on the server too (`backend/app/aifiles.py`: `GET /api/ai/files`, `GET /api/ai/files/{id}`, and `GET`/`PUT /api/me/ai-files` for the setting), refusing when the setting is Off, with a limit of 120 lookups a minute. What Koko reads is turned into plain text by `backend/app/readdoc.py`: Markdown-like for documents and wiki pages (headings, lists, checklists, tables, links, bold), rows of cells for spreadsheets (formulas shown as typed, since results are worked out in the browser and not stored), text and speaker notes for slides, the questions of a form, and columns and cards (with their fields) for a board; very long files are cut at 60,000 characters and Koko is told so. The text goes to your AI provider like the rest of the conversation, so leave this Off if a file shouldn't go there. Tests: `backend/tests/test_ai_files.py`.

## Koko's models

Koko can use several models, and the one that answers is chosen **in the chat box**: a small model button under the message box lists the models you can use, in two groups, *Provided for everyone* (set up by the admin) and *Your models* (added by you), with *Add or manage your models…* at the bottom. Picking one is remembered per person on the server and sent with each message, so it follows you between devices. Models can be any OpenAI-compatible service (presets for Mistral, OpenAI, OpenRouter, Groq and Ollama).

**Admins** manage the global list under **Admin → Assistant (Koko)**: add as many models as you like (name, base URL, key, model), test each one, switch any off for everyone, remove it (people who had it picked move to another), and **Make this the default**: the model at the top is what people get until they pick another. Keys are encrypted at rest and never sent to a browser, not even the admin's, and people see a global model's name and model but never its address or key. With no models set up here, the environment variables `KOKO_AI_URL`, `KOKO_AI_KEY` and `KOKO_AI_MODEL` still provide one for everyone, and when you add your first model here it replaces that.

**Everyone** can add their own models (up to 12) from the picker or *Settings → AI assistant*: a name, base URL, key and model, with a **Test** button that lists what the provider offers. Your own models are private: other people can't see or use them, and nobody else's key is ever shown to you. You can edit or remove yours at any time.

Earlier connections carry over by themselves the first time the server starts: the old system-wide connection becomes the first global model and each person's saved connection becomes one of their own (and stays the one they use). Code: `backend/app/ai.py` (the `ai_models` table, `resolve`, `/api/ai/connections`, `/api/ai/selection`, `/api/admin/ai/models`), `frontend/src/assistant/AssistantPanel.tsx` (the picker) and `AiSettings.tsx`. Tests: `backend/tests/test_ai_models.py` and `test_ai_models_migration.py` (run on a server started with `KOKO_AI_ALLOW_PRIVATE=1` and no `KOKO_AI_URL`, with `tests/mock_llm.py` running).

## Single sign-on (Google, GitHub or any OAuth 2.0 / OpenID Connect provider)

Under **Admin → Single sign-on** you add as many sign-in options as you like. Google, GitHub, GitLab, Microsoft and Discord are just presets that fill the form in (their addresses, scopes and which field holds the person's id, email and name); **Single sign-on** is a blank one for any other provider: Keycloak, Authentik, Okta, Auth0, Zitadel, your company's own. Paste its issuer address and press **Discover** to fill in the addresses from `/.well-known/openid-configuration`, or enter the authorize, token and user info addresses by hand. For each provider you give the redirect address shown on its card to the provider, then paste back the client ID and secret (the secret is encrypted at rest and never sent to a browser). Each card has an on/off switch, and a provider appears on the sign-in page (as *Continue with GitHub* and so on) as soon as it is on and complete. People can link or unlink each one under *Settings → Security*, and can have several linked at once.

How it works: the standard authorization-code flow, with the code traded for a token server to server and the provider's user info endpoint asked who it is (`backend/app/sso.py`; tests in `backend/tests/test_sso.py`, run against a small fake provider). Accounts are matched by email, so **an email is only used when the provider says it is verified**: via the verified field in the user info (Google, GitLab, Discord), or, for GitHub, by choosing the primary verified address from its emails list. For a provider that doesn't say (Microsoft, many custom ones) turn on *Trust the email this provider returns* in the card's advanced section, but only for a provider you control. Closed sign-ups apply to every provider. Advanced fields let you change which user info fields hold the id, email, name and verified flag, add an emails address, and choose whether the client secret travels in the request body or a Basic header.

If you used the old built-in Google sign-in, nothing to do: its client ID, secret and everyone's linked Google accounts became the `google` provider the first time the server started, and its redirect address (`/api/auth/google/callback`) is unchanged, so what you registered with Google keeps working. Other providers use `/api/auth/sso/<id>/callback`.

## Typing `:` for emoji

In documents and wiki pages, type `:` and a couple of letters (`:tad`) and a menu of matching emoji appears under the cursor, each with its `:name:` and its description. Arrow keys move, **Tab** or **Enter** (or a click) puts the highlighted one in, **Esc** closes it, and the typed text is replaced by the emoji. Typing a whole name with its closing colon (`:tada:`, `:+1:`) turns it into the emoji straight away. Names that start with what you typed come first, then names and words that contain it; the names are GitHub's (plus the larger Emojibase list), so `:rocket:`, `:fire:`, `:white_check_mark:` and `:thumbsup:` all work. It waits for two letters, so times like `10:30` and addresses like `http://` don't open it, it stays out of code blocks, and it uses the skin tone chosen in the emoji picker. The first time it is used it loads the emoji list and the picture pack (the same ones the picker uses). Code: `frontend/src/editor/EmojiSuggest.tsx` and `emojiData.ts`.

## Links that jump to a heading

In a document (and a wiki page), select some text, open the **Link** button and pick a heading under *Or jump to a heading in this document*; with nothing selected, the heading's own text is inserted as the link. The link jumps to that heading with a short highlight. A plain click on it in an editable document shows the usual little link menu (naming the heading, with a *Go to heading* button, and *Edit* to pick a different one); **Ctrl/⌘-click** jumps straight away, and for anyone who can only view the document a plain click jumps. These links open in the same page, never a new tab, and don't change the address.

The first time something links to a heading it gets a short permanent id (`h-ab12cd`, written into the document and used as the heading's `id`), so the link keeps working when the heading is renamed or moved. If the heading is deleted the menu says it no longer exists. Code: `frontend/src/editor/headingLinks.tsx`.

## Koko in forms and boards

Forms and boards have an **Assistant** button in the top bar (for signed-in people) that opens Koko in a panel on the right. It works like it does in documents: it reads before it acts, every change is shown as a card to approve (or "approve for this session"), the model picker and *Other files* control are there, and Undo undoes what it did.

- **Forms:** it can read the form and, for the owner or an editor, summarise the *responses* (counts, tallies of choices, averages of ratings and numbers, quotes of text answers). It can add, edit, delete, move and retype questions (all question types, with options, required, limits, scales and help text) and change the title, description and settings (accepting responses, sign-in, one response per person, confirmation message). Show-if logic, file upload settings and the look of the form are left to the editor.
- **Boards:** it can read the whole board (fields, columns, cards with their values) and add, edit, move and delete cards, add, rename, recolour, reorder and delete columns, and add, edit and delete fields (including select options and required). It uses option labels and `YYYY-MM-DD` dates, and a card that breaks a field's rules (a missing required value, a number outside its limits) is refused with the reason, so Koko can correct itself. People who can only view a board can ask questions about it but not change it.

Code: `frontend/src/assistant/formTools.ts` and `boardTools.ts`. On wide screens the page makes room beside the panel; on a phone the panel covers the page.

## Editor re-rendering

The document and wiki editors re-render once per animation frame when the editor changes (`frontend/src/editor/useBatchedRerender.ts`, with Tiptap's `shouldRerenderOnTransaction: false`), instead of once per transaction. Tiptap's default re-renders the whole page synchronously for every transaction, and a key press makes several (the text, the collaboration cursor, proofreading marks, page breaks). Typing quickly in a long document could pile enough of them into one burst that React stopped with "Maximum update depth exceeded" (error #185, seen in the production build only). Batching to the next frame removed it; the toolbar, word count and menus are still right by the next paint.

## Koko designs slides from a description

Ask Koko for a look ("dark navy, orange accent, big Space Grotesk headings") and it builds the deck from primitives instead of picking a template.

- `set_design` sets the deck's palette and heading/body fonts; theme tokens (`bg`, `fg`, `muted`, `accent`, `accentInk`, `card`) then follow it. Choosing a preset theme afterwards clears the custom palette.
- Slides are composed on the `blank` layout with text boxes (colour, font, size, weight), shapes, pictures from a URL, gradient backgrounds, and `arrange_element` / `duplicate_slide` for layering and repeats.
- `review_design` checks the result: text that overflows its box (measured with the real font), low contrast (WCAG), text under 16px, overlaps, and elements outside or hugging the slide edge. Koko fixes what it reports.
- The template route (`add_slide` with a layout) still works; Koko picks whichever fits the request.

Limits: untested with a real model so far (scripted with a mock). PowerPoint export keeps only the first colour of a gradient background. Pictures come only from URLs you supply.

## Folding columns in the board table

In a board's Table view, cards are grouped under a header row for each board column (name, colour, card count). Click a header, or press Enter or Space on it, to fold that column's cards away. Sorting and the filter still work inside each group; folding is per visit and isn't saved.

## Talking to Koko

When voice typing is set up on the server, the assistant's message box has a microphone button. Click it to start, click again to finish; what you said is transcribed with the provider the admin chose and added to your message, ready to edit or send. Esc cancels. It works in every file type, since it doesn't need a text editor on the page.

## Boards on a phone

- A strip of column names (with card counts) sits above the board; tap one to jump to it. It follows you as you swipe.
- Columns are nearly full width and snap into place, so a swipe lands on exactly one column.
- Press and hold a card (or right-click on a computer) for a menu: move it to any column, open it, or delete it. No dragging needed.
- Dragging by the grip still works, now with a bigger grip and faster edge scrolling; cards and buttons have larger touch targets.

## Checking text fields in a board

A text field can set the fewest and most characters it accepts, and a format it must follow: email address, phone number, digits only, letters only, letters and numbers, or your own pattern (a regular expression the whole text must match). You can add a message to show when the text doesn't fit. The card dialog, the table and the "to fix" warnings on cards all use the same rules, and Koko follows them when it fills in cards (`add_field` and `edit_field` take `min`, `max`, `format`, `pattern` and `message`). A pattern that isn't a valid regular expression is ignored, so it can't lock everyone out. Empty values are only a problem when the field is required.

## No browser dropdowns

Every dropdown is the app's own now: the text format in board fields, the method badge in wikis (title bar and request blocks), the folder-sharing access level, and the model name boxes in the assistant and admin settings (type anything, or pick a suggestion from the styled list). There are no native `<select>` or `<datalist>` menus left.

## Icons in slides

Koko can put vector icons on slides. `search_icons` finds one in the Lucide set (about 1,700 outline icons) and `add_icon` places it at any size and colour (a theme colour or a hex, with an adjustable line thickness). When nothing fits, Koko can draw its own SVG instead: logo marks, simple illustrations, decorative shapes. Hand-drawn SVG is cleaned before it is used: only drawing shapes, paths and gradients are kept, and scripts, event handlers, images, text and external references are removed. Icons are stored in the slide as vectors, so they stay sharp at any size; PowerPoint export turns them into high-resolution PNGs. The Lucide set loads only the first time Koko asks for an icon (about 180 KB compressed), so it doesn't slow down opening a deck.

Icons take the colour you give them when they are added, so changing the theme later does not recolour them.

## Long assistant conversations

Every tool call is two messages, so a long design session can reach hundreds. The browser now sends only the recent part once a conversation passes about 160 messages or 320,000 characters, leaving out the oldest turns (never splitting a tool call from its result) and telling the model that earlier steps were dropped. The saved conversation keeps everything. The server's cap on one request went from 300 to 1,000 messages.

## Cloudflare Workers AI (Koko and voice typing)

Both use the Workers AI REST API at `api.cloudflare.com` (not AI Gateway). You need your Cloudflare **account id** (shown on the Workers AI page of the dashboard) and an **API token** with the Workers AI permission.

- **Koko:** choose the "Cloudflare Workers AI" preset when adding a model (yours, or one for everyone in the admin panel), then fill in the account id, the token and a model such as `@cf/openai/gpt-oss-20b`. Koko calls `.../ai/run/<model>`. Answers arrive all at once instead of word by word, and Koko asks for up to 4,096 tokens (Cloudflare's own default of 256 cuts replies off). Reasoning models spend part of that on thinking; if one runs out before answering, Koko says so. Pick a model that supports tool calls, otherwise Koko can chat but can't edit. The "Test" button lists the text models your account can use.
- **Voice typing:** admin panel, Voice typing, provider "Cloudflare Workers AI": account id, token and model (`@cf/openai/whisper-large-v3-turbo` by default, or `@cf/openai/whisper`, `@cf/openai/whisper-tiny-en`). Without the admin panel, set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in the server environment.

The older OpenAI-compatible address (`.../ai/v1`) still works if you enter it as a custom base URL; it streams, but the preset uses the REST API above.

## Voice typing in boards

Hold the voice typing key (Right Ctrl by default, changeable in Settings) while the cursor is in a text box on a board: a card's title, description or text and link fields, the board title, the filter, or Koko's message box. The words are typed into that box when you let go. With no text box selected, nothing starts, so the key never does something unexpected. While a text box is selected a floating microphone also appears (useful on a phone); it keeps the cursor where it is, and clicking it starts and stops dictation. A viewer who can't edit gets neither.

## Zero-knowledge encryption (off by default)

Anyone can turn this on for their own account in Settings, Security. Documents they encrypt can't be read by the server, its database, or its administrator. Everyone keeps full access to documents that aren't encrypted, and each account chooses which of its documents are.

**How it works.** Your browser stretches your password (Argon2id) into two things: a login secret, which is all the server ever receives, and a wrapping key, which never leaves the browser. A random master key is stored on the server only wrapped by that key, and wrapped again by your **recovery key**. The master key wraps the private half of a sharing keypair (X25519). Every encrypted document has its own random key, and each person who may open it has a copy sealed to their public key. Edits, titles and comments are encrypted with the document key (AES-256-GCM) before they leave the browser. Live editing keeps working: the server stores and relays encrypted updates, and clients merge them. Because the keys are random and only wrapped by the password, changing your password re-wraps one small key and nothing else changes.

**Knowing which is which.** Every file shows a small label next to its save status: a green "Encrypted" or a grey "Not encrypted" (forms always say Not encrypted, since they can't be). Hover it for what that means, click it to open Security settings.

**Signing in.** Same email and password, on any device: the keys come down wrapped and open with the password. After a password sign-in a "Decrypting…" page covers the app while the keys open. If you were already signed in when encryption was turned on elsewhere, or you signed in without typing the password (single sign-on), an unlock page asks for the password once.

**Turning it on** with documents that already exist: you get a recovery key (you must type it back to prove you saved it), then, if you choose, every document you own (trash included) is encrypted in your browser, with a progress page. Forms and documents open to anyone with a link can't be encrypted and are left as they were, with a list of why. Anyone a document was shared with loses access to it until you share it again (they need encryption on too). Its comments and pictures are encrypted along with it; version history and the search text the server held are deleted, and the old plain text is overwritten in the database (and the plain picture files are overwritten and deleted) rather than just unlinked.

**Turning it off** decrypts all of your encrypted documents in your browser (progress page again), stores them readable, and gives the account an ordinary password. Encrypted documents other people shared with you stop opening, because they belong to them.

**Passwords and resets.**
- Changing your password (you know the old one) is instant and loses nothing.
- Forgot it: the emailed code proves the address, then your recovery key opens the master key and the new password wraps it again. A new recovery key is issued.
- Forgot it and no recovery key: the encrypted documents can never be opened again, by anyone. You can still reset the account, but its encrypted documents are deleted (you must type DELETE). An administrator can't set the password of an encrypted account for the same reason.

**Sharing** an encrypted document is done with people who have encryption on, by giving them the document's key sealed to their public key. There are no public links. Each person shows a key fingerprint to compare. Removing someone changes the document's key and re-encrypts it for those who remain; they keep whatever they had already seen.

**What the server still knows:** that you have an account, which documents exist, their kind, size, timestamps, folders and folder names, and who they are shared with. It can't read titles, content, comments or keys.

**Pictures** work: each is encrypted in your browser (with the document's key) before it is stored, and decrypted as it appears. Pictures a document already had are re-stored encrypted when it is encrypted, and the unencrypted copies are overwritten and deleted. When someone is removed and the key changes, the pictures and comments move to the new key too. Turning encryption off stores them readable again. A picture pasted from the web is fetched by the server (it is public anyway) and handed back for your browser to encrypt.

**Koko and voice typing** work, with one honest exception to "the server never sees it": they have to send what you give them (the document's text and your question; your recording) through the server to an AI or speech service. In an encrypted document you are asked first, once per browser session, with that said plainly. The server passes it along without keeping it, but it can see it while it passes, and so can the service. Koko's conversations are stored encrypted with a key only you have (not even the other people sharing the document can read them). Koko can't read other files that are encrypted, since that would need the server to open them.

**What doesn't work in encrypted documents** (the server would have to read them): spelling and grammar checks, version history, forms, public links and server-side text search (titles are searched in the browser). Comments are encrypted. Mention emails say who and where, never what. Folder sharing doesn't carry keys, so people in a shared folder see an encrypted document but can't open it until it is shared with them directly. The server still knows who has accounts, which documents exist, their kind, size, timing, folders and folder names, how big each picture is, and who things are shared with.

**Limits, plainly:**
- This is the usual browser limit: the page that does the decrypting is served by the same server. It protects against a database leak, a hosting provider and an administrator browsing the data. It does not protect against a server that deliberately serves altered JavaScript.
- Someone with a signed-in browser (or who gets script into the page) can read what that browser can.
- Anything you send to Koko or voice typing in an encrypted document is visible to the server and the AI or speech service while it passes through (you're asked first).
- The cryptography uses standard libraries (WebCrypto, `@noble/curves`, `hash-wasm`), but the design hasn't been independently reviewed.
- Sharing trusts the public key the server returns for an email. Compare fingerprints for anything sensitive.

Server tests: `backend/tests/test_zk_server.py` (server on :8000, fresh data). Crypto check: `node --experimental-transform-types frontend/tests/zk-crypto.mts`.

## Meetings (video and voice)

**Meet** on the dashboard starts a meeting now, joins one with a code or pasted link, or opens **Manage meetings** (`/meetings`). A meeting is a room at `/m/<code>` (such as `hk3-jywu-vu8`) with a host. It works out of the box with no keys: browsers connect to each other directly (see Providers).

**Permanent meetings.** A meeting can be *kept*: it stays on your account with its own code and settings, however many times it is ended. "End the session" closes it for everyone who is in it, and the next person to arrive starts a new session with the same link, passcode and settings. One-time meetings end for good when you end them (or after a week unused). Manage meetings lists both and shows who is in each right now. **Settings** (and **New meeting**) open a full page with a navbar: *General* (name, keep or not, the link and invite), *Who gets in* (approval, wait for the host, guests, how many people, passcode), *Co-hosts*, *In the meeting* (what people start with and may do) and *End or delete*; one bar saves everything at once and warns about unsaved changes (`/meetings/<code>#cohosts` opens a section directly). Up to 25 permanent meetings each.

**Joining without an account.** The host switches this on per meeting (it is off for a new meeting): in the settings page under *Who gets in*, or with one click during the call from **More → Allow people without an account**. Then anyone with the link who isn't signed in is asked only for a name; the host and everyone else see them marked *Guest* (on their tile, in the People list and in the waiting room). Switching it off stops new guests but doesn't remove the ones already in. Existing meetings keep the setting they had. An admin can still turn guests off for the whole server (Admin → Meetings).

**Who gets in.** Per meeting: the host approves everyone (a *waiting room*; the host and co-hosts are told, with a badge and a sound, and admit, turn away or admit everyone), people wait until the host or a co-host is there, guests without an account allowed or not, a passcode, a limit on how many people, and **Lock the meeting** during the call to stop new arrivals. Removing someone can also block them for the session. Waiting people can do nothing and receive no audio or video credentials until admitted, with either provider.

**In the call.** Camera, microphone, screen sharing (it becomes the main tile), choosing the microphone, camera and speaker (before joining and during the call), gallery view and speaker view (the active speaker is big), pin anyone, hide your own video, full screen, a meeting timer, and keyboard shortcuts (M, V, S, H, C, P, F). **Reactions** float up the screen (eight emoji). **Raise your hand**: hands queue in order, shown on the tile and in a list, and managers lower them. **Chat**: to everyone or privately to one person (who can chat is a setting: everyone, only the host, or no one). **Polls**: managers ask a question with 2 to 8 choices, single or multiple choice, named or anonymous; everyone sees live results. **Live captions**: when this server can turn speech into text (the voice-typing setup), a manager can switch captions on for the room; each browser transcribes only its own speech and everyone sees who said what; anyone can download the transcript. Nothing said in a meeting (chat, polls, captions) is stored on the server.

**Co-hosts before it starts.** In the settings page, *Co-hosts*, add people by the email of their KokoDocs account. They are co-host the moment they arrive signed in, even before you: they skip the waiting room, can open a meeting that is set to wait for the host, let people in and run the room. The meeting appears for them under *Co-hosting* on their Meetings page, with the invite and passcode but without the settings. Changing the list while the meeting is running promotes or demotes people at once. Guests can't be pre-set (no account to recognise them by); anyone can still be made co-host during the meeting from the People list.

**Hosts and co-hosts.** Right-click anyone's tile or their row in the People list (or press and hold on a phone, or use the "..." button) for everything you can do to them: message privately, pin, mute or ask to unmute, turn off their camera, lower their hand, spotlight, make co-host, remove, remove and block. A co-host can't act on the host. The host can make anyone a *co-host* for the session. Hosts and co-hosts (managers) can let people in, mute or ask someone to unmute, **mute everyone** (optionally stopping people unmuting themselves), spotlight someone for everyone, remove and block people, lower hands, run polls, lock the room and start captions. Only the host changes the meeting's settings or makes co-hosts; settings can be changed during the meeting from **More → Meeting settings** and take effect at once. Other settings: people join with microphone and/or camera off, who may share their screen (everyone or only hosts), whether people can unmute themselves, reactions on or off, captions allowed. Every call shows an **Encrypted** label: audio and video are always encrypted between the browsers (WebRTC's built-in encryption), including when a relay (TURN) server passes them along, so a relay can't read them (it only sees who is talking to whom, and how much). The server running the meeting only sets the call up and never sees the media. That is different from encrypted documents, which the server can't read even when stored. With the Cloudflare RealtimeKit provider the label says *Encrypted in transit*, because Cloudflare's call servers carry the media and can access it. Next to it a badge says **Direct** (straight between the browsers) or **Via relay** (through a TURN server, with who, on hover).

**Recording.** A host (or, if the meeting says so, a co-host) can record from the record button or **More → Record the meeting**. Because calls go between browsers, the *recorder's browser* does the work: it draws everyone's video into one 1280×720 picture (the spotlighted person if there is one, else a shared screen, else a grid), mixes everyone's audio, and uploads it in pieces while it runs, so keep that tab open. The file is saved on this server, in the **storage of the meeting's host** (whoever pressed record), counts against their quota, and shows up in Settings → Storage as *Meeting recordings*. If the host runs out of space the recording stops and what was recorded is kept; if the recording browser disappears the recording ends after a few seconds and keeps what arrived. **Meetings → Recordings** lists them with length and size, plays them in the app, downloads them, and deletes them (which gives the space back). Files are WebM (MP4 in Safari) and are served through short-lived signed links.

*Consent.* Everyone in the meeting sees a red **Recording** label. When a recording starts, everyone except the recorder and the host is asked to **Agree** or **Don't agree** (a modal they can't dismiss), and someone who joins while it is running is asked before they even join. Only people who agreed are drawn and heard. With **Everyone must agree to be recorded** on (a meeting setting, also in the start dialog), saying no, or not answering for a minute, removes the person from the meeting; with it off, people can say no and stay, and are simply left out of the recording. People can change their answer from the Recording label, and hosts see who has said no or not answered in the People list. Who may record is a setting too: no one, only the host, or the host and co-hosts.

**Documents and presentations inside the meeting.** In the call, **Share → Edit a document together…** opens one of your documents, spreadsheets or presentations (or a new one) for everyone, right in the meeting: it takes the place of the video grid, which moves to the side, and it's the real editor, with everyone's cursors and the toolbar, so people edit at the same time (people without an account can too; their cursor carries the name they gave). It stays yours: people only have access while it is the meeting's shared item, through a key that works for that one document and stops working the moment you stop sharing. You choose whether others can edit or only watch, and can change it while it is open. **Share → Present slides…** shows a presentation instead: everyone fetches the deck themselves and sees the slide you are on, and follows as you turn the pages (arrow keys, buttons, or the slide strip); co-hosts can turn pages too. If you allow it, people can look at other slides on their own, with a banner and **Back to the presenter**; presenters also get speaker notes only they see. One thing is shared at a time, and a shared document and a shared screen can't be on at once. Only documents you own can be shared (not encrypted ones), and it ends if you leave. Under the hood the editor page has an `?embed=1` mode that hides its own header and side panels.

**Permissions, down to one person.** Under *Permissions* in the meeting's settings (and **More → Meeting settings** during the call): whether people can unmute themselves, turn on their camera, share their screen, write to everyone in the chat, react, start a shared document, present slides, edit shared documents, and browse slides on their own. For one person, right-click them (or the "..." button) and choose **Permissions…** to set each of those to the meeting default, always allow, or never allow, for this meeting only; taking something away switches it off if they are doing it right now, and their buttons show a lock with the reason. Hosts and co-hosts can always do everything. The server enforces what it can see (microphone, camera and screen state, chat, reactions, who may start a share, who gets an editing key); a modified browser could still send audio or video that nobody allowed, and the page shows people as off.

**Raised hands, when you're elsewhere.** A host or co-host who has switched to another window (for example the one they are sharing) gets a small always-on-top window listing who has a hand up, in order, with **Lower** and **Lower all**, updating live and with a sound for each new hand. It uses the browser's Document Picture-in-Picture window (Chrome and other Chromium browsers): it opens by itself when you switch away from the meeting tab, or from **More → Pop out raised hands**, and closes when you come back. Browsers without it get the count in the tab's title instead. Note that if you share your whole screen, the window is part of that screen.

**When it doesn't work (and what the page tells you).** Calls go straight between browsers, and some networks stop that: a VPN, a strict office or school network, mobile data behind carrier NAT, or a browser privacy setting that blocks WebRTC over UDP. The page now says so instead of showing a black tile: a person it can't reach shows *Connecting…* and after a few seconds *Can't connect to X* with a **Try again** button, plus a banner telling an admin where to fix it (Admin → Meetings → Relay: with a TURN relay, calls pass over TCP on port 443, which VPNs and strict networks allow). It retries by itself in the background. The speaking outline on other people's tiles comes from the call's own audio levels, so you can see that someone's sound is arriving. If the browser blocks incoming sound until you click, a banner offers **Turn the sound on**. Before joining, the preview checks your camera (a black picture gets a warning and a one-click *Try another camera*, since some laptops list an infrared camera first) and your microphone (a level meter on the button, and a hint if it stays silent), and a person who joined muted is reminded that they are.

**Honest limits.** Audio and video travel between browsers (or through the provider), not through this server, so rules about people's own devices (join muted, can't unmute, who may share) are enforced by the server where it can see (what is shown and relayed) and by every normal browser for the rest; someone using a modified browser could still send their own microphone. There is no background blur or breakout rooms. A recording is only as good as what the recorder's browser receives, can't be sought in some players until opened in the app (browsers write no length into the file), and is not made if the recorder's computer can't encode video. Guests who are blocked are recognised by account or by their browser for the session, so a determined person can come back with a new browser.

**Providers: what carries the audio and video, chosen in Admin → Meetings.** Every feature above goes over one control channel (`/ws/meet/<code>`) that is the same for every provider, so changing provider never changes what you can do, and each meeting remembers the provider it started with.

- **Directly between browsers** (the default, free, up to 8 people). WebRTC; this server only introduces browsers to each other and hands out STUN/TURN servers, so no audio or video passes through it. Most people connect directly; some networks (offices, schools, some mobile carriers) need a relay: in Admin → Meetings → **Relay** choose **Cloudflare TURN** (create a TURN key in the Cloudflare dashboard under Realtime → TURN, enter its id and token; Cloudflare's relay service has a free allowance of 1,000 GB a month) or **My own TURN server**. Without a relay only public STUN is used. Each connection has three fixed media slots (microphone, camera, screen), so turning things on and off never renegotiates the call.
- **Cloudflare RealtimeKit** (optional, bigger rooms, billed by Cloudflare per participant-minute). Not needed for anything above. Enter the account id, the RealtimeKit app id and an API token with the Realtime permission. The server creates the meeting and a token per person through Cloudflare's REST API (only for people the room has admitted) and the token that can create meetings never reaches the browser. The SDK is loaded only when someone joins such a meeting. "Save and test" creates and closes a throwaway meeting.

The settings can also come from the environment: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `KOKO_RTK_APP_ID`, `KOKO_TURN_KEY_ID`, `KOKO_TURN_TOKEN`. Other switches there: meetings on or off, guests allowed server-wide. A new provider is one class in `backend/app/meet.py` (`creds`, `end`, `problem`, `test`) and one adapter in `frontend/src/meet/` (the `Media` interface in `media.ts`); the page doesn't care which one it is talking to. Joining is two steps so approval can't be skipped: `POST /api/meet/<code>/join` checks the passcode and guests and returns a short-lived signed ticket; the ticket opens the control socket, where the waiting room decides; only an admitted person can then ask `POST /api/meet/<code>/media` for audio and video credentials.

The RealtimeKit adapter follows Cloudflare's published SDK types and was tested only against a mock Cloudflare API, not a live account. Tests: `backend/tests/test_meet.py` (REST, passcodes, the waiting room, co-hosts, polls, permanent meetings, both providers against a mock Cloudflare, the socket; start the server with `KOKO_CF_API=http://127.0.0.1:8767/client/v4 KOKO_TURN_API=http://127.0.0.1:8767/v1/turn/keys`).

### Cloudflare SFU (one upload for everyone)

Admin → Meetings → Provider → **Cloudflare SFU**. In a mesh call you upload a copy of your video to every other person (5 copies in a 6 person call); with the SFU you upload once to Cloudflare, which forwards it. Create an app in the Cloudflare dashboard (Realtime → SFU), paste its **app id** and **app secret** (or set `KOKO_SFU_APP_ID` and `KOKO_SFU_SECRET`), and use *Save and test*. The browsers never see the secret: this server relays their calls to Cloudflare's session API, and only lets a person use their own session and fetch tracks from sessions in the same meeting. Switching the provider only affects meetings started afterwards. Tests: `backend/tests/test_sfu.py`.

### Other SFUs: Metered and LiveKit

Same admin page, same one-upload-for-everyone idea.

- **Metered Global Cloud SFU** (`metered`): create an SFU app in the Metered dashboard and paste its app id and secret (or `KOKO_METERED_SFU_APP_ID` / `KOKO_METERED_SFU_SECRET`). Works like the Cloudflare one (this server relays the calls, the secret stays here) but speaks Metered's API: the session starts with an offer, and tracks are published and subscribed to by track id.
- **LiveKit** (`livekit`), open source: run your own (`livekit-server`, or its Docker image) or use LiveKit Cloud, then enter the address (`wss://…`), API key and secret (or `KOKO_LIVEKIT_URL` / `KOKO_LIVEKIT_KEY` / `KOKO_LIVEKIT_SECRET`). This server only signs short-lived join tokens; browsers connect to LiveKit with its SDK. *Save and test* checks the key and secret. Needs LiveKit's ports reachable from your users (7880 for signalling, UDP 7882 or its configured range for media).

Tests: `backend/tests/test_sfu.py` (Cloudflare and Metered, against mocks) and `backend/tests/test_livekit.py`.

## Read aloud (text to speech)

The speaker button in the top bar of a document or wiki reads the page aloud, or just what you have selected. A floating pill (like the voice typing one) has play and pause, a sentence back and forward, and slower and faster (0.75× to 2×); the sentence being read is highlighted and scrolled into view.

- **Default: each device's own voices.** Free, instant, works offline (and in the desktop app), and the text never leaves the device, so encrypted documents work too. Quality depends on the device: very good on Apple devices, plainer on some others. A voice can be chosen from the button's menu.
- **Neural voice on the device (English).** Pick *Neural voice* in the button's menu: Kokoro (82 million parameters, Apache 2.0) running in the browser, far more natural than the system's plain voices (such as macOS's default Samantha). The first time it downloads the model (about 90 MB, from Hugging Face), shows the progress in the pill, and keeps it, so afterwards it starts at once and works offline. Nothing is sent to the server, so it is fine for encrypted documents. Twelve voices (US and UK, women and men); other languages are read with the device's voices. The device voice picker also now prefers Premium, Enhanced and Siri voices over the default.
- **Speed of the neural voice.** On the processor it can be slower than real time (about 1.4× on an M-series Mac), because browsers give a page only one thread unless it is *cross-origin isolated*. The desktop app turns that on by itself, so the voice uses up to four threads there. For the website it is opt-in: start the server with `KOKO_CROSS_ORIGIN_ISOLATION=1` (it sends `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`; check pop-ups and embeds before leaving it on). A graphics-card route exists for browsers that offer WebGPU to workers (`localStorage['koko.tts.device'] = 'webgpu'`, optionally `koko.tts.dtype = 'fp16'`); it falls back to the processor when unavailable.
- **Optional: Cloudflare MeloTTS, one voice for everyone.** Admin → Voice typing → *Read aloud*: choose it and enter the Cloudflare account id and an API token with Workers AI access (or set `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN`). It costs about $0.0002 per minute of speech, roughly a cent an hour. A sentence at a time is sent to the server, which asks Cloudflare and keeps recent results in memory so repeats cost nothing; English, Spanish, French, Chinese, Japanese and Korean are picked from the text. Encrypted documents never use it. If it fails, reading carries on with the device's voice.

Tests: `backend/tests/test_tts.py`.

## Zoom (every kind of file)

Documents, wikis, spreadsheets, presentations, boards and forms all have a zoom control at the bottom right: **−**, the level (click it to go back to 100%), **+**, and **fit** (shows the whole file at once: the whole document or page, all the data in a sheet, the slide in the window, the whole board or form). Ctrl or ⌘ with the mouse wheel, or a pinch on a trackpad, zooms too. The level is remembered for each kind of file. In the spreadsheet and slides the pointer maths accounts for the zoom, so clicking, dragging, resizing columns and moving charts stay accurate.

## Smaller pictures

Pictures people add are made smaller once, in place, by the server: on startup (after duplicates are merged) and every few hours after that. JPEGs and WebPs are re-encoded at a good quality, PNGs are optimised without losing anything, anything over 2560 pixels on its longest side is scaled down, and camera metadata (location, device) is dropped. The file keeps its name and type, so every picture already in a document still shows. A result is used only if it is at least 5% smaller, and animated pictures are left alone. The person's storage is counted from each picture's size, so what is saved is given back to them straight away, and adding the same original file again reuses the smaller copy. Needs `Pillow` (in `requirements.txt`); `KOKO_IMAGE_COMPRESS=0` turns it off, `KOKO_IMAGE_MAX_SIDE` and `KOKO_IMAGE_QUALITY` (default 2560 and 82) change how hard it works. Tests: `backend/tests/test_imagecompress.py`.

## Scan a page (reading text from a photo)

In a document or wiki, the toolbar's **Scan a page** button lets you choose a photo or scan (or drop one in) and adds the text on it where your cursor is. Undo works like any other edit. Two ways to read it, remembered per browser:

- **On this device** (default): the picture never leaves the browser and it works offline. The reader is PaddleOCR (the PP-OCRv4 text finder plus a reading model) running through ONNX Runtime. It first finds where the lines of text are, so a desk, a table or a mug is simply not text and is skipped, and low-confidence junk is dropped. The page itself is also found (edge detection, no libraries); if that agrees with where the text is, anything outside it is ignored, and a page photographed at an angle is flattened and read again if that reads better. A page edge is never trusted on its own: text is only dropped if nearly all of it lies inside. Tick **Let me adjust the page's edges first** to drag the four corners onto the page yourself. English and the Latin-script languages (Spanish, French, German, Italian, Portuguese, Dutch, Polish, Turkish) use this reader; Russian, Arabic, Hindi, Japanese, Korean and Chinese use the classic reader (Tesseract), whose data downloads from a CDN on first use. If the main reader can't run (its files missing, or an old browser), the classic reader is used and you're told.
- **AI provider**: sends the picture through the server to one of your Koko models and returns the text, keeping headings, lists and tables as Markdown. Better for handwriting and very messy photos. It has to be a model that can see pictures (for example gpt-4o, pixtral or a Llama vision model); if the connection's model is Mistral's OCR model (`mistral-ocr-latest` on api.mistral.ai) its dedicated OCR endpoint is used instead. Nothing is stored on the server. Cloudflare Workers AI vision models (for example `@cf/meta/llama-3.2-11b-vision-instruct`, `@cf/google/gemma-3-12b-it`, `@cf/meta/llama-4-scout-17b-16e-instruct`) work too: the picture goes to `.../ai/run/<model>` as an `image_url` part, like Koko does (same account id and token). Some Llama vision models ask you to accept Meta's licence once from your Cloudflare account first. With the corner adjuster on, the provider gets just the page.

How good is the on-device reader? On synthetic phone-style photos (a page on a desk, shaded, tilted, blurred, low resolution) the classic reader made 18% to 73% character errors on the harder ones, and this one 0% to 2%. Clean, well-lit pages were read perfectly by both. Real handwriting is not something it is built for: use the AI provider.

**Admin: choose the vision model and what it is told.** Admin → **Scan a page** picks one of the models offered to everyone (it must be able to see pictures) and the instruction sent with every picture. The standard instruction tells it to reply with only the text shown, no introduction or description, Markdown only for real structure, and `NO_TEXT` if there is none; edit it freely or reset it. **Everyone uses this model** hides the model picker so Scan a page always uses the admin's model; **What Scan a page starts with** sets the default way (device or model) for people who haven't chosen yet. **Try it on a picture** runs the current settings on an image and shows the reply, the model and the time. API: `GET/PUT /api/admin/ocr`, `POST /api/admin/ocr/test`, `GET /api/ocr/config`.

**Self-hosted reader (small, text-only).** `ocr-server/` (in the repository, not in the deploy tarball, and not required) is a tiny service around Florence-2-base (230M parameters, about 0.45 GB of weights, about 1.2 GB of memory while running) that speaks the OpenAI chat format, so it is added like any other model and then chosen in Admin → Scan a page. It cannot chat, only read text, and returns plain text. See `ocr-server/README.md` for setup, measured speed and memory, and accuracy.

In an encrypted document the on-device choice just works. The AI provider choice asks first (once per session), since it sends the picture through the server.

The readers' files live in `frontend/public/ocr` (copied by `npm run build` from `node_modules` and from `frontend/ocr-models`, which holds the two reading models and their alphabets and explains a trap: the alphabet files must have no trailing newline). It's about 50 MB on disk. Server test: `backend/tests/test_ocr.py`.

## Desktop app and offline copy

KokoDocs keeps a copy of everything on the device and works with no connection, in the browser and in the desktop app.

- **What is kept:** the app itself (a service worker), your document and folder lists, every document's content, and recent items. After signing in, a background job downloads everything you can open (shown as "Saving offline copy 3/12" in the title bar) and refreshes only what changed.
- **Offline:** open, search titles, edit anything, create new documents and rename them. Edits are saved on the device as you type.
- **Coming back online:** documents merge with whatever others changed (Yjs, so edits combine rather than overwrite), new documents are created on the server with the same id, renames are replayed in order, and you get a note saying what was sent.
- **Not kept:** zero-knowledge (encrypted) accounts and documents, and password-protected links. The server can't read them and nothing readable is written to disk. Signing out erases the offline copy. A person can turn it off with `localStorage['koko.offline'] = 'off'`.
- Needs a secure origin (https, or localhost) for the service worker.

### The desktop app (`desktop/`)

An Electron window around your server with a custom title bar (traffic lights inset on macOS, native window buttons on Windows and Linux), back/forward, a search button (also Cmd/Ctrl+K), and an offline/sync status chip. It also handles screen sharing in meetings, camera and microphone permission, and opens outside links in the browser.

```bash
cd desktop
npm install
npm start
npm run dist                                       # dmg / exe / AppImage in desktop/dist
```

The app is built for docs.kokodev.cc and the address can't be changed (change `SERVER` in `desktop/main.js` to build it for your own server; an unpackaged run can use `KOKO_DEV_URL` for testing). The first launch shows a short welcome walkthrough. Open it once while connected; after that it starts and works without a connection.

**Nightly builds.** `.github/workflows/desktop-nightly.yml` builds the app on macOS (Apple Silicon and Intel: `.dmg`, `.zip`), Windows (installer and portable `.exe`) and Linux (`.AppImage`, `.deb`) every night at 03:00 UTC, when `desktop/` has changed since the last one, and publishes them to the **`nightly`** pre-release on GitHub (replaced each time, with the tag moved to that commit). Run it by hand from Actions → *Desktop nightly* → *Run workflow*. The builds aren't signed (macOS: right-click → Open the first time; Windows may show a SmartScreen warning).

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

Signed-out visitors see a marketing site: the home page (product tour with a tab for each kind of file, six feature spotlights, phone and dark-mode views, FAQ), `/features` (every feature by area), `/why` (why self-host, plus a side-by-side table) and `/self-host` (run it, systemd, Caddy and nginx snippets, the main settings). The screenshots are real captures of the app in `frontend/public/shots/` (`<name>.jpg` and `<name>-dark.jpg`; the one matching the visitor's theme is shown). To refresh them after the interface changes, replace those files with new captures at the same names.

## Shapes in documents

The toolbar's shapes button (or `/shape` in the slash menu) drops a rectangle, rounded rectangle, ellipse, triangle, diamond, hexagon, star, arrow or line into the text, like a picture. Click one to open its menu: change the shape, fill colour, outline colour and thickness, type a label (or double-click it), and align it. Drag the corner to resize (hold Shift to keep the proportions). Shapes also work in table cells and wikis. They are saved as part of the document, appear as real SVG in HTML and PDF export, and become pictures in Word export.

## Importing from Notion

In a wiki, the upload-arrow button above the contents opens **Import from Notion**. In Notion choose ⋯, *Export*, format **Markdown & CSV** (include sub-pages), and drop the downloaded .zip in (large exports arrive as zips inside a zip, which is fine; loose .md, .html and .csv files work too). You see how many pages, folders and pictures were found, then choose whether to bring the pictures and whether to put everything in one folder.

What comes across: the page tree (a page with sub-pages becomes a folder holding the page and its children), headings, lists, checklists, tables, code, quotes, links, callouts (the emoji picks note, tip, warning and so on), toggles (as a bold title and its content), pictures (uploaded to the wiki, identical ones stored once), links between pages (rewritten to open the imported page), databases (the table as a page, up to 200 rows, with each row as a page whose properties are a small table). Files such as PDFs are not imported, and the page says where they were. The conversion happens in your browser, and nothing is sent anywhere except the pages and pictures that go into the wiki. The page list and text conversion are covered by `frontend/tests/notion.test.ts`.

The built-in spell checker leaves short forms alone: units and measures (km, cm, ft, kg, mph, GB, GHz, dpi, kWh…), times (am, pm), days and months (Mon, Jan, Sept), titles and company endings (Dr., Prof., Ltd.), everyday abbreviations (etc., approx., avg., dept., info), and ones attached to a number (5km, 10am, 2nd, 4x). The list is `SHORT_FORMS` in `backend/app/proofread.py`; add your own there.

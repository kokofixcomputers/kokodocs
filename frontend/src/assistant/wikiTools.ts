import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import * as Y from 'yjs'
import { DEFAULT_META } from '../editor/Pagination'
import { baseExtensions } from '../editor/extensions'
import { fragLines } from '../editor/diff'
import { ApiRequestSchema, WikiBadge } from '../wiki/WikiNodes'
import { WikiTab, WikiTabs } from '../wiki/WikiTabs'
import { METHODS, type Vars } from '../wiki/request'
import { ancestors, children, descendants, type Tree } from '../wiki/tree'
import { type Adapter, type Tool, clip, tool } from './adapter'
import { createDocAdapter, mdToHtml } from './docTools'

export interface WikiDeps {
  ydoc: Y.Doc
  getTree: () => Tree
  getCur: () => string | null
  getEditor: () => Editor | null
  getTitle: () => string
  setTitle: (t: string) => void
  canEdit: () => boolean
  getVars: () => { shared: Vars; privateNames: string[] }
  setSharedVar: (name: string, value: string | null) => void
  add: (t: 'page' | 'folder', parent: string | null, title: string, method?: string) => string
  patch: (id: string, p: { title?: string; method?: string }) => void
  move: (id: string, parent: string | null, before: string | null) => void
  remove: (ids: string[]) => void
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const norm = (s: string) => s.trim().toLowerCase()

export function createWikiAdapter(d: WikiDeps): Adapter {
  const tree = () => d.getTree()
  const titleOf = (id: string) => tree()[id]?.title || 'Untitled'

  /** Accepts a page id, or its title if that is unambiguous. Defaults to the page the user has open. */
  const pageId = (v: unknown): string => {
    const t = tree()
    const raw = v === undefined || v === null || v === '' ? d.getCur() : String(v)
    if (!raw) throw new Error('This wiki has no pages yet. Use create_page first.')
    if (t[raw]?.t === 'page') return raw
    const hits = Object.keys(t).filter((k) => t[k].t === 'page' && norm(t[k].title) === norm(raw))
    if (hits.length === 1) return hits[0]
    throw new Error(hits.length > 1 ? `More than one page is called “${raw}”. Use its id from list_pages.` : `There is no page “${raw}”. Call list_pages to see the pages and their ids.`)
  }
  const itemId = (v: unknown): string => {
    const t = tree(), raw = String(v ?? '')
    if (t[raw]) return raw
    const hits = Object.keys(t).filter((k) => norm(t[k].title) === norm(raw))
    if (hits.length === 1) return hits[0]
    throw new Error(`There is no page or folder “${raw}”. Call list_pages to see ids.`)
  }
  const folderOrRoot = (v: unknown): string | null => {
    if (v === undefined || v === null || v === '' || v === 'root') return null
    const id = itemId(v)
    if (tree()[id].t !== 'folder') throw new Error(`“${titleOf(id)}” is a page, not a folder. Pages can't contain other items.`)
    return id
  }

  // pages other than the open one are edited through a hidden editor bound to the same shared document
  const headless = async (id: string): Promise<Editor> => {
    const ed = new Editor({
      element: document.createElement('div'), editable: true,
      extensions: [...baseExtensions(), ApiRequestSchema, WikiBadge, WikiTabs, WikiTab, Collaboration.configure({ document: d.ydoc, field: 'p:' + id })],
    })
    const frag = d.ydoc.getXmlFragment('p:' + id)
    // the hidden editor fills in from the shared document a moment after it is created
    for (let i = 0; i < 40 && !(frag.length === 0 || ed.state.doc.childCount === frag.length); i++) await sleep(25)
    if (frag.length !== 0 && ed.state.doc.childCount !== frag.length) { ed.destroy(); throw new Error('Couldn\'t open that page just now. Try again.') }
    return ed
  }
  async function withPage<T>(id: string, fn: (ed: Editor) => T | Promise<T>): Promise<T> {
    const live = d.getEditor()
    if (id === d.getCur() && live && !live.isDestroyed) return fn(live)
    const ed = await headless(id)
    try { const r = await fn(ed); await sleep(40); return r } finally { ed.destroy() }
  }
  const docAdapter = (ed: Editor, id: string) => createDocAdapter({ editor: ed, getTitle: () => titleOf(id), setTitle: () => {}, getMeta: () => ({ ...DEFAULT_META, header: '', footer: '' }), setMeta: () => {}, canEdit: d.canEdit })
  const protoTools = createDocAdapter({ editor: {} as Editor, getTitle: () => '', setTitle: () => {}, getMeta: () => ({ ...DEFAULT_META, header: '', footer: '' }), setMeta: () => {}, canEdit: () => true }).tools
  const isOpen = (id: string) => id === d.getCur() && !!d.getEditor()

  /** The document tools, pointed at any page of the wiki. */
  const onPage = (base: string, name: string, description: string): Tool => {
    const proto = protoTools.find((t) => t.spec.function.name === base)!
    const params = proto.spec.function.parameters as { properties: Record<string, unknown>; required: string[] }
    const t = tool(name, description, { ...params.properties, page: { type: 'string', description: 'Page id from list_pages. Defaults to the page the user has open.' } }, params.required, {
      edit: proto.edit,
      label: (a) => { let n = ''; try { n = titleOf(pageId(a?.page)) } catch { /* shown on run */ } return `${proto.label?.(a) ?? name}${n ? ` on “${n}”` : ''}` },
      describe: proto.edit ? (a) => {
        let id = ''; try { id = pageId(a.page) } catch { /* the run reports it */ }
        const live = d.getEditor()
        if (id && isOpen(id) && live) { const item = docAdapter(live, id).tools.find((x) => x.spec.function.name === base)!.describe?.(a); if (item) return { ...item, title: `${item.title} on “${titleOf(id)}”` } }
        return { title: `${name.replace(/_/g, ' ')}${id ? ` on “${titleOf(id)}”` : ''}`, detail: a.index !== undefined ? `Block #${a.index}` : a.find ? `Replace “${clip(String(a.find), 40)}”` : undefined, after: a.markdown ? clip(String(a.markdown), 360) : a.replace ? clip(String(a.replace), 200) : undefined }
      } : undefined,
      run: async (a) => { const id = pageId(a.page); return withPage(id, (ed) => docAdapter(ed, id).tools.find((x) => x.spec.function.name === base)!.run(a)) },
    })
    return t
  }

  const outline = () => {
    const t = tree(), cur = d.getCur()
    const lines: string[] = []
    const walk = (p: string | null, depth: number) => {
      for (const id of children(t, p)) {
        const e = t[id]
        lines.push(`${'  '.repeat(depth)}- ${e.t === 'folder' ? '[folder]' : '[page]'} ${e.title || 'Untitled'}${e.method ? ` (${e.method} badge)` : ''}  id=${id}${id === cur ? '  <- open now' : ''}`)
        if (e.t === 'folder') walk(id, depth + 1)
      }
    }
    walk(null, 0)
    return lines.length ? lines.join('\n') : '(the wiki has no pages yet)'
  }

  const listPages: Tool = tool('list_pages', 'The wiki\'s table of contents: folders and pages with their ids. Start here.', {}, [], { label: () => 'Looked at the contents', run: () => `Wiki “${d.getTitle()}”:\n${outline()}` })
  const searchWiki: Tool = tool('search_wiki', 'Search the text of every page (and page titles).', { query: { type: 'string' } }, ['query'], {
    label: (a) => `Searched the wiki for “${clip(String(a?.query ?? ''), 30)}”`,
    run: (a) => {
      const q = norm(String(a.query)); if (!q) throw new Error('query must not be empty')
      const t = tree(), hits: string[] = []
      for (const id of Object.keys(t)) {
        if (t[id].t !== 'page') continue
        if (norm(t[id].title).includes(q)) hits.push(`“${t[id].title}” (id=${id}): title matches`)
        fragLines(d.ydoc.getXmlFragment('p:' + id)).forEach((l) => { if (norm(l).includes(q)) hits.push(`“${t[id].title}” (id=${id}): ${clip(l, 160)}`) })
      }
      return hits.length ? `${hits.length} match(es):\n${hits.slice(0, 40).join('\n')}` : `No page mentions “${a.query}”.`
    },
  })

  const readPage = onPage('read_document', 'read_page', 'Read a page as numbered blocks in Markdown. Do this before editing it. Request blocks appear as ```api-request fences holding JSON; badges appear as [[badge:Label]].')
  const readBlocks = onPage('read_blocks', 'read_page_blocks', 'Read a range of blocks (inclusive) of a long page.')
  const findText = onPage('find_text', 'find_in_page', 'Search one page\'s text; returns block numbers.')
  const replaceText = onPage('replace_text', 'replace_in_page', 'Replace exact text on a page (everywhere or once).')
  const editBlock = onPage('edit_block', 'edit_page_block', 'Rewrite one block of a page with new Markdown. For an api-request block, use edit_api_request instead.')
  const insertBlocks = onPage('insert_blocks', 'insert_page_blocks', 'Insert Markdown after a block of a page (or at its start/end). Use [[badge:Required]] for badges and a fenced ```api-request block (JSON) for request blocks.')
  const deleteBlocks = onPage('delete_blocks', 'delete_page_blocks', 'Delete blocks from..to (inclusive) on a page.')

  const createPage: Tool = tool('create_page', 'Add a page to the contents, optionally inside a folder, with its content as Markdown. Returns the new id.',
    { title: { type: 'string' }, parent: { type: 'string', description: 'Folder id or title, or leave out for the top level' }, markdown: { type: 'string', description: 'The page content' }, method: { type: 'string', enum: [...METHODS], description: 'Optional method badge shown beside the page in the contents' } }, ['title'], {
      edit: true, describe: (a) => ({ title: `New page “${a.title}”${a.parent ? ` in ${clip(String(a.parent), 30)}` : ''}${a.method ? ` (${a.method})` : ''}`, after: a.markdown ? clip(String(a.markdown), 360) : undefined }),
      run: async (a) => {
        const parent = folderOrRoot(a.parent)
        const id = d.add('page', parent, String(a.title).slice(0, 120), a.method ? String(a.method).toUpperCase() : undefined)
        if (a.markdown) await withPage(id, (ed) => { ed.commands.setContent(mdToHtml(String(a.markdown)), true) })
        return `Created page “${a.title}” with id=${id}.`
      },
    })
  const setPageContent: Tool = tool('set_page_content', 'Replace the whole content of a page with new Markdown. Use for rewriting a page from scratch; prefer smaller edits otherwise.', { page: { type: 'string' }, markdown: { type: 'string' } }, ['page', 'markdown'], {
    edit: true, describe: (a) => { let n = ''; try { n = titleOf(pageId(a.page)) } catch { /* the run reports it */ } return { title: `Rewrite the page “${n}”`, after: clip(String(a.markdown ?? ''), 360) } },
    run: async (a) => { const id = pageId(a.page); await withPage(id, (ed) => { ed.commands.setContent(mdToHtml(String(a.markdown)), true) }); return `Rewrote “${titleOf(id)}”.` },
  })
  const createFolder: Tool = tool('create_folder', 'Add a folder to the contents.', { title: { type: 'string' }, parent: { type: 'string', description: 'Folder id or title; leave out for the top level' } }, ['title'], {
    edit: true, describe: (a) => ({ title: `New folder “${a.title}”${a.parent ? ` in ${clip(String(a.parent), 30)}` : ''}` }),
    run: (a) => `Created folder “${a.title}” with id=${d.add('folder', folderOrRoot(a.parent), String(a.title).slice(0, 120))}.`,
  })
  const renameItem: Tool = tool('rename_item', 'Rename a page or folder.', { id: { type: 'string' }, title: { type: 'string' } }, ['id', 'title'], {
    edit: true, describe: (a) => ({ title: `Rename “${(() => { try { return titleOf(itemId(a.id)) } catch { return a.id } })()}” to “${a.title}”` }),
    run: (a) => { const id = itemId(a.id); d.patch(id, { title: String(a.title).slice(0, 120) }); return 'Renamed.' },
  })
  const setBadge: Tool = tool('set_method_badge', 'Set (or clear with "none") the method badge shown beside a page in the contents, such as GET or POST.', { id: { type: 'string' }, method: { type: 'string', enum: [...METHODS, 'none'] } }, ['id', 'method'], {
    edit: true, describe: (a) => ({ title: `Badge ${a.method === 'none' ? 'removed from' : `${a.method} on`} “${(() => { try { return titleOf(itemId(a.id)) } catch { return a.id } })()}”` }),
    run: (a) => { const id = itemId(a.id); if (tree()[id].t !== 'page') throw new Error('Only pages have a badge.'); d.patch(id, { method: a.method === 'none' ? undefined : String(a.method) }); return 'Updated.' },
  })
  const moveItem: Tool = tool('move_item', 'Move a page or folder into a folder (or "root"), optionally just before another item.', { id: { type: 'string' }, parent: { type: 'string', description: 'Folder id/title or "root"' }, before: { type: 'string', description: 'Place it just before this item id (otherwise last)' } }, ['id', 'parent'], {
    edit: true, describe: (a) => ({ title: `Move “${(() => { try { return titleOf(itemId(a.id)) } catch { return a.id } })()}” to ${a.parent === 'root' ? 'the top level' : `“${clip(String(a.parent), 30)}”`}` }),
    run: (a) => {
      const id = itemId(a.id), parent = folderOrRoot(a.parent), before = a.before ? itemId(a.before) : null
      if (parent === id || (parent && descendants(tree(), id).includes(parent))) throw new Error('A folder can\'t be moved into itself.')
      d.move(id, parent, before); return 'Moved.'
    },
  })
  const deleteItem: Tool = tool('delete_item', 'Delete a page or folder (a folder takes everything inside it). It stays recoverable only through version history.', { id: { type: 'string' } }, ['id'], {
    edit: true,
    describe: (a) => { try { const id = itemId(a.id), n = descendants(tree(), id).length; return { title: `Delete “${titleOf(id)}”${n ? ` and ${n} item${n === 1 ? '' : 's'} inside it` : ''}` } } catch { return { title: `Delete ${a.id}` } } },
    run: (a) => { const id = itemId(a.id); const ids = [id, ...descendants(tree(), id)]; d.remove(ids); return `Deleted ${ids.length} item(s).` },
  })

  const kvSchema = { type: 'array', items: { type: 'object', properties: { k: { type: 'string' }, v: { type: 'string' }, off: { type: 'boolean', description: 'true to keep it listed but not send it' } }, required: ['k', 'v'] } }
  const reqProps = {
    method: { type: 'string', enum: [...METHODS] }, url: { type: 'string', description: 'Usually starts with {{baseUrl}}' }, query: { ...kvSchema, description: 'Query parameters' }, headers: kvSchema,
    body: { type: 'string' }, body_type: { type: 'string', enum: ['none', 'json', 'text', 'form'] }, description: { type: 'string', description: 'One line shown under the address' }, example: { type: 'string', description: 'A sample response shown on the Example response tab' },
  }
  const attrsFrom = (a: any, base: Record<string, unknown> = {}) => {
    const out: Record<string, unknown> = { ...base }
    if (a.method !== undefined) out.method = String(a.method).toUpperCase()
    if (a.url !== undefined) out.url = String(a.url)
    if (a.query !== undefined) out.query = (a.query as any[]).map((x) => ({ k: String(x.k), v: String(x.v ?? ''), ...(x.off ? { off: true } : {}) }))
    if (a.headers !== undefined) out.headers = (a.headers as any[]).map((x) => ({ k: String(x.k), v: String(x.v ?? ''), ...(x.off ? { off: true } : {}) }))
    if (a.body !== undefined) out.body = String(a.body)
    if (a.body_type !== undefined) out.bodyType = String(a.body_type)
    else if (a.body && !base.bodyType) out.bodyType = 'json'
    if (a.description !== undefined) out.title = String(a.description)
    if (a.example !== undefined) out.example = String(a.example)
    return out
  }
  const blockPos = (ed: Editor, i: unknown, what: string) => {
    let pos = 0, found = -1
    const n = Number(i)
    ed.state.doc.forEach((node, from, idx) => { if (idx === n) { pos = from; found = idx } })
    if (found < 0) throw new Error(`There is no block #${i} on this page (${what}). Call read_page.`)
    return pos
  }
  const addRequest: Tool = tool('add_api_request', 'Add a request block (a request people can edit and send) to a page.', { page: { type: 'string' }, after: { description: 'Block number to insert after, or "start" / "end" (default end)' }, ...reqProps }, ['method', 'url'], {
    edit: true,
    describe: (a) => ({ title: `Add a request block: ${String(a.method ?? 'GET').toUpperCase()} ${clip(String(a.url ?? ''), 60)}`, detail: a.description ? String(a.description) : undefined, after: a.body ? clip(String(a.body), 240) : undefined }),
    run: async (a) => {
      const id = pageId(a.page)
      return withPage(id, (ed) => {
        const size = ed.state.doc.content.size
        let pos = size
        if (a.after === 'start') pos = 0
        else if (a.after !== undefined && a.after !== 'end') { const p = blockPos(ed, a.after, 'after'); pos = p + ed.state.doc.child(Number(a.after)).nodeSize }
        ed.chain().insertContentAt(pos, { type: 'apiRequest', attrs: attrsFrom(a) }).run()
        return `Added a ${String(a.method).toUpperCase()} request block to “${titleOf(id)}”.`
      })
    },
  })
  const editRequest: Tool = tool('edit_api_request', 'Change fields of an existing request block (only the fields you pass change). Find its block number with read_page.', { page: { type: 'string' }, index: { type: 'number', description: 'Block number of the request block' }, ...reqProps }, ['index'], {
    edit: true,
    describe: (a) => ({ title: `Edit request block #${a.index}`, detail: [a.method && `Method: ${a.method}`, a.url && `Address: ${a.url}`, a.body !== undefined && 'Body changed', a.headers && 'Headers changed', a.query && 'Parameters changed', a.example !== undefined && 'Example changed'].filter(Boolean).join('\n') || undefined }),
    run: async (a) => {
      const id = pageId(a.page)
      return withPage(id, (ed) => {
        const pos = blockPos(ed, a.index, 'edit')
        const node = ed.state.doc.nodeAt(pos)
        if (!node || node.type.name !== 'apiRequest') throw new Error(`Block #${a.index} is not a request block. Use edit_page_block for text.`)
        ed.view.dispatch(ed.state.tr.setNodeMarkup(pos, undefined, attrsFrom(a, node.attrs)))
        return `Updated request block #${a.index}.`
      })
    },
  })

  const getVariables: Tool = tool('get_variables', 'The wiki\'s variables that requests can use as {{name}}: shared ones with values, and the names (not values) of people\'s private ones.', {}, [], {
    label: () => 'Looked at the variables',
    run: () => { const v = d.getVars(); const shared = Object.entries(v.shared); return `Shared: ${shared.length ? shared.map(([k, x]) => `{{${k}}} = ${x}`).join(', ') : 'none'}.\nPrivate names on this device (values hidden): ${v.privateNames.length ? v.privateNames.map((n) => `{{${n}}}`).join(', ') : 'none'}.` },
  })
  const setVariable: Tool = tool('set_variable', 'Set a shared variable (visible to everyone with access, so never put secrets in it) or remove it by passing an empty value.', { name: { type: 'string' }, value: { type: 'string' } }, ['name', 'value'], {
    edit: true, describe: (a) => ({ title: a.value ? `Set {{${a.name}}} to ${clip(String(a.value), 60)}` : `Remove {{${a.name}}}` }),
    run: (a) => { if (!/^[\w.-]+$/.test(String(a.name))) throw new Error('Variable names use letters, numbers, dots, dashes and underscores.'); d.setSharedVar(String(a.name), a.value ? String(a.value) : null); return 'Updated.' },
  })
  const setTitle: Tool = tool('set_wiki_title', 'Rename the wiki itself.', { title: { type: 'string' } }, ['title'], { edit: true, describe: (a) => ({ title: `Rename the wiki to “${a.title}”` }), run: (a) => { d.setTitle(String(a.title)); return 'Renamed.' } })

  return {
    kind: 'wiki', noun: 'wiki', title: d.getTitle, canEdit: d.canEdit, undo: () => { (d.getEditor()?.commands as any)?.undo() },
    guide: `You are working in a wiki: documentation made of pages and folders (shown in a sidebar), where each page is a rich-text document. Start with list_pages to see the structure, then read_page for the one you need. Pages are identified by id (use list_pages); most page tools default to the page the user has open.
Make the smallest edit that does the job. Use create_page / create_folder / move_item to organise, and edit_page_block, insert_page_blocks, replace_in_page for text.
Wikis often document HTTP APIs, so request blocks matter. A request block is shown in read_page as a fenced \`\`\`api-request block holding JSON: {"method","url","query":[{"k","v"}],"headers":[{"k","v"}],"body","bodyType":"none|json|text|form","example","title"}. Create them with add_api_request and change them with edit_api_request (never retype the fence by hand when a tool exists). Addresses should start with {{baseUrl}} so people can point them at another server; check get_variables and use set_variable for shared values. Never put API keys in shared variables or in a request block: tell the user to add secrets under Variables, "Only in this browser", and refer to them as {{name}} (for example an Authorization header of Bearer {{token}}).
Tabs (a row of panels, such as one per language) are written :::tabs, then for each panel a line ::tab Title followed by ordinary Markdown, then :::. Badges inside text are written [[badge:Required]] (GET, POST, PUT, PATCH, DELETE, Required, Optional, Deprecated, Beta and New are coloured). Parameter tables are normal Markdown tables with the columns Name, Type, Required, Description. Use callouts (> [!note] ...) for warnings. Do not invent endpoints, fields or behaviour: write only what the user told you or what you read in the wiki, and ask when something is missing. You cannot send requests yourself.`,
    context: () => {
      const cur = d.getCur(), ed = d.getEditor()
      let s = cur ? `The user has the page “${titleOf(cur)}” (id=${cur}) open${ancestors(tree(), cur).length ? ` inside ${ancestors(tree(), cur).map(titleOf).join(' / ')}` : ''}.` : 'The wiki has no pages yet.'
      if (ed && !ed.isDestroyed) { const { from, to, empty } = ed.state.selection; if (!empty) s += ` They selected: “${clip(ed.state.doc.textBetween(from, to, ' ', ' '), 600)}”.`; else s += ` Their cursor is in block #${ed.state.doc.resolve(from).index(0)}.` }
      return s
    },
    suggestions: ['Outline a wiki for my API', 'Document the open page as an API reference', 'Add a request example to this page', 'Summarize what this wiki covers'],
    tools: [listPages, searchWiki, readPage, readBlocks, findText, getVariables, replaceText, editBlock, insertBlocks, deleteBlocks, setPageContent, createPage, createFolder, renameItem, setBadge, moveItem, deleteItem, addRequest, editRequest, setVariable, setTitle],
  }
}

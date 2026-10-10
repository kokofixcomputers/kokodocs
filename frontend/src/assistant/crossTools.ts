import { api, type AiFileEntry } from '../api'
import { type Tool, clip, tool } from './adapter'

const NOUN: Record<string, string> = { doc: 'document', sheet: 'spreadsheet', slides: 'presentation', form: 'form', wiki: 'wiki', board: 'board', whiteboard: 'whiteboard' }
const names = new Map<string, string>()   // file id -> name, learnt from searches, so the activity feed can say what is being read
const line = (f: AiFileEntry) => `- id ${f.id}: “${f.title}” (${NOUN[f.kind] ?? f.kind}, ${f.owner === 'me' ? 'yours' : `from ${f.owner}`}, changed ${new Date(f.updated_at * 1000).toLocaleDateString()})${f.snippet ? `\n    …${clip(f.snippet, 160)}…` : ''}`

/** Read-only tools for looking at the person's OTHER files. They exist only when the person has allowed it. */
export function crossTools(currentDocId: string): Tool[] {
  return [
    tool('search_other_files', 'Look through the person\'s OTHER files (not the one open now) for something. With a query it searches what is written inside them; with no query it lists the most recently changed. Returns names, kinds and short snippets; read one with read_other_file.',
      { query: { type: 'string', description: 'Words to look for inside their files. Leave empty to list recent files.' } }, [], {
        access: true,
        prepare: async (a) => ({ title: a.query ? `Search your other files for “${clip(String(a.query), 60)}”` : 'Look at the list of your other files', detail: 'Only names and short snippets are read.' }),
        label: (a) => (a.query ? `Searching your other files for “${clip(String(a.query), 40)}”` : 'Looking through your other files'),
        run: async (a) => {
          const files = await api.aiFiles(String(a.query ?? '').trim(), currentDocId)
          files.forEach((f) => names.set(f.id, f.title))
          return files.length ? `Found ${files.length}:\n${files.map(line).join('\n')}` : a.query ? 'Nothing in their other files matches that.' : 'They have no other files.'
        },
      }),
    tool('read_other_file', 'Read the full content of one of the person\'s OTHER files by id (from search_other_files). Read only: you cannot change other files. Say which file you took something from.',
      { id: { type: 'string', description: 'The file id from search_other_files' } }, ['id'], {
        access: true,
        prepare: async (a) => { const f = await api.aiFileInfo(String(a.id)); names.set(f.id, f.title); return { title: `Read “${f.title}”`, detail: `${NOUN[f.kind] ?? f.kind}, ${f.owner === 'me' ? 'yours' : `from ${f.owner}`}` } },
        label: (a) => (names.get(String(a.id)) ? `Reading “${clip(names.get(String(a.id))!, 40)}”` : 'Reading another file'),
        run: async (a) => {
          const f = await api.aiFile(String(a.id))
          return `“${f.title}” (${NOUN[f.kind] ?? f.kind}, ${f.owner === 'me' ? 'yours' : `from ${f.owner}`})${f.truncated ? ' [cut short: it is long]' : ''}\n\n${f.empty ? '(it is empty)' : f.text}`
        },
      }),
  ]
}

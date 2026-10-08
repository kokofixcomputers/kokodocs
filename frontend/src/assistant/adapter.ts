import type { ToolSpec } from './llm'

/** What the approval card shows for a proposed edit. */
export interface ProposalItem { title: string; detail?: string; before?: string; after?: string }

export interface Tool {
  spec: ToolSpec
  /** Edits need the user's approval (unless they allowed edits for the session). Reads run immediately. */
  edit?: boolean
  /** Reads another file of the person's: runs only if they allow it, and in "ask" mode only after they say yes (see `prepare`). */
  access?: boolean
  /** What the permission card shows for an `access` tool. */
  prepare?: (args: any) => Promise<ProposalItem>
  describe?: (args: any) => ProposalItem
  /** Short label for the activity feed while a read tool runs. */
  label?: (args: any) => string
  run: (args: any) => Promise<string> | string
}

/** The assistant is the same for documents and spreadsheets; an adapter supplies the tools and context for each. */
export interface Adapter {
  kind: 'doc' | 'sheet' | 'slides' | 'wiki' | 'form' | 'board'
  noun: 'document' | 'spreadsheet' | 'presentation' | 'wiki' | 'form' | 'board'
  title: () => string
  canEdit: () => boolean
  /** Extra system-prompt guidance specific to this kind of file. */
  guide: string
  /** Fresh context sent every step (selection, active sheet…). */
  context: () => string
  tools: Tool[]
  suggestions: string[]
  undo: () => void
}

export function tool(name: string, description: string, properties: Record<string, unknown>, required: string[], rest: Omit<Tool, 'spec'>): Tool {
  return { spec: { type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } }, ...rest }
}

export const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)
export const MAX_RESULT_CHARS = 60000

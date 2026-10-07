import type { Editor } from '@tiptap/core'
import type { SheetModel } from '../sheet/model'
import type { SlidesModel } from '../slides/model'

/** A parsed import waiting for its editor to open (applied once, when the file is empty and in sync). */
export type ImportPlan =
  | { kind: 'doc'; title: string; apply: (editor: Editor) => void; note?: string }
  | { kind: 'sheet'; title: string; apply: (model: SheetModel) => void; note?: string }
  | { kind: 'slides'; title: string; apply: (model: SlidesModel) => void; note?: string }

const pending = new Map<string, ImportPlan>()
export const setPending = (docId: string, plan: ImportPlan) => { pending.set(docId, plan) }
export const takePending = <K extends ImportPlan['kind']>(docId: string, kind: K): Extract<ImportPlan, { kind: K }> | null => {
  const p = pending.get(docId)
  if (!p || p.kind !== kind) return null
  pending.delete(docId)
  return p as Extract<ImportPlan, { kind: K }>
}

const prompts = new Map<string, string>()
/** A request typed into the template gallery ("describe what you need"), sent to the assistant when the new file opens. */
export const setPrompt = (docId: string, text: string) => { prompts.set(docId, text) }
export const takePrompt = (docId: string) => { const t = prompts.get(docId); prompts.delete(docId); return t ?? null }

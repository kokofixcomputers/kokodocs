import type { Value } from './model'
/** What the card dialog is asked to open: an existing card, or a new one in a column (optionally with some values filled in). */
export type OpenTarget = { id: string } | { col: string; v?: Record<string, Value> }

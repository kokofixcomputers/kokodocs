import { BookOpen, ClipboardList, FileText, Kanban, PenTool, Presentation, Table2 } from 'lucide-react'
import type { DocKind } from '../api'

export type Kind = DocKind
export const KindIcon = ({ kind, size = 17 }: { kind: Kind; size?: number }) => (kind === 'sheet' ? <Table2 size={size} /> : kind === 'slides' ? <Presentation size={size} /> : kind === 'form' ? <ClipboardList size={size} /> : kind === 'wiki' ? <BookOpen size={size} /> : kind === 'whiteboard' ? <PenTool size={size} /> : kind === 'board' ? <Kanban size={size} /> : <FileText size={size} />)

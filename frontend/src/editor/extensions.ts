import { Callout } from './Callout'
import { MathBlock, MathInline } from './MathNode'
import { customBlocks } from './Blocks'
import { ExtBlock } from '../extensions/ExtBlock'
import { DocShape } from './ShapeNode'
import { EmojiNode } from './EmojiNode'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import TextStyle from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import TextAlign from '@tiptap/extension-text-align'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import { AnchorHeading, DocLink, HeadingLinks } from './headingLinks'
import TaskList from '@tiptap/extension-task-list'
import TableRow from '@tiptap/extension-table-row'
import { FontFamily, FontSize } from './FontExtensions'
import { ResizableImage } from './ResizableImage'
import { KokoTable, KokoTableCell, KokoTableHeader } from './TableExtensions'
import { KokoTaskItem } from './TaskItem'
import { LinkEmbed } from './LinkEmbed'

/** Everything that defines the document schema. The live editor and version previews share this list. */
export const baseExtensions = () => [
  StarterKit.configure({ history: false, heading: false, horizontalRule: false }), AnchorHeading.configure({ levels: [1, 2, 3, 4, 5, 6] }), HeadingLinks,
  Callout, EmojiNode, Underline, TextStyle, Color, FontFamily, FontSize,
  Highlight.configure({ multicolor: true }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Subscript, Superscript,
  DocLink.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } }),
  TaskList, KokoTaskItem.configure({ nested: true }),
  KokoTable.configure({ resizable: true, lastColumnResizable: false }), TableRow, KokoTableHeader, KokoTableCell,
  ResizableImage.configure({ inline: true, allowBase64: false }), DocShape, LinkEmbed, MathInline, MathBlock, ...customBlocks(), ExtBlock,
]

import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/react'

/** Re-render once per animation frame when the editor changes, instead of once per transaction.
 *  Tiptap's own default re-renders the whole editor page synchronously for every single transaction (a key press makes several: the text,
 *  the collaboration cursor, proofreading marks, page breaks). That works until a burst of them lands together, and React gives up with
 *  "Maximum update depth exceeded" (error #185). Waiting for the next frame batches a burst into one render, and nothing on screen can
 *  tell, since the toolbar and menus only need to be right by the next paint. Use with `shouldRerenderOnTransaction: false`. */
export function useBatchedRerender(editor: Editor | null) {
  const [, force] = useState(0)
  useEffect(() => {
    if (!editor) return
    let raf = 0
    const on = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; force((n) => n + 1) }) }
    editor.on('transaction', on)
    return () => { cancelAnimationFrame(raf); editor.off('transaction', on) }
  }, [editor])
}

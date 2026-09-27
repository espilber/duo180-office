import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

/** Doc as last seen by the programmatic edit pipeline (context build / read / own write); a differing doc means the user edited in between. */
const docBaseline = new WeakMap<Editor, ProseMirrorNode>()

export function markDocSeen(editor: Editor): void {
  docBaseline.set(editor, editor.state.doc)
}

/** A streamed load tail is not a user edit: appending at the end keeps every block index the pipeline saw valid. */
export function carryDocSeen(editor: Editor, before: ProseMirrorNode): void {
  if (docBaseline.get(editor) === before) docBaseline.set(editor, editor.state.doc)
}

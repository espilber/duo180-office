import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import {
  TABLE_HEADER_FILL,
  type Block,
  type TableCell,
  type TableModel,
} from '@genoffice/docx-engine'
import { pmTableToModel, tableModelToPmNode, type PmMark, type PmNode } from '../editor/convert'
import { equationBlockJson, inlineEquationNodeJson } from '../editor/equation'
import { inheritFrom, inheritTableFormatting, sameBlockRole } from './inherit-formatting'
import { TRACK_IGNORE } from '../editor/revisions'
import { blockRangePositions, isTrackedDeleted } from './doc-utils'

/** Blank = exactly one empty paragraph; a textContent check would misread image/chart-only documents as blank. */
export function isBlankDocument(editor: Editor): boolean {
  const doc = editor.state.doc
  if (doc.childCount !== 1) return false
  const first = doc.child(0)
  return first.type.name === 'docParagraph' && first.content.size === 0
}

// ---- restricted HTML fragment -> PmNode[] ----

export interface NumIds {
  bullet: string | null
  ordered: string | null
}

/**
 * Preset paragraph formats for <pre> / <blockquote>: combinations of existing
 * Block-model properties, so these blocks stay fully editable and round-trip
 * byte-stable through parse -> generate -> parse (no schema/signature change).
 */
export const CODE_BLOCK_PRESET = {
  font: 'Consolas',
  shadingFill: 'F2F2F2',
  borders: 'tblr',
} as const
export const QUOTE_BLOCK_PRESET = {
  color: '666666',
  indentLeft: 720,
  borders: 'l',
} as const

/** pick an existing numbering id of the right kind so new list items join real docx numbering */
export function findNumId(blocks: Block[], kind: 'bullet' | 'ordered'): string | null {
  for (const block of blocks) {
    if (block.type === 'listItem' && block.list?.kind === kind) return block.list.numId
  }
  return null
}

const INLINE_MARK_TAGS: Record<string, string> = {
  strong: 'bold',
  b: 'bold',
  em: 'italic',
  i: 'italic',
  u: 'underline',
  s: 'strike',
  del: 'strike',
  strike: 'strike',
}

function parseInline(element: Node, marks: PmMark[]): PmNode[] {
  const nodes: PmNode[] = []
  element.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = (child.textContent ?? '').replace(/\s+/g, ' ')
      if (text)
        nodes.push({ type: 'text', text, ...(marks.length > 0 ? { marks: [...marks] } : {}) })
      return
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return
    const el = child as Element
    const tag = el.tagName.toLowerCase()
    if (tag === 'br') {
      nodes.push({ type: 'hardBreak' })
      return
    }
    if (tag === 'a') {
      const href = el.getAttribute('href') ?? ''
      nodes.push(...parseInline(el, [...marks, { type: 'link', attrs: { href, rId: null } }]))
      return
    }
    if (tag === 'formula') {
      const latex = (el.textContent ?? '').trim()
      if (!latex) return
      try {
        nodes.push(inlineEquationNodeJson(latex))
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e)
        throw new Error(`Cannot parse the LaTeX in <formula> (${reason}): ${latex}`, { cause: e })
      }
      return
    }
    const markType = INLINE_MARK_TAGS[tag]
    if (markType) {
      const next = marks.some((m) => m.type === markType) ? marks : [...marks, { type: markType }]
      nodes.push(...parseInline(el, next))
      return
    }
    // unknown inline tag (span etc.): keep its text content
    nodes.push(...parseInline(el, marks))
  })
  return nodes
}

function blockNode(type: string, attrs: Record<string, unknown>, content: PmNode[]): PmNode {
  const node: PmNode = {
    type,
    attrs: { docxIndex: null, styleId: null, aiChanged: true, ...attrs },
  }
  if (content.length > 0) node.content = content
  return node
}

function parseList(
  el: Element,
  kind: 'bullet' | 'ordered',
  ilvl: number,
  numIds: NumIds,
  out: PmNode[],
): void {
  el.childNodes.forEach((child) => {
    if (child.nodeType !== Node.ELEMENT_NODE) return
    const item = child as Element
    const tag = item.tagName.toLowerCase()
    if (tag === 'ul' || tag === 'ol') {
      parseList(item, tag === 'ol' ? 'ordered' : 'bullet', ilvl + 1, numIds, out)
      return
    }
    if (tag !== 'li') return
    // extract nested lists first so their items follow this one
    const nested: Element[] = []
    item.querySelectorAll(':scope > ul, :scope > ol').forEach((n) => {
      nested.push(n)
      n.remove()
    })
    out.push(
      blockNode(
        'docListItem',
        { kind, numId: numIds[kind], ilvl: Math.min(ilvl, 4) },
        parseInline(item, []),
      ),
    )
    for (const n of nested) {
      parseList(n, n.tagName.toLowerCase() === 'ol' ? 'ordered' : 'bullet', ilvl + 1, numIds, out)
    }
  })
}

/** paragraph texts of one table cell: <br> and nested <p>/<div> split paragraphs */
function cellParas(cell: Element): string[] {
  const paras: string[] = []
  let current = ''
  const push = () => {
    paras.push(current.replace(/\s+/g, ' ').trim())
    current = ''
  }
  const walk = (node: Node) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        current += child.textContent ?? ''
        return
      }
      if (child.nodeType !== Node.ELEMENT_NODE) return
      const el = child as Element
      const tag = el.tagName.toLowerCase()
      if (tag === 'br') push()
      else if (tag === 'p' || tag === 'div') {
        if (current.trim()) push()
        walk(el)
        push()
      } else walk(el)
    })
  }
  walk(cell)
  if (current.trim()) push()
  const out = paras.filter((p, i) => p !== '' || (i > 0 && i < paras.length - 1))
  return out.length > 0 ? out : ['']
}

/**
 * <table> -> protected table block: display TableModel + generated w:tbl
 * fragment. Cell texts are patched into the fragment at save time via the
 * existing genXml branch of pmDocToSavePlan (patchTableCellTexts), so the
 * model row/col counts must mirror the generated grid.
 */
function parseTable(el: Element): PmNode | null {
  const trs = Array.from(el.querySelectorAll('tr'))
  if (trs.length === 0) return null
  const rawRows = trs.map((tr) => Array.from(tr.children).filter((c) => /^t[hd]$/i.test(c.tagName)))
  const cols = Math.max(...rawRows.map((r) => r.length))
  if (cols === 0) return null
  const headerRow = rawRows[0].some((c) => c.tagName.toLowerCase() === 'th')
  const rows: TableCell[][] = rawRows.map((cells, r) => {
    const isHeader = headerRow && r === 0
    const row: TableCell[] = cells.map((cell) => ({
      paras: cellParas(cell),
      ...(isHeader ? { bold: true, fill: TABLE_HEADER_FILL } : {}),
    }))
    while (row.length < cols)
      row.push({ paras: [''], ...(isHeader ? { bold: true, fill: TABLE_HEADER_FILL } : {}) })
    return row
  })
  // equal column grid, like the ribbon insert and the save-path backfill
  // (pmTableToModel): without colWidthsPct the table renders with no <colgroup>,
  // leaving the fixed-layout column grid to the browser — fragile against
  // spanning pagination widgets and different from what a save/reload shows
  const table: TableModel = { rows, colWidthsPct: Array.from({ length: cols }, () => 100 / cols) }
  return tableModelToPmNode(table)
}

/** <pre> -> mono/shaded paragraph; newlines preserved as hard breaks */
function parseCodeBlock(el: Element): PmNode | null {
  const text = (el.textContent ?? '').replace(/^\n/, '').replace(/\s+$/, '')
  if (!text) return null
  // Latin slot only: monospace applies to code text, an inherited CJK font stays intact
  const mark: PmMark = { type: 'docTextStyle', attrs: { fontAscii: CODE_BLOCK_PRESET.font } }
  const content: PmNode[] = []
  text.split('\n').forEach((line, i) => {
    if (i > 0) content.push({ type: 'hardBreak' })
    if (line !== '') content.push({ type: 'text', text: line, marks: [mark] })
  })
  return blockNode(
    'docParagraph',
    { shadingFill: CODE_BLOCK_PRESET.shadingFill, borders: CODE_BLOCK_PRESET.borders },
    content,
  )
}

/** <blockquote> -> indented gray paragraph with a left border */
function parseBlockquote(el: Element): PmNode | null {
  const mark: PmMark = { type: 'docTextStyle', attrs: { color: QUOTE_BLOCK_PRESET.color } }
  const inline = parseInline(el, [mark])
  if (inline.length === 0) return null
  return blockNode(
    'docParagraph',
    { indentLeft: QUOTE_BLOCK_PRESET.indentLeft, borders: QUOTE_BLOCK_PRESET.borders },
    inline,
  )
}

/**
 * Parse a restricted HTML fragment into top-level PmNodes.
 * Tolerates markdown code fences and plain-text responses.
 */
export function parseHtmlFragment(raw: string, numIds: NumIds): PmNode[] {
  let text = raw.trim()
  const fence = /```(?:html)?\s*([\s\S]*?)```/.exec(text)
  if (fence) text = fence[1].trim()
  if (!text) return []

  // plain text response (no tags): one paragraph per blank-line-separated chunk
  if (!/<[a-z][\s\S]*>/i.test(text)) {
    return text
      .split(/\n{2,}/)
      .map((para) =>
        blockNode('docParagraph', {}, [{ type: 'text', text: para.replace(/\s+/g, ' ').trim() }]),
      )
      .filter((n) => n.content?.[0]?.text)
  }

  const parsed = new DOMParser().parseFromString(text, 'text/html')
  const out: PmNode[] = []
  const pushFormula = (el: Element) => {
    const latex = (el.textContent ?? '').trim()
    if (!latex) return
    try {
      out.push(equationBlockJson(latex))
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      throw new Error(`Cannot parse the LaTeX in <formula> (${reason}): ${latex}`, { cause: e })
    }
  }
  parsed.body.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      const t = (child.textContent ?? '').trim()
      if (t) out.push(blockNode('docParagraph', {}, [{ type: 'text', text: t }]))
      return
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return
    const el = child as Element
    const tag = el.tagName.toLowerCase()
    const headingMatch = /^h([1-6])$/.exec(tag)
    if (headingMatch) {
      out.push(blockNode('docHeading', { level: Number(headingMatch[1]) }, parseInline(el, [])))
    } else if (tag === 'ul' || tag === 'ol') {
      parseList(el, tag === 'ol' ? 'ordered' : 'bullet', 0, numIds, out)
    } else if (tag === 'table') {
      const node = parseTable(el)
      if (node) out.push(node)
    } else if (tag === 'pre') {
      const node = parseCodeBlock(el)
      if (node) out.push(node)
    } else if (tag === 'blockquote') {
      const node = parseBlockquote(el)
      if (node) out.push(node)
    } else if (tag === 'formula') {
      pushFormula(el)
    } else if (tag === 'p' || tag === 'div') {
      const inline = parseInline(el, [])
      if (inline.length > 0) out.push(blockNode('docParagraph', {}, inline))
    } else {
      // unknown block-ish tag: salvage the text
      const t = (el.textContent ?? '').trim()
      if (t) out.push(blockNode('docParagraph', {}, [{ type: 'text', text: t }]))
    }
  })
  return out
}

const BLOCK_TAG = /<\/?(h[1-6]|p|div|ul|ol|li|table|thead|tbody|tr|th|td|pre|blockquote)\b/gi

/**
 * Parse the replacement for a selected span: plain text or inline HTML, or a
 * single <p>…</p>. Any other block structure is refused — the selection lives
 * inside one text block, so a multi-block answer belongs to a block rewrite.
 */
export function parseInlineFragment(raw: string): PmNode[] {
  let text = raw.trim()
  const fence = /```(?:html)?\s*([\s\S]*?)```/.exec(text)
  if (fence) text = fence[1].trim()
  const single = /^<p(?:\s[^>]*)?>([\s\S]*)<\/p>$/i.exec(text)
  if (single) text = single[1]
  if (BLOCK_TAG.test(text)) {
    BLOCK_TAG.lastIndex = 0
    throw new Error(
      'replace_selection takes inline content for the selected span only; block tags (p/h*/ul/table…) mean a rewrite of whole blocks — use replace_blocks',
    )
  }
  const parsed = new DOMParser().parseFromString(`<p>${text}</p>`, 'text/html')
  const p = parsed.body.firstElementChild
  return p ? parseInline(p, []) : []
}

// ---- applying parsed fragments ----

/** record the content change as tracked revisions under this author */
export interface AiTrack {
  author: string
}

function revisionDate(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** blocks whose content ins/del marks can fully represent (tracked replace) */
const TRACKABLE_TYPES = new Set(['docParagraph', 'docHeading', 'docListItem'])

// ---- formatting inheritance for rewrites ----

/**
 * Give the replacement blocks the formatting of the blocks they replace.
 * New block i takes the next not-yet-used old block of the same role (scanning
 * forward), else the nearest earlier one (an expansion of one paragraph into
 * three gives all three the paragraph's formatting). A new table takes the
 * next old table in the range (see inheritTableFormatting). Blocks with no
 * same-role counterpart (a heading the model introduced, protected content)
 * are left as parsed. Tracked-deleted old blocks are not current content and
 * never serve as templates.
 *
 * `anchors`: also hand each template's docxIndex to the first new block it
 * formats (the rewrite saves as an in-place edit of that paragraph/table).
 * Every anchor is lent at most once and in document order, so docxIndex stays
 * unique — the TrackChanges recorder and the save plan key blocks by it.
 * Callers that keep the old blocks in the document (tracked rewrites) must
 * pass false.
 */
export function inheritBlockFormatting(
  editor: Editor,
  startIndex: number,
  endIndex: number,
  nodes: PmNode[],
  anchors: boolean,
): PmNode[] {
  const doc = editor.state.doc
  const templates: Array<{ node: ProseMirrorNode; at: number }> = []
  const tables: Array<{ node: ProseMirrorNode; at: number }> = []
  for (let i = startIndex; i <= Math.min(endIndex, doc.childCount - 1); i++) {
    const node = doc.child(i)
    if (isTrackedDeleted(node)) continue
    if (TRACKABLE_TYPES.has(node.type.name)) templates.push({ node, at: i })
    else if (node.type.name === 'docTable') tables.push({ node, at: i })
  }
  if (templates.length === 0 && tables.length === 0) return nodes
  let cursor = 0
  let tableCursor = 0
  // document index of the last block whose docxIndex was lent
  let lastAnchored = -1
  const used = new Set<number>()
  return nodes.map((next) => {
    if (next.type === 'docTable') {
      const table = tables[tableCursor]
      if (!table) return next
      tableCursor++
      const anchor = anchors && table.at > lastAnchored
      if (anchor) lastAnchored = table.at
      return inheritTableFormatting(table.node, next, { anchor })
    }
    if (!TRACKABLE_TYPES.has(next.type)) return next
    let j = templates.findIndex((t, k) => k >= cursor && sameBlockRole(t.node, next))
    if (j !== -1) cursor = j + 1
    else {
      for (let k = Math.min(cursor, templates.length) - 1; k >= 0; k--) {
        if (sameBlockRole(templates[k].node, next)) {
          j = k
          break
        }
      }
    }
    if (j === -1) return next
    const first = !used.has(j)
    used.add(j)
    // anchors additionally keep document order: a template reused out of
    // order lends its formatting but not its docxIndex
    const anchor = anchors && templates[j].at > lastAnchored
    if (anchor) lastAnchored = templates[j].at
    return inheritFrom(templates[j].node, next, { anchor, first })
  })
}

/**
 * Replace the top-level block range with the parsed nodes (marked aiChanged).
 * The new blocks inherit the replaced blocks' formatting (see
 * inheritBlockFormatting). With `track`, and when both sides are plain text
 * blocks, this becomes a tracked rewrite instead: the old blocks stay struck
 * through (del) and the new blocks follow with ins marks — accept/reject via Review.
 */
export function replaceBlockRange(
  editor: Editor,
  startIndex: number,
  endIndex: number,
  parsed: PmNode[],
  track?: AiTrack,
): boolean {
  if (parsed.length === 0) return false
  // a tracked rewrite keeps the old blocks (struck through) next to the new
  // ones, so the anchors stay with the old blocks until the user accepts
  const nodes = inheritBlockFormatting(editor, startIndex, endIndex, parsed, !track)
  const { from, to } = blockRangePositions(editor, startIndex, endIndex)
  const pmNodes = nodes.map((n) => editor.schema.nodeFromJSON(n))

  let oldTrackable = true
  editor.state.doc.nodesBetween(from, to, (node, _pos, parent) => {
    if (parent === editor.state.doc && !TRACKABLE_TYPES.has(node.type.name)) oldTrackable = false
    return false
  })
  const newTrackable = nodes.every((n) => TRACKABLE_TYPES.has(n.type))
  if (track && oldTrackable && newTrackable) {
    const { ins, del } = editor.schema.marks
    const date = revisionDate()
    // revision marks are the change indicator; no yellow aiChanged on top
    const tracked = nodes.map((n) =>
      editor.schema.nodeFromJSON({ ...n, attrs: { ...n.attrs, aiChanged: false } }),
    )
    const inserted = tracked.reduce((size, n) => size + n.nodeSize, 0)
    const tr = editor.state.tr
    tr.setMeta(TRACK_IGNORE, true)
    if (editor.state.doc.textBetween(from, to, '\n').trim() === '') {
      // nothing to strike through (blank paragraphs): replace outright
      tr.replaceWith(from, to, tracked)
      tr.addMark(from, from + inserted, ins.create({ author: track.author, date }))
    } else {
      tr.insert(to, tracked)
      tr.addMark(to, to + inserted, ins.create({ author: track.author, date }))
      tr.addMark(from, to, del.create({ author: track.author, date }))
    }
    editor.view.dispatch(tr)
    return true
  }
  if (track) {
    const date = revisionDate()
    const oldNodes: ProseMirrorNode[] = []
    editor.state.doc.nodesBetween(from, to, (node, _pos, parent) => {
      if (parent === editor.state.doc) {
        oldNodes.push(
          node.type.create(
            {
              ...node.attrs,
              aiChanged: false,
              blockRevision: { kind: 'del', author: track.author, date },
            },
            node.content,
            node.marks,
          ),
        )
      }
      return false
    })
    const inserted = pmNodes.map((node) =>
      node.type.create(
        {
          ...node.attrs,
          aiChanged: false,
          blockRevision: { kind: 'ins', author: track.author, date },
        },
        node.content,
        node.marks,
      ),
    )
    const tr = editor.state.tr.replaceWith(from, to, [...oldNodes, ...inserted])
    tr.setMeta(TRACK_IGNORE, true)
    editor.view.dispatch(tr)
    return true
  }
  editor.view.dispatch(editor.state.tr.replaceWith(from, to, pmNodes))
  return true
}

/**
 * Replace an inline range inside one text block with the given inline nodes.
 * The new text becomes the selection so a follow-up scope:'selection' command
 * targets it. With `track`, the old text stays struck through (del) and the
 * new text follows with ins marks.
 */
export function replaceInlineRange(
  editor: Editor,
  from: number,
  to: number,
  nodes: ProseMirrorNode[],
  track?: AiTrack,
): void {
  const tr = editor.state.tr
  const blockPos = tr.doc.resolve(from).before(1)
  const inserted = nodes.reduce((size, n) => size + n.nodeSize, 0)
  if (track) {
    const date = revisionDate()
    const { ins, del } = editor.schema.marks
    tr.insert(to, nodes)
    if (inserted > 0) tr.addMark(to, to + inserted, ins.create({ author: track.author, date }))
    tr.addMark(from, to, del.create({ author: track.author, date }))
    tr.setSelection(TextSelection.create(tr.doc, to, to + inserted))
    tr.setMeta(TRACK_IGNORE, true)
  } else {
    tr.replaceWith(from, to, nodes)
    tr.setSelection(TextSelection.create(tr.doc, from, from + inserted))
    const block = tr.doc.nodeAt(blockPos)
    if (block) tr.setNodeMarkup(blockPos, undefined, { ...block.attrs, aiChanged: true })
  }
  editor.view.dispatch(tr)
}

/** insert the parsed nodes after the given top-level block index */
export function insertBlocksAfter(
  editor: Editor,
  index: number,
  nodes: PmNode[],
  track?: AiTrack,
): boolean {
  if (nodes.length === 0) return false
  const { to } = blockRangePositions(editor, index, index)
  const pmNodes = nodes.map((n) =>
    editor.schema.nodeFromJSON(track ? { ...n, attrs: { ...n.attrs, aiChanged: false } } : n),
  )
  const tr = editor.state.tr.insert(to, pmNodes)
  if (track) {
    const date = revisionDate()
    let offset = to
    for (const node of pmNodes) {
      if (TRACKABLE_TYPES.has(node.type.name)) {
        tr.addMark(
          offset,
          offset + node.nodeSize,
          editor.schema.marks.ins.create({ author: track.author, date }),
        )
      } else {
        tr.setNodeMarkup(offset, undefined, {
          ...node.attrs,
          blockRevision: { kind: 'ins', author: track.author, date },
        })
      }
      offset += node.nodeSize
    }
    tr.setMeta(TRACK_IGNORE, true)
  }
  editor.view.dispatch(tr)
  return true
}

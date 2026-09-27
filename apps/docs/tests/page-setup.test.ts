import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { applySectionStartType, sectionFromSectPr, type SectionInfo } from '@genoffice/docx-engine'
import { editorExtensions } from '../src/renderer/editor/extensions'
import {
  applyResolvedPageSetup,
  parseTwips,
  resolvePageSetup,
  type ResolvedPageSetup,
} from '../src/renderer/ops/page-setup'
import { patchPendingSectPr, sectionIndexAtBlock } from '../src/renderer/ops/pending-sections'

const LETTER_SECT_PR =
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/><w:cols w:space="708"/><w:docGrid w:linePitch="360"/></w:sectPr>'

const section = (xml = LETTER_SECT_PR): SectionInfo => sectionFromSectPr(xml, 0, 4)

const editors = new Set<Editor>()
afterEach(() => {
  for (const editor of editors) editor.destroy()
  editors.clear()
})

/** top-level blocks: a string is an original paragraph (docxIndex = its position), `null` an unsaved section-break paragraph */
function createEditor(texts: Array<string | null>, breakSectPr = LETTER_SECT_PR): Editor {
  let docxIndex = 0
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: {
      type: 'doc',
      content: texts.map((t) =>
        t === null
          ? {
              type: 'docProtected',
              attrs: {
                docxIndex: null,
                blockType: 'passthrough',
                label: 'Section break paragraph',
                previewText: '',
                genXml: `<w:p><w:pPr>${breakSectPr}</w:pPr></w:p>`,
              },
            }
          : {
              type: 'docParagraph',
              attrs: { docxIndex: docxIndex++ },
              content: [{ type: 'text', text: t }],
            },
      ),
    },
  })
  editors.add(editor)
  return editor
}

const genXmlAt = (editor: Editor, block: number): string =>
  String(editor.state.doc.child(block).attrs.genXml)

describe('parseTwips', () => {
  it('reads twips, cm, mm, in and pt', () => {
    expect(parseTwips(1440)).toBe(1440)
    expect(parseTwips('1in')).toBe(1440)
    expect(parseTwips('2.54cm')).toBe(1440)
    expect(parseTwips('25.4mm')).toBe(1440)
    expect(parseTwips('72pt')).toBe(1440)
    expect(parseTwips('wide')).toBeUndefined()
  })

  it('rejects astronomic lengths that would break layout', () => {
    expect(parseTwips('999999in')).toBeUndefined()
    expect(parseTwips('100000in')).toBeUndefined()
    expect(parseTwips(1e12)).toBeUndefined()
    expect(parseTwips(NaN)).toBeUndefined()
    expect(parseTwips('8.5in')).toBe(12240)
  })
})

describe('resolvePageSetup', () => {
  it('names a paper and keeps the current orientation', () => {
    const r = resolvePageSetup({ paper: 'a4' }, section())
    expect(r).toMatchObject({
      settings: { pageWidth: 11906, pageHeight: 16838, orientation: 'portrait' },
    })
  })

  it('landscape alone swaps width and height', () => {
    const r = resolvePageSetup({ orientation: 'landscape' }, section())
    expect(r).toMatchObject({
      settings: { pageWidth: 15840, pageHeight: 12240, orientation: 'landscape' },
    })
  })

  it('merges margins in units and clears the fixed-margin flags for the sides given', () => {
    const cur = section()
    cur.settings.marginTopFixed = true
    const r = resolvePageSetup({ margins: { top: '2cm', left: 720 } }, cur)
    expect(r).toMatchObject({
      settings: { marginTop: 1134, marginLeft: 720, marginRight: 1440, marginTopFixed: undefined },
    })
  })

  it('folds a gutter into the binding-side margin the way the engine stores it', () => {
    const r = resolvePageSetup({ margins: { gutter: '1cm', left: '2cm' } }, section())
    if ('error' in r) throw new Error(r.error)
    expect(r.settings.gutter).toBe(567)
    expect(r.settings.marginLeft).toBe(1134 + 567)
    expect(applyResolvedPageSetup(LETTER_SECT_PR, r)).toContain('w:left="1134"')
    expect(applyResolvedPageSetup(LETTER_SECT_PR, r)).toContain('w:gutter="567"')
    const cleared = resolvePageSetup(
      { margins: { gutter: 0 } },
      sectionFromSectPr(applyResolvedPageSetup(LETTER_SECT_PR, r), 0, 4),
    )
    if ('error' in cleared) throw new Error(cleared.error)
    expect(applyResolvedPageSetup(LETTER_SECT_PR, cleared)).toMatch(
      /w:left="1134"[^>]*w:gutter="0"/,
    )
  })

  it('rejects unknown papers, oversized margins, bad columns and an empty patch', () => {
    expect(resolvePageSetup({ paper: 'Folio' }, section())).toHaveProperty('error')
    expect(resolvePageSetup({ margins: { left: '20cm', right: '5cm' } }, section())).toHaveProperty(
      'error',
    )
    expect(resolvePageSetup({ columns: { count: 0 } }, section())).toHaveProperty('error')
    expect(resolvePageSetup({ margins: { inside: 1 } }, section())).toHaveProperty('error')
    expect(resolvePageSetup({}, section())).toHaveProperty('error')
  })

  it('writes columns, titlePg and page numbering into the sectPr', () => {
    const r = resolvePageSetup(
      {
        columns: { count: 2, spacing: '1cm' },
        titlePg: true,
        pageNumberStart: 1,
        pageNumberFormat: 'lowerRoman',
      },
      section(),
    )
    if ('error' in r) throw new Error(r.error)
    const xml = applyResolvedPageSetup(LETTER_SECT_PR, r)
    expect(xml).toContain('<w:cols w:num="2" w:space="567"/>')
    expect(xml).toContain('<w:titlePg/>')
    expect(xml).toContain('<w:pgNumType w:fmt="lowerRoman" w:start="1"/>')
    const again = resolvePageSetup({ pageNumberStart: null }, sectionFromSectPr(xml, 0, 4))
    if ('error' in again) throw new Error(again.error)
    expect(applyResolvedPageSetup(xml, again)).toContain('<w:pgNumType w:fmt="lowerRoman"/>')
  })
})

describe('unsaved section breaks', () => {
  // two breaks inserted this session, both copies of the same sectPr: the first
  // (block 2) closes section 0, the second (block 5) closes section 1
  const pendingSections = (): SectionInfo[] => [
    { ...sectionFromSectPr(LETTER_SECT_PR, 0, 1), pendingBreak: true },
    { ...sectionFromSectPr(LETTER_SECT_PR, 2, 3), pendingBreak: true },
    sectionFromSectPr(LETTER_SECT_PR, 4, 5),
  ]

  it('blocks after an unsaved break belong to the following section', () => {
    const editor = createEditor(['a', 'b', null, 'c', 'd', null, 'e', 'f'])
    const sections = pendingSections()
    const owners = Array.from({ length: 8 }, (_v, i) =>
      sectionIndexAtBlock(editor.state.doc, sections, i),
    )
    expect(owners).toEqual([0, 0, 0, 1, 1, 1, 2, 2])
  })

  it('patches the break paragraph closing the addressed section, even when the copies are identical', () => {
    const editor = createEditor(['a', 'b', null, 'c', 'd', null, 'e', 'f'])
    const sections = pendingSections()
    const continuous = applySectionStartType(LETTER_SECT_PR, 'continuous')
    expect(patchPendingSectPr(editor, sections, 1, continuous)).toBe(true)
    expect(genXmlAt(editor, 2)).not.toContain('<w:type')
    expect(genXmlAt(editor, 5)).toContain('<w:type w:val="continuous"/>')

    sections[1] = { ...sections[1]!, sectPrXml: continuous }
    const landscape = applyResolvedPageSetup(
      continuous,
      resolvePageSetup({ orientation: 'landscape' }, sections[1]!) as ResolvedPageSetup,
    )
    expect(patchPendingSectPr(editor, sections, 1, landscape)).toBe(true)
    expect(genXmlAt(editor, 5)).toContain('w:orient="landscape"')
    expect(genXmlAt(editor, 5)).toContain('<w:type w:val="continuous"/>')
    expect(genXmlAt(editor, 2)).toBe(`<w:p><w:pPr>${LETTER_SECT_PR}</w:pPr></w:p>`)
  })

  it('reports a removed break paragraph and refuses saved sections', () => {
    const editor = createEditor(['a', 'b', null, 'c'])
    const sections = pendingSections().slice(0, 2)
    expect(patchPendingSectPr(editor, sections, 1, LETTER_SECT_PR)).toBe(false)
    editor.commands.deleteRange({ from: 0, to: editor.state.doc.content.size })
    expect(patchPendingSectPr(editor, sections, 0, LETTER_SECT_PR)).toBe(false)
  })
})

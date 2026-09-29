import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { Ribbon } from '../src/renderer/components/Ribbon'

beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
const cleanups: Array<() => void> = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.unstubAllGlobals()
})

function renderRibbon(disabled = false, dirty = false) {
  const editor = new Editor({
    extensions: buildExtensions({
      slashController: { onOpen() {}, onUpdate() {}, onKeyDown: () => false, onClose() {} },
      slashItems: () => [],
    }),
    content: '<p>Saved document</p>',
  })
  const onSave = vi.fn()
  const onSaveAs = vi.fn()
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const props = {
    disabled,
    dirty,
    onSave,
    onSaveAs,
    onFind: vi.fn(),
    autoSave: false,
    onToggleAutoSave: vi.fn(),
    editor,
    imageEnabled: true,
    onInsertImage: vi.fn(),
    frontmatterOpen: false,
    onToggleFrontmatter: vi.fn(),
    outlineOpen: false,
    onToggleOutline: vi.fn(),
    hasOutline: false,
  }
  act(() => root.render(createElement(Ribbon, props)))
  cleanups.push(() => {
    act(() => root.unmount())
    editor.destroy()
    container.remove()
  })
  return { container, onSave, onSaveAs }
}

/** First quick-access button is Save — the row must not carry a Save As entry. */
function saveButton(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>('.ribbon-tabs .qa-btn')
  expect(button, 'Save must be available in the top-left quick-access row').not.toBeNull()
  return button!
}

describe('quick-access row', () => {
  it('shows Save and no Save As button (Save As stays in the native menu)', () => {
    const { container } = renderRibbon()
    expect(container.querySelector('.qa-save-as')).toBeNull()
    expect(saveButton(container)).not.toBeNull()
  })

  it('keeps Save clickable for a dirty document', () => {
    const { container, onSave, onSaveAs } = renderRibbon(false, true)
    const button = saveButton(container)
    expect(button.disabled).toBe(false)
    act(() => button.click())
    expect(onSave).toHaveBeenCalledOnce()
    expect(onSaveAs).not.toHaveBeenCalled()
  })

  it('does not allow Save while the document is unavailable', () => {
    const { container, onSave } = renderRibbon(true, true)
    const button = saveButton(container)
    expect(button.disabled).toBe(true)
    act(() => button.click())
    expect(onSave).not.toHaveBeenCalled()
  })
})

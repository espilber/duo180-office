import { describe, expect, it, vi } from 'vitest'

import { resolvePdfExportPath, type PdfPathTab } from '../src/main/pdf-export-path'

interface Tab extends PdfPathTab {
  id: string
}

/**
 * The shell's PDF export path resolution. A pathless ("untitled") PDF has no file
 * to convert yet, so the export must first run the pdf module's existing flush
 * (which opens the Save As dialog in the renderer) and then re-read the adopted
 * path for that same tab. A dismissed dialog aborts without exporting.
 */

describe('resolvePdfExportPath', () => {
  it('flushes a path-backed tab and reuses its path', async () => {
    const tab: Tab = { id: 'pdf-1', filePath: 'C:/docs/report.pdf' }
    const flushSave = vi.fn(async () => true)

    const result = await resolvePdfExportPath({
      activeTab: () => tab,
      flushSave,
      currentPath: (t) => t.filePath,
    })

    expect(result).toEqual({ ok: true, tab, path: 'C:/docs/report.pdf' })
    expect(flushSave).toHaveBeenCalledTimes(1)
  })

  it('waits for the untitled Save As, then continues with the adopted path', async () => {
    const tab: Tab = { id: 'pdf-1' }
    let path = ''
    const flushSave = vi.fn(async () => {
      // setPdfFileSavedHook records the chosen path on the tab while the flush runs
      path = 'C:/docs/chosen.pdf'
      return true
    })

    const result = await resolvePdfExportPath({
      activeTab: () => tab,
      flushSave,
      currentPath: () => path,
    })

    expect(result).toEqual({ ok: true, tab, path: 'C:/docs/chosen.pdf' })
    expect(flushSave).toHaveBeenCalledTimes(1)
  })

  it('aborts silently when the Save As dialog is dismissed', async () => {
    const tab: Tab = { id: 'pdf-1' }

    const result = await resolvePdfExportPath({
      activeTab: () => tab,
      flushSave: async () => false,
      currentPath: () => undefined,
    })

    expect(result).toEqual({ ok: false, reason: 'not-saved' })
  })

  it('does not export and writes nothing when the dialog is dismissed', async () => {
    const tab: Tab = { id: 'pdf-1' }
    const exported = vi.fn(async () => 'exported')

    const resolved = await resolvePdfExportPath({
      activeTab: () => tab,
      flushSave: async () => false,
      currentPath: () => undefined,
    })
    // exactly the shell's gating: run the converter only once a path resolved
    if (resolved.ok) await exported(resolved.path)

    expect(exported).not.toHaveBeenCalled()
    expect(tab.filePath).toBeUndefined()
  })

  it('flags a successful flush that still left no path, so the menu can warn', async () => {
    const tab: Tab = { id: 'pdf-1' }

    const result = await resolvePdfExportPath({
      activeTab: () => tab,
      flushSave: async () => true,
      currentPath: () => undefined,
    })

    expect(result).toEqual({ ok: false, reason: 'missing-path' })
  })

  it('reports no active pdf tab without flushing', async () => {
    const flushSave = vi.fn(async () => true)

    const result = await resolvePdfExportPath({
      activeTab: () => undefined,
      flushSave,
      currentPath: () => undefined,
    })

    expect(result).toEqual({ ok: false, reason: 'no-tab' })
    expect(flushSave).not.toHaveBeenCalled()
  })
})

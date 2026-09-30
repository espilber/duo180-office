/**
 * Resolve the on-disk path a PDF export (or any disk-backed conversion) must read.
 *
 * A pathless ("untitled") PDF lives only in memory until its first save, so an
 * export has to ask for a destination first. The pdf module already owns that
 * flow: its `flushPdfSave` asks the renderer to run Save — which opens the Save
 * As dialog for an untitled document and also flushes pending edits for a
 * path-backed one — and resolves once the renderer reports the outcome.
 *
 * The adopted path is attached to the *tab* by `setPdfFileSavedHook` while that
 * save runs (`manager.setTabFileFor`), not returned by the flush promise. It must
 * therefore be re-read for the very same tab after the flush; using the tab
 * captured before the flush, or merely whichever tab is active by then, would
 * either read `undefined` (silent abort) or export the wrong document.
 */

/** The slice of a shell pdf tab this resolver needs — keeps the module unit-testable. */
export interface PdfPathTab {
  filePath?: string
}

export type PdfPathResolution<Tab extends PdfPathTab> =
  /** Ready to export: `path` is the file the converter must read. */
  | { ok: true; tab: Tab; path: string }
  /** No pdf tab is focused; there is nothing to export. */
  | { ok: false; reason: 'no-tab' }
  /**
   * The document was not saved: the user dismissed the Save As dialog, or the save
   * failed and the pdf renderer already surfaced the error. Callers abort silently.
   */
  | { ok: false; reason: 'not-saved' }
  /**
   * The flush claimed success yet the same tab still has no path. This should be
   * impossible; callers surface a notice instead of doing nothing.
   */
  | { ok: false; reason: 'missing-path' }

export interface PdfPathDeps<Tab extends PdfPathTab> {
  /** Fresh snapshot of the active pdf tab, or undefined when another module is focused. */
  activeTab: () => Tab | undefined
  /** The pdf module's existing flush: flush pending edits / run the untitled Save As flow. */
  flushSave: (tab: Tab) => Promise<boolean>
  /** Latest path recorded for that same tab; it changes during the flush (Save As adoption, pending-dir move, auto-rename). */
  currentPath: (tab: Tab) => string | undefined
}

export async function resolvePdfExportPath<Tab extends PdfPathTab>(
  deps: PdfPathDeps<Tab>,
): Promise<PdfPathResolution<Tab>> {
  const tab = deps.activeTab()
  if (!tab) return { ok: false, reason: 'no-tab' }
  // Always flush: pending edits must reach disk before the converter reads the file,
  // and an untitled document gets its Save As dialog here. A clean path-backed tab
  // resolves immediately without a dialog.
  if (!(await deps.flushSave(tab))) return { ok: false, reason: 'not-saved' }
  // Re-read the same tab after the flush: the file-saved hook attached the adopted path.
  const path = deps.currentPath(tab)
  if (!path) return { ok: false, reason: 'missing-path' }
  return { ok: true, tab, path }
}

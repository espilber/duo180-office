/**
 * Read-only workbook views over the live sheet state: the active-sheet context
 * block and a bulk cell reader. Shared by the save pipeline (save-actions.ts),
 * the formula-value backfill (formula-values.ts) and the shell's MCP visible-grid
 * bridge (mcp-bridge.ts); the file-side aggregator closes over the same context
 * (range-aggregate-file.ts).
 */
import { columnLabel, parseAddress } from '@genoffice/xlsx-gateway/domain/cell-address'
import { MAX_PATCH_ENTRY_BYTES } from '../shared/desktop-api'
import type { InMemoryWorkbookAdapter } from '@genoffice/xlsx-gateway/domain/in-memory-workbook'
import type { CellScalar } from '@genoffice/xlsx-gateway/domain/workbook.types'
import { lazyCellReader } from './univer-sync'
import { lazySheetScreenExtent, type LazyWorkbookState, type UniverRuntime } from './univer-state'

/** The App refs the readers need; passed per call so they never go stale. */
export interface WorkbookReadContext {
  univerRef: { readonly current: UniverRuntime | null }
  lazyWorkbookRef: { readonly current: LazyWorkbookState | null }
  adapterRef: { readonly current: InMemoryWorkbookAdapter }
}

export interface SheetRef {
  readonly id: string
  readonly name: string
  /** Data extent (from the xlsx dimension or known cells); may drift slightly
   * after structural changes within the session */
  readonly rows?: number
  readonly columns?: number
  /** Worksheet XML above the gateway save-patch cap: readable, never editable. */
  readonly readOnlyOversized?: boolean
}

export interface ChartRef {
  readonly path: string
  readonly title: string
  readonly types: string
  readonly sheetId: string
}

/**
 * A caller's selection scope: `undefined` reports the live grid selection,
 * `null` means no scope is in effect, otherwise the caller's own snapshot.
 */
export interface FrozenSelection {
  /** A1 notation on the sheet it was taken from, clamped to the data extent so
   *  a whole-column click is not reported as a million rows */
  readonly a1: string
  readonly sheetId: string
  /** header names when the selection covers whole columns */
  readonly columns?: readonly string[]
}

export interface ActiveSheetInfo {
  readonly mode: 'demo' | 'lazy' | 'none'
  /** lazy mode only: the file is too large for a full load — cached values
   * stream in per viewport, and the live formula engine never sees the whole
   * data (formula writes over the file's sheets are gated) */
  readonly streaming?: boolean | undefined
  readonly sheetId: string
  readonly sheetName: string
  /** demo mode only: current revision, needed for the CAS-checked plan() call */
  readonly revision?: number
  /** non-empty cell addresses known to the caller without an extra read */
  readonly knownAddresses: readonly string[]
  /** lazy mode only: the viewport-backed range currently present in Univer */
  readonly loadedRange?: string | undefined
  /** every sheet in the workbook, active one included */
  readonly sheets: readonly SheetRef[]
  /** the selection to interpret "this column / these rows" against, in A1
   * notation (sheet-qualified when it is not the active sheet) */
  readonly selection?: string | undefined
  /** the selection above is a snapshot rather than a live read */
  readonly selectionFrozen?: boolean | undefined
  /** header names of the columns the selection covers, when it covers whole
   * ones — what the caller means by "this column" */
  readonly selectionColumns?: readonly string[] | undefined
  /** merged ranges on the active sheet (A1 notation) */
  readonly merges?: readonly string[] | undefined
  /** charts in the workbook (imported files only) */
  readonly charts?: readonly ChartRef[] | undefined
}

/**
 * Context block of the active sheet: sheet list, extents, the selection to
 * interpret "this column / these rows" against. `frozen` is a caller-supplied
 * selection scope: `undefined` when there is none (report the live grid
 * selection), `null` when the caller dropped its scope, otherwise the
 * snapshot it took earlier.
 */
export function getActiveSheetInfo(
  ctx: WorkbookReadContext,
  frozen?: FrozenSelection | null,
): ActiveSheetInfo {
  const workbook = ctx.univerRef.current?.univerAPI.getActiveWorkbook()
  const live = workbook?.getActiveRange()?.getA1Notation() ?? undefined
  // A frozen snapshot taken on another sheet has to carry its sheet name, or
  // the reader takes a bare A1 as an address on whatever sheet is active now.
  const frozenLabel = frozen
    ? frozen.sheetId === workbook?.getActiveSheet()?.getSheetId()
      ? frozen.a1
      : `${workbook?.getSheetBySheetId(frozen.sheetId)?.getSheetName() ?? frozen.sheetId}!${frozen.a1}`
    : undefined
  const selection = frozen === undefined ? live : frozenLabel
  const frozenFields = frozenLabel
    ? {
        selectionFrozen: true,
        ...(frozen?.columns?.length ? { selectionColumns: frozen.columns } : {}),
      }
    : {}
  const state = ctx.lazyWorkbookRef.current
  if (state) {
    const worksheet = workbook?.getActiveSheet()
    if (!workbook || !worksheet)
      return { mode: 'none', sheetId: '', sheetName: '', knownAddresses: [], sheets: [] }
    const sheetId = worksheet.getSheetId()
    const loaded = state.loadedRanges.get(sheetId)
    const loadedRange = loaded
      ? `${columnLabel(loaded.startColumn)}${loaded.startRow + 1}:` +
        `${columnLabel(loaded.endColumn)}${loaded.endRow + 1}`
      : undefined
    return {
      mode: 'lazy',
      streaming: !state.formulaMode,
      sheetId,
      sheetName: worksheet.getSheetName(),
      knownAddresses: [],
      loadedRange,
      sheets: workbook.getSheets().map((sheet) => {
        const extent = lazySheetScreenExtent(state, sheet.getSheetId())
        const meta = state.file.sheets.find((candidate) => candidate.id === sheet.getSheetId())
        const oversized = (meta?.sourceXmlBytes ?? 0) > MAX_PATCH_ENTRY_BYTES
        return {
          id: sheet.getSheetId(),
          name: sheet.getSheetName(),
          ...(extent ? { rows: extent.rows, columns: extent.columns } : {}),
          ...(oversized ? { readOnlyOversized: true } : {}),
        }
      }),
      selection,
      ...frozenFields,
      merges: worksheet.getMergedRanges().map((range) => range.getA1Notation()),
      // Session-added charts have no chart part yet; their visual id
      // doubles as the edit path.
      charts: [...state.file.visuals, ...state.editJournal.visualAdds]
        .filter((visual) => visual.kind === 'chart' && (visual.chartPath || visual.chart))
        .map((visual) => ({
          path: visual.chartPath ?? visual.id,
          title: visual.chart?.title ?? '',
          types: visual.chart?.chartTypes.join('+') ?? '',
          sheetId: visual.sheetId,
        })),
    }
  }
  const snapshot = ctx.adapterRef.current.getSnapshot()
  // The adapter has no active-sheet notion — resolve it from the grid (demo
  // Univer sheets reuse the snapshot ids), falling back to the first sheet.
  const activeId = workbook?.getActiveSheet()?.getSheetId()
  const sheet = snapshot.sheets.find((entry) => entry.id === activeId) ?? snapshot.sheets[0]
  if (!sheet) return { mode: 'none', sheetId: '', sheetName: '', knownAddresses: [], sheets: [] }
  return {
    mode: 'demo',
    sheetId: sheet.id,
    sheetName: sheet.name,
    revision: snapshot.revision,
    knownAddresses: Object.keys(sheet.cells),
    sheets: snapshot.sheets.map((entry) => {
      let maxRow = -1
      let maxColumn = -1
      for (const address of Object.keys(entry.cells)) {
        const cell = parseAddress(address)
        if (cell.row > maxRow) maxRow = cell.row
        if (cell.column > maxColumn) maxColumn = cell.column
      }
      return {
        id: entry.id,
        name: entry.name,
        ...(maxRow >= 0 ? { rows: maxRow + 1, columns: maxColumn + 1 } : {}),
      }
    }),
    selection,
    ...frozenFields,
    merges: sheet.merges ?? [],
    charts: snapshot.sheets.flatMap((entry) =>
      (entry.visuals ?? []).map((visual) => ({
        path: visual.id,
        title: visual.chart.title,
        types: visual.chart.chartTypes.join('+'),
        sheetId: visual.sheetId,
      })),
    ),
  }
}

export function readCells(
  ctx: WorkbookReadContext,
  addresses: readonly string[],
  sheetId?: string,
): Record<string, { value: CellScalar; formula?: string; rawValue?: CellScalar | undefined }> {
  const result: Record<
    string,
    { value: CellScalar; formula?: string; rawValue?: CellScalar | undefined }
  > = {}
  const workbook = ctx.univerRef.current?.univerAPI.getActiveWorkbook()
  const state = ctx.lazyWorkbookRef.current
  if (state) {
    const worksheet =
      sheetId === undefined ? workbook?.getActiveSheet() : workbook?.getSheetBySheetId(sheetId)
    if (!worksheet) return result
    const reader = lazyCellReader(worksheet)
    for (const address of addresses) {
      const cell = reader(address)
      // `value` is the rendered text and `rawValue` the model value behind it;
      // machine-facing callers (the MCP bridge, the save pipeline) need the
      // latter — see modelCellValue in univer-sync.ts.
      result[address] = cell.formula
        ? { value: cell.value, formula: cell.formula, rawValue: cell.rawValue }
        : { value: cell.value, rawValue: cell.rawValue }
    }
    return result
  }
  const sheets = ctx.adapterRef.current.getSnapshot().sheets
  const targetId = sheetId ?? workbook?.getActiveSheet()?.getSheetId()
  const sheet =
    sheets.find((s) => s.id === targetId) ?? (sheetId === undefined ? sheets[0] : undefined)
  if (!sheet) return result
  // The in-memory model stores only value:null for formula cells; computed
  // values live in Univer's formula engine, backfilled by reading the grid
  const worksheet =
    sheetId === undefined ? workbook?.getActiveSheet() : workbook?.getSheetBySheetId(sheetId)
  for (const address of addresses) {
    const cell = sheet.cells[address] ?? { value: null }
    if (cell.formula) {
      let computed = cell.value
      if (computed === null && worksheet) {
        try {
          computed = worksheet.getRange(address).getValue() ?? null
        } catch {
          /* fail-open */
        }
      }
      result[address] = { value: computed, formula: cell.formula }
    } else {
      result[address] = { value: cell.value }
    }
  }
  return result
}

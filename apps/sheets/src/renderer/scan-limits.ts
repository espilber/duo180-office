/**
 * Workbook file-side paging budgets shared by the find/replace scan (Ctrl+F,
 * lazy-find.ts) and the error-checking scan (error-checking.ts): both page the
 * underlying file rather than only the rows Univer has loaded, and both stop at
 * a scanned-cell budget instead of paging an entire huge sheet.
 */

/** Cells fetched per IPC page when walking a sheet's file side. */
export const FILE_READ_BATCH_CELLS = 18_000

/** Cap on cells scanned per sweep (find or error check); past it the scan
 *  reports itself truncated instead of paging the whole file. */
export const MAX_SCAN_CELLS = 400_000

/** Excel error values (#DIV/0!, #REF!, …) as stored in cell text. */
export const ERROR_VALUE_RE =
  /^#(?:NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|GETTING_DATA|SPILL!|CALC!|BLOCKED!|CONNECT!|DATA!|FIELD!|UNKNOWN!|PYTHON!|BUSY!)\s*$/

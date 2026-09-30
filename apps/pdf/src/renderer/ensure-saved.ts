/**
 * "Save first" gate for operations that work on the file on disk (print, export,
 * page operations). A pathless (untitled) document lives only in memory until its
 * first save, so those operations ask for a destination through the existing Save
 * As flow instead of failing on an empty path.
 */

export interface SaveGate {
  /** Path already attached to the document ('' while it is still untitled). */
  currentPath: () => string
  /** Run the existing save flow; resolves true when the document landed on disk. */
  save: () => Promise<boolean>
}

/**
 * Return the path a disk-backed operation must use. A document that already has a
 * path returns it untouched; an untitled one runs the existing Save As flow (which
 * opens the dialog and adopts the chosen path) and returns that path. Null means
 * the save was dismissed or failed — any error was already reported by the save
 * flow, and the caller aborts the operation silently.
 */
export async function ensureSavedPath(gate: SaveGate): Promise<string | null> {
  const existing = gate.currentPath()
  if (existing) return existing
  const ok = await gate.save()
  const adopted = gate.currentPath()
  return ok && adopted ? adopted : null
}

/**
 * Run `op` only once a path is guaranteed. Returns undefined without calling `op`
 * when the user dismissed the Save As dialog, so nothing is written or executed.
 */
export async function runWithSavedFile<T>(
  gate: SaveGate,
  op: (path: string) => Promise<T>,
): Promise<T | undefined> {
  const path = await ensureSavedPath(gate)
  if (!path) return undefined
  return op(path)
}

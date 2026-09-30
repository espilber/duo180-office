import { describe, expect, it, vi } from 'vitest'
import { ensureSavedPath, runWithSavedFile } from '../src/renderer/ensure-saved'
import type { SaveGate } from '../src/renderer/ensure-saved'

/**
 * "Save first" gate for disk-backed operations (print, export, page ops) on a
 * pathless (untitled) document: the operation must ask for a destination through
 * the existing Save As flow and continue with the adopted path, or abort silently
 * when that dialog is dismissed. Nothing may be written before the path exists.
 */

/** A save gate whose save() adopts a destination and reports the dialog outcome */
function makeGate(initialPath: string, outcome: string | null) {
  let path = initialPath
  const save = vi.fn(async () => {
    if (outcome === null) return false
    path = outcome
    return true
  })
  const gate: SaveGate = { currentPath: () => path, save }
  return { gate, save, currentPath: () => path }
}

describe('ensureSavedPath', () => {
  it('returns the existing path without saving a path-backed document', async () => {
    const { gate, save } = makeGate('C:\\docs\\report.pdf', null)
    await expect(ensureSavedPath(gate)).resolves.toBe('C:\\docs\\report.pdf')
    expect(save).not.toHaveBeenCalled()
  })

  it('asks for a destination and returns the adopted path for an untitled document', async () => {
    const { gate, save } = makeGate('', 'C:\\docs\\chosen.pdf')
    await expect(ensureSavedPath(gate)).resolves.toBe('C:\\docs\\chosen.pdf')
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('returns null when the Save As dialog is dismissed', async () => {
    const { gate, save } = makeGate('', null)
    await expect(ensureSavedPath(gate)).resolves.toBeNull()
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('returns null when a reported save did not adopt a path', async () => {
    const gate: SaveGate = { currentPath: () => '', save: async () => true }
    await expect(ensureSavedPath(gate)).resolves.toBeNull()
  })
})

describe('runWithSavedFile', () => {
  it('runs the operation with the path chosen for an untitled document', async () => {
    const { gate, save } = makeGate('', 'C:\\docs\\chosen.pdf')
    const written: string[] = []
    const result = await runWithSavedFile(gate, async (path) => {
      written.push(path)
      return path.length
    })
    expect(result).toBe('C:\\docs\\chosen.pdf'.length)
    expect(written).toEqual(['C:\\docs\\chosen.pdf'])
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('does not run the operation and writes nothing when the dialog is dismissed', async () => {
    const { gate, save } = makeGate('', null)
    const op = vi.fn(async () => 'ran')
    const result = await runWithSavedFile(gate, op)
    expect(result).toBeUndefined()
    expect(op).not.toHaveBeenCalled()
    // The user cancelled, so the document was never named and nothing was written
    expect(gate.currentPath()).toBe('')
    expect(save).toHaveBeenCalledTimes(1)
  })
})

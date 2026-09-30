/**
 * Regression: the AutoSave tick ('save') and the crash-recovery copy tick
 * ('recovery') each carried their own in-flight flag, so with AutoSave on a
 * dirty workbook started both saves concurrently every 30 s. In the main
 * process the first finisher tears the workbook session down while the second
 * is still reading; the survivor reported "Unknown workbook session."
 * (save failed) although the file had been written. Both ticks now share one
 * gate (save-scheduler.ts / saveInFlightRef), so a second tick skips instead
 * of racing, and retries on its next 30 s wake-up.
 */
import { describe, expect, it } from 'vitest'
import { shouldRunSaveTick } from '../src/renderer/save-scheduler'

function dirtyWorkbookState(overrides: Partial<Parameters<typeof shouldRunSaveTick>[0]> = {}) {
  return {
    saveInFlight: false,
    hasWorkbook: true,
    journalEmpty: false,
    editingCell: false,
    needsSaveAs: false,
    isCsv: false,
    kind: 'recovery' as const,
    restoredFromRecovery: false,
    automaticRecoveryDisabled: false,
    ...overrides,
  }
}

describe('shouldRunSaveTick', () => {
  it('lets a clean dirty-workbook tick of either kind run', () => {
    expect(shouldRunSaveTick(dirtyWorkbookState({ kind: 'save' }))).toBe(true)
    expect(shouldRunSaveTick(dirtyWorkbookState({ kind: 'recovery' }))).toBe(true)
  })

  it('the regression: while either save is in flight, the OTHER tick skips instead of racing', () => {
    // AutoSave started first — the recovery tick 30 s later must skip
    expect(shouldRunSaveTick(dirtyWorkbookState({ kind: 'recovery', saveInFlight: true }))).toBe(
      false,
    )
    // recovery copy started first (AutoSave off, on mid-session, or blur
    // firing the AutoSave tick early) — the AutoSave tick must skip
    expect(shouldRunSaveTick(dirtyWorkbookState({ kind: 'save', saveInFlight: true }))).toBe(false)
  })

  it('a skipped tick retries after the in-flight save finishes', () => {
    const inFlight = dirtyWorkbookState({ kind: 'save', saveInFlight: true })
    expect(shouldRunSaveTick(inFlight)).toBe(false)
    // the AutoSave .finally() clears the shared gate
    expect(shouldRunSaveTick({ ...inFlight, saveInFlight: false })).toBe(true)
  })

  it('an AutoSave real save makes the recovery tick no-op via the empty journal', () => {
    // after AutoSave flushed, the journal is clean: recovery has nothing to copy
    expect(shouldRunSaveTick(dirtyWorkbookState({ kind: 'recovery', journalEmpty: true }))).toBe(
      false,
    )
  })

  it('the 30 s crash-recovery guarantee holds with AutoSave off', () => {
    // AutoSave off: nothing else ever sets saveInFlight, so every dirty tick runs
    for (let i = 0; i < 3; i++) {
      expect(shouldRunSaveTick(dirtyWorkbookState({ kind: 'recovery' }))).toBe(true)
    }
  })

  it('keeps the pre-existing per-kind guards', () => {
    expect(shouldRunSaveTick(dirtyWorkbookState({ hasWorkbook: false }))).toBe(false)
    expect(shouldRunSaveTick(dirtyWorkbookState({ journalEmpty: true }))).toBe(false)
    expect(shouldRunSaveTick(dirtyWorkbookState({ editingCell: true }))).toBe(false)
    expect(shouldRunSaveTick(dirtyWorkbookState({ needsSaveAs: true }))).toBe(false)
    expect(shouldRunSaveTick(dirtyWorkbookState({ isCsv: true }))).toBe(false)
    // recovery-only guards do not block the real save kind
    expect(shouldRunSaveTick(dirtyWorkbookState({ restoredFromRecovery: true }))).toBe(false)
    expect(shouldRunSaveTick(dirtyWorkbookState({ automaticRecoveryDisabled: true }))).toBe(false)
    expect(
      shouldRunSaveTick(dirtyWorkbookState({ kind: 'save', restoredFromRecovery: true })),
    ).toBe(true)
  })
})

describe('two ticks through the shared gate run one at a time', () => {
  it('never overlaps the AutoSave and recovery saves, and loses neither', async () => {
    // Reproduces App.tsx's saveInFlightRef + both 30 s ticks: the gate is the
    // only thing two ticks share, and each tick retries on its next wake-up.
    const saveInFlight = { current: false }
    const events: string[] = []
    let running = 0
    let maxConcurrent = 0

    const runSave = async (kind: 'save' | 'recovery') => {
      running += 1
      maxConcurrent = Math.max(maxConcurrent, running)
      events.push(`start:${kind}`)
      // First save is slower than the second would have been, so an ungated
      // second save would definitely overlap it.
      await new Promise((resolve) => setTimeout(resolve, kind === 'save' ? 20 : 1))
      events.push(`end:${kind}`)
      running -= 1
    }

    const tick = (kind: 'save' | 'recovery') => {
      if (!shouldRunSaveTick(dirtyWorkbookState({ kind, saveInFlight: saveInFlight.current })))
        return Promise.resolve()
      saveInFlight.current = true
      return runSave(kind).finally(() => {
        saveInFlight.current = false
      })
    }

    // Both timers fire at the same instant on a dirty workbook.
    const autoSave = tick('save')
    const recovery = tick('recovery')
    await Promise.all([autoSave, recovery])

    // The recovery tick skipped while AutoSave was in flight instead of racing.
    expect(events).toEqual(['start:save', 'end:save'])
    expect(maxConcurrent).toBe(1)
    expect(saveInFlight.current).toBe(false)

    // Its next wake-up runs the recovery copy: the skipped tick is not lost.
    await tick('recovery')
    expect(events).toEqual(['start:save', 'end:save', 'start:recovery', 'end:recovery'])
    expect(maxConcurrent).toBe(1)
  })
})

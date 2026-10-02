import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(__dirname, '../src/main/index.ts'), 'utf8')

function section(text: string, start: string, end: string): string {
  return text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start)))
}

const duplicateFile = section(source, 'HOME_CHANNELS.duplicateFile', 'HOME_CHANNELS.deleteFiles')

describe('Home duplicate is atomic', () => {
  it('publishes a duplicate through a temporary file', () => {
    expect(duplicateFile).toContain('await atomicCopyFile(path, target)')
    expect(duplicateFile).not.toMatch(/copyFileSync\(path, target\)/)
    expect(duplicateFile).not.toMatch(/writeFileSync\(target/)
  })
})

describe('Home duplicate error handling', () => {
  it('localizes a failed duplicate instead of letting the raw error escape', () => {
    expect(duplicateFile).toContain('showErrorDialog(shellWindow, tm(')
    expect(duplicateFile).toMatch(/catch \(err\) \{[\s\S]*?return/)
  })

  it('does not record a recent for a duplicate that was never written', () => {
    const write = duplicateFile.indexOf('await atomicCopyFile(path, target)')
    const catchBlock = duplicateFile.indexOf('catch (err)')
    const record = duplicateFile.indexOf('recordRecentFile(target)')
    expect(catchBlock).toBeGreaterThan(write)
    expect(record).toBeGreaterThan(catchBlock)
  })

  it('still returns void to the renderer', () => {
    expect(duplicateFile).toMatch(/duplicateFile, async \(_event, path: unknown\)/)
  })
})

import { describe, expect, it } from 'vitest'

import {
  isElectronProcess,
  namesElectronProcess,
  processProbeCommand,
} from '../src/main/dev-instance'

/**
 * Regression: the dev-only stale-instance takeover used the Unix `ps` command
 * unconditionally. On Windows execSync threw, the takeover swallowed the error,
 * gave up on the lock and quit with code 0 before any window appeared — so
 * `npm run dev` "closed immediately" whenever an orphaned instance held the
 * `GenOffice Dev` singleton lock.
 */

describe('processProbeCommand', () => {
  it('uses tasklist on Windows instead of ps', () => {
    const command = processProbeCommand(4321, 'win32')
    expect(command).toContain('tasklist')
    expect(command).toContain('PID eq 4321')
    expect(command).not.toContain('ps -o')
  })

  it('uses ps on Unix', () => {
    expect(processProbeCommand(4321, 'linux')).toBe('ps -o command= -p 4321')
    expect(processProbeCommand(4321, 'darwin')).toBe('ps -o command= -p 4321')
  })
})

describe('namesElectronProcess', () => {
  it('recognizes tasklist CSV and ps output for Electron', () => {
    expect(namesElectronProcess('"electron.exe","19152","Console","1","168.444 KB"')).toBe(true)
    expect(namesElectronProcess('  /path/to/Electron --type=renderer\n')).toBe(true)
  })

  it('rejects unrelated or empty output so a recycled PID is never killed', () => {
    expect(namesElectronProcess('"node.exe","19152","Console","1","1 KB"')).toBe(false)
    expect(namesElectronProcess('')).toBe(false)
  })
})

describe('isElectronProcess', () => {
  it('is false for a PID that does not exist', () => {
    // Node's own test worker is not Electron, and an absurd PID cannot exist
    expect(isElectronProcess(process.pid)).toBe(false)
    expect(isElectronProcess(2_147_483_646)).toBe(false)
  })
})

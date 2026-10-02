import { execSync } from 'node:child_process'

/**
 * Dev-only stale-instance takeover support (see the single-instance lock in
 * index.ts): an orphaned `npm run dev` keeps the `GenOffice Dev` singleton lock,
 * so the next start must take it over instead of quitting with code 0 before any
 * window appears.
 *
 * The probe has to be cross-platform: the Unix `ps` command does not exist in
 * cmd.exe, so on Windows execSync threw "not recognized", the takeover's catch
 * swallowed it, the retry loop gave up and the app quit cleanly — the exact
 * "starts and closes immediately, no window" symptom. `tasklist` ships with
 * every supported Windows install.
 */
export function processProbeCommand(
  pid: number,
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === 'win32'
    ? `tasklist /FI "PID eq ${pid}" /FO CSV /NH`
    : `ps -o command= -p ${pid}`
}

/** does the probe output name an Electron process? (the pid-recycling guard) */
export function namesElectronProcess(output: string): boolean {
  return /electron/i.test(output)
}

/**
 * True only when the PID currently belongs to an Electron process, so a
 * recycled PID is never killed. A missing process or an unavailable probe
 * reports false — the caller then falls back to quitting.
 */
export function isElectronProcess(pid: number): boolean {
  try {
    const output = execSync(processProbeCommand(pid), {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString()
    return namesElectronProcess(output)
  } catch {
    return false
  }
}

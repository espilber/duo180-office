import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * PRIVACY.md and the shell main process must not drift apart.
 *
 * duo180 carries no usage analytics: the source emits no events and the
 * document discloses none. This test enforces the strict two-way parity —
 * any event the document names must be emitted by the shell, and any event
 * the shell emits must be named in the document. With analytics removed both
 * sets are empty; reintroducing one side alone fails the test.
 */
describe('PRIVACY.md analytics disclosure', () => {
  it('keeps documented and emitted events in strict correspondence', () => {
    const source = readFileSync(join(__dirname, '../src/main/index.ts'), 'utf8')
    const privacy = readFileSync(join(__dirname, '../../../PRIVACY.md'), 'utf8')
    const emitted = new Set(
      [...source.matchAll(/\banalytics\.track\(\s*['"]([a-z][a-z0-9_]*)['"]/g)].map(
        (match) => match[1],
      ),
    )
    const documented = new Set(
      [...privacy.matchAll(/^- `([a-z][a-z0-9_]*)` —/gm)].map((match) => match[1]),
    )

    expect([...emitted].sort()).toEqual([...documented].sort())
  })
})

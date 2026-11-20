/**
 * The superseded door default is gone (#63 criterion 2).
 *
 * #22 shipped a door default while the research was still open. #63 replaces it with the
 * 900 × 2100 bedroom door, and the old pair must not survive anywhere as a default — not in
 * a constant, not in a fixture, not in a test that quietly keeps placing the old door. A
 * stale default is invisible in review precisely because it is only two numbers, so this is
 * a grep over every source file rather than a note to be careful.
 *
 * Comments are exempt: prose is allowed to discuss the numbers it is banning, which is what
 * the research doc and a few test narratives do. Code and string literals are not.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..')

/** The width and height #22 carried, which nothing may use as a door default now. */
const SUPERSEDED = /\b(914|2134)\b/

/** Every TypeScript source under `src`, this file excepted: it has to name what it bans. */
function sources(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.ts') || name.endsWith('.tsx'))
    // A screenshot folder is named `…browser.test.ts` and is a directory, not a file.
    .filter((name) => statSync(join(SRC, name)).isFile())
    .filter((name) => !name.endsWith('supersededDoor.test.ts'))
    .map((name) => join(SRC, name))
}

/** The code of one line: a line whose first markup is a comment carries no default. */
function code(line: string): string {
  const text = line.trim()
  return text.startsWith('//') || text.startsWith('/*') || text.startsWith('*') ? '' : line
}

describe('the superseded door default', () => {
  it('reads the sources it means to read', () => {
    // A wrong path would make the assertion below vacuously true.
    expect(sources().length).toBeGreaterThan(100)
  })

  it('appears in no code or string anywhere in src', () => {
    const hits: string[] = []
    for (const file of sources()) {
      const lines = readFileSync(file, 'utf8').split('\n')
      for (const [index, line] of lines.entries()) {
        if (SUPERSEDED.test(code(line))) hits.push(`${file}:${index + 1} ${line.trim()}`)
      }
    }
    expect(hits).toEqual([])
  })
})

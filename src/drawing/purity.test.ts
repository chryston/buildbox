/**
 * The two pure modules stay pure (#60 criterion 1).
 *
 * `drawing` and `derive` are pure because everything downstream depends on it: a display list
 * that could read the DOM could not be built during a render, could not be diffed against the
 * last one, and could not be serialised to a byte-identical export. The ban is easy to state
 * and easy to break by accident — one `new Date()` for a timestamp, one `window.devicePixelRatio`
 * for a hairline — and the failure is invisible until a golden file differs on another
 * machine. So the ban is a test rather than a comment, and it reads the sources rather than
 * trusting anyone to have kept the rule.
 *
 * ESLint's `boundaries` rules already stop these modules importing `ui` or React; this covers
 * the globals a module can reach without importing anything at all.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** The modules this asserts on, by directory name under `src`. */
const PURE_MODULES = ['drawing', 'derive'] as const

/**
 * What may not appear, and why it is banned here rather than somewhere else.
 *
 * Each is a value that differs between two runs of the same code — which is the whole
 * definition of impure for a module whose output is compared byte for byte.
 *
 * The three browser globals are matched as a *member access* rather than as a word, because
 * `window` is a word this codebase owns: an Opening of kind `window` (#65) is domain
 * vocabulary, and it appears in the drawing of one. `window.devicePixelRatio` and
 * `window['innerWidth']` are what a pure module actually breaks itself with, and both still
 * match.
 */
const BANNED: readonly (readonly [RegExp, string])[] = [
  [/\b(?:window|document|navigator)\s*[.?[[]/, 'a browser global'],
  [/\blocalStorage\b/, 'localStorage'],
  [/\bindexedDB\b/, 'indexedDB'],
  [/OffscreenCanvas/, 'OffscreenCanvas'],
  [/new Date\(/, 'the clock'],
  [/crypto\.randomUUID/, 'a random identifier'],
]

/** Every non-test source file of one module. */
function sourcesOf(root: string): string[] {
  const dir = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', root)
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => join(dir, name))
}

describe('purity', () => {
  it('finds the sources it means to read', () => {
    // A typo in a directory name would make every assertion below vacuously true.
    for (const root of PURE_MODULES) expect(sourcesOf(root).length).toBeGreaterThan(0)
  })

  for (const root of PURE_MODULES) {
    describe(root, () => {
      it('reads no browser global, clock or random identifier', () => {
        for (const file of sourcesOf(root)) {
          const text = readFileSync(file, 'utf8')
          for (const [pattern, why] of BANNED) {
            expect(pattern.test(text), `${file} reaches ${why}`).toBe(false)
          }
        }
      })
    })
  }
})

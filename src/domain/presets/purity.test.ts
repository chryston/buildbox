/**
 * The preset pack stays pure (#63 criterion 8).
 *
 * `domain/presets` is data and a lookup, and it has to stay that way: the pack is read while
 * a tool is being configured, sometimes while a sheet is being written, and any time it could
 * reach `derive`, `drawing` or the DOM it would stop being a table someone can check against
 * a research doc. ESLint's `boundaries` rules already enforce the same shape for the whole
 * `domain` module; this reads the module's own sources so the narrower claim — nothing but
 * `domain` and `lib`, no package at all — is checked where it is made, and so a new file in
 * this folder is covered without anyone remembering to list it.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const DIR = resolve(fileURLToPath(new URL('.', import.meta.url)))
const SRC = resolve(DIR, '..', '..')

/** Every module specifier of a file, whether it imports or re-exports, with or without a `from`. */
const SPECIFIER = /\b(?:import|export)\b[\s\S]*?\bfrom\s+['"]([^'"]+)['"]|\bimport\s+['"]([^'"]+)['"]/g

/** The module's own non-test sources. */
function sources(): string[] {
  return readdirSync(DIR, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => join(DIR, name))
}

function specifiersOf(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  return [...text.matchAll(SPECIFIER)].map((match) => match[1] ?? match[2])
}

describe('the preset pack’s imports', () => {
  it('reads the sources it means to read', () => {
    const names = sources().map((file) => relative(DIR, file))
    for (const known of ['types.ts', 'frozen.ts', 'hdbBtoTypical.ts', 'index.ts']) {
      expect(names, `the module has ${known}`).toContain(known)
    }
  })

  it('reaches nothing outside domain and lib', () => {
    const allowed = [join(SRC, 'domain'), join(SRC, 'lib')]
    for (const file of sources()) {
      for (const specifier of specifiersOf(file)) {
        const target = resolve(dirname(file), specifier)
        const inside = allowed.some((root) => target.startsWith(`${root}${join('/')}`))
        expect(inside, `${relative(SRC, file)} imports ${specifier}`).toBe(true)
      }
    }
  })

  it('imports no package at all', () => {
    // Nothing bare, so nothing that could reach a DOM through a dependency: the pack is a
    // table and a lookup, and it stays that way without anyone having to remember.
    for (const file of sources()) {
      for (const specifier of specifiersOf(file)) {
        expect(specifier.startsWith('.'), `${relative(SRC, file)} imports ${specifier}`).toBe(true)
      }
    }
  })
})

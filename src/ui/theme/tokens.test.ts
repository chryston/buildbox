/**
 * The two rules the design token transcription is built on (#50 criteria 1 and 4).
 *
 * Both are file scans rather than assertions about behaviour, because both are about what is
 * *absent*: a colour written somewhere other than `tokens.css`, or a class name carried over
 * from the rejected prototype variants. Neither is something a component test can notice, and
 * both are the kind of thing that happens to the next file somebody adds.
 *
 * `src/ui/legacy` is excluded throughout. It is S0 code, claimed out of `ui` by name in
 * `eslint.config.js`, styled with the legacy Tailwind classes, and scheduled for deletion by
 * #53 — holding it to the new token rules would only teach a future reader that the rule has
 * exceptions.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TOKEN, TOKEN_ROLES } from './tokens'

/**
 * `src/ui`, the folder every scan below walks.
 *
 * From the working directory rather than `import.meta.url`, because this suite runs under
 * jsdom, where the module URL is an `http:` one and `fileURLToPath` refuses it. Vitest always
 * runs from the project root, and a missing `src/ui` fails the walk loudly.
 */
const UI_ROOT = resolve(process.cwd(), 'src/ui')

const LEGACY_PREFIX = `${UI_ROOT}${sep}legacy${sep}`

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (full.startsWith(LEGACY_PREFIX)) return []
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

const files = (extension: string): string[] => walk(UI_ROOT).filter((file) => file.endsWith(extension))

/** Every `--bb-*` custom property `tokens.css` declares, in the order it declares them. */
function declaredProperties(): string[] {
  const css = readFileSync(join(UI_ROOT, 'theme', 'tokens.css'), 'utf8')
  return [...css.matchAll(/^\s*(--bb-[a-z0-9-]+)\s*:/gm)].map((match) => match[1])
}

describe('the design tokens', () => {
  it('names every custom property tokens.css declares, in the same order', () => {
    // Order matters: it is what makes a diff of the two files readable, and a token added to
    // one list and not the other shows up as a mismatch rather than a silent gap.
    expect(TOKEN_ROLES.map((role) => TOKEN[role])).toEqual(declaredProperties())
  })

  it('declares no duplicate custom property', () => {
    const declared = declaredProperties()
    expect(declared.filter((name, index) => declared.indexOf(name) !== index)).toEqual([])
  })
})

describe('raw colour (#50 criterion 1)', () => {
  it('is written nowhere under src/ui except tokens.css', () => {
    const offenders = files('.css')
      .filter((file) => !file.endsWith('theme/tokens.css'))
      .flatMap((file) =>
        readFileSync(file, 'utf8')
          .split('\n')
          .map((line, index) => ({ line: index + 1, text: line }))
          .filter(({ text }) => /#[0-9a-fA-F]{3,8}\b/.test(text))
          .map(({ line, text }) => `${file}:${line}: ${text.trim()}`),
      )
    expect(offenders).toEqual([])
  })

  it('appears in no component source under src/ui either', () => {
    const offenders = files('.tsx')
      .flatMap((file) =>
        readFileSync(file, 'utf8')
          .split('\n')
          .map((line, index) => ({ line: index + 1, text: line }))
          .filter(({ text }) => /['"`]#[0-9a-fA-F]{3,8}['"`]/.test(text))
          .map(({ line, text }) => `${file}:${line}: ${text.trim()}`),
      )
    expect(offenders).toEqual([])
  })
})

describe('the rejected prototype variants (#50 criterion 4)', () => {
  // #28 rejected Variants B and C, and the workspace chrome they were drawn with. None of it
  // crosses into the Library, not even as a class name left behind by a copy-paste.
  const REJECTED = ['metrics', 'attention-panel', 'dashboard-shell', 'selected-project-panel', 'launch-list', 'variant-']

  it('names nothing under src/ui', () => {
    const offenders = [...files('.css'), ...files('.tsx'), ...files('.ts')]
      .filter((file) => !file.endsWith('.test.ts') && !file.endsWith('.test.tsx'))
      .flatMap((file) =>
        readFileSync(file, 'utf8')
          .split('\n')
          .map((line, index) => ({ line: index + 1, text: line }))
          .filter(({ text }) => REJECTED.some((word) => text.includes(word)))
          .map(({ line }) => `${file}:${line}`),
      )
    expect(offenders).toEqual([])
  })
})

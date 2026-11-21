/**
 * What BuildBox ships saying (#66 §17, criterion 8).
 *
 * #63 put the banned-word list in `lib` and pointed it at the preset pack. This is the same list
 * aimed at everything else the product authors: the copy table the interface speaks from, the
 * words that end up inside an exported file, the preset pack, and — as a backstop — the source of
 * every component, so that a sentence which never reached `ui/strings` fails here instead of
 * reaching a person.
 *
 * The backstop is textual and deliberately dumb. A component that renders a literal still
 * type-checks, still snapshots, and still shows a user a sentence nobody reviewed for words
 * BuildBox has no authority to say, so the only check that holds is one that reads the source
 * rather than the render tree. It reads the shipped modules only: a Project the user typed into
 * the app is never scanned, because criterion 8 is about what BuildBox says, not what a person
 * named their layers.
 *
 * It lives in `app` because it is the one place every module is reachable: `ui` may not import
 * `lib` (#20 §2), and a scan that cannot read the list is a scan of a copied list.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { getPresetPack } from '../domain'
import { BANNED_WORDS, bannedWordsIn, mentionsWord } from '../lib'
import { EXPORT_WORDS, TABLES } from '../export'
import { STRINGS, WARNING_COPY } from '../ui'

const srcRoot = fileURLToPath(new URL('../../src', import.meta.url))

/** The tables the words are held in, scanned as values below rather than as source. */
const TABLES_SHIPPED = ['ui/strings/index.ts', 'export/strings.ts', 'export/csv/tables.ts']

/**
 * The source the backstop reads.
 *
 * Both directories are in it: `export` because it was already clean, `ui` because a backstop that
 * skips the largest directory is a backstop nobody trusts. What it does not skip is what matters —
 * it reads every shipped module, so a sentence written into a component fails here the same way a
 * sentence written into the copy table does.
 */
const BACKSTOP_DIRS = ['export', 'ui']

/** A test that names a banned word is not a shipped string; neither is a benchmark. */
const NOT_SHIPPED = /\.test\.|\.bench\.|\.property\.|\.browser\./

// ------------------------------------------------------------------------ scanning values
/** Every string a value carries, with where it sits, so a failure names its row. */
function stringsOf(value: unknown, path: string): Array<[string, string]> {
  if (typeof value === 'string') return [[path, value]]
  if (Array.isArray(value)) return value.flatMap((child, index) => stringsOf(child, `${path}[${index}]`))
  if (typeof value === 'function') return literalsOf(String(value), path)
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => stringsOf(child, `${path}.${key}`))
  }
  return []
}

/**
 * A shipped sentence is never an all-lowercase identifier.
 *
 * `flow` is a banned word and also the first half of every `flow-*` class name, and `code` is a
 * banned word and the tail of a hundred CSS custom properties. Matching those would mean renaming
 * the stylesheet to please a spell-checker, so the scan reads what a person could read: a literal
 * with a space in it, a capital in it, or punctuation that prose uses.
 */
const identifier = (text: string): boolean =>
  text.startsWith('--') || /^[a-z][a-z0-9_-]*$/.test(text) || /^[A-Z][A-Z0-9_]*$/.test(text)

/**
 * The words a copy function can put on screen.
 *
 * A function's own text is the only place its literals live, and the interpolated parts are
 * numbers and names the caller owns — so the template is cut at each `${…}` and what is left is
 * the prose.
 */
function literalsOf(source: string, path: string): Array<[string, string]> {
  return [...source.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)]
    .map((match) => (match[1] ?? match[2] ?? match[3] ?? '').replace(/\$\{[^}]*\}/g, ''))
    .filter((text) => /[A-Za-z]{3}/.test(text) && !identifier(text))
    .map((text) => [path, text] as [string, string])
}

/** The three tables the product authors, as one list of (where, what it says). */
const shipped: Array<[string, string]> = [
  ...stringsOf(STRINGS, 'ui/strings'),
  ...stringsOf(WARNING_COPY, 'ui/strings/warning'),
  ...stringsOf(EXPORT_WORDS, 'export/strings'),
  ...stringsOf(getPresetPack('hdb-bto-typical'), 'domain/presets'),
]

/** Which banned words a list of (where, text) says, each named by where it sits. */
function offendersOf(strings: ReadonlyArray<readonly [string, string]>): string[] {
  return strings
    .flatMap(([path, text]) => bannedWordsIn(text).map((word) => `${path} says "${word}": ${text}`))
    .sort()
}

// ------------------------------------------------------------------------ scanning source
/** Every shipped source file under `dir`, as paths from `src`. */
function sourcesOf(dir: string): string[] {
  return readdirSync(`${srcRoot}/${dir}`, { recursive: true })
    .map(String)
    .filter((entry) => /\.tsx?$/.test(entry) && !NOT_SHIPPED.test(entry))
    .filter((entry) => !TABLES_SHIPPED.includes(`${dir}/${entry}`))
    .map((entry) => `${dir}/${entry}`)
}

/** The source with its comments gone, so a note to the next reader is not a promise to a user. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/**
 * A class list is a stylesheet's name for a box, not a sentence.
 *
 * It is the one attribute whose value is never copy even when it reads like prose —
 * `className="flow-page migration-review"` names two boxes, and `flow` is on the banned list as a
 * topic, not as a piece of CSS.
 */
const withoutClassNames = (source: string): string =>
  source.replace(/\b(?:class|className)=(?:"[^"]*"|'[^']*'|\{[^}]*\})/g, ' ')

/** What one file says out loud: its string literals and the text between its tags. */
const saidByText = (source: string): string[] => {
  const stripped = withoutClassNames(withoutComments(source))
  const literals = literalsOf(stripped, '').map(([, text]) => text)
  const jsxText = [...stripped.matchAll(/>([^<>{}]+)</g)]
    .map((match) => match[1]!.trim())
    .filter((text) => text.length > 1 && /[A-Za-z]{3}/.test(text))
  return [...literals, ...jsxText]
}

const saidBy = (path: string): string[] => saidByText(readFileSync(`${srcRoot}/${path}`, 'utf8'))

const backstop = (): string[] =>
  BACKSTOP_DIRS.flatMap(sourcesOf).flatMap((path) =>
    saidBy(path).filter((text) => bannedWordsIn(text).length > 0).map((text) => `${path}: ${text}`),
  )

// ------------------------------------------------------------------- who owns a sentence
/**
 * A Capitalised multi-letter literal is a sentence until proved otherwise (#66 criterion 16).
 *
 * The banned-word backstop asks whether a shipped sentence says something forbidden. This asks an
 * earlier question: whether the sentence lives in `ui/strings` at all. A component that renders
 * `Zoom out` type-checks, snapshots, and passes the word list — and it is invisible to every one
 * of those checks, because there is nothing wrong with the words. The only thing that catches it
 * is a rule about where words are allowed to be written.
 *
 * Capital-then-lowercase is the whole discriminator, and it is enough because of what else a
 * literal can be: `zoom-out` is a CSS name, `ZOOM_MAX` is a constant, `zoomOut` is a function,
 * `'door'` is a union member. What is left — `Zoom out`, `Fit to screen`, `Not placed in this
 * Project.` — is what a person reads.
 */
const COPY_SHAPED = /^[A-Z][a-z]/

/**
 * Values that read like copy and never are.
 *
 * Key names a keyboard handler compares `event.key` against, and two type parameters that appear
 * between the angle brackets a JSX-text scan reads. Neither is a word the interface says; both
 * would otherwise sit in the exemption list forever, which is the thing a list is for least.
 *
 * `Metadata` is a PDF dictionary key, spelled by ISO 32000-1 §14.3.2 and not by BuildBox — the
 * same kind of thing as a key name: a word a specification owns, that a reader of the file looks
 * up rather than reads.
 */
const NEVER_COPY: Record<string, true> = {
  Enter: true, Escape: true, Backspace: true, Tab: true, Delete: true, Shift: true, Control: true,
  Alt: true, Meta: true, Space: true, ArrowUp: true, ArrowDown: true, ArrowLeft: true,
  ArrowRight: true, Promise: true, PayloadOf: true, Metadata: true,
}

/** Code punctuation: prose does not use it, and a generic or an expression does. */
const NOT_PROSE = /[();{}[\]=]|Math\./

/** A module of fixtures is not a shipped module, whatever directory it sits in. */
const NOT_A_MODULE = /\.test\.|\.bench\.|\.property\.|\.browser\.|(^|\/)testing\.tsx?$/

/**
 * The source with the things that are not copy taken out of it, whatever they are written as.
 *
 * A class list names a box. The argument of `new Error(…)`, of `console.warn(…)`, and the provider
 * name handed to `useRequired(…)` are messages to a developer reading a console or a stack, not a
 * sentence a person is shown, and they are where the invariant notes live — `BuildBox refused "…"`
 * is a refusal explained to whoever debugs the edit, and no interface renders it.
 */
function withoutNonCopy(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\b(?:class|className)=(?:"[^"]*"|'[^']*'|\{[^}]*\})/g, ' ')
    .replace(/\bnew\s+\w*Error\s*\(\s*(?:'[^']*'|"[^"]*"|`[^`]*`)/g, ' ')
    .replace(/\bconsole\.\w+\(\s*(?:'[^']*'|"[^"]*"|`[^`]*`)/g, ' ')
    .replace(/\buseRequired\s*\(\s*\w+\s*,\s*(?:'[^']*'|"[^"]*"|`[^`]*`)/g, ' ')
}

/**
 * Every literal one file could put on screen, wherever it was written.
 *
 * JSX text, an attribute, a template literal, and — the case the earlier scans missed — an object
 * property's value, which is how a label table is written and therefore how a whole vocabulary can
 * sit in a component while every existing check stays green.
 */
function copySaidBy(source: string): string[] {
  const stripped = withoutNonCopy(source)
  const found: string[] = []
  for (const match of stripped.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`\n]*)`/g)) {
    found.push((match[1] ?? match[2] ?? match[3] ?? '').replace(/\$\{[^}]*\}/g, ''))
  }
  for (const match of stripped.matchAll(/>([^<>{}\n]+)</g)) found.push(match[1]!.trim())
  return found
}

const copyIn = (path: string): string[] => copySaidBy(readFileSync(`${srcRoot}/${path}`, 'utf8'))

/** The modules the rule reads: everything shipped, minus the tables it is asking for. */
function copySources(): string[] {
  return BACKSTOP_DIRS.flatMap((dir) =>
    readdirSync(`${srcRoot}/${dir}`, { recursive: true })
      .map(String)
      .filter((entry) => /\.tsx?$/.test(entry) && !NOT_A_MODULE.test(entry))
      .filter((entry) => !TABLES_SHIPPED.includes(`${dir}/${entry}`))
      .map((entry) => `${dir}/${entry}`),
  )
}

/** Every (file, sentence) the rule finds, sorted, so a failure reads as a list of work. */
const copyDebtFound = (): string[] =>
  [...new Set(copySources().flatMap((path) =>
    copyIn(path)
      .filter((text) => COPY_SHAPED.test(text) && !NOT_PROSE.test(text) && NEVER_COPY[text] !== true)
      .map((text) => `${path}\u0000${text}`),
  ))].sort()

/** `path` and `sentence` as one line of a failure message. */
const pair = (entry: string): string => {
  const [path, text] = entry.split('\u0000')
  return `${path}: ${text}`
}

// ---------------------------------------------------------------------------- the checks
describe('the words BuildBox ships saying', () => {
  it('carries strings at every level, so the scan below is not empty', () => {
    expect(shipped.length).toBeGreaterThan(200)
    expect(shipped.filter(([path]) => path.startsWith('ui/strings'))).not.toHaveLength(0)
    expect(shipped.filter(([path]) => path.startsWith('export/'))).not.toHaveLength(0)
    expect(shipped.filter(([path]) => path.startsWith('domain/'))).not.toHaveLength(0)
  })

  it('says no word #19 §12 bans (#66 criterion 8)', () => {
    expect(offendersOf(shipped)).toEqual([])
  })

  it('has a list wide enough to cover the topics #27 closed', () => {
    // #27 §12 closed the second family: the words a homeowner searches for when they are
    // asking about something BuildBox has measured nothing about. A list that only carries
    // the compliance words would let `Gas supply` back in as a label.
    for (const word of [
      'flow',
      'pressure',
      'falls',
      'gradient',
      'electrical load',
      'conduit fill',
      'refrigerant',
      'capacity',
      'gas-safety',
      'not connected',
    ]) {
      expect(BANNED_WORDS, `${word} is missing from the list`).toContain(word)
    }
    expect(BANNED_WORDS).toHaveLength(28)
  })

  it('gives no CSV column a header containing code', () => {
    // A substring here, not a word: `postcode` is the way this word hides in a column list,
    // and a reader who sees `code` in a header reads a standard behind it.
    const headers = Object.values(TABLES).flatMap((table) => table.columns.map((column) => column.header))
    expect(headers.length).toBeGreaterThan(10)
    expect(headers.filter((header) => header.toLowerCase().includes('code'))).toEqual([])
  })

  it('says nothing a banned word appears in, outside the tables', () => {
    expect(backstop()).toEqual([])
  })

  it('leaves no sentence outside the copy table (#66 criterion 16)', () => {
    expect(copyDebtFound().map(pair)).toEqual([])
  })

  it('scans no text the user typed', () => {
    // A layer named `Structure` is data, and criterion 8 leaves it alone. The guarantee is
    // structural: every path the scans read is a module the product ships.
    expect(shipped.every(([path]) => /^(ui\/strings|export\/|domain\/)/.test(path))).toBe(true)
    expect(BACKSTOP_DIRS).toEqual(['export', 'ui'])
    // And the word that would have caught it is `structural`, which is a claim, not a name.
    expect(bannedWordsIn('Structure')).toEqual([])
    expect(bannedWordsIn('Structural wall')).toContain('structural')
  })
})

describe('the scans fail when they should', () => {
  it('catches a banned word written into the copy table', () => {
    expect(offendersOf([['ui/strings/madeUp', 'Wall is load-bearing']])).toEqual([
      'ui/strings/madeUp says "load-bearing": Wall is load-bearing',
    ])
  })

  it('catches the promise a sentence ends with rather than starts with', () => {
    expect(offendersOf([['export/strings/madeUp', 'Not to code']])).not.toEqual([])
  })

  it('catches a header that hides the word inside another word', () => {
    const headers = ['Floor', 'Postcode of the site']
    expect(headers.filter((header) => header.toLowerCase().includes('code'))).toEqual([
      'Postcode of the site',
    ])
  })

  it('reads a component that renders a literal, not only the table it should have used', () => {
    const component = `
      export const Row = () => (
        // A note to the reader about the code this does not quote.
        <p>This beam is load-bearing</p>
      )`
    const said = saidByText(component)
    expect(said).toContain('This beam is load-bearing')
    expect(said.some((text) => text.includes('code'))).toBe(false)
    expect(said.filter((text) => bannedWordsIn(text).length > 0)).toEqual(['This beam is load-bearing'])
  })

  it('leaves a word alone when it is only part of another word', () => {
    expect(mentionsWord('Enclosed storage', 'code')).toBe(false)
    expect(mentionsWord('A safe place for the hoover', 'safe')).toBe(true)
  })

  it('catches a label table written as object properties, not only words between tags', () => {
    // The shape the earlier scans let through: nothing here is JSX, so a scan that reads text
    // between tags sees an empty file while a person reads three labels off the screen.
    const registry = `
      export const KINDS = [
        { value: 'external', label: 'External' },
        { value: 'internal', label: 'Internal' },
      ]
      const hint = \`Placing a Wall\`
      const key = 'Escape'
      const cls = 'load-bearing-wall'
      const path = 'M2 6 H18'`
    const said = copySaidBy(registry)
    expect(said).toContain('External')
    expect(said).toContain('Internal')
    expect(said).toContain('Placing a Wall')
    const flagged = said.filter((text) => COPY_SHAPED.test(text) && !NOT_PROSE.test(text) && NEVER_COPY[text] !== true)
    expect(flagged).toEqual(['External', 'Internal', 'Placing a Wall'])
  })
})

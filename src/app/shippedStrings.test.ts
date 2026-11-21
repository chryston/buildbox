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
 * `export` first: it is already clean. `ui` joins it once its components hold no literal of
 * their own, because a backstop that skips the largest directory is a backstop nobody trusts.
 */
const BACKSTOP_DIRS = ['export']

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
 * The words a copy function can put on screen.
 *
 * A function's own text is the only place its literals live, and the interpolated parts are
 * numbers and names the caller owns — so the template is cut at each `${…}` and what is left is
 * the prose.
 */
function literalsOf(source: string, path: string): Array<[string, string]> {
  return [...source.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)]
    .map((match) => (match[1] ?? match[2] ?? match[3] ?? '').replace(/\$\{[^}]*\}/g, ''))
    .filter((text) => /[A-Za-z]{3}/.test(text))
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

/** What one file says out loud: its string literals and the text between its tags. */
const saidByText = (source: string): string[] => {
  const stripped = withoutComments(source)
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

  it('scans no text the user typed', () => {
    // A layer named `Structure` is data, and criterion 8 leaves it alone. The guarantee is
    // structural: every path the scans read is a module the product ships.
    expect(shipped.every(([path]) => /^(ui\/strings|export\/|domain\/)/.test(path))).toBe(true)
    expect(BACKSTOP_DIRS.map((dir) => `${dir}/`)).toEqual(['export/'])
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
})

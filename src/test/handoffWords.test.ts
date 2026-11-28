/**
 * The words inside a Handoff Pack (#85 §4.6).
 *
 * #66 scanned the copy table and the source of every component. This scans the other direction: a
 * real pack is generated for the reference fixture and everything BuildBox authored inside it is put
 * in front of the same banned-word list. A pack is the one output that leaves the device and is read
 * by somebody who never opens the app — a tradesperson, a supplier, a building control officer — so a
 * word BuildBox has no authority to say is at its most damaging in a CSV header or a title block,
 * where it reads as a finding rather than as interface copy.
 *
 * What is scanned is BuildBox's own writing, and the line is drawn deliberately:
 *
 *   • every manifest key, and every manifest value that is BuildBox's rather than the Project's;
 *   • every CSV header of every file in the archive;
 *   • every enum code the contract publishes, from the frozen `enums.json`;
 *   • the Warnings List's `message` column, which is the strip's sentence byte for byte;
 *   • the title block, footer, scale statement and notices a PDF page is built from — the authored
 *     tables in `export/strings`, which are the only place those words exist. A PDF's text is written
 *     through a subset font with its own glyph ids, so scanning the bytes would find nothing and prove
 *     nothing; scanning the table the page is assembled from is the same words where they are decided.
 *
 * What is never scanned is anything a person typed: the Project's name, Floor names, Item Design
 * names, comment titles and bodies. Criterion 8 is about what BuildBox says.
 *
 * The last block proves the scan can fail. A scan that cannot fail is a comment with an `expect` in
 * it, so a banned word is seeded into a title-block label and the scan is required to name it.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { validateProject } from '../domain'
import { warningMessages, type QuantityScope } from '../derive'
import { referenceProject } from '../derive/testing'
import {
  BANNED_WORDS,
  bannedWordsIn,
  unzipEntries,
} from '../lib'
import {
  CSV_CONTRACT_VERSION,
  DEFAULT_HANDOFF_OUTPUTS,
  HANDOFF_TABLES,
  TABLES,
  exportHandoff,
  headerLine,
} from '../export'
import type { HandoffRecipe } from '../export'
import { EXPORT_WORDS } from '../export'
import { ANNOTATION_STRINGS, RENOVATION_STRINGS, STRINGS, warningSentence } from '../ui'

const FONT = new URL('../assets/fonts/NotoSans-Latin1.ttf', import.meta.url)
const ENUMS = new URL('../../fixtures/export/csv/v1.0/enums.json', import.meta.url)
const LIMITS = { maxEntries: 64, maxEntryBytes: 1 << 22, maxTotalBytes: 1 << 25, maxRatio: 200, ratioFloorBytes: 1 << 16 }

const project = referenceProject()

// A Project that does not validate makes every Intent refuse without saying so, and would make the
// pack come back with nothing in it — the scan would pass on an empty archive.
expect(validateProject(project).ok).toBe(true)

const scope: QuantityScope = {
  floorIds: project.floors.map((floor) => floor.id),
  designOptionIds: 'existing-only',
  renovationStates: ['existing', 'demolition', 'proposed'],
  drawingLayers: 'all',
}

const recipe: HandoffRecipe = {
  drawing: {
    views: project.views.map((view) => ({ kind: 'plan' as const, viewId: view.id })),
    format: 'pdf',
    pageSize: 'A3',
    orientation: 'auto',
    scale: 'fit',
    pngLongEdge: 2048,
    titleBlock: true,
    grid: false,
    unit: 'mm',
    precision: 0,
  },
  outputs: { ...DEFAULT_HANDOFF_OUTPUTS },
  tables: [...HANDOFF_TABLES],
  scope,
}

/** The pack, generated once: the same bytes a download would produce. */
const pack = await exportHandoff({ project, revision: 1 }, recipe, {
  clock: { now: () => '2026-03-04T09:30:00.000Z', localDate: () => '2026-03-04' },
  buildboxVersion: '0.0.0-test',
  font: { bytes: new Uint8Array(readFileSync(FONT)) },
  warningMessages: warningMessages(project, scope, warningSentence),
  projectName: project.meta.name,
})

if (!pack.ok) {
  throw new Error(`the reference fixture produced no pack: ${JSON.stringify(pack.failures)}`)
}

const read = unzipEntries(pack.archive.bytes, LIMITS)
if (!read.ok) throw new Error(`the pack did not read back: ${read.failure.code}`)
const ENTRIES = new Map(read.entries.map((entry) => [entry.name, entry.data]))

const decode = (bytes: Uint8Array): string => new TextDecoder('utf8', { ignoreBOM: true }).decode(bytes)

/** Every string BuildBox authored inside the pack, each labelled with where it came from. */
function authored(): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const manifest = ENTRIES.get('manifest.json')
  if (manifest !== undefined) {
    const walk = (value: unknown, path: string): void => {
      if (typeof value === 'string') {
        out.push([path, value])
        return
      }
      if (Array.isArray(value)) {
        value.forEach((child, index) => {
          walk(child, `${path}[${index}]`)
        })
        return
      }
      if (value !== null && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
          out.push([`${path}.<key>`, key])
          walk(child, `${path}.${key}`)
        }
      }
    }
    walk(JSON.parse(decode(manifest)) as unknown, 'manifest')
  }
  for (const id of HANDOFF_TABLES) {
    const bytes = ENTRIES.get(`data/${id}.csv`)
    if (bytes === undefined) continue
    const lines = decode(bytes).split('\r\n')
    out.push([`${id}.csv#header`, (lines[0] ?? '').replace(/^/, '')])
    // The Warnings List's message is BuildBox's sentence; every other cell in every other file is
    // either an identifier, a number, or a word the Project's author typed.
    if (id === 'warnings') {
      const at = headerLine(TABLES.warnings).split(',').indexOf('message')
      for (const line of lines.slice(1)) {
        if (line === '') continue
        const cell = line.split(',')[at]
        if (cell !== undefined) out.push([`warnings.csv#message`, cell.replace(/^"|"$/g, '')])
      }
    }
  }
  const enums = JSON.parse(readFileSync(ENUMS, 'utf8')) as Record<string, string[]>
  for (const [column, codes] of Object.entries(enums)) {
    for (const code of codes) out.push([`${column}#code`, code])
  }
  // The words a PDF page is assembled from.
  // `EXPORT_WORDS` is the module the pages are assembled from: the title block's labels, the footer,
  // the scale statement, the renovation display names, the not-to-scale line.
  for (const [name, table] of Object.entries(EXPORT_WORDS)) {
    if (typeof table === 'string') out.push([`pdf.${name}`, table])
    else if (table !== null && typeof table === 'object') {
      for (const [key, value] of Object.entries(table)) {
        if (typeof value === 'string') out.push([`pdf.${name}.${key}`, value])
      }
    }
  }
  for (const [name, table] of [
    ['STRINGS', STRINGS],
    ['RENOVATION_STRINGS', RENOVATION_STRINGS],
    ['ANNOTATION_STRINGS', ANNOTATION_STRINGS],
  ] as const) {
    for (const [key, value] of Object.entries(table)) {
      if (typeof value === 'string') out.push([`pdf.${name}.${key}`, value])
    }
  }
  return out
}

/** Every string the person typing into the Project authored, which the scan must never read. */
function userContent(): string[] {
  const bytes = ENTRIES.get('data/comments.csv')
  const cells: string[] = [project.meta.name]
  for (const floor of project.floors) cells.push(floor.name)
  if (bytes !== undefined) cells.push(decode(bytes))
  return cells
}

describe('the words inside a Handoff Pack (#85 §4.6)', () => {
  it('holds every output the recipe asked for', () => {
    // A scan of an empty archive passes, so the archive is checked before its words are.
    expect(ENTRIES.get('manifest.json')).toBeDefined()
    expect(ENTRIES.get('drawings.pdf')).toBeDefined()
    for (const id of HANDOFF_TABLES) expect(ENTRIES.has(`data/${id}.csv`), `data/${id}.csv`).toBe(true)
    expect(authored().length).toBeGreaterThan(200)
  })

  it('says no banned word anywhere BuildBox wrote (#85 §4.6)', () => {
    const hits: string[] = []
    for (const [path, value] of authored()) {
      const words = bannedWordsIn(value)
      if (words.length > 0) hits.push(`${path}: ${words.join(', ')} — ${value.slice(0, 90)}`)
    }
    expect(hits).toEqual([])
  })

  it('gives no CSV column a header containing the word code', () => {
    // `code` is banned and also the natural name for a column of codes, so it is checked by name
    // rather than by the prose rule: a header is lowercase and unpunctuated, and the word scan
    // deliberately ignores identifiers.
    for (const id of HANDOFF_TABLES) {
      for (const header of headerLine(TABLES[id]).split(',')) {
        expect(header.split('_'), `${id}.${header}`).not.toContain('code')
      }
    }
  })

  it('scans no text the person typed', () => {
    // Every user-authored string is put in front of the scan's exclusion list, and the scan is shown
    // to be able to see it: a Project named with a banned word would still pass, which is the point.
    const banned = userContent().filter((text) => bannedWordsIn(text).length > 0)
    const scanned = authored().map(([, value]) => value)
    for (const text of banned) {
      expect(scanned.some((value) => value.includes(text)), text.slice(0, 40)).toBe(false)
    }
  })

  it('notices a banned word seeded into a PDF title block', () => {
    // The proof the scan is not decorative: one label in the table the title block is assembled from
    // is replaced with a word #19 §12 bans, and the same scan must name it.
    const poisoned: Record<string, string> = { ...EXPORT_WORDS.TITLE_BLOCK, drawing: 'Structural assessment' }
    const hits: string[] = []
    for (const [key, value] of Object.entries(poisoned)) {
      const words = bannedWordsIn(value)
      if (words.length > 0) hits.push(`pdf.TITLE_BLOCK.${key}`)
    }
    expect(hits).toEqual(['pdf.TITLE_BLOCK.drawing'])
    // …and the real table is clean, so the hit is the seed and not the product.
    for (const value of Object.values(EXPORT_WORDS.TITLE_BLOCK)) {
      if (typeof value === 'string') expect(bannedWordsIn(value), value).toEqual([])
    }
  })

  it('publishes the version the manifest carries', () => {
    const manifest = JSON.parse(decode(ENTRIES.get('manifest.json')!)) as Record<string, unknown>
    expect(manifest['contract_version']).toBe(CSV_CONTRACT_VERSION)
    expect(BANNED_WORDS.length).toBeGreaterThan(10)
  })
})

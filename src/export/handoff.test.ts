/**
 * The Handoff Pack (#85 §3).
 *
 * The pack is the one export that mixes kinds: a PDF of drawings, three printed lists and eleven CSVs,
 * under fixed names, in one archive, from one recipe. These tests read the archive back rather than
 * trusting what wrote it, because a pack a tradesperson cannot unpack is worth nothing however tidy
 * the code that made it looked.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { referenceProject } from '../derive/testing'
import { warningMessages, type QuantityScope } from '../derive'
import type { Project } from '../domain'
import { unzipEntries } from '../lib'
import { defaultListsScope } from './scope'
import { exportHandoff, handoffDataPath } from './handoff'
import { HANDOFF_TABLES, DEFAULT_HANDOFF_OUTPUTS } from './types'
import type { HandoffRecipe } from './types'
import type { ExportClock, ExportDeps, ExportSnapshot } from './types'

/** The subset face a PDF needs, read from the source tree — the only file system a test may touch. */
function latin1Font(): Uint8Array {
  return readFileSync(new URL('../assets/fonts/NotoSans-Latin1.ttf', import.meta.url))
}

const AT: ExportClock = { now: () => '2026-03-04T09:30:00.000Z', localDate: () => '2026-03-04' }
const LATER: ExportClock = { now: () => '2026-03-04T09:31:00.000Z', localDate: () => '2026-03-04' }

/** Sentences a reader could not mistake for the app's: each names the key it was built from. */
const sentences = (at: Project, scope: QuantityScope): Record<string, string> =>
  warningMessages(at, scope, (messageKey) => `sentence:${messageKey}`)

const deps = (clock: ExportClock): ExportDeps => {
  const project = referenceProject()
  const scope = defaultListsScope(project, null)
  return {
    clock,
    buildboxVersion: '0.0.0-test',
    font: { bytes: latin1Font() },
    warningMessages: sentences(project, scope),
  }
}

function snapshotOf(revision = 3): ExportSnapshot {
  return { project: referenceProject(), revision }
}

function recipe(over: Partial<HandoffRecipe> = {}): HandoffRecipe {
  const project = referenceProject()
  return {
    drawing: {
      views: project.views.map((view) => ({ kind: 'plan' as const, viewId: view.id })),
      format: 'pdf',
      pageSize: 'A4',
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
    scope: defaultListsScope(project, null),
    ...over,
  }
}

const LIMITS = { maxEntries: 64, maxEntryBytes: 1 << 22, maxTotalBytes: 1 << 25, maxRatio: 200, ratioFloorBytes: 1 << 16 }

function entriesOf(bytes: Uint8Array) {
  const read = unzipEntries(bytes, LIMITS)
  if (!read.ok) throw new Error(`the pack did not read back: ${read.failure.code}`)
  return read.entries
}

function text(bytes: Uint8Array, name: string): string {
  const entry = entriesOf(bytes).find((each) => each.name === name)
  if (entry === undefined) throw new Error(`no entry named ${name}`)
  return new TextDecoder().decode(entry.data)
}

describe('the Handoff Pack (#85 §3.1)', () => {
  it('holds the drawings, the three printed lists and every CSV, under fixed names', async () => {
    const result = await exportHandoff(snapshotOf(), recipe(), deps(AT))
    if (!result.ok) throw new Error(`the pack failed: ${JSON.stringify(result.failures)}`)
    const names = entriesOf(result.archive.bytes).map((each) => each.name)
    expect(names[0]).toBe('manifest.json')
    expect(names).toContain('drawings.pdf')
    expect(names).toContain('item-list.pdf')
    expect(names).toContain('cut-list.pdf')
    expect(names).toContain('comment-register.pdf')
    expect(HANDOFF_TABLES.map((table) => handoffDataPath(table)).every((path) => names.includes(path))).toBe(true)
    // The CSVs sit in a folder of their own and the printed pages at the top, so a reader can ask for
    // one by name without knowing the Project.
    expect(names.filter((each) => each.startsWith('data/'))).toHaveLength(HANDOFF_TABLES.length)
    expect(result.archive.name).toBe(`${referenceProject().meta.name.replace(/[^A-Za-z0-9]+/g, '-')}_handoff_20260304.zip`)
  })

  it('writes only what was ticked', async () => {
    const result = await exportHandoff(
      snapshotOf(),
      recipe({ outputs: { drawings: false, itemList: false, cutList: false, commentRegister: false }, tables: ['walls'] }),
      deps(AT),
    )
    if (!result.ok) throw new Error(`the pack failed: ${JSON.stringify(result.failures)}`)
    const names = entriesOf(result.archive.bytes).map((each) => each.name)
    expect(names).toEqual(['manifest.json', 'data/walls.csv'])
  })

  it('holds one page per view in the Drawing Set, and says so on each page', async () => {
    const result = await exportHandoff(snapshotOf(), recipe(), deps(AT))
    if (!result.ok) throw new Error(`the pack failed: ${JSON.stringify(result.failures)}`)
    const drawings = entriesOf(result.archive.bytes).find((each) => each.name === 'drawings.pdf')
    if (drawings === undefined) throw new Error('no drawings.pdf')
    const pdf = new TextDecoder('latin1').decode(drawings.data)
    expect(pdf).toContain('/Type /Pages')
    expect(pdf.match(/\/Type \/Page[^s]/g)).toHaveLength(referenceProject().views.length)
  })

  it('describes every entry in the manifest, and itself last', async () => {
    const result = await exportHandoff(snapshotOf(), recipe(), deps(AT))
    if (!result.ok) throw new Error(`the pack failed: ${JSON.stringify(result.failures)}`)
    const manifest = JSON.parse(text(result.archive.bytes, 'manifest.json')) as Record<string, unknown>
    expect(manifest.format).toBe('buildbox-export')
    const archive = entriesOf(result.archive.bytes).map((each) => each.name)
    expect(archive[0]).toBe('manifest.json')
    const files = manifest.files as readonly Record<string, unknown>[]
    // The manifest lists the data first and itself last, because an entry cannot carry its own digest;
    // the archive leads with it, because a reader unpacking it wants the explanation first.
    expect(files.map((each) => each.path)).toEqual([...archive.slice(1), 'manifest.json'])
    expect(files[files.length - 1]!.kind).toBe('manifest')
    expect(manifest.recipe).toMatchObject({ outputs: DEFAULT_HANDOFF_OUTPUTS })
    // Every entry says which contract wrote it, which is what a reader checks before it parses a header.
    for (const entry of files) expect(entry.contract_version).toBe('1.0')
  })

  it('is byte-identical when nothing but the call changed, and moves only its clock otherwise', { timeout: 40_000 }, async () => {
    const first = await exportHandoff(snapshotOf(), recipe(), deps(AT))
    const second = await exportHandoff(snapshotOf(), recipe(), deps(AT))
    const later = await exportHandoff(snapshotOf(), recipe(), deps(LATER))
    if (!first.ok || !second.ok || !later.ok) throw new Error('expected three packs')
    expect(entriesOf(first.archive.bytes).map((each) => each.name)).toEqual(
      entriesOf(second.archive.bytes).map((each) => each.name),
    )
    for (const entry of entriesOf(first.archive.bytes)) {
      const again = entriesOf(second.archive.bytes).find((each) => each.name === entry.name)
      expect(again?.data).toEqual(entry.data)
    }
    // The clock moves the instant and, because each file carries it, the digests of those files. The
    // entry list itself does not move.
    const strip = (bytes: Uint8Array): string =>
      JSON.stringify(
        (JSON.parse(text(bytes, 'manifest.json')).files as readonly Record<string, unknown>[]).map((entry) => {
          const rest = { ...entry }
          delete rest.sha256
          return rest
        }),
      )
    expect(strip(later.archive.bytes)).toBe(strip(first.archive.bytes))
  })

  it('produces no pack when one output cannot be written, and names that entry', async () => {
    const project = referenceProject()
    const broken = recipe({
      drawing: { ...recipe().drawing, views: [{ kind: 'plan', viewId: 'view-that-is-not-here' }] },
    })
    const result = await exportHandoff(snapshotOf(), broken, deps(AT))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failures.length).toBeGreaterThan(0)
    // The person ticked `drawings.pdf`, so that is the name the failure has to use.
    expect(result.failures.every((each) => each.output === 'drawings.pdf')).toBe(true)
    expect(project.views.length).toBeGreaterThan(0)
  })
})

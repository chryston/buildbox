/**
 * The Export archive and its manifest (#85 §2).
 *
 * The Drawing Set and the Lists ZIP already wrote these files; this file is the audit that says they
 * are allowed to be called an export: the archive is byte-stable, its entries are in a fixed order at
 * a fixed timestamp, every entry is described by a digest that matches the bytes, the manifest carries
 * the whole recipe and nothing about the person, and one failing output means no archive at all.
 */
import { describe, expect, it } from 'vitest'
import { referenceProject } from '../derive/testing'
import { sha256Hex, unzipEntries } from '../lib'
import { exportFiles } from './index'
import type { ExportClock, ExportDeps, ExportSnapshot, Recipe } from './types'
import { MANIFEST_FORMAT, MANIFEST_VERSION } from './zip'
import { CSV_CONTRACT_VERSION } from './csv/tables'

const AT: ExportClock = { now: () => '2026-03-04T09:30:00.000Z', localDate: () => '2026-03-04' }
/** The same export a minute later, which is the only thing allowed to move between two runs. */
const LATER: ExportClock = { now: () => '2026-03-04T09:31:00.000Z', localDate: () => '2026-03-04' }

const deps = (clock: ExportClock, over: Partial<ExportDeps> = {}): ExportDeps => ({
  clock,
  buildboxVersion: '0.0.0-test',
  ...over,
})

function snapshotOf(revision = 3): ExportSnapshot {
  return { project: referenceProject(), revision }
}

function recipeFor(viewIds: readonly string[], over: Partial<Recipe> = {}): Recipe {
  return {
    views: viewIds.map((viewId) => ({ kind: 'plan' as const, viewId })),
    format: 'svg',
    pageSize: 'A4',
    orientation: 'auto',
    scale: 'fit',
    pngLongEdge: 2048,
    titleBlock: true,
    grid: false,
    unit: 'mm',
    precision: 0,
    ...over,
  }
}

/** The three Plan Views of the reference Project, which is a Drawing Set by any reading. */
function setRecipe(over: Partial<Recipe> = {}): Recipe {
  return recipeFor(
    referenceProject().views.map((view) => view.id),
    over,
  )
}

const LIMITS = { maxEntries: 64, maxEntryBytes: 1 << 22, maxTotalBytes: 1 << 25, maxRatio: 200, ratioFloorBytes: 1 << 16 }

/** The archive's entry names, read back out of the bytes rather than from what wrote them. */
function namesOf(bytes: Uint8Array): string[] {
  const read = unzipEntries(bytes, LIMITS)
  if (!read.ok) throw new Error(`the archive did not read back: ${read.failure.code}`)
  return read.entries.map((entry) => entry.name)
}

function dataOf(bytes: Uint8Array, name: string): Uint8Array {
  const read = unzipEntries(bytes, LIMITS)
  if (!read.ok) throw new Error(`the archive did not read back: ${read.failure.code}`)
  const entry = read.entries.find((each) => each.name === name)
  if (entry === undefined) throw new Error(`no entry named ${name}`)
  return entry.data
}

function manifestOf(bytes: Uint8Array): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(dataOf(bytes, 'manifest.json'))) as Record<string, unknown>
}

describe('the Export archive (#85 §2.1)', () => {
  it('is byte-identical when nothing but the call changed', async () => {
    const first = await exportFiles(snapshotOf(), setRecipe(), deps(AT))
    const second = await exportFiles(snapshotOf(), setRecipe(), deps(AT))
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok || first.kind !== 'archive' || second.kind !== 'archive') return
    const a = first.archive.bytes
    expect(namesOf(a)).toEqual(namesOf(second.archive.bytes))
    for (const name of namesOf(a)) {
      expect(dataOf(a, name)).toEqual(dataOf(second.archive.bytes, name))
    }
  })

  it('writes manifest.json first and the outputs in recipe order', async () => {
    const result = await exportFiles(snapshotOf(), setRecipe(), deps(AT))
    if (!result.ok || result.kind !== 'archive') throw new Error('expected an archive')
    const names = namesOf(result.archive.bytes)
    expect(names[0]).toBe('manifest.json')
    expect(names.slice(1)).toEqual(result.files.map((file) => file.name))
  })

  it('stamps every entry with 1980-01-01 00:00 and nothing else', async () => {
    const result = await exportFiles(snapshotOf(), setRecipe(), deps(AT))
    if (!result.ok || result.kind !== 'archive') throw new Error('expected an archive')
    const bytes = result.archive.bytes
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let seen = 0
    for (let at = 0; at + 30 <= bytes.length; at += 1) {
      if (view.getUint32(at, true) !== 0x04034b50) continue
      // The local file header's time and date, at 10 and 12: the archiver's one fixed stamp.
      expect(view.getUint16(at + 10, true)).toBe(0)
      expect(view.getUint16(at + 12, true)).toBe((1 << 5) | 1)
      seen += 1
    }
    expect(seen).toBe(namesOf(bytes).length)
  })

  it('moves only its timestamps when the clock moves', async () => {
    const first = await exportFiles(snapshotOf(), setRecipe(), deps(AT))
    const second = await exportFiles(snapshotOf(), setRecipe(), deps(LATER))
    if (!first.ok || !second.ok || first.kind !== 'archive' || second.kind !== 'archive') {
      throw new Error('expected two archives')
    }
    const a = first.archive.bytes
    const b = second.archive.bytes
    const entries = namesOf(a)
    expect(entries).toEqual(namesOf(b))
    for (const name of entries.filter((each) => each !== 'manifest.json')) {
      const before = new TextDecoder().decode(dataOf(a, name))
      const after = new TextDecoder().decode(dataOf(b, name))
      // The instant is the only difference, wherever it appears in a file.
      expect(after.split('2026-03-04T09:31:00.000Z').join('2026-03-04T09:30:00.000Z')).toBe(before)
    }
    // The manifest moves its own instant and, because each file carries that instant, the digests of
    // those files. Nothing else about it moves: same entries, same order, same lengths, same recipe.
    const strip = (bytes: Uint8Array): string =>
      JSON.stringify(
        (manifestOf(bytes).files as readonly Record<string, unknown>[]).map((entry) => {
          const rest = { ...entry }
          delete rest.sha256
          return rest
        }),
      )
    expect(strip(b)).toBe(strip(a))
    expect(manifestOf(b).exported_at).toBe('2026-03-04T09:31:00.000Z')
    expect(manifestOf(a).exported_at).toBe('2026-03-04T09:30:00.000Z')
  })
})

describe('manifest.json (#85 §2.2)', () => {
  it('says what it is and carries the whole recipe', async () => {
    const recipe = setRecipe({ notes: { commentPins: true, includeResolvedPins: true, viewAnnotations: true } })
    const result = await exportFiles(snapshotOf(7), recipe, deps(AT, { unsavedChanges: true }))
    if (!result.ok || result.kind !== 'archive') throw new Error('expected an archive')
    const manifest = manifestOf(result.archive.bytes)
    expect(manifest.format).toBe(MANIFEST_FORMAT)
    expect(manifest.manifest_version).toBe(MANIFEST_VERSION)
    expect(manifest.contract_version).toBe(CSV_CONTRACT_VERSION)
    expect(manifest.exported_at).toBe('2026-03-04T09:30:00.000Z')
    expect(manifest.buildbox_version).toBe('0.0.0-test')
    expect(manifest.project_id).toBe(referenceProject().id)
    expect(manifest.project_revision).toBe(7)
    expect(manifest.unsaved_changes).toBe(true)
    expect(manifest.recipe).toMatchObject({ format: 'svg', views: recipe.views })
  })

  it('says nothing about unsaved changes when there were none', async () => {
    const result = await exportFiles(snapshotOf(), setRecipe(), deps(AT))
    if (!result.ok || result.kind !== 'archive') throw new Error('expected an archive')
    expect(manifestOf(result.archive.bytes).unsaved_changes).toBeUndefined()
  })

  it('describes every entry with a digest and a length that match the bytes', async () => {
    const result = await exportFiles(snapshotOf(), setRecipe(), deps(AT))
    if (!result.ok || result.kind !== 'archive') throw new Error('expected an archive')
    const manifest = manifestOf(result.archive.bytes)
    const entries = manifest.files as readonly Record<string, unknown>[]
    // The data files in recipe order, then the manifest describing itself — last, and with no digest,
    // because no file can carry the hash of the bytes that contain that hash.
    expect(entries.map((each) => each.path)).toEqual([...result.files.map((file) => file.name), 'manifest.json'])
    const self = entries[entries.length - 1]!
    expect(self.kind).toBe('manifest')
    expect(self.sha256).toBeUndefined()
    for (const entry of entries.slice(0, -1)) {
      const data = dataOf(result.archive.bytes, entry.path as string)
      expect(entry.bytes).toBe(data.length)
      expect(entry.sha256).toBe(await sha256Hex(data))
      expect(entry.media_type).toBeDefined()
      expect(entry.contract_version).toBe(CSV_CONTRACT_VERSION)
    }
    // And the entry order the manifest describes is the order the archive holds, bar the manifest,
    // which leads it.
    expect(namesOf(result.archive.bytes)).toEqual(['manifest.json', ...entries.slice(0, -1).map((each) => each.path)])
  })

  it('names no person, device, place or locale anywhere (#85 §2.2)', async () => {
    const result = await exportFiles(snapshotOf(), setRecipe(), deps(AT))
    if (!result.ok || result.kind !== 'archive') throw new Error('expected an archive')
    const text = new TextDecoder().decode(dataOf(result.archive.bytes, 'manifest.json'))
    for (const forbidden of [
      'author',
      'account',
      'device',
      'user_agent',
      'userAgent',
      'locale',
      'timezone',
      'time_zone',
      'ip_address',
      'absolute_path',
      'C:\\',
      '/home/',
    ]) {
      expect(text).not.toContain(forbidden)
    }
  })
})

describe('all or nothing (#85 §2.4)', () => {
  it('produces no archive when one view of the set cannot be written, and names it', async () => {
    const project = referenceProject()
    const recipe = recipeFor([project.views[0]!.id, 'view-that-is-not-here'])
    const result = await exportFiles(snapshotOf(), recipe, deps(AT))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]!.reason).toBe('unknown-view')
    // The recipe named a view the Project does not have, so there is no name to show: the output is
    // named by what the recipe said, which is the only thing the person can match a tick to.
    expect(result.failures[0]!.output).toContain('view-that-is-not-here')
  })

  it('produces no archive when a fixed scale will not hold one page', async () => {
    const project = referenceProject()
    const recipe = recipeFor(project.views.map((view) => view.id), { scale: 10 })
    const result = await exportFiles(snapshotOf(), recipe, deps(AT))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failures.every((each) => each.reason === 'out-of-paper')).toBe(true)
    // Every failure names a view, because a set of three where one is too big is not a problem with
    // the other two, and the person has to know which box to untick.
    for (const failure of result.failures) {
      expect(failure.output.length).toBeGreaterThan(0)
    }
  })
})

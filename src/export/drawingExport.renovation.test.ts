/**
 * What a Drawing export leaves behind, and what it says about itself (#73 criteria 2, 3 and 12).
 *
 * The sheet is the one artefact a person takes away and cannot interrogate, so the metadata is the
 * receipt: it has to name the composition that was actually painted, in every format, and a repeat
 * export has to be the same file. The other half is what a drawing export must never do — edit the
 * Project it was asked to draw. The toggles that make criterion 2 interesting are the recipe's, so
 * the saved view is compared with itself across the call.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import renovationFixture from '../../fixtures/domain/v8/renovation-views.json?raw'
import type { Project } from '../domain'
import { canonicalJson } from '../lib'
import { exportFiles } from './index'
import type { DrawingFormat, ExportClock, ExportDeps, ExportResult, Recipe, RecipeViewRef } from './types'

const project = (JSON.parse(renovationFixture) as { project: Project }).project
const snapshot = { project, revision: 7 }
const CLOCK: ExportClock = { now: () => '2026-11-23T09:30:00.000Z', localDate: () => '2026-11-23' }
const PLAN_IMAGE = new Uint8Array(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4AWMAAQAABQABNtCI3QAAAABJRU5ErkJggg==', 'base64'),
)
const DEPS: ExportDeps = {
  clock: CLOCK,
  buildboxVersion: '0.0.0-test',
  font: { bytes: new Uint8Array(readFileSync(new URL('../assets/fonts/NotoSans-Latin1.ttf', import.meta.url))) },
  assets: async () => ({ bytes: PLAN_IMAGE, mediaType: 'image/png' }),
}

const VIEW: RecipeViewRef = { kind: 'plan', viewId: 'views-view-016' }

const recipeOf = (format: DrawingFormat, view: RecipeViewRef = VIEW): Recipe => ({
  views: [view],
  format,
  pageSize: 'A3',
  orientation: 'auto',
  scale: 50,
  pngLongEdge: 2048,
  titleBlock: true,
  grid: false,
  unit: 'mm',
  precision: 0,
})

const bytesOf = async (pending: Promise<ExportResult>): Promise<Uint8Array> => {
  const result = await pending
  if (!result.ok) throw new Error(`export failed: ${JSON.stringify(result.failures)}`)
  if (result.kind !== 'single') throw new Error('expected one file')
  return result.file.bytes
}

/** The file's bytes as text: the metadata is UTF-8 in every format, the rest of a PDF is not. */
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

/** The provenance each format carries, as the object it was written from. */
function provenanceOf(format: DrawingFormat, bytes: Uint8Array): Record<string, unknown> {
  if (format === 'svg') {
    const block = /<metadata>([\s\S]*?)<\/metadata>/.exec(decode(bytes))
    if (block === null) throw new Error('the SVG carries no <metadata>')
    return JSON.parse(block[1]!) as Record<string, unknown>
  }
  const packet = /<bb:ExportJSON>([\s\S]*?)<\/bb:ExportJSON>/.exec(decode(bytes))
  if (packet === null) throw new Error('the PDF carries no ExportJSON in its XMP packet')
  // The packet holds the same JSON the SVG element does, escaped as XML text (provenance.ts).
  const xml = packet[1]!
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
  return JSON.parse(xml) as Record<string, unknown>
}

describe('the recorded composition (#73 §1, criterion 3)', () => {
  // The PNG is written from the same provenance object (provenance.ts: one builder, four carriers);
  // rasterising it needs the port the app injects, which no test in this suite stubs.
  it('is in the SVG metadata and the PDF XMP packet', async () => {
    for (const format of ['svg', 'pdf'] as const) {
      const provenance = provenanceOf(format, await bytesOf(exportFiles(snapshot, recipeOf(format), DEPS)))
      const recipe = provenance['recipe'] as { composition?: Record<string, unknown>[] }
      const [record] = recipe.composition ?? []
      expect(record, format).toBeDefined()
      expect(record?.['view_id'], format).toBe('views-view-016')
      expect(record?.['view_name'], format).toBe('Option B · Combined')
      expect(record?.['design_option_id'], format).toBe('option-b')
      expect(record?.['renovation_display'], format).toBe('combined')
      expect((record?.['included_layers'] as unknown[]).length, format).toBeGreaterThan(0)
    }
  })

  it('names the layers the recipe overrode, not the ones the view hides', async () => {
    const toggled: RecipeViewRef = { ...VIEW, toggles: { layers: [] } }
    const provenance = provenanceOf('svg', await bytesOf(exportFiles(snapshot, recipeOf('svg', toggled), DEPS)))
    const recipe = provenance['recipe'] as { views?: { toggles?: { layers?: string[] } }[] }
    expect(recipe.views?.[0]?.toggles?.layers).toEqual([])
  })
})

describe('a repeat export (#73 criterion 3)', () => {
  it('writes the same SVG and the same PDF, apart from the timestamp', async () => {
    const strip = (text: string): string =>
      text
        .replace(/"exported_at":"[^"]*"/g, '"exported_at":"-"')
        .replace(/\/CreationDate\s*\([^)]*\)/g, '/CreationDate (-)')
        .replace(/\/ModDate\s*\([^)]*\)/g, '/ModDate (-)')
        .replace(/\/ID\s*\[[^\]]*\]/g, '/ID [-]')
    for (const format of ['svg', 'pdf'] as const) {
      const first = strip(decode(await bytesOf(exportFiles(snapshot, recipeOf(format), DEPS))))
      const second = strip(decode(await bytesOf(exportFiles(snapshot, recipeOf(format), DEPS))))
      expect(second, format).toBe(first)
    }
  })
})

describe('a drawing export never edits (#73 criterion 12, criterion 2)', () => {
  it('leaves the Project, the revision and every saved view exactly as it found them', async () => {
    const before = canonicalJson(project)
    const viewsBefore = canonicalJson(project.views)
    const toggled: RecipeViewRef = { ...VIEW, toggles: { layers: [], notesOverlay: true } }
    for (const format of ['svg', 'pdf'] as const) {
      for (const view of [VIEW, toggled]) {
        const result = await exportFiles(snapshot, recipeOf(format, view), DEPS)
        expect(result.ok, `${format} ${view.kind}`).toBe(true)
      }
    }
    expect(canonicalJson(project)).toBe(before)
    expect(canonicalJson(project.views)).toBe(viewsBefore)
    expect(snapshot.revision).toBe(7)
  })
})

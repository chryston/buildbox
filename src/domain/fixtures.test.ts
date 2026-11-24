/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest'
import { canonicalJson } from '../lib'
import { DOMAIN_SCHEMA_VERSION, migrateProject, type PlanView } from './index'
import readmeText from '../../fixtures/domain/README.md?raw'

// Every domain fixture on disk, migrated and validated on every run (#42 §6). A fixture
// is permanent compatibility evidence: the day `DOMAIN_SCHEMA_VERSION` moves again, this
// test is what proves the new chain still reads the old data — which is exactly what it
// did for #56, when the v1 files below became the evidence that v1 → v2 works.
//
// The v8 fixtures are the evidence for #69 and #71: the chain runs to the end and every file under
// `v8/` is held as that version's golden.
const fixtures = Object.entries(
  import.meta.glob<string>('/fixtures/domain/**/*.json', { eager: true, query: '?raw', import: 'default' }),
)
  .map(([path, text]) => ({ path, text }))

function envelopeOf(text: string): Record<string, unknown> {
  return JSON.parse(text) as Record<string, unknown>
}

/** Sequential IDs, so a migrated fixture's new views are named the same way every run. */
function allocator(prefix = 'fixture-view'): (count: number) => string[] {
  let issued = 0
  return (count) => Array.from({ length: count }, () => `${prefix}-${(issued += 1)}`)
}

describe('domain fixtures (#42 §6)', () => {
  it('has the golden v1 Project, its v2 successor and the README', () => {
    const paths = fixtures.map(({ path }) => path)
    expect(paths).toContain('/fixtures/domain/v1/project-basic.json')
    expect(paths).toContain('/fixtures/domain/v2/project-basic.json')
    expect(readmeText).toContain('Never deleted, never edited')
  })

  it.each(fixtures)('$path is canonical JSON with one trailing newline', ({ text }) => {
    const parsed: unknown = JSON.parse(text)
    expect(text.endsWith('\n') && !text.endsWith('\n\n')).toBe(true)
    expect(canonicalJson(parsed)).toBe(text.slice(0, -1))
  })

  it.each(fixtures)('$path reads as a valid Project at the current schema', ({ path, text }) => {
    const envelope = envelopeOf(text)
    const result = migrateProject(envelope.project, envelope.domainSchemaVersion, allocator())
    if (!result.ok) throw new Error(`${path}: ${result.error.message}`)
    expect(result.project.views.length).toBeGreaterThanOrEqual(result.project.floors.length)
  })

  it.each(fixtures)('$path that is already current comes back with its own bytes', ({ path, text }) => {
    const envelope = envelopeOf(text)
    if (envelope.domainSchemaVersion !== DOMAIN_SCHEMA_VERSION) return
    const result = migrateProject(envelope.project, envelope.domainSchemaVersion, allocator())
    if (!result.ok) throw new Error(`${path}: ${result.error.message}`)
    // Criterion 14: opening and saving a current Project changes nothing it stores.
    expect(canonicalJson(result.project)).toBe(canonicalJson(envelope.project))
  })

  it.each(fixtures)('$path older than the current schema gains one default view per Floor', ({ path, text }) => {
    const envelope = envelopeOf(text)
    const from = envelope.domainSchemaVersion as number
    if (from === DOMAIN_SCHEMA_VERSION) return
    const result = migrateProject(envelope.project, from, allocator())
    if (!result.ok) throw new Error(`${path}: ${result.error.message}`)
    const floors = result.project.floors
    const defaults = result.project.views.filter((view: PlanView) => view.isDefault)
    expect(defaults).toHaveLength(floors.length)
    // Everything the older file already said survives. The Item Designs keep their ids,
    // names and heights; only the footprint is restated, which is the whole step (#58).
    type Identified = { id: string; name: string; height?: number }
    type PriorFloor = { limits?: unknown }
    const prior = envelope.project as { floors: PriorFloor[]; existingModel: unknown; itemDesigns: Identified[] }
    floors.forEach((floor, i) => {
      const own = result.project.views.filter((view) => view.floorId === floor.id)
      // Every Floor ends with exactly one default view: the one the file already had, or the one the
      // chain invented for it. Only an invented one is named after the Floor — a file that had
      // renamed its own view keeps the name it chose.
      const defaults = own.filter((view) => view.isDefault)
      expect(defaults).toHaveLength(1)
      for (const view of defaults.filter((each) => each.id.startsWith('fixture-view-'))) {
        expect(view).toEqual(
          expect.objectContaining({ floorId: floor.id, name: floor.name, showPlanImage: true, kind: 'plan' }),
        )
      }
      // A v1 Floor had no limits, and inventing some would be inventing geometry. What the chain never
      // does is add a limit to a Floor that arrived without one; a Floor that declared its own — the v9
      // scene does (#75) — keeps exactly what it declared, which the equality below says.
      if (prior.floors[i]?.limits === undefined) expect(floor).not.toHaveProperty('limits')
    })
    const identity = (designs: Identified[]) =>
      designs.map((design) => ({ id: design.id, name: design.name, height: design.height }))
    expect(result.project.floors).toEqual(prior.floors)
    // #64: the chain adds the two empty Wall collections to an Existing Model that predates
    // them, #65 adds the empty Opening collection and #67 the empty Room collection. A
    // fixture that already has Walls — `v4/walls.json` — keeps the ones it was written with,
    // and so does one that already has Openings or Rooms.
    //
    // #73: the eighth step then files what it reads on the default layers — Walls, Openings and
    // Rooms on `Structure`, Placed Items on `Furniture` — so every entry carries the ID of the layer
    // this run's allocator issued for it, read back off the migrated Project. A source that is
    // already at v8 has been filed once and is left exactly as it was, including the records a
    // person put Unlayered, whose `drawingLayerId` is `null` and stays `null`.
    const layerId = (name: string): string => (result.project.drawingLayers ?? []).find((layer) => layer.name === name)!.id
    const filed = <T extends object>(entries: readonly T[] | undefined, name: string): T[] =>
      from >= 8
        ? [...(entries ?? [])] as T[]
        : (entries ?? []).map((entry) => ({ ...entry, drawingLayerId: layerId(name) }))
    const priorModel = prior.existingModel as Record<string, unknown>
    const entriesOf = (key: string): object[] => priorModel[key] as object[]
    expect(result.project.existingModel).toEqual({
      ...priorModel,
      ...('walls' in priorModel ? {} : { walls: [], wallJunctions: [] }),
      ...('openings' in priorModel ? {} : { openings: [] }),
      ...('rooms' in priorModel ? {} : { rooms: [] }),
      ...('beams' in priorModel ? {} : { beams: [] }),
      ...('skirting' in priorModel ? {} : { skirting: [] }),
      ...('services' in priorModel ? {} : { services: [] }),
      placedItems: filed(entriesOf('placedItems'), 'Furniture'),
      walls: filed(entriesOf('walls'), 'Structure'),
      openings: filed(entriesOf('openings'), 'Structure'),
      rooms: filed(entriesOf('rooms'), 'Structure'),
      beams: filed(entriesOf('beams'), 'Structure'),
      skirting: filed(entriesOf('skirting'), 'Structure'),
      // A Service is filed on `Services`, the layer its own subtype names (#79 §6) — the one layer
      // rule in this list that is not `Structure` or `Furniture`.
      services: filed(entriesOf('services'), 'Services'),
    })
    expect(identity(result.project.itemDesigns)).toEqual(identity(prior.itemDesigns))
  })
})

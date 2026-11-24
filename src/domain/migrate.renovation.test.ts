import { describe, expect, it } from 'vitest'
import { canonicalJson } from '../lib'
import {
  DOMAIN_SCHEMA_VERSION,
  MIGRATORS,
  migrateProject,
  migrateV7toV8,
  validateProject,
  viewDesignOptionId,
  viewRenovationDisplay,
  type IdAllocator,
} from './index'
import roomsFixture from '../../fixtures/domain/v7/rooms.json?raw'

// v8 is the current schema, so this file runs in `pure` like the rest of `domain`. The other half
// of the story — a build at an older schema refuses a v8 file as newer — is in `migrate.test.ts`.

/**
 * An allocator the migrator can reach for. #71's step is the first to need one — three IDs for the
 * default layers — so the test hands out readable ones and counts what was spent.
 */
function counter(): { allocateId: IdAllocator; spent: () => number } {
  let spent = 0
  return {
    allocateId: (count: number): string[] => {
      spent += count
      return Array.from({ length: count }, (_, i) => `layer-${spent}-${i}`)
    },
    spent: () => spent,
  }
}

function v7Project(): Record<string, unknown> {
  const envelope = JSON.parse(roomsFixture) as { domainSchemaVersion: number; project: Record<string, unknown> }
  expect(envelope.domainSchemaVersion).toBe(7)
  return structuredClone(envelope.project)
}

/** The step under test, with a fresh allocator. */
function step(data: unknown): unknown {
  return migrateV7toV8(data, counter().allocateId)
}

describe('migrateV7toV8 — Design Options, saved-view settings and Drawing Layers (#69, #70, #71)', () => {
  it('is the step this build registers above v7, and no longer the last', () => {
    expect(DOMAIN_SCHEMA_VERSION).toBe(11)
    expect(MIGRATORS).toHaveLength(10)
  })

  it('adds the Options, the view settings and the three layers, and nothing else', () => {
    const data = v7Project()
    const before = structuredClone(data)
    const result = step(data) as Record<string, unknown>
    expect(result.designOptions).toEqual([])
    // The three default layers, back to front, with the names and colours the issue names (#71 §1).
    expect(result.drawingLayers).toEqual([
      { id: 'layer-3-0', name: 'Structure', color: '#b9b9c2' },
      { id: 'layer-3-1', name: 'Services', color: '#5fb3ff' },
      { id: 'layer-3-2', name: 'Furniture', color: '#e3a857' },
    ])
    const structure = 'layer-3-0'
    const furniture = 'layer-3-2'
    // Every view now says which Option it looks through, which Display it draws, and that it
    // overrides nothing of its own (#70 §1, #71 §3).
    expect(result.views).toEqual(
      (before.views as Record<string, unknown>[]).map((view) => ({
        ...view,
        designOptionId: null,
        renovationDisplay: 'existing',
        layerSettings: {},
        layerOrder: null,
        activeLayerId: structure,
        snapToHiddenContent: false,
      })),
    )
    // Walls, Openings and Rooms are filed on Structure, Placed Items on Furniture (#71 §1).
    const model = result.existingModel as Record<string, Record<string, unknown>[]>
    for (const key of ['walls', 'openings', 'rooms']) {
      for (const entry of model[key] ?? []) expect(entry.drawingLayerId).toBe(structure)
    }
    for (const entry of model.placedItems ?? []) expect(entry.drawingLayerId).toBe(furniture)
    delete result.designOptions
    delete result.drawingLayers
    for (const view of result.views as Record<string, unknown>[]) {
      delete view.designOptionId
      delete view.renovationDisplay
      delete view.layerSettings
      delete view.layerOrder
      delete view.activeLayerId
      delete view.snapToHiddenContent
    }
    for (const key of ['walls', 'openings', 'rooms', 'placedItems']) {
      for (const entry of (result.existingModel as Record<string, Record<string, unknown>[]>)[key] ?? []) delete entry.drawingLayerId
    }
    expect(result).toEqual(before)
    expect(data).toEqual(before)
  })

  it('spends exactly three IDs on the default layers (#71 §1)', () => {
    const { allocateId, spent } = counter()
    const result = migrateV7toV8(v7Project(), allocateId) as Record<string, unknown>
    expect(spent()).toBe(3)
    expect((result.drawingLayers as unknown[]).length).toBe(3)
  })

  it('is idempotent, so a file that already carries the collection is carried over untouched', () => {
    const once = step(v7Project())
    expect(step(once)).toBe(once)
  })

  it('keeps a layer array it is handed, empty included, rather than inventing layers back', () => {
    const v8 = step(v7Project()) as Record<string, unknown>
    const stripped = { ...v8, drawingLayers: [] }
    expect(step(stripped)).toBe(stripped)
  })

  it('fills the settings a view is missing without touching the ones it carries', () => {
    const v8 = step(v7Project()) as Record<string, unknown>
    const views = structuredClone(v8.views) as Record<string, unknown>[]
    // A hand-written v8 file whose second view lost its Display: the step repairs that view and
    // leaves the Option the first view is looking through alone.
    views[0] = { ...views[0]!, designOptionId: 'option-a', renovationDisplay: 'combined' }
    delete views[1]!.renovationDisplay
    const repaired = step({ ...v8, views }) as Record<string, unknown>
    const after = repaired.views as Record<string, unknown>[]
    expect(after[0]).toEqual({ ...views[0] })
    expect(after[1]).toMatchObject({ renovationDisplay: 'existing' })
    expect(repaired.designOptions).toEqual([])
  })

  it('leaves a value that is not a record alone', () => {
    expect(step(null)).toBe(null)
    expect(step([1, 2])).toEqual([1, 2])
    expect(step('nope')).toBe('nope')
  })
})

describe('the v8 chain end to end (#69, #70)', () => {
  it('reads a v7 Project and hands back a valid one with no Options and Existing views', () => {
    const result = migrateProject(v7Project(), 7, counter().allocateId)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.designOptions).toEqual([])
    for (const view of result.project.views) {
      expect(viewDesignOptionId(view)).toBe(null)
      expect(viewRenovationDisplay(view)).toBe('existing')
    }
    expect(validateProject(result.project).ok).toBe(true)
  })

  it('writes the same bytes a second time, so opening and saving changes nothing', () => {
    const first = migrateProject(v7Project(), 7, counter().allocateId)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const again = migrateProject(structuredClone(first.project), DOMAIN_SCHEMA_VERSION, counter().allocateId)
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(canonicalJson(again.project)).toBe(canonicalJson(first.project))
  })
})

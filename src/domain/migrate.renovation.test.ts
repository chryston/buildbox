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

// v8 exists only in a build with `VITE_FF_RENOVATION=true`, so this file matches the `renovation`
// Vitest project and is excluded from `pure` (`npm run test:renovation`). The flag-off half of the
// story — production stays at v7 and refuses a v8 file as newer — is in `migrate.test.ts`, which
// every build runs.

/** An allocator that fails the test if the migrator reaches for an ID (#42 §3). */
const noIds: IdAllocator = (count) => {
  throw new Error(`migrateV7toV8 spent ${count} ID(s)`)
}

function v7Project(): Record<string, unknown> {
  const envelope = JSON.parse(roomsFixture) as { domainSchemaVersion: number; project: Record<string, unknown> }
  expect(envelope.domainSchemaVersion).toBe(7)
  return structuredClone(envelope.project)
}

describe('migrateV7toV8 — Design Options and the saved-view settings (#69, #70)', () => {
  it('is the one step this build registers above v7', () => {
    expect(DOMAIN_SCHEMA_VERSION).toBe(8)
    expect(MIGRATORS).toHaveLength(7)
  })

  it('adds an empty Design Option collection and the two settings on every view, and nothing else', () => {
    const data = v7Project()
    const before = structuredClone(data)
    const result = migrateV7toV8(data) as Record<string, unknown>
    expect(result.designOptions).toEqual([])
    // Every view now says which Option it looks through and which Display it draws — and both
    // answers are the way the view already behaved (#70 §1).
    expect(result.views).toEqual((before.views as Record<string, unknown>[]).map((view) => ({ ...view, designOptionId: null, renovationDisplay: 'existing' })))
    delete result.designOptions
    for (const view of result.views as Record<string, unknown>[]) {
      delete view.designOptionId
      delete view.renovationDisplay
    }
    expect(result).toEqual(before)
    expect(data).toEqual(before)
  })

  it('spends no IDs', () => {
    expect(() => migrateV7toV8(v7Project())).not.toThrow()
  })

  it('is idempotent, so a file that already carries the collection is carried over untouched', () => {
    const once = migrateV7toV8(v7Project())
    expect(migrateV7toV8(once)).toBe(once)
  })

  it('fills the settings a view is missing without touching the ones it carries', () => {
    const v8 = migrateV7toV8(v7Project()) as Record<string, unknown>
    const views = structuredClone(v8.views) as Record<string, unknown>[]
    // A hand-written v8 file whose second view lost its Display: the step repairs that view and
    // leaves the Option the first view is looking through alone.
    views[0] = { ...views[0]!, designOptionId: 'option-a', renovationDisplay: 'combined' }
    delete views[1]!.renovationDisplay
    const repaired = migrateV7toV8({ ...v8, views }) as Record<string, unknown>
    const after = repaired.views as Record<string, unknown>[]
    expect(after[0]).toEqual({ ...views[0] })
    expect(after[1]).toMatchObject({ renovationDisplay: 'existing' })
    expect(repaired.designOptions).toEqual([])
  })

  it('leaves a value that is not a record alone', () => {
    expect(migrateV7toV8(null)).toBe(null)
    expect(migrateV7toV8([1, 2])).toEqual([1, 2])
    expect(migrateV7toV8('nope')).toBe('nope')
  })
})

describe('the v8 chain end to end (#69, #70)', () => {
  it('reads a v7 Project and hands back a valid one with no Options and Existing views', () => {
    const result = migrateProject(v7Project(), 7, noIds)
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
    const first = migrateProject(v7Project(), 7, noIds)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const again = migrateProject(structuredClone(first.project), DOMAIN_SCHEMA_VERSION, noIds)
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(canonicalJson(again.project)).toBe(canonicalJson(first.project))
  })
})

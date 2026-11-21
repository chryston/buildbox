import { describe, expect, it } from 'vitest'
import { canonicalJson } from '../lib'
import {
  DOMAIN_SCHEMA_VERSION,
  MIGRATORS,
  migrateProject,
  migrateV7toV8,
  validateProject,
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

describe('migrateV7toV8 — the Design Option collection (#69)', () => {
  it('is the one step this build registers above v7', () => {
    expect(DOMAIN_SCHEMA_VERSION).toBe(8)
    expect(MIGRATORS).toHaveLength(7)
  })

  it('adds an empty Design Option collection and nothing else', () => {
    const data = v7Project()
    const before = structuredClone(data)
    const result = migrateV7toV8(data) as Record<string, unknown>
    expect(result.designOptions).toEqual([])
    delete result.designOptions
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

  it('leaves a value that is not a record alone', () => {
    expect(migrateV7toV8(null)).toBe(null)
    expect(migrateV7toV8([1, 2])).toEqual([1, 2])
    expect(migrateV7toV8('nope')).toBe('nope')
  })
})

describe('the v8 chain end to end (#69)', () => {
  it('reads a v7 Project and hands back a valid one with no Options', () => {
    const result = migrateProject(v7Project(), 7, noIds)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.designOptions).toEqual([])
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

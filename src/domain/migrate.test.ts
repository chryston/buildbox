import { describe, expect, it } from 'vitest'
import { DOMAIN_SCHEMA_VERSION, migrateProject, runMigrationChain, type Migrator } from './index'
import type { Project } from './index'

function validProject(): Project {
  return {
    id: 'project-0',
    meta: { name: 'Maple Street Kitchen' },
    preferences: { displayUnit: 'mm', displayPrecision: 0 },
    floors: [{ id: 'floor-0', name: 'Floor 1', planImage: null }],
    itemDesigns: [
      {
        id: 'design-0',
        kind: 'generic',
        name: 'King Bed',
        footprint: { kind: 'rectangle', width: 1820, depth: 1980 },
        origin: { x: 910, y: 990 },
        height: 500,
        heightIsTypical: true,
        color: '#8b5a2b',
      },
    ],
    existingModel: {
      placedItems: [
        {
          id: 'place-0',
          itemDesignId: 'design-0',
          floorId: 'floor-0',
          translation: { x: 0, y: 0 },
          rotationDeg: 0,
          baseElevation: 0,
        },
      ],
    },
  }
}

describe('DOMAIN_SCHEMA_VERSION', () => {
  it('is 1, with nothing to migrate from yet', () => {
    expect(DOMAIN_SCHEMA_VERSION).toBe(1)
  })
})

describe('migrateProject — the envelope version (#14)', () => {
  it('refuses a newer schema before touching the data', () => {
    const result = migrateProject(validProject(), 2)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('newer-schema')
    if (result.error.kind !== 'newer-schema') return
    expect(result.error.found).toBe(2)
    expect(result.error.supported).toBe(1)
    expect(result.error.message).toContain('saved by a newer BuildBox')
  })

  it.each([0, -1, 1.5, '1', '', null, undefined, Number.NaN, true, {}])(
    'refuses a version it cannot read: %s',
    (fromVersion) => {
      const result = migrateProject(validProject(), fromVersion)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.kind).toBe('unknown-schema')
    },
  )

  it('reports a Project that is still invalid after the chain', () => {
    const broken = { ...validProject(), id: '' }
    const result = migrateProject(broken, 1)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('invalid')
    if (result.error.kind !== 'invalid') return
    expect(result.error.problems).toEqual([expect.objectContaining({ path: 'id', code: 'bad-id' })])
  })

  it('carries a v1 Project through an empty chain and says where it came from', () => {
    const project = validProject()
    const result = migrateProject(project, 1)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.migratedFrom).toBe(1)
    expect(result.project).toEqual(project)
    // The chain always works on a copy, so the caller keeps its own value.
    expect(result.project).not.toBe(project)
  })
})

describe('runMigrationChain — the mechanics', () => {
  const log: unknown[] = []

  const step = (label: string): Migrator => (data) => {
    log.push(data)
    return `${String(data)}+${label}`
  }

  it('applies every step in order, each one seeing the previous output', () => {
    log.length = 0
    const chain: Migrator[] = [step('1'), step('2'), step('3')]
    expect(runMigrationChain('start', 1, chain)).toBe('start+1+2+3')
    expect(log).toEqual(['start', 'start+1', 'start+1+2'])
  })

  it('starts at the version the data arrived at', () => {
    log.length = 0
    const chain: Migrator[] = [step('1'), step('2'), step('3')]
    expect(runMigrationChain('start', 3, chain)).toBe('start+3')
    expect(log).toEqual(['start'])
  })

  it('applies nothing once the data is already at the top of the chain', () => {
    log.length = 0
    expect(runMigrationChain('start', 2, [step('1')])).toBe('start')
    expect(log).toEqual([])
  })

  it('never mutates the caller’s value', () => {
    const input = { floors: [{ id: 'floor-0', tags: ['a'] }], note: 'keep me' }
    const untouched = structuredClone(input)
    const chain: Migrator[] = [
      (data) => {
        // A migrator may rewrite what it is handed, because what it is handed is a copy.
        const copy = data as typeof input
        copy.floors[0].tags.push('added')
        copy.note = 'rewritten'
        return copy
      },
    ]
    const result = runMigrationChain(input, 1, chain)
    expect(input).toEqual(untouched)
    expect(result).not.toBe(input)
    expect((result as typeof input).note).toBe('rewritten')
  })
})

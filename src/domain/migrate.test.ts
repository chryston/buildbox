import { describe, expect, it } from 'vitest'
import {
  DOMAIN_SCHEMA_VERSION,
  migrateProject,
  migrateV1toV2,
  runMigrationChain,
  type IdAllocator,
  type Migrator,
  type Project,
} from './index'

/** Sequential IDs, so a test can say which entity the migrator named with which. */
function allocator(prefix = 'view'): IdAllocator {
  let issued = 0
  return (count) => Array.from({ length: count }, () => `${prefix}-${(issued += 1)}`)
}

function validProject(): Project {
  return {
    id: 'project-0',
    meta: { name: 'Maple Street Kitchen' },
    preferences: { displayUnit: 'mm', displayPrecision: 0 },
    floors: [{ id: 'floor-0', name: 'Floor 1', planImage: null }],
    views: [{ id: 'view-0', kind: 'plan', floorId: 'floor-0', name: 'Floor 1', isDefault: true, showPlanImage: true }],
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

/** The same Project as a v1 file: no `views`, no `limits`. */
function v1Project(): Record<string, unknown> {
  const record: Record<string, unknown> = { ...validProject() }
  delete record.views
  return record
}

describe('DOMAIN_SCHEMA_VERSION', () => {
  it('is 2, one step above the version #43 shipped', () => {
    expect(DOMAIN_SCHEMA_VERSION).toBe(2)
  })
})

describe('migrateV1toV2 — one default Plan View per Floor (#56)', () => {
  it('gives every Floor the view that shows it, named after it', () => {
    const data = { ...v1Project(), floors: [{ id: 'floor-a', name: 'Ground', planImage: null }, { id: 'floor-b', name: 'Loft', planImage: null }] }
    const result = migrateV1toV2(data, allocator()) as Project
    expect(result.views).toEqual([
      { id: 'view-1', kind: 'plan', floorId: 'floor-a', name: 'Ground', isDefault: true, showPlanImage: true },
      { id: 'view-2', kind: 'plan', floorId: 'floor-b', name: 'Loft', isDefault: true, showPlanImage: true },
    ])
  })

  it('adds no limits, because a v1 Floor never had any', () => {
    const result = migrateV1toV2(v1Project(), allocator()) as Project
    expect(result.floors[0]).not.toHaveProperty('limits')
  })

  it('changes nothing else about the record', () => {
    const data = v1Project()
    const before = structuredClone(data)
    const migrated: Record<string, unknown> = { ...(migrateV1toV2(data, allocator()) as Project) }
    delete migrated.views
    expect(migrated).toEqual(before)
    expect(data).toEqual(before)
  })

  it('asks the allocator once for one ID per Floor', () => {
    const asked: number[] = []
    const inner = allocator()
    migrateV1toV2({ floors: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }, (count) => {
      asked.push(count)
      return inner(count)
    })
    expect(asked).toEqual([3])
  })

  it('leaves a value that is not a record alone', () => {
    expect(migrateV1toV2(null, allocator())).toBe(null)
    expect(migrateV1toV2([1, 2], allocator())).toEqual([1, 2])
    expect(migrateV1toV2('nope', allocator())).toBe('nope')
  })
})

describe('migrateProject — the envelope version (#14)', () => {
  it('refuses a newer schema before touching the data', () => {
    const result = migrateProject(validProject(), 3, allocator())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('newer-schema')
    if (result.error.kind !== 'newer-schema') return
    expect(result.error.found).toBe(3)
    expect(result.error.supported).toBe(DOMAIN_SCHEMA_VERSION)
    expect(result.error.message).toContain('saved by a newer BuildBox')
  })

  it.each([0, -1, 1.5, '1', '', null, undefined, Number.NaN, true, {}])(
    'refuses a version it cannot read: %s',
    (fromVersion) => {
      const result = migrateProject(validProject(), fromVersion, allocator())
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.kind).toBe('unknown-schema')
    },
  )

  it('reports a Project that is still invalid after the chain', () => {
    const broken = { ...v1Project(), id: '' }
    const result = migrateProject(broken, 1, allocator())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('invalid')
    if (result.error.kind !== 'invalid') return
    expect(result.error.problems).toEqual([expect.objectContaining({ path: 'id', code: 'bad-id' })])
  })

  it('brings a v1 Project up to v2 and says where it came from', () => {
    const data = v1Project()
    const result = migrateProject(data, 1, allocator())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.migratedFrom).toBe(1)
    expect(result.project.views).toEqual([
      { id: 'view-1', kind: 'plan', floorId: 'floor-0', name: 'Floor 1', isDefault: true, showPlanImage: true },
    ])
    expect(data).not.toHaveProperty('views')
  })

  it('carries a v2 Project through an empty chain and says where it came from', () => {
    const project = validProject()
    const result = migrateProject(project, 2, allocator())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.migratedFrom).toBe(2)
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
    expect(runMigrationChain('start', 1, chain, allocator())).toBe('start+1+2+3')
    expect(log).toEqual(['start', 'start+1', 'start+1+2'])
  })

  it('starts at the version the data arrived at', () => {
    log.length = 0
    const chain: Migrator[] = [step('1'), step('2'), step('3')]
    expect(runMigrationChain('start', 3, chain, allocator())).toBe('start+3')
    expect(log).toEqual(['start'])
  })

  it('applies nothing once the data is already at the top of the chain', () => {
    log.length = 0
    expect(runMigrationChain('start', 2, [step('1')], allocator())).toBe('start')
    expect(log).toEqual([])
  })

  it('hands every step the same allocator', () => {
    const seen: number[] = []
    const chain: Migrator[] = [
      (_data, allocateId) => {
        seen.push(allocateId(1).length)
        return _data
      },
      (_data, allocateId) => {
        seen.push(allocateId(2).length)
        return _data
      },
    ]
    runMigrationChain({}, 1, chain, allocator())
    expect(seen).toEqual([1, 2])
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
    const result = runMigrationChain(input, 1, chain, allocator())
    expect(input).toEqual(untouched)
    expect(result).not.toBe(input)
    expect((result as typeof input).note).toBe('rewritten')
  })
})

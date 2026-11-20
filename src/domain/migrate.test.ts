import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WALL_HEIGHT_MM,
  DOMAIN_SCHEMA_VERSION,
  footprintPath,
  footprintSize,
  listPresetEntries,
  migrateProject,
  migrateV1toV2,
  migrateV3toV4,
  rectangleFootprint,
  runMigrationChain,
  type IdAllocator,
  type ItemFootprint,
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
    preferences: { displayUnit: 'mm', displayPrecision: 0, defaultWallHeight: 2600 },
    floors: [{ id: 'floor-0', name: 'Floor 1', planImage: null }],
    views: [{ id: 'view-0', kind: 'plan', floorId: 'floor-0', name: 'Floor 1', isDefault: true, showPlanImage: true }],
    itemDesigns: [
      {
        id: 'design-0',
        kind: 'generic',
        name: 'King Bed',
        footprint: rectangleFootprint(1820, 1980),
        origin: { x: 910, y: 990 },
        height: 500,
        heightIsTypical: true,
        color: '#8b5a2b',
      },
    ],
    existingModel: {
      walls: [],
      wallJunctions: [],
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
  it('is 4, one step above the version #63 shipped', () => {
    expect(DOMAIN_SCHEMA_VERSION).toBe(4)
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
    const result = migrateProject(validProject(), 5, allocator())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('newer-schema')
    if (result.error.kind !== 'newer-schema') return
    expect(result.error.found).toBe(5)
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

  it('carries a v2 Project through to v3, restating every footprint', () => {
    const project = validProject()
    const result = migrateProject(project, 2, allocator())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.migratedFrom).toBe(2)
    // The step is not the identity: a v2 rectangle becomes a Rectangle preset, and the
    // geometry it draws is unchanged. `validProject()` has no Item Designs to rewrite.
    expect(result.project).toEqual(project)
    // The chain always works on a copy, so the caller keeps its own value.
    expect(result.project).not.toBe(project)
  })
})

/** A cabinet Item Design, which has a `construction` payload and no footprint at all. */
const CABINET_DESIGN = {
  id: 'design-cab',
  kind: 'cabinet',
  name: 'Base Cabinet',
  construction: {
    settings: {
      unit: 'mm',
      height: 850,
      width: 600,
      depth: 560,
      thickness: 18,
      backThickness: 6,
      toeKick: { height: 100, setback: 50 },
      material: 'walnut',
    },
    root: {
      id: 'node-root',
      splitAxis: 'horizontal',
      splitRatio: 0.6,
      children: [
        { id: 'node-left', drawerConfig: { slideType: 'undermount', reveal: 20 } },
        { id: 'node-right', locked: true, fixedSize: 300, elementType: 'hanging-space' },
      ],
    },
  },
}

/**
 * A v2 file: two generic Item Designs whose footprints are a bare width and a depth, and a
 * cabinet design, which never had a footprint to restate.
 */
function v2Record(): Record<string, unknown> {
  const project = validProject()
  return {
    ...project,
    itemDesigns: [
      { ...project.itemDesigns[0], footprint: { kind: 'rectangle', width: 1820, depth: 1980 } },
      {
        id: 'design-1',
        kind: 'generic',
        name: 'Pendant',
        footprint: { kind: 'rectangle', width: 320, depth: 320 },
        origin: { x: 160, y: 160 },
        height: 400,
        heightIsTypical: false,
        isCustom: true,
        color: '#222222',
      },
      CABINET_DESIGN,
    ],
  }
}

/** The generic footprint of design `id`, refusing to answer for any other kind of design. */
function footprintOf(project: Project, id: string): ItemFootprint {
  const design = project.itemDesigns.find((candidate) => candidate.id === id)
  if (design === undefined || design.kind !== 'generic') throw new Error(`${id} must be a generic design`)
  return design.footprint
}

describe('migrateV2toV3 — a rectangle becomes a Rectangle preset (#58)', () => {
  it('restates every generic footprint and nothing else', () => {
    const result = migrateProject(v2Record(), 2, allocator())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(footprintOf(result.project, 'design-0')).toEqual({
      kind: 'preset',
      preset: { kind: 'rectangle', width: 1820, depth: 1980 },
      centre: { x: 910, y: 990 },
      orientationDeg: 0,
    })
    expect(footprintOf(result.project, 'design-1')).toEqual({
      kind: 'preset',
      preset: { kind: 'rectangle', width: 320, depth: 320 },
      centre: { x: 160, y: 160 },
      orientationDeg: 0,
    })
    // A cabinet's size comes from its construction, so it has no footprint to restate.
    expect(result.project.itemDesigns[2]).toEqual(CABINET_DESIGN)
  })

  it('draws exactly the outline the v2 record drew', () => {
    const result = migrateProject(v2Record(), 2, allocator())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The old rectangle ran from (0,0) to (width,depth) in the design's local frame. The
    // preset that replaces it is centred on its own middle, so the corners land identically
    // — which is the whole reason a v2 Project still looks like itself after one open.
    expect(footprintPath(footprintOf(result.project, 'design-0'))).toEqual({
      start: { x: 0, y: 0 },
      segments: [
        { kind: 'line', to: { x: 1820, y: 0 } },
        { kind: 'line', to: { x: 1820, y: 1980 } },
        { kind: 'line', to: { x: 0, y: 1980 } },
        { kind: 'line', to: { x: 0, y: 0 } },
      ],
    })
    expect(footprintSize(footprintOf(result.project, 'design-0'))).toEqual({ width: 1820, depth: 1980 })
  })

  it('spends no IDs, because a footprint has never had one', () => {
    const issued: number[] = []
    const allocate: IdAllocator = (count) => {
      issued.push(count)
      return Array.from({ length: count }, (_, index) => `fresh-${String(index)}`)
    }
    const result = migrateProject(v2Record(), 2, allocate)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(issued).toEqual([])
    // Every ID the file arrived with is still the ID it left with.
    expect(result.project.itemDesigns.map((design) => design.id)).toEqual(['design-0', 'design-1', 'design-cab'])
    expect(result.project.existingModel.placedItems.map((item) => item.id)).toEqual(['place-0'])
  })

  it('carries a footprint that is already a v3 shape straight through', () => {
    // Idempotence is what lets a v3 file pass through the chain unchanged: `migrateProject`
    // runs the step for every version below the current one, and a v3 Project has none left.
    const project = validProject()
    const result = migrateProject(project, 3, allocator())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.itemDesigns[0]).toEqual(project.itemDesigns[0])
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

describe('migrateV3toV4 — a Project gains its Walls (#64)', () => {
  /** The same Project as its v3 twin: no default Wall height, no Wall collections. */
  function v3Record(): Record<string, unknown> {
    const project = validProject()
    const preferences: Record<string, unknown> = { ...project.preferences }
    delete preferences.defaultWallHeight
    return { ...project, preferences, existingModel: { placedItems: project.existingModel.placedItems } }
  }

  it('adds the default Wall height and the two empty collections, and spends no IDs', () => {
    const asked: number[] = []
    const result = migrateProject(v3Record(), 3, (count) => {
      asked.push(count)
      return allocator()(count)
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(asked).toEqual([])
    expect(result.project.preferences.defaultWallHeight).toBe(DEFAULT_WALL_HEIGHT_MM)
    expect(result.project.existingModel.walls).toEqual([])
    expect(result.project.existingModel.wallJunctions).toEqual([])

    // Nothing else moved: put the v3 shape back and the Project is the record again.
    const prior = v3Record() as Record<string, unknown>
    expect({ ...result.project, ...prior }).toEqual(prior)
  })

  it('takes the height from the preset pack entry it was read from', () => {
    const ceiling = listPresetEntries('hdb-bto-typical', 'height').find((entry) => entry.id === 'height.ceiling')
    // The migrator's constant is frozen, so this is the check that it still says what the
    // pack says. A pack edit that moves the ceiling height has to move this number too.
    expect(ceiling?.values.height).toBe(DEFAULT_WALL_HEIGHT_MM)
  })

  it('leaves a v4 Project exactly as it found it', () => {
    const migrated = migrateProject(v3Record(), 3, allocator())
    expect(migrated.ok).toBe(true)
    if (!migrated.ok) return
    expect(migrateV3toV4(migrated.project)).toEqual(migrated.project)
  })
})

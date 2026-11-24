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
  migrateV4toV5,
  migrateV9toV10,
  migrateV10toV11,
  migrateV11toV12,
  migrateV13toV14,
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
    views: [{ id: 'view-0', kind: 'plan', floorId: 'floor-0', name: 'Floor 1', isDefault: true, showPlanImage: true, planViewRange: { lowerMm: 0, upperMm: 2600 } }],
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
        clearanceEnvelope: null,
      },
    ],
    existingModel: {
      walls: [],
      wallJunctions: [],
      openings: [],
      rooms: [],
      beams: [],
      skirting: [],
      services: [],
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
    warningAcknowledgements: [],
  }
}

/** The same Project as a v1 file: no `views`, no `limits`. */
function v1Project(): Record<string, unknown> {
  const record: Record<string, unknown> = { ...validProject() }
  delete record.views
  return record
}

/**
 * The additions the chain has to make on the way to this build's schema — the empty Design Option
 * list, the Drawing Layers, the filing of the content on them, the four view fields (#69, #71, #73)
 * and the empty Elevation View list (#75) — taken back out, so a step's own work can be compared with
 * the record it started from.
 *
 * Every record these tests feed in predates v8, so nothing stripped here was ever in the input.
 */
function withoutTheStep(project: unknown): unknown {
  const drop = (value: unknown, ...keys: string[]): unknown => {
    if (typeof value !== 'object' || value === null) return value
    return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)))
  }
  const unfiled = (entries: unknown): unknown =>
    Array.isArray(entries) ? entries.map((entry) => drop(entry, 'drawingLayerId')) : entries
  const record = drop(project, 'designOptions', 'drawingLayers', 'elevationViews') as Record<string, unknown>
  const model = record.existingModel
  const views = record.views
  return {
    ...record,
    ...(typeof model === 'object' && model !== null
      ? { existingModel: Object.fromEntries(Object.entries(model).map(([key, value]) => [key, unfiled(value)])) }
      : {}),
    ...(Array.isArray(views)
      ? {
          views: views.map((view) =>
            drop(view, 'designOptionId', 'renovationDisplay', 'layerSettings', 'layerOrder', 'activeLayerId', 'snapToHiddenContent'),
          ),
        }
      : {}),
  }
}

describe('DOMAIN_SCHEMA_VERSION', () => {
  it('is the version this build writes', () => {
    // v14 is production: the Service shipped, so the number the chain ends at and the number this
    // build writes are the same one (#73, #75, #76, #77, #78, #79).
    expect(DOMAIN_SCHEMA_VERSION).toBe(14)
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
    // One above whatever this build writes, so the step that bumps the schema does not have
    // to remember to bump this test too.
    const newer = DOMAIN_SCHEMA_VERSION + 1
    const result = migrateProject(validProject(), newer, allocator())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('newer-schema')
    if (result.error.kind !== 'newer-schema') return
    expect(result.error.found).toBe(newer)
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
    expect(withoutTheStep({ views: result.project.views })).toEqual({
      views: [{ id: 'view-1', kind: 'plan', floorId: 'floor-0', name: 'Floor 1', isDefault: true, showPlanImage: true, planViewRange: { lowerMm: 0, upperMm: 2600 } }],
    })
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
    expect(withoutTheStep(result.project)).toEqual(project)
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
  const v2Design = { ...project.itemDesigns[0] } as Record<string, unknown>
  delete v2Design.clearanceEnvelope
  return {
    ...project,
    itemDesigns: [
      { ...v2Design, footprint: { kind: 'rectangle', width: 1820, depth: 1980 } },
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
    // A cabinet's size comes from its construction, so it has no footprint to restate. The
    // Clearance Envelope field the eleventh step adds is the only thing beside it (#76).
    expect(result.project.itemDesigns[2]).toEqual({ ...CABINET_DESIGN, clearanceEnvelope: null })
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

  it('spends no IDs of its own, because a footprint has never had one', () => {
    const issued: number[] = []
    const allocate: IdAllocator = (count) => {
      issued.push(count)
      return Array.from({ length: count }, (_, index) => `fresh-${String(index)}`)
    }
    const result = migrateProject(v2Record(), 2, allocate)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The only IDs the chain invents past this step are the three default Drawing Layers (#73).
    expect(issued).toEqual([3])
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

  it('adds the default Wall height and the two empty collections, and spends no IDs of its own', () => {
    const asked: number[] = []
    const result = migrateProject(v3Record(), 3, (count) => {
      asked.push(count)
      return allocator()(count)
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The step under test spends nothing; the only IDs the chain invents past it are the three
    // default Drawing Layers (#73).
    expect(asked).toEqual([3])
    expect(result.project.preferences.defaultWallHeight).toBe(DEFAULT_WALL_HEIGHT_MM)
    expect(result.project.existingModel.walls).toEqual([])
    expect(result.project.existingModel.wallJunctions).toEqual([])

    // Nothing else moved: put the v3 shape back and the Project is the record again.
    const prior = v3Record() as Record<string, unknown>
    expect(withoutTheStep({ ...result.project, ...prior })).toEqual(prior)
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

  it('keeps the Walls, Junctions and chosen height a record already carries', () => {
    // A step that adds a field never overwrites the one it was meant to add. This step used
    // to write `walls: []` unconditionally, so running it on a record that already had Walls
    // — a v4 Project read by a build that ran the chain twice — emptied the Project.
    const already = {
      ...validProject(),
      preferences: { displayUnit: 'mm', displayPrecision: 0, defaultWallHeight: 2800 },
      existingModel: {
        placedItems: [],
        walls: [
          {
            id: 'wall-0',
            ref: 'W-1',
            floorId: 'floor-0',
            line: { kind: 'line', start: { x: 0, y: 0 }, end: { x: 4000, y: 0 } },
            thickness: 100,
            justification: 'centre',
            baseElevation: 0,
            height: 2600,
          },
        ],
        wallJunctions: [{ id: 'junction-0', floorId: 'floor-0', ends: [{ wallId: 'wall-0', end: 'start' }] }],
      },
    }
    expect(migrateV3toV4(already)).toEqual(already)
  })
})

describe('migrateV4toV5 — a Project gains its Openings (#65)', () => {
  /** The same Project as its v4 twin: Walls named, Openings not yet thought of. */
  function v4Record(): Record<string, unknown> {
    const project = validProject()
    const existingModel: Record<string, unknown> = { ...project.existingModel }
    delete existingModel.openings
    return { ...project, existingModel }
  }

  it('adds the empty Opening collection, and spends no IDs of its own', () => {
    const asked: number[] = []
    const result = migrateProject(v4Record(), 4, (count) => {
      asked.push(count)
      return allocator()(count)
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The step under test spends nothing; the only IDs the chain invents past it are the three
    // default Drawing Layers (#73).
    expect(asked).toEqual([3])
    expect(result.project.existingModel.openings).toEqual([])
    // The Walls it already had are the same objects' values: the step adds a collection and
    // touches nothing else, so a v4 Project's Walls come through untouched.
    expect(result.project.existingModel.walls).toEqual(validProject().existingModel.walls)

    const prior = v4Record() as Record<string, unknown>
    expect(withoutTheStep({ ...result.project, ...prior })).toEqual(prior)
  })

  it('leaves a v5 Project exactly as it found it', () => {
    const migrated = migrateProject(v4Record(), 4, allocator())
    expect(migrated.ok).toBe(true)
    if (!migrated.ok) return
    expect(migrateV4toV5(migrated.project)).toEqual(migrated.project)
  })

  it('keeps the Openings a record already carries', () => {
    // A migrator that overwrote a collection it was only meant to add would silently delete
    // somebody's doors here.
    const carried: Project = {
      ...validProject(),
      existingModel: {
        ...validProject().existingModel,
        openings: [
          {
            id: 'opening-1',
            floorId: 'floor-1',
            hostWallId: 'wall-1',
            kind: 'door',
            label: 'Door 1',
            start: 200,
            width: 900,
            sill: 0,
            head: 2100,
            swing: 'left',
            hingeSide: 'start',
          },
        ],
      },
    }
    expect(migrateV4toV5(carried)).toEqual(carried)
  })
})

describe('migrateV6toV7 — a Project gains its Rooms (#67)', () => {
  /** The same Project as its v6 twin: Openings named, Rooms not yet thought of. */
  function v6Record(): Record<string, unknown> {
    const project = validProject()
    const existingModel: Record<string, unknown> = { ...project.existingModel }
    delete existingModel.rooms
    return { ...project, existingModel }
  }

  it('adds the empty Room collection, and spends no IDs of its own', () => {
    const asked: number[] = []
    const result = migrateProject(v6Record(), 6, (count) => {
      asked.push(count)
      return allocator()(count)
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The step under test spends nothing; the only IDs the chain invents past it are the three
    // default Drawing Layers (#73).
    expect(asked).toEqual([3])
    expect(result.project.existingModel.rooms).toEqual([])
    // The Openings it already had are the same objects' values: the step adds a collection and
    // touches nothing else, so a v6 Project's doors come through untouched.
    expect(result.project.existingModel.openings).toEqual(validProject().existingModel.openings)

    const prior = v6Record() as Record<string, unknown>
    expect(withoutTheStep({ ...result.project, ...prior })).toEqual(prior)
  })

  it('leaves a v7 Project exactly as it found it', () => {
    const migrated = migrateProject(v6Record(), 6, allocator())
    expect(migrated.ok).toBe(true)
    if (!migrated.ok) return
    expect(migrateProject(migrated.project, 6, allocator()).ok).toBe(true)
    const again = migrateProject(migrated.project, 6, allocator())
    expect(again.ok && again.project).toEqual(migrated.project)
  })

  it('keeps the Rooms a record already carries', () => {
    // A migrator that overwrote the collection it was only meant to add would silently delete
    // somebody's Rooms here.
    const carried: Project = {
      ...validProject(),
      existingModel: {
        ...validProject().existingModel,
        rooms: [
          {
            id: 'room-1',
            floorId: 'floor-0',
            name: 'Bedroom',
            outline: {
              kind: 'preset',
              preset: { kind: 'rectangle', width: 3000, depth: 4000 },
              centre: { x: 1500, y: -2000 },
              orientationDeg: 0,
              segmentIds: ['edge-1', 'edge-2', 'edge-3', 'edge-4'],
            },
            wallFaceRefs: [],
          },
        ],
      },
    }
    const result = migrateProject(carried, 6, allocator())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(withoutTheStep(result.project)).toEqual(carried)
  })

  it('adds Rooms to a record whose Existing Model is not a record at all, without crashing', () => {
    // Migrators run before the validator, so they see whatever a damaged file held.
    expect(migrateProject({ existingModel: null }, 6, allocator()).ok).toBe(false)
    expect(migrateProject({}, 6, allocator()).ok).toBe(false)
  })
})

describe('migrateV9toV10 — a Project gains its Elevation Views (#75)', () => {
  /** The same Project as its v9 twin: Plan Views named, no sideways view thought of yet. */
  function v9Record(): Record<string, unknown> {
    const record: Record<string, unknown> = { ...validProject() }
    delete record.elevationViews
    return record
  }

  it('adds the empty Elevation View list, and spends no IDs of its own', () => {
    const asked: number[] = []
    const result = migrateProject(v9Record(), 9, (count) => {
      asked.push(count)
      return allocator()(count)
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Nothing past v9 invents an ID: an Elevation View is always one the user made, so the field
    // arrives empty and stays empty until a transaction writes one.
    expect(asked).toEqual([])
    expect(result.project.elevationViews).toEqual([])
    const prior = v9Record() as Record<string, unknown>
    expect(withoutTheStep({ ...result.project, ...prior })).toEqual(prior)
  })

  it('leaves a v10 Project exactly as it found it', () => {
    const migrated = migrateProject(v9Record(), 9, allocator())
    expect(migrated.ok).toBe(true)
    if (!migrated.ok) return
    const again = migrateProject(migrated.project, 9, allocator())
    expect(again.ok && again.project).toEqual(migrated.project)
  })

  it('keeps the Elevation Views a record already carries', () => {
    // A migrator that overwrote the list it was only meant to add would silently delete somebody's
    // Elevation Views — the one thing this step could get wrong.
    const carried: Project = {
      ...validProject(),
      elevationViews: [
        {
          id: 'elev-1',
          kind: 'elevation',
          floorId: 'floor-0',
          name: 'Kitchen elevation',
          line: { start: { x: 0, y: 1400 }, end: { x: 4000, y: 1400 } },
          side: 'left',
          depth: 2000,
        },
      ],
    }
    const result = migrateProject(carried, 9, allocator())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project).toEqual(carried)
  })

  it('hands back the record itself when the field is already there', () => {
    // Identity, not equality: the step copies nothing when there is nothing to add, so a Project that
    // has already been through it costs nothing to run through it again.
    const carried = { elevationViews: [] }
    expect(migrateV9toV10(carried)).toBe(carried)
    expect(migrateV9toV10({})).toEqual({ elevationViews: [] })
  })

  it('adds the field to a record that is not a Project shape, without crashing', () => {
    // Migrators run before the validator, so they see whatever a damaged file held.
    expect(migrateProject({}, 9, allocator()).ok).toBe(false)
    expect(migrateV9toV10(null)).toBeNull()
    expect(migrateV9toV10([{ id: 'elev-1' }])).toEqual([{ id: 'elev-1' }])
  })
})

describe('migrateV10toV11 — every Item Design gains its Clearance Envelope field (#76)', () => {
  /** The same Project as its v10 twin: designs written before the envelope existed. */
  function v10Record(): Record<string, unknown> {
    const record: Record<string, unknown> = { ...validProject() }
    const designs = record.itemDesigns as Record<string, unknown>[]
    const design = { ...designs[0] }
    delete design.clearanceEnvelope
    record.itemDesigns = [design]
    return record
  }

  it('adds the null field to every design, and spends no IDs of its own', () => {
    const asked: number[] = []
    const result = migrateProject(v10Record(), 10, (count) => {
      asked.push(count)
      return allocator()(count)
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Nothing past v10 invents an ID: an envelope is always one a person drew, so the field
    // arrives null and stays null until a transaction writes a shape into it.
    expect(asked).toEqual([])
    expect(result.project.itemDesigns.map((design) => design.clearanceEnvelope)).toEqual([null])
  })

  it('changes nothing else about any record', () => {
    const prior = v10Record()
    const result = migrateProject(prior, 10, allocator())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The step adds one field to each design and touches nothing beside it: no placement moves,
    // no warning reopens, because no measurement changed (#76 acceptance 16).
    const rest = { ...(result.project as unknown as Record<string, unknown>) }
    const priorRest = { ...prior }
    delete rest.itemDesigns
    delete priorRest.itemDesigns
    expect(rest).toEqual(priorRest)
  })

  it('leaves a v11 Project exactly as it found it', () => {
    const migrated = migrateProject(v10Record(), 10, allocator())
    expect(migrated.ok).toBe(true)
    if (!migrated.ok) return
    const again = migrateProject(migrated.project, 10, allocator())
    expect(again.ok && again.project).toEqual(migrated.project)
  })

  it('keeps the envelope a design already carries', () => {
    // A migrator that overwrote the field it was only meant to add would silently delete
    // somebody's envelope — the one thing this step could get wrong.
    const carried = {
      itemDesigns: [
        { id: 'design-0', kind: 'generic', clearanceEnvelope: { path: { segments: [] }, bottomOffset: 0, height: 100 } },
      ],
    }
    expect(migrateV10toV11(carried)).toBe(carried)
  })

  it('hands back the record itself when every design already has the field', () => {
    // Identity, not equality: the step copies nothing when there is nothing to add.
    const carried = { itemDesigns: [{ id: 'a', clearanceEnvelope: null }, { id: 'b', clearanceEnvelope: null }] }
    expect(migrateV10toV11(carried)).toBe(carried)
  })

  it('adds the field to a record that is not a Project shape, without crashing', () => {
    expect(migrateV10toV11(null)).toBeNull()
    expect(migrateV10toV11([{ id: 'design-0' }])).toEqual([{ id: 'design-0' }])
    const empty = { itemDesigns: [] }
    expect(migrateV10toV11(empty)).toBe(empty)
  })
})

describe('migrateV11toV12 — both containers gain the Beam collection (#77)', () => {
  /** The same Project as its v11 twin: models written before the Beam existed. */
  function v11Record(): Record<string, unknown> {
    const record: Record<string, unknown> = { ...validProject() }
    const model = { ...(record.existingModel as Record<string, unknown>) }
    delete model.beams
    record.existingModel = model
    const options = record.designOptions as Record<string, unknown>[] | undefined
    if (options !== undefined) {
      record.designOptions = options.map((option) => {
        const proposed = { ...(option.proposed as Record<string, unknown>) }
        delete proposed.beams
        return { ...option, proposed }
      })
    }
    return record
  }

  it('adds the empty collection to both containers, and spends no IDs of its own', () => {
    const asked: number[] = []
    const result = migrateProject(v11Record(), 11, (count) => {
      asked.push(count)
      return allocator()(count)
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Nothing past v11 invents an ID: a Beam is always one a person drew over something they
    // measured, so the collection arrives empty and stays empty until a transaction fills it.
    expect(asked).toEqual([])
    expect(result.project.existingModel.beams).toEqual([])
  })

  it('adds the collection to every Design Option as well', () => {
    const withOptions = v11Record()
    withOptions.designOptions = [
      { id: 'option-a', name: 'Option A', proposed: { walls: [], wallJunctions: [], openings: [], rooms: [], placedItems: [] }, demolishedIds: [] },
      { id: 'option-b', name: 'Option B', proposed: { walls: [], wallJunctions: [], openings: [], rooms: [], placedItems: [] }, demolishedIds: [] },
    ]
    const result = migrateProject(withOptions, 11, allocator())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.designOptions?.map((option) => option.proposed.beams)).toEqual([[], []])
  })

  it('changes nothing else about any record', () => {
    const prior = v11Record()
    const result = migrateProject(prior, 11, allocator())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The step adds one collection to each container and touches nothing beside it: no entity moves,
    // no warning reopens, because no measurement changed (#77 acceptance 15).
    const rest = { ...(result.project as unknown as Record<string, unknown>) }
    const priorRest = { ...prior }
    rest.existingModel = { ...(rest.existingModel as Record<string, unknown>) }
    delete (rest.existingModel as Record<string, unknown>).beams
    delete rest.designOptions
    delete priorRest.designOptions
    expect(rest).toEqual(priorRest)
  })

  it('leaves a v12 Project exactly as it found it', () => {
    const migrated = migrateProject(v11Record(), 11, allocator())
    expect(migrated.ok).toBe(true)
    if (!migrated.ok) return
    const again = migrateProject(migrated.project, 11, allocator())
    expect(again.ok && again.project).toEqual(migrated.project)
  })

  it('keeps the Beams a model already carries', () => {
    // A migrator that overwrote the collection it was only meant to add would silently delete
    // somebody's Beams — the one thing this step could get wrong.
    const carried = {
      existingModel: { beams: [{ id: 'beam-1', floorId: 'floor-0' }] },
      designOptions: [{ id: 'option-a', proposed: { beams: [{ id: 'beam-2', floorId: 'floor-0' }] } }],
    }
    expect(migrateV11toV12(carried)).toBe(carried)
  })

  it('hands back the record itself when every container already has the collection', () => {
    // Identity, not equality: the step copies nothing when there is nothing to add.
    const carried = { existingModel: { beams: [] }, designOptions: [{ id: 'a', proposed: { beams: [] } }] }
    expect(migrateV11toV12(carried)).toBe(carried)
  })

  it('adds the collection to a record that is not a Project shape, without crashing', () => {
    expect(migrateV11toV12(null)).toBeNull()
    expect(migrateV11toV12([{ existingModel: {} }])).toEqual([{ existingModel: {} }])
    // A record whose `designOptions` is not a list gets the Existing Model's collection and leaves
    // the value it cannot read exactly as it found it.
    expect(migrateV11toV12({ designOptions: 'not a list' })).toEqual({ designOptions: 'not a list', existingModel: { beams: [] } })
  })
})

describe('migrateV13toV14 — both containers gain the Service collection (#79)', () => {
  /** The same Project as its v13 twin: models written before a Service existed. */
  function v13Record(): Record<string, unknown> {
    const record: Record<string, unknown> = { ...validProject() }
    const model = { ...(record.existingModel as Record<string, unknown>) }
    delete model.services
    record.existingModel = model
    const options = record.designOptions as Record<string, unknown>[] | undefined
    if (options !== undefined) {
      record.designOptions = options.map((option) => {
        const proposed = { ...(option.proposed as Record<string, unknown>) }
        delete proposed.services
        return { ...option, proposed }
      })
    }
    return record
  }

  it('adds the empty collection to both containers, and spends no IDs of its own', () => {
    const asked: number[] = []
    const result = migrateProject(v13Record(), 13, (count) => {
      asked.push(count)
      return allocator()(count)
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Nothing past v13 invents an ID: no legacy service data exists (#20 §7), and a pipe nobody
    // documented is not a record of a pipe, so the collection arrives empty.
    expect(asked).toEqual([])
    expect(result.project.existingModel.services).toEqual([])
  })

  it('adds the collection to every Design Option as well', () => {
    const withOptions = v13Record()
    withOptions.designOptions = [
      { id: 'option-a', name: 'Option A', proposed: { walls: [], wallJunctions: [], openings: [], rooms: [], placedItems: [] }, demolishedIds: [] },
      { id: 'option-b', name: 'Option B', proposed: { walls: [], wallJunctions: [], openings: [], rooms: [], placedItems: [] }, demolishedIds: [] },
    ]
    const result = migrateProject(withOptions, 13, allocator())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.designOptions?.map((option) => option.proposed.services)).toEqual([[], []])
  })

  it('changes nothing else about any record', () => {
    const prior = v13Record()
    const result = migrateProject(prior, 13, allocator())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // One collection per container and nothing beside it: no entity moves and no warning reopens,
    // because no measurement changed (#79 acceptance 13).
    const rest = { ...(result.project as unknown as Record<string, unknown>) }
    const priorRest = { ...prior }
    rest.existingModel = { ...(rest.existingModel as Record<string, unknown>) }
    delete (rest.existingModel as Record<string, unknown>).services
    delete rest.designOptions
    delete priorRest.designOptions
    expect(rest).toEqual(priorRest)
  })

  it('leaves a v14 Project exactly as it found it', () => {
    const migrated = migrateProject(v13Record(), 13, allocator())
    expect(migrated.ok).toBe(true)
    if (!migrated.ok) return
    const again = migrateProject(migrated.project, 14, allocator())
    expect(again.ok && again.project).toEqual(migrated.project)
  })

  it('keeps the Services a model already carries', () => {
    // A migrator that overwrote the collection it was only meant to add would silently delete
    // somebody's Services — the one thing this step could get wrong.
    const carried = {
      existingModel: { services: [{ id: 'service-1', floorId: 'floor-0' }] },
      designOptions: [{ id: 'option-a', proposed: { services: [{ id: 'service-2', floorId: 'floor-0' }] } }],
    }
    expect(migrateV13toV14(carried)).toBe(carried)
  })

  it('hands back the record itself when every container already has the collection', () => {
    // Identity, not equality: the step copies nothing when there is nothing to add.
    const carried = { existingModel: { services: [] }, designOptions: [{ id: 'a', proposed: { services: [] } }] }
    expect(migrateV13toV14(carried)).toBe(carried)
  })

  it('adds the collection to a record that is not a Project shape, without crashing', () => {
    expect(migrateV13toV14(null)).toBeNull()
    expect(migrateV13toV14([{ existingModel: {} }])).toEqual([{ existingModel: {} }])
    expect(migrateV13toV14({ designOptions: 'not a list' })).toEqual({ designOptions: 'not a list', existingModel: { services: [] } })
  })
})

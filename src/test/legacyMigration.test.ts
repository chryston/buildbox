/**
 * Every legacy fixture goes through the Migration review and comes back the same (#52 §1.1,
 * criteria 13 and 15).
 *
 * Two promises, told over the whole golden corpus rather than over one hand-authored source.
 *
 * The first is that a migration repairs nothing. The reader is allowed exactly one automatic
 * fix — regenerating an ID the legacy source used twice, because a Project cannot hold two of
 * them — and every other problem has to reach the reader as words instead of being quietly
 * corrected. So each regeneration is checked back against the bytes it came from, and each
 * Project that reached the store is compared byte for byte with the Project the converter
 * produced. Anything the migration improved on its own initiative would show up here as a
 * difference, and there are none.
 *
 * The second is #43's parity, run again on the far side of the round trip. `parity.test.ts`
 * proves the converter is exact; that proves nothing about storage, which is where a Project is
 * actually kept. So the same three comparisons — scene layout at 0.01 mm, Cut List at 0.001 mm,
 * floor-plan corners at 0.01 mm — are repeated against Projects read back out of the store, not
 * against the objects the converter handed over in memory. A Project that survives JSON
 * round-tripping and still draws the same cabinet is the thing that was promised.
 *
 * The comparison helpers are copied from `src/package/legacy/parity.test.ts` rather than shared,
 * because that file is frozen and a shared test helper would let a later edit to one silently
 * move the other.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { computeCutListForUnits, computeSceneLayout, type CabinetSceneUnit, type CutListEntry, type SceneLayout } from '../cabinet'
import { cabinetSceneUnits } from '../derive'
import { referencedAssetHashes, type CabinetNode, type Project } from '../domain'
import { canonicalJson, sha256Hex } from '../lib'
import { createMemoryAdapter, type Ports } from '../persistence'
import {
  convertLegacy,
  migrateLegacyState,
  upgradeLegacyDesign,
  type LegacyCabinetNode,
  type IdRegeneration,
  type LegacyDesign,
  type LegacyFloorPlanObject,
} from '../package'
import {
  buildMigrationPlan,
  inspectMigration,
  createSessionRegistry,
  legacyFileKind,
  runMigration,
  sourceHash,
  type FloorPlanDestination,
  type InspectedMigration,
  type IdSource,
  type MigrationDeps,
  type MigrationSource,
} from '../session'
import { createFakeClock, idSource } from '../session/testing'

const fixturesRoot = fileURLToPath(new URL('../../fixtures/legacy', import.meta.url))
const read = (rel: string): string => readFileSync(join(fixturesRoot, rel), 'utf8')
const listed = (dir: string, suffix: string): string[] =>
  readdirSync(join(fixturesRoot, dir)).filter((name) => name.endsWith(suffix)).sort().map((name) => `${dir}/${name}`)

const STORE_FIXTURES = [
  'v0/buildbox-store.json',
  'v1/buildbox-store.json',
  'v2/buildbox-store.json',
  'v3/buildbox-store.json',
  'v3-large-image/buildbox-store.json',
  'migration-review/buildbox-store.json',
  'sketches/buildbox-store.json',
]

/** Sources holding cabinets, in the vocabulary `computeSceneLayout` speaks. */
const CABINET_FIXTURES = [...STORE_FIXTURES, ...listed('workspace', '.buildbox.json')]
/** Sources holding floor-plan objects. */
const PLAN_FIXTURES = [...STORE_FIXTURES, ...listed('floor-plan', '.json'), 'edge-cases/floor-plan-sketches.json']
/** Sources the reader is expected to refuse, wholly or in part. */
const EDGE_CASES = listed('edge-cases', '.json')

const ALL_FIXTURES = [...new Set([...CABINET_FIXTURES, ...PLAN_FIXTURES, ...EDGE_CASES])]

const allocator = (): (() => string) => {
  let issued = 0
  return () => `gen-${++issued}`
}

/**
 * The same sequence as `allocator()`, in the shape `MigrationDeps` asks for.
 *
 * The v0→v1 migrator invents unit IDs from this sequence, and `parity.test.ts` compares the two
 * sides by ID. A migration that issued its own IDs would still be correct — and would compare
 * against a legacy side that had never existed.
 */
const sequencedIds = (): IdSource => {
  const next = allocator()
  return (count = 1) => Array.from({ length: count }, next)
}

function unwrap<T>(value: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!value.ok) throw new Error(`unexpected failure: ${JSON.stringify(value.error)}`)
  return value.value
}

// --- The legacy side, read the way #43 read it --------------------------------

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/** The Designs as v3 sees them, migrated with a fresh allocator, as `parity.test.ts` does. */
function legacyDesigns(rel: string): LegacyDesign[] {
  const source = record(JSON.parse(read(rel)))
  if (source === null) throw new Error(`${rel}: not an object`)
  if (Array.isArray(source.projects)) {
    return source.projects.map((design) => upgradeLegacyDesign(design, allocator())) as LegacyDesign[]
  }
  const state = record(source.state)
  if (state === null || !Array.isArray(state.projects)) return []
  const version = typeof source.version === 'number' ? source.version : 3
  const migrated = record(migrateLegacyState(state, version, allocator()))
  const projects = migrated === null || !Array.isArray(migrated.projects) ? [] : migrated.projects
  return projects as LegacyDesign[]
}

function legacyObjects(rel: string): LegacyFloorPlanObject[] {
  const source = record(JSON.parse(read(rel)))
  if (source === null) throw new Error(`${rel}: not an object`)
  if (Array.isArray(source.objects)) return source.objects as LegacyFloorPlanObject[]
  const state = record(source.state)
  const plan = state === null ? null : record(state.floorPlan)
  const objects = plan === null || !Array.isArray(plan.objects) ? [] : plan.objects
  return objects as LegacyFloorPlanObject[]
}

/**
 * Every `id` the source states, as a multiset.
 *
 * Criterion 13 says the reader regenerates an ID and nothing else, and the only ID it may
 * regenerate is one the source used twice. Counting the ID's occurrences in the bytes the
 * reader was given is what "used twice" means, stated without reference to the reader's own
 * report.
 */
function idCounts(rel: string): Map<string, number> {
  const counts = new Map<string, number>()
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const each of value) walk(each)
      return
    }
    const object = record(value)
    if (object === null) return
    for (const [key, child] of Object.entries(object)) {
      if (key === 'id' && typeof child === 'string') counts.set(child, (counts.get(child) ?? 0) + 1)
      else walk(child)
    }
  }
  walk(JSON.parse(read(rel)))
  return counts
}

/** The retired node-level `material`, dropped from the legacy tree, as #43 does. */
function withoutMaterial(node: LegacyCabinetNode): CabinetNode {
  const { material, children, ...rest } = node
  void material
  return {
    ...rest,
    ...(children === undefined ? {} : { children: children.map((child) => withoutMaterial(child)) }),
  } as CabinetNode
}

// --- Comparing at a stated tolerance ------------------------------------------

type Row = [key: string, ...values: number[]]

const LAYOUT_TOLERANCE = 0.01
const CUT_TOLERANCE = 0.001

function expectRows(actual: Row[], expected: Row[], tolerance: number): void {
  expect(actual.map((row) => row[0])).toEqual(expected.map((row) => row[0]))
  for (const [index, row] of expected.entries()) {
    const other = actual[index]
    if (other === undefined) throw new Error(`missing row ${row[0]}`)
    for (let at = 1; at < row.length; at += 1) {
      const want = row[at] as number
      const got = other[at] as number
      expect(Math.abs(got - want) <= tolerance, `${row[0]} value ${at}: ${got} vs ${want}`).toBe(true)
    }
  }
}

function sceneRows(layout: SceneLayout): Row[] {
  return layout.units.flatMap((unit): Row[] => [
    [`unit ${unit.unitId}`, unit.x, unit.y, unit.w, unit.h],
    ...unit.panels.map((panel): Row => [`panel ${panel.id} ${panel.role}`, panel.x, panel.y, panel.w, panel.h]),
    ...unit.voids.map((space): Row => [`void ${space.nodeId} ${space.elementType}`, space.x, space.y, space.w, space.h]),
    ...unit.dividers.map((divider): Row => [`divider ${divider.nodeId}`, divider.x, divider.y, divider.w, divider.h]),
  ])
}

function cutRows(entries: CutListEntry[]): Row[] {
  return entries
    .map((entry): Row => [
      [entry.unitId, entry.unitLabel, entry.label, entry.material, entry.qty, entry.notes ?? ''].join('|'),
      ...[entry.width, entry.height, entry.depth].sort((a, b) => a - b),
    ])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
}

function rotate(dx: number, dy: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180
  return [dx * Math.cos(rad) - dy * Math.sin(rad), dx * Math.sin(rad) + dy * Math.cos(rad)]
}

function corners(x: number, y: number, w: number, h: number, deg: number): Row[] {
  const cx = x + w / 2
  const cy = y + h / 2
  return [[0, 0], [w, 0], [w, h], [0, h]].map(([dx, dy], index): Row => {
    const [rx, ry] = rotate(dx - w / 2, dy - h / 2, deg)
    return [`corner ${index}`, cx + rx, cy + ry]
  })
}

const sorted = (rows: Row[]): Row[] => [...rows].sort((a, b) => (a[0] < b[0] ? -1 : 1))

// --- Running a fixture through the review -------------------------------------

/** A fixture migrated into a store of its own, with everything the tests need to check. */
interface Migrated {
  ports: Ports
  source: MigrationSource
  inspected: InspectedMigration
  written: Array<{ id: string; project: Project }>
}

async function migrate(rel: string): Promise<Migrated | null> {
  const raw = read(rel)
  const kind = legacyFileKind(raw)
  if (kind === null) return null
  const ports = createMemoryAdapter()
  const deps: MigrationDeps = {
    ports,
    clock: createFakeClock(),
    ids: sequencedIds(),
    registry: createSessionRegistry(),
    convert: (value, options) => convertLegacy(value, options),
  }
  const source: MigrationSource = { kind, raw, hash: await sourceHash(raw) }
  const inspected = await inspectMigration(deps, source, [])
  if (!inspected.ok) return null

  // The floor plan stands up its own Project wherever there is one to place: this suite asks
  // what came back, not what the reader chose.
  const floorPlan: FloorPlanDestination | null =
    inspected.value.review.floorPlan === null || !inspected.value.review.floorPlan.usable
      ? null
      : inspected.value.review.floorPlan.isEmpty
        ? { kind: 'skip' }
        : { kind: 'separate' }
  const built = buildMigrationPlan(deps, inspected.value, [], { floorPlan, collisions: {} }, null)
  if (!built.ok) throw new Error(`${rel}: ${JSON.stringify(built.error)}`)

  const run = await runMigration(deps, inspected.value, built.value)
  if (!run.ok) throw new Error(`${rel}: ${JSON.stringify(run.error)}`)

  const written: Array<{ id: string; project: Project }> = []
  for (const entry of built.value.projects) {
    written.push({ id: entry.id, project: unwrap(await ports.projects.load(entry.id)).data })
  }
  return { ports, source, inspected: inspected.value, written }
}

/** Fixtures that convert at all; the rest are covered by the refusal test. */
const migratable = ALL_FIXTURES.filter((rel) => legacyFileKind(read(rel)) !== null)

describe.each(migratable)('migration: %s', (rel) => {
  it('writes each Project byte for byte and reads it back byte for byte (#52 criteria 9, 15)', async () => {
    const migrated = await migrate(rel)
    if (migrated === null) throw new Error(`${rel}: nothing to migrate`)

    expect(migrated.written.length).toBeGreaterThan(0)
    for (const { id, project } of migrated.written) {
      const stored = unwrap(await migrated.ports.projects.load(id))
      expect(canonicalJson(stored.data)).toBe(canonicalJson(project))
      expect(stored.revision).toBe(1)

      // Every image the Project names is in the store, and its bytes hash to the name.
      for (const hash of referencedAssetHashes(project)) {
        const asset = unwrap(await migrated.ports.assets.get(hash))
        expect(await sha256Hex(await asset.blob.arrayBuffer())).toBe(hash)
      }
    }

    const record = unwrap(await migrated.ports.meta.get('legacyMigration'))
    expect(record?.sourceHash).toBe(migrated.source.hash)
    expect(record?.projectIds).toEqual(migrated.written.map((each) => each.id))
  })

  it('repairs nothing the reader was not allowed to repair (#52 criterion 13)', async () => {
    const migrated = await migrate(rel)
    if (migrated === null) throw new Error(`${rel}: nothing to migrate`)

    const counts = idCounts(rel)
    const regenerations: IdRegeneration[] = [
      ...migrated.inspected.review.proposals.flatMap((proposal) => proposal.regeneratedIds),
      ...(migrated.inspected.review.floorPlan?.regeneratedIds ?? []),
    ]
    for (const regeneration of regenerations) {
      expect(
        counts.get(regeneration.oldId) ?? 0,
        `${regeneration.oldId} was regenerated but the source used it once`,
      ).toBeGreaterThanOrEqual(2)
    }

    // The Project that reached the store is the Project the converter produced. Anything the
    // migration "improved" on its own initiative would show up here as a difference.
    for (const proposal of migrated.inspected.review.proposals) {
      if (!proposal.migratable) continue
      const written = migrated.written.find((each) => each.id === proposal.designId)
      expect(written, `${proposal.designId} was not written`).toBeDefined()
      expect(canonicalJson(written?.project)).toBe(canonicalJson(proposal.project))
    }
  })
})

describe.each(EDGE_CASES)('refusal: %s', (rel) => {
  it('reports the problem instead of correcting it (#52 criteria 12, 13, 14)', async () => {
    const raw = read(rel)
    const ports = createMemoryAdapter()
    const deps: MigrationDeps = {
      ports,
      clock: createFakeClock(),
      ids: idSource(`refusal-${rel}`),
      registry: createSessionRegistry(),
      convert: (value, options) => convertLegacy(value, options),
    }
    const source: MigrationSource = { kind: 'workspace-file', raw, hash: await sourceHash(raw) }
    const inspected = await inspectMigration(deps, source, [])

    if (inspected.ok) {
      // Accepted at the source, so something has to have reached the reader: a refused row, a
      // refused floor plan, a regenerated ID, or a count of sketches that will not be copied.
      // Anything else means the reader fixed the file on the way past without saying so.
      const refused = inspected.value.review.proposals.filter((proposal) => !proposal.migratable)
      const plan = inspected.value.review.floorPlan
      const regenerated =
        inspected.value.review.proposals.reduce((total, each) => total + each.regeneratedIds.length, 0) +
        (plan?.regeneratedIds.length ?? 0)
      const discarded = inspected.value.review.discarded.wallHack + inspected.value.review.discarded.tileZone
      const noticed = refused.length > 0 || (plan !== null && !plan.usable) || regenerated > 0 || discarded > 0
      expect(noticed, `${rel}: accepted with nothing reported`).toBe(true)
      for (const proposal of refused) {
        expect(proposal.problems.length).toBeGreaterThan(0)
        for (const problem of proposal.problems) expect(problem).not.toContain('projects[')
      }
    } else {
      expect(inspected.error.problems.length).toBeGreaterThan(0)
      expect(inspected.error.problems.join(' ')).not.toMatch(/at\s+\S+\.ts/)
    }

    // Either way, looking changed nothing.
    expect((unwrap(await ports.projects.list({ includeTrashed: true }))).map((each) => each.id)).toEqual([])
    expect(await ports.meta.get('legacyMigration')).toEqual({ ok: true, value: undefined })
  })
})

// --- #43's parity, run again on the far side of the round trip ----------------

const cabinetCases = CABINET_FIXTURES.flatMap((fixture) =>
  legacyDesigns(fixture).map((design) => ({ fixture, designId: design.id, design })))

describe.each(cabinetCases)('read-back cabinet parity: $fixture / $designId', ({ fixture, design }) => {
  it('still reproduces the scene layout and the Cut List from the stored Project (#52 criterion 15)', async () => {
    const migrated = await migrate(fixture)
    const written = migrated?.written.find((each) => each.id === design.id)
    if (written === undefined) return // refused by the review; `refusal` and criterion 12 cover it

    const project = written.project
    const [floor] = project.floors
    if (floor === undefined) throw new Error(`${fixture}: expected a Floor`)

    const legacyUnits: CabinetSceneUnit[] = design.units
    const units = cabinetSceneUnits(project, floor.id)

    expect(units.map((unit) => unit.id)).toEqual(legacyUnits.map((unit) => unit.id))
    expect(units.map((unit) => unit.label)).toEqual(legacyUnits.map((unit) => unit.label))
    expectRows(
      units.map((unit): Row => [`unit ${unit.id}`, unit.x, unit.y]),
      legacyUnits.map((unit): Row => [`unit ${unit.id}`, unit.x, unit.y]),
      LAYOUT_TOLERANCE,
    )
    units.forEach((unit, index) => {
      const legacy = legacyUnits[index]
      if (legacy === undefined) throw new Error(`${fixture}: missing unit ${unit.id}`)
      expect(unit.settings).toEqual(legacy.settings)
      expect(unit.root).toEqual(withoutMaterial(legacy.root))
    })

    const legacyLayout = computeSceneLayout(legacyUnits, null)
    const layout = computeSceneLayout(units, null)
    expectRows(sceneRows(layout), sceneRows(legacyLayout), LAYOUT_TOLERANCE)
    expect(layout.units.map((unit) => unit.overConstrainedIds))
      .toEqual(legacyLayout.units.map((unit) => unit.overConstrainedIds))

    expectRows(
      cutRows(computeCutListForUnits(units)),
      cutRows(computeCutListForUnits(legacyUnits)),
      CUT_TOLERANCE,
    )
  })
})

describe.each(PLAN_FIXTURES)('read-back floor-plan parity: %s', (fixture) => {
  it('still reproduces every object rectangle from the stored Project (#52 criterion 15)', async () => {
    const objects = legacyObjects(fixture)
    if (objects.length === 0) return
    const migrated = await migrate(fixture)
    if (migrated === null) return

    // The floor plan is either its own Project or attached to one, so the Placed Items to
    // compare are every Project the migration wrote. Sketch types with no domain equivalent are
    // discarded by the reader and reported as counts, so they are compared only where they
    // survived.
    const placed = migrated.written.flatMap((each) => each.project.existingModel.placedItems)
    const designs = migrated.written.flatMap((each) => each.project.itemDesigns)
    for (const object of objects) {
      const placement = placed.find((each) => each.id === object.id)
      if (placement === undefined) continue
      const design = designs.find((each) => each.id === placement.itemDesignId)
      if (placement === undefined || design === undefined || design.kind !== 'generic') {
        throw new Error(`${fixture}: no Placed Item for ${object.id}`)
      }
      const footprint = design.footprint
      if (footprint.kind !== 'rectangle') throw new Error(`${fixture}: ${object.id} is not a rectangle`)

      expect(placement.rotationDeg).toBe(object.rotation)
      expect(footprint.width).toBe(object.w)
      expect(footprint.depth).toBe(object.h)

      const cornersPlaced = corners(
        placement.translation.x - object.w / 2,
        placement.translation.y - object.h / 2,
        object.w,
        object.h,
        object.rotation,
      )
      expectRows(sorted(cornersPlaced), sorted(corners(object.x, object.y, object.w, object.h, object.rotation)), LAYOUT_TOLERANCE)
    }
  })
})

describe('the corpus as a whole', () => {
  it('actually contains a duplicated ID, so criterion 13 is not being proven vacuously', async () => {
    const regenerated = await Promise.all(
      migratable.map(async (rel) => {
        const migrated = await migrate(rel)
        if (migrated === null) return 0
        return (
          migrated.inspected.review.proposals.reduce((total, each) => total + each.regeneratedIds.length, 0) +
          (migrated.inspected.review.floorPlan?.regeneratedIds.length ?? 0)
        )
      }),
    )
    expect(regenerated.reduce((total, count) => total + count, 0)).toBeGreaterThan(0)
  })
})

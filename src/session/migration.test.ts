/**
 * The Migration review's logic, without a browser (#52 criteria 3, 4, 9–14, 16, 19, 20).
 *
 * Two claims carry this file. The first is *nothing before the decision*: steps 1–5 read,
 * convert and refuse, and a test can hold that promise by fingerprinting the store before and
 * after. The second is *a failure means nothing happened* — not "almost nothing", and not
 * "nothing except a Recovery Point nobody asked for". Every stage that can fail gets its own
 * test for exactly that reason, and the read-back mismatch gets a store that lies about what it
 * wrote, because no injectable fault can produce a write that reports success and is wrong.
 *
 * The source is a string here and a string in the browser, so byte-identity is tested where it
 * is decided and not only where it is finally observed.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createMemoryAdapter, withFaults, type LibraryRecord, type Ports, type Result } from '../persistence'
import { canonicalJson, sha256Hex } from '../lib'
import { MAX_TREE_DEPTH, convertLegacy, type LegacyConvertOptions, type LegacyConversionResult } from '../package'
import type { Project } from '../domain'
import {
  FLOOR_PLAN_SEPARATE_VALUE,
  FLOOR_PLAN_SKIP_VALUE,
  buildMigrationPlan,
  commitRestore,
  downloadOldBackups,
  downloadOriginalData,
  createSessionRegistry,
  floorPlanChoiceValue,
  floorPlanChoices,
  inspectMigration,
  isAlreadyMigrated,
  legacyFileKind,
  removeOldCopy,
  runMigration,
  sourceHash,
  stageRestore,
  type FloorPlanDestination,
  type MigrationFailure,
  type InspectedMigration,
  type LegacyConvertPort,
  type LegacyMigrationRecord,
  type LegacySourcePort,
  type MigrationAttachTarget,
  type MigrationChoices,
  type MigrationDeps,
  type MigrationPlan,
  type MigrationSource,
} from './index'
import {
  TEST_NOW,
  TEST_VERSION,
  createFakeClock,
  createFakeDownload,
  createFakeEncoder,
  createFakeImages,
  idSource,
  seedProject,
  testProject,
  type FakeClock,
  type FakeDownload,
} from './testing'

const fixturesRoot = fileURLToPath(new URL('../../fixtures/legacy', import.meta.url))
const readFixture = (rel: string): string => readFileSync(join(fixturesRoot, rel), 'utf8')

const REVIEW = 'migration-review/buildbox-store.json'
const SKETCHES = 'sketches/buildbox-store.json'

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`unexpected failure: ${JSON.stringify(result.error)}`)
  return result.value
}

function failure<E>(result: Result<unknown, E>): E {
  if (result.ok) throw new Error('expected a failure')
  return result.error
}

/** A `LegacySourcePort` that remembers it was emptied, and has no way to be written. */
interface FakeSource extends LegacySourcePort {
  removed: number
}

function fakeSource(raw: string): FakeSource {
  let value: string | null = raw
  return {
    removed: 0,
    read: () => value,
    remove() {
      value = null
      this.removed += 1
    },
  }
}

/** One migration's whole world: a store, a source, and no browser anywhere near it. */
interface World {
  deps: MigrationDeps
  ports: Ports
  source: FakeSource
  download: FakeDownload
  clock: FakeClock
}

function world(raw: string, options?: { ports?: Ports; convert?: LegacyConvertPort }): World {
  const ports = options?.ports ?? createMemoryAdapter()
  const clock = createFakeClock()
  const download = createFakeDownload()
  const source = fakeSource(raw)
  const deps: MigrationDeps = {
    ports,
    clock,
    ids: idSource('migration'),
    registry: createSessionRegistry(),
    convert: options?.convert ?? ((value, convertOptions: LegacyConvertOptions) => convertLegacy(value, convertOptions)),
    source,
    download,
  }
  return { deps, ports, source, download, clock }
}

async function existingRecords(ports: Ports): Promise<LibraryRecord[]> {
  return unwrap(await ports.projects.list({ includeTrashed: true }))
}

async function migrationSource(raw: string, kind: MigrationSource['kind'] = 'local-store'): Promise<MigrationSource> {
  return { kind, raw, hash: await sourceHash(raw) }
}

/** Steps 1–5 for a raw source, with the store read for the two collision questions. */
async function inspect(ports: Ports, deps: MigrationDeps, raw: string, kind?: MigrationSource['kind']) {
  const source = await migrationSource(raw, kind)
  const inspected = unwrap(await inspectMigration(deps, source, await existingRecords(ports)))
  return { source, inspected }
}

/** Everything the store holds, in one string a test can compare in a single assertion. */
async function fingerprint(ports: Ports): Promise<string> {
  const records: Record<string, unknown> = {}
  for (const record of await existingRecords(ports)) {
    const loaded = await ports.projects.load(record.id)
    const points = await ports.recovery.list(record.id)
    records[record.id] = {
      record,
      data: loaded.ok ? loaded.value.data : loaded.error,
      points: points.ok ? points.value : points.error,
    }
  }
  const meta = await ports.meta.get('legacyMigration')
  return canonicalJson({ records, meta: meta.ok ? meta.value : meta.error })
}

/**
 * A store that writes what it is told and then hands back something else. No injectable fault can
 * do that — a fault reports the failure, and the whole point of step 7 is a write that reported
 * success and was wrong.
 */
function lyingStore(): Ports {
  let lying = false
  let lied = false
  const base = createMemoryAdapter()
  return {
    ...base,
    projects: {
      ...base.projects,
      async commitMany(entries) {
        const written = await base.projects.commitMany(entries)
        if (written.ok) lying = true
        return written
      },
      async load(id) {
        const loaded = await base.projects.load(id)
        // One lie, and then the truth: verification stops at the first Project that does not
        // match, and the undo that follows has to be able to read what it is putting back.
        if (!loaded.ok || !lying || lied) return loaded
        lied = true
        return {
          ok: true,
          value: {
            ...loaded.value,
            data: { ...loaded.value.data, meta: { ...loaded.value.data.meta, name: 'Tampered' } },
          },
        }
      },
    },
  }
}

/**
 * The destination behind one `Attach it to` value.
 *
 * `skip` is the one value that is not always on the list — a floor plan with work in it does not
 * offer it — and a test still has to be able to ask for it, so an unknown value resolves to the
 * destination of that name rather than throwing.
 */
function destinationOf(inspected: InspectedMigration, existing: LibraryRecord[], value: string): FloorPlanDestination {
  const choice = floorPlanChoices(inspected.review, existing).find((each) => each.value === value)
  if (choice !== undefined) return choice.destination
  if (value === FLOOR_PLAN_SKIP_VALUE) return { kind: 'skip' }
  if (value.startsWith('existing:')) return { kind: 'existing', projectId: value.slice('existing:'.length) }
  throw new Error(`no such destination: ${value}`)
}

interface PreparedOptions {
  ports?: Ports
  convert?: LegacyConvertPort
  seed?: Project[]
  collisions?: MigrationChoices['collisions']
}

/** A whole run-up to step 6: inspect, decide, plan. Writes nothing. */
interface Prepared {
  w: World
  source: MigrationSource
  inspected: InspectedMigration
  existing: LibraryRecord[]
  plan: Result<MigrationPlan, MigrationFailure>
}

/**
 * Steps 1–5, then the reader's two choices, then step 6's plan.
 *
 * Throws when inspection itself refuses, because a test that got this far wants to talk about a
 * plan and not about a null. A test that is *interested* in an inspection failure calls
 * `attempt()` instead, which has no plan to promise.
 */
async function prepared(
  raw: string,
  destination: string | null,
  options: PreparedOptions = {},
): Promise<Prepared> {
  const ports = options.ports ?? createMemoryAdapter()
  for (const project of options.seed ?? []) await seedProject(ports, project)
  const w = world(raw, { ports, convert: options.convert })
  const { source, inspected } = await inspect(w.ports, w.deps, raw)
  const existing = await existingRecords(w.ports)
  const plan = await planFor(w, inspected, existing, destination, options)
  return { w, source, inspected, existing, plan }
}

/** Step 6 for a destination named the way the `Attach it to` control names it. */
async function planFor(
  w: World,
  inspected: InspectedMigration,
  existing: LibraryRecord[],
  destination: string | null,
  options: PreparedOptions,
): Promise<Result<MigrationPlan, MigrationFailure>> {
  const floorPlan = destination === null ? null : destinationOf(inspected, existing, destination)
  let attachTarget: MigrationAttachTarget | null = null
  if (floorPlan !== null && floorPlan.kind === 'existing') {
    const loaded = unwrap(await w.ports.projects.load(floorPlan.projectId))
    attachTarget = {
      id: floorPlan.projectId,
      record: existing.find((record) => record.id === floorPlan.projectId)!,
      project: loaded.data,
      revision: loaded.revision,
    }
  }
  return buildMigrationPlan(
    w.deps,
    inspected,
    existing,
    { floorPlan, collisions: options.collisions ?? {} },
    attachTarget,
  )
}

/**
 * The whole pipeline, however far it gets, and the world it ran against.
 *
 * Criterion 11 is one promise told at seven different steps, so the seven tests share this and
 * differ only in which step they broke.
 */
async function attempt(
  raw: string,
  destination: string | null,
  options: PreparedOptions = {},
): Promise<{ w: World; failed: MigrationFailure | null }> {
  const ports = options.ports ?? createMemoryAdapter()
  const w = world(raw, { ports, convert: options.convert })
  const source = await migrationSource(raw)
  const existing = await existingRecords(w.ports)
  const looked = await inspectMigration(w.deps, source, existing)
  if (!looked.ok) return { w, failed: looked.error }
  const plan = await planFor(w, looked.value, existing, destination, options)
  if (!plan.ok) return { w, failed: plan.error }
  const written = await runMigration(w.deps, looked.value, plan.value)
  return { w, failed: written.ok ? null : written.error }
}

function migrated(plan: Result<MigrationPlan, MigrationFailure>): MigrationPlan {
  if (!plan.ok) throw new Error(`plan refused: ${JSON.stringify(plan.error)}`)
  return plan.value
}

describe('the source', () => {
  it('is identified by the SHA-256 of its bytes (#52 §1.3)', async () => {
    const raw = readFixture(REVIEW)
    expect(await sourceHash(raw)).toBe(createHash('sha256').update(new TextEncoder().encode(raw)).digest('hex'))
  })

  it('recognises each legacy shape and nothing else (#52 criterion 17)', () => {
    expect(legacyFileKind(readFixture(REVIEW))).toBe('local-store')
    expect(legacyFileKind(readFixture('workspace/active-project.buildbox.json'))).toBe('workspace-file')
    expect(legacyFileKind(readFixture('floor-plan/no-image-floor-plan.json'))).toBe('floor-plan-file')
    expect(legacyFileKind('{"hello":1}')).toBeNull()
    expect(legacyFileKind('not json')).toBeNull()
    expect(legacyFileKind('[]')).toBeNull()
  })

  it('is offered again when its bytes change, and not while they are the same (#52 criterion 20)', () => {
    const record: LegacyMigrationRecord = {
      status: 'complete',
      sourceHash: 'a'.repeat(64),
      completedAt: TEST_NOW,
      projectIds: [],
      notMigrated: [],
      discardedSketches: 0,
      removedAt: null,
    }
    expect(isAlreadyMigrated(record, 'a'.repeat(64))).toBe(true)
    expect(isAlreadyMigrated(record, 'b'.repeat(64))).toBe(false)
    expect(isAlreadyMigrated(undefined, 'a'.repeat(64))).toBe(false)
  })
})

describe('inspection', () => {
  it('writes nothing while it looks (#52 §2 steps 1–5)', async () => {
    const w = world(readFixture(REVIEW))
    const before = await fingerprint(w.ports)
    const { inspected } = await inspect(w.ports, w.deps, readFixture(REVIEW))

    expect(inspected.review.proposals.map((proposal) => proposal.name)).toEqual([
      'Cabinet 1',
      'Kitchen Renovation',
      'Wardrobe Study',
    ])
    expect(inspected.review.proposals.every((proposal) => proposal.migratable)).toBe(true)
    expect(inspected.review.floorPlan?.preview).toEqual({ widthPx: 2400, heightPx: 1800 })
    expect(inspected.review.floorPlan?.itemCount).toBe(6)
    expect(inspected.review.legacyVersion).toBe(3)
    expect(await fingerprint(w.ports)).toBe(before)
  })

  it('reports the real counts behind each row (#52 §4.4)', async () => {
    const w = world(readFixture(REVIEW))
    const { inspected } = await inspect(w.ports, w.deps, readFixture(REVIEW))
    for (const proposal of inspected.review.proposals) {
      expect(proposal.designCount).toBe(1)
      expect(proposal.hasPlanImage).toBe(false)
    }
  })

  it('names a refused Design in plain words and never shows its path (#52 criterion 14)', async () => {
    const w = world(readFixture(SKETCHES))
    const { inspected } = await inspect(w.ports, w.deps, readFixture(SKETCHES))
    const refused = inspected.review.proposals.find((proposal) => !proposal.migratable)

    expect(inspected.review.proposals.filter((p) => p.migratable).map((p) => p.name)).toEqual(['Study Wall'])
    expect(refused?.name).toBe('Broken Cabinet')
    expect(refused?.problems.length).toBeGreaterThan(0)
    for (const problem of refused?.problems ?? []) {
      expect(problem).not.toContain('settings')
      expect(problem).not.toContain('projects[')
    }
    expect(inspected.review.discarded).toEqual({ wallHack: 2, tileZone: 1 })
  })

  it('reports a Design whose cabinet tree is too deep while the others still convert (#52 criterion 12)', async () => {
    // A node *cycle* is the other half of criterion 12, and no string source can carry one:
    // `JSON.parse` gives every node its own object, and #43's cycle check is against object
    // identity in the ancestor chain. It is covered where it can be reached, in the reader's own
    // tests (`src/package/legacy/validate.test.ts`, `tree-cycle`).
    const parsed = JSON.parse(readFixture(REVIEW)) as {
      state: { projects: Array<{ id: string; units: Array<{ root: Record<string, unknown> }> }> }
    }
    const root = parsed.state.projects[1]!.units[0]!.root
    const leaf = (root.children as Record<string, unknown>[])[1]!
    // A split needs exactly two spaces under it, so each extra level wraps the tree in a new
    // split beside a copy of an existing leaf — a tree that is legal in every way except its
    // height. `MAX_TREE_DEPTH + 1` wrappings puts the deepest leaf past the bound.
    let deep: Record<string, unknown> = root
    for (let level = 0; level <= MAX_TREE_DEPTH; level += 1) {
      const copy = structuredClone(leaf)
      copy.id = `unit-deep-leaf-${level}`
      deep = { id: `unit-deep-${level}`, splitAxis: root.splitAxis, splitRatio: 0.5, children: [deep, copy] }
    }
    parsed.state.projects[1]!.units[0]!.root = deep
    const raw = JSON.stringify(parsed)

    const w = world(raw)
    const { inspected } = await inspect(w.ports, w.deps, raw)

    expect(inspected.review.proposals.find((p) => p.designId === 'design-kitchen-renovation')?.migratable).toBe(false)
    expect(inspected.review.proposals.filter((p) => p.migratable).map((p) => p.name)).toEqual([
      'Cabinet 1',
      'Wardrobe Study',
    ])
    const refused = inspected.review.proposals.find((p) => p.designId === 'design-kitchen-renovation')!
    expect(refused.problems.join(' ')).toContain('12')

    // And it stays out of the migration while the other two land (#52 criterion 12).
    const run = await prepared(raw, 'proposed:design-cabinet-1')
    const result = unwrap(await runMigration(run.w.deps, run.inspected, migrated(run.plan)))
    expect(result.notMigrated.map((row) => row.designName)).toEqual(['Kitchen Renovation'])
    expect(result.projects.map((project) => project.name)).toEqual(['Cabinet 1', 'Wardrobe Study'])
    expect(await run.w.ports.projects.load('design-kitchen-renovation')).toMatchObject({ ok: false })
  })

  it('refuses a Plan Image that is not an image and migrates the Designs around it (#52 criteria 12, 14)', async () => {
    const raw = readFixture(REVIEW).replace(
      /data:image\/png;base64,[A-Za-z0-9+/=]+/,
      'data:image/png;base64,@@not-base64@@',
    )
    const w = world(raw)
    const { inspected } = await inspect(w.ports, w.deps, raw)

    expect(inspected.review.floorPlan?.usable).toBe(false)
    expect(inspected.review.floorPlan?.problems.join(' ')).toContain('image')
    expect(inspected.review.proposals.every((proposal) => proposal.migratable)).toBe(true)

    const run = await prepared(raw, FLOOR_PLAN_SEPARATE_VALUE)
    const result = unwrap(await runMigration(run.w.deps, run.inspected, migrated(run.plan)))
    expect(result.projects).toHaveLength(3)
    expect(result.notMigrated.some((row) => row.designName === 'Floor plan')).toBe(true)
  })

  it('stops at the stage the bytes failed in (#52 §4.5)', async () => {
    const w = world('{ not json')
    expect(failure(await inspectMigration(w.deps, await migrationSource('{ not json'), [])).stage).toBe('read')
  })
})

describe('the floor-plan destination', () => {
  it('pre-selects nothing and refuses to plan without one (#52 criterion 3)', async () => {
    const run = await prepared(readFixture(REVIEW), null)
    expect(floorPlanChoices(run.inspected.review, [])).not.toHaveLength(0)
    expect(failure(run.plan).stage).toBe('validate')
  })

  it('lists the Projects this review creates before the local ones (#52 deviation a)', async () => {
    const run = await prepared(readFixture(REVIEW), null)
    expect(floorPlanChoices(run.inspected.review, []).map((choice) => choice.value)).toEqual([
      'proposed:design-cabinet-1',
      'proposed:design-kitchen-renovation',
      'proposed:design-wardrobe-study',
      FLOOR_PLAN_SEPARATE_VALUE,
    ])
  })

  it('offers an existing Project only while its Floor 1 has no Plan Image (#52 §3)', async () => {
    const bare = testProject('local-bare', 'Empty room')
    const imaged = testProject('local-imaged', 'Furnished room')
    imaged.floors[0]!.planImage = {
      assetHash: 'c'.repeat(64),
      mediaType: 'image/png',
      widthPx: 800,
      heightPx: 600,
      pixelsPerMm: null,
    }
    const run = await prepared(readFixture(REVIEW), null, { seed: [bare, imaged] })
    const values = floorPlanChoices(run.inspected.review, run.existing).map((choice) => choice.value)

    expect(values).toContain('existing:local-bare')
    expect(values).not.toContain('existing:local-imaged')
    expect(floorPlanChoiceValue({ kind: 'existing', projectId: 'local-bare' })).toBe('existing:local-bare')
  })

  it('offers Skip only for a floor plan with nothing in it (#52 criterion 4)', async () => {
    const run = await prepared(readFixture(REVIEW), null)
    expect(floorPlanChoices(run.inspected.review, []).map((c) => c.value)).not.toContain(FLOOR_PLAN_SKIP_VALUE)

    const emptied = JSON.parse(readFixture(REVIEW)) as { state: { floorPlan: unknown } }
    emptied.state.floorPlan = { image: null, pixelsPerMm: null, objects: [], annotations: [], customTemplates: [] }
    const raw = JSON.stringify(emptied)
    const emptyRun = await prepared(raw, FLOOR_PLAN_SKIP_VALUE)

    expect(emptyRun.inspected.review.floorPlan?.isEmpty).toBe(true)
    expect(floorPlanChoices(emptyRun.inspected.review, []).map((c) => c.value)).toContain(FLOOR_PLAN_SKIP_VALUE)
    expect(migrated(emptyRun.plan).floorPlan).toEqual({ kind: 'skipped' })
    expect(migrated(emptyRun.plan).projects).toHaveLength(3)
  })

  it('refuses Skip for a floor plan that holds work', async () => {
    const run = await prepared(readFixture(REVIEW), FLOOR_PLAN_SKIP_VALUE)
    expect(failure(run.plan).stage).toBe('validate')
  })
})

describe('a migration', () => {
  it('writes every Project, reads it back and records the source as done (#52 criteria 2, 9)', async () => {
    const run = await prepared(readFixture(REVIEW), 'proposed:design-kitchen-renovation')
    const plan = migrated(run.plan)
    const result = unwrap(await runMigration(run.w.deps, run.inspected, plan))

    expect(result.projects.map((project) => project.name)).toEqual([
      'Cabinet 1',
      'Kitchen Renovation',
      'Wardrobe Study',
    ])
    expect(result.floorPlan).toEqual({
      kind: 'attached',
      projectId: 'design-kitchen-renovation',
      projectName: 'Kitchen Renovation',
    })

    for (const entry of plan.projects) {
      const loaded = unwrap(await run.w.ports.projects.load(entry.id))
      expect(canonicalJson(loaded.data)).toBe(canonicalJson(entry.project))
      expect(loaded.revision).toBe(entry.revision)
    }

    const attached = unwrap(await run.w.ports.projects.load('design-kitchen-renovation'))
    const planImage = attached.data.floors[0]!.planImage
    expect(planImage).not.toBeNull()
    expect(unwrap(await run.w.ports.assets.has(planImage!.assetHash))).toBe(true)
    // The stored bytes hash to the hash the record names (#52 criterion 9).
    const stored = unwrap(await run.w.ports.assets.get(planImage!.assetHash))
    expect(await sha256Hex(await stored.blob.arrayBuffer())).toBe(planImage!.assetHash)
    expect(stored.mediaType).toBe(planImage!.mediaType)

    const meta = unwrap(await run.w.ports.meta.get('legacyMigration'))
    expect(meta?.projectIds).toEqual(['design-cabinet-1', 'design-kitchen-renovation', 'design-wardrobe-study'])
    expect(meta?.sourceHash).toBe(run.source.hash)
    expect(meta?.removedAt).toBeNull()
    expect(meta?.status).toBe('complete')
  })

  it('leaves the source byte-identical (#52 criterion 10)', async () => {
    const raw = readFixture(REVIEW)
    const run = await prepared(raw, FLOOR_PLAN_SEPARATE_VALUE)
    unwrap(await runMigration(run.w.deps, run.inspected, migrated(run.plan)))

    expect(run.w.source.read()).toBe(raw)
    expect(run.w.source.removed).toBe(0)
  })

  it('names a separate floor-plan Project Floor plan, suffixed when taken (#52 §3)', async () => {
    const run = await prepared(readFixture(REVIEW), FLOOR_PLAN_SEPARATE_VALUE, {
      seed: [testProject('local-plan', 'Floor plan')],
    })
    expect(migrated(run.plan).projects.find((entry) => entry.floorPlanHere)?.name).toBe('Floor plan 2')
  })

  it('carries the legacy Custom Templates with the floor plan (#52 §3)', async () => {
    const run = await prepared(readFixture(REVIEW), FLOOR_PLAN_SEPARATE_VALUE)
    const separate = migrated(run.plan).projects.find((entry) => entry.floorPlanHere)
    // One template plus the six Placed Items' Item Designs: the template is unplaced, so it is
    // an Item Design with nothing pointing at it.
    expect(separate?.project.itemDesigns.length).toBeGreaterThanOrEqual(7)
  })

  it('attaches to an existing Project behind a Recovery Point written in the same transaction (#52 criterion 16)', async () => {
    const run = await prepared(readFixture(REVIEW), 'existing:local-room', { seed: [testProject('local-room', 'Living room')] })
    const plan = migrated(run.plan)
    expect(plan.projects.find((entry) => entry.kind === 'attach')?.expectedRevision).toBe(1)

    unwrap(await runMigration(run.w.deps, run.inspected, plan))

    const points = unwrap(await run.w.ports.recovery.list('local-room'))
    expect(points.map((point) => point.kind)).toEqual(['pre-migration'])
    expect(points[0]!.revision).toBe(1)
    const loaded = unwrap(await run.w.ports.projects.load('local-room'))
    expect(loaded.revision).toBe(2)
    expect(loaded.data.floors[0]!.planImage).not.toBeNull()
  })

  it('aborts a stale attach with nothing changed (#52 criterion 16)', async () => {
    const local = testProject('local-room', 'Living room')
    const run = await prepared(readFixture(REVIEW), 'existing:local-room', { seed: [local] })
    const plan = migrated(run.plan)
    // The Project moved underneath the review: the revision the plan named is gone.
    const moved = await run.w.ports.projects.commit({
      project: { ...local, meta: { ...local.meta, name: 'Living room, revised' } },
      revision: 2,
      savedAt: TEST_NOW,
    }, 1)
    expect(moved.ok).toBe(true)
    const before = await fingerprint(run.w.ports)

    expect(failure(await runMigration(run.w.deps, run.inspected, plan)).stage).toBe('write')
    expect(await fingerprint(run.w.ports)).toBe(before)
    expect(unwrap(await run.w.ports.recovery.list('local-room'))).toEqual([])
  })

  it('purges what it wrote when the store lies about reading it back (#52 §2 step 7)', async () => {
    const run = await prepared(readFixture(REVIEW), FLOOR_PLAN_SEPARATE_VALUE, { ports: lyingStore() })
    const before = await fingerprint(run.w.ports)

    expect(failure(await runMigration(run.w.deps, run.inspected, migrated(run.plan))).stage).toBe('read-back')
    expect((await existingRecords(run.w.ports)).map((record) => record.id)).toEqual([])
    expect(await run.w.ports.meta.get('legacyMigration')).toEqual({ ok: true, value: undefined })
    expect(await fingerprint(run.w.ports)).toBe(before)
  })

  it('rolls the batch back when the completion record cannot be written (#52 §2 step 7)', async () => {
    const run = await prepared(readFixture(REVIEW), FLOOR_PLAN_SEPARATE_VALUE, {
      ports: withFaults(createMemoryAdapter(), [{ method: 'set', fault: 'quota' }]),
    })
    expect(failure(await runMigration(run.w.deps, run.inspected, migrated(run.plan))).stage).toBe('write')
    expect((await existingRecords(run.w.ports)).map((record) => record.id)).toEqual([])
    expect(await run.w.ports.meta.get('legacyMigration')).toEqual({ ok: true, value: undefined })
  })

  it('reverses an attach that failed to read back, forward and not by editing history', async () => {
    const local = testProject('local-room', 'Living room')
    const run = await prepared(readFixture(REVIEW), 'existing:local-room', {
      ports: lyingStore(),
      seed: [local],
    })
    expect(failure(await runMigration(run.w.deps, run.inspected, migrated(run.plan))).stage).toBe('read-back')

    // The write did land — that is what a read-back mismatch means — so the undo cannot take the
    // revision back. It moves the Project forward to the content it had before, and the history
    // keeps every step.
    const loaded = unwrap(await run.w.ports.projects.load('local-room'))
    expect(loaded.revision).toBe(3)
    expect(loaded.data.meta.name).toBe('Living room')
    expect(loaded.data.floors[0]!.planImage).toBeNull()
    expect(unwrap(await run.w.ports.recovery.list('local-room')).map((point) => point.revision)).toEqual([1])
  })

  it('replaces a colliding Design only when told to, and copies it under a new identity otherwise (#52 §4.4)', async () => {
    const sameIdentity = testProject('design-cabinet-1', 'Cabinet 1')
    const undecided = await prepared(readFixture(REVIEW), FLOOR_PLAN_SEPARATE_VALUE, { seed: [sameIdentity] })
    expect(failure(undecided.plan).stage).toBe('validate')

    const copied = await prepared(readFixture(REVIEW), FLOOR_PLAN_SEPARATE_VALUE, {
      seed: [sameIdentity],
      collisions: { 'design-cabinet-1': 'copy' },
    })
    const entry = migrated(copied.plan).projects.find((each) => each.designId === 'design-cabinet-1')
    expect(entry?.kind).toBe('copy')
    expect(entry?.id).not.toBe('design-cabinet-1')
    expect(entry?.name).toBe('Cabinet 1 — Copy')

    const replaced = await prepared(readFixture(REVIEW), FLOOR_PLAN_SEPARATE_VALUE, {
      seed: [sameIdentity],
      collisions: { 'design-cabinet-1': 'replace' },
    })
    const over = migrated(replaced.plan).projects.find((each) => each.designId === 'design-cabinet-1')
    expect(over?.kind).toBe('replace')
    expect(over?.expectedRevision).toBe(1)
    expect(over?.revision).toBe(2)
  })

  it('says a name is taken without treating it as a collision (#52 §4.4)', async () => {
    const run = await prepared(readFixture(REVIEW), FLOOR_PLAN_SEPARATE_VALUE, {
      seed: [testProject('someone-else', 'Cabinet 1')],
    })
    const proposal = run.inspected.review.proposals.find((each) => each.name === 'Cabinet 1')
    expect(proposal?.nameTaken).toBe(true)
    expect(proposal?.collision).toBeNull()
  })
})

describe('a failure at each stage (#52 criterion 11)', () => {
  const REVIEW_RAW = readFixture(REVIEW)
  const NOT_JSON = '{ not json'

  /**
   * Each case stops the pipeline at one step and says which raw it started from — the promise is
   * that the source is still there afterwards, so the test has to compare against the bytes that
   * case actually handed over, not against a fixture the case never used.
   */
  interface FaultCase {
    name: string
    raw: string
    stage: string
    ports?: () => Ports
    convert?: LegacyConvertPort
    destination: string | null
  }

  const cases: FaultCase[] = [
    { name: 'reading', raw: NOT_JSON, stage: 'read', destination: FLOOR_PLAN_SEPARATE_VALUE },
    {
      name: 'converting',
      raw: REVIEW_RAW,
      stage: 'convert',
      destination: FLOOR_PLAN_SEPARATE_VALUE,
      convert: () =>
        Promise.resolve({
          ok: false,
          problems: [{ path: 'state.projects', code: 'missing-field', message: 'Missing the saved designs.' }],
        } as LegacyConversionResult),
    },
    {
      name: 'saving images',
      raw: REVIEW_RAW,
      stage: 'images',
      destination: FLOOR_PLAN_SEPARATE_VALUE,
      ports: () => withFaults(createMemoryAdapter(), [{ method: 'put', fault: 'quota' }]),
    },
    { name: 'checking', raw: REVIEW_RAW, stage: 'validate', destination: null },
    {
      name: 'writing Projects, aborted',
      raw: REVIEW_RAW,
      stage: 'write',
      destination: FLOOR_PLAN_SEPARATE_VALUE,
      ports: () => withFaults(createMemoryAdapter(), [{ method: 'commitMany', fault: 'abort' }]),
    },
    {
      name: 'writing Projects, out of room',
      raw: REVIEW_RAW,
      stage: 'write',
      destination: FLOOR_PLAN_SEPARATE_VALUE,
      ports: () => withFaults(createMemoryAdapter(), [{ method: 'commitMany', fault: 'quota' }]),
    },
    {
      name: 'reading back',
      raw: REVIEW_RAW,
      stage: 'read-back',
      destination: FLOOR_PLAN_SEPARATE_VALUE,
      ports: () => lyingStore(),
    },
  ]

  for (const testCase of cases) {
    it(`leaves everything as it was when it stops while ${testCase.name}`, async () => {
      const { w, failed } = await attempt(testCase.raw, testCase.destination, {
        ports: testCase.ports?.(),
        convert: testCase.convert,
      })
      const before = await fingerprint(w.ports)

      expect(failed?.stage).toBe(testCase.stage)
      // A plain reason, and never a stack trace or a raw path (#52 criterion 14).
      expect(failed?.problems.join(' ')).not.toMatch(/at\s+\S+\.ts/)
      expect(failed?.problems.join(' ')).not.toContain('state.projects')

      expect(w.source.read()).toBe(testCase.raw)
      expect((await existingRecords(w.ports)).map((record) => record.id)).toEqual([])
      expect(await w.ports.meta.get('legacyMigration')).toEqual({ ok: true, value: undefined })
      expect(await fingerprint(w.ports)).toBe(before)
    })
  }
})

describe('the read-only downloads (#52 §5)', () => {
  it('hands over the original bytes unchanged (#52 criterion 19)', async () => {
    const raw = readFixture(REVIEW)
    const w = world(raw)
    downloadOriginalData({ ...w.deps, download: w.download }, await migrationSource(raw))

    const [file] = w.download.files
    expect(w.download.files).toHaveLength(1)
    expect(file?.fileName).toBe('buildbox-original-data.json')
    expect(new TextDecoder().decode(file?.bytes)).toBe(raw)
    expect(w.source.read()).toBe(raw)
  })

  it('encodes one ordinary Backup per migratable Project, and each restores (#52 criterion 19)', async () => {
    const raw = readFixture(SKETCHES)
    const w = world(raw)
    const { inspected } = await inspect(w.ports, w.deps, raw)
    const backup = { clock: w.clock, encoder: createFakeEncoder(), ids: idSource('backup'), buildboxVersion: TEST_VERSION, preview: false }

    const names = unwrap(await downloadOldBackups({ ...w.deps, download: w.download, backup }, inspected, [], { floorPlan: null, collisions: {} }, null))
    // The Design that passed validation, and the floor plan standing up its own Project because
    // no destination was chosen.
    expect(names).toEqual(['Study Wall.buildbox', 'Floor plan.buildbox'])

    // A fresh profile: a Backup the review offered has to land somewhere else.
    const fresh = createMemoryAdapter()
    const restoreDeps = {
      ports: fresh,
      clock: w.clock,
      ids: idSource('restored'),
      registry: createSessionRegistry(),
      images: createFakeImages({ widthPx: 2400, heightPx: 1800 }),
      acceptPreview: false,
    }
    const staged = unwrap(await stageRestore(restoreDeps, w.download.files[0]!.bytes))
    const applied = unwrap(await commitRestore(restoreDeps, { staged: staged.staged, collision: staged.collision, decision: 'copy' }))
    expect(applied.name).toBe('Study Wall')

    const loaded = unwrap(await fresh.projects.load(applied.id))
    const original = inspected.review.proposals.find((proposal) => proposal.migratable)!.project!
    expect(canonicalJson(loaded.data)).toBe(canonicalJson(original))
  })
})

describe('Remove old copy (#52 §4.7)', () => {
  it('refuses before a migration has completed', async () => {
    const raw = readFixture(REVIEW)
    const w = world(raw)
    expect(failure(await removeOldCopy({ ...w.deps, source: w.source }, await migrationSource(raw))).stage).toBe('validate')
    expect(w.source.read()).toBe(raw)
  })

  it('deletes only the legacy key and records when (#52 criterion 6)', async () => {
    const raw = readFixture(REVIEW)
    const w = world(raw)
    const source = await migrationSource(raw)
    unwrap(await w.ports.meta.set('legacyMigration', {
      status: 'complete',
      sourceHash: source.hash,
      completedAt: TEST_NOW,
      projectIds: ['design-cabinet-1'],
      notMigrated: [],
      discardedSketches: 3,
      removedAt: null,
    }))

    const record = unwrap(await removeOldCopy({ ...w.deps, source: w.source }, source))
    expect(record.removedAt).toBe(TEST_NOW)
    expect(w.source.removed).toBe(1)
    expect(w.source.read()).toBeNull()
    expect(unwrap(await w.ports.meta.get('legacyMigration'))?.removedAt).toBe(TEST_NOW)
  })
})

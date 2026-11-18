/**
 * Restoring a Project Backup (#50 criteria 17–22).
 *
 * The flow is tested at the two seams that decide whether a user can trust it. The first is
 * *nothing before the decision*: `stageRestore` runs every check and writes nothing, so the
 * collision dialog's `Cancel—change nothing` is a promise a test can hold it to by comparing the
 * store before and after. The second is *the read-back*: a commit that reported success and does
 * not read back identical is a failed restore, and the only honest answer is to undo it and say
 * so. The lying store below is what makes that path reachable at all — no fault `withFaults` can
 * inject produces a write that lies about itself, because a quota error fails the write honestly.
 *
 * No DOM, no clock, no random source is read: the whole flow runs under Node against `./testing`.
 */
import { describe, expect, it } from 'vitest'
import { createMemoryAdapter, withFaults } from '../persistence'
import type { Ports, ProjectRecord } from '../persistence'
import { canonicalJson } from '../lib'
import { encodeProject } from '../package'
import { DOMAIN_SCHEMA_VERSION, validateProject } from '../domain'
import type { CabinetNode, EntityId, Project } from '../domain'
import {
  commitRestore,
  copyNameFor,
  createSessionRegistry,
  stageRestore,
} from './index'
import type { IdSource, RestoreCommitTarget, RestoreDeps, RestoreStaged, SessionRegistry } from './index'
import {
  createFakeClock,
  createFakeImages,
  heldAsset,
  idSource,
  pointsOfKind,
  seedProject,
  testProject,
  TEST_NOW,
  TEST_VERSION,
  type FakeClock,
  type FakeImages,
} from './testing'

const KITCHEN = 'kitchen-1'

/** The restore flow's whole world: one store, one clock, one ID source, one image decoder. */
interface World {
  deps: RestoreDeps
  ports: Ports
  clock: FakeClock
  ids: IdSource
  images: FakeImages
}

/** A Project whose one Floor carries a Plan Image, plus the bytes and hash behind it. */
async function planImageProject(
  id: string,
  name = 'Kitchen',
): Promise<{ project: Project; sha256: string; bytes: Uint8Array }> {
  const project = testProject(id, name)
  const asset = await heldAsset(7)
  project.floors[0]!.planImage = {
    assetHash: asset.sha256,
    mediaType: 'image/png',
    widthPx: asset.widthPx ?? 0,
    heightPx: asset.heightPx ?? 0,
    pixelsPerMm: 0.25,
  }
  return { project, sha256: asset.sha256, bytes: new Uint8Array(await asset.bytes.arrayBuffer()) }
}

/** The `.buildbox` a user would be handed, written by the real codec. */
async function backupBytes(
  project: Project,
  assets: Map<string, { bytes: Uint8Array; mediaType: string }>,
): Promise<Uint8Array> {
  return encodeProject(project, async (sha256) => {
    const asset = assets.get(sha256)
    if (asset === undefined) throw new Error(`no bytes for ${sha256}`)
    return asset
  }, {
    exportedAt: TEST_NOW,
    buildboxVersion: TEST_VERSION,
    // A flag-on build wrote it, which is the only kind of Backup that exists yet (#50 criterion 28).
    preview: true,
  })
}

function restoreWorld(ports: Ports, options?: { images?: FakeImages; acceptPreview?: boolean; registry?: SessionRegistry }): World {
  const clock = createFakeClock(TEST_NOW)
  const ids = idSource('restore')
  const images = options?.images ?? createFakeImages({ widthPx: 640, heightPx: 480 })
  return {
    ports,
    clock,
    ids,
    images,
    deps: {
      ports,
      clock,
      ids,
      registry: options?.registry ?? createSessionRegistry(),
      images,
      acceptPreview: options?.acceptPreview ?? true,
    },
  }
}

/** A store holding a Project with a Plan Image, and the Backup of it, staged by nothing yet. */
async function stagedBackup(options?: {
  id?: string
  name?: string
  images?: FakeImages
  acceptPreview?: boolean
  registry?: SessionRegistry
}) {
  const ports = createMemoryAdapter()
  const { project, sha256, bytes } = await planImageProject(options?.id ?? KITCHEN, options?.name ?? 'Kitchen')
  const archive = await backupBytes(project, new Map([[sha256, { bytes, mediaType: 'image/png' }]]))
  return { ports, project, sha256, archive, world: restoreWorld(ports, options) }
}

/**
 * Stage `archive` or throw, and answer with the two things a commit needs.
 *
 * The `StagedPackage` and its collision are returned separately rather than as the `RestoreStaged`
 * `stageRestore` answers with, because every caller here builds a `RestoreCommitTarget` and the
 * nesting would otherwise show up in all nine of them.
 */
async function stage(world: World, archive: Uint8Array): Promise<{ package: RestoreStaged['staged']; collision: RestoreStaged['collision'] }> {
  const staged = await stageRestore(world.deps, archive)
  if (!staged.ok) throw new Error(`stageRestore: ${JSON.stringify(staged.error)}`)
  return { package: staged.value.staged, collision: staged.value.collision }
}

/**
 * The user's answer, shaped the way `commitRestore` demands.
 *
 * A colliding Backup cannot be committed without a decision and a non-colliding one has nothing
 * to decide, so the two are different values. A test that got the pairing wrong should fail here
 * rather than at the store.
 */
function targetFor(
  staged: RestoreStaged['staged'],
  collision: RestoreStaged['collision'],
  decision?: 'replace' | 'copy',
): RestoreCommitTarget {
  if (decision === undefined) {
    if (collision !== null) throw new Error('a colliding Backup needs a decision')
    return { staged, collision: null }
  }
  if (collision === null) throw new Error('there is nothing to decide')
  return { staged, collision, decision }
}

/** Everything both stores hold, in one string a test can compare in a single assertion. */
async function fingerprint(ports: Ports): Promise<string> {
  const listed = await ports.projects.list({ includeTrashed: true })
  if (!listed.ok) throw new Error(`list: ${listed.error.kind}`)
  const records: Record<string, unknown> = {}
  for (const record of listed.value) {
    const loaded = await ports.projects.load(record.id)
    if (!loaded.ok) throw new Error(`load: ${loaded.error.kind}`)
    const points = await ports.recovery.list(record.id)
    if (!points.ok) throw new Error(`recovery.list: ${points.error.kind}`)
    records[record.id] = { record, data: loaded.value.data, revision: loaded.value.revision, points: points.value }
  }
  return canonicalJson(records)
}

/**
 * Every entity ID a Project holds, plus every reference to one.
 *
 * The field list is `domain`'s walk order (#42 §2): the Project, the Floors, each Item Design and
 * — for a cabinet — its space tree with the dividers and accessories it carries, then the Placed
 * Items. A copy that lost any of them would still load and still be wrong, which is the failure
 * this set is built to catch.
 */
function idsOf(project: Project): Set<EntityId> {
  const ids = new Set<EntityId>([project.id])
  for (const floor of project.floors) ids.add(floor.id)
  for (const design of project.itemDesigns) {
    ids.add(design.id)
    if (design.kind === 'cabinet') collectSpace(design.construction.root, ids)
  }
  for (const item of project.existingModel.placedItems) {
    ids.add(item.id)
    ids.add(item.itemDesignId)
    ids.add(item.floorId)
  }
  return ids
}

function collectSpace(node: CabinetNode, ids: Set<EntityId>): void {
  ids.add(node.id)
  for (const divider of node.dividers ?? []) ids.add(divider.id)
  for (const accessory of node.accessories ?? []) ids.add(accessory.id)
  if (node.children !== undefined) {
    collectSpace(node.children[0], ids)
    collectSpace(node.children[1], ids)
  }
}

describe('the copy name', () => {
  it('takes `— Copy`, then the first free number', () => {
    expect(copyNameFor('Kitchen', [])).toBe('Kitchen — Copy')
    expect(copyNameFor('Kitchen', ['Kitchen — Copy'])).toBe('Kitchen — Copy 2')
    expect(copyNameFor('Kitchen', ['Kitchen — Copy', 'Kitchen — Copy 2'])).toBe('Kitchen — Copy 3')
    expect(copyNameFor('Kitchen', ['Kitchen — Copy 2'])).toBe('Kitchen — Copy')
  })
})

describe('staging a restore', () => {
  it('writes nothing at all, and finds no collision on a fresh device (#50 criterion 18)', async () => {
    const { ports, world, archive, sha256 } = await stagedBackup()
    const before = await fingerprint(ports)

    const staged = await stageRestore(world.deps, archive)
    expect(staged.ok).toBe(true)
    if (!staged.ok) return
    expect(staged.value.collision).toBeNull()
    expect(staged.value.staged.assets.has(sha256)).toBe(true)
    expect(await fingerprint(ports)).toBe(before)
    expect(world.images.asked).toHaveLength(1)
  })

  it('finds the collision before the first write, Trash included (#50 §4 step 8)', async () => {
    const { ports, world, archive, project } = await stagedBackup()
    await seedProject(ports, project)
    await ports.projects.trash(KITCHEN, TEST_NOW)

    const staged = await stageRestore(world.deps, archive)
    expect(staged.ok).toBe(true)
    if (!staged.ok) return
    expect(staged.value.collision?.existing.id).toBe(KITCHEN)
    expect(staged.value.collision?.copyName).toBe('Kitchen — Copy')
  })

  it('refuses an asset that will not decode, and changes nothing (#50 criterion 22)', async () => {
    const { ports, archive } = await stagedBackup()
    const before = await fingerprint(ports)
    const images = createFakeImages({ widthPx: 640, heightPx: 480 })
    images.answer = () => null

    const staged = await stageRestore(restoreWorld(ports, { images }).deps, archive)
    expect(staged).toEqual({ ok: false, error: { kind: 'media' } })
    expect(await fingerprint(ports)).toBe(before)
  })

  it('refuses an image whose record disagrees with what it decodes to (#50 criterion 22)', async () => {
    const { ports, archive } = await stagedBackup()
    const before = await fingerprint(ports)
    const images = createFakeImages({ widthPx: 640, heightPx: 480 })
    images.answer = () => ({ widthPx: 999, heightPx: 480 })

    const staged = await stageRestore(restoreWorld(ports, { images }).deps, archive)
    expect(staged).toEqual({ ok: false, error: { kind: 'media' } })
    expect(await fingerprint(ports)).toBe(before)
  })

  it('refuses a released build reading a preview Backup (#50 criterion 28)', async () => {
    const { ports, world, archive } = await stagedBackup({ acceptPreview: false })
    const before = await fingerprint(ports)

    const staged = await stageRestore(world.deps, archive)
    expect(staged.ok).toBe(false)
    if (staged.ok) return
    expect(staged.error).toEqual({ kind: 'package', problem: { code: 'preview-package' } })
    expect(await fingerprint(ports)).toBe(before)
  })

  it('answers a loose file with `package`’s refusal rather than a crash (#50 criterion 19)', async () => {
    const { ports, world, archive } = await stagedBackup()
    const before = await fingerprint(ports)
    void archive
    const loose = new TextEncoder().encode('floor,width,depth\n1,2,3\n')

    const staged = await stageRestore(world.deps, loose)
    expect(staged.ok).toBe(false)
    if (staged.ok) return
    expect(staged.error.kind).toBe('package')
    expect(await fingerprint(ports)).toBe(before)
  })
})

describe('committing a restore', () => {
  it('lands a new Project with its assets (#50 criterion 17)', async () => {
    const { ports, world, project, sha256, archive } = await stagedBackup()
    const { package: pkg, collision } = await stage(world, archive)

    const applied = await commitRestore(world.deps, targetFor(pkg, collision))
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.value).toEqual({ kind: 'new', id: KITCHEN, name: 'Kitchen', migratedFrom: null })

    const loaded = await ports.projects.load(KITCHEN)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(canonicalJson(loaded.value.data)).toBe(canonicalJson(project))
    const held = await ports.assets.has(sha256)
    expect(held.ok && held.value).toBe(true)
  })

  it('replaces under the same identity, behind a Recovery Point written first (#50 criterion 18)', async () => {
    const { ports, archive } = await stagedBackup()
    const original = testProject(KITCHEN, 'Kitchen')
    await seedProject(ports, original, { revision: 4 })
    const { package: pkg, collision } = await stage(restoreWorld(ports), archive)
    expect(collision).not.toBeNull()
    void original

    const world = restoreWorld(ports)
    const applied = await commitRestore(world.deps, targetFor(pkg, collision, 'replace'))
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.value).toEqual({ kind: 'replace', id: KITCHEN, name: 'Kitchen', migratedFrom: null })

    const points = await pointsOfKind(ports, KITCHEN, 'pre-import-replace')
    expect(points).toHaveLength(1)
    // The Point holds the state that was about to be overwritten, at the revision it was at.
    expect(points[0]!.revision).toBe(4)
    expect(points[0]!.schemaVersion).toBe(DOMAIN_SCHEMA_VERSION)

    const loaded = await ports.projects.load(KITCHEN)
    if (!loaded.ok) throw new Error('load failed')
    expect(loaded.value.revision).toBe(5)
  })

  it('brings back a Project the Backup was trashed under', async () => {
    const { ports, project, archive } = await stagedBackup()
    await seedProject(ports, project)
    await ports.projects.trash(KITCHEN, TEST_NOW)
    const { package: pkg, collision } = await stage(restoreWorld(ports), archive)

    const applied = await commitRestore(restoreWorld(ports).deps, targetFor(pkg, collision, 'replace'))
    expect(applied.ok).toBe(true)

    const listed = await ports.projects.list({ includeTrashed: true })
    if (!listed.ok) throw new Error('list failed')
    expect(listed.value.find((row) => row.id === KITCHEN)?.trashedAt).toBeNull()
  })

  it('refuses to replace a Project an open session is holding unsaved (#14)', async () => {
    const { ports, project, archive } = await stagedBackup()
    await seedProject(ports, project)
    const before = await fingerprint(ports)
    const guarded: SessionRegistry = {
      register: () => {},
      unregister: () => {},
      get: () => null,
      isGuarded: (id) => id === KITCHEN,
    }
    const world = restoreWorld(ports, { registry: guarded })
    const { package: pkg, collision } = await stage(world, archive)

    const applied = await commitRestore(world.deps, targetFor(pkg, collision, 'replace'))
    expect(applied).toEqual({ ok: false, error: { kind: 'session', error: 'guarded' } })
    expect(await fingerprint(ports)).toBe(before)
  })

  it('imports a copy whose IDs share nothing with the original (#50 criterion 18)', async () => {
    const { ports, project, archive } = await stagedBackup()
    await seedProject(ports, project)
    const { package: pkg, collision } = await stage(restoreWorld(ports), archive)

    const world = restoreWorld(ports)
    const applied = await commitRestore(world.deps, targetFor(pkg, collision, 'copy'))
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.value.kind).toBe('copy')
    expect(applied.value.name).toBe('Kitchen — Copy')
    expect(applied.value.id).not.toBe(KITCHEN)

    const loaded = await ports.projects.load(applied.value.id)
    if (!loaded.ok) throw new Error('load failed')
    const copy = loaded.value.data
    expect(copy.meta.name).toBe('Kitchen — Copy')

    // Every ID differs, and none was lost: the walk is a bijection, not a rename of some fields.
    const original = idsOf(project)
    const remapped = idsOf(copy)
    expect([...original].filter((id) => remapped.has(id))).toEqual([])
    expect(remapped.size).toBe(original.size)

    // Every reference resolves, which is what `validateProject` is for.
    expect(validateProject(copy)).toMatchObject({ ok: true })
  })
})

describe('the read-back', () => {
  /**
   * `ports` with a store that lies: a commit succeeds, and every read afterwards returns a
   * different Project.
   *
   * This is criterion 21's injected fault. Nothing `withFaults` can inject produces it — a quota
   * error fails the write honestly — and the claim under test is precisely "the adapter said yes
   * and was wrong", so the decorator corrupts the read rather than the write.
   */
  function lyingStore(ports: Ports): Ports {
    let lying = false
    return {
      ...ports,
      projects: {
        ...ports.projects,
        async commit(input, expectedRevision) {
          const committed = await ports.projects.commit(input, expectedRevision)
          if (committed.ok) lying = true
          return committed
        },
        async load(id) {
          const loaded = await ports.projects.load(id)
          if (!loaded.ok || !lying) return loaded
          const tampered: ProjectRecord = {
            ...loaded.value,
            data: { ...loaded.value.data, meta: { ...loaded.value.data.meta, name: 'Tampered' } },
          }
          return { ok: true, value: tampered }
        },
      },
    }
  }

  it('purges a new Project that does not read back, and says so (#50 criterion 21)', async () => {
    const { ports, archive } = await stagedBackup()
    const world = restoreWorld(lyingStore(ports))
    const { package: pkg, collision } = await stage(world, archive)

    const applied = await commitRestore(world.deps, targetFor(pkg, collision))
    expect(applied).toEqual({ ok: false, error: { kind: 'unverified' } })

    const listed = await ports.projects.list({ includeTrashed: true })
    if (!listed.ok) throw new Error('list failed')
    expect(listed.value.map((row) => row.id)).not.toContain(KITCHEN)
  })

  it('puts a replaced Project back where it was (#50 criterion 21)', async () => {
    const { ports, archive } = await stagedBackup()
    const original = testProject(KITCHEN, 'Kitchen')
    await seedProject(ports, original, { revision: 4 })
    const world = restoreWorld(lyingStore(ports))
    const { package: pkg, collision } = await stage(world, archive)

    const applied = await commitRestore(world.deps, targetFor(pkg, collision, 'replace'))
    expect(applied).toEqual({ ok: false, error: { kind: 'unverified' } })

    const truth = await ports.projects.load(KITCHEN)
    expect(truth.ok).toBe(true)
    if (!truth.ok) return
    expect(canonicalJson(truth.value.data)).toBe(canonicalJson(original))
    // The repair is a forward revision — 4 was the state, 5 the lie, 6 the repair — and the
    // Recovery Point it was taken from is still there to be named.
    expect(truth.value.revision).toBe(6)
    expect(await pointsOfKind(ports, KITCHEN, 'pre-import-replace')).toHaveLength(1)
  })

  it('purges a copy that does not read back, leaving the original alone', async () => {
    const { ports, project, archive } = await stagedBackup()
    await seedProject(ports, project)
    const world = restoreWorld(lyingStore(ports))
    const { package: pkg, collision } = await stage(world, archive)

    const applied = await commitRestore(world.deps, targetFor(pkg, collision, 'copy'))
    expect(applied).toEqual({ ok: false, error: { kind: 'unverified' } })

    const listed = await ports.projects.list({ includeTrashed: true })
    if (!listed.ok) throw new Error('list failed')
    expect(listed.value.map((row) => row.id)).toEqual([KITCHEN])
  })

  it('refuses a Backup whose Plan Image never landed, after the write', async () => {
    const { ports, archive } = await stagedBackup()
    // The commit reports success but the asset is not there: a Project that loads perfectly and
    // renders a broken card, which is a failed restore wearing a success.
    const hollow: Ports = {
      ...ports,
      assets: { ...ports.assets, has: async () => ({ ok: true, value: false }) },
    }
    const world = restoreWorld(hollow)
    const { package: pkg, collision } = await stage(world, archive)

    const applied = await commitRestore(world.deps, targetFor(pkg, collision))
    expect(applied).toEqual({ ok: false, error: { kind: 'unverified' } })
  })
})

describe('a storage fault mid-restore', () => {
  it('names the fault and writes nothing', async () => {
    const base = createMemoryAdapter()
    const { project, sha256, bytes } = await planImageProject(KITCHEN)
    const archive = await backupBytes(project, new Map([[sha256, { bytes, mediaType: 'image/png' }]]))
    const world = restoreWorld(withFaults(base, [{ method: 'commit', fault: 'quota' }]))
    const { package: pkg } = await stage(world, archive)
    const applied = await commitRestore(world.deps, targetFor(pkg, null))
    expect(applied).toEqual({ ok: false, error: { kind: 'session', error: { kind: 'quota' } } })

    const listed = await base.projects.list({ includeTrashed: true })
    if (!listed.ok) throw new Error('list failed')
    expect(listed.value).toEqual([])
  })
})

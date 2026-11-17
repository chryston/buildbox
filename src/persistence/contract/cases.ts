/**
 * The behaviour every persistence adapter must show (#45 cases 1–8).
 *
 * These cases state the rules of #14 and #20 §5 as observations through the ports only:
 * what `load`, `list` and `has` return, and what a canonical-JSON snapshot of the stores
 * looks like before and after a call. Nothing here may reach into an adapter, name a
 * storage technology, or read the real clock — that is what lets #46 run this same file
 * against `fake-indexeddb` and a real browser unchanged.
 */
import { describe, expect, it } from 'vitest'
import { DOMAIN_SCHEMA_VERSION } from '../../domain'
import { canonicalJson, canonicalJsonBytes } from '../../lib'
import { ASSET_GC_GRACE_MS, type ProjectRecord } from '../ports'
import {
  FIRST_SAVED_AT,
  OTHER_PROJECT_ID,
  PROJECT_ID,
  SECOND_SAVED_AT,
  assetBlob,
  assetHash,
  dayKeyUtc,
  failure,
  projectFixture,
  recoveryPointFixture,
  seedProject,
  snapshotStores,
  unwrap,
  type ContractContext,
} from './support'

const DAY_MS = 24 * 60 * 60 * 1000
const PROJECT_RECORD_KEYS = ['data', 'id', 'revision', 'savedAt', 'schemaVersion']
const RECOVERY_META_KEYS = ['createdAt', 'id', 'kind', 'projectId', 'revision', 'schemaVersion', 'summary']
const LIBRARY_RECORD_KEYS = [
  'address',
  'id',
  'lastBackupInitiatedAt',
  'lastBackupRevision',
  'name',
  'revision',
  'savedAt',
  'schemaVersion',
  'sizeBytes',
  'summary',
  'trashedAt',
]

/** Case 1. */
function registerCreateAndLoad(ctx: ContractContext): void {
  describe('create and load', () => {
    it('reads back a canonically equal Project', async () => {
      const seed = await seedProject(ctx.ports)
      const loaded = unwrap(await ctx.ports.projects.load(PROJECT_ID))
      expect(loaded.id).toBe(PROJECT_ID)
      expect(loaded.revision).toBe(1)
      expect(loaded.schemaVersion).toBe(DOMAIN_SCHEMA_VERSION)
      expect(loaded.savedAt).toBe(FIRST_SAVED_AT)
      expect(canonicalJson(loaded.data)).toBe(canonicalJson(seed.project))
    })

    it('derives the library record from the Project', async () => {
      const seed = await seedProject(ctx.ports)
      const [record] = unwrap(await ctx.ports.projects.list({ includeTrashed: false }))
      expect(record.id).toBe(PROJECT_ID)
      expect(record.name).toBe('Maple Street Kitchen')
      expect(record.address).toBe('412 Maple Street')
      expect(record.revision).toBe(1)
      expect(record.savedAt).toBe(FIRST_SAVED_AT)
      expect(record.schemaVersion).toBe(DOMAIN_SCHEMA_VERSION)
      expect(record.trashedAt).toBeNull()
      expect(record.lastBackupInitiatedAt).toBeNull()
      expect(record.lastBackupRevision).toBeNull()
      // sizeBytes: the Project's canonical bytes plus the one asset it references.
      expect(record.sizeBytes).toBe(canonicalJsonBytes(seed.project).byteLength + seed.planImageBytes.byteLength)
      expect(record.summary.floorCount).toBe(1)
      expect(record.summary.designOptionCount).toBe(0)
      expect(record.summary.itemCount).toBe(2)
      expect(record.summary.previewAssetHash).toBe(seed.planImageHash)
      expect(record.summary.previewOutline.rects).toHaveLength(2)
    })

    it('lists projects newest savedAt first', async () => {
      await seedProject(ctx.ports)
      unwrap(
        await ctx.ports.projects.commit(
          { project: projectFixture(null, OTHER_PROJECT_ID), revision: 1, savedAt: SECOND_SAVED_AT },
          null,
        ),
      )
      const records = unwrap(await ctx.ports.projects.list({ includeTrashed: false }))
      expect(records.map((record) => record.id)).toEqual([OTHER_PROJECT_ID, PROJECT_ID])
    })

    it('reports a project that is not there', async () => {
      expect(failure(await ctx.ports.projects.load('nope')).kind).toBe('not-found')
    })
  })
}

/** Case 2. */
function registerCommit(ctx: ContractContext): void {
  describe('commit', () => {
    it('advances revision and savedAt when the expected revision still holds', async () => {
      await seedProject(ctx.ports)
      const project = projectFixture(null)
      const record = unwrap(
        await ctx.ports.projects.commit({ project, revision: 7, savedAt: SECOND_SAVED_AT }, 1),
      )
      expect(record.revision).toBe(7)
      expect(record.savedAt).toBe(SECOND_SAVED_AT)
      const loaded = unwrap(await ctx.ports.projects.load(PROJECT_ID))
      expect(loaded.revision).toBe(7)
      expect(loaded.savedAt).toBe(SECOND_SAVED_AT)
      const [library] = unwrap(await ctx.ports.projects.list({ includeTrashed: false }))
      expect(library.revision).toBe(7)
      expect(library.savedAt).toBe(SECOND_SAVED_AT)
    })

    it('refuses a stale expected revision and changes nothing', async () => {
      const seed = await seedProject(ctx.ports)
      unwrap(
        await ctx.ports.projects.commit({ project: seed.project, revision: 2, savedAt: SECOND_SAVED_AT }, 1),
      )
      const before = await snapshotStores(ctx.ports, { assets: [seed.planImageHash, seed.spareHash] })
      const lateAssetHash = await assetHash(9)

      const error = failure(
        await ctx.ports.projects.commit(
          {
            project: seed.project,
            revision: 3,
            savedAt: '2026-02-02T00:00:00.000Z',
            newAssets: [{ bytes: assetBlob(9), mediaType: 'image/png', widthPx: 2, heightPx: 2 }],
          },
          1,
        ),
      )
      expect(error).toEqual({ kind: 'revision-conflict', expected: 1, actual: 2 })

      expect(await snapshotStores(ctx.ports, { assets: [seed.planImageHash, seed.spareHash, lateAssetHash] })).toBe(before)
      expect(unwrap(await ctx.ports.assets.has(lateAssetHash))).toBe(false)
      expect(unwrap(await ctx.ports.projects.load(PROJECT_ID)).revision).toBe(2)
    })

    it('refuses a revision that does not increase', async () => {
      const seed = await seedProject(ctx.ports)
      const before = await snapshotStores(ctx.ports)

      expect(failure(await ctx.ports.projects.commit({ project: seed.project, revision: 1, savedAt: SECOND_SAVED_AT }, 1)).kind).toBe(
        'revision-conflict',
      )
      expect(failure(await ctx.ports.projects.commit({ project: seed.project, revision: 0, savedAt: SECOND_SAVED_AT }, 1)).kind).toBe(
        'revision-conflict',
      )
      // Creating a project that already exists is refused the same way.
      expect(failure(await ctx.ports.projects.commit({ project: seed.project, revision: 2, savedAt: SECOND_SAVED_AT }, null)).kind).toBe(
        'revision-conflict',
      )
      expect(await snapshotStores(ctx.ports)).toBe(before)
    })

    it('creates with a null expected revision and a first revision above zero', async () => {
      const record = unwrap(
        await ctx.ports.projects.commit({ project: projectFixture(null, OTHER_PROJECT_ID), revision: 1, savedAt: FIRST_SAVED_AT }, null),
      )
      expect(record.revision).toBe(1)
    })
  })
}

/** Case 3. */
function registerAtomicAssets(ctx: ContractContext): void {
  describe('atomic assets', () => {
    it('makes a commit’s new assets readable', async () => {
      const seed = await seedProject(ctx.ports)
      const extra = assetBlob(5)
      const extraHash = await assetHash(5)
      unwrap(
        await ctx.ports.projects.commit(
          {
            project: seed.project,
            revision: 2,
            savedAt: SECOND_SAVED_AT,
            newAssets: [{ bytes: extra, mediaType: 'image/png', widthPx: 16, heightPx: 16 }],
          },
          1,
        ),
      )
      expect(unwrap(await ctx.ports.assets.has(extraHash))).toBe(true)
      const asset = unwrap(await ctx.ports.assets.get(extraHash))
      expect(asset.mediaType).toBe('image/png')
      expect(asset.widthPx).toBe(16)
      expect(asset.byteLength).toBe(extra.size)
      expect(await asset.blob.text()).toBe(await extra.text())
    })

    it('leaves neither the project record nor the assets changed when the commit fails', async () => {
      const seed = await seedProject(ctx.ports)
      const before = await snapshotStores(ctx.ports, { assets: [seed.planImageHash, seed.spareHash] })
      const doomedHash = await assetHash(6)

      const error = failure(
        await ctx.ports.projects.commit(
          {
            project: projectFixture(null),
            revision: 2,
            savedAt: SECOND_SAVED_AT,
            newAssets: [{ bytes: assetBlob(6), mediaType: 'image/png', widthPx: 1, heightPx: 1 }],
          },
          99,
        ),
      )
      expect(error.kind).toBe('revision-conflict')
      expect(unwrap(await ctx.ports.assets.has(doomedHash))).toBe(false)
      expect(await snapshotStores(ctx.ports, { assets: [seed.planImageHash, seed.spareHash, doomedHash] })).toBe(before)
    })
  })
}

/** Case 4. */
function registerLibraryFields(ctx: ContractContext): void {
  describe('library fields', () => {
    it('keeps the backup markers across later commits', async () => {
      const seed = await seedProject(ctx.ports)
      const marked = unwrap(
        await ctx.ports.projects.markBackupInitiated(PROJECT_ID, { at: SECOND_SAVED_AT, revision: 1 }),
      )
      expect(marked.lastBackupInitiatedAt).toBe(SECOND_SAVED_AT)
      expect(marked.lastBackupRevision).toBe(1)

      unwrap(await ctx.ports.projects.commit({ project: seed.project, revision: 2, savedAt: '2026-02-02T00:00:00.000Z' }, 1))
      const [record] = unwrap(await ctx.ports.projects.list({ includeTrashed: false }))
      expect(record.revision).toBe(2)
      expect(record.lastBackupInitiatedAt).toBe(SECOND_SAVED_AT)
      expect(record.lastBackupRevision).toBe(1)
    })

    it('hides a trashed project from the Library and shows it in Trash', async () => {
      await seedProject(ctx.ports)
      const trashed = unwrap(await ctx.ports.projects.trash(PROJECT_ID, SECOND_SAVED_AT))
      expect(trashed.trashedAt).toBe(SECOND_SAVED_AT)
      expect(trashed.revision).toBe(1)

      expect(unwrap(await ctx.ports.projects.list({ includeTrashed: false }))).toEqual([])
      const [visible] = unwrap(await ctx.ports.projects.list({ includeTrashed: true }))
      expect(visible.trashedAt).toBe(SECOND_SAVED_AT)
      // Trash is not a new revision: the Project data is exactly what it was.
      expect(unwrap(await ctx.ports.projects.load(PROJECT_ID)).revision).toBe(1)

      const restored = unwrap(await ctx.ports.projects.restore(PROJECT_ID))
      expect(restored.trashedAt).toBeNull()
      expect(unwrap(await ctx.ports.projects.list({ includeTrashed: false })).map((r) => r.id)).toEqual([PROJECT_ID])
    })

    it('purges the project, its library record and its recovery points, and no assets', async () => {
      const seed = await seedProject(ctx.ports)
      unwrap(
        await ctx.ports.recovery.create(
          recoveryPointFixture({ id: 'point-keep-me', projectId: OTHER_PROJECT_ID, createdAt: FIRST_SAVED_AT }),
        ),
      )
      unwrap(
        await ctx.ports.recovery.create(
          recoveryPointFixture({ id: 'point-go', projectId: PROJECT_ID, createdAt: SECOND_SAVED_AT, project: seed.project }),
        ),
      )

      unwrap(await ctx.ports.projects.purge(PROJECT_ID))
      expect(failure(await ctx.ports.projects.load(PROJECT_ID)).kind).toBe('not-found')
      expect(unwrap(await ctx.ports.projects.list({ includeTrashed: true }))).toEqual([])
      expect(unwrap(await ctx.ports.recovery.list(PROJECT_ID))).toEqual([])
      expect(unwrap(await ctx.ports.recovery.list(OTHER_PROJECT_ID)).map((meta) => meta.id)).toEqual(['point-keep-me'])
      // Asset bytes are left for `gc`, which is the only thing that decides they may go.
      expect(unwrap(await ctx.ports.assets.has(seed.planImageHash))).toBe(true)
    })

    it('reports a project that is not there', async () => {
      expect(failure(await ctx.ports.projects.trash('nope', FIRST_SAVED_AT)).kind).toBe('not-found')
      expect(failure(await ctx.ports.projects.restore('nope')).kind).toBe('not-found')
      expect(failure(await ctx.ports.projects.purge('nope')).kind).toBe('not-found')
      expect(failure(await ctx.ports.projects.markBackupInitiated('nope', { at: FIRST_SAVED_AT, revision: 1 })).kind).toBe('not-found')
    })
  })
}

/** Case 5. */
function registerAssets(ctx: ContractContext): void {
  describe('assets', () => {
    it('stores identical bytes once and keeps the original storedAt', async () => {
      const seed = await seedProject(ctx.ports)
      const again = unwrap(
        await ctx.ports.assets.put(new Blob([seed.planImageBytes]), 'image/jpeg', { widthPx: 1, heightPx: 1 }, SECOND_SAVED_AT),
      )
      expect(again).toBe(seed.planImageHash)

      const asset = unwrap(await ctx.ports.assets.get(seed.planImageHash))
      expect(asset.storedAt).toBe(FIRST_SAVED_AT)
      expect(asset.mediaType).toBe('image/png')
      expect(asset.widthPx).toBe(64)
      expect(asset.byteLength).toBe(seed.planImageBytes.byteLength)
      expect(await asset.blob.text()).toBe(await new Blob([seed.planImageBytes]).text())
    })

    it('reports an asset that is not there', async () => {
      expect(failure(await ctx.ports.assets.get('0'.repeat(64))).kind).toBe('not-found')
      expect(unwrap(await ctx.ports.assets.has('0'.repeat(64)))).toBe(false)
    })

    it('keeps live hashes and young ones, and deletes the rest', async () => {
      const seed = await seedProject(ctx.ports)
      const now = '2026-01-03T10:00:00.000Z'
      // Unreferenced, and stored exactly 24 h before `now`: the grace period ends here.
      const boundaryHash = unwrap(
        await ctx.ports.assets.put(assetBlob(7), 'image/png', { widthPx: 2, heightPx: 2 }, '2026-01-02T10:00:00.000Z'),
      )
      // Unreferenced, but 23 h 59 min old: too young to collect.
      const youngHash = unwrap(
        await ctx.ports.assets.put(assetBlob(8), 'image/png', { widthPx: 2, heightPx: 2 }, '2026-01-02T10:01:00.000Z'),
      )
      expect(ASSET_GC_GRACE_MS).toBe(DAY_MS)

      const result = unwrap(await ctx.ports.assets.gc(new Set([seed.planImageHash]), now))
      expect([...result.deleted].sort()).toEqual([seed.spareHash, boundaryHash].sort())

      expect(unwrap(await ctx.ports.assets.has(seed.planImageHash))).toBe(true)
      expect(unwrap(await ctx.ports.assets.has(youngHash))).toBe(true)
      expect(unwrap(await ctx.ports.assets.has(seed.spareHash))).toBe(false)
      expect(unwrap(await ctx.ports.assets.has(boundaryHash))).toBe(false)
    })

    it('keeps everything when nothing is old enough to go', async () => {
      const seed = await seedProject(ctx.ports)
      const result = unwrap(await ctx.ports.assets.gc(new Set(), FIRST_SAVED_AT))
      expect(result.deleted).toEqual([])
      expect(unwrap(await ctx.ports.assets.has(seed.spareHash))).toBe(true)
    })
  })
}

/** Case 6. */
function registerPrune(ctx: ContractContext): void {
  describe('prune', () => {
    const NOW = '2026-06-15T18:00:00.000Z'
    const DAY_ZERO = Date.parse('2026-05-07T12:00:00.000Z')
    /** Day 0 is 39 days before `NOW`; `index` spaces points a minute apart inside a day. */
    const stamp = (day: number, index: number): string => new Date(DAY_ZERO + day * DAY_MS + index * 60_000).toISOString()

    async function seedDays(days: number, perDay: number, projectId = PROJECT_ID): Promise<void> {
      for (let day = 0; day < days; day += 1) {
        for (let index = 0; index < perDay; index += 1) {
          unwrap(
            await ctx.ports.recovery.create(
              recoveryPointFixture({ id: `p${day}-${index}`, projectId, createdAt: stamp(day, index) }),
            ),
          )
        }
      }
    }

    it('keeps the newest 20 points plus one per day for the last 30 days', async () => {
      await seedDays(40, 30)

      const result = unwrap(await ctx.ports.recovery.prune(PROJECT_ID, { now: NOW, dayKey: dayKeyUtc }))
      // The newest 20 are the last third of day 39. Each earlier day inside the 30-day
      // window keeps only its newest point, and day 39's newest is already among those 20.
      const kept = Array.from({ length: 20 }, (_unused, index) => `p39-${index + 10}`)
      for (let day = 10; day <= 38; day += 1) kept.push(`p${day}-29`)
      expect(kept).toHaveLength(49)

      const listed = unwrap(await ctx.ports.recovery.list(PROJECT_ID))
      expect(listed.map((meta) => meta.id).sort()).toEqual([...kept].sort())
      expect(result.deleted).toHaveLength(1200 - 49)
      for (const id of kept) expect(result.deleted).not.toContain(id)
      // `list` is newest first and metadata only: no Project data travels with it.
      expect(listed[0]?.id).toBe('p39-29')
      expect(Object.keys(listed[0] ?? {}).sort()).toEqual(RECOVERY_META_KEYS)
    })

    it('keeps the newest 20 even when they are older than 30 days', async () => {
      await seedDays(1, 25)
      const result = unwrap(await ctx.ports.recovery.prune(PROJECT_ID, { now: NOW, dayKey: dayKeyUtc }))
      // Day 0 is outside the daily window, so only the newest-20 rule applies.
      expect([...result.deleted].sort()).toEqual(['p0-0', 'p0-1', 'p0-2', 'p0-3', 'p0-4'].sort())
      expect(unwrap(await ctx.ports.recovery.list(PROJECT_ID))).toHaveLength(20)
    })

    it('touches no other project’s points', async () => {
      await seedDays(2, 2)
      unwrap(
        await ctx.ports.recovery.create(
          recoveryPointFixture({ id: 'other-1', projectId: OTHER_PROJECT_ID, createdAt: stamp(0, 0) }),
        ),
      )
      unwrap(await ctx.ports.recovery.prune(PROJECT_ID, { now: NOW, dayKey: dayKeyUtc }))
      expect(unwrap(await ctx.ports.recovery.list(OTHER_PROJECT_ID)).map((meta) => meta.id)).toEqual(['other-1'])
    })

    it('loads a point with its data and reports one that is gone', async () => {
      const seed = await seedProject(ctx.ports)
      unwrap(
        await ctx.ports.recovery.create(
          recoveryPointFixture({ id: 'point-1', projectId: PROJECT_ID, createdAt: FIRST_SAVED_AT, project: seed.project }),
        ),
      )
      const point = unwrap(await ctx.ports.recovery.load('point-1'))
      expect(canonicalJson(point.data)).toBe(canonicalJson(seed.project))
      expect(point.summary.itemCount).toBe(2)
      expect(failure(await ctx.ports.recovery.load('nope')).kind).toBe('not-found')
    })
  })
}

/** Case 7. */
function registerPrefsAndMeta(ctx: ContractContext): void {
  describe('prefs and meta', () => {
    it('round-trips values and reports a missing key as undefined', async () => {
      unwrap(await ctx.ports.prefs.set('viewState:project-1:main', { zoom: 1.5, panX: -20, panY: 40 }))
      expect(unwrap(await ctx.ports.prefs.get('viewState:project-1:main'))).toEqual({ zoom: 1.5, panX: -20, panY: 40 })
      expect(await ctx.ports.prefs.get('viewState:project-1:other')).toEqual({ ok: true, value: undefined })

      unwrap(await ctx.ports.prefs.set('exportRecipes', [{ name: 'Cut list', format: 'csv' }]))
      expect(unwrap(await ctx.ports.prefs.get('exportRecipes'))).toEqual([{ name: 'Cut list', format: 'csv' }])

      unwrap(await ctx.ports.meta.set('legacyMigration', { done: true, at: FIRST_SAVED_AT }))
      expect(unwrap(await ctx.ports.meta.get('legacyMigration'))).toEqual({ done: true, at: FIRST_SAVED_AT })
      expect(await ctx.ports.meta.get('legacyMigration')).not.toEqual({ ok: true, value: undefined })
    })

    it('keeps prefs and meta out of every project record', async () => {
      const seed = await seedProject(ctx.ports)
      unwrap(await ctx.ports.prefs.set('viewState:project-1:main', { zoom: 2, panX: 0, panY: 0 }))
      unwrap(await ctx.ports.meta.set('legacyMigration', { done: false }))

      const loaded: ProjectRecord = unwrap(await ctx.ports.projects.load(PROJECT_ID))
      expect(Object.keys(loaded).sort()).toEqual(PROJECT_RECORD_KEYS)
      expect(canonicalJson(loaded.data)).toBe(canonicalJson(seed.project))
      const [record] = unwrap(await ctx.ports.projects.list({ includeTrashed: true }))
      expect(Object.keys(record).sort()).toEqual(LIBRARY_RECORD_KEYS)
    })
  })
}

/** Case 8. */
function registerIsolation(ctx: ContractContext): void {
  describe('isolation', () => {
    it('returns immutable records', async () => {
      await seedProject(ctx.ports)
      const loaded = unwrap(await ctx.ports.projects.load(PROJECT_ID))
      expect(Object.isFrozen(loaded)).toBe(true)
      expect(Object.isFrozen(loaded.data)).toBe(true)
      expect(Object.isFrozen(loaded.data.existingModel.placedItems)).toBe(true)
      expect(() => {
        loaded.data.meta.name = 'Mutated in place'
      }).toThrow(TypeError)
      expect(unwrap(await ctx.ports.projects.load(PROJECT_ID)).data.meta.name).toBe('Maple Street Kitchen')

      const [record] = unwrap(await ctx.ports.projects.list({ includeTrashed: true }))
      expect(Object.isFrozen(record)).toBe(true)
      expect(Object.isFrozen(record.summary.previewOutline.rects)).toBe(true)
    })

    it('does not let a later mutation of the caller’s object leak in', async () => {
      const project = projectFixture(null)
      const newAssets = [{ bytes: assetBlob(11), mediaType: 'image/png', widthPx: 2, heightPx: 2 }]
      unwrap(await ctx.ports.projects.commit({ project, revision: 1, savedAt: FIRST_SAVED_AT, newAssets }, null))
      const extraHash = await assetHash(12)

      project.meta.name = 'Mutated after the commit'
      project.floors[0]!.name = 'Renamed after the commit'
      project.existingModel.placedItems.push(project.existingModel.placedItems[0]!)
      newAssets.push({ bytes: new Blob([new Uint8Array([1, 2, 3])]), mediaType: 'image/png', widthPx: 3, heightPx: 3 })

      const loaded = unwrap(await ctx.ports.projects.load(PROJECT_ID))
      expect(loaded.data.meta.name).toBe('Maple Street Kitchen')
      expect(loaded.data.floors[0]?.name).toBe('Floor 1')
      expect(loaded.data.existingModel.placedItems).toHaveLength(2)
      const [record] = unwrap(await ctx.ports.projects.list({ includeTrashed: true }))
      expect(record.name).toBe('Maple Street Kitchen')
      expect(record.summary.itemCount).toBe(2)
      expect(unwrap(await ctx.ports.assets.has(extraHash))).toBe(false)
    })

    it('does not let a caller mutate a stored recovery point', async () => {
      const seed = await seedProject(ctx.ports)
      unwrap(
        await ctx.ports.recovery.create(
          recoveryPointFixture({ id: 'point-1', projectId: PROJECT_ID, createdAt: FIRST_SAVED_AT, project: seed.project }),
        ),
      )
      const point = unwrap(await ctx.ports.recovery.load('point-1'))
      expect(Object.isFrozen(point)).toBe(true)
      expect(() => {
        point.data.meta.name = 'Mutated in place'
      }).toThrow(TypeError)
      expect(unwrap(await ctx.ports.recovery.load('point-1')).data.meta.name).toBe('Maple Street Kitchen')
    })
  })
}

/** Cases 1–8, registered inside the caller's `describe`. */
export function registerContractCases(ctx: ContractContext): void {
  registerCreateAndLoad(ctx)
  registerCommit(ctx)
  registerAtomicAssets(ctx)
  registerLibraryFields(ctx)
  registerAssets(ctx)
  registerPrune(ctx)
  registerPrefsAndMeta(ctx)
  registerIsolation(ctx)
}

/**
 * Shared fixtures and assertions for the contract suite (#45).
 *
 * Everything here is behaviour-level: a Project built by hand, deterministic asset bytes,
 * a clock the test drives, and a canonical-JSON snapshot of every store reachable through
 * the ports. Nothing may assume how an adapter stores anything — this file is what lets
 * the same suite run against memory, `fake-indexeddb` and a real browser unchanged (#46).
 */
import { DOMAIN_SCHEMA_VERSION, rectangleFootprint, summarizeProject, type Project } from '../../domain'
import { canonicalJson, sha256Hex } from '../../lib'
import type { FaultMethod } from '../faults'
import type {
  LegacyMigrationRecord,
  MetaMap,
  PersistenceError,
  Ports,
  PrefsMap,
  ProjectRecord,
  RecoveryPoint,
  RecoveryPointKind,
  Result,
} from '../ports'

/** The adapter under test, read per case so each one gets the fresh instance. */
export interface ContractContext {
  readonly ports: Ports
}

export const PROJECT_ID = 'project-1'
export const OTHER_PROJECT_ID = 'project-2'
export const FIRST_SAVED_AT = '2026-01-01T10:00:00.000Z'
export const SECOND_SAVED_AT = '2026-01-02T10:00:00.000Z'

/** A completed `meta.legacyMigration` record, for the cases that need `meta` non-empty. */
export const MIGRATION_META: LegacyMigrationRecord = {
  status: 'complete',
  sourceHash: 'a'.repeat(64),
  completedAt: FIRST_SAVED_AT,
  projectIds: [PROJECT_ID],
  notMigrated: [],
  discardedSketches: 0,
  removedAt: null,
}

/** A UTC calendar day, the shape `prune`'s injected `dayKey` returns. */
export const dayKeyUtc = (createdAt: string): string => createdAt.slice(0, 10)

/** Unwrap a success, or fail the test naming the error that came instead. */
export function unwrap<T>(result: Result<T, PersistenceError>): T {
  if (result.ok === false) throw new Error(`expected success, got ${canonicalJson(result.error)}`)
  return result.value
}

/** The failure a port resolved, or a test failure when it wrongly succeeded. */
export function failure(result: Result<unknown, PersistenceError>): PersistenceError {
  if (result.ok === true) throw new Error('expected a typed failure, got success')
  return result.error
}

/** Deterministic bytes, distinct per seed: 32 bytes is enough to hash and to differ. */
export function assetBytes(seed: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(32)
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = (seed * 31 + index * 7) % 256
  return bytes
}

export const assetBlob = (seed: number): Blob => new Blob([assetBytes(seed)])
export const assetHash = (seed: number): Promise<string> => sha256Hex(assetBytes(seed))

/** The contract's Project: one Floor with a Plan Image, two Item Designs, two Placed Items. */
export function projectFixture(planImageHash: string | null, id: string = PROJECT_ID): Project {
  return {
    id,
    meta: { name: 'Maple Street Kitchen', address: '412 Maple Street' },
    preferences: { displayUnit: 'mm', displayPrecision: 0, defaultWallHeight: 2600 },
    floors: [
      {
        id: `${id}-floor-1`,
        name: 'Floor 1',
        planImage:
          planImageHash === null
            ? null
            : { assetHash: planImageHash, mediaType: 'image/png', widthPx: 64, heightPx: 48, pixelsPerMm: 0.5 },
      },
    ],
    views: [
      { id: `${id}-view-1`, kind: 'plan', floorId: `${id}-floor-1`, name: 'Floor 1', isDefault: true, showPlanImage: true, planViewRange: { lowerMm: 0, upperMm: 2600 } },
    ],
    itemDesigns: [
      {
        id: `${id}-design-bed`,
        kind: 'generic',
        name: 'King Bed',
        footprint: rectangleFootprint(1820, 1980),
        origin: { x: 910, y: 990 },
        height: 500,
        heightIsTypical: true,
        color: '#8b5a2b',
      },
      {
        id: `${id}-design-rug`,
        kind: 'generic',
        name: 'Runner Rug',
        footprint: rectangleFootprint(2400, 800),
        origin: { x: 1200, y: 400 },
        height: 12,
        heightIsTypical: false,
        color: '#c9ada7',
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
          id: `${id}-place-1`,
          itemDesignId: `${id}-design-bed`,
          floorId: `${id}-floor-1`,
          translation: { x: 1200, y: 400 },
          rotationDeg: 0,
          baseElevation: 0,
        },
        {
          id: `${id}-place-2`,
          itemDesignId: `${id}-design-rug`,
          floorId: `${id}-floor-1`,
          translation: { x: 2400, y: 900 },
          rotationDeg: 90,
          baseElevation: 0,
        },
      ],
    },
    warningAcknowledgements: [],
    comments: [],
    commentReferenceCounter: 0,
  }
}

/** A Recovery Point whose summary and data agree with the Project it belongs to. */
export function recoveryPointFixture(point: {
  id: string
  projectId: string
  createdAt: string
  kind?: RecoveryPointKind
  revision?: number
  project?: Project
}): RecoveryPoint {
  const data = point.project ?? projectFixture(null, point.projectId)
  return {
    id: point.id,
    projectId: point.projectId,
    createdAt: point.createdAt,
    kind: point.kind ?? 'idle',
    revision: point.revision ?? 1,
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    summary: summarizeProject(data),
    data,
  }
}

/** What a seeded store holds, so a case can name the hashes and records it expects. */
export interface Seeded {
  project: Project
  planImageHash: string
  planImageBytes: Uint8Array<ArrayBuffer>
  /** An asset stored on its own, referenced by nothing: the garbage-collection subject. */
  spareHash: string
  record: ProjectRecord
}

/**
 * The starting state most cases share: one committed Project whose Plan Image arrived as a
 * new asset, plus one unreferenced asset stored on its own.
 */
export async function seedProject(ports: Ports): Promise<Seeded> {
  const planImageBytes = assetBytes(1)
  const planImageHash = await sha256Hex(planImageBytes)
  const project = projectFixture(planImageHash)
  const record = unwrap(
    await ports.projects.commit(
      {
        project,
        revision: 1,
        savedAt: FIRST_SAVED_AT,
        newAssets: [{ bytes: new Blob([planImageBytes]), mediaType: 'image/png', widthPx: 64, heightPx: 48 }],
      },
      null,
    ),
  )
  const spareHash = unwrap(await ports.assets.put(assetBlob(2), 'image/png', { widthPx: 8, heightPx: 8 }, FIRST_SAVED_AT))
  return { project, planImageHash, planImageBytes, spareHash, record }
}

/** Which records a snapshot probes beyond every Project, Library record and Recovery Point. */
export interface StoreProbe {
  /** Asset hashes to read back; a hash the store has dropped simply disappears. */
  assets?: readonly string[]
  prefs?: readonly (keyof PrefsMap)[]
  meta?: readonly (keyof MetaMap)[]
}

/**
 * Every store, as canonical JSON: the only honest way to say "nothing changed" about an
 * adapter whose internals the contract must not see (#45 criterion 3).
 */
export async function snapshotStores(ports: Ports, probe: StoreProbe = {}): Promise<string> {
  const library = unwrap(await ports.projects.list({ includeTrashed: true }))
  const projects: ProjectRecord[] = []
  const recovery: RecoveryPoint[] = []
  for (const record of library) {
    projects.push(unwrap(await ports.projects.load(record.id)))
    for (const meta of unwrap(await ports.recovery.list(record.id))) {
      recovery.push(unwrap(await ports.recovery.load(meta.id)))
    }
  }
  const assets = []
  for (const sha256 of probe.assets ?? []) {
    if (unwrap(await ports.assets.has(sha256)) !== true) continue
    const asset = unwrap(await ports.assets.get(sha256))
    assets.push({
      sha256: asset.sha256,
      mediaType: asset.mediaType,
      byteLength: asset.byteLength,
      widthPx: asset.widthPx,
      heightPx: asset.heightPx,
      storedAt: asset.storedAt,
      text: await asset.blob.text(),
    })
  }
  const prefs = []
  for (const key of probe.prefs ?? []) prefs.push({ key: String(key), value: unwrap(await ports.prefs.get(key)) ?? null })
  const meta = []
  for (const key of probe.meta ?? []) meta.push({ key: String(key), value: unwrap(await ports.meta.get(key)) ?? null })

  return canonicalJson({
    library,
    projects: projects.sort(byId),
    recovery: recovery.sort(byId),
    assets,
    prefs: prefs.sort(byKey),
    meta: meta.sort(byKey),
  })
}

const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const byKey = (a: { key: string }, b: { key: string }): number => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)

/** One write path, so the fault matrix can drive all eight the same way. */
export interface WriteCall {
  run: (ports: Ports, seed: Seeded) => Promise<Result<unknown, PersistenceError>>
  /** State the call needs beyond `seedProject`, applied before the adapter is decorated. */
  prepare?: (ports: Ports, seed: Seeded) => Promise<void>
}

export const WRITE_CALLS: Readonly<Record<FaultMethod, WriteCall>> = {
  commit: {
    run: (ports, seed) =>
      ports.projects.commit(
        {
          project: { ...seed.project, meta: { ...seed.project.meta, name: 'Renamed after the fault' } },
          revision: 2,
          savedAt: SECOND_SAVED_AT,
          newAssets: [{ bytes: assetBlob(3), mediaType: 'image/png', widthPx: 4, heightPx: 4 }],
        },
        1,
      ),
  },
  commitMany: {
    run: (ports, seed) =>
      ports.projects.commitMany([
        {
          input: {
            project: { ...seed.project, meta: { ...seed.project.meta, name: 'Renamed after the fault' } },
            revision: 2,
            savedAt: SECOND_SAVED_AT,
            newAssets: [{ bytes: assetBlob(3), mediaType: 'image/png', widthPx: 4, heightPx: 4 }],
          },
          expectedRevision: 1,
        },
        {
          input: { project: projectFixture(null, OTHER_PROJECT_ID), revision: 1, savedAt: SECOND_SAVED_AT },
          expectedRevision: null,
        },
      ]),
  },
  put: {
    run: (ports) => ports.assets.put(assetBlob(4), 'image/png', { widthPx: 4, heightPx: 4 }, SECOND_SAVED_AT),
  },
  create: {
    run: (ports, seed) =>
      ports.recovery.create(
        recoveryPointFixture({ id: 'point-fault', projectId: seed.project.id, createdAt: SECOND_SAVED_AT, project: seed.project }),
      ),
  },
  trash: {
    run: (ports, seed) => ports.projects.trash(seed.project.id, SECOND_SAVED_AT),
  },
  restore: {
    prepare: async (ports, seed) => {
      unwrap(await ports.projects.trash(seed.project.id, FIRST_SAVED_AT))
    },
    run: (ports, seed) => ports.projects.restore(seed.project.id),
  },
  purge: {
    run: (ports, seed) => ports.projects.purge(seed.project.id),
  },
  markBackupInitiated: {
    run: (ports, seed) => ports.projects.markBackupInitiated(seed.project.id, { at: SECOND_SAVED_AT, revision: 1 }),
  },
  set: {
    run: (ports) => ports.prefs.set('exportRecipes', [{ name: 'Cut list', format: 'csv' }]),
  },
}

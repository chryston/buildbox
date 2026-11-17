/**
 * The public face of the `persistence` module (#45, #20 §2, ADR 0003): the only way in
 * from outside this folder. `persistence` is pure — no DOM, no React, no state library,
 * no `idb` — and imports nothing but `domain` and `lib`. It names no storage technology:
 * the ports below are what an adapter implements, and the IndexedDB adapter (#46) is a
 * sibling folder that `app` alone imports.
 *
 * It holds the five repository ports and their record shapes, the typed failures that come
 * back instead of an exception, the in-memory adapter, and the fault-injecting decorator.
 * `src/persistence/contract/index.ts` is the second entry point, for test files only: it
 * is the one behaviour suite every adapter must pass.
 *
 * Nothing here reads the clock or mints an ID (#42 §3). `Blob` is a standard global in
 * Node 24 and Workers, so asset bytes cost no DOM dependency.
 */
export {
  FAULT_KINDS,
  FAULT_METHODS,
  withFaults,
  type FaultKind,
  type FaultMethod,
  type FaultRule,
} from './faults'
export { createMemoryAdapter } from './memory'
export {
  ASSET_GC_GRACE_MS,
  RECOVERY_KEEP_DAYS,
  RECOVERY_KEEP_RECENT,
  type AssetDims,
  type AssetRecord,
  type AssetRepository,
  type CommitInput,
  type LibraryRecord,
  type LiveHashes,
  type MetaMap,
  type MetaRepository,
  type NewAsset,
  type PersistenceError,
  type Ports,
  type PrefsMap,
  type PrefsRepository,
  type ProjectRecord,
  type ProjectRepository,
  type RecoveryPoint,
  type RecoveryPointKind,
  type RecoveryPointMeta,
  type RecoveryRepository,
  type RemovedResult,
  type Result,
  type StoredAsset,
  type ViewportState,
} from './ports'
// The Library record stores a Project Summary; callers of the ports meet it as part of a
// record, so the type is re-exported rather than making every importer reach into `domain`.
export type {
  OutlineBounds,
  OutlineRect,
  ProjectOutline,
  ProjectSummary,
} from '../domain'

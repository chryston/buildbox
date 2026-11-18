/**
 * Restoring a Project Backup (#50, #20 §6, §12, #44).
 *
 * The ten steps of #50 §4, in order, with the two that decide everything sitting where they
 * belong:
 *
 * - **Steps 1–6 are `package`'s** — `stageImport` has already checked size, format, path,
 *   manifest, hash, asset set, package version, preview flag, schema version and migration
 *   before this file sees the Project. Nothing here re-checks them, and nothing here writes.
 * - **Step 8's collision check runs before the first write.** A Backup whose Project ID matches
 *   a local Project — Trash included, because a trashed Project still holds its identity — stops
 *   here with the staged bytes held in memory. The user chooses; only then does anything reach
 *   IndexedDB.
 * - **Step 10 reads the Project back and compares it.** A commit that reported success and does
 *   not read back identical is rolled back and refused with `unverified`, because "the write
 *   succeeded" is a claim about the bytes and not about the adapter's return value.
 *
 * The rollback is deliberately narrow. A new Project or a copy is purged, which leaves nothing
 * behind. A replace is put back from the `pre-import-replace` Recovery Point that was written
 * *before* it, in its own transaction — so the state being restored is one the store already
 * accepted, and the repair is a forward revision rather than an edit of history.
 *
 * No DOM, no clock, no random source is read directly (#42 §3): the image decoder, the clock and
 * the ID allocator all arrive as data, so the whole flow runs under Node against the fakes in
 * `./testing`.
 */
import { remapIds, summarizeProject, type Project } from '../domain'
import { canonicalJson } from '../lib'
import type {
  LibraryRecord,
  NewAsset,
  PersistenceError,
  Ports,
  RecoveryPoint,
  Result,
} from '../persistence'
import { stageImport, type PackageProblem, type StagedPackage } from '../package'
import type { ClockPort, IdSource, ImageDecoderPort } from './ports'
import { err, ok } from './result'
import type { SessionRegistry } from './types'

/** What a restore can refuse with, past the storage errors `persistence` already names. */
export type RestoreProblem =
  /** One of `package`'s typed refusals; `ui/strings` turns the code into a sentence (#50 §4 step 1). */
  | { kind: 'package'; problem: PackageProblem }
  /** Step 7: an asset that will not decode, or whose dimensions disagree with its record. */
  | { kind: 'media' }
  /** Step 10: the write reported success and the read-back did not match. */
  | { kind: 'unverified' }
  /** #14's guard, or a storage fault. */
  | { kind: 'session'; error: 'guarded' | PersistenceError }

/** What a restore left behind, in the words the toast needs. */
export interface RestoreApplied {
  /** `new` landed beside the others, `replace` took the existing Project's identity, `copy` is a new identity from a colliding Backup. */
  kind: 'new' | 'replace' | 'copy'
  id: string
  name: string
  /** The domain schema the Backup arrived at, or `null` when no migrator ran (#50 criterion 18). */
  migratedFrom: number | null
}

/** Everything a restore needs from outside. */
export interface RestoreDeps {
  ports: Ports
  clock: ClockPort
  ids: IdSource
  registry: SessionRegistry
  images: ImageDecoderPort
  /** Decided by `app` from its feature flag; a released build never accepts a preview Backup (#20 §11). */
  acceptPreview: boolean
}

/** A local Project sharing the Backup's identity, and the name a copy would take. */
export interface RestoreCollision {
  existing: LibraryRecord
  copyName: string
}

/** A staged Backup, and what this device already holds under its identity. */
export interface RestoreStaged {
  staged: StagedPackage
  /** `null` when no local Project — trashed ones included — shares the Backup's Project ID. */
  collision: RestoreCollision | null
}

/**
 * The name a copy takes (#50 §4 step 8): `— Copy`, then `— Copy 2`, first that no local
 * Project already holds.
 *
 * The suffix is a name and not an identity — the identity is the fresh ID `remapIds` mints — so
 * a clash with a Project the user named by hand is settled here rather than by refusing the
 * import.
 */
export function copyNameFor(name: string, taken: Iterable<string>): string {
  const held = new Set(taken)
  const base = `${name} — Copy`
  if (!held.has(base)) return base
  for (let n = 2; ; n += 1) {
    const candidate = `${base} ${n}`
    if (!held.has(candidate)) return candidate
  }
}

/**
 * Steps 1–8: read, check, decode, and find out whether this device already has that Project.
 *
 * Nothing is written. The bytes and the migrated Project stay in memory, which is what lets the
 * collision dialog promise `Cancel—change nothing` and mean it.
 */
export async function stageRestore(deps: RestoreDeps, bytes: Uint8Array): Promise<Result<RestoreStaged, RestoreProblem>> {
  const staged = await stageImport(bytes, { acceptPreview: deps.acceptPreview })
  if (!staged.ok) return err({ kind: 'package', problem: staged.problem })

  // Step 7 (#20 §6): every Plan Image must decode, with dimensions equal to its record. A
  // Backup whose image will not open would otherwise land as a Floor with a blank plan and a
  // record that lies about its size.
  const decoded = new Map<string, { widthPx: number; heightPx: number }>()
  for (const [sha256, asset] of staged.staged.assets) {
    const image = await deps.images.decode(asset.bytes, asset.mediaType)
    if (image === null) return err({ kind: 'media' })
    decoded.set(sha256, image)
  }
  for (const floor of staged.staged.project.floors) {
    const plan = floor.planImage
    if (plan === null) continue
    const image = decoded.get(plan.assetHash)
    if (image === undefined) return err({ kind: 'media' })
    if (image.widthPx !== plan.widthPx || image.heightPx !== plan.heightPx) return err({ kind: 'media' })
  }

  // Step 8, before the first write. `includeTrashed` is the whole check: a Project in the Trash
  // still holds its identity, and restoring over it silently would take a Project the user
  // deliberately put away.
  const listed = await deps.ports.projects.list({ includeTrashed: true })
  if (!listed.ok) return err({ kind: 'session', error: listed.error })
  const same = listed.value.find((record) => record.id === staged.staged.project.id)
  if (same === undefined) return ok({ staged: staged.staged, collision: null })

  const copyName = copyNameFor(
    staged.staged.project.meta.name,
    listed.value.map((record) => record.name),
  )
  return ok({ staged: staged.staged, collision: { existing: same, copyName } })
}

/**
 * What the user answered at the collision dialog (#50 §4 step 8).
 *
 * `'replace'` keeps the Backup's identity and puts the local state behind a Recovery Point;
 * `'copy'` keeps both Projects by giving the incoming one a brand-new identity through
 * `domain.remapIds`. Cancelling is not a choice: the dialog's third button closes it and this
 * function is never called.
 */
export type RestoreDecision = 'replace' | 'copy'

/**
 * What the user answered, shaped so the compiler enforces the dialog's promise.
 *
 * A colliding Backup cannot be committed without a decision, and a non-colliding one has
 * nothing to decide — the two cases are different values rather than one value with an optional
 * field that a caller could forget to fill in.
 */
export type RestoreCommitTarget =
  | { staged: StagedPackage; collision: null }
  | { staged: StagedPackage; collision: RestoreCollision; decision: RestoreDecision }

/**
 * Steps 9–10: write, read back, and undo the write if the read-back disagrees.
 */
export async function commitRestore(
  deps: RestoreDeps,
  target: RestoreCommitTarget,
): Promise<Result<RestoreApplied, RestoreProblem>> {
  if (target.collision === null) return writeNew(deps, target.staged)
  const { staged, collision, decision } = target
  return decision === 'replace' ? writeReplace(deps, staged, collision) : writeCopy(deps, staged, collision)
}

/** The assets a staged Backup carries, as the commit wants them, at the size the decoder saw. */
function newAssetsFor(staged: StagedPackage, decoded: Map<string, { widthPx: number; heightPx: number }>): NewAsset[] {
  return [...staged.assets].map(([sha256, asset]) => ({
    bytes: new Blob([asset.bytes as BlobPart], { type: asset.mediaType }),
    mediaType: asset.mediaType,
    widthPx: decoded.get(sha256)?.widthPx ?? null,
    heightPx: decoded.get(sha256)?.heightPx ?? null,
  }))
}

/**
 * Step 10: the Project is in the store, byte for byte, and so is every asset it references.
 *
 * The comparison is against canonical JSON rather than object identity because the adapter
 * round-trips through IndexedDB's structured clone, and because a `savedAt` or `revision` that
 * moved is not the Project moving. Asset presence is checked by hash: a Project that loads
 * perfectly and whose Plan Image is gone is a failed restore, and the Library would render it as
 * a broken card.
 */
async function verify(
  deps: RestoreDeps,
  id: string,
  project: Project,
  hashes: readonly string[],
): Promise<boolean> {
  const loaded = await deps.ports.projects.load(id)
  if (!loaded.ok) return false
  if (canonicalJson(loaded.value.data) !== canonicalJson(project)) return false
  for (const sha256 of hashes) {
    const present = await deps.ports.assets.has(sha256)
    if (!present.ok || present.value !== true) return false
  }
  return true
}

async function writeNew(deps: RestoreDeps, staged: StagedPackage): Promise<Result<RestoreApplied, RestoreProblem>> {
  const project = staged.project
  const committed = await deps.ports.projects.commit(
    { project, revision: 1, savedAt: deps.clock.now(), newAssets: newAssetsFor(staged, decodedOf(staged)) },
    null,
  )
  if (!committed.ok) return err({ kind: 'session', error: committed.error })

  const hashes = [...staged.assets.keys()]
  if (!(await verify(deps, project.id, project, hashes))) {
    await deps.ports.projects.purge(project.id)
    return err({ kind: 'unverified' })
  }
  return ok({ kind: 'new', id: project.id, name: project.meta.name, migratedFrom: staged.migratedFrom })
}

async function writeReplace(
  deps: RestoreDeps,
  staged: StagedPackage,
  collision: RestoreCollision,
): Promise<Result<RestoreApplied, RestoreProblem>> {
  const project = staged.project

  // #14: an open session holding unsaved changes for this Project is a block, not an overwrite.
  if (deps.registry.isGuarded(collision.existing.id)) return err({ kind: 'session', error: 'guarded' })

  const stored = await deps.ports.projects.load(collision.existing.id)
  if (!stored.ok) return err({ kind: 'session', error: stored.error })

  // The Recovery Point goes in first, in its own transaction, because the repair below reads it
  // back — a rollback that depends on a point that was never written is no repair at all.
  const point: RecoveryPoint = {
    id: deps.ids(1)[0],
    projectId: collision.existing.id,
    createdAt: deps.clock.now(),
    kind: 'pre-import-replace',
    revision: stored.value.revision,
    schemaVersion: stored.value.schemaVersion,
    summary: summarizeProject(stored.value.data),
    data: stored.value.data,
  }
  const created = await deps.ports.recovery.create(point)
  if (!created.ok) return err({ kind: 'session', error: created.error })

  const revision = stored.value.revision + 1
  const committed = await deps.ports.projects.commit(
    { project, revision, savedAt: deps.clock.now(), newAssets: newAssetsFor(staged, decodedOf(staged)) },
    stored.value.revision,
  )
  if (!committed.ok) return err({ kind: 'session', error: committed.error })

  // A Backup restored over a trashed Project brings it back: the user asked for that Project to
  // exist, and leaving it in the Trash under the name the dialog just said was replaced would
  // be a second surprise.
  if (collision.existing.trashedAt !== null) {
    const revived = await deps.ports.projects.restore(collision.existing.id)
    if (!revived.ok) return err({ kind: 'session', error: revived.error })
  }

  const hashes = [...staged.assets.keys()]
  if (!(await verify(deps, project.id, project, hashes))) {
    // Forward, never backwards: the previous state returns as the next revision, taken from the
    // Recovery Point this call wrote a moment ago.
    await deps.ports.projects.commit(
      { project: point.data, revision: revision + 1, savedAt: deps.clock.now() },
      revision,
    )
    return err({ kind: 'unverified' })
  }

  return ok({ kind: 'replace', id: project.id, name: project.meta.name, migratedFrom: staged.migratedFrom })
}

async function writeCopy(
  deps: RestoreDeps,
  staged: StagedPackage,
  collision: RestoreCollision,
): Promise<Result<RestoreApplied, RestoreProblem>> {
  const copyName = collision.copyName

  // Import as a copy (#50 §4 step 8): a brand-new identity for the Project and for every record
  // it owns, with every reference followed. `domain.remapIds` is a bijection, so two records
  // that shared an ID still share one, and two that did not still do not.
  const remapped = remapIds(staged.project, deps.ids(1)[0], (count) => deps.ids(count))
  const project: Project = { ...remapped, meta: { ...remapped.meta, name: copyName } }

  const committed = await deps.ports.projects.commit(
    { project, revision: 1, savedAt: deps.clock.now(), newAssets: newAssetsFor(staged, decodedOf(staged)) },
    null,
  )
  if (!committed.ok) return err({ kind: 'session', error: committed.error })

  const hashes = [...staged.assets.keys()]
  if (!(await verify(deps, project.id, project, hashes))) {
    await deps.ports.projects.purge(project.id)
    return err({ kind: 'unverified' })
  }

  return ok({ kind: 'copy', id: project.id, name: copyName, migratedFrom: staged.migratedFrom })
}

/**
 * The dimensions `newAssetsFor` writes with.
 *
 * `stageRestore` decoded every asset and checked the Plan Image records against it, so by the
 * time a commit runs the record *is* the decode. Re-deriving them from the records rather than
 * threading a map through the two calls keeps `commitRestore` free of a second argument that
 * would have to agree with the first — and a Backup that had not been decoded would have been
 * refused at step 7 and never reached here.
 */
function decodedOf(staged: StagedPackage): Map<string, { widthPx: number; heightPx: number }> {
  const byHash = new Map<string, { widthPx: number; heightPx: number }>()
  for (const floor of staged.project.floors) {
    const plan = floor.planImage
    if (plan !== null) byHash.set(plan.assetHash, { widthPx: plan.widthPx, heightPx: plan.heightPx })
  }
  return byHash
}

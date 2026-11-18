/**
 * The Migration review: the only path by which legacy BuildBox data becomes Projects
 * (#52, #20 §5, #14 "Legacy clean cutover").
 *
 * The seven steps of #20 §5 are in order here, and the one that decides everything sits where
 * the issue puts it — nothing reaches the store before step 6:
 *
 * - **Steps 1–5 are inspection.** `inspectMigration` holds the raw bytes in memory, runs #43's
 *   converter through the injected port, and turns its output into the model the review renders.
 *   It reads the store to answer two questions — does this identity already exist, is this name
 *   already used — and writes nothing.
 * - **The plan is a pure function of the review and the user's choices.** `buildMigrationPlan`
 *   is where "we will not guess" lives: a floor plan with no destination is a refusal, not a
 *   default, and `Skip` exists only for a floor plan that is genuinely empty.
 * - **Step 6 is one `commitMany`.** Every Project, Library record, asset and the single
 *   pre-migration Recovery Point land in one transaction, so a stale `expectedRevision` on the
 *   attach takes the whole migration down with it (#16).
 * - **Step 7 reads everything back and compares it canonically.** Only on full equality does
 *   `meta.legacyMigration` say the source is done. A mismatch puts the store back the way it
 *   was — new Projects purged, an attach reversed by a forward revision — and reports the stage
 *   it stopped at.
 *
 * The source is never written. There is no setter on `LegacySourcePort` for the same reason:
 * `Remove old copy` is a button the user presses and not something this module ever decides.
 *
 * No DOM, no clock, no random source and no storage technology is reached directly (#42 §3):
 * the converter, the clock and the ID allocator arrive as data, so the whole flow runs under
 * Node against the fakes in `./testing`.
 */
import {
  DOMAIN_SCHEMA_VERSION,
  referencedAssetHashes,
  remapIds,
  summarizeProject,
  type Project,
} from '../domain'
import { canonicalJson, sha256Hex } from '../lib'
import type {
  CommitEntry,
  LegacyMigrationRecord,
  LibraryRecord,
  NewAsset,
  Ports,
  PersistenceError,
  RecoveryPoint,
  Result,
} from '../persistence'
import {
  attachFloorPlan,
  floorPlanAsProject,
  type IdRegeneration,
  type LegacyConversion,
  type LegacyFloorPlanContent,
} from '../package'
import { encodeBackup, backupFileName, type BackupDeps } from './backup'
import { copyNameFor } from './restore'
import type { ClockPort, DownloadPort, IdSource, LegacyConvertPort, LegacySourcePort } from './ports'
import { err, ok } from './result'
import type { SessionRegistry } from './types'

/** Where the bytes being migrated came from (#52 §1). */
export type MigrationSourceKind = 'local-store' | 'workspace-file' | 'floor-plan-file'

/**
 * The six stages the Verify step names (#52 §4.5).
 *
 * Each is a piece of work this module performs and can therefore fail in: `read` is getting the
 * bytes, `convert` is #43's parse-and-map pass, `validate` is checking the user's destination
 * against what the store actually holds, `images` is assembling the asset records, `write` is
 * the one transaction, and `read-back` is the comparison that decides whether any of it counts.
 */
export type MigrationStage = 'read' | 'convert' | 'validate' | 'images' | 'write' | 'read-back'

/**
 * Why migration stopped, in the words the Verify step prints.
 *
 * `problems` carries #43's plain-words `message` values and nothing else: never a stack trace,
 * never a `path`, never a fragment of the user's data (#52 §4.5, §21, #19 §12).
 */
export interface MigrationFailure {
  stage: MigrationStage
  /** Plain sentences for a refusal the *data* caused; `ui/strings` owns these (#52 criterion 14). */
  problems: string[]
  /**
   * The store's own reason when the *store* refused. A `PersistenceError` kind is a word, not a
   * sentence and not a stack trace, so it can travel to `ui/strings`, which is where display text
   * lives — a migration failure never shows a reader a raw error.
   */
  storage?: PersistenceError['kind']
}

/** The raw source, kept whole so `Download original data` can be byte-identical (#52 §5). */
export interface MigrationSource {
  kind: MigrationSourceKind
  /** The exact string that was read: the store value, or the file decoded as UTF-8. */
  raw: string
  /** SHA-256 of `raw`'s bytes — the identity a completed migration is remembered by. */
  hash: string
}

/** One legacy `Design`, as the review lists it. */
export interface MigrationProposal {
  designId: string
  name: string
  /** `false` for a `Design` the converter refused; it will never become a Project. */
  migratable: boolean
  /** The Project this Design becomes, or `null` when it was refused. */
  project: Project | null
  /** The real counts behind the row's secondary line (#52 §4.4). */
  designCount: number
  itemCount: number
  hasPlanImage: boolean
  regeneratedIds: IdRegeneration[]
  /** Plain-words reasons a refusal happened, one per problem. */
  problems: string[]
  /** A local Project — Trash included — already holds this identity (#52 §4.4). */
  collision: LibraryRecord | null
  /** A different local Project already uses this name. Names are not identity. */
  nameTaken: boolean
}

/** The standalone floor plan, as the review's right-hand panel shows it. */
export interface MigrationFloorPlan {
  /** `false` when the floor plan itself was refused: it joins `Not migrated` instead. */
  usable: boolean
  /** `null` for a floor plan with no image, which the panel renders hatched. */
  preview: { widthPx: number; heightPx: number } | null
  itemCount: number
  /** No image, no objects, no annotations and no saved shapes — the only case `Skip` appears. */
  isEmpty: boolean
  regeneratedIds: IdRegeneration[]
  problems: string[]
}

/** Everything the review shows. */
export interface MigrationReview {
  source: { kind: MigrationSourceKind; hash: string }
  legacyVersion: 0 | 1 | 2 | 3
  /** The active `Design` first, then legacy array order (#20 §3). */
  proposals: MigrationProposal[]
  /** `null` when the source holds no floor plan at all — a workspace file (#52 §1.2). */
  floorPlan: MigrationFloorPlan | null
  discarded: { wallHack: number; tileZone: number }
}

/**
 * An inspection: the display model and the conversion it was built from.
 *
 * The plan is built from `conversion` and not from `review`, because the review deliberately
 * drops the floor-plan content a preview does not need.
 */
export interface InspectedMigration {
  review: MigrationReview
  conversion: LegacyConversion
}

/** Where the user said the floor plan belongs (#52 §3). */
export type FloorPlanDestination =
  /** One of the Projects this same review creates. */
  | { kind: 'proposed'; projectId: string }
  /** An existing local Project whose `Floor 1` has no Plan Image. */
  | { kind: 'existing'; projectId: string }
  | { kind: 'separate' }
  /** Only reachable for a floor plan `isEmpty` reports as true. */
  | { kind: 'skip' }

/**
 * The existing local Project an attach lands on, read before anything is written (#52 §2
 * step 6).
 *
 * The caller reads it and hands it in so the plan is built against the same revision the write
 * will name: a Project that moved underneath the review makes `commitMany` refuse, which is the
 * whole of criterion 16's stale-revision case.
 */
export interface MigrationAttachTarget {
  id: string
  record: LibraryRecord
  project: Project
  revision: number
}

/** What the user has chosen so far. */
export interface MigrationChoices {
  /** `null` until a destination is picked: there is no default and none is implied. */
  floorPlan: FloorPlanDestination | null
  /** Per Design whose legacy identity matches a local Project (#52 §4.4). */
  collisions: Record<string, 'replace' | 'copy'>
}

/** One option in the `Attach it to` select. */
export interface FloorPlanChoice {
  /** The `<option>` value: the destination, encoded as one string. */
  value: string
  label: string
  destination: FloorPlanDestination
}

export const FLOOR_PLAN_SKIP_VALUE = 'skip'
export const FLOOR_PLAN_SEPARATE_VALUE = 'separate'

export const floorPlanChoiceValue = (destination: FloorPlanDestination): string =>
  destination.kind === 'proposed'
    ? `proposed:${destination.projectId}`
    : destination.kind === 'existing'
      ? `existing:${destination.projectId}`
      : destination.kind

/**
 * The destinations the review offers, in the order the select lists them (#52 §3).
 *
 * Proposed Projects come first because on first launch they are the only realistic answer, and
 * existing ones are limited to a `Floor 1` with no Plan Image — attaching to a Floor that
 * already has one would silently discard an image nobody asked to lose. `Skip` appears for an
 * empty floor plan and for nothing else. Nothing here is pre-selected by the caller.
 */
export function floorPlanChoices(
  review: MigrationReview,
  existing: readonly LibraryRecord[],
): FloorPlanChoice[] {
  const choices: FloorPlanChoice[] = []
  for (const proposal of review.proposals) {
    if (!proposal.migratable) continue
    choices.push({
      value: `proposed:${proposal.designId}`,
      label: proposal.name,
      destination: { kind: 'proposed', projectId: proposal.designId },
    })
  }
  for (const record of existing) {
    if (record.trashedAt !== null) continue
    if (record.summary.previewAssetHash !== null) continue
    choices.push({
      value: `existing:${record.id}`,
      label: record.name,
      destination: { kind: 'existing', projectId: record.id },
    })
  }
  choices.push({ value: FLOOR_PLAN_SEPARATE_VALUE, label: '', destination: { kind: 'separate' } })
  if (review.floorPlan?.isEmpty === true) {
    choices.push({ value: FLOOR_PLAN_SKIP_VALUE, label: '', destination: { kind: 'skip' } })
  }
  return choices
}

/** One Project the migration will write, and how. */
export interface MigrationPlanProject {
  id: string
  name: string
  project: Project
  revision: number
  expectedRevision: number | null
  /** `new` is a fresh identity, `replace` answers an ID collision, `attach` is the floor plan's chosen home. */
  kind: 'new' | 'replace' | 'copy' | 'attach'
  /** The state a `replace` or `attach` overwrote, kept so a failed read-back can put it back. */
  previous: Project | null
  /** The pre-change snapshot written in the same transaction (#52 §2 step 6). */
  recoveryPoint: RecoveryPoint | null
  /** The floor plan landed on this Project. */
  floorPlanHere: boolean
  /** The Design this row came from, for the result list. */
  designId: string | null
}

/** The whole of one migration, decided before anything is written. */
export interface MigrationPlan {
  projects: MigrationPlanProject[]
  /** Every asset the batch writes, by hash; each entry is given the ones it references. */
  assets: Map<string, NewAsset>
  /** Each `Design` that will not be migrated, in the plain words the review showed. */
  notMigrated: Array<{ designName: string; problem: string }>
  discardedSketches: number
  floorPlan:
    | { kind: 'attached'; projectId: string; projectName: string }
    | { kind: 'separate'; projectId: string; projectName: string }
    | { kind: 'skipped' }
    | null
}

/** What a finished migration did, for the Back up step. */
export interface MigrationResult {
  projects: Array<{ id: string; name: string; kind: MigrationPlanProject['kind']; floorPlan: boolean }>
  floorPlan: MigrationPlan['floorPlan']
  notMigrated: MigrationPlan['notMigrated']
  discardedSketches: number
  record: LegacyMigrationRecord
}

/** Everything migration needs from outside. */
export interface MigrationDeps {
  ports: Ports
  clock: ClockPort
  ids: IdSource
  registry: SessionRegistry
  /** #43's converter as a seam, so each stage can be stopped on demand (#52 criterion 11). */
  convert: LegacyConvertPort
  /** The browser's legacy value. Absent for a file source, which has nothing to remove. */
  source?: LegacySourcePort
  download?: DownloadPort
}

/** The name `Create a separate Project` gives, suffixed ` 2`, ` 3`… when taken (#52 §3). */
function suffixedName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name
  for (let n = 2; ; n += 1) {
    const candidate = `${name} ${n}`
    if (!taken.has(candidate)) return candidate
  }
}

/** The plain-words half of #43's problems, which is all a user is ever shown. */
const messages = (problems: Array<{ message: string }>): string[] => problems.map((problem) => problem.message)

/**
 * Which stage a source-level conversion failure belongs to (#52 §4.5).
 *
 * `package/legacy` reports one flat list of problems for a source it cannot use at all. The
 * three codes that mean "these bytes are not legacy data" happened while reading; a bad data URL
 * is the image step; everything else is the mapping and migrators.
 */
function conversionStage(problem: { code: string }): MigrationStage {
  if (problem.code === 'bad-json') return 'read'
  if (problem.code === 'bad-data-url') return 'images'
  return 'convert'
}

/** SHA-256 of a source's bytes, the identity `meta.legacyMigration` records (#52 §1.3). */
export async function sourceHash(raw: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(raw))
}

/**
 * Whether these bytes are legacy data Restore Backup must hand to this review (#52 §1.2).
 *
 * The sniff mirrors `convertLegacy`'s — `state` is the store envelope, `projects` is a workspace
 * file, a floor-plan key is a floor-plan file — and stops there. This function only decides
 * *where a file goes*; `package/legacy` stays the only thing that parses it, so a file this
 * recognises and the converter rejects still reaches the user as one refusal from one place.
 */
export function legacyFileKind(text: string): MigrationSourceKind | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const keys = parsed as Record<string, unknown>
  if ('state' in keys) return 'local-store'
  if ('projects' in keys) return 'workspace-file'
  if ('pixelsPerMm' in keys || 'image' in keys || 'objects' in keys || 'annotations' in keys || 'customTemplates' in keys) {
    return 'floor-plan-file'
  }
  return null
}

/**
 * Steps 1–5: read, convert, and build the model the review renders.
 *
 * Nothing is written. The store is read only to answer the two questions the review cannot
 * answer from the source alone — is this Project identity already taken, is this name already
 * used — and both answers are about what already exists, never about what to do next.
 */
export async function inspectMigration(
  deps: MigrationDeps,
  source: MigrationSource,
  existing: readonly LibraryRecord[],
): Promise<Result<InspectedMigration, MigrationFailure>> {
  const converted = await deps.convert(source.raw, { newId: () => deps.ids(1)[0] })
  if (!converted.ok) {
    return err({
      stage: conversionStage(converted.problems[0] ?? { code: 'unknown-source' }),
      problems: messages(converted.problems),
    })
  }

  const conversion = converted.conversion
  const byId = new Map(existing.map((record) => [record.id, record]))
  const proposals: MigrationProposal[] = conversion.projects.map((proposal) => {
    const project = proposal.status === 'ok' ? proposal.project : null
    const held = byId.get(proposal.designId) ?? null
    return {
      designId: proposal.designId,
      name: proposal.name,
      migratable: proposal.status === 'ok',
      project,
      designCount: project?.itemDesigns.length ?? 0,
      itemCount: project?.existingModel.placedItems.length ?? 0,
      hasPlanImage: project?.floors.some((floor) => floor.planImage !== null) ?? false,
      regeneratedIds: proposal.status === 'ok' ? proposal.regeneratedIds : [],
      problems: proposal.status === 'ok' ? [] : messages(proposal.problems),
      collision: held,
      nameTaken: held === null && existing.some((record) => record.name === proposal.name),
    }
  })

  const plan = conversion.floorPlan
  const floorPlan: MigrationFloorPlan | null =
    plan === null
      ? null
      : plan.status === 'rejected'
        ? {
            usable: false,
            preview: null,
            itemCount: 0,
            isEmpty: false,
            regeneratedIds: [],
            problems: messages(plan.problems),
          }
        : {
            usable: true,
            preview:
              plan.content.planImage === null
                ? null
                : { widthPx: plan.content.planImage.widthPx, heightPx: plan.content.planImage.heightPx },
            itemCount: plan.content.placements.length,
            isEmpty: plan.isEmpty,
            regeneratedIds: plan.regeneratedIds,
            problems: [],
          }

  return ok({
    review: {
      source: { kind: source.kind, hash: source.hash },
      legacyVersion: conversion.legacyVersion,
      proposals,
      floorPlan,
      discarded: plan !== null && plan.status === 'ok' ? plan.discarded : { wallHack: 0, tileZone: 0 },
    },
    conversion,
  })
}

/** The floor-plan content of a usable conversion, or the refusal that stands in for it. */
function floorPlanContent(conversion: LegacyConversion): LegacyFloorPlanPlan | null {
  const plan = conversion.floorPlan
  if (plan === null || plan.status === 'rejected') return null
  return { content: plan.content, isEmpty: plan.isEmpty }
}

interface LegacyFloorPlanPlan {
  content: LegacyFloorPlanContent
  isEmpty: boolean
}

/**
 * The plan, as a pure function of the review and the user's choices (#52 §2 step 4).
 *
 * Three rules make this the place "we will not guess" is enforced rather than merely promised:
 * a floor plan with no destination is a refusal, `Skip` is refused for a floor plan that is not
 * empty, and a Design whose identity is already held is refused until the collision has been
 * answered. Nothing here reads the clock or the store.
 */
export function buildMigrationPlan(
  deps: MigrationDeps,
  inspected: InspectedMigration,
  existing: readonly LibraryRecord[],
  choices: MigrationChoices,
  /** The stored state of the Project an attach lands on, read by the caller before writing. */
  attachTarget: MigrationAttachTarget | null,
): Result<MigrationPlan, MigrationFailure> {
  const { review, conversion } = inspected
  const taken = new Set(existing.map((record) => record.name))
  const notMigrated: MigrationPlan['notMigrated'] = []
  const projects: MigrationPlanProject[] = []
  const validate = (problems: string[]): Result<MigrationPlan, MigrationFailure> =>
    err({ stage: 'validate', problems })

  for (const proposal of review.proposals) {
    if (!proposal.migratable || proposal.project === null) {
      for (const problem of proposal.problems) notMigrated.push({ designName: proposal.name, problem })
      continue
    }
    const collision = proposal.collision
    if (collision === null) {
      projects.push({
        id: proposal.designId,
        name: proposal.name,
        project: proposal.project,
        revision: 1,
        expectedRevision: null,
        kind: 'new',
        previous: null,
        recoveryPoint: null,
        floorPlanHere: false,
        designId: proposal.designId,
      })
      taken.add(proposal.name)
      continue
    }

    const decision = choices.collisions[proposal.designId]
    if (decision === undefined) {
      return validate([`A Project named ${collision.name} already exists with the same identity.`])
    }
    if (decision === 'copy') {
      const remapped = remapIds(proposal.project, deps.ids(1)[0], (count) => deps.ids(count))
      const name = copyNameFor(proposal.name, taken)
      projects.push({
        id: remapped.id,
        name,
        project: { ...remapped, meta: { ...remapped.meta, name } },
        revision: 1,
        expectedRevision: null,
        kind: 'copy',
        previous: null,
        recoveryPoint: null,
        floorPlanHere: false,
        designId: proposal.designId,
      })
      taken.add(name)
      continue
    }
    projects.push({
      id: proposal.designId,
      name: proposal.name,
      project: { ...proposal.project, meta: { ...proposal.project.meta, name: proposal.name } },
      revision: collision.revision + 1,
      expectedRevision: collision.revision,
      kind: 'replace',
      previous: null,
      recoveryPoint: null,
      floorPlanHere: false,
      designId: proposal.designId,
    })
  }

  const held = floorPlanContent(conversion)
  let floorPlan: MigrationPlan['floorPlan'] = null
  if (held !== null) {
    const destination = choices.floorPlan
    if (destination === null) {
      return validate(['Choose where the floor plan belongs.'])
    }
    if (destination.kind === 'skip') {
      if (!held.isEmpty) return validate(['The floor plan holds work, so it cannot be skipped.'])
      floorPlan = { kind: 'skipped' }
    } else if (destination.kind === 'separate') {
      const name = suffixedName('Floor plan', taken)
      const made = floorPlanAsProject(held.content, {
        projectId: deps.ids(1)[0],
        name,
        floorId: deps.ids(1)[0],
        newId: () => deps.ids(1)[0],
      })
      if (!made.ok) return validate(messages(made.problems))
      taken.add(name)
      projects.push({
        id: made.project.id,
        name,
        project: made.project,
        revision: 1,
        expectedRevision: null,
        kind: 'new',
        previous: null,
        recoveryPoint: null,
        floorPlanHere: true,
        designId: null,
      })
      floorPlan = { kind: 'separate', projectId: made.project.id, projectName: name }
    } else if (destination.kind === 'proposed') {
      const host = projects.find((entry) => entry.id === destination.projectId)
      if (host === undefined) return validate(['The Project the floor plan was sent to is not being created.'])
      const floor = host.project.floors[0]
      const attached = attachFloorPlan(host.project, held.content, {
        floorId: floor?.id ?? '',
        newId: () => deps.ids(1)[0],
      })
      if (!attached.ok) return validate(messages(attached.problems))
      host.project = attached.project
      host.floorPlanHere = true
      floorPlan = { kind: 'attached', projectId: host.id, projectName: host.name }
    } else {
      if (attachTarget === null || attachTarget.id !== destination.projectId) {
        return validate(['The Project the floor plan was sent to could not be read.'])
      }
      if (deps.registry.isGuarded(attachTarget.id)) {
        return err({ stage: 'validate', problems: ['That Project is open in another tab with unsaved changes.'] })
      }
      const floor = attachTarget.project.floors[0]
      const attached = attachFloorPlan(attachTarget.project, held.content, {
        floorId: floor?.id ?? '',
        newId: () => deps.ids(1)[0],
      })
      if (!attached.ok) return validate(messages(attached.problems))
      const name = attachTarget.record.name
      const point: RecoveryPoint = {
        id: deps.ids(1)[0],
        projectId: attachTarget.id,
        createdAt: deps.clock.now(),
        kind: 'pre-migration',
        revision: attachTarget.revision,
        schemaVersion: DOMAIN_SCHEMA_VERSION,
        summary: summarizeProject(attachTarget.project),
        data: attachTarget.project,
      }
      projects.push({
        id: attachTarget.id,
        name,
        project: attached.project,
        revision: attachTarget.revision + 1,
        expectedRevision: attachTarget.revision,
        kind: 'attach',
        previous: attachTarget.project,
        recoveryPoint: point,
        floorPlanHere: true,
        designId: null,
      })
      floorPlan = { kind: 'attached', projectId: attachTarget.id, projectName: name }
    }
  } else if (review.floorPlan !== null && !review.floorPlan.usable) {
    for (const problem of review.floorPlan.problems) notMigrated.push({ designName: 'Floor plan', problem })
  }

  if (projects.length === 0) return validate(['There is nothing left to migrate.'])

  const assets = new Map<string, NewAsset>()
  const dims = new Map<string, { widthPx: number; heightPx: number }>()
  for (const entry of projects) {
    for (const floor of entry.project.floors) {
      if (floor.planImage !== null) {
        dims.set(floor.planImage.assetHash, { widthPx: floor.planImage.widthPx, heightPx: floor.planImage.heightPx })
      }
    }
  }
  for (const asset of conversion.assets) {
    const size = dims.get(asset.sha256)
    if (size === undefined) continue
    assets.set(asset.sha256, {
      bytes: new Blob([asset.bytes as BlobPart], { type: asset.mediaType }),
      mediaType: asset.mediaType,
      widthPx: size.widthPx,
      heightPx: size.heightPx,
    })
  }

  return ok({
    projects,
    assets,
    notMigrated,
    discardedSketches: review.discarded.wallHack + review.discarded.tileZone,
    floorPlan,
  })
}

/** The assets one planned Project references, as the commit wants them. */
function assetsFor(entry: MigrationPlanProject, assets: ReadonlyMap<string, NewAsset>): NewAsset[] {
  const referenced: NewAsset[] = []
  for (const hash of referencedAssetHashes(entry.project)) {
    const asset = assets.get(hash)
    if (asset !== undefined) referenced.push(asset)
  }
  return referenced
}

/**
 * Step 7: every Project is in the store byte for byte, and so is every asset it references.
 *
 * Canonical JSON rather than object identity, because the adapter round-trips through
 * structured clone and because a `savedAt` that moved is not the Project moving (#50's rule,
 * applied to a batch).
 */
async function verifyWritten(
  deps: MigrationDeps,
  plan: MigrationPlan,
): Promise<{ ok: true } | { ok: false; failedId: string }> {
  for (const entry of plan.projects) {
    const loaded = await deps.ports.projects.load(entry.id)
    if (!loaded.ok) return { ok: false, failedId: entry.id }
    if (canonicalJson(loaded.value.data) !== canonicalJson(entry.project)) return { ok: false, failedId: entry.id }
    for (const hash of referencedAssetHashes(entry.project)) {
      const present = await deps.ports.assets.has(hash)
      if (!present.ok || present.value !== true) return { ok: false, failedId: entry.id }
    }
  }
  return { ok: true }
}

/**
 * Undo a batch that wrote but did not verify.
 *
 * A Project this migration created is purged, which leaves nothing. A Project it changed is put
 * back by a forward revision from the state the plan recorded — never by editing history, and
 * never by reading the Recovery Point back, which is why the point can live inside the same
 * transaction as the change it protects.
 */
async function undoPlan(deps: MigrationDeps, plan: MigrationPlan): Promise<void> {
  for (const entry of plan.projects) {
    if (entry.previous === null) {
      await deps.ports.projects.purge(entry.id)
      continue
    }
    await deps.ports.projects.commit(
      { project: entry.previous, revision: entry.revision + 1, savedAt: deps.clock.now() },
      entry.revision,
    )
  }
}

/**
 * Steps 6–7: one transaction, then the read-back that decides whether it counts.
 *
 * The plan is already built and already carries the user's choices, so nothing here can be
 * influenced by what the store says — the store is only asked to hold these bytes, and then to
 * give them back.
 */
export async function runMigration(
  deps: MigrationDeps,
  inspected: InspectedMigration,
  plan: MigrationPlan,
): Promise<Result<MigrationResult, MigrationFailure>> {
  // Step 5, `Saving images`, happens on its own so a store that has run out of room says so
  // while the copy still says *images* and not *Projects*. The same bytes go into the
  // transaction below as well — `assets.put` is idempotent and deduplicated by hash, so the
  // second sight of them stores nothing, and the transaction stays the atomic unit it was.
  for (const asset of plan.assets.values()) {
    const stored = await deps.ports.assets.put(
      asset.bytes,
      asset.mediaType,
      { widthPx: asset.widthPx, heightPx: asset.heightPx },
      deps.clock.now(),
    )
    if (!stored.ok) return err({ stage: 'images', problems: [], storage: stored.error.kind })
  }

  const entries: CommitEntry[] = plan.projects.map((entry) => ({
    input: {
      project: entry.project,
      revision: entry.revision,
      savedAt: deps.clock.now(),
      newAssets: assetsFor(entry, plan.assets),
    },
    expectedRevision: entry.expectedRevision,
    ...(entry.recoveryPoint === null ? {} : { recoveryPoint: entry.recoveryPoint }),
  }))

  const written = await deps.ports.projects.commitMany(entries)
  if (!written.ok) {
    // The transaction refused, so there is nothing to undo: no Project, no Library record and no
    // Recovery Point reached the store (#52 criterion 11).
    return err({ stage: 'write', problems: [], storage: written.error.kind })
  }

  const verified = await verifyWritten(deps, plan)
  if (!verified.ok) {
    await undoPlan(deps, plan)
    return err({ stage: 'read-back', problems: [] })
  }

  const completedAt = deps.clock.now()
  const record: LegacyMigrationRecord = {
    status: 'complete',
    sourceHash: inspected.review.source.hash,
    completedAt,
    projectIds: plan.projects.map((entry) => entry.id),
    notMigrated: plan.notMigrated,
    discardedSketches: plan.discardedSketches,
    removedAt: null,
  }
  const stored = await deps.ports.meta.set('legacyMigration', record)
  if (!stored.ok) {
    // No completion record means the review will be offered again for this source, and a second
    // run would collide with the first. Refusing the whole migration is the honest answer.
    await undoPlan(deps, plan)
    return err({ stage: 'write', problems: [], storage: stored.error.kind })
  }

  return ok({
    projects: plan.projects.map((entry) => ({
      id: entry.id,
      name: entry.name,
      kind: entry.kind,
      floorPlan: entry.floorPlanHere,
    })),
    floorPlan: plan.floorPlan,
    notMigrated: plan.notMigrated,
    discardedSketches: plan.discardedSketches,
    record,
  })
}

/**
 * Whether the review should open for this source at all (#52 §1.1, §1.3, criterion 20).
 *
 * The test is about the data and not about the app: a `buildbox-store` whose bytes have changed
 * since the completed migration is a different source, so it is offered again and the Projects
 * the first run wrote are left alone — the collision they now create is answered per Design, the
 * same way a colliding Backup is.
 */
export function isAlreadyMigrated(record: LegacyMigrationRecord | null | undefined, hash: string): boolean {
  return record?.status === 'complete' && record.sourceHash === hash
}

/**
 * `Download old data as Backup` (#52 §5): one ordinary `.buildbox` per migratable Project.
 *
 * The bytes come from the in-memory plan and the in-memory assets, because this action is
 * offered before anything has been written and on a device where nothing can be. With no
 * destination chosen the floor plan stands up its own Project rather than being left out —
 * a Backup that quietly drops half the source would be worse than one extra file.
 */
export async function downloadOldBackups(
  deps: MigrationDeps & { download: DownloadPort; backup: BackupDeps },
  inspected: InspectedMigration,
  existing: readonly LibraryRecord[],
  choices: MigrationChoices,
  attachTarget: MigrationAttachTarget | null,
): Promise<Result<string[], MigrationFailure>> {
  const plan = buildMigrationPlan(deps, inspected, existing, {
    ...choices,
    floorPlan: choices.floorPlan ?? (inspected.review.floorPlan === null ? null : { kind: 'separate' }),
  }, attachTarget)
  if (!plan.ok) return err(plan.error)

  const names: string[] = []
  for (const entry of plan.value.projects) {
    const encoded = await encodeBackup(deps.backup, entry.project, async (sha256) => {
      const asset = plan.value.assets.get(sha256)
      if (asset === undefined) return null
      return { sha256, bytes: new Uint8Array(await asset.bytes.arrayBuffer()), mediaType: asset.mediaType }
    })
    if (!encoded.ok) return err({ stage: 'write', problems: [] })
    const fileName = backupFileName(entry.name)
    deps.download.start(fileName, encoded.value)
    names.push(fileName)
  }
  return ok(names)
}

/**
 * `Download original data` (#52 §5): the exact bytes that were read, as one file.
 *
 * This is the only place the discarded `wall-hack` and `tile-zone` sketches survive, which is
 * why it is offered inside the `Remove old copy` confirmation and not only on the failure page.
 */
export function downloadOriginalData(deps: MigrationDeps & { download: DownloadPort }, source: MigrationSource): void {
  deps.download.start('buildbox-original-data.json', new TextEncoder().encode(source.raw))
}

/**
 * `Remove old copy` (#52 §4.7): the one place the legacy value is deleted, and the one place
 * `removedAt` is written.
 *
 * Only the `buildbox-store` key goes. The completion record stays — with `removedAt` set, so the
 * Library can hide the navigation item while a later device that somehow has the same bytes
 * still knows what happened to them.
 */
export async function removeOldCopy(
  deps: MigrationDeps & { source: LegacySourcePort },
  source: MigrationSource,
): Promise<Result<LegacyMigrationRecord, MigrationFailure>> {
  const stored = await deps.ports.meta.get('legacyMigration')
  if (!stored.ok) return err({ stage: 'write', problems: [] })
  const record = stored.value
  if (record === undefined || !isAlreadyMigrated(record, source.hash)) {
    return err({ stage: 'validate', problems: [] })
  }

  deps.source.remove()
  const next: LegacyMigrationRecord = { ...record, removedAt: deps.clock.now() }
  const written = await deps.ports.meta.set('legacyMigration', next)
  if (!written.ok) return err({ stage: 'write', problems: [] })
  return ok(next)
}

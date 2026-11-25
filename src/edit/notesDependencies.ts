/**
 * The Notes dependency review (#82).
 *
 * #80 and #81 refused an edit that would strand a note: `has-dependants`, "delete or move them
 * first", and a user left hunting down eight Comments one at a time. This is the other answer — the
 * same question asked once, with a choice per note. {@link notesDependencyReport} compares the
 * Project an Intent starts from with the Project it would produce and lists every note that would be
 * left pointing at something that is no longer there; {@link applyNotesResolutions} carries the
 * user's answer to each of them into that same transaction.
 *
 * The question is asked of the two Projects rather than of the Intent type, for the same reason
 * {@link anchorResolves} is consulted that way by the deletion guard: it is what the finished Project
 * looks like that strands a note, so a delete, a cabinet edit that drops a node, a Floor removal and
 * any command the catalogue gains next are answered by one rule — and an edit that keeps every Anchor
 * resolvable (moving a Wall, thickening it, resizing a cabinet) produces no report at all, because
 * there is nothing to ask about.
 *
 * Nothing here suggests a target. The report lists the choices a note's kind allows and the targets
 * that exist; which of them the user wants is only ever in the Intent that comes back.
 */
import {
  ANNOTATION_SCOPE_ALL,
  COMMENT_SCOPE_ALL,
  anchorChoosesScope,
  cabinetFeatureIds,
  compareAnnotationReferences,
  compareCommentReferences,
  designOptionsOf,
  ENTITY_COLLECTION_KEYS,
  isAnnotationScopeAll,
  isCommentScopeAll,
  ownerKindOfCollection,
  registeredFeatureIds,
  savedViewsOf,
} from '../domain'
import type {
  Annotation,
  Comment,
  CommentAnchor,
  CommentScope,
  EntityAnchor,
  EntityId,
  FeatureAnchor,
  FeatureOwnerKind,
  ItemDesign,
  Point2,
  Project,
} from '../domain'
import { commentAnchorPoint, deriveWalls, effectiveCommentScope } from '../derive'
import { canonicalJson } from '../lib'
import { anchorResolves, nameOf, targetLabel } from './anchoredComments'
import { refuse } from './handlers/support'
import type {
  NotesChoice,
  NotesDependencyReport,
  NotesDependencyRow,
  NotesResolution,
  NotesRowNote,
  NotesSubject,
  NotesTargetRef,
} from './intents'

/** One Room, Building Element or Placed Item, with the two answers the review needs about it. */
interface EntityEntry {
  readonly record: Record<string, unknown>
  readonly ownerKind: FeatureOwnerKind
  readonly floorId: EntityId | null
  /** The Design Option that drew it, or `null` for the baseline's own. */
  readonly optionId: EntityId | null
}

/** Every entity of one model — the baseline's or one Option's — keyed by ID. */
function indexModel(model: Record<string, unknown>, optionId: EntityId | null, into: Map<EntityId, EntityEntry>): void {
  for (const key of ENTITY_COLLECTION_KEYS) {
    const list = model[key]
    if (!Array.isArray(list)) continue
    for (const entry of list) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
      const record = entry as Record<string, unknown>
      if (typeof record.id !== 'string') continue
      into.set(record.id, {
        record,
        ownerKind: ownerKindOfCollection(key, record.shape === 'riser' ? 'riser' : 'run'),
        floorId: typeof record.floorId === 'string' ? record.floorId : null,
        optionId,
      })
    }
  }
}

/** Every entity of a Project, baseline and Options together. */
function entityIndex(project: Project): Map<EntityId, EntityEntry> {
  const index = new Map<EntityId, EntityEntry>()
  indexModel(project.existingModel as unknown as Record<string, unknown>, null, index)
  for (const option of designOptionsOf(project)) {
    indexModel(option.proposed as unknown as Record<string, unknown>, option.id, index)
  }
  return index
}

/** What one Intent takes out of the Project, worked out by comparing the two Projects. */
interface Removed {
  readonly floors: ReadonlySet<EntityId>
  readonly options: ReadonlySet<EntityId>
  readonly views: ReadonlySet<EntityId>
  readonly entities: ReadonlySet<EntityId>
  readonly designs: ReadonlySet<EntityId>
  /** Each owner that survives, with the features it registered before and does not now. */
  readonly features: ReadonlyMap<EntityId, readonly string[]>
  /** Whether nothing at all went, which is the common case and needs no second look. */
  readonly empty: boolean
}

const idSet = (records: readonly { readonly id: EntityId }[]): Set<EntityId> => new Set(records.map((record) => record.id))

/** The IDs `before` had and `after` does not. */
function gone(before: Iterable<EntityId>, after: ReadonlySet<EntityId>): Set<EntityId> {
  const out = new Set<EntityId>()
  for (const id of before) if (!after.has(id)) out.add(id)
  return out
}

/** The cabinet nodes of one design, or `null` when it registers no features at all. */
const cabinetNodes = (design: ItemDesign | undefined): string[] | null =>
  design === undefined || design.kind !== 'cabinet' ? null : cabinetFeatureIds(design.construction.root)

/**
 * What went between the two Projects.
 *
 * A record that merely moves from the baseline into an Option, or between Options, is still there and
 * is not gone: the review asks about existence, not about which container holds the record.
 */
function removedBetween(before: Project, after: Project): Removed {
  const beforeEntities = entityIndex(before)
  const afterEntities = entityIndex(after)
  const floors = gone(idSet(before.floors), idSet(after.floors))
  const options = gone(idSet(designOptionsOf(before)), idSet(designOptionsOf(after)))
  const views = gone(idSet(savedViewsOf(before)), idSet(savedViewsOf(after)))
  const entities = gone(beforeEntities.keys(), new Set(afterEntities.keys()))
  const designs = gone(idSet(before.itemDesigns), idSet(after.itemDesigns))

  const features = new Map<EntityId, readonly string[]>()
  for (const [ownerId, entry] of beforeEntities) {
    const survivor = afterEntities.get(ownerId)
    if (survivor === undefined) continue
    const was = registeredFeatureIds(entry.ownerKind)
    const now = registeredFeatureIds(survivor.ownerKind)
    if (was === null || now === null) continue
    const missing = was.filter((featureId) => !now.includes(featureId))
    if (missing.length > 0) features.set(ownerId, missing)
  }
  for (const design of before.itemDesigns) {
    if (designs.has(design.id)) continue
    const was = cabinetNodes(design)
    const now = cabinetNodes(after.itemDesigns.find((each) => each.id === design.id))
    if (was === null || now === null) continue
    const missing = was.filter((featureId) => !now.includes(featureId))
    if (missing.length > 0) features.set(design.id, missing)
  }

  return {
    floors,
    options,
    views,
    entities,
    designs,
    features,
    empty:
      floors.size === 0 &&
      options.size === 0 &&
      views.size === 0 &&
      entities.size === 0 &&
      designs.size === 0 &&
      features.size === 0,
  }
}

/** Whether a saved view — Plan, Elevation, or the Item Detail of a design — is still there. */
function viewSurvives(project: Project, viewId: EntityId): boolean {
  return (
    project.views.some((view) => view.id === viewId) ||
    (project.elevationViews?.some((view) => view.id === viewId) ?? false) ||
    project.itemDesigns.some((design) => design.id === viewId)
  )
}

/** The name a view is known by, read out of the Project the review was asked about. */
function viewName(project: Project, viewId: EntityId): string | null {
  const view = savedViewsOf(project).find((each) => each.id === viewId)
  if (view !== undefined) return view.name
  const design = project.itemDesigns.find((each) => each.id === viewId)
  return design === undefined ? null : design.name
}

/** Why one note is on the list, which decides the row's shape and its choices. */
type Reason = 'anchor' | 'endpoint' | 'view' | 'marker' | 'scope'

/** The thing an Annotation's endpoint is anchored to, or `null` when the endpoint stands free. */
const anchoredOf = (endpoint: Annotation['endpoint']): EntityAnchor | FeatureAnchor | null =>
  endpoint !== undefined && 'anchor' in endpoint ? endpoint.anchor : null

/** One stranded note, before it is dressed as a row. */
interface Stranded {
  readonly kind: 'comment' | 'annotation'
  readonly id: EntityId
  readonly reference: string
  /** The Comment's title, or the Annotation's text. */
  readonly title: string
  readonly reason: Reason
  /** The Anchor the note is about, or `null` when it hangs off a view rather than a thing. */
  readonly anchor: CommentAnchor | null
  readonly status: Comment['status'] | null
  readonly annotationType: Annotation['type'] | null
  readonly viewId: EntityId | null
  readonly targetViewId: EntityId | null
}

/** Which notes the finished Project would leave pointing at nothing. */
function strandedNotes(before: Project, after: Project, removed: Removed): Stranded[] {
  const stranded: Stranded[] = []
  const knownComments = new Set(before.comments.map((comment) => comment.id))
  for (const comment of after.comments) {
    if (!knownComments.has(comment.id)) continue
    const strandedByScope =
      comment.scope !== undefined && !isCommentScopeAll(comment.scope) && removed.options.has(comment.scope)
    if (!anchorResolves(after, comment.anchor) || strandedByScope) {
      stranded.push({
        kind: 'comment',
        id: comment.id,
        reference: comment.reference,
        title: comment.title,
        reason: strandedByScope && anchorResolves(after, comment.anchor) ? 'scope' : 'anchor',
        anchor: comment.anchor,
        status: comment.status,
        annotationType: null,
        viewId: null,
        targetViewId: null,
      })
    }
  }
  const knownAnnotations = new Set(before.annotations.map((annotation) => annotation.id))
  for (const annotation of after.annotations) {
    if (!knownAnnotations.has(annotation.id)) continue
    const endpoint = anchoredOf(annotation.endpoint)
    const reason: Reason | null = !viewSurvives(after, annotation.viewId)
      ? 'view'
      : annotation.targetViewId !== undefined && !viewSurvives(after, annotation.targetViewId)
        ? 'marker'
        : endpoint !== null && !anchorResolves(after, endpoint)
          ? 'endpoint'
          : !isAnnotationScopeAll(annotation.scope) && removed.options.has(annotation.scope)
            ? 'scope'
            : null
    if (reason === null) continue
    stranded.push({
      kind: 'annotation',
      id: annotation.id,
      reference: annotation.reference,
      title: annotation.text,
      reason,
      anchor: reason === 'endpoint' ? endpoint : null,
      status: null,
      annotationType: annotation.type,
      viewId: annotation.viewId,
      targetViewId: annotation.targetViewId ?? null,
    })
  }
  return stranded
}

/** The first of these IDs that still has a name in the Project the edit started from. */
function firstLabel(ids: Iterable<EntityId>, pick: (id: EntityId) => string | null, fallback: string): string {
  for (const id of ids) {
    const label = pick(id)
    if (label !== null) return label
  }
  return fallback
}

/**
 * The heading's subject: what the operation is doing to the thing the notes hang off.
 *
 * A Floor deletion takes its entities, its views and its Comments with it, and the question the user
 * is answering is about the Floor; so the families are ranked by how much the operation swallows. The
 * label is read out of the Project the edit started from, because the thing that has gone has only
 * there still got a name.
 */
function subjectOf(
  before: Project,
  beforeEntities: Map<EntityId, EntityEntry>,
  removed: Removed,
  stranded: readonly Stranded[],
): NotesSubject {
  if (removed.floors.size > 0) {
    return { kind: 'floor', label: firstLabel(removed.floors, (id) => before.floors.find((each) => each.id === id)?.name ?? null, 'Floor') }
  }
  if (removed.options.size > 0) {
    return {
      kind: 'design_option',
      label: firstLabel(removed.options, (id) => designOptionsOf(before).find((each) => each.id === id)?.name ?? null, 'Design Option'),
    }
  }
  if (removed.views.size > 0) {
    return { kind: 'view', label: firstLabel(removed.views, (id) => viewName(before, id), 'View') }
  }
  if (removed.entities.size > 0) {
    // The name the note itself gives the target, when a note is about an entity: the operation may
    // take a dozen records with it, and the one the user is being asked about is the one a note was
    // written against.
    let preferred: Iterable<EntityId> = removed.entities
    for (const entry of stranded) {
      const anchor = entry.anchor
      if (anchor !== null && anchor.kind === 'entity' && removed.entities.has(anchor.entityId)) {
        preferred = [anchor.entityId]
        break
      }
    }
    return {
      kind: 'entity',
      label: firstLabel(
        preferred,
        (id) => {
          const hit = beforeEntities.get(id)
          return hit === undefined ? null : nameOf(hit.record)
        },
        'Element',
      ),
    }
  }
  if (removed.designs.size > 0) {
    return {
      kind: 'item_design',
      label: firstLabel(removed.designs, (id) => before.itemDesigns.find((each) => each.id === id)?.name ?? null, 'Item Design'),
    }
  }
  const [ownerId, featureIds] = [...removed.features][0]!
  const featureId = featureIds[0]!
  return { kind: 'feature', ownerId, featureId, faceLike: featureId.toLowerCase().includes('face') }
}

/** Whether this operation asks Delete · Keep rather than the three-way choice (#82 §3). */
const asksKeep = (subject: NotesSubject): boolean => subject.kind === 'design_option' || subject.kind === 'floor'

/**
 * Where an Anchor stands on a Floor, in Floor millimetres, or `null` when it has no place there.
 *
 * The position comes from `derive` — the same derivation the pin on the Plan View is drawn from — and
 * never from a stored copy, because the whole point of an Anchor is that it does not store one. A note
 * about an Item Design, a cabinet node or the Project has no place on a Floor, which is why those rows
 * offer no Floor Point (#82 §3), and why nothing here falls back to a made-up point.
 */
function floorPositionOf(
  project: Project,
  index: Map<EntityId, EntityEntry>,
  anchor: CommentAnchor,
): { floorId: EntityId; point: Point2 } | null {
  if (anchor.kind === 'project' || anchor.kind === 'design_option' || anchor.kind === 'item_design') return null
  if (anchor.kind === 'feature' && project.itemDesigns.some((design) => design.id === anchor.ownerId)) return null
  const subjectId = anchor.kind === 'entity' ? anchor.entityId : anchor.kind === 'feature' ? anchor.ownerId : null
  let floorId: EntityId | null = null
  let optionId: EntityId | null = null
  if (anchor.kind === 'floor' || anchor.kind === 'floor_point') floorId = anchor.floorId
  else {
    const entry = subjectId === null ? undefined : index.get(subjectId)
    if (entry === undefined) return null
    floorId = entry.floorId
    optionId = entry.optionId
  }
  if (floorId === null) return null
  const point = commentAnchorPoint(project, deriveWalls(project, floorId, optionId), anchor)
  if (point !== null) return { floorId, point }
  // A Placed Item an Option drew stands on that Option's own translation: the derivation reads the
  // model the view is standing on, and the Option this operation deletes is no longer standing.
  const translation = subjectId === null ? undefined : index.get(subjectId)?.record.translation
  const at = translation as { x?: unknown; y?: unknown } | undefined
  if (at === undefined || typeof at.x !== 'number' || typeof at.y !== 'number') return null
  return { floorId, point: { x: at.x, y: at.y } }
}

/** The scope a note keeps when its Anchor changes, with an inherited answer written down (#82 §3). */
function materialisedScope(project: Project, comment: Comment): CommentScope {
  const scope = effectiveCommentScope(project, comment)
  return scope.kind === 'option' ? scope.designOptionId : COMMENT_SCOPE_ALL
}

/** The entity and feature targets of a Project, minus everything this operation takes away. */
function entityTargets(after: Project, removed: Removed, withProject: boolean): NotesTargetRef[] {
  const targets: NotesTargetRef[] = withProject ? [{ kind: 'project' }] : []
  for (const design of after.itemDesigns) {
    if (removed.designs.has(design.id)) continue
    targets.push({ kind: 'item_design', itemDesignId: design.id })
    for (const featureId of cabinetNodes(design) ?? []) targets.push({ kind: 'feature', ownerId: design.id, featureId })
  }
  for (const [entityId, entry] of entityIndex(after)) {
    if (removed.entities.has(entityId)) continue
    targets.push({ kind: 'entity', entityId })
    for (const featureId of registeredFeatureIds(entry.ownerKind) ?? []) targets.push({ kind: 'feature', ownerId: entityId, featureId })
  }
  return targets
}

/** Every target a Comment may be reanchored to, in the order the select lists its groups (#82 §4). */
function commentTargets(after: Project, removed: Removed): NotesTargetRef[] {
  const targets: NotesTargetRef[] = [{ kind: 'project' }]
  for (const floor of after.floors) if (!removed.floors.has(floor.id)) targets.push({ kind: 'floor', floorId: floor.id })
  for (const option of designOptionsOf(after)) if (!removed.options.has(option.id)) targets.push({ kind: 'design_option', designOptionId: option.id })
  targets.push(...entityTargets(after, removed, false))
  return targets
}

/** Every saved view a Reference Marker may point at: not the one going, not its own (#82 §4). */
function markerTargets(after: Project, removed: Removed, ownViewId: EntityId): NotesTargetRef[] {
  return savedViewsOf(after)
    .filter((view) => !removed.views.has(view.id) && view.id !== ownViewId)
    .map((view) => ({ kind: 'view' as const, viewId: view.id }))
}

/** The Anchor or endpoint a note is reviewed on, for its fingerprint (#82 §5.1). */
function fingerprintOf(entry: Stranded): string {
  if (entry.kind === 'comment') return canonicalJson(entry.anchor)
  if (entry.reason === 'marker') return canonicalJson({ targetViewId: entry.targetViewId })
  if (entry.reason === 'endpoint') return canonicalJson({ anchor: entry.anchor })
  return canonicalJson({ viewId: entry.viewId })
}

/** How the Anchor or endpoint of one stranded note reads to a person. */
function anchorLabelOf(before: Project, entry: Stranded): string {
  if (entry.anchor !== null) return targetLabel(before, entry.anchor)
  if (entry.reason === 'marker') return viewName(before, entry.targetViewId ?? entry.viewId!) ?? ''
  if (entry.reason === 'view') return viewName(before, entry.viewId!) ?? ''
  return 'a free endpoint'
}

/** Whether the row's Keep means "move it" or "move it, and it loses its target too" (#82 §3). */
function keepNote(entry: Stranded, removed: Removed): NotesRowNote {
  if (entry.reason === 'view') return 'deleted-with-view'
  const anchor = entry.anchor
  if (anchor === null || anchor.kind === 'design_option') return 'keep-all-options'
  const subjectId = anchor.kind === 'entity' ? anchor.entityId : anchor.kind === 'feature' ? anchor.ownerId : null
  return subjectId !== null && (removed.entities.has(subjectId) || removed.designs.has(subjectId))
    ? 'keep-floor-point'
    : 'keep-all-options'
}

/**
 * What this Intent would strand, or `null` when it strands nothing.
 *
 * `before` is the Project the Intent starts from and `after` the one its handler produced: the report
 * is the difference between them, so it asks the same question the deletion guard asks and answers it
 * once for every Intent in the catalogue.
 */
export function notesDependencyReport(before: Project, after: Project): NotesDependencyReport | null {
  if (before.comments.length === 0 && before.annotations.length === 0) return null
  const removed = removedBetween(before, after)
  if (removed.empty) return null
  const stranded = strandedNotes(before, after, removed)
  if (stranded.length === 0) return null

  const subject = subjectOf(before, entityIndex(before), removed, stranded)
  const keep = asksKeep(subject)
  const beforeIndex = entityIndex(before)
  const targets = keep
    ? null
    : { comments: commentTargets(after, removed), endpoints: entityTargets(after, removed, false) }

  const rows: NotesDependencyRow[] = stranded.map((entry) => {
    const choices: readonly NotesChoice[] = keep
      ? ['delete', 'keep']
      : entry.reason === 'view'
        ? ['delete']
        : entry.reason === 'marker'
          ? ['reanchor', 'delete']
          : ['floor_point', 'reanchor', 'delete']
    return {
      dependentId: entry.id,
      kind: entry.kind === 'comment' ? 'comment' : entry.reason === 'marker' ? 'reference_marker' : 'annotation',
      reference: entry.reference,
      title: entry.title,
      status: entry.status,
      annotationType: entry.annotationType,
      owningViewName: entry.viewId === null ? null : viewName(before, entry.viewId),
      targetViewName: entry.targetViewId === null ? null : viewName(before, entry.targetViewId),
      anchorLabel: anchorLabelOf(before, entry),
      fingerprint: fingerprintOf(entry),
      choices,
      preset: keep || entry.reason === 'view' ? 'delete' : null,
      floorPointDisabled: entry.anchor === null || floorPositionOf(before, beforeIndex, entry.anchor) === null,
      targets: !choices.includes('reanchor') || targets === null
        ? []
        : entry.reason === 'marker'
          ? markerTargets(after, removed, entry.viewId!)
          : entry.kind === 'comment'
            ? targets.comments
            : targets.endpoints,
      note: keep ? keepNote(entry, removed) : entry.reason === 'view' ? 'deleted-with-view' : null,
    }
  })

  // Comments by reference, then Annotations by reference: the order the Notes panel lists them in, so
  // the same eight notes read the same way in the panel and in the dialog (#82 Notes).
  rows.sort((a, b) => {
    const rank = (a.kind === 'comment' ? 0 : 1) - (b.kind === 'comment' ? 0 : 1)
    return rank !== 0
      ? rank
      : a.kind === 'comment'
        ? compareCommentReferences(a.reference, b.reference)
        : compareAnnotationReferences(a.reference, b.reference)
  })

  return { kind: 'notes', subject, rows }
}

/** The refusal an edit answers with when the user has not been asked yet (#82 §1). */
export function notesReviewMessage(report: NotesDependencyReport): string {
  const references = report.rows.map((row) => row.reference).join(', ')
  return `${report.rows.length} ${report.rows.length === 1 ? 'note is' : 'notes are'} about what this removes: ${references}. Choose what happens to each.`
}

/** Whether two targets are the same thing, without going through JSON for a list of hundreds. */
function sameTarget(a: NotesTargetRef, b: NotesTargetRef): boolean {
  if (a.kind !== b.kind) return false
  switch (a.kind) {
    case 'project':
      return true
    case 'floor':
      return b.kind === 'floor' && a.floorId === b.floorId
    case 'design_option':
      return b.kind === 'design_option' && a.designOptionId === b.designOptionId
    case 'item_design':
      return b.kind === 'item_design' && a.itemDesignId === b.itemDesignId
    case 'entity':
      return b.kind === 'entity' && a.entityId === b.entityId
    case 'feature':
      return b.kind === 'feature' && a.ownerId === b.ownerId && a.featureId === b.featureId
    case 'view':
      return b.kind === 'view' && a.viewId === b.viewId
  }
}

/** The Anchor a chosen target is, or a refusal when the target answers to no Anchor. */
function anchorOfTarget(ref: NotesTargetRef, reference: string, path: string): CommentAnchor {
  switch (ref.kind) {
    case 'project':
      return { kind: 'project' }
    case 'floor':
      return { kind: 'floor', floorId: ref.floorId }
    case 'design_option':
      return { kind: 'design_option', designOptionId: ref.designOptionId }
    case 'item_design':
      return { kind: 'item_design', itemDesignId: ref.itemDesignId }
    case 'entity':
      return { kind: 'entity', entityId: ref.entityId }
    case 'feature':
      return { kind: 'feature', ownerId: ref.ownerId, featureId: ref.featureId }
    case 'view':
      return refuse(
        'stale-dependency-resolution',
        path,
        `${reference} hangs off a thing in the model, not a view, so this target no longer fits it.`,
      )
  }
}

/** Whether one answer is still an answer to the question the report asked (#82 §5.2). */
function checkResolution(row: NotesDependencyRow, resolution: NotesResolution | undefined, path: string): NotesResolution {
  if (resolution === undefined) {
    refuse(
      'stale-dependency-resolution',
      path,
      `${row.reference} was in the review this answer was made from, and this Project has a different set of notes.`,
    )
  }
  if (resolution.expectedAnchor !== row.fingerprint) {
    refuse('stale-dependency-resolution', path, `${row.reference} is about something else now than it was when this review was shown.`)
  }
  if (!row.choices.includes(resolution.choice)) {
    refuse('stale-dependency-resolution', path, `${row.reference} cannot be answered with ${resolution.choice} any more.`)
  }
  if (resolution.choice === 'reanchor') {
    const ref = resolution.targetRef
    if (ref === undefined || !row.targets.some((target) => sameTarget(target, ref))) {
      refuse(
        'stale-dependency-resolution',
        path,
        `${row.reference} was to move to a target this operation is deleting, or that is no longer there.`,
      )
    }
  } else if (resolution.targetRef !== undefined) {
    refuse('stale-dependency-resolution', path, `${row.reference} carries a target for a choice that takes none.`)
  }
  return resolution
}

/**
 * Carrying the answers into the transaction.
 *
 * Runs inside the same producer as the deletion, so one undo puts the target, the notes and their
 * original Anchors back together (#82 §5.4). Every answer is checked against the report first and the
 * whole Intent is refused if one of them no longer fits: a resolution is a promise about the Project
 * the review was shown against, and a Project that has moved on is a different question.
 *
 * `before` is the Project the Intent started from, which is where a stranded Anchor still has a
 * position to be converted at — the note was fine before the edit, and the edit is what took its
 * target away. `draft` is the Project the handler produced, still being written.
 */
export function applyNotesResolutions(
  before: Project,
  draft: Project,
  report: NotesDependencyReport,
  resolutions: readonly NotesResolution[],
  now: string,
): void {
  const byId = new Map<EntityId, NotesResolution>()
  for (const resolution of resolutions) {
    if (byId.has(resolution.dependentId)) {
      refuse('stale-dependency-resolution', `notesResolutions[${resolution.dependentId}]`, 'One note was answered twice.')
    }
    byId.set(resolution.dependentId, resolution)
  }
  if (byId.size !== report.rows.length) {
    refuse(
      'stale-dependency-resolution',
      'notesResolutions',
      `The review listed ${report.rows.length} ${report.rows.length === 1 ? 'note' : 'notes'} and this answer covers ${byId.size}.`,
    )
  }
  const answers = report.rows.map((row) => {
    const path = `${row.kind === 'comment' ? 'comments' : 'annotations'}[${row.dependentId}]`
    return { row, resolution: checkResolution(row, byId.get(row.dependentId), path), path }
  })

  const index = entityIndex(before)
  for (const { row, resolution, path } of answers) {
    const stale: (message: string) => never = (message) => refuse('stale-dependency-resolution', path, `${row.reference} ${message}`)
    if (row.kind === 'comment') {
      const at = draft.comments.findIndex((comment) => comment.id === row.dependentId)
      const original = before.comments.find((comment) => comment.id === row.dependentId)
      if (at < 0 || original === undefined) stale('is no longer in the Project.')
      const comment = draft.comments[at]!
      if (resolution.choice === 'delete') {
        draft.comments.splice(at, 1)
        continue
      }
      if (resolution.choice === 'floor_point') {
        const position = floorPositionOf(before, index, original.anchor)
        if (position === null) stale('no longer has a position on a Floor.')
        comment.anchor = { kind: 'floor_point', floorId: position.floorId, point: position.point }
        comment.scope = materialisedScope(before, original)
      } else if (resolution.choice === 'reanchor') {
        comment.anchor = anchorOfTarget(resolution.targetRef!, row.reference, path)
        if (anchorChoosesScope(comment.anchor.kind)) comment.scope = materialisedScope(before, original)
        else delete comment.scope
      } else if (report.subject.kind === 'floor') {
        // Keep, Floor deletion (#82 §3): a Floor cannot outlive its own deletion, so the note goes to
        // the Project and keeps the scope it had.
        comment.anchor = { kind: 'project' }
        comment.scope = materialisedScope(before, original)
      } else {
        // Keep, Design Option deletion: All Options, and a Floor Point where the target went with the
        // Option too.
        comment.scope = COMMENT_SCOPE_ALL
        const anchor = comment.anchor
        if (anchor.kind === 'design_option') comment.anchor = { kind: 'project' }
        else if (!anchorResolves(draft, anchor)) {
          const position = floorPositionOf(before, index, anchor)
          if (position === null) stale('no longer has a position on a Floor.')
          comment.anchor = { kind: 'floor_point', floorId: position.floorId, point: position.point }
        }
      }
      comment.updatedAt = now
      continue
    }

    const at = draft.annotations.findIndex((annotation) => annotation.id === row.dependentId)
    if (at < 0 || before.annotations.some((annotation) => annotation.id === row.dependentId) === false) {
      stale('is no longer in the Project.')
    }
    const annotation = draft.annotations[at]!
    if (resolution.choice === 'delete') {
      draft.annotations.splice(at, 1)
      continue
    }
    if (resolution.choice === 'floor_point') {
      const endpoint = anchoredOf(annotation.endpoint)
      if (endpoint === null) stale('has no anchored endpoint to leave at a position.')
      const position = floorPositionOf(before, index, endpoint)
      if (position === null) stale('no longer has a position on a Floor.')
      annotation.endpoint = { free: position.point }
      continue
    }
    if (resolution.choice === 'reanchor') {
      const ref = resolution.targetRef!
      if (row.kind === 'reference_marker') {
        if (ref.kind !== 'view') stale('points at a view, and this target is not one.')
        annotation.targetViewId = ref.viewId
      } else {
        const anchor = anchorOfTarget(ref, row.reference, path)
        if (anchor.kind !== 'entity' && anchor.kind !== 'feature') stale('can only be anchored to a thing in the model.')
        annotation.endpoint = { anchor }
      }
      continue
    }
    // Keep, Design Option deletion: All Options, and a free endpoint where the endpoint's target went
    // with the Option too.
    annotation.scope = ANNOTATION_SCOPE_ALL
    const endpoint = anchoredOf(annotation.endpoint)
    if (endpoint !== null && !anchorResolves(draft, endpoint)) {
      const position = floorPositionOf(before, index, endpoint)
      if (position === null) stale('no longer has a position on a Floor.')
      annotation.endpoint = { free: position.point }
    }
  }
}

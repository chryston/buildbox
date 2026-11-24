/**
 * The plain words a Comment's Anchor is named with (#80 §5.5, §5.6, §10).
 *
 * An Anchor is storage: `entity`, `point`, `left_face`, `node-7`. A person reading a row or a filter
 * reads `Placed Item · Base 600 #2 · Existing Model` and `+ Comment on Kitchen side face`, and criterion
 * 19 is explicit that no code ever reaches the screen. This module is the single place that translation
 * happens, so a row, a filter, the editor and the inspector cannot drift into four spellings of one
 * thing.
 *
 * A subject that has been deleted reads as `unrecognised target` rather than as a blank or a raw ID: the
 * §6 rules already put such a Comment in every context, so the row has to say something honest about why
 * it cannot name what it is about.
 */
import type { CommentAnchor, EntityId, Project, ProposedModel } from '../../../domain'
import { COMMENT_KIND_LABELS, COMMENT_STRINGS } from '../../strings/comments'
import { derivePlacement, placementLabels } from '../../../derive'

/** A subject that no longer exists, which the row says so about. */
const MISSING = 'unrecognised target'

/** The Wall/Beam/Skirting/Service style of name: its Room name, its reference, or nothing. */
const refOf = (row: unknown): string | null => {
  if (typeof row !== 'object' || row === null) return null
  const record = row as Record<string, unknown>
  for (const key of ['name', 'ref', 'label'] as const) {
    const value = record[key]
    if (typeof value === 'string' && value !== '') return value
  }
  return null
}

/** Every entity collection of a container, so one lookup covers every kind of Anchor subject. */
const entityCollections = (model: ProposedModel): readonly unknown[][] => [
  model.walls,
  model.wallJunctions,
  model.openings,
  model.rooms,
  model.placedItems,
]

/** The name of the entity an entity or feature Anchor names, or `null` when it has gone. */
function entityName(project: Project, entityId: EntityId): string | null {
  const placed = project.existingModel.placedItems.find((row) => row.id === entityId)
  if (placed !== undefined) {
    const design = project.itemDesigns.find((row) => row.id === placed.itemDesignId)
    if (design === undefined) return null
    // The same `Base 600 #2` the inspector writes: the ordinal comes from the placements of that design,
    // so a row and an inspector section name one placement the same way.
    const siblings = project.existingModel.placedItems.filter((row) => row.itemDesignId === design.id)
    const labels = placementLabels(siblings.map((row) => derivePlacement(design, row)))
    return labels.get(entityId) ?? design.name
  }
  for (const model of [project.existingModel, ...(project.designOptions ?? []).map((option) => option.proposed)]) {
    for (const collection of [...entityCollections(model), extraCollections(model)]) {
      const found = collection.find((row) => (row as { id?: EntityId }).id === entityId)
      const name = refOf(found)
      if (name !== null) return name
    }
  }
  return null
}

/** The vertical collections of a container, which a container holds beside the five core ones. */
function extraCollections(model: ProposedModel): readonly unknown[] {
  const record = model as unknown as Record<string, unknown>
  return [record['beams'], record['skirting'], record['services']].flatMap((rows) => (Array.isArray(rows) ? rows : []))
}

/** The cabinet node a feature Anchor names, by the name the tree editor gives it. */
function nodeName(project: Project, itemDesignId: EntityId, featureId: string): string | null {
  const design = project.itemDesigns.find((row) => row.id === itemDesignId)
  if (design === undefined || design.kind !== 'cabinet') return null
  const found = (design.construction.root.children ?? []).find((node) => node.id === featureId) as { name?: string } | undefined
  return found?.name ?? null
}

/**
 * The face of a Wall a feature Anchor names, in the words a person uses for it (#80 §8.3).
 *
 * A Room on that side names it — `Kitchen side face` — because "left" is only left from somewhere, and
 * the Room is the thing the face is a face *of*. With no Room claiming the face, the direction is the
 * only honest word left, and it is still not a code.
 */
function faceLabel(project: Project, wallId: EntityId, featureId: string): string {
  const side = featureId === 'leftFace' ? 'left' : featureId === 'rightFace' ? 'right' : null
  if (side === null) return featureId === 'start' ? 'start end' : featureId === 'end' ? 'far end' : featureId
  const wall = project.existingModel.walls.find((row) => row.id === wallId)
  const room = project.existingModel.rooms.find((candidate) =>
    candidate.wallFaceRefs.some((reference) => reference.wallId === wallId && reference.side === side),
  )
  if (room !== undefined) return `${room.name} side face`
  return wall === undefined ? MISSING : `${side === 'left' ? 'left' : 'right'} face`
}

/** The plain label of a feature Anchor's owner and feature together. */
export function commentFeatureLabel(project: Project, ownerId: EntityId, featureId: string): string {
  const owner = project.itemDesigns.find((row) => row.id === ownerId)
  if (owner !== undefined) {
    const node = nodeName(project, ownerId, featureId)
    return node !== null ? `${owner.name} · ${node}` : owner.name
  }
  return faceLabel(project, ownerId, featureId)
}

/**
 * The subject half of a row's Anchor label: `Base 600 #2`, `W-3`, `Kitchen`, `Level 2`, `Option B ·
 * Island`, or `unrecognised target` when the subject is gone.
 */
export function commentAnchorSubject(project: Project, anchor: CommentAnchor): string {
  switch (anchor.kind) {
    case 'project':
      return project.meta.name
    case 'floor':
      return project.floors.find((row) => row.id === anchor.floorId)?.name ?? MISSING
    case 'design_option':
      return project.designOptions?.find((row) => row.id === anchor.designOptionId)?.name ?? MISSING
    case 'item_design':
      return project.itemDesigns.find((row) => row.id === anchor.itemDesignId)?.name ?? MISSING
    case 'entity':
      return entityName(project, anchor.entityId) ?? MISSING
    case 'feature':
      return commentFeatureLabel(project, anchor.ownerId, anchor.featureId)
    case 'floor_point':
      return `${project.floors.find((row) => row.id === anchor.floorId)?.name ?? MISSING} point`
  }
}

/** The whole Anchor label a row writes on its second line, e.g. `Placed Item · Base 600 #2`. */
export function commentAnchorLabel(project: Project, anchor: CommentAnchor): string {
  return `${COMMENT_KIND_LABELS[anchor.kind]} · ${commentAnchorSubject(project, anchor)}`
}

/** The scope half of the row's second line, with the inherited marker the editor also writes. */
export function commentScopeText(scopeLabel: string, inherited: boolean): string {
  return inherited ? `${scopeLabel}${COMMENT_STRINGS.inheritedSuffix}` : scopeLabel
}

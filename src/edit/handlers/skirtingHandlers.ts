/**
 * The Skirting Intents (#78 §3, §4): drawing one against a face, moving an end, the numeric edits,
 * `Flip side`, `Duplicate to other side`, the Vertical Extent boxes and delete.
 *
 * A Skirting stores its host Wall, the side of it it stands off, the range along the host's
 * reference line, and its bottom, height and thickness. It stores no outline: the body the plan
 * draws is the host's tidied face offset by `thickness`, and the gaps at Openings, T-junctions and
 * corners are derived on read (#78 §1, §2). So every edit here writes reference-line distances and
 * three numbers, and none of them computes a polygon — which is also why no edit has to keep a
 * stored shape in step with the Wall it hangs on.
 *
 * A Skirting has no Junction and cannot be moved off its Wall: `Flip side` is the only way to change
 * the face it stands on, and `Duplicate to other side` makes a second element rather than giving one
 * element two faces, because a Wall skirted on both sides is two records (#78 §1). Nothing here joins,
 * splits or merges, and no edit of a Wall reaches a Skirting from this file — the Wall's own handlers
 * carry, clip and split hosted Skirting in their own transactions (#78 §5).
 *
 * Like the Wall and Beam Intents, the edits of an entity that already exists are edits of the Existing
 * Model: while the Project carries a Design Option the survey is the record every Option is drawn
 * against, and changing it is a correction (#69 §12), not a renovation. Only `skirting.create` writes
 * into an Option, because drawing Skirting there is proposing work rather than restating the survey.
 */
import type { EntityId, Project, Skirting, Wall } from '../../domain'
import { designOptionsOf, nextSkirtingLabel, skirtingOf, skirtingTop } from '../../domain'
import { TOLERANCE_MM, refLength } from '../../geometry'
import type { CreateSkirting, IntentTarget, Locator, SkirtingIntent, VerticalExtentField } from '../intents'
import type { Handler, IntentHandler } from './context'
import { creationLayerField } from './creationLayer'
import {
  containerOf,
  effectiveView,
  isInOption,
  proposedProvenance,
  refuse,
  requireExtentValue,
  spendIds,
} from './support'

const skirtingPath = (skirtingId: EntityId): string => `existingModel.skirting[${skirtingId}]`
/**
 * The record field one Vertical Extent box writes (#78 §4). `Top` is not a field — a Skirting keeps
 * its Bottom and its Height, and the Top is the sum — so the path names the field that changed.
 */
const skirtingField = (skirtingId: EntityId, field: VerticalExtentField): string =>
  `${skirtingPath(skirtingId)}.${field === 'base' || field === 'bottom' ? 'bottom' : 'height'}`

/** The Skirting, or a rejection: every Skirting Intent about an existing one names one. */
const requireSkirting = (project: Project, skirtingId: EntityId): Skirting => {
  const found = skirtingOf(project.existingModel).find((entry) => entry.id === skirtingId)
  if (found === undefined) refuse('unknown-target', skirtingPath(skirtingId), `No Skirting answers to ${skirtingId}.`)
  return found
}

/** The Skirting as the draft holds it, which is what a handler writes to. */
const editSkirting = (draft: Project, skirtingId: EntityId): Skirting => requireSkirting(draft, skirtingId)

/** The Wall a Skirting is drawn against, or a rejection naming the face it was drawn on. */
const requireHost = (project: Project, hostWallId: EntityId, path: string): Wall => {
  const host = project.existingModel.walls.find((wall) => wall.id === hostWallId)
  if (host === undefined) refuse('unknown-target', path, `No Wall answers to ${hostWallId}, so there is no face to skirt.`)
  return host
}

/**
 * How far past the host's ends a range may reach before it is refused: the drawing tolerance, so a
 * click that lands a hair off the end of the Wall still skirts the whole face.
 */
const TOL = TOLERANCE_MM

/**
 * The range, or a rejection: a Skirting has to cover something, and it cannot run past either end of
 * the Wall it is drawn against (#78 §1). The Wall's own length is the bound — the tidied face is
 * shorter at the corners, and that difference is a derived clip rather than a refusal (#78 §2).
 */
function requireRange(skirtingId: EntityId, host: Wall, start: number, end: number): void {
  const length = refLength(host.line)
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    refuse('invalid-skirting', `${skirtingPath(skirtingId)}.start`, 'Enter a number for both ends of the range.')
  }
  if (!(end > start)) {
    refuse(
      'invalid-skirting',
      `${skirtingPath(skirtingId)}.end`,
      'The range has to run from its start to further along the Wall than that.',
    )
  }
  if (start < -TOL || end > length + TOL) {
    refuse(
      'invalid-skirting',
      `${skirtingPath(skirtingId)}.${start < -TOL ? 'start' : 'end'}`,
      `${host.ref} is ${Math.round(length)} mm long, so the range has to stay between 0 and ${Math.round(length)} mm.`,
    )
  }
}

/** A Skirting has to have a height and a thickness, or it is a line on a drawing (#78 §1). */
function requireSection(skirtingId: EntityId, height: number, thickness: number): void {
  if (!(height > 0)) refuse('invalid-skirting', `${skirtingPath(skirtingId)}.height`, 'A Skirting has to be more than 0 mm high.')
  if (!(thickness > 0)) {
    refuse('invalid-skirting', `${skirtingPath(skirtingId)}.thickness`, 'A Skirting has to stand more than 0 mm off the face.')
  }
}

/**
 * A new Skirting (#78 §3): the face the tool picked, the range it covers and the three numbers the
 * panel holds, on the Layer the view files it on.
 *
 * The tool clicks a face and gets the whole face by default, so the range arrives as the face's own
 * extent; a Skirting drawn inside a Design Option is proposed work and lands in that Option's
 * container (#69 §7), on `Structure` like every other piece of built fabric (#71 §2, #78 §7).
 */
const createSkirting: Handler<'skirting.create'> = (ctx) => {
  const { floorId, hostWallId, side, start, end, bottom, height, thickness, label, target } =
    ctx.intent.payload as CreateSkirting & IntentTarget
  if (!ctx.project.floors.some((floor) => floor.id === floorId)) {
    refuse('unknown-target', `floors[${floorId}]`, `No floor answers to ${floorId}.`)
  }
  const [skirtingId] = spendIds(ctx.intent.ids, 1, 'skirting.create')
  // The host is read through the Option's own drawing, so a Skirting can be proposed against a Wall
  // the same Option is proposing — and against nothing else (#78 §1).
  const host = requireHost(
    effectiveView(ctx.project, floorId, target?.designOptionId),
    hostWallId,
    `existingModel.walls[${hostWallId}]`,
  )
  if (host.floorId !== floorId) {
    refuse(
      'unknown-target',
      `existingModel.walls[${hostWallId}]`,
      `${host.ref} is not on this Floor, so it has no face here to skirt.`,
    )
  }
  requireRange(skirtingId, host, start, end)
  requireSection(skirtingId, height, thickness)
  if (!Number.isFinite(bottom)) refuse('invalid-skirting', `${skirtingPath(skirtingId)}.bottom`, 'Enter a number.')
  const container = containerOf(ctx.draft, target?.designOptionId)
  container.skirting = [
    ...(skirtingOf(container) as Skirting[]),
    {
      id: skirtingId,
      floorId,
      hostWallId,
      side,
      start,
      end,
      bottom,
      height,
      thickness,
      ...(label === undefined || label === '' ? {} : { label }),
      ...proposedProvenance(isInOption(container, ctx.draft)),
      // Built fabric, filed on `Structure` with the Wall it stands against (#78 §7).
      ...creationLayerField(ctx.project, target?.viewId, 'fabric'),
    },
  ]
}

/**
 * Move one end (#78 §3 "move an end"). The other end, the face and the section are untouched, and
 * nothing else follows: a Skirting has no Junction, and the Wall it hangs on is not told about it.
 */
const dragEndpoint: Handler<'skirting.dragEndpoint'> = (ctx) => {
  const { skirtingId, end, to } = ctx.intent.payload
  const entry = editSkirting(ctx.draft, skirtingId)
  const start = end === 'start' ? to : entry.start
  const finish = end === 'start' ? entry.end : to
  requireRange(skirtingId, requireHost(ctx.draft, entry.hostWallId, skirtingPath(skirtingId)), start, finish)
  entry.start = start
  entry.end = finish
}

/** The inspector's `Start` and `End`: one commit moves the whole range (#78 §4). */
const setRange: Handler<'skirting.setRange'> = (ctx) => {
  const { skirtingId, start, end } = ctx.intent.payload
  const entry = editSkirting(ctx.draft, skirtingId)
  requireRange(skirtingId, requireHost(ctx.draft, entry.hostWallId, skirtingPath(skirtingId)), start, end)
  entry.start = start
  entry.end = end
}

/**
 * `Flip side` (#78 §3): the same range on the other face of the same Wall. The gaps change with the
 * face — a T-junction covers one side and not the other — and none of them is stored, so this is one
 * field.
 */
const flipSide: Handler<'skirting.flipSide'> = (ctx) => {
  const { skirtingId } = ctx.intent.payload
  const entry = editSkirting(ctx.draft, skirtingId)
  entry.side = entry.side === 'left' ? 'right' : 'left'
}

/**
 * `Duplicate to other side` (#78 §3 criterion 6): a second element on the opposite face, with its own
 * ID and the next free label. A Wall skirted on both sides is two records, which is why this creates
 * one rather than giving the first a second face.
 */
const duplicateOtherSide: Handler<'skirting.duplicateOtherSide'> = (ctx) => {
  const { skirtingId } = ctx.intent.payload
  const source = requireSkirting(ctx.project, skirtingId)
  const [freshId] = spendIds(ctx.intent.ids, 1, 'skirting.duplicateOtherSide')
  const container = ctx.draft.existingModel
  container.skirting = [
    ...(skirtingOf(container) as Skirting[]),
    {
      ...structuredClone(source),
      id: freshId,
      side: source.side === 'left' ? 'right' : 'left',
      label: nextSkirtingLabel(ctx.project),
    },
  ]
}

/** The inspector's `Bottom`: moves the Skirting and keeps its Height (#78 §4 criterion 7). */
const setBottom: Handler<'skirting.setBottom'> = (ctx) => {
  const { skirtingId, bottom } = ctx.intent.payload
  const entry = editSkirting(ctx.draft, skirtingId)
  if (!Number.isFinite(bottom)) refuse('invalid-skirting', `${skirtingPath(skirtingId)}.bottom`, 'Enter a number.')
  entry.bottom = bottom
}

/** The inspector's `Height`: changes the Top and keeps the Bottom (#78 §4). */
const setHeight: Handler<'skirting.setHeight'> = (ctx) => {
  const { skirtingId, height } = ctx.intent.payload
  const entry = editSkirting(ctx.draft, skirtingId)
  if (!(height > 0)) refuse('invalid-skirting', `${skirtingPath(skirtingId)}.height`, 'A Skirting has to be more than 0 mm high.')
  entry.height = height
}

/** The inspector's `Thickness`: how far the body stands off the host face (#78 §4). */
const setThickness: Handler<'skirting.setThickness'> = (ctx) => {
  const { skirtingId, thickness } = ctx.intent.payload
  const entry = editSkirting(ctx.draft, skirtingId)
  if (!(thickness > 0)) {
    refuse('invalid-skirting', `${skirtingPath(skirtingId)}.thickness`, 'A Skirting has to stand more than 0 mm off the face.')
  }
  entry.thickness = thickness
}

/**
 * One Vertical Extent box of a Skirting (#78 §4 "Elevation View"). A Skirting owns its height, so
 * `top` restates the Height and keeps the Bottom, while `base` and `bottom` both move the Skirting
 * and keep the Height — the inspector's `Bottom` and the Elevation View's bottom handle are the same
 * decision, and criterion 7 is that neither of them shortens the Skirting.
 */
const setVerticalExtent: Handler<'skirting.setVerticalExtent'> = (ctx) => {
  const { skirtingId, field, value } = ctx.intent.payload
  const entry = editSkirting(ctx.draft, skirtingId)
  requireExtentValue(field, value, skirtingField(skirtingId, field), entry.bottom, skirtingTop(entry))
  if (field === 'base' || field === 'bottom') entry.bottom = value
  else if (field === 'height') entry.height = value
  else entry.height = value - entry.bottom
}

/** The inspector's `Label`. An empty string clears it, which says only `Skirting` (#78 §4). */
const renameSkirting: Handler<'skirting.rename'> = (ctx) => {
  const { skirtingId, label } = ctx.intent.payload
  const entry = editSkirting(ctx.draft, skirtingId)
  if (label.length > 80) refuse('invalid-skirting', `${skirtingPath(skirtingId)}.label`, 'A Skirting label is at most 80 characters.')
  if (label === '') {
    delete entry.label
    return
  }
  entry.label = label
}

/**
 * Delete one Skirting. A Skirting hosts nothing — no Opening is cut into it and no Room stands on it
 * — so nothing else has to be asked about first (#78 §1). A Design Option that had demolished it is
 * tidied in the same step: a demolition can only name Existing work, so leaving the record behind
 * would make the Project invalid rather than smaller.
 */
const deleteSkirting: Handler<'skirting.delete'> = (ctx) => {
  const { skirtingId } = ctx.intent.payload
  requireSkirting(ctx.project, skirtingId)
  ctx.draft.existingModel.skirting = skirtingOf(ctx.draft.existingModel).filter((entry) => entry.id !== skirtingId)
  for (const option of designOptionsOf(ctx.draft)) {
    if (!option.demolishedIds.includes(skirtingId)) continue
    option.demolishedIds = option.demolishedIds.filter((id) => id !== skirtingId)
  }
}

const planLocator = (floorId: EntityId | null): Locator => ({
  floorId,
  viewId: null,
  view: 'plan',
  itemDesignIds: [],
  placedItemIds: [],
})

/**
 * Which Floor a Skirting is on, whichever container holds it. A Skirting this Option drew is on a
 * Floor too, and undo has to be able to find its way back to it.
 */
const skirtingFloor = (project: Project, skirtingId: EntityId): EntityId | null =>
  skirtingOf(project.existingModel).find((entry) => entry.id === skirtingId)?.floorId ??
  designOptionsOf(project)
    .flatMap((option) => skirtingOf(option.proposed))
    .find((entry) => entry.id === skirtingId)?.floorId ??
  null

type SkirtingHandlers = { [T in SkirtingIntent['type']]: IntentHandler<T> }

export const SKIRTING_HANDLERS: SkirtingHandlers = {
  'skirting.create': { run: createSkirting, locate: (_project, intent) => planLocator(intent.payload.floorId) },
  'skirting.dragEndpoint': {
    run: dragEndpoint,
    locate: (project, intent) => planLocator(skirtingFloor(project, intent.payload.skirtingId)),
  },
  'skirting.setRange': {
    run: setRange,
    locate: (project, intent) => planLocator(skirtingFloor(project, intent.payload.skirtingId)),
  },
  'skirting.flipSide': {
    run: flipSide,
    locate: (project, intent) => planLocator(skirtingFloor(project, intent.payload.skirtingId)),
  },
  'skirting.duplicateOtherSide': {
    run: duplicateOtherSide,
    locate: (project, intent) => planLocator(skirtingFloor(project, intent.payload.skirtingId)),
  },
  'skirting.setBottom': {
    run: setBottom,
    locate: (project, intent) => planLocator(skirtingFloor(project, intent.payload.skirtingId)),
  },
  'skirting.setHeight': {
    run: setHeight,
    locate: (project, intent) => planLocator(skirtingFloor(project, intent.payload.skirtingId)),
  },
  'skirting.setThickness': {
    run: setThickness,
    locate: (project, intent) => planLocator(skirtingFloor(project, intent.payload.skirtingId)),
  },
  'skirting.setVerticalExtent': {
    run: setVerticalExtent,
    locate: (project, intent) => planLocator(skirtingFloor(project, intent.payload.skirtingId)),
  },
  'skirting.rename': {
    run: renameSkirting,
    locate: (project, intent) => planLocator(skirtingFloor(project, intent.payload.skirtingId)),
  },
  'skirting.delete': {
    run: deleteSkirting,
    locate: (project, intent) => planLocator(skirtingFloor(project, intent.payload.skirtingId)),
  },
}

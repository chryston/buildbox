/**
 * The Beam Intents (#77 §2, §3): drawing one, moving an end or the whole Beam, the numeric edits,
 * the four Vertical Extent boxes and delete.
 *
 * A Beam stores its two ends **on the reference line**, its section as one width and one
 * justification, and its place in the storey as an Underside and a Depth. Everything else — the two
 * faces, the Top, the outline the plan draws — is derived on read, so an edit moves reference-line
 * points and two numbers and never a polygon.
 *
 * A Beam has no Junction and no host (#77 §1): nothing here joins, splits, merges or offsets through
 * another element, and no edit of a Wall reaches a Beam. That is why this family is smaller than the
 * Wall's and why none of it is wrapped in the Wall-fit check of #65 §7 — there is nothing here for
 * that check to re-measure, and no Room Edge lies on a Beam face.
 *
 * Like the Wall Intents, the edits of an entity that already exists are edits of the Existing Model:
 * while the Project carries a Design Option the survey is the record every Option is drawn against,
 * and changing it is a correction (#69 §12), not a renovation. Only `beam.create` writes into an
 * Option, because drawing a Beam there is proposing work rather than restating the survey.
 */
import type { Beam, EntityId, Project } from '../../domain'
import { beamTop, beamsOf, designOptionsOf } from '../../domain'
import { TOLERANCE_MM, distance, pt } from '../../geometry'
import type { BeamIntent, Locator, VerticalExtentField } from '../intents'
import type { CreateBeam, IntentTarget } from '../intents'
import type { Handler, IntentHandler } from './context'
import { creationLayerField } from './creationLayer'
import {
  containerOf,
  isInOption,
  proposedProvenance,
  refuse,
  requireExtentValue,
  spendIds,
} from './support'

const beamPath = (beamId: EntityId): string => `existingModel.beams[${beamId}]`
/**
 * The record field one Vertical Extent box writes (#77 §3). `Top` is not a field — a Beam keeps its
 * Underside and its Depth, and the Top is the sum — so the path names the field that changed.
 */
const beamField = (beamId: EntityId, field: VerticalExtentField): string =>
  `${beamPath(beamId)}.${field === 'base' || field === 'bottom' ? 'underside' : 'height'}`

/** The Beam, or a rejection: every Beam Intent about an existing Beam names one. */
const requireBeam = (project: Project, beamId: EntityId): Beam => {
  const found = beamsOf(project.existingModel).find((beam) => beam.id === beamId)
  if (found === undefined) refuse('unknown-target', beamPath(beamId), `No Beam answers to ${beamId}.`)
  return found
}

/** The Beam as the draft holds it, which is what a handler writes to. */
const editBeam = (draft: Project, beamId: EntityId): Beam => requireBeam(draft, beamId)

/** A Beam has to join two points further apart than the drawing tolerance, or it is a dot. */
function requireBeamLine(beamId: EntityId, line: { start: { x: number; y: number }; end: { x: number; y: number } }): void {
  if (!(distance(line.start, line.end) > TOLERANCE_MM)) {
    refuse('invalid-beam', `${beamPath(beamId)}.line`, 'A Beam has to join two different points.')
  }
}

/**
 * A new Beam (#77 §2): the line the tool drew, the section and Vertical Extent the panel holds, and
 * the Layer the view files it on.
 *
 * `Top at` is absent from the payload by design — the panel turns it into an Underside before
 * sending, and the reference itself is never stored (#77 §2 criterion 4). A Beam drawn inside a
 * Design Option is proposed work: the same checks, the same writes, into that Option's container
 * (#69 §7), and it lands on `Structure` like every other piece of built fabric (#71 §2).
 */
const createBeam: Handler<'beam.create'> = (ctx) => {
  const { floorId, line, justification, width, underside, height, label, target } = ctx.intent.payload as CreateBeam & IntentTarget
  if (!ctx.project.floors.some((floor) => floor.id === floorId)) {
    refuse('unknown-target', `floors[${floorId}]`, `No floor answers to ${floorId}.`)
  }
  const [beamId] = spendIds(ctx.intent.ids, 1, 'beam.create')
  requireBeamLine(beamId, line)
  if (!(width > 0)) refuse('invalid-beam', `${beamPath(beamId)}.width`, 'A Beam has to be more than 0 mm wide.')
  if (!(height > 0)) refuse('invalid-beam', `${beamPath(beamId)}.height`, 'A Beam has to be more than 0 mm deep.')
  if (!Number.isFinite(underside)) refuse('invalid-beam', `${beamPath(beamId)}.underside`, 'Enter a number.')
  const container = containerOf(ctx.draft, target?.designOptionId)
  container.beams = [
    ...(beamsOf(container) as Beam[]),
    {
      id: beamId,
      floorId,
      line: { start: pt(line.start.x, line.start.y), end: pt(line.end.x, line.end.y) },
      justification,
      width,
      underside,
      height,
      ...(label === undefined || label === '' ? {} : { label }),
      ...proposedProvenance(isInOption(container, ctx.draft)),
      // A Beam is built fabric like the Wall it may cross but never hangs from (#71 §2, #77 §4).
      ...creationLayerField(ctx.project, target?.viewId, 'fabric'),
    },
  ]
}

/**
 * Move one end (#77 §2 "move an end"). Nothing follows: a Beam has no Junction, no host and no
 * Room Edge, and a Wall it crosses is not told about it (#77 §1 criterion 2).
 */
const dragEndpoint: Handler<'beam.dragEndpoint'> = (ctx) => {
  const { beamId, end, to } = ctx.intent.payload
  const beam = editBeam(ctx.draft, beamId)
  const line = end === 'start' ? { start: pt(to.x, to.y), end: beam.line.end } : { start: beam.line.start, end: pt(to.x, to.y) }
  requireBeamLine(beamId, line)
  beam.line = line
}

/** Move a whole Beam: both ends by the same delta. The section and the elevations are untouched. */
const dragBody: Handler<'beam.dragBody'> = (ctx) => {
  const { beamId, delta } = ctx.intent.payload
  const beam = editBeam(ctx.draft, beamId)
  beam.line = {
    start: pt(beam.line.start.x + delta.x, beam.line.start.y + delta.y),
    end: pt(beam.line.end.x + delta.x, beam.line.end.y + delta.y),
  }
}

/**
 * The inspector's `Length` (#77 §3): one end stays where it is and the other moves along the line
 * the Beam already has, so the direction and the section are untouched.
 */
const setLength: Handler<'beam.setLength'> = (ctx) => {
  const { beamId, length, keepFixed } = ctx.intent.payload
  const beam = editBeam(ctx.draft, beamId)
  if (!(length > TOLERANCE_MM)) refuse('invalid-beam', beamPath(beamId), 'A Beam has to be more than 0.01 mm long.')
  const from = keepFixed === 'start' ? beam.line.start : beam.line.end
  const toward = keepFixed === 'start' ? beam.line.end : beam.line.start
  const dx = toward.x - from.x
  const dy = toward.y - from.y
  const along = Math.hypot(dx, dy) || 1
  const at = pt(from.x + (dx * length) / along, from.y + (dy * length) / along)
  beam.line = keepFixed === 'start' ? { start: beam.line.start, end: at } : { start: at, end: beam.line.end }
}

/** The inspector's `Width`: the constant section, which moves both faces off the reference line. */
const setWidth: Handler<'beam.setWidth'> = (ctx) => {
  const { beamId, width } = ctx.intent.payload
  const beam = editBeam(ctx.draft, beamId)
  if (!(width > 0)) refuse('invalid-beam', `${beamPath(beamId)}.width`, 'A Beam has to be more than 0 mm wide.')
  beam.width = width
}

/** The inspector's `Justification`: where the reference line sits within the width. */
const setJustification: Handler<'beam.setJustification'> = (ctx) => {
  const { beamId, justification } = ctx.intent.payload
  editBeam(ctx.draft, beamId).justification = justification
}

/** The inspector's `Label`. An empty string clears it, which says only `Beam` (#77 §3). */
const renameBeam: Handler<'beam.rename'> = (ctx) => {
  const { beamId, label } = ctx.intent.payload
  const beam = editBeam(ctx.draft, beamId)
  if (label.length > 80) refuse('invalid-beam', `${beamPath(beamId)}.label`, 'A Beam label is at most 80 characters.')
  if (label === '') {
    delete beam.label
    return
  }
  beam.label = label
}

/**
 * One Vertical Extent box of a Beam (#77 §3), and the whole of behaviour 9: `base` is `Underside`
 * and carries the Depth with it, `height` is `Depth` and keeps the Underside, `top` is `Top` and
 * keeps the Underside by restating the Depth, and `bottom` — the Elevation View's bottom handle
 * (#75 §6) — keeps the Top and restates the Depth.
 *
 * A Beam owns its height, so `Top` changes the height rather than moving the Beam: the same rule a
 * Wall and a Placed Item follow, and the reason the four fields are one Intent.
 */
const setVerticalExtent: Handler<'beam.setVerticalExtent'> = (ctx) => {
  const { beamId, field, value } = ctx.intent.payload
  const beam = editBeam(ctx.draft, beamId)
  requireExtentValue(field, value, beamField(beamId, field), beam.underside, beamTop(beam))
  if (field === 'base') beam.underside = value
  else if (field === 'bottom') {
    beam.height = beamTop(beam) - value
    beam.underside = value
  } else if (field === 'height') beam.height = value
  else beam.height = value - beam.underside
}

/**
 * Delete one Beam. A Beam hosts nothing — no Opening is cut into it and no Room stands on it — so
 * nothing else has to be asked about first (#77 §1). A Design Option that had demolished it is
 * tidied in the same step: a demolition can only name Existing work, so leaving the record behind
 * would make the Project invalid rather than smaller.
 */
const deleteBeam: Handler<'beam.delete'> = (ctx) => {
  const { beamId } = ctx.intent.payload
  requireBeam(ctx.project, beamId)
  ctx.draft.existingModel.beams = beamsOf(ctx.draft.existingModel).filter((beam) => beam.id !== beamId)
  for (const option of designOptionsOf(ctx.draft)) {
    if (!option.demolishedIds.includes(beamId)) continue
    option.demolishedIds = option.demolishedIds.filter((id) => id !== beamId)
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
 * Which Floor a Beam is on, whichever container holds it. A Beam this Option drew is on a Floor
 * too, and undo has to be able to find its way back to it.
 */
const beamFloor = (project: Project, beamId: EntityId): EntityId | null =>
  beamsOf(project.existingModel).find((beam) => beam.id === beamId)?.floorId ??
  designOptionsOf(project)
    .flatMap((option) => beamsOf(option.proposed))
    .find((beam) => beam.id === beamId)?.floorId ??
  null

type BeamHandlers = { [T in BeamIntent['type']]: IntentHandler<T> }

export const BEAM_HANDLERS: BeamHandlers = {
  'beam.create': { run: createBeam, locate: (_project, intent) => planLocator(intent.payload.floorId) },
  'beam.dragEndpoint': { run: dragEndpoint, locate: (project, intent) => planLocator(beamFloor(project, intent.payload.beamId)) },
  'beam.dragBody': { run: dragBody, locate: (project, intent) => planLocator(beamFloor(project, intent.payload.beamId)) },
  'beam.setLength': { run: setLength, locate: (project, intent) => planLocator(beamFloor(project, intent.payload.beamId)) },
  'beam.setWidth': { run: setWidth, locate: (project, intent) => planLocator(beamFloor(project, intent.payload.beamId)) },
  'beam.setJustification': { run: setJustification, locate: (project, intent) => planLocator(beamFloor(project, intent.payload.beamId)) },
  'beam.rename': { run: renameBeam, locate: (project, intent) => planLocator(beamFloor(project, intent.payload.beamId)) },
  'beam.setVerticalExtent': { run: setVerticalExtent, locate: (project, intent) => planLocator(beamFloor(project, intent.payload.beamId)) },
  'beam.delete': { run: deleteBeam, locate: (project, intent) => planLocator(beamFloor(project, intent.payload.beamId)) },
}

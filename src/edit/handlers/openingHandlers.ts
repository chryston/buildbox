/**
 * The Opening Intents (#65 §5, §6): place, move along the host, resize, flip the hinge, flip
 * the opening side, rename, delete.
 *
 * One rule runs through all of them. An Opening stores a distance along its host's reference
 * line and nothing else — no Floor coordinates, no polygon — so an edit writes one number and
 * the drawing, the export and the fit rule all read it back through the same clean-up. Every
 * Intent that changes where an Opening stands re-checks it against the usable interval before
 * it writes, and refuses with the one plain sentence of #65 §5 when it would no longer fit:
 * nothing is written halfway, so a refused Intent leaves the Project exactly as it was.
 *
 * A flip changes no geometry, so it never needs the fit rule — but it does need the kind:
 * a window has no hinge, and a sliding door has neither a hinge jamb nor an opening side.
 */
import type { EntityId, Project } from '../../domain'
import type { Locator, OpeningIntent } from '../intents'
import type { Handler, IntentHandler } from './context'
import { creationLayerField } from './creationLayer'
import { refuse, spendIds } from './support'
import {
  editOpening,
  openingField,
  requireDoorFields,
  requireFit,
  requireFits,
  requireHinged,
  requireOpening,
} from './openingSupport'

const planLocator = (floorId: EntityId | null): Locator => ({
  floorId,
  viewId: null,
  view: 'plan',
  itemDesignIds: [],
  placedItemIds: [],
})

const openingFloor = (project: Project, openingId: EntityId): EntityId | null =>
  project.existingModel.openings.find((opening) => opening.id === openingId)?.floorId ?? null

/**
 * Place an Opening (#65 §5). The preset's values arrive resolved into the payload — a pack
 * entry is a starting point, never a live link — and the host is the one Wall this Opening is
 * an absence in. A Wall on another Floor is not a host: an Opening has no coordinates of its
 * own, so it cannot stand anywhere but on its Wall's Floor.
 */
const createOpening: Handler<'opening.create'> = (ctx) => {
  const { floorId, hostWallId, kind, label, start, width, sill, head, swing, hingeSide, target } = ctx.intent.payload
  if (!ctx.project.floors.some((floor) => floor.id === floorId)) {
    refuse('unknown-target', `floors[${floorId}]`, `No floor answers to ${floorId}.`)
  }
  const host = ctx.project.existingModel.walls.find((wall) => wall.id === hostWallId)
  if (host === undefined) refuse('unknown-target', `existingModel.walls[${hostWallId}]`, `No wall answers to ${hostWallId}.`)
  if (host.floorId !== floorId) {
    refuse('unknown-target', `existingModel.walls[${hostWallId}]`, 'That wall is on another floor, so nothing can be cut into it from here.')
  }
  const [openingId] = spendIds(ctx.intent.ids, 1, 'opening.create')
  if (!(width > 0)) refuse('invalid-opening', openingField(openingId, 'width'), 'An opening has to be more than 0 mm wide.')
  if (!(head > sill)) {
    refuse('invalid-opening', openingField(openingId, 'head'), 'The top of an opening has to be above its bottom.')
  }
  requireDoorFields(openingId, kind, swing, hingeSide)
  requireFit(ctx.project, host, { id: openingId, label, kind, width }, start, width)
  ctx.draft.existingModel.openings.push({
    id: openingId,
    floorId,
    hostWallId,
    kind,
    label,
    start,
    width,
    sill,
    head,
    ...(swing === undefined ? {} : { swing }),
    ...(hingeSide === undefined ? {} : { hingeSide }),
    // An Opening is built fabric like the Wall it is cut into (#71 §2).
    ...creationLayerField(ctx.project, target?.viewId, 'fabric'),
  })
}

/**
 * Move along the host (#65 §6). The distance is always from the reference line's own start —
 * the inspector's "distance from the other end" is the same number read backwards, and the UI
 * turns it before sending, so one field is stored and one field can ever be wrong.
 */
const setStart: Handler<'opening.setStart'> = (ctx) => {
  const { openingId, start } = ctx.intent.payload
  const opening = requireOpening(ctx.project, openingId)
  requireFits(ctx.project, opening, start, opening.width)
  editOpening(ctx.draft, openingId).start = start
}

/**
 * Resize the width (#65 §6), measured as the chord. A typed width keeps the near jamb where
 * it is; a symmetric drag moves both jambs and says so by sending the new `start` too. The
 * fit rule judges the width it is given at the arc's own curvature, which is why a window can
 * run out of a curved Wall's room before its arc length runs out.
 */
const setWidth: Handler<'opening.setWidth'> = (ctx) => {
  const { openingId, width, start } = ctx.intent.payload
  const opening = requireOpening(ctx.project, openingId)
  if (!(width > 0)) refuse('invalid-opening', openingField(openingId, 'width'), 'An opening has to be more than 0 mm wide.')
  const at = start ?? opening.start
  requireFits(ctx.project, opening, at, width)
  const written = editOpening(ctx.draft, openingId)
  written.width = width
  written.start = at
}

/** `Flip hinge`: the leaf hangs on the other jamb (#65 §6). The Opening stands where it was. */
const flipHinge: Handler<'opening.flipHinge'> = (ctx) => {
  const { openingId } = ctx.intent.payload
  const opening = requireOpening(ctx.project, openingId)
  requireHinged(opening)
  editOpening(ctx.draft, openingId).hingeSide = opening.hingeSide === 'start' ? 'end' : 'start'
}

/** `Flip opening side`: the leaf opens toward the other face of the host (#65 §6). */
const flipSwing: Handler<'opening.flipSwing'> = (ctx) => {
  const { openingId } = ctx.intent.payload
  const opening = requireOpening(ctx.project, openingId)
  const swing = requireHinged(opening)
  editOpening(ctx.draft, openingId).swing = swing === 'left' ? 'right' : 'left'
}

/** Rename. An empty name is left for the validator to refuse, the way a Floor's is (#42 §5). */
const renameOpening: Handler<'opening.rename'> = (ctx) => {
  const { openingId, label } = ctx.intent.payload
  requireOpening(ctx.project, openingId)
  editOpening(ctx.draft, openingId).label = label.trim()
}

/** Delete one Opening. The Wall it was cut into stays, whole, with the gap in it. */
const deleteOpening: Handler<'opening.delete'> = (ctx) => {
  const { openingId } = ctx.intent.payload
  requireOpening(ctx.project, openingId)
  ctx.draft.existingModel.openings = ctx.draft.existingModel.openings.filter((opening) => opening.id !== openingId)
}

type OpeningHandlers = { [T in OpeningIntent['type']]: IntentHandler<T> }

export const OPENING_HANDLERS: OpeningHandlers = {
  'opening.create': { run: createOpening, locate: (_project, intent) => planLocator(intent.payload.floorId) },
  'opening.setStart': { run: setStart, locate: (project, intent) => planLocator(openingFloor(project, intent.payload.openingId)) },
  'opening.setWidth': { run: setWidth, locate: (project, intent) => planLocator(openingFloor(project, intent.payload.openingId)) },
  'opening.flipHinge': { run: flipHinge, locate: (project, intent) => planLocator(openingFloor(project, intent.payload.openingId)) },
  'opening.flipSwing': { run: flipSwing, locate: (project, intent) => planLocator(openingFloor(project, intent.payload.openingId)) },
  'opening.rename': { run: renameOpening, locate: (project, intent) => planLocator(openingFloor(project, intent.payload.openingId)) },
  'opening.delete': { run: deleteOpening, locate: (project, intent) => planLocator(openingFloor(project, intent.payload.openingId)) },
}

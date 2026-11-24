/**
 * The Service Intents (#79 §3, §4): drawing a Run or a Riser, moving an end or the whole element,
 * the Kind, the section and the size, the vertical boxes, the label and delete.
 *
 * A Service stores its centreline as two points and its place in the storey as **one** number — the
 * centreline — read against its own section. Everything else the plan and the Elevation View show —
 * the two faces, the Bottom, the Top, the footprint — is derived on read, so an edit moves points and
 * one or two numbers and never a polygon. A Riser is the one shape that owns a height, so it stores
 * `bottomElevation` plus `height` exactly as a Beam stores Underside plus Depth (#77 §3).
 *
 * A Service has no host and no Junction (#79 §1): it joins nothing, nothing hangs from it, and no edit
 * of a Wall, a Beam or a Floor reaches into it. That is why none of this family is wrapped in the
 * Wall-fit check of #65 §7 — there is nothing here for that check to re-measure, and no Room Edge lies
 * on a Service face. The coordination warnings a Service takes part in are measured on read
 * (#79 §Warnings) and are never a reason to refuse an edit.
 *
 * Like the Wall Intents, the edits of an entity that already exists are edits of the Existing Model:
 * while the Project carries a Design Option the survey is the record every Option is drawn against,
 * and changing it is a correction (#69 §12), not a renovation. Only `service.create` writes into an
 * Option, because drawing a Service there is proposing work rather than restating the survey.
 */
import type { EntityId, Project, Service, ServiceRiser, ServiceRun } from '../../domain'
import { SERVICE_KINDS, designOptionsOf, serviceTop, servicesOf } from '../../domain'
import { TOLERANCE_MM, distance, pt } from '../../geometry'
import {
  DEFAULT_SERVICE_DEPTH_MM,
  DEFAULT_SERVICE_DIAMETER_MM,
  DEFAULT_SERVICE_WIDTH_MM,
} from '../defaults'
import type { CreateService, IntentTarget, Locator, ServiceIntent, ServiceVerticalField } from '../intents'
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

const servicePath = (serviceId: EntityId): string => `existingModel.services[${serviceId}]`

/** The closed Kind vocabulary, as a set: the payload's `kind` is a string until this says otherwise. */
const SERVICE_KIND_SET: ReadonlySet<string> = new Set<string>(SERVICE_KINDS)

/**
 * The record field one vertical box writes (#79 §4), named so a rejection points at what changed
 * rather than at the box that was typed. A Run has one vertical field, the centreline, whatever the
 * box was called; a Riser writes its Bottom or its Height, and `Top` is not a field but the sum.
 */
const serviceField = (serviceId: EntityId, service: Service, field: ServiceVerticalField): string =>
  `${servicePath(serviceId)}.${service.shape === 'run' ? 'centrelineElevation' : field === 'bottom' ? 'bottomElevation' : 'height'}`

/** The Service, or a rejection: every Service Intent about an existing Service names one. */
const requireService = (project: Project, serviceId: EntityId): Service => {
  const found = servicesOf(project.existingModel).find((service) => service.id === serviceId)
  if (found === undefined) refuse('unknown-target', servicePath(serviceId), `No Service answers to ${serviceId}.`)
  return found
}

/** The Service as the draft holds it, which is what a handler writes to. */
const editService = (draft: Project, serviceId: EntityId): Service => requireService(draft, serviceId)

/** A Run, or a rejection naming the shape that was actually found (#79 §4). */
function requireRun(service: Service, serviceId: EntityId, what: string): ServiceRun {
  if (service.shape !== 'run') {
    refuse('invalid-service', servicePath(serviceId), `A Riser has no ${what} — it is one vertical line at one point.`)
  }
  return service
}

/** Half the depth a Run's Vertical Extent is measured by: the Diameter, or the rectangular Depth. */
const runHalfDepth = (run: ServiceRun): number =>
  run.section === 'round' ? (run.outsideDiameter ?? 0) / 2 : (run.depth ?? 0) / 2

/** A Run has to join two points further apart than the drawing tolerance, or it is a dot. */
function requireServiceLine(serviceId: EntityId, line: { start: { x: number; y: number }; end: { x: number; y: number } }): void {
  if (!(distance(line.start, line.end) > TOLERANCE_MM)) {
    refuse('invalid-service', `${servicePath(serviceId)}.line`, 'A Service Run has to join two different points.')
  }
}

/** A size typed into any size box, or a rejection: a pipe of no diameter draws nothing. */
function requireSize(serviceId: EntityId, field: string, value: number | undefined): number {
  if (!(value !== undefined && value > 0)) {
    refuse('invalid-service', `${servicePath(serviceId)}.${field}`, `A Service ${field} has to be more than 0 mm.`)
  }
  return value
}

/**
 * A new Service (#79 §3): the geometry the tool drew, the Kind, section and size the panel holds, and
 * the Layer the view files it on.
 *
 * One Intent for both shapes, because the tool is one tool and the Kind and the size travel
 * identically; what differs is the geometry and the vertical pair, and each shape refuses the fields
 * the other owns rather than ignoring them — a payload that sends a `point` for a Run is a bug in the
 * caller, and a record that quietly dropped it would be a lie about what was drawn. A Service drawn
 * inside a Design Option is proposed work: the same checks, the same writes, into that Option's
 * container (#69 §7), and it lands on `Services` like every other Service (#71 §2, #79 §5).
 */
const createService: Handler<'service.create'> = (ctx) => {
  const { floorId, shape, kind, line, point, centrelineElevation, bottomElevation, height, section, outsideDiameter, width, depth, label, target } =
    ctx.intent.payload as CreateService & IntentTarget
  if (!ctx.project.floors.some((floor) => floor.id === floorId)) {
    refuse('unknown-target', `floors[${floorId}]`, `No floor answers to ${floorId}.`)
  }
  const [serviceId] = spendIds(ctx.intent.ids, 1, 'service.create')
  const path = servicePath(serviceId)
  if (!SERVICE_KIND_SET.has(kind)) refuse('invalid-service', `${path}.kind`, 'Choose a Kind this Service is.')
  const container = containerOf(ctx.draft, target?.designOptionId)
  const provenance = proposedProvenance(isInOption(container, ctx.draft))
  const layer = creationLayerField(ctx.project, target?.viewId, 'service')
  const named = label === undefined || label === '' ? {} : { label }
  if (shape === 'run') {
    if (line === undefined) refuse('invalid-service', `${path}.line`, 'A Service Run needs two points to join.')
    if (section === undefined) refuse('invalid-service', `${path}.section`, 'A Service Run needs a section: round or rectangular.')
    if (centrelineElevation === undefined) refuse('invalid-service', `${path}.centrelineElevation`, 'Enter a centreline.')
    if (point !== undefined) refuse('invalid-service', `${path}.point`, 'A Service Run is a line, not a point.')
    if (bottomElevation !== undefined || height !== undefined) {
      refuse('invalid-service', path, 'A Service Run keeps one centreline; its Bottom and Top follow from the section.')
    }
    requireServiceLine(serviceId, line)
    if (!Number.isFinite(centrelineElevation)) refuse('invalid-service', `${path}.centrelineElevation`, 'Enter a number.')
    const run: ServiceRun = {
      id: serviceId,
      floorId,
      shape: 'run',
      kind,
      section,
      line: { start: pt(line.start.x, line.start.y), end: pt(line.end.x, line.end.y) },
      centrelineElevation,
      ...named,
      ...provenance,
      ...layer,
    }
    if (section === 'round') {
      if (width !== undefined || depth !== undefined) {
        refuse('invalid-service', path, 'A round Run has a Diameter, not a Width and a Depth.')
      }
      run.outsideDiameter = requireSize(serviceId, 'outsideDiameter', outsideDiameter)
    } else {
      if (outsideDiameter !== undefined) {
        refuse('invalid-service', `${path}.outsideDiameter`, 'A rectangular Run has a Width and a Depth, not a Diameter.')
      }
      run.width = requireSize(serviceId, 'width', width)
      run.depth = requireSize(serviceId, 'depth', depth)
    }
    container.services = [...(servicesOf(container) as Service[]), run]
    return
  }
  if (point === undefined) refuse('invalid-service', `${path}.point`, 'A Service Riser needs the plan point it passes through.')
  if (line !== undefined) refuse('invalid-service', `${path}.line`, 'A Service Riser is one vertical line, not a run.')
  if (section !== undefined || centrelineElevation !== undefined || width !== undefined || depth !== undefined) {
    refuse('invalid-service', path, 'A Service Riser is round and owns its height: it has no section, centreline, Width or Depth.')
  }
  const riserDiameter = requireSize(serviceId, 'outsideDiameter', outsideDiameter)
  if (bottomElevation === undefined) refuse('invalid-service', `${path}.bottomElevation`, 'Enter a bottom.')
  if (height === undefined) refuse('invalid-service', `${path}.height`, 'Enter a height.')
  if (!Number.isFinite(bottomElevation)) refuse('invalid-service', `${path}.bottomElevation`, 'Enter a number.')
  if (!(height > 0)) refuse('invalid-service', `${path}.height`, 'A Service Riser has to be more than 0 mm tall.')
  const riser: ServiceRiser = {
    id: serviceId,
    floorId,
    shape: 'riser',
    kind,
    point: pt(point.x, point.y),
    outsideDiameter: riserDiameter,
    bottomElevation,
    height,
    ...named,
    ...provenance,
    ...layer,
  }
  container.services = [...(servicesOf(container) as Service[]), riser]
}

/**
 * Move one end of a Run's centreline (#79 §4). Nothing follows: a Service has no Junction, no host and
 * no Room Edge, and the Wall, Beam or Floor it crosses is not told about it (#79 §1 criterion 2).
 */
const dragEndpoint: Handler<'service.dragEndpoint'> = (ctx) => {
  const { serviceId, end, to } = ctx.intent.payload
  const run = requireRun(editService(ctx.draft, serviceId), serviceId, 'end')
  const line = end === 'start' ? { start: pt(to.x, to.y), end: run.line.end } : { start: run.line.start, end: pt(to.x, to.y) }
  requireServiceLine(serviceId, line)
  run.line = line
}

/** Move a whole Service: a Run's two ends, or a Riser's plan point, by the same delta. */
const dragBody: Handler<'service.dragBody'> = (ctx) => {
  const { serviceId, delta } = ctx.intent.payload
  const service = editService(ctx.draft, serviceId)
  if (service.shape === 'run') {
    service.line = {
      start: pt(service.line.start.x + delta.x, service.line.start.y + delta.y),
      end: pt(service.line.end.x + delta.x, service.line.end.y + delta.y),
    }
    return
  }
  service.point = pt(service.point.x + delta.x, service.point.y + delta.y)
}

/**
 * The inspector's `Length` (#79 §4): one end stays where it is and the other moves along the
 * centreline the Run already has, so the direction, the section and the elevation are untouched. A
 * Riser has no Length box — its height is the `Height` of its Vertical Extent (#79 §4).
 */
const setLength: Handler<'service.setLength'> = (ctx) => {
  const { serviceId, length, keepFixed } = ctx.intent.payload
  const run = requireRun(editService(ctx.draft, serviceId), serviceId, 'Length')
  if (!(length > TOLERANCE_MM)) refuse('invalid-service', servicePath(serviceId), 'A Service Run has to be more than 0.01 mm long.')
  const from = keepFixed === 'start' ? run.line.start : run.line.end
  const toward = keepFixed === 'start' ? run.line.end : run.line.start
  const dx = toward.x - from.x
  const dy = toward.y - from.y
  const along = Math.hypot(dx, dy) || 1
  const at = pt(from.x + (dx * length) / along, from.y + (dy * length) / along)
  run.line = keepFixed === 'start' ? { start: run.line.start, end: at } : { start: at, end: run.line.end }
}

/** The inspector's `Kind`. The Kind is never the element's name (#79 §Naming), so nothing else moves. */
const setKind: Handler<'service.setKind'> = (ctx) => {
  const { serviceId, kind } = ctx.intent.payload
  if (!SERVICE_KIND_SET.has(kind)) refuse('invalid-service', `${servicePath(serviceId)}.kind`, 'Choose a Kind this Service is.')
  editService(ctx.draft, serviceId).kind = kind
}

/**
 * The inspector's `Section`: round or rectangular, and only for a Run — a Riser is round and says so
 * by not carrying a section at all (#79 §3).
 *
 * The size does not convert. A Diameter and a Width-plus-Depth pair measure different things, and
 * guessing between them would put a number on the drawing that nobody typed, so the new section
 * restarts at the same `measure yours` placeholders a new Service starts at and the centreline stays
 * exactly where it was.
 */
const setSection: Handler<'service.setSection'> = (ctx) => {
  const { serviceId, section } = ctx.intent.payload
  const run = requireRun(editService(ctx.draft, serviceId), serviceId, 'section')
  if (section === run.section) return
  run.section = section
  if (section === 'round') {
    run.outsideDiameter = DEFAULT_SERVICE_DIAMETER_MM
    delete run.width
    delete run.depth
    return
  }
  run.width = DEFAULT_SERVICE_WIDTH_MM
  run.depth = DEFAULT_SERVICE_DEPTH_MM
  delete run.outsideDiameter
}

/**
 * The inspector's `Diameter`: the outside diameter, in millimetres.
 *
 * A rectangular Run refuses it rather than converting it to a Width — the same reason `setSection`
 * refuses to guess. A Riser takes it, being always round.
 */
const setOutsideDiameter: Handler<'service.setOutsideDiameter'> = (ctx) => {
  const { serviceId, outsideDiameter } = ctx.intent.payload
  const service = editService(ctx.draft, serviceId)
  const size = requireSize(serviceId, 'outsideDiameter', outsideDiameter)
  if (service.shape === 'run') {
    if (service.section !== 'round') {
      refuse('invalid-service', `${servicePath(serviceId)}.outsideDiameter`, 'A rectangular Run has a Width and a Depth, not a Diameter.')
    }
    service.outsideDiameter = size
    return
  }
  service.outsideDiameter = size
}

/** The inspector's `Width`: across the Run in plan, the side the footprint is built at. */
const setWidth: Handler<'service.setWidth'> = (ctx) => {
  const { serviceId, width } = ctx.intent.payload
  const run = requireRun(editService(ctx.draft, serviceId), serviceId, 'Width')
  const size = requireSize(serviceId, 'width', width)
  if (run.section !== 'rectangular') {
    refuse('invalid-service', `${servicePath(serviceId)}.width`, 'A round Run has a Diameter, not a Width and a Depth.')
  }
  run.width = size
}

/** The inspector's `Depth`: the vertical side, the one that decides where the Bottom and Top fall. */
const setDepth: Handler<'service.setDepth'> = (ctx) => {
  const { serviceId, depth } = ctx.intent.payload
  const run = requireRun(editService(ctx.draft, serviceId), serviceId, 'Depth')
  const size = requireSize(serviceId, 'depth', depth)
  if (run.section !== 'rectangular') {
    refuse('invalid-service', `${servicePath(serviceId)}.depth`, 'A round Run has a Diameter, not a Width and a Depth.')
  }
  run.depth = size
}

/**
 * One vertical box of a Service (#79 §4), in millimetres from the Floor Datum.
 *
 * A Run stores one centreline, so `centre` is that number and `bottom` / `top` are converted back to
 * it against half the section — the whole point of storing one field instead of three (#79 §4). A
 * Riser owns its height the way a Beam owns its Depth: `bottom` keeps the Height and moves the Top
 * with it, `height` keeps the Bottom, and `top` keeps the Bottom by restating the Height.
 */
const setVerticalExtent: Handler<'service.setVerticalExtent'> = (ctx) => {
  const { serviceId, field, value } = ctx.intent.payload
  const service = editService(ctx.draft, serviceId)
  const path = serviceField(serviceId, service, field)
  if (service.shape === 'run') {
    if (field === 'height') refuse('invalid-service', path, 'A Service Run has no Height — its vertical size is its section.')
    if (!Number.isFinite(value)) refuse('invalid-extent', path, 'Enter a number.')
    const half = runHalfDepth(service)
    service.centrelineElevation = field === 'centre' ? value : field === 'bottom' ? value + half : value - half
    return
  }
  if (field === 'centre') refuse('invalid-service', path, 'A Service Riser has no centreline — it runs from a bottom to a top.')
  requireExtentValue(field, value, path, service.bottomElevation, serviceTop(service))
  if (field === 'bottom') service.bottomElevation = value
  else if (field === 'height') service.height = value
  else service.height = value - service.bottomElevation
}

/** The inspector's `Label`. An empty string clears it, which says only `Service` (#79 §Naming). */
const renameService: Handler<'service.rename'> = (ctx) => {
  const { serviceId, label } = ctx.intent.payload
  const service = editService(ctx.draft, serviceId)
  if (label.length > 80) refuse('invalid-service', `${servicePath(serviceId)}.label`, 'A Service label is at most 80 characters.')
  if (label === '') {
    delete service.label
    return
  }
  service.label = label
}

/**
 * Delete one Service. A Service hosts nothing and nothing refers to it — no Opening is cut into it, no
 * Room stands on it, no warning key outlives it — so nothing else has to be asked about first
 * (#79 §1). A Design Option that had demolished it is tidied in the same step: a demolition can only
 * name Existing work, so leaving the record behind would make the Project invalid rather than smaller.
 */
const deleteService: Handler<'service.delete'> = (ctx) => {
  const { serviceId } = ctx.intent.payload
  requireService(ctx.project, serviceId)
  ctx.draft.existingModel.services = servicesOf(ctx.draft.existingModel).filter((service) => service.id !== serviceId)
  for (const option of designOptionsOf(ctx.draft)) {
    if (!option.demolishedIds.includes(serviceId)) continue
    option.demolishedIds = option.demolishedIds.filter((id) => id !== serviceId)
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
 * Which Floor a Service is on, whichever container holds it. A Service this Option drew is on a Floor
 * too, and undo has to be able to find its way back to it.
 */
const serviceFloor = (project: Project, serviceId: EntityId): EntityId | null =>
  servicesOf(project.existingModel).find((service) => service.id === serviceId)?.floorId ??
  designOptionsOf(project)
    .flatMap((option) => servicesOf(option.proposed))
    .find((service) => service.id === serviceId)?.floorId ??
  null

type ServiceHandlers = { [T in ServiceIntent['type']]: IntentHandler<T> }

export const SERVICE_HANDLERS: ServiceHandlers = {
  'service.create': { run: createService, locate: (_project, intent) => planLocator(intent.payload.floorId) },
  'service.dragEndpoint': { run: dragEndpoint, locate: (project, intent) => planLocator(serviceFloor(project, intent.payload.serviceId)) },
  'service.dragBody': { run: dragBody, locate: (project, intent) => planLocator(serviceFloor(project, intent.payload.serviceId)) },
  'service.setLength': { run: setLength, locate: (project, intent) => planLocator(serviceFloor(project, intent.payload.serviceId)) },
  'service.setKind': { run: setKind, locate: (project, intent) => planLocator(serviceFloor(project, intent.payload.serviceId)) },
  'service.setSection': { run: setSection, locate: (project, intent) => planLocator(serviceFloor(project, intent.payload.serviceId)) },
  'service.setOutsideDiameter': { run: setOutsideDiameter, locate: (project, intent) => planLocator(serviceFloor(project, intent.payload.serviceId)) },
  'service.setWidth': { run: setWidth, locate: (project, intent) => planLocator(serviceFloor(project, intent.payload.serviceId)) },
  'service.setDepth': { run: setDepth, locate: (project, intent) => planLocator(serviceFloor(project, intent.payload.serviceId)) },
  'service.setVerticalExtent': { run: setVerticalExtent, locate: (project, intent) => planLocator(serviceFloor(project, intent.payload.serviceId)) },
  'service.rename': { run: renameService, locate: (project, intent) => planLocator(serviceFloor(project, intent.payload.serviceId)) },
  'service.delete': { run: deleteService, locate: (project, intent) => planLocator(serviceFloor(project, intent.payload.serviceId)) },
}

/**
 * The Services of one Floor, drawn (#79 §1, §4, §6).
 *
 * A Run stores a straight centreline and one section; the body the plan paints is that centreline
 * widened by the section's plan width through `geometry.linearElement` — the same primitive a Wall
 * and a Beam are built from, which is the issue's "one line-element vocabulary". A Riser is a circle
 * at one point, so it has a centre and a radius and no outline: a circle is not a `ClosedPath` and
 * pretending otherwise would make the drawing layer draw a polygon and call it a pipe.
 *
 * Nothing here is stored. A Run that has been widened has always been that wide, and a record with a
 * Bottom or a Top in it would be a second answer to the same question — the two elevations are read
 * off the centreline and the section, exactly as `domain` reads them.
 *
 * A Service joins nothing and hosts nothing (#79 §1). There is no clean-up pass over this list, no
 * trim of one Service by another, and no relationship to keep in step: two Services that cross simply
 * both exist. That is why this module is a map and a list.
 */
import type { EntityId, Project, Service, ServiceShape } from '../domain'
import { serviceBottom, servicePlanLabel, serviceRunWidth, serviceTop, servicesOf } from '../domain'
import type { ClosedPath, Pt } from '../geometry'
import { linearElement, pt, refLength } from '../geometry'
import { effectiveModel } from './effectiveModel'

/** One Service of the Floor, with the geometry the plan and the Elevation View paint. */
export interface DerivedService {
  readonly id: EntityId
  /** `W Ø50`, `AC 80×60`, or the label text for an `other` — the words the plan writes (#79 §6). */
  readonly label: string
  readonly shape: ServiceShape
  /**
   * The body of a Run: the centreline widened by the section's plan width, centred. `null` for a
   * Riser, which is a circle and is painted from {@link centre} and {@link radius}.
   */
  readonly outline: ClosedPath | null
  /** The Riser's plan point; `null` for a Run. */
  readonly centre: Pt | null
  /** Half the Riser's outside Diameter; `null` for a Run. */
  readonly radius: number | null
  /** Length along the centreline for a Run, the Height for a Riser — never a diagonal. */
  readonly length: number
  readonly bottom: number
  readonly top: number
  /** The one elevation a Run stores; `null` for a Riser, which stores a bottom and a height. */
  readonly centrelineElevation: number | null
  readonly entity: Service
}

/** Everything derived for one Floor's Services. */
export interface FloorServices {
  readonly services: readonly DerivedService[]
  readonly byId: ReadonlyMap<EntityId, DerivedService>
}

/** The four corners of a Run's body, walked off the outline `linearElement` returns. */
function runBody(line: { start: Pt; end: Pt }, width: number): ClosedPath {
  const { outline } = linearElement({ kind: 'line', to: line.end }, line.start, width, 'centre')
  const [face0, cap, face1Back] = outline.segments
  const [a, b, c, d] = [outline.start, face0.to, cap.to, face1Back.to]
  return { start: a, segments: [{ kind: 'line', to: b }, { kind: 'line', to: c }, { kind: 'line', to: d }, { kind: 'line', to: a }] }
}

/**
 * The Services one Floor draws, with their bodies (#79 §4).
 *
 * Pure: the same Project, Floor and Design Option always give a byte-identical answer, and a Floor
 * with no Services gives an empty result rather than `undefined`.
 */
export const deriveServices = (project: Project, floorId: EntityId, optionId: EntityId | null = null): FloorServices => {
  const model = effectiveModel(project, floorId, optionId)
  const services = model.services
    .filter(({ entity }) => entity.floorId === floorId)
    .map(({ entity }): DerivedService =>
      entity.shape === 'run'
        ? {
            id: entity.id,
            label: servicePlanLabel(entity),
            shape: 'run',
            outline: runBody(entity.line, serviceRunWidth(entity)),
            centre: null,
            radius: null,
            length: refLength({ kind: 'line', start: entity.line.start, end: entity.line.end }),
            bottom: serviceBottom(entity),
            top: serviceTop(entity),
            centrelineElevation: entity.centrelineElevation,
            entity,
          }
        : {
            id: entity.id,
            label: servicePlanLabel(entity),
            shape: 'riser',
            outline: null,
            centre: pt(entity.point.x, entity.point.y),
            radius: entity.outsideDiameter / 2,
            length: entity.height,
            bottom: serviceBottom(entity),
            top: serviceTop(entity),
            centrelineElevation: null,
            entity,
          },
    )
  return { services, byId: new Map(services.map((service) => [service.id, service])) }
}

/** Every Service of the Project, whichever Floor it stands on — the schedule and the lists read this. */
export const projectServices = (project: Project): readonly Service[] => servicesOf(project.existingModel)

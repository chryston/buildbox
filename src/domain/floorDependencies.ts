/**
 * What depends on a Floor (#56).
 *
 * Deleting a Floor is blocked until everything that leans on it is gone first (#25: no
 * cascade, nothing reassigned behind the user's back). The list of things that can lean on
 * a Floor grows — Walls, Rooms, Openings and Annotations each register themselves in their
 * own issue — so it is one registry of kinds rather than a `switch` that every caller
 * repeats. A kind says how to count itself on a Floor; nothing here deletes anything.
 *
 * The Floor's own default Plan View is deliberately absent: it is part of the Floor rather
 * than a dependant of it, so it goes with the Floor in the same transaction and never
 * counts as a reason to refuse.
 */
import { beamsOf, elevationViewsOf, servicesOf, skirtingOf } from './project'
import type { Project } from './project'

/** One kind of floor-local content, and how many of it a Floor carries. */
export interface FloorDependencyKind {
  /** Stable identifier, so a dialog can key a row and a test can name a kind. */
  readonly id: string
  /** The noun the summary row reads, already plural-or-singular by `count`. */
  readonly label: string
  readonly labelOne: string
  readonly labelMany: string
  count(project: Project, floorId: string): number
}

const placedItems: FloorDependencyKind = {
  id: 'placedItems',
  label: 'Placed Items',
  labelOne: 'Placed Item',
  labelMany: 'Placed Items',
  count: (project, floorId) =>
    project.existingModel.placedItems.reduce((total, item) => (item.floorId === floorId ? total + 1 : total), 0),
}

/**
 * The Beams standing on a Floor (#77 §1).
 *
 * A Beam names its Floor and nothing else — no host, no Junction — so a Floor deleted under one
 * leaves a record that refers to nothing, which is the Project the validator refuses. It is
 * refused at the door instead: nothing here deletes a Beam for you.
 */
const beams: FloorDependencyKind = {
  id: 'beams',
  label: 'Beams',
  labelOne: 'Beam',
  labelMany: 'Beams',
  count: (project, floorId) => beamsOf(project.existingModel).reduce((total, beam) => (beam.floorId === floorId ? total + 1 : total), 0),
}

/**
 * The Skirting standing on a Floor (#78 §1).
 *
 * A Skirting names its Floor and the one Wall it is drawn against, so a Floor deleted under one
 * leaves a record that refers to nothing — the Project the validator refuses. It is refused at the
 * door instead: nothing here deletes a Skirting for you.
 */
const skirting: FloorDependencyKind = {
  id: 'skirting',
  label: 'Skirting',
  labelOne: 'Skirting',
  labelMany: 'Skirting',
  count: (project, floorId) =>
    skirtingOf(project.existingModel).reduce((total, entry) => (entry.floorId === floorId ? total + 1 : total), 0),
}

/**
 * The Services documented on a Floor (#79 §1).
 *
 * A Service names its Floor and nothing else — no host, no storey — so a Floor deleted under one
 * leaves a record that refers to nothing, which is the Project the validator refuses. It is refused
 * at the door instead: nothing here deletes a Service for you.
 */
const services: FloorDependencyKind = {
  id: 'services',
  label: 'Services',
  labelOne: 'Service',
  labelMany: 'Services',
  count: (project, floorId) =>
    servicesOf(project.existingModel).reduce((total, service) => (service.floorId === floorId ? total + 1 : total), 0),
}

const planImage: FloorDependencyKind = {
  id: 'planImage',
  label: 'Plan Image',
  labelOne: 'Plan Image',
  labelMany: 'Plan Images',
  count: (project, floorId) =>
    project.floors.some((floor) => floor.id === floorId && floor.planImage !== null) ? 1 : 0,
}

const planViews: FloorDependencyKind = {
  id: 'planViews',
  label: 'Plan Views',
  // `named`, because the count is of the views a person added: every Floor has a default
  // Plan View and that one goes with the Floor without being asked about.
  labelOne: 'named Plan View',
  labelMany: 'named Plan Views',
  count: (project, floorId) =>
    project.views.reduce((total, view) => (view.floorId === floorId && !view.isDefault ? total + 1 : total), 0),
}

/**
 * The Elevation Views looking along a Floor (#75 §3).
 *
 * Every one of them is a dependant, with no default among them: an Elevation View is always one a
 * person made, so none of them goes with the Floor without being asked about. Deleting the Floor
 * would leave a view pointing at a Floor that is not there, which is a Project the validator refuses
 * and a card that opens on nothing — so the Floor waits until its views are deleted first.
 */
const elevationViews: FloorDependencyKind = {
  id: 'elevationViews',
  label: 'Elevation Views',
  labelOne: 'Elevation View',
  labelMany: 'Elevation Views',
  count: (project, floorId) =>
    elevationViewsOf(project).reduce((total, view) => (view.floorId === floorId ? total + 1 : total), 0),
}

/**
 * Every kind that can depend on a Floor, in the order a summary lists them. A later issue
 * adds a kind by appending one entry here; no caller changes.
 */
export const FLOOR_DEPENDENCY_KINDS: readonly FloorDependencyKind[] = [
  placedItems,
  beams,
  skirting,
  services,
  planImage,
  planViews,
  elevationViews,
]

/** One kind's count for one Floor, with the words to show it. */
export interface FloorDependency {
  readonly kind: FloorDependencyKind
  readonly count: number
  /** `1 Placed Item` / `3 Placed Items`, the row's whole right-hand side. */
  readonly text: string
}

/**
 * What depends on `floorId`, in registry order. A Floor that does not exist reads as
 * having nothing: the summary is asked for a Floor the Project has, and a missing one is
 * the validator's problem rather than this function's.
 */
export function summarizeFloorDependencies(project: Project, floorId: string): FloorDependency[] {
  return FLOOR_DEPENDENCY_KINDS.map((kind) => {
    const count = kind.count(project, floorId)
    return { kind, count, text: `${count} ${count === 1 ? kind.labelOne : kind.labelMany}` }
  })
}

/** Whether anything still leans on this Floor, which is what keeps `Delete Floor` disabled. */
export function floorHasDependencies(project: Project, floorId: string): boolean {
  return FLOOR_DEPENDENCY_KINDS.some((kind) => kind.count(project, floorId) > 0)
}

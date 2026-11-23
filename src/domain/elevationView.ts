/**
 * The Elevation View: a saved view that looks sideways along one line of one Floor (#75 §1).
 *
 * Its own module because it is the second kind of saved view, and the two kinds share everything
 * except what they look at: an Elevation View carries the same Design Option, Renovation Display and
 * layer settings a Plan View does ({@link SavedViewSettings}) and holds no geometry, no Placed Item
 * and no Plan Image of its own — deleting one deletes nothing but the view.
 *
 * What a view *shows* — which entities fall inside the prism, where each one lands on the screen, in
 * what order they are drawn — is derived, never stored, and lives in `geometry` and `derive` (#75
 * Notes). This module says only what a view *is*: a line, a side, a depth and a name.
 */
import { nameKey } from './floorNames'
import { elevationViewsOf } from './project'
import type { EntityId, Point2, Project, SavedViewSettings } from './project'

/**
 * Which side of the view line the Elevation View looks from, named for the start→end direction.
 *
 * The same convention a Wall's faces use (#64): the reference normal of a start→end direction `u` is
 * `(-u.y, u.x)`, and `left` is the negative side of it. So the viewing normal of a view is
 * `n = (u.y, -u.x)` for `'left'` and `n = (-u.y, u.x)` for `'right'`. One convention for both kinds of
 * record means one rotation, and it is what makes the plan marker's arrow and the elevation's content
 * agree: the arrow points along `n`, into the band, and the band is everything between the line and
 * `depth` mm along `n` (#75 criterion 7).
 *
 * `side` is data, never a screen word: the interface flips it with a `Direction ⇄` button and names a
 * side by what it faces, exactly as a Room names a Wall face (#67 D8).
 */
export type ElevationViewSide = 'left' | 'right'

/** Every side a view may look from, in the order the card offers them. */
export const ELEVATION_VIEW_SIDES: readonly ElevationViewSide[] = ['left', 'right']

/**
 * The view line: the two points the tool clicked, in the Floor's local frame, in millimetres.
 *
 * Any angle is allowed (#75 behaviour 12) — the line is not tied to a plan axis and is never stretched
 * to the room. A line of no length is refused by the validator: it bounds no band and projects
 * everything in the building onto one point.
 */
export interface ElevationViewLine {
  start: Point2
  end: Point2
}

/**
 * A saved sideways look at exactly one Floor (#75 §1): the view line, which side of it the viewer
 * stands on, and how far they look.
 *
 * The three definition fields say everything the view is aimed at. Together with the line's own
 * length they bound a finite prism — `line length × depth`, standing on the line and running `depth`
 * mm along the viewing normal — and only content inside it appears in the Elevation View. The prism is
 * closed at the far edge, so content touching it exactly is in (#75 criterion 10).
 *
 * Like a Plan View it is a viewer and nothing else: changing any field of this record moves no entity,
 * reopens no warning and hides nothing that was not already outside the band.
 */
export interface ElevationView extends SavedViewSettings {
  id: EntityId
  kind: 'elevation'
  /** An Elevation View looks along exactly one Floor. */
  floorId: EntityId
  /** Unique among the Elevation Views of that Floor, ignoring case. */
  name: string
  /** The line the view stands on, in the Floor's local millimetres. */
  line: ElevationViewLine
  /** Which side of that line it looks from. */
  side: ElevationViewSide
  /** How far it looks, in millimetres along the viewing normal. Always more than zero. */
  depth: number
}

/**
 * Whether another Elevation View of one Floor already answers to `name`, ignoring case (#75 §1).
 *
 * The rule is `planViewNameTaken`'s, applied to the second kind: unique among the Elevation Views of
 * that Floor and nothing else. An Elevation View and a Plan View of one Floor may share a name,
 * because the saved-view picker lists the two kinds as separate groups and never asks which `First
 * floor` was meant.
 */
export function elevationViewNameTaken(
  project: Project,
  floorId: EntityId,
  name: string,
  exceptViewId: EntityId | null = null,
): boolean {
  const key = nameKey(name)
  return elevationViewsOf(project).some(
    (view) => view.floorId === floorId && view.id !== exceptViewId && nameKey(view.name) === key,
  )
}

/**
 * `Elevation N` for the lowest `N` no Elevation View of one Floor is using (#75 §1). A Floor with
 * `Elevation 1` and `Elevation 3` gets `Elevation 2`, because the gap is the number the user is
 * looking for — `nextFloorName`'s rule, per Floor.
 *
 * It is per Floor rather than per Project because the numbering is what a Floor's own list reads:
 * two Floors each starting at `Elevation 1` are two correct answers, exactly as two Floors may each
 * have a view called after themselves.
 */
export function nextElevationViewName(project: Project, floorId: EntityId): string {
  const taken = new Set(
    elevationViewsOf(project)
      .filter((view) => view.floorId === floorId)
      .map((view) => nameKey(view.name)),
  )
  for (let n = 1; ; n += 1) {
    const candidate = `Elevation ${n}`
    if (!taken.has(nameKey(candidate))) return candidate
  }
}

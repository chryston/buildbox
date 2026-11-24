/**
 * The heights a vertical drag can stop at (#75 §5, criteria 19–21).
 *
 * The plan canvas answers a cursor with points; an Elevation View answers a height. Four families, in
 * the precedence `geometry/verticalSnap.ts` ranks:
 *
 * | Kind       | Offered                                                        |
 * | ---------- | -------------------------------------------------------------- |
 * | `datum`    | the Floor Datum, Z = 0                                           |
 * | `limit`    | the Floor's Vertical Extent ends, when it has them               |
 * | `entity`   | the bottom and top of every Wall, Beam, Skirting, Opening and Placement the view draws |
 * | `mounting` | the preset pack's sill, head, door-top and ceiling heights        |
 *
 * **What the view draws is what snaps.** The rows come from `displayModel`, so a Renovation Display
 * that leaves Proposed out offers no Proposed edges, and each entity is asked through
 * `snapCandidateAllowed` — a hidden or unselectable layer is not a snap target unless the view says
 * `Snap to hidden content`, which makes it a target and nothing more (#71 criterion 12, #75 criterion
 * 12). The preset pack's heights belong to no entity and no layer, so no layer rule takes them away;
 * the `Snaps ▾` row for them does.
 *
 * The pack is read through the same accessors every other picker uses, alternatives included, because
 * `Clear height to slab` and `Under a false ceiling` are exactly the heights somebody dragging a
 * wall cabinet wants. Windows give their sill and head, doors their top, a height entry its own value;
 * the shelter is left out — it is a fixed whole-flat element whose door is already a door entry.
 */
import type { ElevationView, EntityId, Project } from '../domain'
import { UNLAYERED_LAYER_KEY, beamLabel, beamTop, designHeight, getPresetPack, listPresetEntries, serviceBottom, serviceLabel, serviceTop, skirtingLabel, skirtingTop, viewDesignOptionId, viewRenovationDisplay } from '../domain'
import type { VerticalSnapCandidate, VerticalSnapKind } from '../geometry'
import { derivePlacement, placementLabels } from './effective'
import { effectiveModel } from './effectiveModel'
import { entityLayerKeys, snapCandidateAllowed } from './drawingLayers'
import { displayModel } from './renovationDisplay'

/** The shipped pack the mounting heights come from, the same way every other picker names it. */
const PRESET_PACK_ID = 'hdb-bto-typical'

/**
 * The three `Snaps ▾` rows a vertical drag reads, and the kinds each turns on.
 *
 * The Datum and the two Vertical Extent limits are one row because they are one idea — the Floor's own
 * heights, which nobody drew — and they share the stronger rank the geometry gives them.
 */
export const VERTICAL_SNAP_ROW_KINDS: { readonly [R in VerticalSnapRow]: readonly VerticalSnapKind[] } = {
  floorHeights: ['datum', 'limit'],
  entities: ['entity'],
  presetHeights: ['mounting'],
}

/** One of the three rows. */
export type VerticalSnapRow = 'floorHeights' | 'entities' | 'presetHeights'

/** The enabled kinds for the three booleans, mirroring `enabledSnapKinds` for the plan rows. */
export const enabledVerticalSnapKinds = (settings: {
  floorHeights: boolean
  entities: boolean
  presetHeights: boolean
}): Set<VerticalSnapKind> => {
  const kinds = new Set<VerticalSnapKind>()
  for (const row of Object.keys(VERTICAL_SNAP_ROW_KINDS) as VerticalSnapRow[]) {
    if (settings[row]) for (const kind of VERTICAL_SNAP_ROW_KINDS[row]) kinds.add(kind)
  }
  return kinds
}

export interface VerticalSnapInput {
  readonly project: Project
  /** The Elevation View the drag happens in: its Design Option, Renovation Display, layer rules and `Snap to hidden content` all apply. */
  readonly view: ElevationView
  /**
   * Whether one kind is offered at all, from `enabledVerticalSnapKinds`. Absent is every kind on —
   * the answer of a panel with no `Snaps ▾` menu yet.
   */
  readonly enabled?: ReadonlySet<VerticalSnapKind>
}

/**
 * Every height the drag could stop at, in the order the families are listed above.
 *
 * The cursor's height, the tolerance and the entity being dragged belong to the *choice*, which
 * `verticalSnap` makes from this list: an entity's candidates carry the entity's own id, so passing
 * it as `excludeId` is what stops a Placement from snapping to its own base.
 */
export function verticalSnapCandidates(input: VerticalSnapInput): VerticalSnapCandidate[] {
  const { project, view } = input
  const enabled = input.enabled ?? new Set<VerticalSnapKind>(['datum', 'limit', 'entity', 'mounting'])
  const optionId = viewDesignOptionId(view)
  const out: VerticalSnapCandidate[] = []

  // The Floor's own heights: the Datum it stands on and the two ends of its Vertical Extent.
  const floor = project.floors.find((candidate) => candidate.id === view.floorId)
  if (floor !== undefined) {
    if (enabled.has('datum')) out.push({ id: 'floor-datum', mm: 0, kind: 'datum', label: 'Floor Datum' })
    if (enabled.has('limit')) {
      const lower = floor.limits?.lowerMm
      const upper = floor.limits?.upperMm
      if (lower !== undefined && lower !== null) out.push({ id: 'floor-limit-lower', mm: lower, kind: 'limit', label: 'Lower limit' })
      if (upper !== undefined && upper !== null) out.push({ id: 'floor-limit-upper', mm: upper, kind: 'limit', label: 'Upper limit' })
    }
  }

  if (enabled.has('entity')) {
    const display = displayModel(effectiveModel(project, view.floorId, optionId), viewRenovationDisplay(view))
    const layers = entityLayerKeys(project, view.floorId, optionId)
    const allowed = (id: EntityId): boolean => snapCandidateAllowed(project, view, layers.get(id) ?? UNLAYERED_LAYER_KEY)
    /** One entity's two ends, or nothing when this view will not snap to it. */
    const edges = (id: EntityId, bottom: string, top: string, lower: number, upper: number): void => {
      if (!allowed(id)) return
      out.push({ id, mm: lower, kind: 'entity', label: bottom })
      out.push({ id, mm: upper, kind: 'entity', label: top })
    }
    for (const { entity } of display.walls) edges(entity.id, `Base of ${entity.ref}`, `Top of ${entity.ref}`, entity.baseElevation, entity.baseElevation + entity.height)
    // A Beam's ends are an Underside and a Top, the two words the inspector uses for them (#77 §3).
    for (const { entity } of display.beams) edges(entity.id, `Underside of ${beamLabel(entity)}`, `Top of ${beamLabel(entity)}`, entity.underside, beamTop(entity))
    // A Skirting's ends are a Bottom and a Top, the two words its inspector uses for them (#78 §7).
    for (const { entity } of display.skirting) edges(entity.id, `Bottom of ${skirtingLabel(entity)}`, `Top of ${skirtingLabel(entity)}`, entity.bottom, skirtingTop(entity))
    // A Service's ends are a Bottom and a Top too, read off the one elevation its shape stores (#79 §7).
    for (const { entity } of display.services) edges(entity.id, `Bottom of ${serviceLabel(entity)}`, `Top of ${serviceLabel(entity)}`, serviceBottom(entity), serviceTop(entity))
    // An Opening's ends are a sill and a head, which is what the rest of the product calls them.
    for (const { entity } of display.openings) edges(entity.id, `Sill of ${entity.label}`, `Head of ${entity.label}`, entity.sill, entity.head)
    const names = placementLabels(
      display.placedItems.flatMap(({ entity }) => {
        const design = project.itemDesigns.find((candidate) => candidate.id === entity.itemDesignId)
        return design === undefined ? [] : [derivePlacement(design, entity)]
      }),
    )
    for (const { entity } of display.placedItems) {
      const design = project.itemDesigns.find((candidate) => candidate.id === entity.itemDesignId)
      if (design === undefined) continue
      // The instance label, not the Design's name: two of one Design on a Floor are `Base cabinet #1`
      // and `#2` everywhere else in the product, and a guide that named both the same way would leave
      // the user unable to tell which one a drag is about to stop at (#75 criterion 21).
      const name = names.get(entity.id) ?? design.name
      edges(entity.id, `Base of ${name}`, `Top of ${name}`, entity.baseElevation, entity.baseElevation + designHeight(design))
    }
  }

  if (enabled.has('mounting')) {
    // The pack's own names, so the guide says `Standard window sill (HDB BTO typical)` and not a
    // number the user has to have memorised, and names the pack the number came from — two packs
    // could otherwise offer the same word at two heights (#75 criterion 25). An alternative is the
    // same thing at another size, so it is offered too, under its own name.
    const pack = getPresetPack(PRESET_PACK_ID).name
    const offer = (id: string, name: string, mm: number): void => {
      out.push({ id, mm, kind: 'mounting', label: `${name} (${pack})` })
    }
    for (const entry of listPresetEntries(PRESET_PACK_ID, 'window')) {
      offer(entry.id, `${entry.name} sill`, entry.values.sill)
      offer(`${entry.id}.head`, `${entry.name} head`, entry.values.head)
      for (const alt of entry.alternatives) {
        offer(`${alt.id}.sill`, `${alt.name} sill`, alt.values.sill)
        offer(`${alt.id}.head`, `${alt.name} head`, alt.values.head)
      }
    }
    for (const entry of listPresetEntries(PRESET_PACK_ID, 'door')) {
      offer(entry.id, `${entry.name} top`, entry.values.height)
      for (const alt of entry.alternatives) offer(alt.id, `${alt.name} top`, alt.values.height)
    }
    for (const entry of listPresetEntries(PRESET_PACK_ID, 'height')) {
      offer(entry.id, entry.name, entry.values.height)
      for (const alt of entry.alternatives) offer(alt.id, alt.name, alt.values.height)
    }
  }

  return out
}

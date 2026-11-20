/**
 * The shapes the cabinet canvas draws, taken from the Item Detail rather than from `cabinet`.
 *
 * `ui` may not import `cabinet` (#20 §2): the layout reaches this folder inside
 * `DerivedItemDetail`, which is the only route the architecture leaves open, and these aliases
 * are that route written down once instead of re-derived in every file.
 */
import type { DerivedItemDetail } from '../../../derive'

/** The one Item Detail this canvas can draw: a cabinet laid out by `cabinet`'s engine. */
export type CabinetDetail = Extract<DerivedItemDetail, { kind: 'cabinet' }>

/** One unit of the scene, placed inside it. */
export type UnitLayout = CabinetDetail['layout']['units'][number]

/** One open section of a unit, with the node ids its two measurements write back to. */
export type LayoutVoid = UnitLayout['voids'][number]

/** One divider between two sections, with the ratio a drag rewrites. */
export type LayoutDivider = UnitLayout['dividers'][number]

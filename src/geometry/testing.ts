/**
 * The `geometry` module's second entry point (#42 §7): the shared fixtures later issues'
 * tests build on, reachable from a `*.test.ts(x)` file and from nothing else.
 *
 * The Kitchen is the prototype's seeded six-corner Custom Path, the Bedroom is the
 * prototype's Rectangle preset, and `Base 600` is an Item Footprint in its local frame.
 * Nothing here seeds a Room 150–200 mm inside a wall face — #67 aligns its own fixtures to
 * faces.
 */
import { evaluatePreset } from './presets'
import type { RectanglePreset } from './presets'
import type { ClosedPath, Pt } from './types'
import { pt } from './types'

/** The Kitchen Room Outline: start (1200, 1300), then five more corners, clockwise. */
export const KITCHEN_POINTS: readonly Pt[] = [
  pt(1200, 1300),
  pt(4800, 1300),
  pt(4800, 4000),
  pt(3300, 4000),
  pt(3300, 5600),
  pt(1200, 5600),
]

/**
 * The Kitchen Room Outline (#54 criterion 8): area 13,080,000 mm², perimeter 15,800 mm,
 * edge 2 = 2,700 mm, and valid.
 */
export const kitchenFixture = (): ClosedPath => ({
  start: KITCHEN_POINTS[0],
  segments: KITCHEN_POINTS.slice(1).map((to) => ({ kind: 'line' as const, to })).concat({ kind: 'line' as const, to: KITCHEN_POINTS[0] }),
})

/** The Bedroom's preset: Rectangle 3,400 × 2,400. */
export const BEDROOM_PRESET: RectanglePreset = { kind: 'rectangle', width: 3400, depth: 2400 }

/** The Bedroom Room Outline: that rectangle centred at (7000, 5600). */
export const bedroomFixture = (): ClosedPath =>
  evaluatePreset(BEDROOM_PRESET, { centre: pt(7000, 5600), orientationDeg: 0 })

/** The Item Footprint of Item Design `Base 600`: a 600 × 400 rectangle in local mm. */
export const BASE_600_PRESET: RectanglePreset = { kind: 'rectangle', width: 600, depth: 400 }

/** `Base 600`'s Item Footprint, centred on the Item Origin. */
export const base600Fixture = (): ClosedPath =>
  evaluatePreset(BASE_600_PRESET, { centre: pt(0, 0), orientationDeg: 0 })

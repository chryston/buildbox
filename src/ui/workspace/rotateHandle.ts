/**
 * The rotate handle's geometry (#57 §4).
 *
 * The handle is a round grip offset from the Item Origin along local −Y — straight "up" the
 * screen at 0° — and dragging it turns the placement about that Origin. All of it is one
 * question: which rotation does the pointer ask for? The answer lives here rather than in the
 * canvas so the 15° snap, the 0.1° follow and the [0, 360) normalisation are one function the
 * keyboard shortcuts and the drag cannot disagree about.
 *
 * The sign is the one `derive/placement.ts` pins: clockwise on screen with +Y down. Screen
 * `atan2` already grows clockwise when +Y points down, so the pointer's own angle *is* the
 * rotation, once the handle's 90° offset is taken back off — no drag-start reference, which
 * is why grabbing the handle again after a turn does not jump.
 */
import { normaliseRotation, worldPointOf } from '../../derive'
import type { PlacementContext } from '../../derive'

/** How far the handle sits past the footprint's furthest corner, in CSS pixels. */
export const HANDLE_REACH_PX = 24

/** The footprint's furthest corner from the Item Origin, in footprint-local millimetres. */
export function cornerReach(width: number, depth: number, origin: { x: number; y: number }): number {
  let reach = 0
  for (const [x, y] of [[0, 0], [width, 0], [width, depth], [0, depth]] as const) {
    reach = Math.max(reach, Math.hypot(x - origin.x, y - origin.y))
  }
  return reach
}

/**
 * The handle's distance from the Item Origin in Floor millimetres: every corner of the
 * footprint, plus a reach that stays 24 CSS px however far the view is zoomed.
 */
export const handleRadiusMm = (
  width: number,
  depth: number,
  origin: { x: number; y: number },
  zoom: number,
): number => cornerReach(width, depth, origin) + HANDLE_REACH_PX / zoom

/** Where the handle draws, in Floor millimetres. */
export const handlePoint = (context: PlacementContext, radiusMm: number): { x: number; y: number } =>
  worldPointOf(context, { x: context.origin.x, y: context.origin.y - radiusMm })

/**
 * The rotation the pointer asks for: the angle from the Item Origin to the pointer, plus the
 * 90° the handle's local −Y offset costs, normalised to [0, 360) and read to 0.1°.
 *
 * With angle snap on it goes to the nearest increment — 15° by default — so a drag stopped at
 * ~52° asks for 45°, and one at ~56° for 60°.
 */
export function rotationFromPointer(
  translation: { x: number; y: number },
  pointer: { x: number; y: number },
  snap: { enabled: boolean; incrementDeg: number },
): number {
  const angleDeg = (Math.atan2(pointer.y - translation.y, pointer.x - translation.x) * 180) / Math.PI
  const free = Math.round((angleDeg + 90) * 10) / 10
  const snapped = snap.enabled && snap.incrementDeg > 0
    ? Math.round(free / snap.incrementDeg) * snap.incrementDeg
    : free
  return normaliseRotation(snapped)
}

/** `↺ 90°` and `↻ 90°` (`[` and `]`), which turn about the Item Origin like the handle does. */
export const quarterTurn = (rotationDeg: number, direction: -1 | 1): number =>
  normaliseRotation(rotationDeg + direction * 90)

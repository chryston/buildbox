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
 *
 * Where the handle *draws* is no longer here: #60 moved the grip, its stem and its reach into
 * `drawing/annotations.ts`, so that the only Floor-space transform on the screen is the one
 * `derive` already did. What is left is the pointer's answer, which is a screen question.
 */
import { normaliseRotation } from '../../derive'

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

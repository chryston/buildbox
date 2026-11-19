/**
 * The Item Footprint as one thing to ask questions of (#58).
 *
 * A footprint is either a preset with parameters or a Custom Path, and every consumer —
 * the Floor canvas, the Item Design editor, the Measurements tab, the strict validator, the
 * Intent that commits an edit — wants the same four answers: the path, the bounds, the
 * measurements, and whether the shape exists at all. Asking each of them to switch on
 * `footprint.kind` is how a Floor canvas and an inspector start disagreeing about the same
 * design, so the switch happens once, here.
 *
 * Everything is derived from the evaluated path, including the measurements of a preset:
 * `Area` and `Perimeter` are the area and perimeter *of the shape*, not of its parameters,
 * which is what lets a Rectangle, a rounded Rectangle and a Custom Path with the same
 * outline report the same numbers.
 */
import {
  applyTransform,
  bounds,
  evaluatePreset,
  perimeter,
  signedArea,
  transformSegment,
  validateLoop,
} from '../geometry'
import type { Bounds, ClosedPath, GeometryProblem, Pt, Transform } from '../geometry'
import type { ItemFootprint, PathItemFootprint, PresetItemFootprint } from './project'

/** The closed loop an Item Footprint describes, in footprint-local millimetres. */
export function footprintPath(footprint: ItemFootprint): ClosedPath {
  return footprint.kind === 'preset'
    ? evaluatePreset(footprint.preset, { centre: footprint.centre, orientationDeg: footprint.orientationDeg })
    : footprint.path
}

/** The axis-aligned bounds of the footprint, in footprint-local millimetres. */
export function footprintBounds(footprint: ItemFootprint): Bounds {
  return bounds(footprintPath(footprint))
}

/**
 * The footprint's `width` × `depth` — the size of its local bounds, so a shape turned 90°
 * reports the size it draws rather than the size its parameters name.
 */
export function footprintSize(footprint: ItemFootprint): { width: number; depth: number } {
  const box = footprintBounds(footprint)
  return { width: box.maxX - box.minX, depth: box.maxY - box.minY }
}

/** Enclosed area in square millimetres; 0 for a path that encloses nothing. */
export function footprintArea(footprint: ItemFootprint): number {
  return Math.abs(signedArea(footprintPath(footprint)))
}

/** Distance around the outline in millimetres, arcs measured along the arc. */
export function footprintPerimeter(footprint: ItemFootprint): number {
  return perimeter(footprintPath(footprint))
}

/**
 * Why this footprint is not a shape, or nothing when it is.
 *
 * A preset is checked as a parameterisation first, so an impossible radius is reported as
 * the radius rather than as whatever the evaluated loop happens to look like; a Custom Path
 * is checked as a loop. These are the same problems the strict validator reports on import
 * and the same ones the editor shows while a proposal is on screen, which is what makes
 * "invalid geometry cannot enter the model" one rule rather than three.
 */
export function footprintProblems(footprint: ItemFootprint): GeometryProblem[] {
  return footprint.kind === 'preset'
    ? validateLoop({
        preset: footprint.preset,
        placement: { centre: footprint.centre, orientationDeg: footprint.orientationDeg },
      })
    : validateLoop(footprint.path)
}

/** Whether the footprint describes a shape at all. */
export function footprintIsValid(footprint: ItemFootprint): boolean {
  return footprintProblems(footprint).length === 0
}

/**
 * The Rectangle preset BuildBox has always meant by "a footprint": local corners `(0,0)` to
 * `(width,depth)`, which is byte-for-byte the geometry domain v2 stored. The migrator, the
 * plan templates and the legacy converter all land here, so a Project that never opens the
 * shape editor keeps the outline it had.
 */
export function rectangleFootprint(width: number, depth: number): PresetItemFootprint {
  return {
    kind: 'preset',
    preset: { kind: 'rectangle', width, depth },
    centre: { x: width / 2, y: depth / 2 },
    orientationDeg: 0,
  }
}

/** The point the Shape tab's `Position X` / `Position Y` name. */
export function footprintCentre(footprint: ItemFootprint): Pt {
  if (footprint.kind === 'preset') return { ...footprint.centre }
  const box = footprintBounds(footprint)
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }
}

/** The footprint moved so its position is `centre`; the shape and its turn are untouched. */
export function footprintMovedTo(footprint: ItemFootprint, centre: Pt): ItemFootprint {
  if (footprint.kind === 'preset') return { ...footprint, centre: { x: centre.x, y: centre.y } }
  const before = footprintCentre(footprint)
  const shift: Transform = {
    translation: { x: centre.x - before.x, y: centre.y - before.y },
    rotationDeg: 0,
    pivot: { x: 0, y: 0 },
  }
  const path = footprint.path
  return {
    kind: 'path',
    path: {
      start: applyTransform(path.start, shift),
      segments: path.segments.map((segment) => transformSegment(segment, shift)),
    },
  }
}

/**
 * The footprint as a Custom Path: the evaluated outline, stored.
 *
 * Converting is deliberately lossy in one direction only — the parameters go, the geometry
 * does not — which is why the dialog warns about the parameters and why Undo is the only
 * way back. A path footprint is already custom, so converting it is the identity.
 */
export function footprintAsPath(footprint: ItemFootprint): PathItemFootprint {
  return { kind: 'path', path: footprintPath(footprint) }
}

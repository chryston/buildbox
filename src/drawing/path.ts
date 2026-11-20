/**
 * A path as drawing commands, and those commands as path data (#60 §5, criterion 13).
 *
 * `geometry` stores a closed path as a start point plus typed segments, because that is what
 * a kernel measures; a renderer wants `M`/`L`/`A`/`E`, because that is what SVG and PDF and a
 * plotter draw. This file is the only place in the codebase that crosses that seam, and the
 * only place that crosses back, so the two flags that decide *which* arc gets drawn are
 * derived once and spelled once — which is how the on-screen outline and the exported one
 * could disagree about a major arc before #60 existed.
 *
 * Both frames are +X right, +Y down and both measure a positive sweep clockwise, so
 * `sweepDeg > 0` is SVG's `sweep-flag: 1` and a sweep past a half turn is the large arc: no
 * sign flip and no complement, for the reason #58 §8 gives.
 */
import { DEG, pt, rotate } from '../geometry'
import type { ArcSegment, ClosedPath, EllipticalArcSegment, Pt, Segment } from '../geometry'
import { mmText as n } from './format'
import type { PathCommand } from './types'

/** The two SVG flags for one signed sweep in degrees. */
const flagsFor = (sweepDeg: number): { largeArc: boolean; sweep: boolean } => ({
  largeArc: Math.abs(sweepDeg) > 180,
  sweep: sweepDeg >= 0,
})

/** A circular arc: its radius is the distance from the centre to where it starts. */
const circular = (radius: number, sweepDeg: number, to: Pt): PathCommand => ({
  k: 'A',
  to,
  r: radius,
  ...flagsFor(sweepDeg),
})

/** An elliptical arc, carrying its own radii and the rotation of its major axis. */
const elliptical = (
  rx: number,
  ry: number,
  rotationDeg: number,
  sweepDeg: number,
  to: Pt,
): PathCommand => ({
  k: 'E',
  to,
  rx,
  ry,
  xRotDeg: rotationDeg,
  ...flagsFor(sweepDeg),
})

/**
 * The point halfway through an arc's sweep.
 *
 * A full turn cannot be drawn as one SVG arc — start and end coincide, and the two flags
 * cannot say which of the two halves was meant — so a segment of 360° or more is split at
 * this point into two that can be. The parametrisation is the kernel's own (`geometry`'s
 * `arcForm`): a circular arc runs from the angle its start point makes with the centre, an
 * elliptical one from the parametric angle of its start point in the ellipse's own frame, and
 * the half-turn point is half the signed sweep along that.
 */
const halfSweepPoint = (segment: ArcSegment | EllipticalArcSegment, from: Pt): Pt => {
  const center = segment.center
  const halfRad = (segment.sweepDeg / 2) * DEG
  if (segment.kind === 'arc') {
    const radius = Math.hypot(from.x - center.x, from.y - center.y)
    const t = Math.atan2(from.y - center.y, from.x - center.x) + halfRad
    return pt(center.x + radius * Math.cos(t), center.y + radius * Math.sin(t))
  }
  const local = rotate({ x: from.x - center.x, y: from.y - center.y }, -segment.rotationDeg)
  const t = Math.atan2(local.y / segment.ry, local.x / segment.rx) + halfRad
  const onEllipse = rotate(
    { x: segment.rx * Math.cos(t), y: segment.ry * Math.sin(t) },
    segment.rotationDeg,
  )
  return pt(center.x + onEllipse.x, center.y + onEllipse.y)
}

/** One segment as the commands that draw it, split in two if it turns a full circle. */
function segmentCommands(segment: Segment, from: Pt): PathCommand[] {
  switch (segment.kind) {
    case 'line':
      return [{ k: 'L', to: segment.to }]
    case 'arc': {
      const radius = Math.hypot(segment.center.x - from.x, segment.center.y - from.y)
      if (Math.abs(segment.sweepDeg) < 360) {
        return [circular(radius, segment.sweepDeg, segment.to)]
      }
      const mid = halfSweepPoint(segment, from)
      const half = segment.sweepDeg / 2
      return [
        circular(radius, half, mid),
        circular(radius, half, segment.to),
      ]
    }
    case 'ellipticalArc': {
      const { rx, ry, rotationDeg } = segment
      if (Math.abs(segment.sweepDeg) < 360) {
        return [elliptical(rx, ry, rotationDeg, segment.sweepDeg, segment.to)]
      }
      const mid = halfSweepPoint(segment, from)
      const half = segment.sweepDeg / 2
      return [
        elliptical(rx, ry, rotationDeg, half, mid),
        elliptical(rx, ry, rotationDeg, half, segment.to),
      ]
    }
  }
}

/**
 * The commands for one closed path, starting at its `start`.
 *
 * The path is emitted as stored: a proposal whose last Edge does not return to `start` draws
 * the gap rather than hiding it, which is why `closed` is a field of the display item and not
 * a decision made here (#58 §8).
 */
export function pathToCommands(path: ClosedPath): PathCommand[] {
  const out: PathCommand[] = [{ k: 'M', to: path.start }]
  let cursor = path.start
  for (const segment of path.segments) {
    out.push(...segmentCommands(segment, cursor))
    cursor = segment.to
  }
  return out
}

/**
 * The four corners of a box, clockwise from its top left.
 *
 * The box is open: whether it is closed is the display item's `closed` flag, so a rect drawn
 * as an outline and a rect drawn as a fill are the same commands.
 */
export const rectCommands = (x: number, y: number, w: number, h: number): PathCommand[] => [
  { k: 'M', to: pt(x, y) },
  { k: 'L', to: pt(x + w, y) },
  { k: 'L', to: pt(x + w, y + h) },
  { k: 'L', to: pt(x, y + h) },
]

/**
 * A box with the same radius at all four corners, as four quarter arcs.
 *
 * This is what `<rect rx>` drew, spelled as commands so a cabinet's door and a Plan View's
 * chip go through the one path the rest of the drawing takes. `radius` is clamped to half the
 * shorter side, which is exactly what an SVG `rx` does to itself — a pull 3 mm wide with a
 * 1.5 mm corner is a stadium, not a broken path.
 */
export function roundedRectCommands(
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): PathCommand[] {
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2))
  const right = x + w
  const bottom = y + h
  // Every corner is a quarter turn clockwise in the +Y-down frame: never the large arc,
  // always the positive sweep.
  const corner = (to: Pt): PathCommand => ({ k: 'A', to, r, largeArc: false, sweep: true })
  return [
    { k: 'M', to: pt(x + r, y) },
    { k: 'L', to: pt(right - r, y) },
    corner(pt(right, y + r)),
    { k: 'L', to: pt(right, bottom - r) },
    corner(pt(right - r, bottom)),
    { k: 'L', to: pt(x + r, bottom) },
    corner(pt(x, bottom - r)),
    { k: 'L', to: pt(x, y + r) },
    corner(pt(x + r, y)),
  ]
}

/** One straight run, as the two commands that draw it. */
export const lineCommands = (from: Pt, to: Pt): PathCommand[] => [
  { k: 'M', to: from },
  { k: 'L', to },
]

// ------------------------------------------------------- commands as the text a browser draws
const point = (at: Pt): string => `${n(at.x)} ${n(at.y)}`

const flag = (set: boolean): string => (set ? '1' : '0')

/** One command as path data. `E` is an `A` with two radii, which is what SVG's `A` is. */
function commandData(command: PathCommand): string {
  switch (command.k) {
    case 'M':
      return `M ${point(command.to)}`
    case 'L':
      return `L ${point(command.to)}`
    case 'A':
      return (
        `A ${n(command.r)} ${n(command.r)} 0 ` +
        `${flag(command.largeArc)} ${flag(command.sweep)} ${point(command.to)}`
      )
    case 'E':
      return (
        `A ${n(command.rx)} ${n(command.ry)} ${n(command.xRotDeg)} ` +
        `${flag(command.largeArc)} ${flag(command.sweep)} ${point(command.to)}`
      )
  }
}

/**
 * The commands as the text a browser, a plotter or a PDF writes into a path.
 *
 * The pair with `pathToCommands`, and the only place a command becomes a string: the `d` of a
 * `<path>` on screen, the `d` of an exported SVG and the outline of a Shape proposal all come
 * through here, so the flags that decide *which* arc is drawn are spelled once. Nothing is
 * closed — `closed` is a property of the display item, not of the commands — so a caller that
 * wants a `Z` says so.
 */
export const commandsToPath = (commands: readonly PathCommand[]): string =>
  commands.map(commandData).join(' ')

/**
 * Walls on the Plan View (#64 §15).
 *
 * A Wall is drawn as its tidied outline — the band the clean-up left, filled, with its two face
 * lines — and never as a reference line. The reference line is where the geometry was measured,
 * not a thing a person draws on paper, and a plan that shows it teaches the wrong habit.
 *
 * The `W-n` label sits inside the band when the band is thick enough to hold it and beside the
 * band when it is not, which is the same rule a draughtsman uses. It is never drawn over a
 * handle or over another label: the last one placed moves to the other side rather than
 * colliding.
 */
import type { DerivedWall, FloorWalls } from '../derive'
import type { Pt } from '../geometry'
import { layoutText } from './font/layoutText'
import { lineCommands, pathToCommands, rectCommands } from './path'
import { resolveSize } from './styles'
import type {
  DisplayItem,
  DisplayLayer,
  DisplayList,
  PathCommand,
  Rect,
  Sizing,
} from './types'

export interface WallDrawOptions {
  sizing: Sizing
  /** The selected Wall, drawn with its end handles and a heavier line. */
  selectedWallId?: string | null
}

const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

/** The four corners of a Wall's tidied outline, as a box. */
function outlineBox(wall: DerivedWall): Rect {
  const points = [wall.outline.start, ...wall.outline.segments.map((segment) => segment.to)]
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

/** One face as commands: a straight line, or the arc the clean-up left it as. */
function faceCommands(wall: DerivedWall, index: 0 | 1): PathCommand[] {
  const face = wall.faces[index]
  if (face.segment.kind === 'line') return lineCommands(face.from, face.to)
  const arc = face.segment
  const radius = Math.hypot(face.from.x - arc.center.x, face.from.y - arc.center.y)
  return [{ k: 'M', to: face.from }, {
    k: 'A',
    to: arc.to,
    r: radius,
    largeArc: Math.abs(arc.sweepDeg) > 180,
    sweep: arc.sweepDeg > 0,
  }]
}

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** The centre of the band at its midpoint, and the unit normal across its thickness. */
function bandCentre(wall: DerivedWall): { at: Pt; across: Pt } {
  const a = mid(wall.faces[0].from, wall.faces[0].to)
  const b = mid(wall.faces[1].from, wall.faces[1].to)
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = Math.hypot(dx, dy) || 1
  return { at: mid(a, b), across: { x: dx / length, y: dy / length } }
}

/**
 * The Walls of one Floor: filled outlines, face lines, `W-n` labels, and the selected Wall's
 * end handles as squares on the tidied end caps.
 */
export function drawWalls(walls: FloorWalls, options: WallDrawOptions): DisplayList {
  const { sizing, selectedWallId = null } = options
  const shapes: DisplayItem[] = []
  const labels: DisplayItem[] = []
  const handles: DisplayItem[] = []
  const taken: Rect[] = []
  let box: Rect | null = null

  for (const wall of walls.walls) {
    const bounds = outlineBox(wall)
    box = box === null ? bounds : {
      x: Math.min(box.x, bounds.x),
      y: Math.min(box.y, bounds.y),
      w: Math.max(box.x + box.w, bounds.x + bounds.w) - Math.min(box.x, bounds.x),
      h: Math.max(box.y + box.h, bounds.y + bounds.h) - Math.min(box.y, bounds.y),
    }
    shapes.push({
      kind: 'path',
      ref: { id: wall.id, role: 'wall' },
      segments: pathToCommands(wall.outline),
      closed: true,
      style: wall.id === selectedWallId ? 'wall:selected' : 'wall',
    })
    for (const index of [0, 1] as const) {
      shapes.push({
        kind: 'path',
        ref: { id: wall.id, role: 'wall-face' },
        segments: faceCommands(wall, index),
        closed: false,
        style: 'wall-face',
      })
    }

    const size = resolveSize('plan-label', sizing)
    const layout = layoutText(wall.ref, size.mm)
    const { at, across } = bandCentre(wall)
    const gap = resolveSize('plan-dim-gap', sizing).mm
    const inside = size.mm <= thickness(wall) && layout.width <= wall.length
    const offset = inside ? 0 : thickness(wall) / 2 + gap + size.mm / 2
    let candidate: Rect = {
      x: at.x + across.x * offset - layout.width / 2,
      y: at.y + across.y * offset - size.mm / 2,
      w: layout.width,
      h: size.mm,
    }
    if (!inside && taken.some((other) => overlaps(candidate, other))) {
      // The other side of the band, rather than on top of the label already there.
      candidate = {
        x: at.x - across.x * offset - layout.width / 2,
        y: at.y - across.y * offset - size.mm / 2,
        w: layout.width,
        h: size.mm,
      }
    }
    taken.push(candidate)
    labels.push({
      kind: 'text',
      ref: { id: wall.id, role: 'wall-label' },
      text: wall.ref,
      at: { x: candidate.x + candidate.w / 2, y: candidate.y + candidate.h / 2 },
      anchor: 'middle',
      baseline: 'middle',
      rotationDeg: 0,
      role: 'label',
      style: 'plan-label',
      layout,
    })

    if (wall.id !== selectedWallId) continue
    const r = resolveSize('plan-handle-r', sizing).mm
    for (const cap of [
      mid(wall.faces[0].from, wall.faces[1].from),
      mid(wall.faces[0].to, wall.faces[1].to),
    ]) {
      handles.push({
        kind: 'path',
        ref: { id: wall.id, role: 'wall-handle' },
        segments: rectCommands(cap.x - r, cap.y - r, r * 2, r * 2),
        closed: true,
        style: 'plan-handle',
      })
    }
  }

  const layers: DisplayLayer[] = []
  if (shapes.length > 0) layers.push({ key: 'walls', items: shapes })
  if (labels.length > 0) layers.push({ key: 'wall-labels', items: labels })
  if (handles.length > 0) layers.push({ key: 'plan-handle', items: handles })
  return { space: 'floor', bounds: box ?? { x: 0, y: 0, w: 0, h: 0 }, layers, missingGlyphs: [] }
}

/** The band's width at one end, which is the Wall's own thickness after clean-up. */
const thickness = (wall: DerivedWall): number => {
  const a = wall.faces[0].from
  const b = wall.faces[1].from
  return Math.hypot(a.x - b.x, a.y - b.y)
}

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
import type { Pt, UsableGap } from '../geometry'
import { faceCurveCommands, gapMarkItems, openingItems, pieceCommands } from './openings'
import type { OpeningSymbol, WallOpenings } from './openings'
import { layoutText } from './font/layoutText'
import type { TextLayout } from './font/layoutText'
import { lineCommands, pathToCommands, rectCommands } from './path'
import { resolveSize } from './styles'
import type {
  DisplayItem,
  DisplayLayer,
  DisplayList,
  PathCommand,
  Rect,
  Sizing,
  StyleKey,
} from './types'

export interface WallDrawOptions {
  sizing: Sizing
  /** The selected Wall, drawn with its end handles and a heavier line. */
  selectedWallId?: string | null
  /**
   * Every Wall's Openings, already resolved against their host (#65 §12). A Wall with one is
   * drawn as the band the gaps leave — pieces between jambs — and never as one whole outline,
   * because a gap painted over is a gap that reads on paper as Wall.
   */
  openings?: readonly WallOpenings[]
  /** The selected Opening, drawn heavier than its neighbours. */
  selectedOpeningId?: string | null
  /**
   * Boxes the `W-n` references must not land on (#74 §3): the Item names of the same Floor, which
   * are drawn before them and so are the ones that stay put. A reference that finds its side taken
   * crosses to the other side of the band, which is what it already does for another Wall's
   * reference — this only widens what it is looking at.
   */
  labelObstacles?: readonly Rect[]
  /**
   * Whether the selected Wall's end handles are drawn at all; `true` unless said otherwise.
   *
   * A handle is an offer to edit, so a selection that cannot be edited is drawn without them
   * (#70 §7c) — the Wall still reads as selected, only nothing invites a drag.
   */
  handles?: boolean
  /**
   * The Opening being placed right now (#65 §10): a ghost of the symbol at the position the
   * pointer is aiming at, in the accent when it fits and in the danger colour when it does not,
   * with the stretch it would violate marked between its ends.
   *
   * A ghost rather than a cut: the band is only broken once the Opening exists, so the preview
   * shows what the click would do without doing it.
   */
  preview?: OpeningPreview | null
}

/** The ghost of an Opening that has not been placed yet. */
export interface OpeningPreview {
  /** The symbol at the position being aimed at, host geometry already resolved. */
  symbols: readonly OpeningSymbol[]
  /** Whether it fits where it stands. */
  blocked: boolean
  /** The stretch that would be violated, in millimetres along the host. */
  gap: UsableGap | null
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
 * Where one Wall's `W-n` reference goes: inside the band when the band is thick enough to hold
 * it, otherwise beside the nearer face unless a label already sits there.
 *
 * `taken` is the caller's running list, in the order the Walls were walked: the answer depends on
 * what has already been placed, which is why it is a parameter rather than a local.
 */
function placeWallLabel(wall: DerivedWall, sizing: Sizing, taken: Rect[]): { box: Rect; layout: TextLayout } {
  const size = resolveSize('plan-label', sizing)
  const layout = layoutText(wall.ref, size.mm)
  const { at, across } = bandCentre(wall)
  const gap = resolveSize('plan-dim-gap', sizing).mm
  const inside = size.mm <= thickness(wall) && layout.width <= wall.length
  const offset = inside ? 0 : thickness(wall) / 2 + gap + size.mm / 2
  let box: Rect = {
    x: at.x + across.x * offset - layout.width / 2,
    y: at.y + across.y * offset - size.mm / 2,
    w: layout.width,
    h: size.mm,
  }
  if (!inside && taken.some((other) => overlaps(box, other))) {
    // The other side of the band, rather than on top of the label already there.
    box = {
      x: at.x - across.x * offset - layout.width / 2,
      y: at.y - across.y * offset - size.mm / 2,
      w: layout.width,
      h: size.mm,
    }
  }
  taken.push(box)
  return { box, layout }
}

/**
 * The boxes the `W-n` references take on this Floor (#67 behaviour 35; #74 §3).
 *
 * A Room label may not sit on one, and the only way to know where they are without drawing them
 * twice is to run the same placement — which is why it lives here, next to the drawing that uses
 * it, rather than being guessed at by the caller. `obstacles` is what the references themselves
 * must avoid — the Item names, which were placed first — so that this answers with the same boxes
 * the drawing draws rather than a second opinion.
 */
export function wallLabelBoxes(walls: FloorWalls, sizing: Sizing, obstacles: readonly Rect[] = []): Rect[] {
  const taken: Rect[] = [...obstacles]
  for (const wall of walls.walls) placeWallLabel(wall, sizing, taken)
  return taken.slice(obstacles.length)
}

/**
 * The Walls of one Floor: filled outlines, face lines, `W-n` labels, and the selected Wall's
 * end handles as squares on the tidied end caps.
 */
export function drawWalls(walls: FloorWalls, options: WallDrawOptions): DisplayList {
  const {
    sizing, selectedWallId = null, openings = [], selectedOpeningId = null, preview = null, handles: showHandles = true,
    labelObstacles = [],
  } = options
  const shapes: DisplayItem[] = []
  const symbols: DisplayItem[] = []
  const labels: DisplayItem[] = []
  const handles: DisplayItem[] = []
  const taken: Rect[] = [...labelObstacles]
  let box: Rect | null = null

  for (const wall of walls.walls) {
    const bounds = outlineBox(wall)
    box = box === null ? bounds : {
      x: Math.min(box.x, bounds.x),
      y: Math.min(box.y, bounds.y),
      w: Math.max(box.x + box.w, bounds.x + bounds.w) - Math.min(box.x, bounds.x),
      h: Math.max(box.y + box.h, bounds.y + bounds.h) - Math.min(box.y, bounds.y),
    }
    const style: StyleKey = wall.id === selectedWallId ? 'wall:selected' : 'wall'
    const hosted = openings.find((entry) => entry.wallId === wall.id)
    if (hosted === undefined) {
      shapes.push({
        kind: 'path',
        ref: { id: wall.id, role: 'wall' },
        segments: pathToCommands(wall.outline),
        closed: true,
        style,
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
    } else {
      // The band as the pieces its Openings leave, each with the stretch of face it carries.
      const { line, offsets } = hosted.symbols[0]
      for (const piece of hosted.pieces) {
        shapes.push({
          kind: 'path',
          ref: { id: wall.id, role: 'wall' },
          segments: pieceCommands(piece),
          closed: true,
          style,
        })
        for (const index of [0, 1] as const) {
          shapes.push({
            kind: 'path',
            ref: { id: wall.id, role: 'wall-face' },
            segments: faceCurveCommands(line, offsets[index], piece.from, piece.to),
            closed: false,
            style: 'wall-face',
          })
        }
      }
      for (const symbol of hosted.symbols) {
        symbols.push(...openingItems(symbol, symbol.id === selectedOpeningId ? 'opening:selected' : 'opening'))
      }
    }

    const { box: labelBox, layout } = placeWallLabel(wall, sizing, taken)
    labels.push({
      kind: 'text',
      ref: { id: wall.id, role: 'wall-label' },
      text: wall.ref,
      at: { x: labelBox.x + labelBox.w / 2, y: labelBox.y + labelBox.h / 2 },
      anchor: 'middle',
      baseline: 'middle',
      rotationDeg: 0,
      role: 'label',
      style: 'plan-label',
      layout,
    })

    if (wall.id !== selectedWallId || !showHandles) continue
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
  if (preview !== null) {
    const style = preview.blocked ? 'opening:preview-blocked' : 'opening:preview'
    for (const symbol of preview.symbols) symbols.push(...openingItems(symbol, style))
    if (preview.blocked && preview.gap !== null) {
      const [first] = preview.symbols
      if (first !== undefined) symbols.push(...gapMarkItems(first, preview.gap.from, preview.gap.to))
    }
  }
  if (symbols.length > 0) layers.push({ key: 'wall-openings', items: symbols })
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

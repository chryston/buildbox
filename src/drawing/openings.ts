/**
 * Openings on the Plan View (#65 §12).
 *
 * An Opening is drawn as what it is: a gap in the Wall, with the symbol of its kind inside it.
 * The gap is not painted over the band — the band is cut into pieces at the jambs, so the paper
 * shows through exactly where the fit rule measured, and an export with no background still
 * reads. Every coordinate comes from the same kernel the validator uses (`openingEnd`,
 * `facePointAt`, `wallPieces`), which is the only reason a drawing and a rejection can agree.
 *
 * A door's leaf and swing are drawn square to the chord, not along the arc: on an arc Wall the
 * leaf is a straight line of the Opening's own width from the hinge jamb, and the swing a
 * quarter circle of that radius, because that is how a leaf is drawn on paper and how the
 * width was defined — as the chord.
 */
import type { HingeSide, Opening, OpeningKind, OpeningSwing, Wall, WallJunction } from '../domain'
import type { FaceOffsets, Interval, Pt, WallPiece, WallRefLine } from '../geometry'
import {
  faceCurveBetween,
  faceOffsets,
  facePointAt,
  openingEnd,
  pt,
  refTangentAt,
  usableIntervals,
  wallPieces,
} from '../geometry'
import { pathToCommands } from './path'
import type { DisplayItem, PathCommand, StyleKey } from './types'

/** One Opening resolved against its host, ready to draw. */
export interface OpeningSymbol {
  readonly id: string
  readonly hostWallId: string
  readonly kind: OpeningKind
  readonly swing: OpeningSwing | undefined
  readonly hingeSide: HingeSide | undefined
  /** Distance along the reference line to the near jamb. */
  readonly start: number
  /** Distance along it to the far jamb — arc length on an arc Wall. */
  readonly end: number
  /** The stored chord, which is the length of the leaf and the radius of the swing. */
  readonly width: number
  /** The host's reference line and face offsets, so a face-parallel line stays concentric. */
  readonly line: WallRefLine
  readonly offsets: FaceOffsets
}

/** One Wall's Openings: the band the gaps leave, and the symbols to draw in them. */
export interface WallOpenings {
  readonly wallId: string
  /** The tidied band cut at every jamb, so the Wall is drawn as these pieces and nothing else. */
  readonly pieces: readonly WallPiece[]
  readonly symbols: readonly OpeningSymbol[]
}

/**
 * Every Opening of a Floor, resolved against the Wall it is cut into.
 *
 * The pieces stop at the tidied ends as well as at the jambs: a Wall's band ends where its
 * faces do, and a piece that reached into a junction's mitre would draw over the Wall butted
 * into it.
 */
export function wallOpenings(
  walls: readonly Wall[],
  junctions: readonly WallJunction[],
  openings: readonly Opening[],
): WallOpenings[] {
  const usable = usableIntervals(walls, junctions)
  const result: WallOpenings[] = []
  for (const wall of walls) {
    const hosted = openings.filter((opening) => opening.hostWallId === wall.id)
    const intervalOf = usable.get(wall.id)
    if (hosted.length === 0 || intervalOf === undefined) continue
    const line = wall.line
    const offsets = faceOffsets(wall.thickness, wall.justification)
    const symbols = hosted.map((opening): OpeningSymbol => ({
      id: opening.id,
      hostWallId: wall.id,
      kind: opening.kind,
      swing: opening.swing,
      hingeSide: opening.hingeSide,
      start: opening.start,
      end: openingEnd(line, opening.start, opening.width),
      width: opening.width,
      line,
      offsets,
    }))
    const first = intervalOf.gaps[0]
    const last = intervalOf.gaps[intervalOf.gaps.length - 1]
    const cuts: Interval[] = [
      { lo: -1, hi: first?.from ?? 0 },
      ...symbols.map((symbol): Interval => ({ lo: symbol.start, hi: symbol.end })),
      { lo: last?.to ?? intervalOf.length, hi: intervalOf.length + 1 },
    ]
    result.push({
      wallId: wall.id,
      pieces: wallPieces(line, offsets, intervalOf.length, cuts),
      symbols,
    })
  }
  return result
}

/** One face curve between two reference distances, as drawing commands. */
export const faceCurveCommands = (
  line: WallRefLine,
  offset: number,
  from: number,
  to: number,
): PathCommand[] => {
  const face = faceCurveBetween(line, offset, from, to)
  const segment = face.segment
  if (segment.kind === 'line') return [{ k: 'M', to: face.from }, { k: 'L', to: segment.to }]
  return [{ k: 'M', to: face.from }, {
    k: 'A',
    to: segment.to,
    r: Math.hypot(face.from.x - segment.center.x, face.from.y - segment.center.y),
    largeArc: Math.abs(segment.sweepDeg) > 180,
    sweep: segment.sweepDeg > 0,
  }]
}

/** The point of the reference line at `at`, with its unit tangent and normal. */
const frameAt = (line: WallRefLine, at: number): { on: Pt; along: Pt; across: Pt } => {
  const rad = refTangentAt(line, at) * (Math.PI / 180)
  return {
    on: facePointAt(line, 0, at),
    along: pt(Math.cos(rad), Math.sin(rad)),
    across: pt(-Math.sin(rad), Math.cos(rad)),
  }
}

/** A door's leaf and its quarter-circle swing, both square to the chord (#65 §12). */
function hingedDoor(symbol: OpeningSymbol, style: StyleKey): DisplayItem[] {
  // `left` is the face on the negative side of the reference normal, the same reading
  // `faceOffsets` gives the Wall's own left face.
  const swing = symbol.swing === 'right' ? 1 : -1
  const hingeAt = symbol.hingeSide === 'end' ? symbol.end : symbol.start
  const farAt = symbol.hingeSide === 'end' ? symbol.start : symbol.end
  const { on: hinge, across } = frameAt(symbol.line, hingeAt)
  const far = facePointAt(symbol.line, 0, farAt)
  const tip = pt(hinge.x + across.x * swing * symbol.width, hinge.y + across.y * swing * symbol.width)
  // The swing runs from the far jamb to the leaf tip around the hinge. Which way it turns is
  // the sign of the cross product of the two radii, in the same +Y-down frame SVG draws in.
  const cross = (far.x - hinge.x) * (tip.y - hinge.y) - (far.y - hinge.y) * (tip.x - hinge.x)
  return [
    {
      kind: 'path',
      ref: { id: symbol.id, role: 'opening-leaf' },
      segments: [{ k: 'M', to: hinge }, { k: 'L', to: tip }],
      closed: false,
      style,
    },
    {
      kind: 'path',
      ref: { id: symbol.id, role: 'opening-swing' },
      segments: [{ k: 'M', to: far }, { k: 'A', to: tip, r: symbol.width, largeArc: false, sweep: cross > 0 }],
      closed: false,
      style: 'opening-swing',
    },
  ]
}

/** A sliding door: two panels that overlap in the middle, and the way they slide. */
function slidingDoor(symbol: OpeningSymbol, style: StyleKey): DisplayItem[] {
  const { offsets, line } = symbol
  const span = symbol.end - symbol.start
  const quarter = (offsets[1] - offsets[0]) / 4
  const arrow = frameAt(line, symbol.start + span * 0.55)
  const tail = pt(arrow.on.x - arrow.along.x * 320, arrow.on.y - arrow.along.y * 320)
  const back = pt(arrow.on.x - arrow.along.x * 120, arrow.on.y - arrow.along.y * 120)
  return [
    {
      kind: 'path',
      ref: { id: symbol.id, role: 'opening-panel' },
      segments: faceCurveCommands(line, offsets[0] + quarter, symbol.start, symbol.start + span * 0.6),
      closed: false,
      style,
    },
    {
      kind: 'path',
      ref: { id: symbol.id, role: 'opening-panel' },
      segments: faceCurveCommands(line, offsets[1] - quarter, symbol.end - span * 0.6, symbol.end),
      closed: false,
      style,
    },
    {
      kind: 'path',
      ref: { id: symbol.id, role: 'opening-arrow' },
      segments: [
        { k: 'M', to: tail },
        { k: 'L', to: arrow.on },
        { k: 'M', to: back },
        { k: 'L', to: pt(back.x + arrow.across.x * 80, back.y + arrow.across.y * 80) },
        { k: 'M', to: back },
        { k: 'L', to: pt(back.x - arrow.across.x * 80, back.y - arrow.across.y * 80) },
      ],
      closed: false,
      style,
    },
  ]
}

/** A window's three lines, or a removed section's two dashed ones (#65 §12). */
function faceLines(symbol: OpeningSymbol, style: StyleKey, role: string, withReferenceLine: boolean): DisplayItem[] {
  const offsets = withReferenceLine ? [symbol.offsets[0], 0, symbol.offsets[1]] : [symbol.offsets[0], symbol.offsets[1]]
  return offsets.map((offset) => ({
    kind: 'path' as const,
    ref: { id: symbol.id, role },
    segments: faceCurveCommands(symbol.line, offset, symbol.start, symbol.end),
    closed: false,
    style,
  }))
}

/** The items of one Opening, in the order the layer draws them. */
export function openingItems(symbol: OpeningSymbol, selected: boolean): DisplayItem[] {
  const style: StyleKey = selected ? 'opening:selected' : 'opening'
  if (symbol.kind === 'window') return faceLines(symbol, 'opening-window-line', 'opening-window', true)
  if (symbol.kind === 'removed_section') return faceLines(symbol, 'opening-removed', 'opening-removed', false)
  if (symbol.swing === 'sliding') return slidingDoor(symbol, style)
  return hingedDoor(symbol, style)
}

/** The cut edge of one band piece, in the Wall's own millimetres. */
export const pieceCommands = (piece: WallPiece): PathCommand[] => pathToCommands(piece.outline)

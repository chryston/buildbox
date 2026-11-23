/**
 * The same drawing, in millimetres of paper (#61).
 *
 * `drawing` resolves a size role once and uses the answer twice: a writer uses `plan-label` as
 * millimetres of ink, and a builder uses `plan-dim-offset` as millimetres *of the thing being
 * drawn* — the distance a dimension line sits outside a footprint. Those are the same number only
 * when one millimetre of model *is* one millimetre of paper. At 1:50 they differ by fifty, and a
 * list built in model millimetres and then shrunk onto a sheet carries its dimension lines at
 * 0.08 mm outside the footprints they measure.
 *
 * So the input is converted instead of the output. Scaling a derived model by `1/50` is a change
 * of units, not a re-derivation: no geometry is computed, no path is re-solved, every number is
 * multiplied by one constant. `drawing` then never learns it was asked for paper, and its offsets
 * come out as the ink they always meant to be.
 */

import type {
  Affine,
  ClosedPath,
  DerivedFace,
  DerivedFloor,
  DerivedItemDetail,
  DerivedPlacement,
  DerivedRoom,
  DerivedWall,
  FloorRooms,
  FloorWalls,
  Pt,
  Rect,
  Segment,
} from '../derive'
import type { WallOpenings } from '../drawing'
import type { WallRefLine } from '../domain'
import { affineMultiply, affineScale } from '../derive'

/** The cabinet arm of a derived Item Detail, and the scene it carries. */
type CabinetDetail = Extract<DerivedItemDetail, { kind: 'cabinet' }>
type SceneLayout = CabinetDetail['layout']
type UnitLayout = SceneLayout['units'][number]

const scalePt = (k: number, at: Pt): Pt => ({ x: at.x * k, y: at.y * k })

const scaleRect = (k: number, rect: Rect): Rect => ({
  x: rect.x * k,
  y: rect.y * k,
  w: rect.w * k,
  h: rect.h * k,
})

/** A matrix that maps the same points `k` times closer together. */
const scaleAffine = (k: number, m: Affine): Affine => affineMultiply(affineScale(k), m)

/**
 * A closed loop at `k`.
 *
 * An arc's radius is `|start − center|` and is never stored, so scaling both ends scales it; an
 * ellipse's two radii are stored and are scaled by hand. `sweepDeg` is an angle and survives
 * untouched — a circle shrunk is still the same circle turned.
 */
function scaleSegment(k: number, segment: Segment): Segment {
  switch (segment.kind) {
    case 'line':
      return { ...segment, to: scalePt(k, segment.to) }
    case 'arc':
      return { ...segment, to: scalePt(k, segment.to), center: scalePt(k, segment.center) }
    case 'ellipticalArc':
      return {
        ...segment,
        to: scalePt(k, segment.to),
        center: scalePt(k, segment.center),
        rx: segment.rx * k,
        ry: segment.ry * k,
      }
  }
}

function scaleClosedPath(k: number, path: ClosedPath): ClosedPath {
  return { start: scalePt(k, path.start), segments: path.segments.map((s) => scaleSegment(k, s)) }
}

/** One Placed Item at `k`, with every derived field agreeing with every other. */
function scalePlacement(k: number, placement: DerivedPlacement): DerivedPlacement {
  return {
    ...placement,
    translation: scalePt(k, placement.translation),
    worldTransform: scaleAffine(k, placement.worldTransform),
    worldPath: scaleClosedPath(k, placement.worldPath),
    worldBounds: scaleRect(k, placement.worldBounds),
    localBounds: scaleRect(k, placement.localBounds),
    origin: scalePt(k, placement.origin),
  }
}

/** The Floor a Plan View draws, in millimetres of paper. */
export function scaleDerivedFloor(d: DerivedFloor, k: number): DerivedFloor {
  return {
    ...d,
    planImage:
      d.planImage === null
        ? null
        : { ...d.planImage, pxToFloor: scaleAffine(k, d.planImage.pxToFloor) },
    placements: d.placements.map((p) => scalePlacement(k, p)),
    bounds: d.bounds === null ? null : scaleRect(k, d.bounds),
  }
}

/** One tidied Wall face at `k`. */
function scaleFace(k: number, face: DerivedFace): DerivedFace {
  return { ...face, from: scalePt(k, face.from), to: scalePt(k, face.to), segment: scaleSegment(k, face.segment) }
}

/** A Wall's reference line at `k`: two points for a straight run, three for an arc. */
function scaleRefLine(k: number, line: WallRefLine): WallRefLine {
  return line.kind === 'line'
    ? { ...line, start: scalePt(k, line.start), end: scalePt(k, line.end) }
    : { ...line, start: scalePt(k, line.start), end: scalePt(k, line.end), through: scalePt(k, line.through) }
}

/**
 * The Walls of one Floor, in millimetres of paper (#73 §1).
 *
 * Every geometric field goes through the shrink, the snap sources included: a paper copy whose parts
 * disagreed with one another is a copy someone could draw from and get the wrong answer out of.
 * `length` scales with them because the only thing the drawing asks it is whether a `W-3` reference
 * fits inside the band, which at 1:50 is a question about paper.
 */
export function scaleFloorWalls(d: FloorWalls, k: number): FloorWalls {
  const walls = d.walls.map((wall): DerivedWall => ({
    ...wall,
    outline: scaleClosedPath(k, wall.outline),
    faces: [scaleFace(k, wall.faces[0]), scaleFace(k, wall.faces[1])] as readonly [DerivedFace, DerivedFace],
    length: wall.length * k,
  }))
  return {
    ...d,
    walls,
    byId: new Map(walls.map((wall) => [wall.id, wall])),
    faces: d.faces.map((face) => scaleFace(k, face)),
    corners: d.corners.map((corner) => ({ ...corner, point: scalePt(k, corner.point) })),
    snapSources: d.snapSources.map((source) => ({
      ...source,
      corners: source.corners.map((corner) => ({ ...corner, point: scalePt(k, corner.point) })),
      faces: source.faces.map((face) => ({
        ...face,
        from: scalePt(k, face.from),
        to: scalePt(k, face.to),
        segment: scaleSegment(k, face.segment),
      })),
    })),
  }
}

/**
 * The Rooms of one Floor, in millimetres of paper.
 *
 * The measured fields — `areaMm2`, `areaM2`, `perimeterMm` — deliberately do not scale: they are what
 * a Room's label says out loud, and a sheet at 1:50 reading `0.05 m²` is a sheet with a lie printed
 * on it. The domain's own `outline` is left as it was written, because the drawing reads the
 * evaluated `path` and nothing else.
 */
export function scaleFloorRooms(d: FloorRooms, k: number): FloorRooms {
  return {
    ...d,
    rooms: d.rooms.map((room): DerivedRoom => ({
      ...room,
      path: scaleClosedPath(k, room.path),
      labelAnchor: scalePt(k, room.labelAnchor),
      bounds: scaleRect(k, room.bounds),
      anchors: room.anchors.map((anchor) => ({ ...anchor, at: scalePt(k, anchor.at) })),
    })),
    roomBounds: d.roomBounds === null ? null : scaleRect(k, d.roomBounds),
    floorBounds: d.floorBounds === null ? null : scaleRect(k, d.floorBounds),
  }
}

/**
 * The Openings of one Floor's Walls, in millimetres of paper.
 *
 * `start`, `end` and `width` are distances along the host's reference line and the leaf's own length,
 * and the reference line and its face offsets are the geometry those distances are measured on, so
 * all of it shrinks together or a door is drawn outside the Wall it is cut in.
 */
export function scaleWallOpenings(d: readonly WallOpenings[], k: number): WallOpenings[] {
  return d.map((host) => ({
    ...host,
    pieces: host.pieces.map((piece) => ({
      ...piece,
      from: piece.from * k,
      to: piece.to * k,
      outline: scaleClosedPath(k, piece.outline),
    })),
    symbols: host.symbols.map((symbol) => ({
      ...symbol,
      start: symbol.start * k,
      end: symbol.end * k,
      width: symbol.width * k,
      line: scaleRefLine(k, symbol.line),
      offsets: [symbol.offsets[0] * k, symbol.offsets[1] * k] as const,
    })),
  }))
}

const scaleBox = (k: number, box: { x: number; y: number; w: number; h: number }) => scaleRect(k, box)

/** One cabinet unit's scene at `k`. The `unit` field is a label source and is left alone. */
function scaleUnitLayout(k: number, unit: UnitLayout): UnitLayout {
  return {
    ...unit,
    x: unit.x * k,
    y: unit.y * k,
    w: unit.w * k,
    h: unit.h * k,
    panels: unit.panels.map((panel) => ({ ...panel, ...scaleBox(k, panel) })),
    voids: unit.voids.map((voidNode) => ({ ...voidNode, ...scaleBox(k, voidNode) })),
    dividers: unit.dividers.map((divider) => ({
      ...divider,
      ...scaleBox(k, divider),
      childABounds: scaleBox(k, divider.childABounds),
      childBBounds: scaleBox(k, divider.childBBounds),
    })),
  }
}

/** The whole cabinet scene at `k`. */
export function scaleSceneLayout(k: number, layout: SceneLayout): SceneLayout {
  return {
    units: layout.units.map((unit) => scaleUnitLayout(k, unit)),
    boundingBox: scaleBox(k, layout.boundingBox),
  }
}

/** The Item Detail View's Item Design, in millimetres of paper. */
export function scaleDerivedItemDetail(d: DerivedItemDetail, k: number): DerivedItemDetail {
  if (d.kind === 'cabinet') return { ...d, layout: scaleSceneLayout(k, d.layout) }
  return {
    ...d,
    footprint: scaleClosedPath(k, d.footprint),
    origin: scalePt(k, d.origin),
    bounds: scaleRect(k, d.bounds),
  }
}

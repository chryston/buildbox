/**
 * Rooms on the Plan View (#67 behaviours 20, 21, 35).
 *
 * Three marks, and each one answers to a different criterion:
 *
 *  - the **area**, filled lightly so a Room reads as named Floor rather than as a thing standing
 *    on it, and drawn under the Wall bands because a Wall sits on a Room's edge and not the other
 *    way round;
 *  - the **overlap region**, painted red wherever a proposal takes area another Room already
 *    has. It is the intersection's own loops, analytic, not the proposal's whole box — the eye
 *    has to find the part that is wrong;
 *  - the **label**: `Kitchen · 13.08 m²`, centred on the label anchor, which is the pole of
 *    inaccessibility and therefore inside an L-shaped Room rather than in the notch its bounding
 *    box has and the Room does not.
 *
 * The label is the only one of the three with a placement problem. It is tried at the full label
 * size, then once at the minimum size, then moved outward through the Room's inner region; only
 * when nothing inside fits does it go outside with a leader. It is never clipped and never
 * truncated, which is the shape prototype's defect this issue exists to fix.
 *
 * Nothing here decides whether a proposal may be committed: the caller has already asked the edit
 * layer, and hands over the regions that answer came back with.
 */
import { classifyPoint } from '../geometry'
import type { ClosedPath, Pt } from '../geometry'
import type { DerivedRoom, FloorRooms } from '../derive'
import { layoutText } from './font/layoutText'
import type { TextLayout } from './font/layoutText'
import { pathToCommands } from './path'
import { resolveSize } from './styles'
import type { DisplayItem, DisplayLayer, DisplayList, Rect, Sizing, StyleKey } from './types'

/** The Room being drawn or edited right now, before anybody has committed it (#67 behaviour 21). */
export interface RoomProposal {
  /** What the proposal is addressed as: the Room being edited, or the draft being drawn. */
  readonly id: string
  /** The proposal's Outline, evaluated in Floor millimetres. */
  readonly path: ClosedPath
  /** Whether it can be committed; a blocked proposal is drawn in red, never in orange. */
  readonly blocked: boolean
  /** Every loop every other Room shares with it — the hatched region, not the whole shape. */
  readonly overlaps: readonly ClosedPath[]
}

export interface RoomDrawOptions {
  readonly sizing: Sizing
  /** The selected Room: heavier line, deeper fill. */
  readonly selectedRoomId?: string | null
  /**
   * Boxes the label must not sit on: the `W-n` references, the vertex handles of the Room being
   * edited, a warning badge already placed. The caller owns them because it is the caller that
   * knows what else is about to be painted (#66 §14 does the same for the badges).
   */
  readonly obstacles?: readonly Rect[]
  /** The Room being drawn or edited, or `null` when none is. */
  readonly proposal?: RoomProposal | null
  /**
   * How `Kitchen · 13.08 m²` is spelled. The words belong to the surface, as every other piece of
   * copy in a display list does — `drawSelectionAnnotations` is handed its length formatter for
   * exactly the same reason (#60 §4).
   */
  readonly formatLabel: (name: string, areaSquareMillimetres: number) => string
}

/** A laid-out string's own height: the two halves the font reports, added. */
const heightOf = (layout: TextLayout): number => layout.ascent + layout.descent

/** A box centred on `at`. */
const boxAt = (at: Pt, width: number, height: number): Rect => ({
  x: at.x - width / 2,
  y: at.y - height / 2,
  w: width,
  h: height,
})

const crosses = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** The four corners of a box, which is what has to lie inside the outline for the box to count. */
const corners = (box: Rect): Pt[] => [
  { x: box.x, y: box.y },
  { x: box.x + box.w, y: box.y },
  { x: box.x, y: box.y + box.h },
  { x: box.x + box.w, y: box.y + box.h },
]

/** Whether the whole box lies in `path` — the test that keeps a label out of an L's notch. */
const enclosedBy = (box: Rect, path: ClosedPath): boolean =>
  corners(box).every((corner) => classifyPoint(corner, path) !== 'outside')

/**
 * Where a Room's label goes.
 *
 * The anchor first, at the full size; then the same point at the minimum size — one step down and
 * no further, because a second shrink is a label nobody can read; then outward through the inner
 * region on rings of twelve points, which is what carries a label out of a narrow leg of an L
 * into the wide part of the Room it belongs to. Only when every one of those is taken does the
 * label go outside, above the outline, with a leader back to the anchor.
 */
export function placeRoomLabel(
  room: DerivedRoom,
  layout: TextLayout,
  minimum: TextLayout,
  obstacles: readonly Rect[],
  gap: number,
): { at: Pt; outside: boolean; shrunk: boolean } {
  const fits = (at: Pt, size: TextLayout): boolean => {
    const box = boxAt(at, size.width, heightOf(size))
    return enclosedBy(box, room.path) && !obstacles.some((other) => crosses(box, other))
  }
  if (fits(room.labelAnchor, layout)) return { at: room.labelAnchor, outside: false, shrunk: false }
  if (fits(room.labelAnchor, minimum)) return { at: room.labelAnchor, outside: false, shrunk: true }

  for (const size of [layout, minimum] as const) {
    // A step of the label's own height: the next ring is one label-width further out, so the
    // search cannot skip past a pocket of Floor that would have held it.
    const reach = Math.max(room.bounds.w, room.bounds.h)
    const step = heightOf(size)
    for (let ring = 1; ring * step <= reach; ring += 1) {
      const radius = ring * step
      // Twelve points, each ring turned half a step so successive rings interleave.
      for (let spoke = 0; spoke < 12; spoke += 1) {
        const angle = ((spoke + (ring % 2 === 0 ? 0.5 : 0)) / 12) * Math.PI * 2
        const at: Pt = {
          x: room.labelAnchor.x + Math.cos(angle) * radius,
          y: room.labelAnchor.y + Math.sin(angle) * radius,
        }
        if (fits(at, size)) return { at, outside: false, shrunk: size === minimum }
      }
    }
  }

  // Nothing inside holds it: the label sits above the Room's own box — never at a bounding-box
  // corner, which is the prototype's other defect — and a leader says which Room it names.
  const at: Pt = { x: room.labelAnchor.x, y: room.bounds.y - gap - heightOf(layout) / 2 }
  return { at, outside: true, shrunk: false }
}

/** The box an evaluated path occupies, endpoints and its first point included. */
function pathBox(path: ClosedPath): Rect {
  const points = [path.start, ...path.segments.map((segment) => segment.to)]
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

/** The Rooms of one Floor: their areas, their overlaps, and one label each. */
export function drawRooms(rooms: FloorRooms, options: RoomDrawOptions): DisplayList {
  const {
    sizing,
    selectedRoomId = null,
    obstacles = [],
    proposal = null,
    formatLabel,
  } = options
  const shapes: DisplayItem[] = []
  const marks: DisplayItem[] = []
  const labels: DisplayItem[] = []
  let box: Rect | null = null

  const grow = (bounds: Rect): void => {
    box = box === null
      ? bounds
      : {
        x: Math.min(box.x, bounds.x),
        y: Math.min(box.y, bounds.y),
        w: Math.max(box.x + box.w, bounds.x + bounds.w) - Math.min(box.x, bounds.x),
        h: Math.max(box.y + box.h, bounds.y + bounds.h) - Math.min(box.y, bounds.y),
      }
  }

  for (const room of rooms.rooms) {
    grow(room.bounds)
    const style: StyleKey = room.id === selectedRoomId ? 'room:selected' : 'room'
    const segments = pathToCommands(room.path)
    shapes.push({
      kind: 'path',
      ref: { id: room.id, role: 'room' },
      segments,
      closed: true,
      style,
    })
    // The same area again, painted with nothing the eye can see: the outline is one device pixel,
    // and a click aimed at the middle of a Room should not have to find it.
    shapes.push({
      kind: 'path',
      ref: { id: room.id, role: 'room-hit' },
      segments,
      closed: true,
      style: 'room-hit',
    })

    // An Edge that claims a Wall face says so on the drawing: a badge at its middle, the same size
    // whatever the zoom, so a Floor full of Rooms reads as which sides are shared (#67 §12).
    for (const anchor of room.anchors) {
      const r = resolveSize('room-anchor', sizing).mm / 2
      marks.push({
        kind: 'path',
        ref: { id: `${room.id}#${anchor.segmentId}`, role: 'room-anchor' },
        segments: [
          { k: 'M', to: { x: anchor.at.x, y: anchor.at.y - r } },
          { k: 'L', to: { x: anchor.at.x + r, y: anchor.at.y } },
          { k: 'L', to: { x: anchor.at.x, y: anchor.at.y + r } },
          { k: 'L', to: { x: anchor.at.x - r, y: anchor.at.y } },
        ],
        closed: true,
        style: 'room-anchor',
      })
    }

    const full = resolveSize('plan-label', sizing)
    const small = resolveSize('room-label-min', sizing)
    const text = formatLabel(room.name, room.areaMm2)
    const placed = placeRoomLabel(
      room,
      layoutText(text, full.mm),
      layoutText(text, small.mm),
      obstacles,
      resolveSize('plan-dim-gap', sizing).mm,
    )
    const layout = placed.shrunk ? layoutText(text, small.mm) : layoutText(text, full.mm)
    if (placed.outside) {
      marks.push({
        kind: 'path',
        ref: { id: room.id, role: 'room-label-leader' },
        segments: [
          { k: 'M', to: room.labelAnchor },
          { k: 'L', to: { x: placed.at.x, y: placed.at.y + heightOf(layout) / 2 } },
        ],
        closed: false,
        style: 'room-label-leader',
      })
      grow(boxAt(placed.at, layout.width, heightOf(layout)))
    }
    labels.push({
      kind: 'text',
      ref: { id: room.id, role: 'room-label' },
      text,
      at: placed.at,
      anchor: 'middle',
      baseline: 'middle',
      rotationDeg: 0,
      role: 'label',
      style: placed.shrunk ? 'room-label:min' : 'room-label',
      layout,
    })
  }

  if (proposal !== null) {
    grow(pathBox(proposal.path))
    marks.push({
      kind: 'path',
      ref: { id: proposal.id, role: 'room-proposal' },
      segments: pathToCommands(proposal.path),
      closed: true,
      style: proposal.blocked ? 'room:proposal-blocked' : 'room:proposal',
    })
    for (const region of proposal.overlaps) {
      grow(pathBox(region))
      marks.push({
        kind: 'path',
        ref: { id: proposal.id, role: 'room-overlap' },
        segments: pathToCommands(region),
        closed: true,
        style: 'room-overlap',
      })
    }
  }

  const layers: DisplayLayer[] = []
  const painted = [...shapes, ...marks]
  if (painted.length > 0) layers.push({ key: 'rooms', items: painted })
  if (labels.length > 0) layers.push({ key: 'room-labels', items: labels })
  return { space: 'floor', bounds: box ?? { x: 0, y: 0, w: 0, h: 0 }, layers, missingGlyphs: [] }
}

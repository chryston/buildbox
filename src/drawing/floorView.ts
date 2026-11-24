/**
 * The Floor View display list (#73 §1): the one assembly the screen and the sheet both draw.
 *
 * A Plan View is not one drawing but five, built by five functions that share one z-order: the Floor
 * with its Placed Items, the Walls with their Openings and references, the Rooms with their labels,
 * the Renovation Display's overlays, and — on screen only — the selection's measurements. They are
 * interleaved by `LAYER_ORDER` rather than appended, or a Wall would land on top of the Item standing
 * in it (#60 §3, #64 §15, #67 behaviour 35). Then the saved view's Drawing Layers have their say:
 * hidden content is not painted at all, a layer with a colour of its own paints its content in it,
 * and inside every z-band the items follow their layer's back-to-front order (#71 §1, §4).
 *
 * Until #73 this assembly lived in `PlanViewCanvas`, and the export composed its sheets from
 * `drawPlanView` alone. That is the whole reason an exported drawing was not the drawing on the
 * screen: no Walls, no references, no Room labels, no Display overlays, and no Layers — a person
 * exported what they had been looking at and got the Existing Model. One function now answers both
 * callers, so the only thing that can differ between them is what a sheet cannot carry: the pointer.
 */
import type { DerivedFloor, FloorBeams, FloorRooms, FloorWalls, RangeClass, RenovationState } from '../derive'
import { RANGE_RANK } from '../derive'
import { drawPlanView, drawPlacement, unionRect } from './planView'
import type { PlanPreview } from './planView'
import { drawWalls, wallLabelBoxes } from './walls'
import type { OpeningPreview } from './walls'
import { drawBeams } from './beams'
import { drawRooms } from './rooms'
import type { RoomProposal } from './rooms'
import { renovationOverlays } from './renovation'
import type { RenovationOutline } from './renovation'
import { pathToCommands } from './path'
import { measureRect } from './font/layoutText'
import { LAYER_ORDER } from './types'
import type { DisplayItem, DisplayLayer, DisplayList, LayerKey, OmittedLabel, RangePaint, Rect, Sizing } from './types'
import type { WallOpenings } from './openings'

/**
 * What this saved view lets a canvas do with one entity (#71 §4), answered by the caller — the one
 * place the Project, the view and the effective model are all in hand. `derive` computes the answers
 * (`layerAccessOf`, `effectiveLayerSetting`); this is the same answers shaped for a drawing pass that
 * may not read the domain.
 */
export interface LayerGates {
  /** Does this view draw it at all: the Display's table and the layer's Visible box. */
  drawn(id: string): boolean
  /** Can a click reach it: drawn, the row's Selectable box, and the `Pick:` filter. */
  pickable(id: string): boolean
  /** Can it be edited: pickable, and the row's Editable box. */
  modifiable(id: string): boolean
  /** The colour this view paints it in, or `null` for its own colours. */
  colorOf(id: string): string | null
  /** The back-to-front index of its layer, which is the order the paint follows inside a z-band. */
  orderOf(id: string): number
  /** The layer's name when this view will not let it be edited, else `null`. */
  readOnlyLayerOf(id: string): string | null
  /** A press that wanted to edit read-only content: the notice that says so. */
  onRefusal?: (layerName: string) => void
}

/**
 * Where this saved view's Plan View Range leaves one entity (#74 §3), answered per entity by the
 * caller — the same shape as `LayerGates`, for the same reason: `derive` owns the classification
 * (`rangeClasses`) and this pass may not read the domain.
 *
 * The range is a presentation and nothing else. It decides how an entity is drawn and where it
 * paints inside its own band; it never decides whether the entity is drawn, and never decides what
 * a click can reach. Those two answers stay the Drawing Layer's alone (#74 §3, criterion 8).
 */
export interface RangeGates {
  /** Which side of the range this entity is on; a kind with no Vertical Extent is `in`. */
  classOf(id: string): RangeClass
}

/** The four collections one Floor View draws, as `derive` handed them over. */
export interface FloorViewEntities {
  floor: DerivedFloor
  walls?: FloorWalls | null
  rooms: FloorRooms | null
  /** The Openings of this Floor, grouped by the Wall each is cut in (#65 §4). */
  openings: readonly WallOpenings[]
  /** The Beams of this Floor (#77 §4), or `null` for a drawing with no Beams to show. */
  beams?: FloorBeams | null
}

/** Everything a Floor View needs that is not the Floor: the paper, the view and the pointer. */
export interface FloorViewOptions {
  sizing: Sizing
  /**
   * The Renovation Display's State map (#70 §F), or `null` for the plain Existing Model drawing.
   * An entity absent from it is not drawn, and one present is drawn as that State — which decides
   * the overlay laid on top.
   */
  renovation?: { states: ReadonlyMap<string, RenovationState> } | null
  /** The saved view's Drawing Layer gates (#71 §4), or `null` when nothing is hidden or recoloured. */
  layers?: LayerGates | null
  /**
   * This view's Plan View Range, answered per entity (#74 §3), or `null` for a drawing that is not
   * a Plan View. It changes how an entity is drawn and where it paints inside its own band, and
   * nothing else: it hides nothing and changes no pickability.
   */
  range?: RangeGates | null
  showPlanImage: boolean
  /** The Item being dragged or turned, screen only. */
  preview?: PlanPreview | null
  selectedWallId?: string | null
  selectedOpeningId?: string | null
  openingPreview?: OpeningPreview | null
  selectedBeamId?: string | null
  selectedRoomId?: string | null
  roomProposal?: RoomProposal | null
  /** The Room label's words, which the screen takes from the workspace's unit settings (#73 §1). */
  formatRoomLabel?: (name: string, areaSquareMillimetres: number) => string
  /** Whether the selected Wall's handles may be drawn at all; a sheet draws none. */
  handles?: (id: string | null | undefined) => boolean
}

/** The assembled list, and the collections as they were actually drawn. */
export interface FloorView {
  /** What to paint: interleaved by z-band and passed through the layer gates. */
  readonly list: DisplayList
  /**
   * The Floor, Walls, Rooms and Openings that survived the Display and the Layers. A canvas picks
   * against these and not against what it was given: an entity this view hides is not a target for
   * a click, a handle or a snap (#71 §4), and a canvas that filtered them a second time would be a
   * canvas that could disagree with its own pixels.
   */
  readonly floor: DerivedFloor
  readonly walls: FloorWalls | null | undefined
  readonly rooms: FloorRooms | null
  readonly openings: readonly WallOpenings[]
  /** The Beams that survived the Display and the Layers (#77 §4). */
  readonly beams: FloorBeams | null | undefined
  /**
   * The labels this view had no room for (#74 §3): the names that would have been written over a
   * name already placed. They are not drawn, and a canvas shows each one on hover instead of
   * losing it — which is the only way a label can be left out without being taken away.
   */
  readonly omittedLabels: OmittedLabel[]
}

/**
 * The box each text item of one band occupies (#74 §3).
 *
 * `measureRect` is the measurement the drawing made when it wrote the item down, so the box this
 * answers with is the box the reader sees — and a label placer told about a box that is not the one
 * drawn would move a name for nothing.
 */
function labelBoxes(list: DisplayList, key: LayerKey): Rect[] {
  const boxes: Rect[] = []
  for (const band of list.layers) {
    if (band.key !== key) continue
    for (const item of band.items) {
      if (item.kind === 'text') boxes.push(measureRect(item.layout, item.at, item.anchor))
    }
  }
  return boxes
}

/**
 * The range's mark on one item (#74 §3): `outline` Above, `faded` Below, and nothing at all In
 * range, which is the normal graphics.
 *
 * A group carries no paint of its own — a Placed Item's footprint is a group around the path that
 * is actually drawn — so the mark travels inward to what the renderers read a `Style` from. An
 * image is the Plan Image, which is the Floor itself and stands in every range.
 */
function withRangePaint(item: DisplayItem, classOf: RangeClass): DisplayItem {
  if (classOf === 'in') return item
  if (item.kind === 'group') {
    return { ...item, items: item.items.map((child) => withRangePaint(child, classOf)) }
  }
  if (item.kind === 'image') return item
  const paint: RangePaint = classOf === 'above' ? 'outline' : 'faded'
  return { ...item, paint }
}

/**
 * The layer and range pass over an assembled display list (#71 §1, §4; #74 §3).
 *
 * An item whose entity this view has hidden is not painted at all; one whose layer has a colour of
 * its own is painted in it, which is how a `Structure` layer drawn grey reads as one thing on the
 * drawing; and inside every z-band the items follow their layer's back-to-front order, the last
 * painted landing on top. An item with no `ref` — a grid line, a chip, the plan image — belongs to no
 * entity: it keeps its own colour and paints with the entity it follows.
 *
 * The range is the outermost key inside each band (#74 §3): what is under the Floor paints first,
 * then the In-range set, then what is over it, and the layer order only sorts within one of those
 * three. It is a presentation, so nothing here is ever dropped for being out of range — the filter
 * reads `layers` alone, and a Below-range Room is still drawn and still pickable.
 */
function paintByLayer(list: DisplayList, layers: LayerGates | null, range: RangeGates | null): DisplayList {
  return {
    ...list,
    layers: list.layers.map((band) => {
      // An item with no `ref` of its own takes the order of the entity before it, so a Room's label
      // still paints with its Room and a Wall's dimension with its Wall — and the same range mark.
      let lastOrder = 0
      let lastRank = RANGE_RANK.in
      const items = band.items
        .filter((item) => item.ref === undefined || layers === null || layers.drawn(item.ref.id))
        .map((item): { rank: number; order: number; item: DisplayItem } => {
          const id = item.ref?.id
          if (id === undefined) return { rank: lastRank, order: lastOrder, item }
          lastOrder = layers === null ? 0 : layers.orderOf(id)
          const classOf: RangeClass = range === null ? 'in' : range.classOf(id)
          lastRank = RANGE_RANK[classOf]
          const colour = layers === null ? null : layers.colorOf(id)
          // `color` is what the renderer paints a path's fill and stroke, or a label's glyphs, with.
          // An image carries pixels and a group carries other items rather than paint of its own, so
          // neither takes the layer's colour.
          const tinted = colour === null || item.kind === 'image' || item.kind === 'group'
            ? item
            : { ...item, color: colour }
          return { rank: lastRank, order: lastOrder, item: withRangePaint(tinted, classOf) }
        })
      // `Array.prototype.sort` is stable, so entities of one layer keep the order their own drawing
      // gave them — which is the Renovation order #70 established, one layer down.
      return {
        key: band.key,
        items: items.sort((a, b) => a.rank - b.rank || a.order - b.order).map((entry) => entry.item),
      }
    }),
  }
}

/**
 * The outlines the Renovation Display marks, in the order the overlays are laid: Walls first, then
 * Placed Items, then Rooms, each in its own layer (#70 §F).
 *
 * A Wall's outline is its band, a Placed Item's is the footprint `drawPlacement` already projects,
 * and a Room's is its polygon — the three things a `Demolition` hatch or a `Proposed` halo can be
 * drawn on without a second projection of the model.
 */
function renovationOutlines(
  floor: DerivedFloor,
  walls: FloorWalls | null,
  rooms: FloorRooms | null,
): RenovationOutline[] {
  return [
    ...(walls === null ? [] : walls.walls.map((wall): RenovationOutline => ({
      ref: { id: wall.id, role: 'wall' },
      layer: 'walls',
      outline: pathToCommands(wall.outline),
    }))),
    ...floor.placements.map((placement): RenovationOutline => ({
      ref: { id: placement.id, role: 'placed-item' },
      layer: 'placed-items',
      outline: drawPlacement(placement, null).segments,
    })),
    ...(rooms === null ? [] : rooms.rooms.map((room): RenovationOutline => ({
      ref: { id: room.id, role: 'room' },
      layer: 'rooms',
      outline: pathToCommands(room.path),
    }))),
  ]
}

/**
 * The one Floor View assembly: filter by Display and Layers, draw the five lists, interleave them by
 * z-band, then pass the result through the layer gates.
 *
 * The filtering happens here rather than in the caller so that the pixels and the pick list cannot
 * drift apart, and it is skipped entirely when neither gate is in force — which is every Project
 * with no Design Options and no layer turned off — so that the common case allocates nothing it did
 * not allocate before (#69's derive budget measures the canvas too).
 */
export function drawFloorView(entities: FloorViewEntities, options: FloorViewOptions): FloorView {
  const { floor, walls, rooms, openings, beams } = entities
  const { sizing, showPlanImage } = options
  const states = options.renovation === null || options.renovation === undefined ? null : options.renovation.states
  const layers = options.layers ?? null
  const range = options.range ?? null
  const shown = (id: string): boolean => (states === null || states.has(id)) && (layers === null || layers.drawn(id))
  /** Handles belong to a selection this view will let be edited, and to no other (#71 §4). */
  const handlesFor = options.handles ?? (() => false)
  const plain = states === null && layers === null
  const drawnFloor: DerivedFloor = plain
    ? floor
    : { ...floor, placements: floor.placements.filter((p) => shown(p.id)) }
  const drawnWalls: FloorWalls | null | undefined = plain || walls === undefined || walls === null
    ? walls
    : { ...walls, walls: walls.walls.filter((wall) => shown(wall.id)) }
  const drawnRooms: FloorRooms | null = plain || rooms === null
    ? rooms
    : { ...rooms, rooms: rooms.rooms.filter((room) => shown(room.id)) }
  // An Opening belongs to the Wall it is cut in: a Display that does not draw that Wall does not
  // draw its Openings either, and `drawWalls` is handed only the hosts it will find.
  const drawnOpenings = plain
    ? openings
    : openings.filter((host) => shown(host.wallId))
  const drawnBeams: FloorBeams | null | undefined = plain || beams === undefined || beams === null
    ? beams
    : { ...beams, beams: beams.beams.filter((beam) => shown(beam.id)) }
  // #70 §F: a Renovation Display draws a subset of the Floor and marks what it draws. The subset is
  // `states`' domain — an entity the Display does not draw is absent from it — and the marking is the
  // overlay items `renovationOverlays` lays in each entity's own layer.
  const overlayList: DisplayList | null = states === null
    ? null
    : {
      space: 'floor',
      bounds: drawnFloor.bounds ?? { x: 0, y: 0, w: 0, h: 0 },
      layers: renovationOverlays(renovationOutlines(drawnFloor, drawnWalls ?? null, drawnRooms), states, sizing),
      missingGlyphs: [],
    }

  const list = drawPlanView(states === null ? floor : drawnFloor, { showPlanImage, preview: options.preview ?? null }, { sizing })
  // #74 §3: an Item's name is the label a reader is looking for, so it is placed first and the two
  // kinds drawn after it — the `W-n` references and the Room areas — are told where it landed.
  // `measureRect` is the same measurement the text item carries, so the box avoided is the box drawn.
  const itemLabelBoxes = labelBoxes(list, 'placed-item-labels')
  const wallList = drawnWalls === undefined || drawnWalls === null || drawnWalls.walls.length === 0
    ? null
    : drawWalls(drawnWalls, {
      sizing,
      selectedWallId: options.selectedWallId,
      openings: drawnOpenings,
      selectedOpeningId: options.selectedOpeningId,
      preview: options.openingPreview ?? null,
      handles: handlesFor(options.selectedWallId),
      labelObstacles: itemLabelBoxes,
    })
  // A Room's label may not sit on a `W-n` reference or on an Item's name, and the only honest source
  // for where those are is the placement that draws them.
  const roomList = drawnRooms === null || drawnRooms.rooms.length === 0
    ? null
    : drawRooms(drawnRooms, {
      sizing,
      selectedRoomId: options.selectedRoomId,
      proposal: options.roomProposal ?? null,
      obstacles: drawnWalls === undefined || drawnWalls === null
        ? itemLabelBoxes
        : wallLabelBoxes(drawnWalls, sizing, itemLabelBoxes),
      formatLabel: options.formatRoomLabel ?? ((name, squareMillimetres) => `${name} · ${squareMillimetres}`),
    })
  // Walls, Rooms and footprints are lists built for three reasons, but they share one z-order:
  // `LAYER_ORDER` is the only source, so each is interleaved by layer rather than appended, or a
  // Wall would land on top of the Item standing in it (#60 §3, #64 §15, #67 behaviour 35).
  const beamList = drawnBeams === undefined || drawnBeams === null
    ? null
    : drawBeams(drawnBeams, { sizing, selectedBeamId: options.selectedBeamId })
  const extra = [beamList, wallList, roomList, overlayList].filter((one): one is DisplayList => one !== null)
  const withWalls: DisplayList = extra.length === 0
    ? list
    : {
      ...list,
      bounds: extra.reduce((bounds, one) => unionRect(bounds, one.bounds), list.bounds),
      layers: LAYER_ORDER.flatMap((key): DisplayLayer[] => {
        const items = [list, ...extra]
          .flatMap((one) => one.layers)
          .filter((layer) => layer.key === key)
          .flatMap((layer) => layer.items)
        return items.length === 0 ? [] : [{ key, items }]
      }),
    }
  // #71 §1, §4: the layer pass over what was assembled — hidden content is not painted, a layer with
  // a colour of its own paints its content in it, and inside every z-band the items follow their
  // layer's back-to-front order. The band's own interleaving stays the rule across bands, because
  // that is what keeps a Wall under the Item standing in it (#60 §3, #67 behaviour 35).
  return {
    list: layers === null && range === null ? withWalls : paintByLayer(withWalls, layers, range),
    floor: drawnFloor,
    walls: drawnWalls,
    rooms: drawnRooms,
    openings: drawnOpenings,
    beams: drawnBeams,
    omittedLabels: withWalls.omittedLabels ?? [],
  }
}

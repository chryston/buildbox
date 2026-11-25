/**
 * The Plan View Range on the drawing (#74 §3, criteria 1, 2 and 8).
 *
 * The scene is the issue's own fixture, built here rather than read from a file because the drawing
 * is what is under test and nothing else needs it: a rectangular room of four Walls with one Window,
 * two Base cabinets standing on the Floor, a Wall cabinet on the wall at 1500 — its footprint over
 * the first Base cabinet, so the two names compete for one box — and a Sump box sunk 150 below the
 * Floor Datum. The range at 0–1200 then says everything the criterion enumerates at once.
 *
 * Criterion 8 is the negative half, and the more important one: at 1600–1700 nothing is In range,
 * and yet every entity is still drawn and still pickable. A range is a presentation; only Drawing
 * Layers hide a thing.
 */
import { describe, expect, it } from 'vitest'
import { deriveRooms, deriveWalls, effectiveFloor, effectiveModel, rangeClasses } from '../derive'
import type { Floor, ItemDesign, ItemFootprint, Opening, PlanView, PlanViewRange, PlacedItem, Project, Wall, WallJunction } from '../domain'
import type { Pt } from '../geometry'
import { measureRect } from './font/layoutText'
import { wallOpenings } from './openings'
import { drawFloorView } from './floorView'
import type { FloorView, RangeGates } from './floorView'
import { serializeSvg, toSvgTree } from './svg'
import { RANGE_FADED_OPACITY, rangeStyle, resolveStyle } from './styles'
import type { DisplayItem, DisplayList, RangePaint, Rect, Sizing } from './types'

/** The viewport the Plan View canvas draws at, so a promise in pixels reads in millimetres. */
const SCREEN: Sizing = { kind: 'screen', pxPerMm: 1 }

const FLOOR: Floor = { id: 'floor-1', name: 'Floor 1', planImage: null, limits: { upperMm: 2600 } }

/** The whole range: nothing is out of it, which is the drawing before #74 and the one to compare to. */
const EVERYTHING: PlanViewRange = { lowerMm: 0, upperMm: 2600 }

const at = (x: number, y: number): Pt => ({ x, y })

const wall = (id: string, ref: string, start: Pt, end: Pt): Wall => ({
  id,
  ref,
  floorId: 'floor-1',
  line: { kind: 'line', start, end },
  thickness: 200,
  justification: 'centre',
  baseElevation: 0,
  height: 2600,
})

/** Four Walls, joined at the corners: a 6 × 4 m room whose inside faces are at 100 and 5 900 / 3 900. */
const WALLS: Wall[] = [
  wall('wall-a', 'W-1', at(0, 0), at(6000, 0)),
  wall('wall-b', 'W-2', at(6000, 0), at(6000, 4000)),
  wall('wall-c', 'W-3', at(6000, 4000), at(0, 4000)),
  wall('wall-d', 'W-4', at(0, 4000), at(0, 0)),
]

const junction = (id: string, first: string, second: string): WallJunction => ({
  id,
  floorId: 'floor-1',
  ends: [
    { wallId: first, end: 'end' },
    { wallId: second, end: 'start' },
  ],
})

const JUNCTIONS: WallJunction[] = [
  junction('junction-1', 'wall-a', 'wall-b'),
  junction('junction-2', 'wall-b', 'wall-c'),
  junction('junction-3', 'wall-c', 'wall-d'),
  junction('junction-4', 'wall-d', 'wall-a'),
]

/** WND-1: sill 900, head 2100 — inside 0–1200 at its sill, so it is In range like its Wall. */
const OPENINGS: Opening[] = [
  {
    id: 'opening-1',
    floorId: 'floor-1',
    hostWallId: 'wall-b',
    kind: 'window',
    label: 'WND-1',
    start: 1400,
    width: 1200,
    sill: 900,
    head: 2100,
  },
  // WND-2 sits well above a 0–1200 range: the entity whose hit shape must keep working while the
  // range is redashing everything else.
  {
    id: 'opening-2',
    floorId: 'floor-1',
    hostWallId: 'wall-d',
    kind: 'window',
    label: 'WND-2',
    start: 1400,
    width: 900,
    sill: 2000,
    head: 2400,
  },
]

const rectangle = (width: number, depth: number): ItemFootprint => ({
  kind: 'preset',
  preset: { kind: 'rectangle', width, depth },
  centre: at(width / 2, depth / 2),
  orientationDeg: 0,
})

const design = (id: string, name: string, width: number, depth: number, height: number, color: string): ItemDesign => ({
  id,
  kind: 'generic',
  name,
  footprint: rectangle(width, depth),
  origin: at(width / 2, depth / 2),
  height,
  heightIsTypical: true,
  color,
})

const DESIGNS: ItemDesign[] = [
  design('design-base', 'Base cabinet', 600, 600, 860, '#4f83cc'),
  design('design-wall', 'Wall cabinet', 900, 350, 700, '#7c9cbf'),
  design('design-sump', 'Sump box', 500, 500, 100, '#9aa5b1'),
]

const place = (id: string, itemDesignId: string, x: number, y: number, baseElevation: number): PlacedItem => ({
  id,
  itemDesignId,
  floorId: 'floor-1',
  translation: at(x, y),
  rotationDeg: 0,
  baseElevation,
})

/**
 * The four placements of the fixture, in the order the list is assembled in: the Wall cabinet lands
 * on the first Base cabinet, so the two names want the same box.
 */
const PLACEMENTS: PlacedItem[] = [
  place('item-base-1', 'design-base', 1500, 1200, 0),
  place('item-base-2', 'design-base', 3500, 1200, 0),
  place('item-wall-1', 'design-wall', 1500, 1200, 1500),
  place('item-sump-1', 'design-sump', 4800, 3500, -150),
]

const projectOf = (range: PlanViewRange, placements: readonly PlacedItem[]): Project => ({
  id: 'project-1',
  meta: { name: 'Range' },
  preferences: { displayUnit: 'mm', displayPrecision: 0, defaultWallHeight: 2600 },
  floors: [FLOOR],
  views: [{
    id: 'view-1',
    kind: 'plan',
    floorId: 'floor-1',
    name: 'Floor 1',
    isDefault: true,
    showPlanImage: true,
    planViewRange: range,
  } satisfies PlanView],
  itemDesigns: DESIGNS,
  existingModel: {
    placedItems: [...placements],
    walls: WALLS,
    wallJunctions: JUNCTIONS,
    openings: OPENINGS,
    beams: [],
    rooms: [{
      id: 'room-1',
      floorId: 'floor-1',
      name: 'Kitchen',
      outline: {
        kind: 'path',
        path: {
          start: at(100, 100),
          segments: [
            { kind: 'line', to: at(5900, 100) },
            { kind: 'line', to: at(5900, 3900) },
            { kind: 'line', to: at(100, 3900) },
            { kind: 'line', to: at(100, 100) },
          ],
        },
        segmentIds: ['edge-1', 'edge-2', 'edge-3', 'edge-4'],
      },
      wallFaceRefs: [],
    }],
  },
  warningAcknowledgements: [],
  comments: [],
  commentReferenceCounter: 0,
  annotations: [],
  annotationReferenceCounter: 0,
})

/** The gates the workspace hands the canvas: `derive` classifies, the drawing only asks. */
const gatesOf = (project: Project, range: PlanViewRange): RangeGates => {
  const classes = rangeClasses(effectiveModel(project, 'floor-1', null), project.itemDesigns, range)
  return { classOf: (id) => classes.get(id) ?? 'in' }
}

/** What the Plan View canvas draws for one range; `null` is a drawing that is not a Plan View's. */
function scene(range: PlanViewRange | null, placements: readonly PlacedItem[] = PLACEMENTS): FloorView {
  const project = projectOf(range ?? EVERYTHING, placements)
  return drawFloorView(
    {
      floor: effectiveFloor(project, 0, 'floor-1', null),
      walls: deriveWalls(project, 'floor-1'),
      rooms: deriveRooms(project, 'floor-1'),
      openings: wallOpenings(WALLS, JUNCTIONS, OPENINGS),
    },
    {
      sizing: SCREEN,
      showPlanImage: false,
      range: range === null ? null : gatesOf(project, range),
    },
  )
}

const itemsOf = (list: DisplayList, key: string): DisplayItem[] =>
  list.layers.find((layer) => layer.key === key)?.items ?? []

const idOf = (item: DisplayItem): string => item.ref?.id ?? ''

/**
 * The distinct marks one entity's items carry. An entity is more than one item — a Room is its area
 * and its hit shape, an Opening its symbol and its gap — and every one of them takes the same mark,
 * so the answer worth asserting is the set rather than the count.
 */
function paintsOf(items: readonly DisplayItem[], id: string): (RangePaint | undefined)[] {
  const walk = (item: DisplayItem): (RangePaint | undefined)[] =>
    item.kind === 'group' ? item.items.flatMap(walk) : ['paint' in item ? item.paint : undefined]
  return [...new Set(items.filter((item) => idOf(item) === id).flatMap(walk))]
}

const svgOf = (list: DisplayList): string =>
  serializeSvg(toSvgTree(list, { sizing: SCREEN, includeRefs: true, resolveAsset: () => null }))

/**
 * What the renderer wrote for one entity in one role: the element that carries the reference, plus
 * whatever it opens — a Placed Item's footprint is a `<g>` around the path that carries the paint.
 */
function elementOf(svg: string, id: string, role: string): string {
  const mark = `data-ref="${id}" data-ref-role="${role}"`
  const start = svg.indexOf(mark)
  if (start < 0) throw new Error(`nothing was drawn for ${role} ${id}`)
  return svg.slice(svg.lastIndexOf('<', start), start + mark.length + 500)
}

const overlapArea = (a: Rect, b: Rect): number =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))

/** Every word the drawing wrote, as the box the reader sees. */
const textBoxes = (list: DisplayList): Rect[] =>
  list.layers.flatMap((layer) => layer.items)
    .filter((item): item is DisplayItem & { kind: 'text' } => item.kind === 'text')
    .map((item) => measureRect(item.layout, item.at, item.anchor))

describe('the Plan View Range on the drawing (#74 §3)', () => {
  it('styles and orders the fixture exactly as criterion 1 enumerates', () => {
    const { list } = scene({ lowerMm: 0, upperMm: 1200 })
    const items = itemsOf(list, 'placed-items')

    // Below, then In range, then Above — the range group outermost inside the band, so the Sump box
    // paints under everything and the Wall cabinet over everything, whatever their placement order.
    expect([...new Set(items.map(idOf))]).toEqual(['item-sump-1', 'item-base-1', 'item-base-2', 'item-wall-1'])

    expect(paintsOf(items, 'item-sump-1')).toEqual(['faded'])
    expect(paintsOf(items, 'item-wall-1')).toEqual(['outline'])
    // In range is the normal graphics: no mark at all, not a mark that means "normal".
    expect(paintsOf(items, 'item-base-1')).toEqual([undefined])
    expect(paintsOf(items, 'item-base-2')).toEqual([undefined])

    // The labels follow their geometry: the sunk box's name is faded with it, the cabinet above the
    // section plane is outlined with it, and the two on the Floor are untouched.
    const labels = itemsOf(list, 'placed-item-labels').filter((label): label is DisplayItem & { kind: 'text' } => label.kind === 'text')
    const paintOfLabel = (id: string): RangePaint | undefined =>
      labels.find((label) => idOf(label) === id)?.paint
    expect(paintOfLabel('item-sump-1')).toBe('faded')
    expect(paintOfLabel('item-wall-1')).toBe('outline')
    expect(paintOfLabel('item-base-1')).toBeUndefined()

    // A Room has no Vertical Extent, so it is In range at any range and carries no mark.
    expect(paintsOf(itemsOf(list, 'rooms'), 'room-1')).toEqual([undefined])
    expect(paintsOf(itemsOf(list, 'walls'), 'wall-a')).toEqual([undefined])
    expect(paintsOf(itemsOf(list, 'wall-openings'), 'opening-1')).toEqual([undefined])
    expect(paintsOf(itemsOf(list, 'wall-openings'), 'opening-2')).toEqual(['outline'])
  })

  it('renders Above as a dashed outline with no fill and Below at the one faded opacity', () => {
    const svg = svgOf(scene({ lowerMm: 0, upperMm: 1200 }).list)
    const above = elementOf(svg, 'item-wall-1', 'placed-item')
    expect(above).toContain('fill="none"')
    expect(above).toContain('stroke-dasharray=')
    // The name of an Above-range cabinet is drawn in the colour its dashed outline is stroked in —
    // the entity's own colour, which is what `plan-label` already paints its glyphs with.
    expect(elementOf(svg, 'item-wall-1', 'item-label')).toContain('fill="#7c9cbf"')
    expect(elementOf(svg, 'item-sump-1', 'placed-item')).toContain(`opacity="${RANGE_FADED_OPACITY}"`)
    expect(elementOf(svg, 'item-sump-1', 'item-label')).toContain(`opacity="${RANGE_FADED_OPACITY}"`)
  })

  it('treats touching a boundary as touching it (criterion 2)', () => {
    // Wall cabinet #1 stands at 1500, so a range whose upper limit is 1500 does not include it.
    const touching = scene({ lowerMm: 0, upperMm: 1500 })
    expect(paintsOf(itemsOf(touching.list, 'placed-items'), 'item-wall-1')).toEqual(['outline'])
    // Ten millimetres more and the sole is inside: the same cabinet, drawn normally again.
    const inside = scene({ lowerMm: 0, upperMm: 1510 })
    expect(paintsOf(itemsOf(inside.list, 'placed-items'), 'item-wall-1')).toEqual([undefined])
  })

  it('hides nothing and changes no pickability (criterion 8)', () => {
    const plain = scene(null)
    const { list, ...pickable } = scene({ lowerMm: 1600, upperMm: 1700 })
    // At 1600–1700 the cabinets are Below and the Wall cabinet is Above and the Sump box is Below:
    // not one entity of the Floor is In range, and not one of them has stopped being drawn.
    for (const id of ['wall-a', 'wall-b', 'wall-c', 'wall-d', 'opening-1', 'opening-2', 'room-1', ...PLACEMENTS.map((p) => p.id)]) {
      expect(list.layers.some((band) => band.items.some((item) => idOf(item) === id)), id).toBe(true)
    }
    // And the collections a canvas picks against are the same collections, entity for entity.
    expect(pickable).toEqual({
      floor: plain.floor,
      walls: plain.walls,
      rooms: plain.rooms,
      openings: plain.openings,
      omittedLabels: plain.omittedLabels,
    })
    // A hit shape is not ink: taking its fill away would take the entity out of the pick set, so the
    // row a range marks is the row that carries paint — `opening-hit` and its two siblings come back
    // from the same mark unchanged, and WND-2 is still clickable above the section plane.
    expect(rangeStyle('outline', resolveStyle('opening-hit'), 'path')).toEqual(resolveStyle('opening-hit'))
    expect(rangeStyle('outline', resolveStyle('room-hit'), 'path')).toEqual(resolveStyle('room-hit'))
    expect(rangeStyle('outline', resolveStyle('opening'), 'path')).not.toEqual(resolveStyle('opening'))
  })

  it('never lets two labels of the fixture scene overlap (#74 §3)', () => {
    const boxes = textBoxes(scene({ lowerMm: 0, upperMm: 1200 }).list)
    expect(boxes.length).toBeGreaterThan(4)
    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) expect(overlapArea(a, b)).toBe(0)
    }
  })

  it('omits a label that has no clean candidate and hands it to the hover list', () => {
    // Eighty cabinets on one point: the placer has sixty-nine candidates for a name — its box on the
    // entity, the entity's four faces, and four rings of sixteen — so the pile cannot all be named.
    const crowded = Array.from({ length: 80 }, (_, index) =>
      place(`item-crowded-${index}`, 'design-base', 1500, 1200, 0))
    const { list, omittedLabels } = scene({ lowerMm: 0, upperMm: 1200 }, crowded)
    const drawn = itemsOf(list, 'placed-item-labels')
    expect(omittedLabels.length).toBeGreaterThan(0)
    expect(drawn.length + omittedLabels.length).toBe(80)
    // An omitted label is not drawn and not lost: it says which entity it names and where it belongs.
    for (const omitted of omittedLabels) {
      expect(omitted.ref.role).toBe('item-label')
      expect(omitted.text).toBe('Base cabinet')
      expect(drawn.some((label) => idOf(label) === omitted.ref.id)).toBe(false)
    }
    // The range is not what crowded them out: the same pile drawn with no range at all omits the
    // very same names, because a range changes how a thing is drawn and never where its name goes.
    expect(scene(null, crowded).omittedLabels).toEqual(omittedLabels)
  })

  it('keeps a renovation overlay drawing its own dash over the range (#70 criterion 8)', () => {
    // The overlays are #70's and they sit on top of the range's mark: a demolished Wall Above the
    // section plane is still dashed the way demolition is dashed, and a proposed one still haloed.
    // `rangeStyle` supplies a dash only where the row had none, so both keep their own rhythm.
    for (const key of ['renovation-demolition', 'renovation-halo'] as const) {
      const row = resolveStyle(key)
      expect(rangeStyle('outline', row, 'path')).toEqual({ ...row, fill: 'none' })
      expect(rangeStyle('faded', row, 'path').dash).toEqual(row.dash)
    }
  })
})

/**
 * The Elevation View's display list (#75 §4, criteria 12–15).
 *
 * The projection is already done — `derive` handed over the rows, each with the band it covers along
 * the view line, the height it stands at and how far behind the view line it is. What is decided here
 * is what a picture needs and nothing else: which way round the drawing faces, what paints over what,
 * which heights get words, and what the ruler looks like.
 *
 * **Which way round.** The horizontal coordinate is `(p − start)·u`, shown left to right as a viewer
 * looking along `n` sees it. That viewer's right hand is `(n.y, −n.x)`, which for a view looking to
 * its `left` is `−u`: the drawing is mirrored, and `s = 0` lands at the right-hand edge. Looking to
 * the `right`, the viewer's right hand is `+u` and nothing moves. The rows keep the raw `s` — a
 * canvas that picks against them and a canvas that paints them must be able to agree, and the mirror
 * is a property of this one picture.
 *
 * **What paints over what.** Farther content first, then nearer content over it, where an entity's
 * distance is the least `(p − start)·n` the prism holds. Two entities at the same distance follow
 * their Drawing Layers, then their IDs — except that an Opening paints after the Wall it is cut in,
 * which is what makes it read as a hole in that Wall rather than a box beside it: an Opening's band is
 * its host's band, so the two tie on distance and would otherwise be separated by nothing but an ID.
 *
 * **What is not here.** No Rooms and no Plan Image (decision 3, criterion 11) — `derive` already left
 * them out. No Plan View Range: an Elevation View has no cut plane, so nothing is faded or outlined
 * for being above or below one (#74 §3). And no handles, ghosts or chips: those are the surface's,
 * drawn above this list.
 */
import type { ElevationRow, ElevationScene } from '../derive'
import type { Pt } from '../geometry'
import { layoutText, measureRect } from './font/layoutText'
import { mmText } from './format'
import { roundedRectCommands } from './path'
import type { LayerGates } from './floorView'
import { resolveSize } from './styles'
import type { DisplayItem, DisplayList, PathCommand, Rect, Sizing, StyleKey } from './types'

/** What an Elevation View needs that is not the projection: the paper, and the view's own gates. */
export interface ElevationViewOptions {
  sizing: Sizing
  /** The saved view's Drawing Layer gates (#71 §4), or `null` when nothing is hidden or recoloured. */
  layers?: LayerGates | null
  /** The selected entity, drawn with the selected weight the plan gives it. */
  selectedId?: string | null
  /** The ruler's step in millimetres; 500 is the one a room's height reads in without crowding. */
  rulerStepMm?: number
  /**
   * The drawing's own scale: `1` on a screen, `1 / 50` on a 1:50 sheet (#61 §2).
   *
   * A Plan View's geometry is shrunk before it is drawn, because its input is a whole derived Floor
   * and the sheet needs the same shrink everywhere at once. An Elevation View's input is one small
   * frame, and shrinking it would shrink the heights the ruler and the Datum lines have to *name* —
   * a sheet whose ruler read `52` where the room measures 2600 is the mistake a reader cannot catch
   * with a tape. So the coordinates go down here and the words stay up, through `formatHeight`.
   */
  scale?: number
  /** How a height is written: millimetres by default, the recipe's unit and precision on a sheet. */
  formatHeight?: (mm: number) => string
}

/** The assembled list, and the rows as they were actually painted. */
export interface ElevationDrawing {
  /** What to paint: one band in painter's order, then the heights, then the ruler. */
  readonly list: DisplayList
  /**
   * The rows this view drew, farthest first — the painter's own order, gates applied.
   *
   * A canvas picks against these and not against what `derive` handed over: content this view hides
   * is not a target for a click (#71 §4). Reversed, it is the nearest-first order click-to-cycle
   * wants, which is what feeds #74's `cycleOrder` with an Elevation View's distances (#75 §4).
   */
  readonly rows: readonly ElevationRow[]
  /** The drawn area in the drawing's own millimetres: `0 ≤ x ≤ length`, the projected heights in `y`. */
  readonly area: Rect
  /**
   * The height the drawing's `y = 0` stands at, in millimetres above the Floor Datum.
   *
   * The picture's y grows downward from here, so a canvas that reads a pointer back as a height — the
   * handles, the drag, the snap — converts with `z = topMm − y / scale`. At the screen's scale of 1 that
   * is a subtraction and nothing else.
   */
  readonly topMm: number
}

/** How far the ruler's spine stands off the drawing, and how far its ticks and words off the spine. */
const GUTTER_MM = 6
const TICK_MM = 4
const WORD_MM = 3
/** The gap a height's words keep to the line they name, and to the edge of the drawing. */
const LABEL_MM = 4

/**
 * The painter's tie-break after distance: a Beam, then a Wall, then what is cut in it, then what
 * stands on its face, then what stands before it. A Beam is documentation drawn under the Wall that
 * stands on it, so at one distance it paints first and the Wall covers it (#77 §4); a Skirting
 * stands on the face, so it paints over the Wall it leans on and under the cabinet in front (#78 §7).
 */
const KIND_RANK: Record<ElevationRow['kind'], number> = { beam: 0, wall: 1, opening: 2, skirting: 3, item: 4 }

/** The rectangle one row covers, in the drawing's own millimetres. */
const boxOf = (row: ElevationRow, xOf: (s: number) => number, zOf: (z: number) => number): Rect => {
  const left = Math.min(xOf(row.sMin), xOf(row.sMax))
  const right = Math.max(xOf(row.sMin), xOf(row.sMax))
  return { x: left, y: Math.min(zOf(row.zMin), zOf(row.zMax)), w: right - left, h: Math.abs(zOf(row.zMax) - zOf(row.zMin)) }
}

const outlineOf = (box: Rect): PathCommand[] => [
  { k: 'M', to: { x: box.x, y: box.y } },
  { k: 'L', to: { x: box.x + box.w, y: box.y } },
  { k: 'L', to: { x: box.x + box.w, y: box.y + box.h } },
  { k: 'L', to: { x: box.x, y: box.y + box.h } },
]

/** The style one row is drawn in: its family, and the selected weight when it is the selected one. */
const styleOf = (row: ElevationRow, selected: boolean): StyleKey => {
  if (selected) return row.kind === 'item' ? 'plan-item:selected' : row.kind === 'skirting' ? 'skirting:selected' : 'wall:selected'
  if (row.kind === 'opening') return 'opening'
  if (row.kind === 'beam') return 'beam'
  if (row.kind === 'skirting') return 'skirting'
  return row.kind === 'item' ? 'plan-item' : 'wall'
}

/** One horizontal height line across the whole drawing, with the words that name it. */
function heightLine(
  z: number,
  label: string,
  style: StyleKey,
  layout: { width: number; ascent: number; descent: number },
  area: Rect,
  sizing: Sizing,
): DisplayItem[] {
  // The words stand just above the line they name: above is a smaller y, because the picture's y grows
  // downward from its highest height.
  const at: Pt = { x: area.x + LABEL_MM, y: z - LABEL_MM - layout.ascent / 2 }
  // And they stand on a card. The line they name runs through the drawing, a height's words are the ink
  // of the drawing itself, and a Wall's face is filled with that same ink — words laid straight onto the
  // picture are the colour of the thing behind them and read as nothing. The card the app already puts
  // behind a word that has to survive anything is the answer here too, because it is a shape: it holds
  // on a screen, on a sheet, and in a PDF, where stroking the glyphs themselves is not something a text
  // operator can do.
  const height = layout.ascent + layout.descent
  const corner = resolveSize('plan-chip-corner', sizing).mm
  const box: Rect = {
    x: at.x - LABEL_MM,
    y: at.y - height / 2 - LABEL_MM,
    w: layout.width + 2 * LABEL_MM,
    h: height + 2 * LABEL_MM,
  }
  return [
    {
      kind: 'path',
      segments: [
        { k: 'M', to: { x: area.x, y: z } },
        { k: 'L', to: { x: area.x + area.w, y: z } },
      ],
      closed: false,
      style,
    },
    {
      kind: 'path',
      segments: roundedRectCommands(box.x, box.y, box.w, box.h, Math.min(corner, box.w / 2, box.h / 2)),
      closed: true,
      style: 'plan-chip-box',
    },
    {
      kind: 'text',
      text: label,
      at,
      anchor: 'start',
      baseline: 'middle',
      rotationDeg: 0,
      role: 'label',
      style: 'elevation-label',
      layout,
    },
  ]
}

/**
 * Everything one Elevation View paints.
 *
 * `scene` comes from `derive`'s `elevationScene`; nothing here reads the Project, so the same rows
 * give the same pixels on the screen and on a sheet, which is what makes criterion 15's golden a
 * statement about one function rather than about two surfaces.
 */
export function drawElevationView(scene: ElevationScene, options: ElevationViewOptions): ElevationDrawing {
  const { sizing, layers = null, selectedId = null } = options
  const step = options.rulerStepMm ?? 500
  const k = options.scale ?? 1
  const height = options.formatHeight ?? mmText
  // A viewer looking along `n` has their right hand at (n.y, −n.x): on the left that is −u, so the
  // drawing is mirrored and the view line's own start is on the right.
  const xOf = (s: number): number => k * (scene.frame.side === 'left' ? scene.length - s : s)

  // A Skirting is a finish on a face, not a thing standing in the band: its own `distance` is the
  // host face's, a few tens of millimetres in front of the cut through the Wall, and painting by
  // that alone buries the strip under the Wall it is skirted to — invisible and unpickable. It
  // therefore takes its host Wall's depth and `KIND_RANK` puts it over the Wall it stands on.
  const wallDepth = new Map(scene.rows.filter((row) => row.kind === 'wall').map((row) => [row.id, row.distance]))
  const depthOf = (row: ElevationRow): number =>
    row.kind === 'skirting' && row.hostWallId !== null ? wallDepth.get(row.hostWallId) ?? row.distance : row.distance

  const painted = scene.rows
    .filter((row) => layers === null || layers.drawn(row.id))
    .slice()
    .sort(
      (a, b) =>
        depthOf(b) - depthOf(a) ||
        KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
        (layers === null ? 0 : layers.orderOf(a.id) - layers.orderOf(b.id)) ||
        (a.id < b.id ? -1 : 1),
    )

  // Every height the picture holds: the Datum, the Floor's own limits, and the bottom and top of each
  // row. Read first, because the vertical mapping is stated from the top of the picture.
  const limits = scene.floor?.limits
  const lower = limits?.lowerMm ?? null
  const upper = limits?.upperMm ?? null
  const heights = [0, ...painted.flatMap((row) => [row.zMin, row.zMax])]
  if (lower !== null) heights.push(lower)
  if (upper !== null) heights.push(upper)
  const lowMm = Math.min(...heights)
  const highMm = Math.max(...heights)

  /**
   * Floor-relative Z to the drawing's y.
   *
   * A Floor stands on its Datum and a reader looks up at it, so the highest height is at the top of the
   * picture and y grows downward — the same way a Plan View's y is the Floor's y, and for the same
   * reason: the Display List is drawn into a screen and onto a sheet, both of which have y going down.
   * Measuring from `highMm` rather than negating Z keeps the list's own bounds at y = 0, which is what
   * `fitViewport` and the sheet's frame both assume.
   */
  const zOf = (z: number): number => k * (highMm - z)

  const content: DisplayItem[] = []
  for (const row of painted) {
    const box = boxOf(row, xOf, zOf)
    const ref = { id: row.id, role: row.kind === 'opening' ? 'wall-opening' : row.kind === 'item' ? 'placed-item' : row.kind === 'beam' ? 'beam' : row.kind === 'skirting' ? 'skirting' : 'wall' }
    // A Drawing Layer's own colour wins over the entity's, exactly as it does in a Plan View: the
    // layer says what the drawing is *about*, and the entity's colour is what it would otherwise be.
    const colour = (layers === null ? null : layers.colorOf(row.id)) ?? row.color
    content.push({
      kind: 'path',
      ref,
      segments: outlineOf(box),
      closed: true,
      style: styleOf(row, row.id === selectedId),
      ...(colour === null ? {} : { color: colour }),
    })
    // The heavier outline token, laid over the body rather than replacing it: the fill stays the
    // entity's own, so a crossed Wall is still the same Wall, only in the viewer's way.
    if (row.crossesLine) content.push({ kind: 'path', ref, segments: outlineOf(box), closed: true, style: 'elevation-crossing' })
  }

  // The drawn area: the view line's own length across, and every height the rows and the Floor's own
  // heights reach, so a ruler tick or a Datum line is never drawn outside the picture.
  const area: Rect = { x: 0, y: zOf(highMm), w: k * scene.length, h: zOf(lowMm) - zOf(highMm) }

  const labelSize = resolveSize('plan-label', sizing).mm
  const lines: DisplayItem[] = []
  // Each line's words are measured for themselves: the box the words stand on, the height they are
  // centred at and the extent the picture is fitted to all come from that one measurement, so
  // measuring a different string than the one drawn undershoots all three.
  const name = (z: number, text: string, style: StyleKey): void => {
    lines.push(...heightLine(zOf(z), text, style, layoutText(text, labelSize), area, sizing))
  }
  name(0, `Floor Datum ${height(0)}`, 'elevation-datum')
  if (upper !== null) name(upper, `Upper limit ${height(upper)}`, 'elevation-limit')
  if (lower !== null) name(lower, `Lower limit ${height(lower)}`, 'elevation-limit')

  // The ruler, outside the drawing area on the left: its spine, its ticks and its words all stand at
  // x < 0, so no label of its own can ever land on content, whatever the content is.
  const rulerSize = resolveSize('plan-dimension', sizing).mm
  const spine = area.x - GUTTER_MM
  const stops: number[] = []
  for (let z = Math.ceil(lowMm / step) * step; z <= highMm; z += step) stops.push(z)
  const words = stops.map((z) => height(z))
  // One column of words, all of them right-aligned against the ticks: measuring the widest once is
  // what keeps `2600` and `0` in one line instead of a ragged one.
  const widest = Math.max(0, ...words.map((word) => layoutText(word, rulerSize).width))
  const ticks: DisplayItem[] = [
    {
      kind: 'path',
      segments: [
        { k: 'M', to: { x: spine, y: zOf(highMm) } },
        { k: 'L', to: { x: spine, y: zOf(lowMm) } },
      ],
      closed: false,
      style: 'elevation-ruler',
    },
  ]
  stops.forEach((stop, index) => {
    const z = zOf(stop)
    ticks.push({
      kind: 'path',
      segments: [
        { k: 'M', to: { x: spine, y: z } },
        { k: 'L', to: { x: spine - TICK_MM, y: z } },
      ],
      closed: false,
      style: 'elevation-ruler',
    })
    const layout = layoutText(words[index]!, rulerSize)
    ticks.push({
      kind: 'text',
      text: words[index]!,
      at: { x: spine - TICK_MM - WORD_MM - widest, y: z },
      anchor: 'start',
      baseline: 'middle',
      rotationDeg: 0,
      role: 'dimension',
      style: 'plan-dimension',
      layout,
    })
  })

  const bands = new Map<string, DisplayItem[]>([
    ['elevation-content', content],
    ['elevation-datum', lines],
    ['elevation-ruler', ticks],
  ])
  // The extent is every box the drawing actually holds, not the drawing area: the ruler's words stand
  // off to the left of it and a height's words reach above the top line, and a list whose bounds
  // clipped its own ink would be cropped by anything that trusts them.
  let bounds = area
  const grow = (box: Rect): void => {
    const right = Math.max(bounds.x + bounds.w, box.x + box.w)
    const top = Math.max(bounds.y + bounds.h, box.y + box.h)
    bounds = {
      x: Math.min(bounds.x, box.x),
      y: Math.min(bounds.y, box.y),
      w: right - Math.min(bounds.x, box.x),
      h: top - Math.min(bounds.y, box.y),
    }
  }
  for (const item of [...content, ...lines, ...ticks]) {
    // Every command of these paths is a straight line, so the corners are the whole extent.
    if (item.kind === 'path') {
      const xs = item.segments.map((command) => command.to.x)
      const ys = item.segments.map((command) => command.to.y)
      grow({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) })
    } else if (item.kind === 'text') {
      grow(measureRect(item.layout, item.at, item.anchor))
    }
  }
  const list: DisplayList = {
    space: 'floor',
    bounds,
    layers: (['elevation-content', 'elevation-datum', 'elevation-ruler'] as const).map((key) => ({ key, items: bands.get(key) ?? [] })),
    missingGlyphs: [],
  }
  return { list, rows: painted, area, topMm: highMm }
}

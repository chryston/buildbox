/**
 * The display list: the one description of what a drawing looks like (#60, #20 §9).
 *
 * The Plan View and the Item Detail used to answer that question twice, in JSX, with the
 * colour and the `/ zoom` arithmetic written out at each site — which is how the two drifted
 * apart in the first place. A display list answers it once, in millimetres, as data: a
 * z-ordered list of paths, text and images in which every colour and every width is a *key*
 * into `styles.ts` rather than a literal. One list can therefore be drawn on a screen at
 * 0.4 px per millimetre and on paper at 1:20 without either renderer owning a number.
 *
 * Nothing here is a colour, a size or a DOM node: those are `styles.ts` and `svg.ts`. This
 * file is the vocabulary only, so that `export` (#62) and the two on-screen surfaces are
 * reading the same answer rather than a copy of it.
 */
import type { Affine } from '../derive'
import type { Pt } from '../geometry'

/**
 * The domain entity a drawn shape came from, and which part of it: `{ id: voidNodeId,
 * role: 'void' }`. The renderer writes it into `data-ref` when the caller asks for it, so a
 * hit test recovers the entity the user actually pressed on instead of guessing from a
 * coordinate.
 */
export type Ref = { readonly id: string; readonly role: string }

/**
 * An axis-aligned box in millimetres.
 *
 * `geometry` measures a path as a `Bounds` of two corners, which is what the kernel wants;
 * a box that is *drawn* or *avoided* — a display list's extent, the label placer's
 * obstacle — is an origin and a size, which is the shape both `svg.ts` and `labels.ts`
 * want and the shape `DisplayList.bounds` reports.
 */
export type Rect = {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/**
 * Every layer the two surfaces can draw, and nothing else.
 *
 * #60 §3: the z-order is a property of the vocabulary, not of a renderer. A later issue that
 * wants a new band — #66's warning badge, #69's elevation marks — inserts a key here and in
 * `LAYER_ORDER`, and every surface picks it up because there is no other mechanism.
 *
 * The three Plan View bands that sit between the footprints and the labels are not
 * decorations. `plan-annotations` is the Item Origin crosshairs, which draw after the
 * footprints they sit on and before the measurements that point at them; `plan-dimensions` is
 * the selected placement's dimension lines *and* their two texts, one band because a line and
 * the number over it are one measurement and one is meaningless without the other; and
 * `plan-chip` is the `Floor bounds` chip, which is the last thing drawn because it is the one
 * thing that must always be readable.
 */
export type LayerKey =
  | 'plan-image'
  /** The optional model grid #61 draws under a drawing when the recipe asks for one. */
  | 'sheet-grid'
  /** The Room areas themselves (#67 behaviour 35): named Floor, drawn under every Wall band,
      because a Wall stands on a Room's boundary and not the other way round. */
  | 'rooms'
  /** The Beam bodies (#77 §4): documentation of what is already there, so they paint under the
      Walls that stand on them and never over a footprint. */
  | 'beams'
  /** The Wall bands themselves (#64 §15): Building Elements, drawn under the footprints. */
  | 'walls'
  /** The symbols inside a Wall's gaps (#65 §12), above the band they are cut into. */
  | 'wall-openings'
  /** The Skirting strips (#78 §7): a 15 mm band standing on a Wall face, so it paints over the Wall
      band it leans on and under the footprint of the cabinet standing in front of it. */
  | 'skirtings'
  /** The Service bodies (#79 §6): a band along a centreline or a Riser's circle, painted over the
      Walls a pipe passes through and under the footprint of the cabinet it clashes with. */
  | 'services'
  | 'placed-items'
  | 'plan-annotations'
  | 'placed-item-labels'
  /** The `W-n` references (#64 §15), in the same untransformed text half as the item labels. */
  | 'wall-labels'
  /** The Beam names (#77 §4), after the Wall references: a `Beam B-1` is the shorter string and a
      Wall reference is the one a reader follows along a run. */
  | 'beam-labels'
  /** The Skirting names (#78 §7), after the Beam names: a strip is the shorter string of the two and
      the one a reader finds by following the Wall it stands on. */
  | 'skirting-labels'
  /** The Service names (#79 §6), after the Skirting names: `W Ø50` is the shortest string on the
      drawing and the one a reader looks for by following the pipe it sits on. */
  | 'service-labels'
  /** The `Kitchen · 13.08 m²` labels (#67 behaviour 35), after the Wall references because a
      Room's name is the longer string and the one a person is looking for. */
  | 'room-labels'
  | 'plan-dimensions'
  | 'plan-chip'
  | 'plan-handle'
  /** The `!` badges of open warnings (#66 §14): the last band, because a warning is the one
      thing on the canvas that must never be hidden behind a footprint or a label. */
  | 'plan-warning-badges'
  | 'cabinet-units'
  | 'cabinet-panels'
  | 'cabinet-voids'
  | 'cabinet-dividers'
  | 'cabinet-accessories'
  | 'cabinet-dimensions'
  | 'cabinet-marks'
  | 'item-footprint'
  | 'item-labels'
  /** The bodies of an Elevation View, in painter's order: farthest first (#75 §4). */
  | 'elevation-content'
  /** The Floor Datum and Vertical Extent limit lines, and the words on them (#75 §4). */
  | 'elevation-datum'
  /** The millimetre ruler, which sits outside the drawing area and so over nothing in it (#75 §4). */
  | 'elevation-ruler'
  /** The title block, footer and scale bar #61 composes around a drawing, drawn last. */
  | 'sheet-furniture'

/**
 * THE single z-order source (#60 §3): the order the `<g>` bands are emitted in, back to
 * front. `toSvgTree` walks a list's own `layers`, so a builder that leaves a layer out
 * simply draws nothing there — but it may not reorder these keys, and no renderer may sort
 * them again.
 *
 * The order reproduces what `PlanViewCanvas` draws today: inside the viewport matrix, image →
 * footprints → origin markers → dimension lines; in the untransformed text layer above it,
 * item labels → dimension texts → chip. `plan-dimensions` spans both halves because the
 * renderer already splits paths from text into separate groups, and each half keeps its
 * relative order within the band.
 */
export const LAYER_ORDER: readonly LayerKey[] = [
  'plan-image',
  'sheet-grid',
  'rooms',
  'beams',
  'walls',
  'wall-openings',
  'skirtings',
  'services',
  'placed-items',
  'plan-annotations',
  'placed-item-labels',
  'wall-labels',
  'beam-labels',
  'skirting-labels',
  'service-labels',
  'room-labels',
  'plan-dimensions',
  'plan-chip',
  'plan-handle',
  'cabinet-units',
  'cabinet-panels',
  'cabinet-voids',
  'cabinet-dividers',
  'cabinet-accessories',
  'cabinet-dimensions',
  'cabinet-marks',
  'item-footprint',
  'item-labels',
  'elevation-content',
  'elevation-datum',
  'elevation-ruler',
  'sheet-furniture',
  'plan-warning-badges',
]

/**
 * One drawing command, in the same millimetre frame as the rest of the list.
 *
 * `A` is a circular arc and `E` an elliptical one, both spelled the way SVG spells them so
 * `svg.ts` writes them out without re-deriving a flag. `largeArc` and `sweep` are already
 * resolved booleans: `path.ts` decides them once from the kernel's signed sweep, and every
 * consumer — screen, paper, Backup preview — gets the same curve.
 */
export type PathCommand =
  | { readonly k: 'M' | 'L'; readonly to: Pt }
  | {
      readonly k: 'A'
      readonly to: Pt
      readonly r: number
      readonly largeArc: boolean
      readonly sweep: boolean
    }
  | {
      readonly k: 'E'
      readonly to: Pt
      readonly rx: number
      readonly ry: number
      readonly xRotDeg: number
      readonly largeArc: boolean
      readonly sweep: boolean
    }

/**
 * A paint: a CSS colour literal, `'none'`, or `'item'` for the drawn thing's own colour.
 *
 * `'item'` is the only indirection a style may have, and it is what lets `plan-item` be one
 * row for every Placed Item while each still wears its Item Design's colour.
 */
export type Paint = string

/** What a piece of text is for, which is how a renderer styles a whole class at once. */
export type TextRole = 'label' | 'dimension' | 'chip' | 'space-label' | 'badge'

/** Where text sits against its `x`: its left edge, its centre, or its right edge. */
export type TextAnchor = 'start' | 'middle' | 'end'

/** How text sits against its `y`: on the baseline, vertically centred, or hanging below. */
export type TextBaseline = 'alphabetic' | 'middle' | 'hanging'

/**
 * Every row of `STYLES`, spelled out here rather than derived from it.
 *
 * The union is written by hand and the table is typed `Record<StyleKey, Style>`, so a row
 * missing from the table is a type error and a row missing from the union is one too. The
 * alternative — deriving the union from the table — would let a typo in a row become a
 * legal key nobody asked for.
 */
export type StyleKey =
  | 'plan-item'
  | 'plan-item:selected'
  /** A Wall's tidied band: filled, with its own outline (#64 §15). */
  | 'wall'
  | 'wall:selected'
  /** One of the band's two faces, the line every tool snaps to. */
  | 'wall-face'
  /**
   * A Room's area: named Floor, so lighter than the Wall standing on its edge (#67 behaviour
   * 35). The fill is what makes a Room a region rather than a polygon someone drew.
   */
  | 'room'
  | 'room:selected'
  /** The Room being drawn or edited right now: the accent while it is valid (#67 behaviour 21). */
  | 'room:proposal'
  /** …and the danger colour the moment it overlaps another Room. Red, never orange. */
  | 'room:proposal-blocked'
  /**
   * The region two Rooms share (#67 behaviour 20): painted red and outlined with a dash,
   * because the eye has to find the part that is wrong rather than the whole shape.
   */
  | 'room-overlap'
  /** The Room's own area again, filled with nothing the eye can see and everything a pointer
      needs: the outline is a hairline, and a hairline is a hard thing to click (#65 §11). */
  | 'room-hit'
  /** The badge on an Edge that claims a Wall face: a filled diamond, the same size at any zoom,
      because it marks a place on the drawing and not a place in the Flat (#67 §12). */
  | 'room-anchor'
  /** `Kitchen · 13.08 m²`, and the one smaller size it is allowed to shrink to. */
  | 'room-label'
  | 'room-label:min'
  /** The line from a label that could not be fitted inside to the Room it names. */
  | 'room-label-leader'
  /** The Beam body, its invisible target and its name (#77 §4). */
  | 'beam'
  | 'beam:selected'
  | 'beam-hit'
  | 'beam-label'
  /** The Skirting strip, its invisible target and its name (#78 §7). */
  | 'skirting'
  | 'skirting:selected'
  | 'skirting-hit'
  | 'skirting-label'
  /** The Service body, its invisible target and its name (#79 §6). */
  | 'service'
  | 'service:selected'
  | 'service-hit'
  | 'service-label'
  /** The leaf, panels or window mullion of an Opening — the part a click selects (#65 §12). */
  | 'opening'
  | 'opening:selected'
  | 'opening:preview'
  | 'opening:preview-blocked'
  | 'opening-gap-mark'
  /**
   * The Opening's own footprint, filled with nothing the eye can see and everything a pointer
   * needs: the marks are hairlines, and a hairline is a hard thing to click (#65 §11).
   */
  | 'opening-hit'
  /** The quarter-circle a hinged door swings through: a hint of floor area, never a click. */
  | 'opening-swing'
  /** A window's three lines, drawn thinner than the Wall they sit in. */
  | 'opening-window-line'
  /** The two dashed lines that say a section of this Wall is simply gone. */
  | 'opening-removed'
  | 'plan-label'
  | 'plan-dimension'
  | 'plan-dimension-line'
  /** The heavier outline token: content the view line itself runs through (#75 §4). */
  | 'elevation-crossing'
  /** The Floor Datum's line, dashed like every other height that was not drawn (#75 §4). */
  | 'elevation-datum'
  /** A Floor's own lower or upper limit, dashed and one weight lighter than the Datum. */
  | 'elevation-limit'
  /** The ruler's spine and ticks, outside the drawing area (#75 §4). */
  | 'elevation-ruler'
  /** The words that name a height, in the drawing's own ink (#75 §4). */
  | 'elevation-label'
  | 'plan-chip-box'
  | 'plan-chip-text'
  | 'plan-origin'
  | 'plan-origin:preview'
  | 'plan-origin-dot'
  | 'plan-origin-dot:preview'
  | 'plan-rotate-stem'
  | 'plan-handle'
  | 'plan-warning-badge'
  | 'plan-warning-badge-text'
  | 'plan-warning-badge-leader'
  | 'plan-placeholder'
  /** The demolition overlay: a dashed outline in the demolition colour, hatched inside (#70 §F). */
  | 'renovation-demolition'
  /** The 45° hatching itself, one hairline per diagonal. */
  | 'renovation-hatch'
  /** The proposed overlay: a dashed halo outside the outline, in the proposed colour. */
  | 'renovation-halo'
  | 'cabinet-panel-oak'
  | 'cabinet-panel-walnut'
  | 'cabinet-panel-white'
  | 'cabinet-panel-birch'
  | 'cabinet-panel-mdf'
  | 'cabinet-void'
  | 'cabinet-void:selected'
  | 'cabinet-divider'
  | 'cabinet-divider-oak'
  | 'cabinet-divider-walnut'
  | 'cabinet-divider-white'
  | 'cabinet-divider-birch'
  | 'cabinet-divider-mdf'
  | 'cabinet-divider-oak:selected'
  | 'cabinet-divider-walnut:selected'
  | 'cabinet-divider-white:selected'
  | 'cabinet-divider-birch:selected'
  | 'cabinet-divider-mdf:selected'
  | 'cabinet-unit-hit'
  | 'cabinet-unit-active'
  | 'cabinet-drawer-frame'
  | 'cabinet-drawer-pull-dot'
  | 'cabinet-door'
  | 'cabinet-drawer-front'
  | 'cabinet-pull'
  | 'cabinet-hinge'
  | 'cabinet-dimension'
  | 'cabinet-dimension:locked'
  | 'cabinet-space-label'
  | 'cabinet-lock-mark'
  | 'cabinet-unlock-mark'
  | 'item-footprint'
  | 'item-label'
  // The sheet furniture #61's export composes: the frame and rules of a title block, its text,
  // the fixed footer, and a scale bar. These are rows and not literals for the same reason a
  // cabinet's outline is: the writers of three formats read them, and two of them disagree about
  // what a colour is.
  | 'sheet-frame'
  | 'sheet-rule'
  | 'sheet-title'
  | 'sheet-label'
  | 'sheet-value'
  | 'sheet-footer'
  | 'sheet-scale'
  | 'sheet-grid'

/**
 * Every row of `SIZE_ROLES`.
 *
 * A role names a *thing that has a size* — the plan's label text, a cabinet's outline — and
 * never a number, which is the whole reason one display list can be drawn at two scales. A
 * distance the drawing lays itself out by is a role too: how far outside a footprint a
 * dimension line runs is as much a size as the stroke that draws it, and more so, because it
 * decides where the text lands.
 */
export type SizeRole =
  | 'plan-label'
  /** The smallest a Room label is allowed to get before it moves instead (#67 behaviour 35). */
  | 'room-label-min'
  /** The badge marking an Edge that claims a Wall face (#67 §12). */
  | 'room-anchor'
  | 'plan-dimension'
  | 'plan-chip'
  | 'plan-dim-offset'
  | 'plan-dim-gap'
  | 'plan-dim-tick'
  | 'plan-chip-height'
  | 'plan-chip-char'
  | 'plan-origin-line'
  | 'plan-origin-arm'
  | 'plan-origin-dot'
  | 'plan-handle-reach'
  | 'plan-handle-r'
  | 'plan-handle-stroke'
  | 'plan-warning-badge'
  | 'plan-warning-badge-text'
  | 'cabinet-dimension'
  | 'cabinet-space-label'
  | 'cabinet-lock-icon'
  | 'plan-line'
  | 'plan-line-selected'
  | 'hairline'
  /** The width of an invisible hit target's stroke (#78 §7). */
  | 'hit-target'
  /** The dash and the gap of a removed section's lines (#65 §12). */
  | 'opening-dash'
  | 'opening-gap'
  /** The renovation overlays' dash and gap, and the two distances they are drawn at (#70 §F). */
  | 'renovation-dash'
  | 'renovation-gap'
  /**
   * The dash and the gap of an Above-range outline (#74 §3). Longer than a renovation's because
   * it runs round a whole footprint that the reader has to recognise through the dashes alone,
   * and shorter than a removed section's because it is not standing in for a gap.
   */
  | 'range-dash'
  | 'range-gap'
  | 'renovation-halo-gap'
  | 'renovation-hatch-pitch'
  | 'plan-placeholder-line'
  | 'cabinet-outline'
  | 'cabinet-outline-bold'
  | 'cabinet-outline-medium'
  | 'cabinet-active'
  | 'cabinet-active-dash'
  | 'cabinet-active-gap'
  | 'cabinet-outline-dash'
  | 'cabinet-outline-gap'
  | 'cabinet-corner'
  | 'cabinet-corner-small'
  | 'plan-chip-corner'
  | 'sheet-rule'
  | 'sheet-title'
  | 'sheet-label'
  | 'sheet-footer'

/**
 * One column of a `SIZE_ROLES` row: `{ px }` is a device-pixel floor that a zoom defeats,
 * `{ mm }` is a real-world size that a zoom reveals, and `{ px, mm }` is the larger of the
 * two — the legacy canvas's `Math.max(12 / zoom, 8)`.
 */
export type SizeSpec =
  | { readonly px: number; readonly mm?: number }
  | { readonly mm: number }

/**
 * A size in both sizing modes.
 *
 * The screen column reproduces what the legacy canvas drew at a given zoom; the paper column
 * is what the same thing measures on a printed sheet, which is the only column #62's export
 * reads. Both are here because a role that reads well on a screen at 12 px is 2.5 mm on
 * paper, and neither number belongs at a call site.
 */
export type SizeRow = { readonly screen: SizeSpec; readonly paper: SizeSpec }

/**
 * One resolved length.
 *
 * `mm` is the answer the drawing works in; `px` is the same length in the device or sheet
 * units it came from, kept only so a renderer that still thinks in pixels can skip the
 * multiply. In screen mode `px` is `mm * pxPerMm`; in paper mode it is `mm * scale`, the
 * millimetres of ink a millimetre of model becomes on the sheet.
 */
export type ResolvedSize = { mm: number; px: number }

/**
 * How big a millimetre is right now: on a screen, by the zoom in pixels per millimetre; on
 * paper, by the drawing scale, where `0.05` is 1:20.
 */
export type Sizing = { kind: 'screen'; pxPerMm: number } | { kind: 'paper'; scale: number }

/** What every drawing function is told about the surface it is drawing for (#60 §4). */
export type DrawOptions = { sizing: Sizing }

/**
 * How a shape is painted, named by role.
 *
 * A `Style` never holds a resolved length: `strokeWidth`, `dash` and `corner` are
 * `SizeRole`s, so the same row is 1 px on a screen at zoom 1 and 0.25 mm on paper.
 */
export type Style = {
  stroke?: Paint
  strokeWidth?: SizeRole
  fill?: Paint
  /** Multiplies the alpha of a `fill` that came from the item's own colour, e.g. 0x33/0xff. */
  fillAlpha?: number
  /** The dash and the gap, as two roles: a dash that scales with the drawing is a different row. */
  dash?: readonly [SizeRole, SizeRole]
  opacity?: number
  fontFamily?: string
  fontWeight?: number
  /** Text only: the role whose `SIZE_ROLES` row gives the size. */
  size?: SizeRole
  /** A rounded corner's radius, for the rows drawn as a rounded rect. */
  corner?: SizeRole
  /**
   * `'none'`: this takes no pointer. The Plan View's measurements, Item Origins and Plan
   * Image lie on top of the footprints they annotate, and a canvas whose crosshair swallows
   * the click meant for the Item under it cannot be used.
   */
  hit?: 'none'
}

/**
 * How the Plan View Range presents this one item (#74 §3).
 *
 * It is a presentation and not a `StyleKey`, because the range says *how* a row is drawn — take
 * the fill out of it, or draw the whole row at the faded opacity — and never *which* row it is.
 * The row keeps the entity's own colours, so a layer drawn in a colour of its own still reads as
 * one thing when the range cuts through it, and `emphasised()` can still find the row's
 * `:selected` and `:hovered` variants. `rangeStyle` is the only reader.
 */
export type RangePaint = 'outline' | 'faded'

/**
 * One drawn thing.
 *
 * `color` is what a `'item'` paint reads — the Placed Item's own colour — and is absent
 * whenever no style in the row needs it. `layout` is carried by text because the label
 * placer and the display list's own `bounds` both need the box the string occupies, and
 * measuring it twice, twice, is how a chip and its obstacle disagreed (#57).
 *
 * `paint` is the range's mark, stamped by the drawing pass and read by both renderers; absent
 * means the entity is In range and draws normally. A label carries the same `ref` as the
 * geometry it names, so it carries the same `paint` and follows it (#74 §3).
 */
export type DisplayItem =
  | {
      kind: 'path'
      ref?: Ref
      segments: PathCommand[]
      closed: boolean
      style: StyleKey
      color?: string
      paint?: RangePaint
    }
  | {
      kind: 'text'
      ref?: Ref
      text: string
      at: Pt
      anchor: TextAnchor
      baseline: TextBaseline
      rotationDeg: number
      role: TextRole
      style: StyleKey
      decoration?: 'underline'
      color?: string
      opacity?: number
      paint?: RangePaint
      layout: { width: number; ascent: number; descent: number }
    }
  | {
      kind: 'image'
      ref?: Ref
      assetHash: string
      widthPx: number
      heightPx: number
      /** Maps the image's own pixel space into the drawing's millimetres. */
      transform: Affine
      opacity: number
    }
  | { kind: 'group'; ref?: Ref; transform?: Affine; items: DisplayItem[] }

/** One z-ordered band of the list, named by its `LayerKey`. */
export type DisplayLayer = { key: LayerKey; items: DisplayItem[] }

/**
 * Text the bundled face has no glyph for (#19 §4).
 *
 * The list reports it instead of staying quiet, because the Plan View has to say so on
 * screen — a name drawn as boxes is a name the user cannot read, and silence would let
 * #19's font work look finished when it is not.
 */
export type MissingGlyph = { ref: Ref | null; text: string; chars: string[] }

/**
 * A label the drawing had no room for (#74 §3).
 *
 * A label that would have landed on another label is left out of the picture rather than
 * written over it — but it is still carried here, with the words and the place it wanted, so the
 * surface that draws the list can show it on hover instead of losing the name.
 */
export type OmittedLabel = { ref: Ref; text: string; at: Pt }

/**
 * A whole drawing: one surface's worth of layers, in `LAYER_ORDER` order.
 *
 * `bounds` is in millimetres and already includes the laid-out text extents, so a caller can
 * fit a viewport or size a sheet from the list alone — which is what makes the Item Detail's
 * export (#62) a serialisation of this and nothing more.
 */
export type DisplayList = {
  space: 'floor' | 'design-local'
  bounds: Rect
  layers: DisplayLayer[]
  missingGlyphs: MissingGlyph[]
  /**
   * The labels this drawing left out because they had nowhere to sit (#74 §3). Absent means none
   * was omitted — which is every drawing but a Plan View's, since only the Plan View packs a
   * whole Floor's names into one room.
   */
  omittedLabels?: OmittedLabel[]
}

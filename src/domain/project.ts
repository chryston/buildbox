/**
 * The domain schema v2 types (#42 §2) — the exact JSON shape a Project is stored and
 * exchanged as.
 *
 * v1 held only what the S4 Local Projects release needs: Project metadata and
 * preferences, Floors with an optional Plan Image, cabinet and generic Item Designs, and
 * the Existing Model's Placed Items. v2 adds what Multiple Floors needs (#56): the
 * Project's saved Plan Views, and each Floor's own limits. Everything else arrives through
 * a migrator in the release that ships it (#42 §5, MIGRATIONS.md); unspecified shapes are
 * never frozen early (#20 §3).
 *
 * Conventions, stated once here because every later module uses them:
 *
 * - Floor and footprint coordinates are millimetres with **+X right and +Y down**, the
 *   legacy floor-plan frame, so legacy geometry values are kept as they are (#20 §3).
 * - `rotationDeg` is **clockwise** in that frame, matching SVG `rotate()`.
 * - A placement maps a footprint-local point `p` into Floor space as
 *   `translation + R(rotationDeg) · (p − origin)`.
 * - Geometry is canonical millimetres; the display unit and precision are Project
 *   preferences that never rewrite geometry (#13).
 */
import type { ClosedPath, Preset } from '../geometry'
import type { CabinetNode, GlobalSettings } from './cabinetPayload'

/**
 * An opaque entity ID (#42 §3): 1–128 UTF-16 code units, no leading or trailing
 * whitespace, no control characters. Legacy nanoid and UUID IDs are kept, so nothing
 * more is required. Domain code never generates one — IDs arrive as data.
 */
export type EntityId = string

/** The Project display unit (#13: a preference, never a rewrite of geometry). */
export type DisplayUnit = 'mm' | 'cm' | 'm'

/** A point in millimetres, in whichever local frame the field names. */
export interface Point2 {
  x: number
  y: number
}

/** The complete portable record for one property (ADR 0002). */
export interface Project {
  id: EntityId
  meta: ProjectMeta
  preferences: ProjectPreferences
  /** Array order is the user's display order (#25); it implies no vertical relationship. */
  floors: Floor[]
  /**
   * The saved Plan Views (#56). Array order is the order the switcher lists them in; every
   * Floor carries exactly one default view, so this array is never empty for a Project
   * with a Floor.
   */
  views: PlanView[]
  itemDesigns: ItemDesign[]
  existingModel: ExistingModel
  /**
   * Every acknowledgement of a warning, in the order the user made them (#66 §5).
   *
   * Canonical and in Backups: an acknowledgement is a decision about the model, not a
   * preference about the screen, so it survives a reload, a Backup and a second tab. The key
   * is `(warningType, subjectIds, designOptionId)` and it is unique — two records for one
   * warning would be two notes, and the strip shows one.
   */
  warningAcknowledgements: Acknowledgement[]
}

export interface ProjectMeta {
  name: string
  /** Absent when the user has not filled it in; clearing the field removes the key. */
  address?: string
}

export interface ProjectPreferences {
  displayUnit: DisplayUnit
  /** Displayed decimal places: mm 0 dp, cm 1 dp, m 3 dp are the #19 defaults. */
  displayPrecision: number
  /**
   * The height a new Wall takes when its Floor gives none (#64), in millimetres above the
   * Floor Datum. It comes from the Preset Pack's `height.ceiling` entry — 2,600 mm — and is
   * resolved once at creation, so editing a Wall never points back at the pack.
   */
  defaultWallHeight: number
}

/** An independent spatial silo: its own local X/Y, Floor Datum at Z = 0, Plan Image (#25). */
export interface Floor {
  id: EntityId
  /** Required, editable, unique within the Project ignoring case (#25). */
  name: string
  planImage: PlanImage | null
  /** The Floor's own vertical extent (#56); absent when the user has given none. */
  limits?: FloorLimits
  /**
   * The height a new Wall on this Floor takes, in millimetres (#64). Absent means "use the
   * Project's `defaultWallHeight`"; it is a default only, and never restates a Wall's own
   * `height`.
   */
  defaultWallHeight?: number
}

/**
 * The Floor's vertical extent in millimetres, measured from the Floor Datum (#56), so a
 * `lowerMm` below zero describes the part of the Floor that hangs under it. Either bound
 * may be absent; when both are present `lowerMm` is the smaller. BuildBox records the
 * numbers the user gave and derives no requirement from them.
 */
export interface FloorLimits {
  lowerMm?: number
  upperMm?: number
}

/**
 * A saved way of looking at exactly one Floor (#56). A Plan View holds no Placed Item, no
 * Plan Image and no geometry of its own — it is a viewer, so deleting one deletes nothing
 * but the view. `isDefault` marks the view that came with the Floor: every Floor has
 * exactly one, and it goes with the Floor rather than counting as a dependant.
 */
export interface PlanView {
  id: EntityId
  kind: 'plan'
  /** A Plan View is a viewer of exactly one Floor. */
  floorId: EntityId
  /** Unique among the views of that Floor, ignoring case. */
  name: string
  isDefault: boolean
  /** Whether this view draws the Floor's Plan Image. */
  showPlanImage: boolean
}

/**
 * The Plan Image record (#20 §3). It has no ID of its own: a Floor owns zero or one, so
 * it is addressed by its Floor (#42, named deviation 2).
 */
export interface PlanImage {
  /** Lowercase hex SHA-256 of the asset bytes. */
  assetHash: string
  mediaType: PlanImageMediaType
  widthPx: number
  heightPx: number
  /** `null` means uncalibrated: the image is evidence, not a scale. */
  pixelsPerMm: number | null
}

export type PlanImageMediaType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp'
  | 'image/gif'
  | 'image/bmp'
  | 'image/avif'
  | 'image/svg+xml'

/** A project-owned item definition, reusable by many Placed Items. */
export type ItemDesign = CabinetItemDesign | GenericItemDesign

/**
 * A cabinet: the `construction` payload is interpreted only by `cabinet` and is opaque
 * to everything else (ADR 0004). Its footprint, height and Item Origin are derived from
 * `settings`, never stored — see `designFootprintSize`, `designHeight`, `designOrigin`.
 */
export interface CabinetItemDesign {
  id: EntityId
  kind: 'cabinet'
  name: string
  construction: { settings: GlobalSettings; root: CabinetNode }
}

/** A selected or user-drawn item: a rectangular footprint, a centre origin, a colour. */
export interface GenericItemDesign {
  id: EntityId
  kind: 'generic'
  name: string
  /** Item Footprint, in footprint-local millimetres. v1: rectangle only (#42, deviation 1). */
  footprint: ItemFootprint
  /** Item Origin in footprint-local millimetres. */
  origin: Point2
  /** Millimetres. */
  height: number
  /** `true` = a catalog "typical — measure yours" value, not a measured height. */
  heightIsTypical: boolean
  /** `#rrggbb`, lowercase. */
  color: string
  /** The catalog entry this design came from (legacy `FloorPlanObjectType`, e.g. `bed-king`). */
  catalogKey?: string
  /** Legacy custom shape / user-defined design. */
  isCustom?: boolean
}

/** The closed plan boundary of an Item Design in local coordinates (#58). */
export type ItemFootprint = PresetItemFootprint | PathItemFootprint

/**
 * A shape the presets module knows how to evaluate (#54, #58): the preset and its
 * parameters, where its local bounds sit, and how it is turned.
 *
 * `centre` is the centre of the preset's local bounds and `orientationDeg` is clockwise in
 * the same +Y-down frame everything else uses, so the footprint is exactly what
 * `evaluatePreset(preset, { centre, orientationDeg })` draws — the one call the Floor
 * canvas, the Item Design canvas and the exporter all make.
 *
 * A preset is a *description*, which is what makes it editable: the Shape tab changes one
 * number and every placement of the design follows. It is also the reason a footprint can
 * be invalid — a radius of 1,001 mm on a 2,000 mm side parameterises a shape that does not
 * exist — which is why {@link footprintProblems} is the gate in front of every commit.
 */
export interface PresetItemFootprint {
  kind: 'preset'
  preset: Preset
  /** Footprint-local millimetres: the centre of the preset's local bounds. */
  centre: Point2
  /** Clockwise degrees in the +Y-down frame. */
  orientationDeg: number
}

/**
 * A Custom Path: the shape itself, as one closed loop in footprint-local millimetres, with
 * no parameters left to re-evaluate. This is what `Convert to Custom Path` produces and
 * what #59's edge editing edits. The path is stored rather than derived, so a Custom Path
 * survives every later edit to the design unchanged.
 */
export interface PathItemFootprint {
  kind: 'path'
  path: ClosedPath
}

/** The one shared representation of the property as surveyed (#15.1). */
export interface ExistingModel {
  placedItems: PlacedItem[]
  /**
   * The Walls of this Floor set (#64), the first Building Element. Design Option ownership
   * arrives in #69; until then every Wall is Existing Model.
   */
  walls: Wall[]
  /** The Wall Junctions (#64): the only thing that joins two Walls. */
  wallJunctions: WallJunction[]
  /** Every Opening of every Floor (#65). One is hosted by exactly one Wall. */
  openings: Opening[]
}

/** What an Opening is: an absence in one Wall, not a thing standing in a Room (#65). */
export type OpeningKind = 'door' | 'window' | 'removed_section'

/**
 * Which way a door's leaf swings (#65 §2).
 *
 * These three words are the CSV codes of export contract v1.0 (#68) and never change.
 * `left` and `right` are data only: the interface says "this side" and "the other side",
 * because nothing in a plan fixes which way a reader is facing, and a wrong-looking
 * convention is worse than no word at all. A sliding door hangs on neither jamb, so it
 * carries no `hingeSide`.
 */
export type OpeningSwing = 'left' | 'right' | 'sliding'

/** The jamb a hinged door hangs on: the host reference line's `start` end, or its `end`. */
export type HingeSide = 'start' | 'end'

/**
 * A door, a window or a removed section in exactly one Wall (#65).
 *
 * An Opening is stored parametrically and never in Floor coordinates: `start` is a
 * distance along the host Wall's reference line — arc length on an arc Wall — so moving,
 * rotating, offsetting or re-justifying the host carries the Opening along with it and
 * nothing has to be recomputed. `width` is the chord, the number on a drawing and the
 * number a supplier quotes; the arc length a chord covers is derived, never stored.
 */
export interface Opening {
  id: EntityId
  floorId: EntityId
  /** The one Wall this Opening is cut into. Never reassigned behind the user's back. */
  hostWallId: EntityId
  kind: OpeningKind
  /** `Door 2` by default, numbered per kind within the Project; renameable. */
  label: string
  /** Distance along the host reference line to the near jamb, in millimetres. */
  start: number
  /** The chord across the Wall, in millimetres, greater than 0. */
  width: number
  /** Vertical Extent: the bottom of the opening, from Floor level. */
  sill: number
  /** Vertical Extent: the top of the opening, always above `sill`. */
  head: number
  /** Doors only; absent for a window or a removed section. */
  swing?: OpeningSwing
  /** Hinged doors only; absent when `swing` is `'sliding'`. */
  hingeSide?: HingeSide
}

/** Where the reference line sits within the thickness, relative to its own direction (#64). */
export type WallJustification = 'left' | 'centre' | 'right'

/** What a Wall is, in the homeowner's words; data only, never a drawing Layer (#64). */
export type WallClassification = 'external' | 'internal' | 'partition'

/** Which end of a reference line a Junction member holds. */
export type WallEnd = 'start' | 'end'

/**
 * A Wall's reference line: straight, or a circular arc through a third point.
 *
 * `through` is any point on the arc strictly between `start` and `end`, so the sweep is
 * whatever those three points describe and may exceed 180°. The arc is derived from the
 * three points and never stored as a centre, which is what lets a bulge be dragged without
 * re-solving an identity.
 */
export type WallRefLine =
  | { kind: 'line'; start: Point2; end: Point2 }
  | { kind: 'arc'; start: Point2; end: Point2; through: Point2 }

/**
 * One Wall (#64): a reference line, its own constant thickness, a justification, and a
 * constant floor-relative Vertical Extent. Its faces are derived, never stored — see
 * `derive`'s wall faces — and its Renovation State comes from ownership, never from type.
 */
export interface Wall {
  id: EntityId
  /**
   * The display reference `W-<n>`, sequential within the Project and never reused (#64).
   * Not editable: deleting a Wall leaves its number spent.
   */
  ref: string
  floorId: EntityId
  line: WallRefLine
  /** Millimetres, greater than 0. */
  thickness: number
  /**
   * Where the reference line sits within the thickness, relative to the reference line's own
   * direction. Data only: it is never shown to the user as left or right (#64).
   */
  justification: WallJustification
  classification?: WallClassification
  /** Free text, e.g. `Load-bearing block`. */
  constructionLabel?: string
  /** Millimetres above the Floor Datum; the base of the Wall's Vertical Extent (#15). */
  baseElevation: number
  /** Millimetres. A constant Vertical Extent; the editing UI arrives in #74. */
  height: number
}

/**
 * A shared connection point where Wall ends meet, or where one Wall attaches to another's
 * reference line (#64). Its position is derived, never stored.
 *
 * Without a host it needs at least two ends whose endpoints coincide within the topology
 * tolerance. With a host it needs at least one end sitting on the host's reference line at
 * `at` — a distance along the reference line, or an arc length on an arc — strictly inside
 * `(0, hostLength)`. A T-attach never splits its host: the host keeps its ID and its line.
 */
export interface WallJunction {
  id: EntityId
  floorId: EntityId
  ends: WallJunctionEnd[]
  /** The hosted form: the Wall this Junction attaches to, and where along it. */
  host?: { wallId: EntityId; at: number }
}

/** One member end of a Junction, and the Wall end it holds. */
export interface WallJunctionEnd {
  wallId: EntityId
  end: WallEnd
}

/** A placement of an Item Design: placement context only, never a copy of its dimensions (#16). */
export interface PlacedItem {
  id: EntityId
  itemDesignId: EntityId
  floorId: EntityId
  /** Floor-local millimetres: where the Item Origin sits. */
  translation: Point2
  /** Clockwise in the +X right / +Y down frame, normalised to `0 ≤ r < 360`. */
  rotationDeg: number
  /** Millimetres above the Floor Datum; negative is valid (#25). */
  baseElevation: number
}

/**
 * One warning the user has seen and chosen not to be told again (#66 §5).
 *
 * An acknowledgement says exactly one thing: this person saw this warning, at this state of
 * the model, and had this much to say about it. It never changes geometry, never asserts
 * that anything is safe or conforms to anything, and never travels with a View — it is
 * scoped to a Design Option, because the decision was made about one alternative's model.
 *
 * `signature` is the 64-bit hash of every model field the warning was measured from. When
 * those fields move, the hash the engine computes no longer matches the one stored, and the
 * warning comes back as `reopened` with this note still attached. That is why the signature
 * is stored rather than re-derived: the whole point is to remember what the model looked like
 * when the decision was made.
 */
export interface Acknowledgement {
  id: EntityId
  /** The producer's stable `lower_snake_case` code — a `warning_type` value (#66 §1). */
  warningType: string
  /**
   * Every entity the warning involves, sorted by code point, primary subject included.
   *
   * Sorted because this list is half of a key: the same two Walls must give the same key
   * whichever order a producer happened to walk them in. The engine sorts, and validation
   * refuses a stored list that is not sorted, so a hand-edited Backup cannot smuggle a second
   * key for one warning.
   */
  subjectIds: EntityId[]
  /**
   * The Design Option the decision belongs to; `null` is "the Existing Model".
   *
   * `null`-only until Design Options ship (#83): validation refuses anything else, so the day
   * Options arrive the stored records of every Project written before it are still valid.
   */
  designOptionId: EntityId | null
  /** `stableHash` of the warning's signature inputs at the moment of acknowledging. */
  signature: string
  /**
   * The user's note, plain text, at most 500 characters, possibly empty.
   *
   * Optional in the interface but always present as a string: an absent note and an empty one
   * would be two shapes for the strip to render and no difference to show.
   */
  note: string
  /** ISO 8601, read from the caller's clock when the Intent was made (#42 §3). */
  acknowledgedAt: string
}

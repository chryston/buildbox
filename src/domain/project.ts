/**
 * The domain schema v1 types (#42 §2) — the exact JSON shape a Project is stored and
 * exchanged as.
 *
 * v1 holds only what the S4 Local Projects release needs: Project metadata and
 * preferences, Floors with an optional Plan Image, cabinet and generic Item Designs, and
 * the Existing Model's Placed Items. Everything else arrives through a migrator in the
 * release that ships it (#42 §5, MIGRATIONS.md); unspecified shapes are never frozen
 * early (#20 §3).
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
  itemDesigns: ItemDesign[]
  existingModel: ExistingModel
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
}

/** An independent spatial silo: its own local X/Y, Floor Datum at Z = 0, Plan Image (#25). */
export interface Floor {
  id: EntityId
  /** Required, editable, unique within the Project ignoring case (#25). */
  name: string
  planImage: PlanImage | null
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

/** The closed plan boundary of an Item Design in local coordinates. */
export type ItemFootprint = RectangleFootprint

/** Local corners `(0,0)`, `(width,0)`, `(width,depth)`, `(0,depth)`. */
export interface RectangleFootprint {
  kind: 'rectangle'
  width: number
  depth: number
}

/** The one shared representation of the property as surveyed (#15.1). */
export interface ExistingModel {
  placedItems: PlacedItem[]
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

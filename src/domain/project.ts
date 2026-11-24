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
import type { ClosedPath, Preset, WallSide } from '../geometry'
import type { CabinetNode, GlobalSettings } from './cabinetPayload'
import type { Comment } from './comments'
import type { ElevationView } from './elevationView'
import { nameKey } from './floorNames'
import type { PlanViewRange } from './planViewRange'

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
  /**
   * The saved Elevation Views (#75 §1), in the order the saved-view picker lists them.
   *
   * One flat array holding views of every Floor, exactly as {@link Project.views} is one, rather than
   * a list filed inside each Floor: an Elevation View names its Floor the way a Plan View does, so the
   * lookup that addresses a saved view by ID alone — the saved-view card, an undo, a Backup — reads one
   * array per kind instead of walking Floors.
   *
   * Optional rather than an always-present array for the same reason `designOptions` is: a Project
   * written before this capability stays valid without the field, and the validator never defaults one.
   * `elevationViewsOf` is the accessor, and the v9 → v10 migrator adds the empty array.
   */
  elevationViews?: ElevationView[]
  /**
   * The Drawing Layers of this Project (#71 §1), in the Project layer order: back to front, so the
   * last entry is the front-most layer and the Layers list — which reads front first — renders this
   * array reversed.
   *
   * Optional rather than an always-present array, for the same reason `designOptions` is: a Project
   * written before this capability stays valid without the field, and the validator never defaults
   * one. `drawingLayersOf` is the accessor, and a Project with no layers at all is a
   * legal one — everything in it is Unlayered, which is what a Project written before #71 reads as.
   *
   * Unlayered is not a member: it is the absence of a layer, it is always present in the list, and
   * it cannot be renamed, recoloured, reordered away or deleted.
   */
  drawingLayers?: DrawingLayer[]
  itemDesigns: ItemDesign[]
  existingModel: ExistingModel
  /**
   * The Design Options of this Project (#69 §2), in the order the list offers them.
   *
   * Optional rather than an always-present array so that a Project written before this capability
   * — every Project in every Backup taken until now — stays valid without the field: the validator
   * never defaults one. `designOptionsOf` is the accessor; the v7 → v8 migrator adds the empty array.
   */
  designOptions?: DesignOption[]
  /**
   * Every acknowledgement of a warning, in the order the user made them (#66 §5).
   *
   * Canonical and in Backups: an acknowledgement is a decision about the model, not a
   * preference about the screen, so it survives a reload, a Backup and a second tab. The key
   * is `(warningType, subjectIds, designOptionId)` and it is unique — two records for one
   * warning would be two notes, and the strip shows one.
   */
  warningAcknowledgements: Acknowledgement[]
  /**
   * Every Comment of this Project (#80 §1), in the order they were created.
   *
   * Project-level rather than filed inside a Floor or a model: a Comment is a note about the record,
   * not a piece of it, so it belongs to no Drawing Layer, takes no Renovation State and is not
   * demolished by a Design Option — only its Anchor's own visibility is. The list is canonical and
   * travels in every Backup; the Notes panel's filters, the overlay and the selected row are
   * UI-session state and are never stored here.
   */
  comments: Comment[]
  /**
   * The highest `C-` reference number this Project has ever handed out (#80 §1).
   *
   * A counter rather than a scan of the live list, because a reference is never reused: deleting
   * `C-009` and adding a Comment gives `C-010`, and undoing a creation leaves the number spent. It
   * only moves forward, so undo never rewinds it and a restored Comment always comes back with the
   * reference it was born with.
   */
  commentReferenceCounter: number
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
 * The four Renovation Displays (#18, #70 §1), in the order the card lays them out:
 * Existing and Demolition across the top row, Proposed and Combined underneath.
 *
 * A Display says which Renovation States the view draws — it is not a Drawing Layer, not a
 * "phase" and not a mode tab, and the words are never interchangeable. Which State each one
 * shows is `derive`'s rule (`displayStateOf`), so the four names here are the only vocabulary.
 */
export const RENOVATION_DISPLAYS = ['existing', 'demolition', 'proposed', 'combined'] as const

/** One Renovation Display, as a saved view records it. */
export type RenovationDisplay = (typeof RENOVATION_DISPLAYS)[number]

/**
 * The reserved key of Unlayered content (#71 §1) — the bucket every entity starts in and the row
 * the Layers list always shows, first, whatever the order.
 *
 * It is a key and never an ID: no layer owns it, so it cannot be renamed, recoloured, reordered
 * away or deleted, and a saved view may hold a setting for it (`Unlayered uses its own per-view
 * visibility`). A layer whose ID happened to read `unlayered` would shadow that key in
 * `layerSettings`, which is why the validator refuses the ID outright.
 */
export const UNLAYERED_LAYER_KEY = 'unlayered'

/**
 * One Drawing Layer (#71 §1): a named, coloured group of drawable entities, held by the Project and
 * ordered back to front.
 *
 * `color` is the Project default — the per-view override lives on the view, not here, because a
 * layer has one default colour and many views.
 */
export interface DrawingLayer {
  /** Immutable and unique among the Project's layers. */
  id: EntityId
  /** Free text, and not unique: two layers may be called `Services`. */
  name: string
  /** The Project default colour, `#rrggbb` lowercase. */
  color: string
}

/**
 * What one saved view says about one layer (#71 §3): the three switches, and the colour the rows
 * and markers draw in that view.
 *
 * Every field is an override of a default rather than a copy of one — a view that says nothing
 * shows the layer as its Project entry describes it — so `color` is absent when there is no
 * override, and the effective colour is the layer's own (`Unlayered` has none, and draws in the
 * neutral token colour).
 */
export interface LayerSetting {
  visible: boolean
  selectable: boolean
  editable: boolean
  /** `#rrggbb` lowercase; absent is the layer's Project colour. */
  color?: string
}

/** What a view says about a layer it holds no setting for: shown, pickable, editable. */
export const DEFAULT_LAYER_SETTING: Readonly<LayerSetting> = Object.freeze({
  visible: true,
  selectable: true,
  editable: true,
})

/**
 * The kind of thing a creation tool is about to make, which is the only question #71 §2's default
 * table answers. It is the one place a layer *name* is load-bearing, and the only place the three
 * default names are written: `Structure`, `Services` and `Furniture` are ordinary layers a person
 * may rename or delete, so a creation tool looks for the name and never for an ID or a reserved row.
 */
export type CreationSubtype = 'fabric' | 'service' | 'item'

/**
 * Which of the three default layers each subtype belongs to (#71 §2). Walls, Openings, Rooms and
 * any other built fabric are `fabric` — a Room is surveyed fabric like the Walls around it, which is
 * the decision this issue owns. `service` is the row Service Runs and Risers will use when they
 * exist; nothing creates one yet.
 */
export const DEFAULT_LAYER_NAMES: Record<CreationSubtype, string> = {
  fabric: 'Structure',
  service: 'Services',
  item: 'Furniture',
}

/**
 * The three layers a new Project starts with (#71 §1), back to front, with the names and colours
 * the issue names.
 *
 * They are data rather than copy: the names are user-editable text stored in the Project, and the
 * colours are stored too, so a Project may rename `Services` to `Electrical` and keep the entities
 * that were placed on it. Creation resolves a subtype's default layer by NAME for that reason —
 * deleting `Services` and making a new layer called `Services` brings the rule back.
 */
export const DEFAULT_DRAWING_LAYERS: readonly { name: string; color: string }[] = Object.freeze([
  { name: DEFAULT_LAYER_NAMES.fabric, color: '#b9b9c2' },
  { name: DEFAULT_LAYER_NAMES.service, color: '#5fb3ff' },
  { name: DEFAULT_LAYER_NAMES.item, color: '#e3a857' },
])

/** The colour a layer made by `New layer` starts with (#71 §5). */
export const NEW_LAYER_COLOR = '#9ad48a'

/** The Project's layers in the Project layer order — back to front. A Project with none is legal. */
export const drawingLayersOf = (project: Project): DrawingLayer[] => project.drawingLayers ?? []

/** The layer an ID names, or `null` when the Project no longer holds it. */
export const drawingLayerById = (project: Project, id: EntityId | null | undefined): DrawingLayer | null =>
  id === null || id === undefined
    ? null
    : drawingLayersOf(project).find((layer) => layer.id === id) ?? null

/**
 * The layer a creation tool's subtype default names (#71 §2), or `null` when no layer carries it.
 *
 * Names are compared the way every uniqueness rule compares them, so `structure` finds `Structure`.
 * Two layers may carry the same name — uniqueness is not a layer rule — and the back-to-front order
 * decides: the one drawn furthest forward wins, because that is the row a person would point at.
 */
export function drawingLayerByName(project: Project, name: string): DrawingLayer | null {
  const key = nameKey(name)
  const layers = drawingLayersOf(project)
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const layer = layers[index]
    if (layer !== undefined && nameKey(layer.name) === key) return layer
  }
  return null
}

/** The setting a saved view holds for one layer key, or `undefined` when it says nothing about it. */
export const viewLayerSettingOverride = (view: SavedViewSettings, key: string): LayerSetting | undefined =>
  view.layerSettings?.[key]

/** The view's own layer order, or `null` for `Use Project layer order`. */
export const viewLayerOrder = (view: SavedViewSettings): EntityId[] | null => view.layerOrder ?? null

/** The layer new content of no subtype default lands on; `null` is Unlayered. */
export const viewActiveLayerId = (view: SavedViewSettings): EntityId | null => view.activeLayerId ?? null

/** Whether hidden content still offers snap targets in this view; absent is `false`. */
export const viewSnapToHidden = (view: SavedViewSettings): boolean => view.snapToHiddenContent ?? false

/** The layer a drawable entity belongs to; `null` is Unlayered, which is what an entity written before #71 is. */
export const entityLayerId = (entity: { drawingLayerId?: EntityId | null }): EntityId | null =>
  entity.drawingLayerId ?? null

/**
 * The settings every saved view carries, whichever kind of view it is (#69 §2, #70 §1, #71 §3).
 *
 * Pulled out of `PlanView` when #75 added a second kind of saved view: an Elevation View looks
 * through the same Design Option, draws the same Renovation Display, files its layers the same way
 * and snaps to hidden content the same way, so these six fields are one interface both kinds extend
 * rather than a second copy of the same six that can drift from the first.
 *
 * Every one is optional in the type for the same reason `designOptions` is: a view written before the
 * capability — every Project, and every Backup taken until it existed — has to stay readable without
 * it, and the validator never defaults a field. The accessors below are the reads, and each is typed
 * against this interface so it answers for either kind of view.
 */
export interface SavedViewSettings {
  /**
   * The Design Option this view looks through, or `null` for the Existing Model alone.
   *
   * `null` is not an error: it is what a view of a Project with no Options holds, and what a
   * view is left holding when its Option is deleted (#70 §1). A Demolition, Proposed or
   * Combined view with no Option is valid persisted state — the error state §6 draws — so the
   * Display and this field are checked independently, never as a pair.
   */
  designOptionId?: EntityId | null
  /** The Renovation Display this view draws; absent is `'existing'`. */
  renovationDisplay?: RenovationDisplay
  /**
   * What this view says about each layer (#71 §3), keyed by layer ID plus the reserved
   * `unlayered` key.
   *
   * Sparse on purpose: a key appears when the view says something the Project default does not, and
   * a layer with no key is shown, pickable and editable in its Project colour. Deleting a layer
   * removes its key from every view, so a key here always names a layer the Project still has.
   */
  layerSettings?: Record<string, LayerSetting>
  /**
   * This view's own layer order, front to back, covering every layer plus `unlayered` exactly once
   * — or `null` for `Use Project layer order`, which is the default and the common case.
   *
   * The override is a full order rather than a delta, so a layer added after it was written has no
   * place in it; the validator refuses that, and `view.setLayerOrder` rewrites the whole array.
   */
  layerOrder?: EntityId[] | null
  /**
   * The Active Layer of this view (#71 §2): the layer new content of no subtype default is created
   * on. `null` is Unlayered, which is what a view written before #71 holds.
   */
  activeLayerId?: EntityId | null
  /**
   * `Snap to hidden content` (#71 §4): hidden or non-selectable content still offers snap targets.
   * Absent is `false`, and it is a per-view setting like everything else on this record.
   */
  snapToHiddenContent?: boolean
}

/**
 * A saved way of looking at exactly one Floor (#56). A Plan View holds no Placed Item, no
 * Plan Image and no geometry of its own — it is a viewer, so deleting one deletes nothing
 * but the view. `isDefault` marks the view that came with the Floor: every Floor has
 * exactly one, and it goes with the Floor rather than counting as a dependant.
 *
 * What it shares with an Elevation View — the Option, the Display and the four layer settings — is
 * {@link SavedViewSettings}, which both kinds extend rather than restate.
 */
export interface PlanView extends SavedViewSettings {
  id: EntityId
  kind: 'plan'
  /** A Plan View is a viewer of exactly one Floor. */
  floorId: EntityId
  /** Unique among the views of that Floor, ignoring case. */
  name: string
  isDefault: boolean
  /** Whether this view draws the Floor's Plan Image. */
  showPlanImage: boolean
  /**
   * The height this view draws at (#74 §1).
   *
   * Required, not optional: a Plan View without a range would be a view that hides things by
   * accident, and #74 §1 refuses that reading. The v8 → v9 migrator gives every view that
   * predates it the range its Floor's limits say — the Floor's lower limit, or 0 when it has
   * none, up to its upper limit, or 2 600 when it has none — which is the whole storey, and so
   * the whole storey is what every existing Plan View keeps drawing.
   *
   * A Plan View's own field, and not a saved-view setting: an Elevation View has no height it cuts
   * at, because it looks along the storey rather than across it (#75 §1).
   */
  planViewRange: PlanViewRange
}

/** Either kind of saved view, discriminated by `kind` (#75 §1). */
export type SavedView = PlanView | ElevationView

/**
 * The Elevation Views of a Project, which a Project written before #75 does not carry.
 *
 * Every consumer reads through this rather than the field, so "no Elevation Views" has one spelling.
 */
export const elevationViewsOf = (project: Project): ElevationView[] => project.elevationViews ?? []

/**
 * Every saved view of a Project, Plan Views first and then Elevation Views (#75 §3).
 *
 * The read behind "the saved view with this ID", which is how the saved-view card, an undo and a
 * Backup all address one: a view is named by ID alone, and an ID is unique across both collections.
 * The array is a fresh one, so a caller that replaces a whole collection assigns it to the field;
 * a caller that edits a record in place edits the Project's own record, which is the same object.
 */
export const savedViewsOf = (project: Project): SavedView[] => [...project.views, ...elevationViewsOf(project)]

/** The saved view an ID names, of either kind, or `null` when no view holds it. */
export const savedViewById = (project: Project, id: EntityId | null | undefined): SavedView | null =>
  id === null || id === undefined
    ? null
    : savedViewsOf(project).find((view) => view.id === id) ?? null

/** The Design Option of a saved view, which a view written before #70 does not carry. */
export const viewDesignOptionId = (view: SavedViewSettings): EntityId | null => view.designOptionId ?? null

/** The Renovation Display of a saved view, which a view written before #70 does not carry. */
export const viewRenovationDisplay = (view: SavedViewSettings): RenovationDisplay => view.renovationDisplay ?? 'existing'

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
  /** The design's Clearance Envelope (#76 §4); `null` is none, and absent is `null`. */
  clearanceEnvelope?: ClearanceEnvelope | null
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
  /** The design's Clearance Envelope (#76 §4); `null` is none, and absent is `null`. */
  clearanceEnvelope?: ClearanceEnvelope | null
}

/**
 * The one volume an Item Design asks to keep free around each of its placements (#76 §4).
 *
 * A Clearance Envelope is exactly what the name says: a region of plan and a span of height that
 * should stay clear — a door swing's reach, a fridge's ventilation gap — supplied by the user or
 * their manufacturer, never inferred. BuildBox holds the numbers it is given and derives no rule
 * from them: there is no built-in depth, no default per kind, and nothing here says anything
 * about what a clearance is for.
 *
 * It belongs to the Item Design, so every placement of the design shares it: `path` is a closed
 * loop in the design's own local coordinates, in the same frame as its Item Footprint, and each
 * placement carries it through its own turn and translation. `bottomOffset` is measured from the
 * placement's Base (so it rides every Base elevation the placement is given), and `height` rises
 * from there, greater than 0. Zero or one envelope per design; a design that names none asks
 * nothing of the space around it.
 */
export interface ClearanceEnvelope {
  /** A closed path in Item-Design-local millimetres, validated by the geometry kernel. */
  path: ClosedPath
  /** Millimetres from each placement's Base; negative hangs below it. Default 0. */
  bottomOffset: number
  /** Millimetres, greater than 0, rising from `bottomOffset`. */
  height: number
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
  /**
   * Every Room of every Floor (#67). A Room is explicit — never inferred from Walls — and
   * belongs to exactly one Floor, so it carries its own `floorId` like a Wall does.
   */
  rooms: Room[]
  /**
   * Every Beam of every Floor (#77). A Beam stands on its own reference line: it is not hosted by,
   * joined to, or derived from any Wall, so it is a collection of its own rather than a field of
   * the Wall set.
   *
   * Optional rather than an always-present array for the same reason `elevationViews` is: a Project
   * written before this capability stays valid without the field, and the validator never defaults
   * one. {@link beamsOf} is the accessor, and the v11 → v12 migrator adds the empty array.
   */
  beams?: Beam[]
  /**
   * Every Skirting of every Floor (#78). A Skirting is hosted by one Wall face over one range, so
   * it is a collection of its own rather than a field of the Wall — but unlike a Beam it stores no
   * geometry, because its body is derived from the host's tidied face every time it is drawn.
   *
   * Optional for the same reason `beams` is: a Project written before this capability stays valid
   * without the field. {@link skirtingOf} is the accessor, and the v12 → v13 migrator adds the
   * empty array.
   */
  skirting?: Skirting[]
  /**
   * Every Service of every Floor (#79). A Service is hostless like a Beam — it stands on its own
   * centreline or its own point and is derived from no Wall — so it is a collection of its own.
   *
   * Optional for the same reason `beams` is: a Project written before this capability stays valid
   * without the field. {@link servicesOf} is the accessor, and the v13 → v14 migrator adds the empty
   * array.
   */
  services?: Service[]
}

/**
 * The IDs of the entities this one came out of (#69 §3).
 *
 * Empty for work invented from nothing; one entry for a replace, a like-for-like renovation or a
 * move into a Design Option; several for a split or a merge, which is why it is a list and not a
 * single ID. It is what makes a renovation quantity answer "new work" or "like-for-like replacement"
 * rather than guessing from geometry, and it is what the drawing's provenance marker reads.
 *
 * Present only on a proposed entity: an Existing Model entity has no predecessor by definition, and
 * the validator refuses the field there so that the two roles cannot be confused.
 */
export type PredecessorIds = EntityId[]

/** The six collections one Design Option proposes, in the shape `ExistingModel` uses (#69 §2). */
export interface ProposedModel {
  walls: Wall[]
  wallJunctions: WallJunction[]
  openings: Opening[]
  rooms: Room[]
  placedItems: PlacedItem[]
  /** Every Beam this Option introduces (#77), in the same shape the Existing Model stores. */
  beams?: Beam[]
  /** Every Skirting this Option introduces (#78), in the same shape the Existing Model stores. */
  skirting?: Skirting[]
  /** Every Service this Option introduces (#79), in the same shape the Existing Model stores. */
  services?: Service[]
}

/**
 * The Skirtings of one model — the Existing Model or a Design Option's proposed work — which a
 * Project written before #78 does not carry.
 *
 * Every consumer reads through this rather than the field, so "no Skirting" has one spelling.
 */
export const skirtingOf = (model: { skirting?: Skirting[] } | undefined): Skirting[] => model?.skirting ?? []

/**
 * The Beams of one model — the Existing Model or a Design Option's proposed work — which a Project
 * written before #77 does not carry.
 *
 * Every consumer reads through this rather than the field, so "no Beams" has one spelling.
 */
export const beamsOf = (model: { beams?: Beam[] } | undefined): Beam[] => model?.beams ?? []

/**
 * The Services of one model — the Existing Model or a Design Option's proposed work — which a
 * Project written before #79 does not carry.
 *
 * Every consumer reads through this rather than the field, so "no Service" has one spelling.
 */
export const servicesOf = (model: { services?: Service[] } | undefined): Service[] => model?.services ?? []

/**
 * One alternative for the same Existing Model (#69 §2).
 *
 * A Design Option owns a **delta**, never a copy: `proposed` holds only the entities this Option
 * introduces and `demolishedIds` only the Existing entities it removes. Everything else is shared,
 * which is what "options are alternatives over one shared Existing Model" means in the data — and
 * what makes an Existing Model correction a single transaction that every Option sees, rather than
 * N edits that could disagree.
 */
export interface DesignOption {
  id: EntityId
  /** Non-empty, at most 60 characters, unique within the Project up to trim and case. */
  name: string
  /** The work this Option introduces, and only that. */
  proposed: ProposedModel
  /**
   * The IDs of the Existing Model entities this Option removes, sorted.
   *
   * Existing entities only: a record naming a proposed entity would delete work that exists in one
   * alternative and not in another. Removing an Option's own work is an edit to `proposed`.
   */
  demolishedIds: EntityId[]
}

/**
 * The Design Options of a Project, which a Project written before #69 does not carry.
 *
 * Every consumer reads through this rather than the field, so "no Options" has one spelling.
 */
export const designOptionsOf = (project: Project): DesignOption[] => project.designOptions ?? []

/**
 * Which face of a Wall a Room edge is referenced to (#67 §1).
 *
 * `left` and `right` are the reference line's own sides and are data only, exactly as a
 * Wall's justification is: the interface names a face by the Room it borders
 * (`W-5 · Kitchen side`), never by a side letter (#67 D8).
 */
export type WallFaceSide = WallSide

/**
 * One Room's standing claim on one Wall face (#67 §1).
 *
 * `segmentId` is the stable ID of one segment of the Room Outline, not its position: an edge
 * inserted at the far end of the outline, or a corner filleted, must not silently move the
 * reference onto a different edge. The referenced segment is always a **line** — an arc has
 * no single face to lie on — and it always lies on the named face within the kernel's
 * 0.01 mm tolerance, which is what makes "the edge follows the face" a statement about
 * geometry rather than an intention.
 */
export interface RoomWallFaceRef {
  /** The stable ID of one line segment of this Room's outline. */
  segmentId: EntityId
  /** The Wall whose face carries it; always on the Room's own Floor. */
  wallId: EntityId
  side: WallFaceSide
}

/** A Room's outline as a shape description, in Floor coordinates (#67 §1). */
export type RoomOutline = PresetRoomOutline | PathRoomOutline

/**
 * A Room drawn from a preset: the same shape description an Item Footprint uses, placed in
 * Floor rather than footprint-local millimetres.
 *
 * `segmentIds` lines up one-to-one with the segments the preset evaluates to, so a reference
 * survives a parameter edit that keeps the shape's structure. An edit that changes the
 * segment count — rounding a square corner adds an arc — is the edit layer's job to carry.
 */
export interface PresetRoomOutline {
  kind: 'preset'
  preset: Preset
  /** Floor millimetres: the centre of the outline's local bounds. */
  centre: Point2
  /** Clockwise degrees in the +Y-down frame. */
  orientationDeg: number
  segmentIds: EntityId[]
}

/** A Room drawn as a Custom Path: the shape itself, with one stable ID per Edge. */
export interface PathRoomOutline {
  kind: 'path'
  path: ClosedPath
  segmentIds: EntityId[]
}

/**
 * One Room (#67): a named, Floor-local area with an explicit outline and, optionally,
 * references from its Edges to the Wall faces it borders.
 *
 * Nothing here is derived: area, perimeter, the label anchor and which Placed Items sit in
 * it all come from `derive`, and the Renovation State comes from ownership like every other
 * element. Two Rooms on one Floor may share an edge or touch at a point but may never
 * overlap with positive area, which the strict validator and every proposal check enforce.
 */
export interface Room {
  id: EntityId
  floorId: EntityId
  /** Required, editable, non-empty, at most 80 characters. Not unique. */
  name: string
  outline: RoomOutline
  /** Every Edge of this outline that is referenced to a Wall face, in no particular order. */
  wallFaceRefs: RoomWallFaceRef[]
  /** The Room this one came out of (#69 §3, §10); absent on an Existing Model Room. */
  predecessorIds?: PredecessorIds
  /**
   * The Drawing Layer this Room belongs to (#71 §1); `null` is Unlayered, and absent is `null`.
   *
   * Presentation, never meaning: it changes which rows draw, in what order and whether they may be
   * picked here — not the Room's Renovation State, its Quantities or its warnings.
   */
  drawingLayerId?: EntityId | null
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
  /** The Opening this one came out of (#69 §3); absent on an Existing Model Opening. */
  predecessorIds?: PredecessorIds
  /**
   * The Drawing Layer this Opening belongs to (#71 §1); `null` is Unlayered, and absent is `null`.
   *
   * It follows its host Wall by default rather than by rule: a new Opening is created on Structure
   * like the Wall it is cut into, and hiding Structure hides both. Nothing derives one from the
   * other, because the user may put an Opening anywhere.
   */
  drawingLayerId?: EntityId | null
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
  /** The Wall this one came out of (#69 §3); absent on an Existing Model Wall. */
  predecessorIds?: PredecessorIds
  /**
   * The Drawing Layer this Wall belongs to (#71 §1); `null` is Unlayered, and absent is `null`.
   *
   * Presentation, never meaning: it changes which rows draw, in what order and whether they may be
   * picked here — not the Wall's Renovation State, its Quantities or its warnings. A successor
   * inherits it from its predecessor, because a replacement of a Services pipe is still Services.
   */
  drawingLayerId?: EntityId | null
}

/**
 * The parts of a Wall a later Anchor can name (#80 Decisions).
 *
 * The two ends of the reference line and the two faces read in the line's own direction — the same
 * four the Beam set derives from, spelled the same way, because a Wall and a Beam derive their faces
 * through one piece of geometry. The midpoint and the Junctions are absent: both move when anything
 * else does, which is the opposite of what a stable ID is for. The UI never shows these strings; it
 * labels a face by the Room on that side (#80 §8).
 */
export const WALL_FEATURE_IDS = ['start', 'end', 'leftFace', 'rightFace'] as const

/** One stable Wall feature. */
export type WallFeatureId = (typeof WALL_FEATURE_IDS)[number]

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
  /** The Junction this one came out of (#69 §3); absent on an Existing Model Junction. */
  predecessorIds?: PredecessorIds
}

/** One member end of a Junction, and the Wall end it holds. */
export interface WallJunctionEnd {
  wallId: EntityId
  end: WallEnd
}

/**
 * One Beam (#77): a documented horizontal member with a constant section and a constant Vertical
 * Extent, recorded for coordination and for nothing else.
 *
 * A Beam is the second Building Element to use the shared linear-element contract (#20 §7): a
 * straight reference line, one constant width, a justification, and faces derived through
 * `geometry.linearElement` exactly as a Wall's are. What it has no room for is a relationship. It
 * has no host and takes no Junction — moving a Wall never moves a Beam, and two Beams whose ends
 * overlap are two Beams, not one joint. It hosts nothing either: no Opening is cut into a Beam and
 * no Room Edge references one. It only ever snaps.
 *
 * The two vertical numbers are the ones a person measures: `underside` and `height`, both from the
 * Floor Datum, both in millimetres, both allowed to be negative. `height` is what the interface
 * calls **Depth**, and `underside + height` is the **Top** — neither is stored, because a Beam that
 * remembered its own top could disagree with its own Depth.
 */
export interface Beam {
  id: EntityId
  floorId: EntityId
  /**
   * The reference line, straight: a Beam has no arc. `start` and `end` are Floor-local millimetres,
   * and the line's own direction is what `left` and `right` of the justification mean.
   */
  line: { start: Point2; end: Point2 }
  /** Where the reference line sits within the width, relative to the line's own direction. */
  justification: WallJustification
  /** Millimetres, greater than 0: the constant section width. */
  width: number
  /** Millimetres from the Floor Datum; negative is valid. The bottom of the Vertical Extent. */
  underside: number
  /**
   * Millimetres, greater than 0: the constant Vertical Extent, shown to the user as **Depth**
   * (#77 §1). The Top is `underside + height`, derived and never stored.
   */
  height: number
  /**
   * The Beam's display name, `Beam B-1` by default, numbered within the Project and renameable.
   * Absent is legal and says only `Beam`.
   */
  label?: string
  /** The Beam this one came out of (#69 §3); absent on an Existing Model Beam. */
  predecessorIds?: PredecessorIds
  /**
   * The Drawing Layer this Beam belongs to (#71 §1); `null` is Unlayered, and absent is `null`.
   * New Beams default to `Structure` (#77 §4), and nothing derives one from a Wall it crosses.
   */
  drawingLayerId?: EntityId | null
}

/**
 * The parts of a Beam a later Anchor can name (#77 §1, for S10).
 *
 * These six strings are the whole stable vocabulary: the two ends of the reference line, the two
 * faces read in the line's own direction, and the two edges of the Vertical Extent. The midpoint of
 * the line is deliberately absent — it moves whenever either end does, which is the opposite of
 * what a stable ID is for.
 */
export const BEAM_FEATURE_IDS = ['start', 'end', 'leftFace', 'rightFace', 'underside', 'top'] as const

/** One stable Beam feature. */
export type BeamFeatureId = (typeof BEAM_FEATURE_IDS)[number]

/** The Top of a Beam: its Underside plus its Depth (#77 §1). */
export const beamTop = (beam: Beam): number => beam.underside + beam.height

/** The name a Beam is called by in a sentence, and on the plan. */
export const beamLabel = (beam: Beam): string => beam.label ?? 'Beam'

/**
 * Which face of the host Wall a Skirting is drawn against (#78 §1).
 *
 * This is the same vocabulary a Room Edge uses to say which face it rides (#67 §1) — `left` and
 * `right` read along the host Wall's own reference line — so one face named by two kinds of record
 * is one face. There is no `centre`: a Skirting lies flat against one face or the other, and a
 * record that said `centre` would describe a body buried inside the Wall.
 */
export type SkirtingSide = WallFaceSide

/**
 * One Skirting (#78): a range of one Wall face, recorded so a quantity and a drawing can be read
 * off it and so the gaps in it are derived rather than remembered.
 *
 * A Skirting is the third Building Element and the first one that is *host-parametric* rather than
 * free-standing: it has no line of its own. Where it is, is its host Wall's face — the tidied face
 * `deriveWalls` answers after Junctions are resolved, so a Skirting running into a corner stops
 * where the two Walls actually meet and not where the reference lines cross. What its body is, is
 * `thickness` millimetres off that face over the range `start`..`end`. The body is therefore never
 * stored: a Skirting that remembered its own polygon would disagree with the Wall it is drawn on
 * the first time that Wall is moved, thickened or joined.
 *
 * The two horizontal numbers are the range along the host's reference line, in millimetres from its
 * start — the same coordinates an Opening's `start` uses. The two vertical numbers are read from
 * the Floor Datum like every other Vertical Extent, and `bottom + height` is the Top, derived and
 * never stored.
 */
export interface Skirting {
  id: EntityId
  floorId: EntityId
  /** The one Wall this Skirting is drawn against. Never reassigned behind the user's back. */
  hostWallId: EntityId
  /** Which face of the host the body stands off. */
  side: SkirtingSide
  /** Millimetres along the host's reference line; the near end of the range. */
  start: number
  /** Millimetres along the host's reference line; the far end. Always greater than `start`. */
  end: number
  /** Millimetres from the Floor Datum; negative is valid. The bottom of the Vertical Extent. */
  bottom: number
  /** Millimetres, greater than 0. The Top is `bottom + height`, derived and never stored. */
  height: number
  /** Millimetres, greater than 0: how far the body stands off the host face. */
  thickness: number
  /**
   * The Skirting's display name, `Skirting SK-1` by default, numbered within the Project and
   * renameable. Absent is legal and says only `Skirting`.
   */
  label?: string
  /** The Skirting this one came out of (#69 §3); absent on an Existing Model Skirting. */
  predecessorIds?: PredecessorIds
  /**
   * The Drawing Layer this Skirting belongs to (#71 §1); `null` is Unlayered, and absent is `null`.
   * New Skirtings default to `Structure` (#78 §4), and nothing derives one from the Room it runs in.
   */
  drawingLayerId?: EntityId | null
}

/**
 * The parts of a Skirting a later Anchor can name (#78 §1).
 *
 * `start` and `end` are the two ends of the range along the host's reference line; `face` is the
 * host face it is drawn against; `bottom` and `top` are the two edges of its Vertical Extent. The
 * midpoint of the range is absent for the reason it is absent on a Beam: it moves when either end
 * does.
 */
export const SKIRTING_FEATURE_IDS = ['start', 'end', 'face', 'bottom', 'top'] as const

/** One stable Skirting feature. */
export type SkirtingFeatureId = (typeof SKIRTING_FEATURE_IDS)[number]

/** The Top of a Skirting: its bottom plus its height (#78 §1). */
export const skirtingTop = (skirting: Skirting): number => skirting.bottom + skirting.height

/** The name a Skirting is called by in a sentence, and on the plan. */
export const skirtingLabel = (skirting: Skirting): string => skirting.label ?? 'Skirting'

/**
 * What a Service is for (#79 §1): the six descriptive kinds the Services decision settles on.
 *
 * Kind is *data*, never the element's name: a Water service is a `Service`, and the Kind is what the
 * plan writes beside it. `other` is the kind that carries a free-text label as its display text,
 * which is why the record's {@link Service.label} is read for it and for nothing else.
 */
export type ServiceKind = 'water' | 'drain' | 'gas' | 'electrical' | 'air_con' | 'other'

/** Every Service Kind, in the order the inspector lists them. */
export const SERVICE_KINDS: readonly ServiceKind[] = Object.freeze([
  'water',
  'drain',
  'gas',
  'electrical',
  'air_con',
  'other',
])

/** Whether a Service is a straight Run or a vertical Riser (#79 §1). Fixed after creation. */
export type ServiceShape = 'run' | 'riser'

/** Every Service shape, in the order the tool offers them. */
export const SERVICE_SHAPES: readonly ServiceShape[] = Object.freeze(['run', 'riser'])

/**
 * The section of a Run (#79 §1): a round bar or a rectangular duct. A Riser is always round and
 * stores no section at all, so the field is absent there and the validator refuses one.
 */
export type ServiceSection = 'round' | 'rectangular'

/** Every Run section, in the order the inspector offers them. */
export const SERVICE_SECTIONS: readonly ServiceSection[] = Object.freeze(['round', 'rectangular'])

/** The fields every Service carries, whatever its shape. */
export interface ServiceBase {
  id: EntityId
  floorId: EntityId
  /** What this Service is for. Editable after creation; never the element's name. */
  kind: ServiceKind
  /**
   * The Service's display name. Absent is legal and says only `Service`; `other` shows this text on
   * the plan in place of its Kind code (#79 §6).
   */
  label?: string
  /** The Service this one came out of (#69 §3); absent on an Existing Model Service. */
  predecessorIds?: PredecessorIds
  /**
   * The Drawing Layer this Service belongs to (#71 §1); `null` is Unlayered, and absent is `null`.
   * New Services default to `Services` (#79 §6), and nothing derives one from a Wall it crosses.
   */
  drawingLayerId?: EntityId | null
}

/**
 * One Service Run (#79 §1): a single straight centreline at one constant section and one constant
 * centreline elevation.
 *
 * A Run is the third Building Element on the shared linear-element contract (#20 §7) and the one
 * the Services decision says reuses the Beam contract outright: a straight reference line, one
 * constant plan width, centre justification, faces derived through `geometry.linearElement`. What
 * makes it a Run and not a Beam is the vertical vocabulary. The one stored number is
 * `centrelineElevation` — the number a person measures to the middle of a pipe — and the Bottom and
 * Top of its Vertical Extent are arithmetic on it and on the section. Neither is stored, because a
 * Run that remembered its own Bottom could disagree with its own Diameter.
 *
 * The section is one of two shapes, and only the fields that shape has are present: a round Run
 * stores `outsideDiameter`, a rectangular Run stores `width` (across the Run in plan) and `depth`
 * (vertical). The other pair is absent, and the validator refuses it — a round pipe with a Width on
 * it is a record of two different pipes.
 */
export interface ServiceRun extends ServiceBase {
  readonly shape: 'run'
  section: ServiceSection
  /**
   * The centreline, straight: a Run has no arc and no slope. `start` and `end` are Floor-local
   * millimetres, and the line's own direction is what `left` and `right` of the footprint mean.
   */
  line: { start: Point2; end: Point2 }
  /** Millimetres from the Floor Datum; negative is valid. The middle of the Vertical Extent. */
  centrelineElevation: number
  /** Millimetres, greater than 0. Present exactly when `section` is `round`. */
  outsideDiameter?: number
  /** Millimetres, greater than 0: across the Run in plan. Present exactly when `section` is `rectangular`. */
  width?: number
  /** Millimetres, greater than 0: the vertical side. Present exactly when `section` is `rectangular`. */
  depth?: number
}

/**
 * One Service Riser (#79 §1): one plan point with a round outside diameter, running vertically.
 *
 * A Riser is not a linear element — it is a point plus a circle — which is why it stores a Bottom
 * and a Height rather than a centreline: a vertical bar's middle is the one number nobody measures.
 * `bottomElevation + height` is the Top, derived and never stored, on the Wall rule (#78). A Riser
 * that continues through several Floors is one independent element per Floor (#25), with nothing
 * linking the two records.
 */
export interface ServiceRiser extends ServiceBase {
  readonly shape: 'riser'
  /** The plan point the Riser passes through, in Floor-local millimetres. */
  point: Point2
  /** Millimetres, greater than 0. A Riser is always round. */
  outsideDiameter: number
  /** Millimetres from the Floor Datum; negative is valid. The bottom of the Vertical Extent. */
  bottomElevation: number
  /** Millimetres, greater than 0. The Top is `bottomElevation + height`, derived and never stored. */
  height: number
}

/**
 * One Service (#79): a documented pipe, duct or cable run, recorded for coordination and for nothing
 * else.
 *
 * A Service is the fourth Building Element and the second one that stands on its own line. It has no
 * host, no connection and no network: two Runs whose endpoints snap together are two Records, and
 * moving one never moves the other. What it stores is the whole of it — Kind, shape, section, one
 * line or one point, and the vertical numbers that shape has. There are no fittings, bends, slopes,
 * hosts, materials, size tables or capacities, and `checkUnknownFields` is what refuses one.
 */
export type Service = ServiceRun | ServiceRiser

/**
 * The parts of a Service Run a later Anchor can name (#79 §3, for S10).
 *
 * The two ends of the centreline, the two faces read along it, and the two edges of its Vertical
 * Extent. The midpoint of the line is absent for the reason it is absent on a Beam: it moves when
 * either end does.
 */
export const SERVICE_RUN_FEATURE_IDS = ['start', 'end', 'left', 'right', 'bottom', 'top'] as const

/** One stable Service Run feature. */
export type ServiceRunFeatureId = (typeof SERVICE_RUN_FEATURE_IDS)[number]

/**
 * The parts of a Service Riser a later Anchor can name (#79 §3, for S10).
 *
 * `axis` is the vertical centre line the Riser is drawn around, `outline` its circle, and `bottom`
 * and `top` the two ends of its Height.
 */
export const SERVICE_RISER_FEATURE_IDS = ['axis', 'bottom', 'top', 'outline'] as const

/** One stable Service Riser feature. */
export type ServiceRiserFeatureId = (typeof SERVICE_RISER_FEATURE_IDS)[number]

/** The bottom of a Service's Vertical Extent, in millimetres from the Floor Datum (#79 §1). */
export const serviceBottom = (service: Service): number =>
  service.shape === 'run'
    ? service.centrelineElevation - (service.section === 'round' ? (service.outsideDiameter ?? 0) / 2 : (service.depth ?? 0) / 2)
    : service.bottomElevation

/** The top of a Service's Vertical Extent, in millimetres from the Floor Datum (#79 §1). */
export const serviceTop = (service: Service): number =>
  service.shape === 'run'
    ? service.centrelineElevation + (service.section === 'round' ? (service.outsideDiameter ?? 0) / 2 : (service.depth ?? 0) / 2)
    : service.bottomElevation + service.height

/** The plan width a Run's footprint is built at: its outside diameter, or its rectangular Width. */
export const serviceRunWidth = (run: ServiceRun): number =>
  run.section === 'round' ? (run.outsideDiameter ?? 0) : (run.width ?? 0)

/** The name a Service is called by in a sentence. Kind is never this (#79 §1). */
export const serviceLabel = (service: Service): string => service.label ?? 'Service'

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
  /** The Placement this one came out of (#69 §3); absent on an Existing Model Placement. */
  predecessorIds?: PredecessorIds
  /**
   * The Drawing Layer this Placement belongs to (#71 §1); `null` is Unlayered, and absent is `null`.
   *
   * It is the Placement's own, not its Item Design's: one Cabinet Design may stand on `Kitchen` in
   * one view of the model and on `Furniture` in another Project, and a Design is shared by many
   * Placements.
   */
  drawingLayerId?: EntityId | null
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

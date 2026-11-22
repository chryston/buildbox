/**
 * The strict domain v1 validator (#42 §4): pure, synchronous, never throws, never
 * mutates its input, and reports every broken invariant with an exact path.
 *
 * Ordering is deterministic and independent of the input's key order: each object's
 * fields are checked in the order `project.ts` declares them, arrays in index order, and
 * a cabinet tree depth-first with each node's own fields before its children. An
 * object's unknown fields are reported after its known ones, sorted by key.
 *
 * Strictness is the point (#14): a field that is not in v1 is `unknown-field`, never
 * quietly dropped, so a newer schema has to arrive as a version bump through
 * `migrateProject` rather than as data this build cannot see. The legacy reader in
 * `package/legacy` stays deliberately lenient where this one is not — users' stored data
 * already carries the extra fields and duplicate node IDs that this rejects.
 *
 * Performance (#20 §8): one pass indexes the Project-wide IDs, the same pass collects
 * the reference targets, and the tree walks are iterative — a stored tree is untrusted
 * input, so recursion depth is not an option.
 */
import {
  arcFromThrough,
  fitOpening,
  PRESET_KINDS,
  refLength,
  refPointAt,
  toValidationProblems,
  distance,
  TOLERANCE_MM,
  usableIntervals,
} from '../geometry'
import type { ClosedPath, CornerRadii, JoinJunction, JoinWall, Preset, Pt, Segment, UsableInterval } from '../geometry'
import { ROOT_PATH, childPath, compareCodePoints, problem, type ValidationProblem } from '../lib'
import { MAX_TREE_DEPTH } from './cabinetPayload'
import { formatGeometryProblem, type DisplayFormat } from './formatGeometryProblem'
import { footprintProblems } from './footprint'
import { nameKey } from './floorNames'
import { fitProblem, openingNoun } from './openings'
import { roomFaceRelation, roomOutlineProblems, roomOverlaps, roomSegmentOf, roomSegments } from './rooms'
import { RENOVATION_DISPLAYS, UNLAYERED_LAYER_KEY } from './project'
import type { DisplayUnit, EntityId, ItemFootprint, OpeningKind, Project, Room, RoomOutline, RoomWallFaceRef, WallEnd, WallJustification, WallRefLine } from './project'
import type { WallSide } from '../geometry'
import { ACKNOWLEDGEMENT_NOTE_MAX_LENGTH, warningKey } from './warnings'

export type ValidateProjectResult =
  | { ok: true; project: Project }
  | { ok: false; problems: ValidationProblem[] }

const MISSING = 'missing-field'
const WRONG_TYPE = 'wrong-type'
const UNKNOWN_FIELD = 'unknown-field'
const BAD_ID = 'bad-id'
const DUPLICATE_ID = 'duplicate-id'
const EMPTY_TEXT = 'empty-text'
const NOT_ONE_OF = 'not-one-of'
const OUT_OF_RANGE = 'out-of-range'
const DUPLICATE_NAME = 'duplicate-name'
const BAD_FORMAT = 'bad-format'
const BAD_CHILDREN = 'bad-children'
const TREE_TOO_DEEP = 'tree-too-deep'
const DANGLING_REFERENCE = 'dangling-reference'
/** One thing claimed twice: a Wall end taken by two Junctions (#64 §2). */
const DUPLICATE_MEMBER = 'duplicate-member'

/** `EntityId` bounds (#42 §3): 1–128 UTF-16 code units, no control characters. */
const ID_MAX_LENGTH = 128

const ASSET_HASH = /^[0-9a-f]{64}$/
const COLOR = /^#[0-9a-f]{6}$/

const DISPLAY_UNITS = ['mm', 'cm', 'm'] as const
/** The three places the thickness sits relative to the reference line (#64 §1). */
const WALL_JUSTIFICATIONS = ['left', 'centre', 'right'] as const
const WALL_CLASSIFICATIONS = ['external', 'internal', 'partition'] as const
const WALL_LINE_KINDS = ['line', 'arc'] as const
const WALL_ENDS = ['start', 'end'] as const
const MEDIA_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/avif',
  'image/svg+xml',
] as const
const DESIGN_KINDS = ['cabinet', 'generic'] as const
const VIEW_KINDS = ['plan'] as const
const FOOTPRINT_KINDS = ['preset', 'path'] as const
const CABINET_UNITS = ['mm', 'cm', 'in'] as const
const MATERIALS = ['oak', 'walnut', 'white', 'birch', 'mdf'] as const
const SPLIT_AXES = ['horizontal', 'vertical'] as const
const ELEMENT_TYPES = ['void', 'drawer', 'hanging-space', 'microwave'] as const
const SLIDE_TYPES = ['side-mount', 'undermount'] as const
const ACCESSORY_TYPES = ['door', 'drawer-front', 'pull', 'hinge'] as const

// The field lists of §2, one per object level. `unknown-field` is reported against
// anything else the input carries at that level.
const PROJECT_FIELDS = ['id', 'meta', 'preferences', 'floors', 'views', 'drawingLayers', 'itemDesigns', 'existingModel', 'designOptions', 'warningAcknowledgements']
const META_FIELDS = ['name', 'address']
const PREFERENCES_FIELDS = ['displayUnit', 'displayPrecision', 'defaultWallHeight']
const FLOOR_FIELDS = ['id', 'name', 'planImage', 'limits', 'defaultWallHeight']
const FLOOR_LIMITS_FIELDS = ['lowerMm', 'upperMm']
const PLAN_VIEW_FIELDS = ['id', 'kind', 'floorId', 'name', 'isDefault', 'showPlanImage', 'designOptionId', 'renovationDisplay', 'layerSettings', 'layerOrder', 'activeLayerId', 'snapToHiddenContent']
/** One Drawing Layer (#71 §1): an immutable ID, an editable name and a Project default colour. */
const DRAWING_LAYER_FIELDS = ['id', 'name', 'color']
/** What one saved view says about one layer (#71 §3); `color` is the only field that may be absent. */
const LAYER_SETTING_FIELDS = ['visible', 'selectable', 'editable', 'color']
const PLAN_IMAGE_FIELDS = ['assetHash', 'mediaType', 'widthPx', 'heightPx', 'pixelsPerMm']
const CABINET_DESIGN_FIELDS = ['id', 'kind', 'name', 'construction']
const GENERIC_DESIGN_FIELDS = [
  'id', 'kind', 'name', 'footprint', 'origin', 'height', 'heightIsTypical', 'color',
  'catalogKey', 'isCustom',
]
// The Item Footprint of #58: a preset with parameters, or a Custom Path. Each preset kind
// has its own list, because `unknown-field` is what catches a radius left on a Rectangle.
const PRESET_FOOTPRINT_FIELDS = ['kind', 'preset', 'centre', 'orientationDeg']
const PATH_FOOTPRINT_FIELDS = ['kind', 'path']
const PRESET_FIELDS: Record<string, readonly string[]> = {
  square: ['kind', 'side'],
  rectangle: ['kind', 'width', 'depth'],
  roundedRectangle: ['kind', 'width', 'depth', 'radius', 'radii'],
  circle: ['kind', 'diameter'],
  ellipse: ['kind', 'width', 'depth'],
  capsule: ['kind', 'length', 'width'],
  triangle: ['kind', 'baseWidth', 'depth', 'apexOffset'],
  regularPolygon: ['kind', 'sideCount', 'sideLength'],
}
const CORNER_RADII_FIELDS = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft']
const CLOSED_PATH_FIELDS = ['start', 'segments']
const SEGMENT_FIELDS: Record<string, readonly string[]> = {
  line: ['kind', 'to'],
  arc: ['kind', 'to', 'center', 'sweepDeg'],
  ellipticalArc: ['kind', 'to', 'center', 'rx', 'ry', 'rotationDeg', 'sweepDeg'],
}
const SEGMENT_KINDS = ['line', 'arc', 'ellipticalArc'] as const
const POINT_FIELDS = ['x', 'y']
const EXISTING_MODEL_FIELDS = ['placedItems', 'walls', 'wallJunctions', 'openings', 'rooms']
/** A Design Option is a delta over the Existing Model, never a copy of it (#69 §2). */
const DESIGN_OPTION_FIELDS = ['id', 'name', 'proposed', 'demolishedIds']
/** The five collections of one Option's proposed work, in the shape the Existing Model uses. */
const PROPOSED_MODEL_FIELDS = ['walls', 'wallJunctions', 'openings', 'rooms', 'placedItems']
/** A Room's Edges are referenced to a Wall face on one of the reference line's two sides (#67 §1). */
const ROOM_FACE_SIDES = ['left', 'right']
const ROOM_FIELDS = ['id', 'floorId', 'name', 'outline', 'wallFaceRefs', 'predecessorIds', 'drawingLayerId']
const PRESET_ROOM_OUTLINE_FIELDS = ['kind', 'preset', 'centre', 'orientationDeg', 'segmentIds']
const PATH_ROOM_OUTLINE_FIELDS = ['kind', 'path', 'segmentIds']
const ROOM_FACE_REF_FIELDS = ['segmentId', 'wallId', 'side']
/** A Room name this long is a mistake, not a name; the UI caps the field at the same number. */
const ROOM_NAME_MAX_LENGTH = 80
/** A Design Option name this long is a mistake, not a name; the rename field caps at the same. */
const DESIGN_OPTION_NAME_MAX_LENGTH = 60
const OPENING_FIELDS = [
  'id',
  'floorId',
  'hostWallId',
  'kind',
  'label',
  'start',
  'width',
  'sill',
  'head',
  'swing',
  'hingeSide',
  'predecessorIds',
  'drawingLayerId',
]
/** The three kinds of Opening (#65 §1). */
const OPENING_KINDS = ['door', 'window', 'removed_section']
/** The CSV codes of export contract v1.0 (#68): stable words, never renamed. */
const OPENING_SWINGS = ['left', 'right', 'sliding']
const HINGE_SIDES = ['start', 'end']
const WALL_FIELDS = [
  'id',
  'ref',
  'floorId',
  'line',
  'thickness',
  'justification',
  'classification',
  'constructionLabel',
  'baseElevation',
  'height',
  'predecessorIds',
  'drawingLayerId',
]
/** The union's four members: a straight line uses three of them, an arc all four (#64 §1). */
const WALL_LINE_FIELDS = ['kind', 'start', 'end', 'through']
const WALL_JUNCTION_FIELDS = ['id', 'floorId', 'ends', 'host', 'predecessorIds']
const WALL_JUNCTION_END_FIELDS = ['wallId', 'end']
const WALL_HOST_FIELDS = ['wallId', 'at']
const PLACED_ITEM_FIELDS = ['id', 'itemDesignId', 'floorId', 'translation', 'rotationDeg', 'baseElevation', 'predecessorIds', 'drawingLayerId']
const ACKNOWLEDGEMENT_FIELDS = [
  'id',
  'warningType',
  'subjectIds',
  'designOptionId',
  'signature',
  'note',
  'acknowledgedAt',
]
/** A producer's stable code (#66 §1): `wall_crossing`, `wall_overlap`, … never `Wall Crossing`. */
const WARNING_TYPE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/
const CONSTRUCTION_FIELDS = ['settings', 'root']
const SETTINGS_FIELDS = [
  'unit', 'height', 'width', 'depth', 'thickness', 'backThickness', 'toeKick', 'material',
]
const TOE_KICK_FIELDS = ['height', 'setback']
const NODE_FIELDS = [
  'id', 'splitAxis', 'splitRatio', 'children', 'fixedSize', 'locked', 'spaceLabel',
  'elementType', 'drawerConfig', 'dividers', 'accessories',
]
const DRAWER_CONFIG_FIELDS = ['slideType', 'reveal']
const DIVIDER_FIELDS = ['id', 'materialId']
const ACCESSORY_FIELDS = ['id', 'type', 'label']

type Rec = Record<string, unknown>
type Add = (path: string, code: string, message: string) => void

/**
 * The entities one validation pass is asked to check (#69 §8).
 *
 * Whole-document validation is what loading and importing a Project do, and what every test gets
 * when it calls `validateProject` with no second argument. One Edit Transaction may not cost that:
 * architecture §4 scopes validation to what the transaction touched, so `applyIntent` hands the
 * validator the records it wrote plus every record that names one of them. Cross-references still
 * resolve, because the ID index, the Wall map, the Junction shapes, the Room outlines and the
 * overlap pool are built over the whole document either way — a scoped pass reports a dangling
 * reference just as readily, it simply does not re-derive the geometry of a record nothing touched.
 */
export interface ValidationScope {
  readonly entities: ReadonlySet<string>
}

type Checks = ValidationScope | null

/**
 * Whether this pass must check `raw`. `null` checks everything; a record the pass cannot identify
 * is always checked, because only a record with an ID can be proven untouched.
 */
const inScope = (checks: Checks, raw: unknown): boolean =>
  checks === null || !isRecord(raw) || typeof raw.id !== 'string' || raw.id === '' || checks.entities.has(raw.id)

const isRecord = (value: unknown): value is Rec =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasControlCharacter = (value: string): boolean => {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

// --- Field checks -------------------------------------------------------------

function checkUnknownFields(rec: Rec, path: string, known: readonly string[], add: Add): void {
  for (const key of Object.keys(rec).sort()) {
    // An `undefined`-valued key counts as absent, so it is neither a value nor an extra.
    if (rec[key] === undefined || known.includes(key)) continue
    add(childPath(path, key), UNKNOWN_FIELD, `Unknown field "${key}" — nothing in this schema writes it.`)
  }
}

/** A required text field; `null` when it is absent or not text. */
function checkText(value: unknown, path: string, what: string, add: Add): string | null {
  if (value === undefined) {
    add(path, MISSING, `Missing ${what}.`)
    return null
  }
  if (typeof value !== 'string') {
    add(path, WRONG_TYPE, `Expected ${what} written as text.`)
    return null
  }
  return value
}

/** A required text field that has to hold something once trimmed (#25, #13). */
function checkFilledText(value: unknown, path: string, what: string, add: Add): string | null {
  const text = checkText(value, path, what, add)
  if (text === null) return null
  if (text.trim() === '') {
    add(path, EMPTY_TEXT, `Expected ${what} to have something in it.`)
    return null
  }
  return text
}

/** An optional text field: absent is fine, present has to be text. */
function checkOptionalText(value: unknown, path: string, what: string, add: Add): void {
  if (value === undefined) return
  checkText(value, path, what, add)
}

/** An `EntityId` (#42 §3). Uniqueness is checked separately, project-wide. */
function checkEntityId(value: unknown, path: string, what: string, add: Add): string | null {
  const text = checkText(value, path, what, add)
  if (text === null) return null
  if (text.length === 0 || text.length > ID_MAX_LENGTH) {
    add(path, BAD_ID, `Expected ${what} to be 1 to ${ID_MAX_LENGTH} characters long.`)
    return null
  }
  if (text !== text.trim()) {
    add(path, BAD_ID, `Expected ${what} without leading or trailing spaces.`)
    return null
  }
  if (hasControlCharacter(text)) {
    add(path, BAD_ID, `Expected ${what} without control characters.`)
    return null
  }
  return text
}

/** A number in the JSON sense; rule 19 — `NaN` and `±Infinity` never pass. */
function checkNumber(value: unknown, path: string, what: string, add: Add): number | null {
  if (value === undefined) {
    add(path, MISSING, `Missing ${what}.`)
    return null
  }
  if (typeof value !== 'number') {
    add(path, WRONG_TYPE, `Expected ${what} written as a number.`)
    return null
  }
  if (!Number.isFinite(value)) {
    add(path, OUT_OF_RANGE, `Expected ${what} to be a finite number.`)
    return null
  }
  return value
}

function checkOptionalNumber(value: unknown, path: string, what: string, add: Add): number | null {
  if (value === undefined) return null
  return checkNumber(value, path, what, add)
}

function checkPositive(value: unknown, path: string, what: string, add: Add): void {
  const n = checkNumber(value, path, what, add)
  if (n !== null && n <= 0) add(path, OUT_OF_RANGE, `Expected ${what} greater than 0.`)
}

function checkNotNegative(value: unknown, path: string, what: string, add: Add): void {
  const n = checkNumber(value, path, what, add)
  if (n !== null && n < 0) add(path, OUT_OF_RANGE, `Expected ${what} of 0 or more.`)
}

function checkPositiveInteger(value: unknown, path: string, what: string, add: Add): void {
  const n = checkNumber(value, path, what, add)
  if (n === null) return
  if (!Number.isInteger(n)) {
    add(path, OUT_OF_RANGE, `Expected ${what} to be a whole number.`)
  } else if (n <= 0) {
    add(path, OUT_OF_RANGE, `Expected ${what} greater than 0.`)
  }
}

function checkRange(
  value: unknown,
  path: string,
  what: string,
  add: Add,
  inside: (n: number) => boolean,
  expected: string,
): void {
  const n = checkNumber(value, path, what, add)
  if (n !== null && !inside(n)) add(path, OUT_OF_RANGE, `Expected ${what} ${expected}.`)
}

function checkOneOf(
  value: unknown,
  path: string,
  what: string,
  allowed: readonly string[],
  add: Add,
): string | null {
  const text = checkText(value, path, what, add)
  if (text === null) return null
  if (!allowed.includes(text)) {
    add(path, NOT_ONE_OF, `Expected ${what} to be one of: ${allowed.join(', ')}.`)
    return null
  }
  return text
}

function checkOptionalOneOf(
  value: unknown,
  path: string,
  what: string,
  allowed: readonly string[],
  add: Add,
): void {
  if (value === undefined) return
  checkOneOf(value, path, what, allowed, add)
}

function checkBoolean(value: unknown, path: string, what: string, add: Add): void {
  if (value === undefined) {
    add(path, MISSING, `Missing ${what}.`)
  } else if (typeof value !== 'boolean') {
    add(path, WRONG_TYPE, `Expected ${what} written as yes or no.`)
  }
}

function checkOptionalBoolean(value: unknown, path: string, what: string, add: Add): void {
  if (value === undefined) return
  checkBoolean(value, path, what, add)
}

/**
 * A point in millimetres: both coordinates present and finite.
 *
 * The point comes back as well, because a footprint has to *use* the point it has just
 * checked — hand it to the geometry kernel to be validated — where every other point in the
 * schema is only checked.
 */
function readPoint(value: unknown, path: string, what: string, add: Add): Pt | null {
  if (value === undefined) {
    add(path, MISSING, `Missing ${what}.`)
    return null
  }
  if (!isRecord(value)) {
    add(path, WRONG_TYPE, `Expected ${what} as a point.`)
    return null
  }
  const x = checkNumber(value.x, childPath(path, 'x'), `${what} X`, add)
  const y = checkNumber(value.y, childPath(path, 'y'), `${what} Y`, add)
  checkUnknownFields(value, path, POINT_FIELDS, add)
  return x === null || y === null ? null : { x, y }
}

function checkArray(value: unknown, path: string, what: string, add: Add): unknown[] | null {
  if (value === undefined) {
    add(path, MISSING, `Missing ${what}.`)
    return null
  }
  if (!Array.isArray(value)) {
    add(path, WRONG_TYPE, `Expected ${what} as a list.`)
    return null
  }
  return value
}

// --- The Project-wide ID namespace --------------------------------------------

/**
 * One ID namespace covers `project.id`, every Floor, every Item Design and every Placed
 * Item — no two may be equal, whatever their kind (#42 §3). Cabinet feature IDs are not
 * in it: they are scoped to their own Item Design and addressed `(itemDesignId, nodeId)`
 * (ADR 0004), so the same node ID in two Item Designs is what a fork produces.
 *
 * One pass indexes the first path of every ID and the two reference targets, which keeps
 * the uniqueness and dangling-reference checks linear (#20 §8).
 */
interface IdIndex {
  /** Each ID to the path of its first occurrence. */
  first: Map<string, string>
  designIds: Set<string>
  floorIds: Set<string>
  /** Every entity ID of the Existing Model — the only thing a demolition record may name (#69 §4). */
  existingIds: Set<string>
  /** Every entity ID any Design Option proposes, for the message that says which kind it found. */
  proposedIds: Set<string>
  /** The subset of those that are Walls, which is what a Wall reference resolves against. */
  proposedWallIds: Set<string>
  /** Every Design Option ID, which is what an acknowledgement may name (#69 §4). */
  optionIds: Set<string>
  /** Every Drawing Layer ID (#71 §1), which is what an entity, a view setting and an order name. */
  layerIds: Set<string>
}

function indexIds(root: Rec): IdIndex {
  const first = new Map<string, string>()
  const designIds = new Set<string>()
  const floorIds = new Set<string>()
  const existingIds = new Set<string>()
  const proposedIds = new Set<string>()
  const proposedWallIds = new Set<string>()
  const optionIds = new Set<string>()
  const layerIds = new Set<string>()
  const claim = (value: unknown, path: string): void => {
    if (typeof value === 'string' && !first.has(value)) first.set(value, path)
  }
  /** One collection of entities, claimed into `first` and, when given, into ownership sets. */
  const claimIn = (owner: Rec | undefined, key: string, parent: string, into: readonly Set<string>[] = []): void => {
    const list = owner?.[key]
    if (!Array.isArray(list)) return
    const at = childPath(parent, key)
    list.forEach((entry, i) => {
      if (!isRecord(entry) || typeof entry.id !== 'string') return
      claim(entry.id, childPath(childPath(at, i), 'id'))
      for (const set of into) set.add(entry.id)
    })
  }

  claim(root.id, childPath(ROOT_PATH, 'id'))

  if (Array.isArray(root.floors)) {
    root.floors.forEach((floor, i) => {
      if (!isRecord(floor)) return
      claim(floor.id, childPath(childPath('floors', i), 'id'))
      if (typeof floor.id === 'string') floorIds.add(floor.id)
    })
  }
  if (Array.isArray(root.views)) {
    root.views.forEach((view, i) => {
      if (!isRecord(view)) return
      claim(view.id, childPath(childPath('views', i), 'id'))
    })
  }
  if (Array.isArray(root.itemDesigns)) {
    root.itemDesigns.forEach((design, i) => {
      if (!isRecord(design)) return
      claim(design.id, childPath(childPath('itemDesigns', i), 'id'))
      if (typeof design.id === 'string') designIds.add(design.id)
    })
  }
  // Entity IDs are unique project-wide, Design Option entities included (#69 §3): two Options
  // sharing an ID would make a demolition record and a predecessor reference ambiguous. What is
  // per-model instead is the `ref` label, which is why `validateWalls` is handed a fresh map.
  if (isRecord(root.existingModel)) {
    const model = root.existingModel
    for (const key of EXISTING_MODEL_FIELDS) claimIn(model, key, 'existingModel', [existingIds])
  }
  if (Array.isArray(root.designOptions)) {
    root.designOptions.forEach((option, i) => {
      if (!isRecord(option)) return
      claim(option.id, childPath(childPath('designOptions', i), 'id'))
      if (typeof option.id === 'string') optionIds.add(option.id)
      if (!isRecord(option.proposed)) return
      const proposedPath = childPath(childPath('designOptions', i), 'proposed')
      for (const key of PROPOSED_MODEL_FIELDS) {
        claimIn(option.proposed, key, proposedPath, key === 'walls' ? [proposedWallIds, proposedIds] : [proposedIds])
      }
    })
  }

  // Drawing Layer IDs (#71 §1).
  // Layer IDs are project-wide unique like everything else — a layer that borrows a Wall's ID makes
  // the file ambiguous about which one a "select by id" means — but they are looked up through
  // their own set, because a layer is not an entity: it is never referenced by a Wall end or a
  // demolition record, and every `drawingLayerId` answers to `layerIds` alone.
  if (Array.isArray(root.drawingLayers)) {
    root.drawingLayers.forEach((layer, i) => {
      if (!isRecord(layer) || typeof layer.id !== 'string') return
      const at = childPath(childPath('drawingLayers', i), 'id')
      claim(layer.id, at)
      layerIds.add(layer.id)
    })
  }

  if (Array.isArray(root.warningAcknowledgements)) {
    root.warningAcknowledgements.forEach((acknowledgement, i) => {
      if (isRecord(acknowledgement)) {
        claim(acknowledgement.id, childPath(childPath('warningAcknowledgements', i), 'id'))
      }
    })
  }

  return { first, designIds, floorIds, existingIds, proposedIds, proposedWallIds, optionIds, layerIds }
}

/** Rule 5: reported on every occurrence after the first, naming the first path. */
function claimId(id: string, path: string, what: string, index: IdIndex, add: Add): void {
  const first = index.first.get(id)
  if (first !== undefined && first !== path) {
    add(path, DUPLICATE_ID, `Expected ${what} to be unique in this Project — ${first} already uses it.`)
  }
}

// --- Who owns the model being validated (#69) ---------------------------------------

/**
 * Which model the references of the entity being validated resolve against (#69 §3, §4).
 *
 * The validator has always answered "does this reference name something?" against the Existing
 * Model, because the Existing Model was the only model. A Design Option is a delta, so its
 * references answer against the **effective** model — the Existing Model minus what this Option
 * demolishes, plus this Option's own work — and the difference has to be visible in the checks
 * rather than assumed: the same Wall ID is a valid host in one Option, a reference into another
 * Option's work in the next sentence, and a reference to something being demolished in the third.
 */
interface ModelScope {
  /** `null` for the Existing Model; the Option's ID (or its path) while one is in force. */
  optionId: string | null
  /** The Existing entities this Option removes. */
  demolished: ReadonlySet<string>
  /** Every entity ID any Option proposes, so a message can say which kind of thing was found. */
  proposedIds: ReadonlySet<string>
  /** The proposed Walls of *this* Option, which is the only set a reference may resolve to. */
  proposedWallIds: ReadonlySet<string>
}

const NO_IDS: ReadonlySet<string> = new Set<string>()

const EXISTING_SCOPE: ModelScope = { optionId: null, demolished: NO_IDS, proposedIds: NO_IDS, proposedWallIds: NO_IDS }

/**
 * The provenance chain of a proposed entity, and its absence on an Existing one (#69 §3).
 *
 * The field is optional in the TypeScript type because one `Wall` interface serves both roles, so
 * the two rules that tell the roles apart live here: an Existing entity must not carry it, and a
 * proposed one must — empty for work invented from nothing. Each predecessor then has to be a real
 * entity that this Option is entitled to call a predecessor: its own (a replace inside the Option),
 * or an Existing one this Option demolishes or replaces, which is what makes a renovation quantity
 * answer "like-for-like" instead of guessing.
 */
function checkPredecessorIds(raw: unknown, path: string, index: IdIndex, scope: ModelScope, add: Add): void {
  const at = childPath(path, 'predecessorIds')
  if (scope.optionId === null) {
    if (raw !== undefined) add(at, UNKNOWN_FIELD, 'Expected no predecessor of an Existing Model entity — the Existing Model is where provenance starts.')
    return
  }
  if (raw === undefined) {
    add(at, MISSING, 'Missing the predecessors of a proposed entity — an empty list for work invented from nothing.')
    return
  }
  const items = checkArray(raw, at, 'the predecessors', add)
  if (items === null) return
  const seen = new Set<string>()
  const order: string[] = []
  items.forEach((value, i) => {
    const here = childPath(at, i)
    const id = checkEntityId(value, here, 'a predecessor', add)
    if (id === null) return
    if (seen.has(id)) {
      add(here, DUPLICATE_ID, 'Expected each predecessor once.')
      return
    }
    seen.add(id)
    order.push(id)
    if (scope.proposedWallIds.has(id)) {
      add(here, DANGLING_REFERENCE, 'Expected a predecessor to be an Existing Model entity — a successor goes back to the entity that was there, never to another proposed one.')
      return
    }
    if (index.proposedIds.has(id)) {
      add(here, DANGLING_REFERENCE, 'Expected a predecessor to belong to this Design Option or the Existing Model — this one is proposed work of another Option.')
      return
    }
    if (!index.existingIds.has(id)) {
      add(here, DANGLING_REFERENCE, `Expected a predecessor to be an entity of this Project — no entity has ID ${id}.`)
      return
    }
    if (!scope.demolished.has(id)) {
      add(here, DANGLING_REFERENCE, 'Expected a predecessor to be an entity this Option demolishes or replaces — this one still stands as it is.')
    }
  })
  const sorted = [...order].sort(compareCodePoints)
  if (order.some((id, i) => id !== sorted[i])) add(at, BAD_FORMAT, 'Expected the predecessors sorted, the way the model stores them.')
}

/**
 * The Drawing Layer a drawable entity belongs to (#71 §1).
 *
 * Three shapes, all valid: absent (an entity written before the capability), `null` (Unlayered, the
 * bucket the user put it back in) and an ID that names a layer of this Project. What is refused is
 * the fourth — an ID of a layer that was deleted, which would draw an entity that belongs to no row
 * of the Layers list and could never be reached again to be moved.
 *
 * The same check runs on every proposed entity of every Design Option, because a layer is a Project
 * concept: deleting one clears it from the Existing Model and from all the Options at once.
 */
function checkDrawingLayerId(value: unknown, path: string, what: string, index: IdIndex, add: Add): void {
  if (value === undefined || value === null) return
  const at = childPath(path, 'drawingLayerId')
  const id = checkEntityId(value, at, what, add)
  if (id === null || index.layerIds.has(id)) return
  add(at, DANGLING_REFERENCE, `Expected ${what} to name a Drawing Layer of this Project — no Drawing Layer has this ID.`)
}

// --- The v1 shapes, in the order project.ts declares them ----------------------

function validateMeta(raw: unknown, path: string, add: Add): void {
  if (raw === undefined) {
    add(path, MISSING, 'Missing the Project details.')
    return
  }
  if (!isRecord(raw)) {
    add(path, WRONG_TYPE, 'Expected the Project details.')
    return
  }
  checkFilledText(raw.name, childPath(path, 'name'), 'the Project name', add)
  if (raw.address !== undefined) {
    const addressPath = childPath(path, 'address')
    const address = checkText(raw.address, addressPath, 'the Project address', add)
    // Clearing the field removes the key, so an empty one is a bug, not a blank line (#13).
    if (address !== null && address.trim() === '') {
      add(addressPath, EMPTY_TEXT, 'Expected the Project address to have something in it, or the field removed.')
    }
  }
  checkUnknownFields(raw, path, META_FIELDS, add)
}

function validatePreferences(raw: unknown, path: string, add: Add): void {
  if (raw === undefined) {
    add(path, MISSING, 'Missing the Project preferences.')
    return
  }
  if (!isRecord(raw)) {
    add(path, WRONG_TYPE, 'Expected the Project preferences.')
    return
  }
  checkOneOf(raw.displayUnit, childPath(path, 'displayUnit'), 'the display unit', DISPLAY_UNITS, add)
  checkRange(
    raw.displayPrecision,
    childPath(path, 'displayPrecision'),
    'the display precision',
    add,
    (n) => Number.isInteger(n) && n >= 0 && n <= 4,
    'to be a whole number from 0 to 4',
  )
  checkPositive(raw.defaultWallHeight, childPath(path, 'defaultWallHeight'), 'the default Wall height', add)
  checkUnknownFields(raw, path, PREFERENCES_FIELDS, add)
}

function validatePlanImage(raw: unknown, path: string, add: Add): void {
  if (raw === undefined) {
    add(path, MISSING, 'Missing the Plan Image, or null when this Floor has none.')
    return
  }
  if (raw === null) return
  if (!isRecord(raw)) {
    add(path, WRONG_TYPE, 'Expected the Plan Image, or null when this Floor has none.')
    return
  }

  const hashPath = childPath(path, 'assetHash')
  const assetHash = checkText(raw.assetHash, hashPath, 'the Plan Image asset hash', add)
  if (assetHash !== null && !ASSET_HASH.test(assetHash)) {
    add(hashPath, BAD_FORMAT, 'Expected the Plan Image asset hash as 64 lowercase hexadecimal characters.')
  }
  checkOneOf(raw.mediaType, childPath(path, 'mediaType'), 'the Plan Image media type', MEDIA_TYPES, add)
  checkPositiveInteger(raw.widthPx, childPath(path, 'widthPx'), 'the Plan Image width in pixels', add)
  checkPositiveInteger(raw.heightPx, childPath(path, 'heightPx'), 'the Plan Image height in pixels', add)
  if (raw.pixelsPerMm === undefined) {
    add(childPath(path, 'pixelsPerMm'), MISSING, 'Missing the Plan Image scale, or null when it is uncalibrated.')
  } else if (raw.pixelsPerMm !== null) {
    checkPositive(raw.pixelsPerMm, childPath(path, 'pixelsPerMm'), 'the Plan Image scale', add)
  }
  checkUnknownFields(raw, path, PLAN_IMAGE_FIELDS, add)
}

/**
 * The Floor's own vertical extent (#56): either bound optional, each a finite number of
 * millimetres from the Floor Datum, and `lowerMm` never above `upperMm` when both are
 * given. An empty `{}` is legal — it says the user opened the fields and set neither.
 */
function validateFloorLimits(raw: unknown, path: string, add: Add): void {
  if (raw === undefined) return
  if (!isRecord(raw)) {
    add(path, WRONG_TYPE, 'Expected the Floor limits as an object, or nothing at all.')
    return
  }
  // Either bound on its own is a Floor with a limit; only a bound that is present has to
  // be a number.
  const lowerMm = checkOptionalNumber(raw.lowerMm, childPath(path, 'lowerMm'), 'the Floor lower limit in millimetres', add)
  const upperMm = checkOptionalNumber(raw.upperMm, childPath(path, 'upperMm'), 'the Floor upper limit in millimetres', add)
  if (lowerMm !== null && upperMm !== null && lowerMm > upperMm) {
    add(
      childPath(path, 'lowerMm'),
      OUT_OF_RANGE,
      'Expected the lower limit to be at or below the upper limit — this Floor measures the other way round.',
    )
  }
  checkUnknownFields(raw, path, FLOOR_LIMITS_FIELDS, add)
}

function validateFloor(
  raw: unknown,
  path: string,
  index: IdIndex,
  names: Map<string, string>,
  add: Add,
): void {
  if (!isRecord(raw)) {
    add(path, WRONG_TYPE, 'Expected a Floor.')
    return
  }
  const idPath = childPath(path, 'id')
  const id = checkEntityId(raw.id, idPath, 'the Floor ID', add)
  if (id !== null) claimId(id, idPath, 'the Floor ID', index, add)

  const namePath = childPath(path, 'name')
  const name = checkFilledText(raw.name, namePath, 'the Floor name', add)
  if (name !== null) {
    // Case-insensitive uniqueness, so "Floor 1" and " floor 1 " cannot coexist (#25).
    const key = nameKey(name)
    const first = names.get(key)
    if (first === undefined) names.set(key, namePath)
    else add(namePath, DUPLICATE_NAME, `Expected a Floor name nobody else uses — ${first} already has this one.`)
  }

  validatePlanImage(raw.planImage, childPath(path, 'planImage'), add)
  validateFloorLimits(raw.limits, childPath(path, 'limits'), add)
  // An optional per-Floor override of the Project's default Wall height (#64 §3): absent
  // means "use the Project's", so it is never written with a value that means nothing.
  if (raw.defaultWallHeight !== undefined) {
    checkPositive(raw.defaultWallHeight, childPath(path, 'defaultWallHeight'), 'the default Wall height for this Floor', add)
  }
  checkUnknownFields(raw, path, FLOOR_FIELDS, add)
}

function validateFloors(raw: unknown, path: string, index: IdIndex, add: Add): void {
  const floors = checkArray(raw, path, 'the Floors', add)
  if (floors === null) return
  // A Project with no Floors is valid (#13); the name index belongs to this one Project.
  const names = new Map<string, string>()
  floors.forEach((floor, i) => validateFloor(floor, childPath(path, i), index, names, add))
}

/**
 * The Project's Drawing Layers (#71 §1), in the Project layer order.
 *
 * A Project with no layers at all is valid — that is what a Project written before #71 reads as,
 * with everything Unlayered — so this function checks what is there and never insists on a minimum.
 * Names are free text and are not unique: two layers may both be called `Services`, and the Layers
 * list tells them apart by colour and by the entities on them.
 */
function validateDrawingLayers(raw: unknown, path: string, index: IdIndex, add: Add): void {
  if (raw === undefined) return
  const layers = checkArray(raw, path, 'the Drawing Layers', add)
  if (layers === null) return
  layers.forEach((layer, i) => {
    const at = childPath(path, i)
    if (!isRecord(layer)) {
      add(at, WRONG_TYPE, 'Expected a Drawing Layer.')
      return
    }
    const idPath = childPath(at, 'id')
    const id = checkEntityId(layer.id, idPath, 'the Drawing Layer ID', add)
    if (id !== null) {
      // Layer IDs are unique in the whole Project (#71 §1), the same rule every other ID follows:
      // a layer that borrows a Wall's ID leaves the file ambiguous about which one is meant.
      const first = index.first.get(id)
      if (first !== undefined && first !== idPath) {
        add(idPath, DUPLICATE_ID, `Expected a Drawing Layer ID to be unique in this Project — ${first} already uses it.`)
      }
      // The reserved key of Unlayered is a key in `layerSettings`, never a layer's ID: a layer that
      // took it would answer to the same key twice and could not be told apart from Unlayered.
      if (id === UNLAYERED_LAYER_KEY) {
        add(idPath, BAD_ID, `Expected a Drawing Layer not to use "${UNLAYERED_LAYER_KEY}" — that ID belongs to Unlayered content.`)
      }
    }
    checkFilledText(layer.name, childPath(at, 'name'), 'the Drawing Layer name', add)
    const color = checkText(layer.color, childPath(at, 'color'), 'the Drawing Layer colour', add)
    if (color !== null && !COLOR.test(color)) {
      add(childPath(at, 'color'), BAD_FORMAT, 'Expected the Drawing Layer colour as #rrggbb in lowercase hex.')
    }
    checkUnknownFields(layer, at, DRAWING_LAYER_FIELDS, add)
  })
}

/**
 * What one saved view says about each layer (#71 §3), keyed by layer ID plus `unlayered`.
 *
 * A key that names no layer is refused rather than ignored: it is a setting for a layer that was
 * deleted, and `layer.delete` removes these keys from every view precisely so that none is left
 * behind holding a switch nobody can reach.
 */
function validateViewLayerSettings(raw: unknown, path: string, index: IdIndex, add: Add): void {
  if (raw === undefined) return
  const at = childPath(path, 'layerSettings')
  if (!isRecord(raw)) {
    add(at, WRONG_TYPE, 'Expected the layer settings of a Plan View as a list keyed by layer.')
    return
  }
  for (const key of Object.keys(raw).sort()) {
    const entryPath = childPath(at, key)
    if (key !== UNLAYERED_LAYER_KEY && !index.layerIds.has(key)) {
      add(
        entryPath,
        DANGLING_REFERENCE,
        `Expected each layer setting to name a Drawing Layer of this Project or "${UNLAYERED_LAYER_KEY}" — no Drawing Layer has this ID.`,
      )
      continue
    }
    const setting = raw[key]
    if (!isRecord(setting)) {
      add(entryPath, WRONG_TYPE, 'Expected the setting for one layer as its visibility, selectability and editability.')
      continue
    }
    // All three switches are required once a view says anything about a layer: a half-written
    // setting would leave the other two to a default the file does not state.
    checkBoolean(setting.visible, childPath(entryPath, 'visible'), 'whether this layer is visible in this Plan View', add)
    checkBoolean(setting.selectable, childPath(entryPath, 'selectable'), 'whether this layer is selectable in this Plan View', add)
    checkBoolean(setting.editable, childPath(entryPath, 'editable'), 'whether this layer is editable in this Plan View', add)
    if (setting.color !== undefined) {
      const color = checkText(setting.color, childPath(entryPath, 'color'), 'the layer colour override', add)
      if (color !== null && !COLOR.test(color)) {
        add(childPath(entryPath, 'color'), BAD_FORMAT, 'Expected the layer colour override as #rrggbb in lowercase hex.')
      }
    }
    checkUnknownFields(setting, entryPath, LAYER_SETTING_FIELDS, add)
  }
}

/**
 * A view's own layer order (#71 §3): a complete order over every layer plus Unlayered, each exactly
 * once, or `null` for `Use Project layer order`.
 *
 * Complete rather than partial on purpose. A partial order would leave a layer with no place in the
 * list, and a layer with no place cannot be shown, hidden or made Active from the list — so a layer
 * added after the override was written is refused here and repaired by `view.setLayerOrder`, which
 * rewrites the whole array.
 */
function validateViewLayerOrder(raw: unknown, path: string, index: IdIndex, add: Add): void {
  if (raw === undefined || raw === null) return
  const at = childPath(path, 'layerOrder')
  const keys = checkArray(raw, at, 'the layer order of a Plan View', add)
  if (keys === null) return
  const seen = new Set<string>()
  const named = new Set<string>()
  keys.forEach((value, i) => {
    const here = childPath(at, i)
    const key = checkText(value, here, 'a layer in the layer order', add)
    if (key === null) return
    if (key !== UNLAYERED_LAYER_KEY && !index.layerIds.has(key)) {
      add(here, DANGLING_REFERENCE, 'Expected the layer order of a Plan View to name a Drawing Layer of this Project or Unlayered.')
      return
    }
    if (seen.has(key)) {
      add(here, DUPLICATE_MEMBER, `Expected each layer once in the layer order — this order already lists "${key}".`)
      return
    }
    seen.add(key)
    if (key !== UNLAYERED_LAYER_KEY) named.add(key)
  })
  if (!seen.has(UNLAYERED_LAYER_KEY)) {
    add(at, MISSING, `Expected the layer order of a Plan View to list Unlayered too — it is a row of the list like any layer.`)
  }
  for (const id of index.layerIds) {
    if (named.has(id)) continue
    add(at, MISSING, `Expected the layer order of a Plan View to cover every Drawing Layer — it leaves out the layer "${id}".`)
  }
}

function validatePlanView(
  raw: unknown,
  path: string,
  index: IdIndex,
  names: Map<string, string>,
  add: Add,
): void {
  if (!isRecord(raw)) {
    add(path, WRONG_TYPE, 'Expected a Plan View.')
    return
  }
  const idPath = childPath(path, 'id')
  const id = checkEntityId(raw.id, idPath, 'the Plan View ID', add)
  if (id !== null) claimId(id, idPath, 'the Plan View ID', index, add)

  checkOneOf(raw.kind, childPath(path, 'kind'), 'the Plan View kind', VIEW_KINDS, add)
  const floorId = checkEntityId(raw.floorId, childPath(path, 'floorId'), 'the Plan View Floor ID', add)
  if (floorId !== null && !index.floorIds.has(floorId)) {
    add(
      childPath(path, 'floorId'),
      DANGLING_REFERENCE,
      'Expected a Plan View to look at a Floor in this Project — no Floor has this ID.',
    )
  }

  const namePath = childPath(path, 'name')
  const name = checkFilledText(raw.name, namePath, 'the Plan View name', add)
  if (name !== null) {
    // Unique among the views of one Floor, ignoring case (#56): "Kitchen" and "kitchen"
    // are the same choice twice. The Floor is part of the key because two Floors may each
    // have a view called "Plan".
    const key = `${floorId ?? ''}\u0000${nameKey(name)}`
    const first = names.get(key)
    if (first === undefined) names.set(key, namePath)
    else
      add(
        namePath,
        DUPLICATE_NAME,
        `Expected a Plan View name this Floor does not already use — ${first} already has this one.`,
      )
  }

  checkBoolean(raw.isDefault, childPath(path, 'isDefault'), 'whether this is the default Plan View of the Floor', add)
  checkBoolean(raw.showPlanImage, childPath(path, 'showPlanImage'), 'whether this Plan View draws the Plan Image', add)

  // The Design Option this view looks through (#70 §1). An absent field is a view written before
  // the capability, and `null` is the Existing Model alone — both valid, and valid for **every**
  // Display: a Demolition, Proposed or Combined view with no Option is the error state §6 draws on
  // the canvas, not an import error, so this field and the Display below are never checked against
  // each other. What is refused is a name this Project does not have: a view pointing at a deleted
  // Option would draw a canvas that promises an Option nobody can choose.
  if (raw.designOptionId !== undefined && raw.designOptionId !== null) {
    const optionPath = childPath(path, 'designOptionId')
    const optionId = checkEntityId(raw.designOptionId, optionPath, 'the Plan View Design Option ID', add)
    if (optionId !== null && !index.optionIds.has(optionId)) {
      add(
        optionPath,
        DANGLING_REFERENCE,
        'Expected the Design Option of a Plan View to be a Design Option of this Project — no Design Option has this ID.',
      )
    }
  }
  checkOptionalOneOf(raw.renovationDisplay, childPath(path, 'renovationDisplay'), 'the Plan View Renovation Display', RENOVATION_DISPLAYS, add)

  // The Drawing Layer settings of this view (#71 §3). Every one of the four is optional in the type
  // and every one of them is checked against the Project's layers, because a saved view is the one
  // place a layer setting can outlive the layer it was written for.
  validateViewLayerSettings(raw.layerSettings, path, index, add)
  validateViewLayerOrder(raw.layerOrder, path, index, add)
  if (raw.activeLayerId !== undefined && raw.activeLayerId !== null) {
    const activePath = childPath(path, 'activeLayerId')
    const activeId = checkEntityId(raw.activeLayerId, activePath, 'the Active Layer', add)
    if (activeId !== null && !index.layerIds.has(activeId)) {
      add(
        activePath,
        DANGLING_REFERENCE,
        'Expected the Active Layer of a Plan View to be a Drawing Layer of this Project — no Drawing Layer has this ID.',
      )
    }
  }
  checkOptionalBoolean(raw.snapToHiddenContent, childPath(path, 'snapToHiddenContent'), 'whether this view snaps to hidden content', add)

  checkUnknownFields(raw, path, PLAN_VIEW_FIELDS, add)
}

/**
 * The saved Plan Views (#56). Each references a Floor that exists, each Floor carries
 * exactly one default view, and no two views of one Floor share a name. A Project with no
 * Floors carries no views either, so an empty list is valid for the same reason #13 gives
 * for empty Floors.
 */
function validateViews(raw: unknown, path: string, index: IdIndex, add: Add): void {
  const views = checkArray(raw, path, 'the Plan Views', add)
  if (views === null) return
  const names = new Map<string, string>()
  // Floor ID → how many default views point at it, counted in one pass so the report can
  // name the Floor that has none as well as the one that has three.
  const defaults = new Map<string, number>()
  views.forEach((view, i) => validatePlanView(view, childPath(path, i), index, names, add))
  views.forEach((view) => {
    if (!isRecord(view) || typeof view.floorId !== 'string') return
    if (view.isDefault === true) defaults.set(view.floorId, (defaults.get(view.floorId) ?? 0) + 1)
  })
  for (const floorId of index.floorIds) {
    const count = defaults.get(floorId) ?? 0
    if (count === 1) continue
    add(
      path,
      count === 0 ? MISSING : DUPLICATE_ID,
      count === 0
        ? `Expected every Floor to have a default Plan View — the Floor "${floorId}" has none.`
        : `Expected one default Plan View per Floor — the Floor "${floorId}" has ${count}.`,
    )
  }
  views.forEach((view, i) => {
    if (!isRecord(view)) return
    if (view.isDefault !== true) return
    const floorId = typeof view.floorId === 'string' ? view.floorId : ''
    if ((defaults.get(floorId) ?? 0) > 1) {
      add(
        childPath(childPath(path, i), 'isDefault'),
        DUPLICATE_ID,
        `Expected one default Plan View per Floor — the Floor "${floorId}" has more than one.`,
      )
    }
  })
}

// --- The cabinet payload ------------------------------------------------------

/** Feature IDs (`CabinetNode.id`, `Divider.id`, `Accessory.id`) unique in one design. */
type ClaimFeature = (value: unknown, path: string, what: string) => void

function validateSettings(raw: unknown, path: string, add: Add): void {
  if (raw === undefined) {
    add(path, MISSING, 'Missing the cabinet settings.')
    return
  }
  if (!isRecord(raw)) {
    add(path, WRONG_TYPE, 'Expected the cabinet settings.')
    return
  }
  checkOneOf(raw.unit, childPath(path, 'unit'), 'the cabinet editor unit', CABINET_UNITS, add)
  checkPositive(raw.height, childPath(path, 'height'), 'the cabinet height', add)
  checkPositive(raw.width, childPath(path, 'width'), 'the cabinet width', add)
  checkPositive(raw.depth, childPath(path, 'depth'), 'the cabinet depth', add)
  checkPositive(raw.thickness, childPath(path, 'thickness'), 'the panel thickness', add)
  checkNotNegative(raw.backThickness, childPath(path, 'backThickness'), 'the back panel thickness', add)
  if (raw.toeKick === undefined) {
    add(childPath(path, 'toeKick'), MISSING, 'Missing the toe kick, or null when the cabinet has none.')
  } else if (raw.toeKick !== null) {
    const toeKickPath = childPath(path, 'toeKick')
    if (!isRecord(raw.toeKick)) {
      add(toeKickPath, WRONG_TYPE, 'Expected the toe kick, or null when the cabinet has none.')
    } else {
      checkNotNegative(raw.toeKick.height, childPath(toeKickPath, 'height'), 'the toe kick height', add)
      checkNotNegative(raw.toeKick.setback, childPath(toeKickPath, 'setback'), 'the toe kick setback', add)
      checkUnknownFields(raw.toeKick, toeKickPath, TOE_KICK_FIELDS, add)
    }
  }
  checkOneOf(raw.material, childPath(path, 'material'), 'the cabinet material', MATERIALS, add)
  checkUnknownFields(raw, path, SETTINGS_FIELDS, add)
}

function validateDrawerConfig(raw: unknown, path: string, add: Add): void {
  if (!isRecord(raw)) {
    add(path, WRONG_TYPE, 'Expected the drawer runners and reveal.')
    return
  }
  checkOneOf(raw.slideType, childPath(path, 'slideType'), 'the drawer runner type', SLIDE_TYPES, add)
  checkNotNegative(raw.reveal, childPath(path, 'reveal'), 'the drawer reveal', add)
  checkUnknownFields(raw, path, DRAWER_CONFIG_FIELDS, add)
}

function validateDividers(raw: unknown, path: string, claimFeature: ClaimFeature, add: Add): void {
  const dividers = checkArray(raw, path, 'the dividers', add)
  if (dividers === null) return
  dividers.forEach((divider, i) => {
    const at = childPath(path, i)
    if (!isRecord(divider)) {
      add(at, WRONG_TYPE, 'Expected a divider.')
      return
    }
    claimFeature(divider.id, childPath(at, 'id'), 'the divider ID')
    checkOneOf(divider.materialId, childPath(at, 'materialId'), 'the divider material', MATERIALS, add)
    checkUnknownFields(divider, at, DIVIDER_FIELDS, add)
  })
}

function validateAccessories(raw: unknown, path: string, claimFeature: ClaimFeature, add: Add): void {
  const accessories = checkArray(raw, path, 'the accessories', add)
  if (accessories === null) return
  accessories.forEach((accessory, i) => {
    const at = childPath(path, i)
    if (!isRecord(accessory)) {
      add(at, WRONG_TYPE, 'Expected an accessory.')
      return
    }
    claimFeature(accessory.id, childPath(at, 'id'), 'the accessory ID')
    checkOneOf(accessory.type, childPath(at, 'type'), 'the accessory type', ACCESSORY_TYPES, add)
    checkOptionalText(accessory.label, childPath(at, 'label'), 'the accessory label', add)
    checkUnknownFields(accessory, at, ACCESSORY_FIELDS, add)
  })
}

/** One space of the cabinet tree, and everything the space itself carries. */
function validateNode(node: Rec, path: string, claimFeature: ClaimFeature, add: Add): void {
  claimFeature(node.id, childPath(path, 'id'), 'the space ID')
  checkOptionalOneOf(node.splitAxis, childPath(path, 'splitAxis'), 'the split direction', SPLIT_AXES, add)
  if (node.splitRatio !== undefined) {
    checkRange(
      node.splitRatio,
      childPath(path, 'splitRatio'),
      'the split share',
      add,
      (n) => n > 0 && n < 1,
      'between 0 and 1',
    )
  }

  const children = node.children
  const hasChildren = children !== undefined
  const hasAxis = node.splitAxis !== undefined
  if (hasChildren && (!Array.isArray(children) || children.length !== 2)) {
    add(childPath(path, 'children'), BAD_CHILDREN, 'A split space needs exactly two spaces under it.')
  } else if (!hasChildren && hasAxis) {
    add(childPath(path, 'children'), BAD_CHILDREN, 'A split direction needs exactly two spaces under it.')
  }
  if (hasChildren && !hasAxis) {
    add(childPath(path, 'splitAxis'), BAD_CHILDREN, 'A space with two spaces under it needs a split direction.')
  }

  if (node.fixedSize !== undefined) {
    checkPositive(node.fixedSize, childPath(path, 'fixedSize'), 'the pinned size', add)
  }
  checkOptionalBoolean(node.locked, childPath(path, 'locked'), 'the pinned flag', add)
  checkOptionalText(node.spaceLabel, childPath(path, 'spaceLabel'), 'the space label', add)
  checkOptionalOneOf(node.elementType, childPath(path, 'elementType'), 'the void kind', ELEMENT_TYPES, add)
  if (node.drawerConfig !== undefined) {
    validateDrawerConfig(node.drawerConfig, childPath(path, 'drawerConfig'), add)
  }
  if (node.dividers !== undefined) {
    validateDividers(node.dividers, childPath(path, 'dividers'), claimFeature, add)
  }
  if (node.accessories !== undefined) {
    validateAccessories(node.accessories, childPath(path, 'accessories'), claimFeature, add)
  }
  checkUnknownFields(node, path, NODE_FIELDS, add)
}

/** The node objects on the path to the node being visited, innermost first. */
type Ancestors = { node: object; parent: Ancestors | null }

function reachableFrom(ancestors: Ancestors | null, node: object): boolean {
  for (let walk = ancestors; walk !== null; walk = walk.parent) {
    if (walk.node === node) return true
  }
  return false
}

interface TreeStep {
  node: Rec
  path: string
  depth: number
  ancestors: Ancestors | null
}

/**
 * The iterative tree walk (#20 §8): a stored tree is untrusted input, so recursion depth
 * is not an option. Depth is bounded by `MAX_TREE_DEPTH` — reported once against the
 * root, then descent stops — and an identity cycle is caught against the ancestor chain,
 * which keeps a shared-but-acyclic space legal, as the legacy reader does.
 */
function validateTree(rawRoot: unknown, rootPath: string, add: Add): void {
  if (rawRoot === undefined) {
    add(rootPath, MISSING, 'Missing the cabinet layout.')
    return
  }
  if (!isRecord(rawRoot)) {
    add(rootPath, WRONG_TYPE, 'Expected the cabinet layout as a tree of spaces.')
    return
  }

  // Feature IDs share one namespace per Item Design, never the Project's (#42 §3).
  const features = new Map<string, string>()
  const claimFeature: ClaimFeature = (value, path, what) => {
    if (value === undefined) {
      add(path, MISSING, `Missing ${what}.`)
      return
    }
    if (typeof value !== 'string') {
      add(path, WRONG_TYPE, `Expected ${what} written as text.`)
      return
    }
    const first = features.get(value)
    if (first === undefined) features.set(value, path)
    else add(path, DUPLICATE_ID, `Expected ${what} to be unique in this Item Design — ${first} already uses it.`)
  }

  let tooDeepReported = false
  const stack: TreeStep[] = [{ node: rawRoot, path: rootPath, depth: 0, ancestors: null }]

  while (stack.length > 0) {
    const { node, path, depth, ancestors } = stack.pop() as TreeStep
    if (depth > MAX_TREE_DEPTH) {
      if (!tooDeepReported) {
        tooDeepReported = true
        add(rootPath, TREE_TOO_DEEP, `A cabinet can be split at most ${MAX_TREE_DEPTH} levels deep.`)
      }
      continue
    }

    validateNode(node, path, claimFeature, add)

    const children = node.children
    if (!Array.isArray(children) || children.length !== 2) continue
    const here: Ancestors = { node, parent: ancestors }
    // Report in list order, then push in reverse so the walk visits in list order.
    const steps: TreeStep[] = []
    for (let i = 0; i < children.length; i += 1) {
      const at = childPath(childPath(path, 'children'), i)
      const child = children[i]
      if (!isRecord(child)) {
        add(at, BAD_CHILDREN, 'Expected a space here.')
        continue
      }
      if (reachableFrom(here, child)) {
        add(at, BAD_CHILDREN, 'This space holds itself, so it never ends.')
        continue
      }
      steps.push({ node: child, path: at, depth: depth + 1, ancestors: here })
    }
    for (let i = steps.length - 1; i >= 0; i -= 1) stack.push(steps[i])
  }
}

function validateConstruction(raw: unknown, path: string, add: Add): void {
  if (raw === undefined) {
    add(path, MISSING, 'Missing the cabinet construction.')
    return
  }
  if (!isRecord(raw)) {
    add(path, WRONG_TYPE, 'Expected the cabinet construction.')
    return
  }
  validateSettings(raw.settings, childPath(path, 'settings'), add)
  validateTree(raw.root, childPath(path, 'root'), add)
  checkUnknownFields(raw, path, CONSTRUCTION_FIELDS, add)
}

// --- Item Designs, the Existing Model, and the entry point ---------------------

/**
 * The Item Footprint (#58): a preset with parameters, or a Custom Path.
 *
 * Two layers, in this order. The structural layer asks whether this is a footprint this
 * build can name at all — a kind it knows, the fields that kind carries, numbers where
 * numbers go — and stops there when it is not, because a footprint with a missing side has
 * no shape to check. The geometric layer then asks the same question the editor asks before
 * it will commit: does this describe a shape? `footprintProblems` is that one question, so
 * a Backup cannot smuggle in the impossible radius the editor refuses to save, and the
 * message is the same `formatGeometryProblem` sentence in both places.
 *
 * Values are checked for being numbers, never for being sensible sizes: `size-not-positive`
 * and `corner-radii-overlap` are the geometry kernel's to report, and reporting a bad size
 * twice — once as `out-of-range`, once as a shape problem — would be two answers to one
 * complaint.
 */
function validateFootprint(footprint: Rec, path: string, format: DisplayFormat, add: Add): void {
  const kind = checkOneOf(
    footprint.kind,
    childPath(path, 'kind'),
    'the Item Footprint shape',
    FOOTPRINT_KINDS,
    add,
  )
  if (kind === 'preset') {
    const preset = validatePreset(footprint.preset, childPath(path, 'preset'), add)
    const centre = readPoint(footprint.centre, childPath(path, 'centre'), 'the Item Footprint position', add)
    const orientationDeg = checkNumber(
      footprint.orientationDeg,
      childPath(path, 'orientationDeg'),
      'the Item Footprint orientation',
      add,
    )
    checkUnknownFields(footprint, path, PRESET_FOOTPRINT_FIELDS, add)
    if (preset === null || centre === null || orientationDeg === null) return
    reportFootprint({ kind: 'preset', preset, centre, orientationDeg }, path, format, add)
  } else if (kind === 'path') {
    const closed = validateClosedPath(footprint.path, childPath(path, 'path'), add)
    checkUnknownFields(footprint, path, PATH_FOOTPRINT_FIELDS, add)
    if (closed === null) return
    reportFootprint({ kind: 'path', path: closed }, path, format, add)
  }
}

/** The shape's own problems, reported where the shape lives. */
function reportFootprint(footprint: ItemFootprint, path: string, format: DisplayFormat, add: Add): void {
  const problems = toValidationProblems(footprintProblems(footprint), path, (one) =>
    formatGeometryProblem(one, format),
  )
  for (const one of problems) add(one.path, one.code, one.message)
}

/** One preset and its parameters, or `null` when the parameters are not there to read. */
function validatePreset(raw: unknown, path: string, add: Add): Preset | null {
  if (raw === undefined) {
    add(path, MISSING, 'Missing the preset shape.')
    return null
  }
  if (!isRecord(raw)) {
    add(path, WRONG_TYPE, 'Expected the preset shape.')
    return null
  }
  const kind = checkOneOf(raw.kind, childPath(path, 'kind'), 'the preset shape', PRESET_KINDS, add)
  if (kind === null || PRESET_FIELDS[kind] === undefined) return null
  const fields = PRESET_FIELDS[kind]
  const num = (key: string, what: string): number | null =>
    checkNumber(raw[key], childPath(path, key), what, add)

  let preset: Preset | null = null
  switch (kind) {
    case 'square': {
      const side = num('side', 'the Square side')
      preset = side === null ? null : { kind: 'square', side }
      break
    }
    case 'rectangle': {
      const width = num('width', 'the Rectangle width')
      const depth = num('depth', 'the Rectangle depth')
      preset = width === null || depth === null ? null : { kind: 'rectangle', width, depth }
      break
    }
    case 'ellipse': {
      const width = num('width', 'the Ellipse width')
      const depth = num('depth', 'the Ellipse depth')
      preset = width === null || depth === null ? null : { kind: 'ellipse', width, depth }
      break
    }
    case 'roundedRectangle': {
      const width = num('width', 'the Rounded Rectangle width')
      const depth = num('depth', 'the Rounded Rectangle depth')
      const radius = raw.radius === undefined ? undefined : num('radius', 'the corner radius')
      const radii = raw.radii === undefined ? undefined : readCornerRadii(raw.radii, childPath(path, 'radii'), add)
      preset =
        width === null || depth === null || radius === null || radii === null
          ? null
          : { kind: 'roundedRectangle', width, depth, ...(radius === undefined ? {} : { radius }), ...(radii === undefined ? {} : { radii }) }
      break
    }
    case 'circle': {
      const diameter = num('diameter', 'the Circle diameter')
      preset = diameter === null ? null : { kind: 'circle', diameter }
      break
    }
    case 'capsule': {
      const length = num('length', 'the Capsule length')
      const width = num('width', 'the Capsule width')
      preset = length === null || width === null ? null : { kind: 'capsule', length, width }
      break
    }
    case 'triangle': {
      const baseWidth = num('baseWidth', 'the Triangle base width')
      const depth = num('depth', 'the Triangle depth')
      const apexOffset = raw.apexOffset === undefined ? undefined : num('apexOffset', 'the Triangle apex offset')
      preset =
        baseWidth === null || depth === null || apexOffset === null
          ? null
          : { kind: 'triangle', baseWidth, depth, ...(apexOffset === undefined ? {} : { apexOffset }) }
      break
    }
    case 'regularPolygon': {
      const sideCount = num('sideCount', 'the Regular Polygon side count')
      const sideLength = num('sideLength', 'the Regular Polygon side length')
      preset =
        sideCount === null || sideLength === null ? null : { kind: 'regularPolygon', sideCount, sideLength }
      break
    }
  }
  checkUnknownFields(raw, path, fields, add)
  return preset
}

/** The four corner radii, when all four are there and finite. */
function readCornerRadii(raw: unknown, path: string, add: Add): CornerRadii | null {
  if (!isRecord(raw)) {
    add(path, WRONG_TYPE, 'Expected the four corner radii.')
    return null
  }
  const read = (key: keyof CornerRadii): number | null =>
    checkNumber(raw[key], childPath(path, key), `the ${key} corner radius`, add)
  const topLeft = read('topLeft')
  const topRight = read('topRight')
  const bottomRight = read('bottomRight')
  const bottomLeft = read('bottomLeft')
  checkUnknownFields(raw, path, CORNER_RADII_FIELDS, add)
  return topLeft === null || topRight === null || bottomRight === null || bottomLeft === null
    ? null
    : { topLeft, topRight, bottomRight, bottomLeft }
}

/** A Custom Path: a start point and a list of Edges, each one of the three kinds. */
function validateClosedPath(raw: unknown, path: string, add: Add): ClosedPath | null {
  if (raw === undefined) {
    add(path, MISSING, 'Missing the Custom Path.')
    return null
  }
  if (!isRecord(raw)) {
    add(path, WRONG_TYPE, 'Expected the Custom Path.')
    return null
  }
  const start = readPoint(raw.start, childPath(path, 'start'), 'the Custom Path start', add)
  const rawSegments = checkArray(raw.segments, childPath(path, 'segments'), 'the Custom Path Edges', add)
  checkUnknownFields(raw, path, CLOSED_PATH_FIELDS, add)
  if (start === null || rawSegments === null) return null
  const segments: Segment[] = []
  let broken = false
  rawSegments.forEach((segment, i) => {
    const one = validateSegment(segment, childPath(childPath(path, 'segments'), i), add)
    if (one === null) broken = true
    else segments.push(one)
  })
  return broken ? null : { start, segments }
}

function validateSegment(raw: unknown, path: string, add: Add): Segment | null {
  if (!isRecord(raw)) {
    add(path, WRONG_TYPE, 'Expected an Edge of the Custom Path.')
    return null
  }
  const kind = checkOneOf(raw.kind, childPath(path, 'kind'), 'the Edge kind', SEGMENT_KINDS, add)
  if (kind === null) return null
  const to = readPoint(raw.to, childPath(path, 'to'), 'the Edge end', add)
  const centre = kind === 'line'
    ? (raw.center === undefined ? { x: 0, y: 0 } : readPoint(raw.center, childPath(path, 'center'), 'the Arc centre', add))
    : readPoint(raw.center, childPath(path, 'center'), 'the Arc centre', add)
  const sweepDeg = kind === 'line'
    ? null
    : checkNumber(raw.sweepDeg, childPath(path, 'sweepDeg'), 'the Arc sweep', add)

  let segment: Segment | null = null
  if (kind === 'line') segment = to === null ? null : { kind: 'line', to }
  else if (kind === 'arc') segment = to === null || centre === null || sweepDeg === null ? null : { kind: 'arc', to, center: centre, sweepDeg }
  else {
    const rx = checkNumber(raw.rx, childPath(path, 'rx'), 'the elliptical Arc x radius', add)
    const ry = checkNumber(raw.ry, childPath(path, 'ry'), 'the elliptical Arc y radius', add)
    const rotationDeg = checkNumber(raw.rotationDeg, childPath(path, 'rotationDeg'), 'the elliptical Arc rotation', add)
    segment =
      to === null || centre === null || sweepDeg === null || rx === null || ry === null || rotationDeg === null
        ? null
        : { kind: 'ellipticalArc', to, center: centre, rx, ry, rotationDeg, sweepDeg }
  }
  checkUnknownFields(raw, path, SEGMENT_FIELDS[kind], add)
  return segment
}

function validateGenericDesign(design: Rec, path: string, format: DisplayFormat, add: Add): void {
  const footprintPath = childPath(path, 'footprint')
  if (design.footprint === undefined) {
    add(footprintPath, MISSING, 'Missing the Item Footprint.')
  } else if (!isRecord(design.footprint)) {
    add(footprintPath, WRONG_TYPE, 'Expected the Item Footprint.')
  } else {
    validateFootprint(design.footprint, footprintPath, format, add)
  }

  readPoint(design.origin, childPath(path, 'origin'), 'the Item Origin', add)
  checkPositive(design.height, childPath(path, 'height'), 'the Item Design height', add)
  checkBoolean(design.heightIsTypical, childPath(path, 'heightIsTypical'), 'the typical-height flag', add)

  const colorPath = childPath(path, 'color')
  const color = checkText(design.color, colorPath, 'the Item Design color', add)
  if (color !== null && !COLOR.test(color)) {
    add(colorPath, BAD_FORMAT, 'Expected the Item Design color as #rrggbb in lowercase hexadecimal.')
  }

  // An opaque catalog entry key (#42 notes): present has to be non-empty text, and it is
  // never checked against the catalog, which `domain` may not import.
  if (design.catalogKey !== undefined) {
    const keyPath = childPath(path, 'catalogKey')
    const catalogKey = checkText(design.catalogKey, keyPath, 'the catalog key', add)
    if (catalogKey !== null && catalogKey.trim() === '') {
      add(keyPath, EMPTY_TEXT, 'Expected the catalog key to have something in it.')
    }
  }
  checkOptionalBoolean(design.isCustom, childPath(path, 'isCustom'), 'the custom-design flag', add)
}

function validateItemDesign(raw: unknown, path: string, index: IdIndex, format: DisplayFormat, add: Add): void {
  if (!isRecord(raw)) {
    add(path, WRONG_TYPE, 'Expected an Item Design.')
    return
  }
  const idPath = childPath(path, 'id')
  const id = checkEntityId(raw.id, idPath, 'the Item Design ID', add)
  if (id !== null) claimId(id, idPath, 'the Item Design ID', index, add)
  checkFilledText(raw.name, childPath(path, 'name'), 'the Item Design name', add)

  const kind = checkOneOf(raw.kind, childPath(path, 'kind'), 'the Item Design kind', DESIGN_KINDS, add)
  // With no kind there is no way to know which fields this design was meant to carry, so
  // the kind-specific ones are left alone rather than reported as unknown.
  if (kind === 'cabinet') {
    validateConstruction(raw.construction, childPath(path, 'construction'), add)
    checkUnknownFields(raw, path, CABINET_DESIGN_FIELDS, add)
  } else if (kind === 'generic') {
    validateGenericDesign(raw, path, format, add)
    checkUnknownFields(raw, path, GENERIC_DESIGN_FIELDS, add)
  }
}

function validateItemDesigns(
  raw: unknown,
  path: string,
  index: IdIndex,
  format: DisplayFormat,
  checks: Checks,
  add: Add,
): void {
  const designs = checkArray(raw, path, 'the Item Designs', add)
  if (designs === null) return
  designs.forEach((design, i) => {
    // A Design's ID is claimed over the whole document by `indexIds`, so skipping an untouched
    // Design cannot hide a duplicate (#69 §8).
    if (!inScope(checks, design)) return
    validateItemDesign(design, childPath(path, i), index, format, add)
  })
}

function validatePlacedItem(raw: unknown, path: string, index: IdIndex, scope: ModelScope, add: Add): void {
  if (!isRecord(raw)) {
    add(path, WRONG_TYPE, 'Expected a Placed Item.')
    return
  }
  const idPath = childPath(path, 'id')
  const id = checkEntityId(raw.id, idPath, 'the Placed Item ID', add)
  if (id !== null) claimId(id, idPath, 'the Placed Item ID', index, add)

  const designPath = childPath(path, 'itemDesignId')
  const itemDesignId = checkText(raw.itemDesignId, designPath, 'the Item Design this Placed Item places', add)
  if (itemDesignId !== null && !index.designIds.has(itemDesignId)) {
    add(designPath, DANGLING_REFERENCE, "Placed Item refers to an Item Design that isn't in this Project.")
  }

  const floorPath = childPath(path, 'floorId')
  const floorId = checkText(raw.floorId, floorPath, 'the Floor this Placed Item sits on', add)
  if (floorId !== null && !index.floorIds.has(floorId)) {
    add(floorPath, DANGLING_REFERENCE, 'Placed Item refers to a Floor that is not in this Project.')
  }

  readPoint(raw.translation, childPath(path, 'translation'), 'the Placed Item position', add)
  checkRange(
    raw.rotationDeg,
    childPath(path, 'rotationDeg'),
    'the Placed Item rotation',
    add,
    (n) => n >= 0 && n < 360,
    'from 0 up to but not including 360 degrees',
  )
  // Negative is valid: a Placed Item can hang below the Floor Datum (#25).
  checkNumber(raw.baseElevation, childPath(path, 'baseElevation'), 'the Placed Item height above the Floor Datum', add)
  checkPredecessorIds(raw.predecessorIds, path, index, scope, add)
  checkDrawingLayerId(raw.drawingLayerId, path, 'the Placed Item Drawing Layer', index, add)
  checkUnknownFields(raw, path, PLACED_ITEM_FIELDS, add)
}

/**
 * A Wall's reference line (#64 §1). Straight, or a circular arc through a third point that
 * lies strictly between the ends — the sweep may exceed 180°, which is why the third point
 * is stored rather than a centre and a sweep.
 */
function validateWallLine(raw: unknown, path: string, add: Add): WallRefLine | null {
  if (raw === undefined) {
    add(path, MISSING, 'Missing the Wall reference line.')
    return null
  }
  if (!isRecord(raw)) {
    add(path, WRONG_TYPE, 'Expected the Wall reference line.')
    return null
  }
  const kind = checkOneOf(raw.kind, childPath(path, 'kind'), 'the Wall reference line shape', WALL_LINE_KINDS, add)
  const start = readPoint(raw.start, childPath(path, 'start'), 'the Wall reference line start', add)
  const end = readPoint(raw.end, childPath(path, 'end'), 'the Wall reference line end', add)
  checkUnknownFields(raw, path, WALL_LINE_FIELDS, add)
  if (kind === 'line') {
    if (raw.through !== undefined) {
      add(childPath(path, 'through'), UNKNOWN_FIELD, 'A straight Wall reference line has no third point — only an arc does.')
    }
    if (start === null || end === null) return null
    if (distance(start, end) < TOLERANCE_MM) {
      add(path, OUT_OF_RANGE, `Expected a Wall reference line at least ${TOLERANCE_MM} mm long.`)
      return null
    }
    return { kind: 'line', start, end }
  }
  if (kind !== 'arc') return null
  const through = readPoint(raw.through, childPath(path, 'through'), 'the point the Wall arc passes through', add)
  if (start === null || end === null || through === null) return null
  if (arcFromThrough(start, through, end) === null) {
    add(
      childPath(path, 'through'),
      OUT_OF_RANGE,
      'Expected the Wall arc to bend: its third point lies on the straight line between the two ends.',
    )
    return null
  }
  return { kind: 'arc', start, end, through }
}

/** A Wall whose shape read cleanly, kept for the Junction cross-checks. */
interface WallShape {
  id: string
  /** The `W-<n>` a message names, kept for the Opening fit rule (#65 §5). */
  ref: string
  floorId: string
  line: WallRefLine
  /** Needed by the Opening fit rule, which reads the tidied band (#65 §3). */
  thickness: number
  justification: WallJustification
}

/** A Junction that read cleanly, in the shape `joinWalls` takes, for the fit rule (#65 §3). */
interface JunctionShape {
  id: string
  floorId: string
  ends: JoinJunction['ends']
  host?: { wallId: string; at: number }
}

function validateWall(
  raw: unknown,
  path: string,
  index: IdIndex,
  refs: Map<string, string>,
  scope: ModelScope,
  add: Add,
): WallShape | null {
  if (!isRecord(raw)) {
    add(path, WRONG_TYPE, 'Expected a Wall.')
    return null
  }
  const idPath = childPath(path, 'id')
  const id = checkEntityId(raw.id, idPath, 'the Wall ID', add)
  if (id !== null) claimId(id, idPath, 'the Wall ID', index, add)

  // `ref` is the homeowner's label — W-1, W-2 — allocated once and never reused, so two
  // Walls called the same thing would make every message about them ambiguous (#64 §1).
  const refPath = childPath(path, 'ref')
  const ref = checkFilledText(raw.ref, refPath, 'the Wall reference', add)
  if (ref !== null) {
    const first = refs.get(ref)
    if (first !== undefined) {
      add(refPath, DUPLICATE_NAME, `Expected the Wall reference to be unique in this Project — ${first} already uses it.`)
    } else {
      refs.set(ref, path)
    }
  }

  const floorPath = childPath(path, 'floorId')
  const floorId = checkText(raw.floorId, floorPath, 'the Floor this Wall stands on', add)
  if (floorId !== null && !index.floorIds.has(floorId)) {
    add(floorPath, DANGLING_REFERENCE, 'Wall refers to a Floor that is not in this Project.')
  }

  const line = validateWallLine(raw.line, childPath(path, 'line'), add)
  checkPositive(raw.thickness, childPath(path, 'thickness'), 'the Wall thickness', add)
  checkOneOf(raw.justification, childPath(path, 'justification'), 'the Wall justification', WALL_JUSTIFICATIONS, add)
  checkOptionalOneOf(raw.classification, childPath(path, 'classification'), 'the Wall construction type', WALL_CLASSIFICATIONS, add)
  checkOptionalText(raw.constructionLabel, childPath(path, 'constructionLabel'), 'the Wall construction label', add)
  // Negative is valid: a Wall can start below the Floor Datum, the way a Placed Item can (#25).
  checkNumber(raw.baseElevation, childPath(path, 'baseElevation'), 'the Wall height above the Floor Datum', add)
  checkPositive(raw.height, childPath(path, 'height'), 'the Wall height', add)
  checkPredecessorIds(raw.predecessorIds, path, index, scope, add)
  checkDrawingLayerId(raw.drawingLayerId, path, 'the Wall Drawing Layer', index, add)
  checkUnknownFields(raw, path, WALL_FIELDS, add)
  if (id === null || floorId === null || line === null || ref === null) return null
  const thickness = raw.thickness
  const justification = raw.justification
  if (typeof thickness !== 'number' || typeof justification !== 'string') return null
  return { id, ref, floorId, line, thickness, justification: justification as WallJustification }
}

/** The Wall ends a Junction holds, kept for the coincidence cross-checks. */
interface JunctionMember {
  wall: WallShape
  end: 'start' | 'end'
}

/** The point of the Wall this member end holds, on the reference line. */
const memberPoint = (member: JunctionMember): Pt => (member.end === 'start' ? member.wall.line.start : member.wall.line.end)

/**
 * Why a Wall reference found nothing, in the words #69 §4 asks for.
 *
 * A Wall that is simply absent keeps the message it has always had. Two absences are worth naming
 * separately, because the fix is different each time: a Wall another Option proposes is a reference
 * that crossed an Option boundary, and a Wall this Option demolishes is a reference to something the
 * same transaction is removing — the case the demolition review reports as `Detach or re-host W-7
 * first.`
 */
function missingWallMessage(wallId: string, index: IdIndex, scope: ModelScope, fallback: string): string {
  if (index.proposedWallIds.has(wallId) && !scope.proposedWallIds.has(wallId)) {
    return scope.optionId === null
      ? 'Expected the Wall to be an Existing Model Wall — this one is proposed work of a Design Option.'
      : 'Expected the Wall to be one this Design Option proposes or the Existing Model carries — another Design Option proposes it.'
  }
  if (scope.optionId !== null && scope.demolished.has(wallId)) {
    return 'Expected the Wall not to be one this Design Option demolishes — detach or re-host it first.'
  }
  return fallback
}

/** The key one Wall end is claimed under: one end, one Junction (#64 §2). */
function endKey(wallId: string, end: WallEnd): string {
  return `${wallId}\u0000${end}`
}

/**
 * The Wall ends a set of Junctions already claims, in the shape `validateWallJunctions` takes.
 * A Design Option's Junctions are validated against the **effective** model, so the pass over one
 * starts from the ends the standing Existing Junctions have taken (#69 §4).
 */
function joinedEndsOf(junctions: readonly JunctionShape[]): Map<string, string> {
  const joined = new Map<string, string>()
  for (const junction of junctions)
    for (const end of junction.ends)
      joined.set(endKey(end.wallId, end.end), `existingModel.wallJunctions[${junction.id}]`)
  return joined
}

function validateJunctionMember(
  raw: unknown,
  path: string,
  index: IdIndex,
  scope: ModelScope,
  walls: Map<string, WallShape>,
  floorId: string | null,
  taken: Map<string, string>,
  add: Add,
): JunctionMember | null {
  if (!isRecord(raw)) {
    add(path, WRONG_TYPE, 'Expected a Wall Junction member.')
    return null
  }
  const wallPath = childPath(path, 'wallId')
  const wallId = checkText(raw.wallId, wallPath, 'the Wall this Junction joins', add)
  const endChoice = checkOneOf(raw.end, childPath(path, 'end'), 'which end of the Wall this Junction joins', WALL_ENDS, add)
  const end: WallEnd | null = endChoice === null ? null : (endChoice as WallEnd)
  checkUnknownFields(raw, path, WALL_JUNCTION_END_FIELDS, add)
  if (wallId === null || end === null) return null
  const wall = walls.get(wallId)
  if (wall === undefined) {
    add(
      wallPath,
      DANGLING_REFERENCE,
      missingWallMessage(wallId, index, scope, 'Wall Junction refers to a Wall that is not in this Project.'),
    )
    return null
  }
  if (floorId !== null && wall.floorId !== floorId) {
    add(wallPath, DANGLING_REFERENCE, 'Wall Junction joins a Wall that stands on a different Floor from the Junction.')
  }
  const key = endKey(wallId, end)
  const first = taken.get(key)
  if (first !== undefined) {
    add(
      path,
      DUPLICATE_MEMBER,
      `Expected each Wall end to be joined once — ${first} already joins ${end === 'start' ? 'the start' : 'the end'} of this Wall.`,
    )
    return null
  }
  taken.set(key, path)
  return { wall, end }
}

function validateJunctionHost(
  raw: unknown,
  path: string,
  index: IdIndex,
  scope: ModelScope,
  walls: Map<string, WallShape>,
  floorId: string | null,
  add: Add,
): { wall: WallShape; at: number } | null {
  if (raw === undefined) return null
  if (!isRecord(raw)) {
    add(path, WRONG_TYPE, 'Expected the Wall Junction host.')
    return null
  }
  const wallPath = childPath(path, 'wallId')
  const wallId = checkText(raw.wallId, wallPath, 'the Wall this Junction attaches to', add)
  const at = checkNumber(raw.at, childPath(path, 'at'), 'the distance along the host Wall', add)
  checkUnknownFields(raw, path, WALL_HOST_FIELDS, add)
  if (wallId === null || at === null) return null
  const wall = walls.get(wallId)
  if (wall === undefined) {
    add(
      wallPath,
      DANGLING_REFERENCE,
      missingWallMessage(wallId, index, scope, 'Wall Junction attaches to a Wall that is not in this Project.'),
    )
    return null
  }
  if (floorId !== null && wall.floorId !== floorId) {
    add(wallPath, DANGLING_REFERENCE, 'Wall Junction attaches to a Wall that stands on a different Floor from the Junction.')
  }
  // The open interval: a host distance of 0 or of the whole length is an end, and an end
  // joins as an ordinary Junction rather than attaching mid-Wall (#64 §2).
  const length = refLength(wall.line)
  if (!(at > 0 && at < length)) {
    add(
      childPath(path, 'at'),
      OUT_OF_RANGE,
      `Expected the distance along the host Wall to be between 0 and ${Math.round(length * 100) / 100} mm, not at either end.`,
    )
  }
  return { wall, at }
}

function validateWallJunctions(
  raw: unknown,
  path: string,
  index: IdIndex,
  scope: ModelScope,
  walls: Map<string, WallShape>,
  checks: Checks,
  add: Add,
  // The Wall ends already joined. One Wall end takes one Junction across the **effective** model,
  // so the pass over a Design Option starts from the ends the Existing Model has taken — otherwise
  // an Option's Junction could join an end that is joined already, and the two Junctions would
  // disagree about where that end is.
  joined = new Map<string, string>(),
): JunctionShape[] {
  const junctions = checkArray(raw, path, 'the Wall Junctions', add)
  const shapes: JunctionShape[] = []
  if (junctions === null) return shapes
  // One Wall end, one Junction: the topology a Wall network is built on (#64 §2).
  const taken = joined
  junctions.forEach((rawJunction, i) => {
    const at = childPath(path, i)
    if (!isRecord(rawJunction)) {
      add(at, WRONG_TYPE, 'Expected a Wall Junction.')
      return
    }
    const idPath = childPath(at, 'id')
    const id = checkEntityId(rawJunction.id, idPath, 'the Wall Junction ID', add)
    if (id !== null) claimId(id, idPath, 'the Wall Junction ID', index, add)

    const floorPath = childPath(at, 'floorId')
    const floorId = checkText(rawJunction.floorId, floorPath, 'the Floor this Junction joins Walls on', add)
    if (floorId !== null && !index.floorIds.has(floorId)) {
      add(floorPath, DANGLING_REFERENCE, 'Wall Junction refers to a Floor that is not in this Project.')
    }

    const endsPath = childPath(at, 'ends')
    const ends = checkArray(rawJunction.ends, endsPath, 'the Wall Junction members', add)
    const members: JunctionMember[] = []
    if (ends !== null) {
      ends.forEach((member, j) => {
        const found = validateJunctionMember(member, childPath(endsPath, j), index, scope, walls, floorId, taken, add)
        if (found !== null) members.push(found)
      })
    }
    const host = validateJunctionHost(rawJunction.host, childPath(at, 'host'), index, scope, walls, floorId, add)
    checkPredecessorIds(rawJunction.predecessorIds, at, index, scope, add)
    checkUnknownFields(rawJunction, at, WALL_JUNCTION_FIELDS, add)
    // A Junction of a Design Option exists to hold that Option's own work in place (#69 §4). One
    // joining only Existing Walls records a join the Existing Model already makes; one joining a
    // Wall the Option demolishes is the state the demolition review blocks on, and is caught by
    // the member and host checks above. A Wall the Option proposes hosting another Wall's end is
    // the Option's own work held in place too, so the host counts as a member here.
    const joinsProposed =
      members.some((member) => scope.proposedWallIds.has(member.wall.id)) ||
      (host !== null && scope.proposedWallIds.has(host.wall.id))
    if (scope.optionId !== null && members.length > 0 && !joinsProposed) {
      add(endsPath, DANGLING_REFERENCE, 'Expected a Design Option Wall Junction to join at least one Wall this Option proposes.')
    }
    // The shape `joinWalls` takes, kept for the Opening fit rule: an Opening's usable
    // interval is read off the same clean-up that draws the band (#65 §3).
    if (id !== null && floorId !== null) {
      shapes.push({
        id,
        floorId,
        ends: members.map((member) => ({ wallId: member.wall.id, end: member.end })),
        ...(host === null ? {} : { host: { wallId: host.wall.id, at: host.at } }),
      })
    }

    // Everything below is this Junction's own geometry: its ends meeting at one point, or sitting
    // on the host at the distance it gives. An untouched Junction still contributes its shape above,
    // which is what the Opening fit rule reads, so skipping the measurement changes nothing any
    // other record is checked against (#69 §8).
    if (!inScope(checks, rawJunction)) return

    const count = ends?.length ?? 0
    if (host === null) {
      if (count < 2) {
        add(endsPath, OUT_OF_RANGE, 'Expected a Wall Junction with no host to join at least two Wall ends.')
      } else if (members.length >= 2) {
        // A Junction's position is derived, so its ends have to be at one point: 0.01 mm is
        // the tolerance snapping writes coordinates to (#16), and anything looser is two
        // Junctions pretending to be one.
        const [first, ...rest] = members as [JunctionMember, ...JunctionMember[]]
        const point = memberPoint(first)
        rest.forEach((member) => {
          if (distance(memberPoint(member), point) > TOLERANCE_MM) {
            add(endsPath, OUT_OF_RANGE, 'Expected the Wall ends a Junction joins to meet at one point, within 0.01 mm.')
          }
        })
      }
      return
    }
    if (count < 1) {
      add(endsPath, OUT_OF_RANGE, 'Expected a hosted Wall Junction to have a Wall end attached to its host.')
      return
    }
    // A hosted Junction's ends sit on the host's reference line at `at`: that is where the
    // branch's end is stored, and clean-up cuts it there (#64 §9).
    const onHost = refPointAt(host.wall.line, host.at)
    members.forEach((member) => {
      if (distance(memberPoint(member), onHost) > TOLERANCE_MM) {
        add(endsPath, OUT_OF_RANGE, 'Expected the Wall end a hosted Junction attaches to lie on the host Wall at the distance it gives.')
      }
    })
  })
  return shapes
}

/** What the Existing Model pass leaves behind for the Design Option passes (#69). */
interface ExistingPass {
  /** Every Existing Wall that read cleanly, by ID. */
  walls: Map<string, WallShape>
  /** Every Existing Junction that read cleanly, in the shape `joinWalls` takes. */
  junctions: JunctionShape[]
  /** The `ref` labels the Existing Model uses, which every Option inherits as its starting set. */
  refs: Map<string, string>
  /** Every Existing Room that read cleanly, with the path its overlap problem would land on. */
  rooms: { room: Room; at: string }[]
}

const EMPTY_PASS: ExistingPass = { walls: new Map(), junctions: [], refs: new Map(), rooms: [] }

function validateExistingModel(
  raw: unknown,
  path: string,
  index: IdIndex,
  format: DisplayFormat,
  checks: Checks,
  add: Add,
): ExistingPass {
  if (raw === undefined) {
    add(path, MISSING, 'Missing the Existing Model.')
    return EMPTY_PASS
  }
  if (!isRecord(raw)) {
    add(path, WRONG_TYPE, 'Expected the Existing Model.')
    return EMPTY_PASS
  }
  const itemsPath = childPath(path, 'placedItems')
  const placedItems = checkArray(raw.placedItems, itemsPath, 'the Existing Model Placed Items', add)
  if (placedItems !== null) {
    placedItems.forEach((item, i) => {
      if (!inScope(checks, item)) return
      validatePlacedItem(item, childPath(itemsPath, i), index, EXISTING_SCOPE, add)
    })
  }
  // Walls are validated before their Junctions, which need the Walls' shapes to check that
  // the ends they name exist, stand on their Floor, and actually meet (#64 §2). Openings
  // come last: they need both, because their usable interval is the tidied band (#65 §3).
  // Every Wall is validated even out of scope: the map the three passes below resolve against
  // is built here, and skipping one would invent a dangling reference (#69 §8).
  const refs = new Map<string, string>()
  const walls = validateWalls(raw.walls, childPath(path, 'walls'), index, refs, EXISTING_SCOPE, add)
  const junctions = validateWallJunctions(
    raw.wallJunctions,
    childPath(path, 'wallJunctions'),
    index,
    EXISTING_SCOPE,
    walls,
    checks,
    add,
  )
  validateOpenings(raw.openings, childPath(path, 'openings'), index, EXISTING_SCOPE, walls, junctions, checks, add)
  // Rooms come last: a Wall face reference is checked against the Wall's tidied face, so it
  // needs the same Wall map the Openings needed (#67 §1).
  const rooms = validateRooms(raw.rooms, childPath(path, 'rooms'), index, EXISTING_SCOPE, walls, format, checks, add)
  checkUnknownFields(raw, path, EXISTING_MODEL_FIELDS, add)
  return { walls, junctions, refs, rooms }
}

/**
 * Every Design Option of the Project (#69 §2, §3, §4).
 *
 * An Option is validated as a *delta*, which means every one of its references is resolved against
 * the **effective** model — the Existing Model minus what this Option demolishes, plus this Option's
 * own work — and not against the Option on its own. That is the whole content of "options own
 * deltas over one shared Existing Model": a proposed Opening's fit, a Junction's join and a Room's
 * face reference are all read off the same tidied Walls the drawing will show in this Option.
 *
 * Absent is valid and means the S7 shape: a Project with no Options behaves exactly as it did before
 * this file grew a fourth pass.
 */
function validateDesignOptions(
  raw: unknown,
  path: string,
  index: IdIndex,
  format: DisplayFormat,
  existing: ExistingPass,
  checks: Checks,
  add: Add,
): void {
  if (raw === undefined) return
  const options = checkArray(raw, path, 'the Design Options', add)
  if (options === null) return
  // Two Options called `Option A` are two Options the list cannot offer a choice between, so the
  // name is unique the way a Floor name is: trimmed, case-folded, Unicode-normalised.
  const names = new Map<string, string>()
  options.forEach((rawOption, i) => {
    const at = childPath(path, i)
    if (!isRecord(rawOption)) {
      add(at, WRONG_TYPE, 'Expected a Design Option.')
      return
    }
    const idPath = childPath(at, 'id')
    const optionId = checkEntityId(rawOption.id, idPath, 'the Design Option ID', add)
    if (optionId !== null) claimId(optionId, idPath, 'the Design Option ID', index, add)

    const namePath = childPath(at, 'name')
    const name = checkFilledText(rawOption.name, namePath, 'the Design Option name', add)
    if (name !== null) {
      if (name.length > DESIGN_OPTION_NAME_MAX_LENGTH) {
        add(namePath, OUT_OF_RANGE, `Expected the Design Option name to be at most ${DESIGN_OPTION_NAME_MAX_LENGTH} characters — it is ${name.length}.`)
      }
      const key = nameKey(name)
      const first = names.get(key)
      if (first !== undefined) {
        add(namePath, DUPLICATE_NAME, `Expected each Design Option to have its own name — ${first} is already called ${name.trim()}.`)
      } else {
        names.set(key, name)
      }
    }

    // The demolition records: sorted, unique, and each one naming an entity of the Existing Model
    // and nothing else. A record naming a proposed entity would delete work that exists only in one
    // alternative, which is the state #69 §4 refuses outright.
    const demolished = new Set<string>()
    const order: string[] = []
    const demPath = childPath(at, 'demolishedIds')
    const records = checkArray(rawOption.demolishedIds, demPath, 'the demolition records', add)
    if (records !== null) {
      records.forEach((value, j) => {
        const here = childPath(demPath, j)
        const id = checkEntityId(value, here, 'a demolition record', add)
        if (id === null) return
        if (demolished.has(id)) {
          add(here, DUPLICATE_ID, 'Expected each demolition record once in one Design Option.')
          return
        }
        demolished.add(id)
        order.push(id)
        if (!index.existingIds.has(id)) {
          add(
            here,
            DANGLING_REFERENCE,
            index.proposedIds.has(id)
              ? 'Expected a demolition record to name an Existing Model entity — this one is proposed work of a Design Option.'
              : `Expected a demolition record to name an entity of this Project — no entity has ID ${id}.`,
          )
        }
      })
      const sorted = [...order].sort(compareCodePoints)
      if (order.some((id, j) => id !== sorted[j])) {
        add(demPath, BAD_FORMAT, 'Expected the demolition records sorted, the way the model stores them.')
      }
    }

    const proposedPath = childPath(at, 'proposed')
    if (!isRecord(rawOption.proposed)) {
      add(proposedPath, rawOption.proposed === undefined ? MISSING : WRONG_TYPE, 'Expected the proposed model.')
      checkUnknownFields(rawOption, at, DESIGN_OPTION_FIELDS, add)
      return
    }
    const proposed = rawOption.proposed
    // The Option's own IDs, read before anything is validated: a Junction may name a Wall declared
    // after it, and "is this Wall ours?" has to be answerable while the array is still being walked.
    const proposedIds = new Set<string>()
    const proposedWallIds = new Set<string>()
    for (const key of PROPOSED_MODEL_FIELDS) {
      const list = proposed[key]
      if (!Array.isArray(list)) continue
      for (const entry of list) {
        if (!isRecord(entry) || typeof entry.id !== 'string') continue
        proposedIds.add(entry.id)
        if (key === 'walls') proposedWallIds.add(entry.id)
      }
    }
    // An unparseable Option ID is still an Option: the scope only asks whether one is in force.
    const scope: ModelScope = { optionId: optionId ?? at, demolished, proposedIds, proposedWallIds }
    // The Option's own records are the only ones this pass could have been asked about, and reading
    // their IDs is a walk of strings: an Option that nothing touched and no changed record names is
    // skipped whole, which is where the rest of the reference Project's Option cost was (#69 §8).
    // Its ID, its name and its demolition records were checked above either way.
    if (checks !== null && !checks.entities.has(optionId ?? '') && ![...proposedIds].some((id) => checks.entities.has(id))) return

    const optionWalls = validateWalls(proposed.walls, childPath(proposedPath, 'walls'), index, new Map(existing.refs), scope, add)
    const walls = new Map<string, WallShape>()
    for (const [id, wall] of existing.walls) {
      if (!demolished.has(id)) walls.set(id, wall)
    }
    for (const [id, wall] of optionWalls) walls.set(id, wall)
    // The Junctions of the effective model: the Existing ones whose Walls all still stand in this
    // Option, then the Option's own. A join that involved a demolished Wall goes with it, which is
    // what lengthens the usable interval of a retained neighbour (#69 §4).
    const standing = existing.junctions.filter(
      (junction) =>
        !junction.ends.some((end) => demolished.has(end.wallId)) &&
        !(junction.host !== undefined && demolished.has(junction.host.wallId)),
    )
    const junctions = [
      ...standing,
      ...validateWallJunctions(
        proposed.wallJunctions,
        childPath(proposedPath, 'wallJunctions'),
        index,
        scope,
        walls,
        // Past the guard above, this Option is one the pass was asked about: everything inside it
        // is checked, in full, whatever the scope.
        null,
        add,
        joinedEndsOf(standing),
      ),
    ]
    validateOpenings(proposed.openings, childPath(proposedPath, 'openings'), index, scope, walls, junctions, null, add)
    const optionRooms = validateRooms(proposed.rooms, childPath(proposedPath, 'rooms'), index, scope, walls, format, null, add)
    const itemsPath = childPath(proposedPath, 'placedItems')
    const placedItems = checkArray(proposed.placedItems, itemsPath, 'the proposed Placed Items', add)
    if (placedItems !== null) {
      placedItems.forEach((item, j) => validatePlacedItem(item, childPath(itemsPath, j), index, scope, add))
    }
    checkUnknownFields(proposed, proposedPath, PROPOSED_MODEL_FIELDS, add)
    checkUnknownFields(rawOption, at, DESIGN_OPTION_FIELDS, add)

    // Overlap is a property of the effective model, so it is checked across both collections —
    // Existing first, so the Room reported on is the one this Option introduced.
    checkRoomOverlaps([...existing.rooms.filter((entry) => !demolished.has(entry.room.id)), ...optionRooms], add)
  })
}

/**
 * Every Opening of the Existing Model (#65 §2, §3, §5).
 *
 * An Opening is nothing without its host: it is an absence in one Wall, so a missing host,
 * a host on another Floor, or a position the tidied Wall has no room for are all refused
 * here rather than repaired. The room is measured by `fitOpening` against the usable
 * interval `joinWalls` leaves — the same clean-up that draws the band — so a Project that
 * validates is a Project whose Openings sit where the drawing shows them sitting.
 */
function validateOpenings(
  raw: unknown,
  path: string,
  index: IdIndex,
  scope: ModelScope,
  walls: Map<string, WallShape>,
  junctions: readonly JunctionShape[],
  checks: Checks,
  add: Add,
): void {
  const items = checkArray(raw, path, 'the Openings', add)
  if (items === null) return
  // One clean-up per Floor that actually carries an Opening, remembered for the rest of
  // this pass: the fit rule and the drawing must read the same trims, never two estimates.
  const byFloor = new Map<string, Map<string, UsableInterval>>()
  const intervalsOf = (floorId: string): Map<string, UsableInterval> => {
    const known = byFloor.get(floorId)
    if (known !== undefined) return known
    const shapes: JoinWall[] = []
    for (const wall of walls.values()) {
      if (wall.floorId === floorId) {
        shapes.push({ id: wall.id, line: wall.line, thickness: wall.thickness, justification: wall.justification })
      }
    }
    const links: JoinJunction[] = junctions
      .filter((junction) => junction.floorId === floorId)
      .map((junction) => ({
        id: junction.id,
        ends: junction.ends,
        ...(junction.host === undefined ? {} : { host: junction.host }),
      }))
    const made = usableIntervals(shapes, links)
    byFloor.set(floorId, made)
    return made
  }

  items.forEach((rawOpening, i) => {
    const at = childPath(path, i)
    if (!isRecord(rawOpening)) {
      add(at, WRONG_TYPE, 'Expected an Opening.')
      return
    }
    const idPath = childPath(at, 'id')
    const id = checkEntityId(rawOpening.id, idPath, 'the Opening ID', add)
    if (id !== null) claimId(id, idPath, 'the Opening ID', index, add)
    // The rest of this record is its own fit, which reads the tidied band of every Wall on the
    // Floor: the one thing in this file worth skipping for an Opening nothing touched (#69 §8).
    // Its ID is claimed over the whole document by `indexIds`, so a duplicate still surfaces.
    if (!inScope(checks, rawOpening)) return

    const floorPath = childPath(at, 'floorId')
    const floorId = checkText(rawOpening.floorId, floorPath, 'the Floor this Opening is on', add)
    if (floorId !== null && !index.floorIds.has(floorId)) {
      add(floorPath, DANGLING_REFERENCE, 'Opening refers to a Floor that is not in this Project.')
    }

    // Exactly one host Wall, on the same Floor (#65 §2). Never reassigned behind the user's
    // back, so a Wall that goes away takes its Openings with it through a review instead.
    const hostPath = childPath(at, 'hostWallId')
    const hostId = checkText(rawOpening.hostWallId, hostPath, 'the Wall this Opening is cut into', add)
    let host: WallShape | null = null
    if (hostId !== null) {
      host = walls.get(hostId) ?? null
      if (host === null) {
        add(
          hostPath,
          DANGLING_REFERENCE,
          missingWallMessage(hostId, index, scope, 'Opening refers to a Wall that is not in this Project.'),
        )
      } else if (floorId !== null && host.floorId !== floorId) {
        add(hostPath, DANGLING_REFERENCE, 'Opening and the Wall it is cut into stand on different Floors.')
        host = null
      }
    }

    const kind = checkOneOf(rawOpening.kind, childPath(at, 'kind'), 'the kind of Opening', OPENING_KINDS, add)
    const label = checkFilledText(rawOpening.label, childPath(at, 'label'), 'the Opening label', add)
    const start = checkNumber(rawOpening.start, childPath(at, 'start'), 'the distance along the Wall to the Opening', add)
    const widthPath = childPath(at, 'width')
    const width = checkNumber(rawOpening.width, widthPath, 'the Opening width', add)
    if (width !== null && width <= 0) add(widthPath, OUT_OF_RANGE, 'Expected the Opening width greater than 0.')
    // Either may be negative: a Opening can stand below the Floor Datum the way a Wall can.
    const sill = checkNumber(rawOpening.sill, childPath(at, 'sill'), 'the height of the bottom of the Opening', add)
    const headPath = childPath(at, 'head')
    const head = checkNumber(rawOpening.head, headPath, 'the height of the top of the Opening', add)
    if (sill !== null && head !== null && head <= sill) {
      add(headPath, OUT_OF_RANGE, 'Expected the top of the Opening to be above its bottom.')
    }

    // The door fields belong to a door, and to nothing else (#65 §2): a window with a hinge
    // side is a data mistake, not something to draw round.
    const swingPath = childPath(at, 'swing')
    const hingePath = childPath(at, 'hingeSide')
    const hasSwing = rawOpening.swing !== undefined
    const hasHinge = rawOpening.hingeSide !== undefined
    const swing = hasSwing ? checkOneOf(rawOpening.swing, swingPath, 'which way the door swings', OPENING_SWINGS, add) : null
    if (hasHinge) checkOneOf(rawOpening.hingeSide, hingePath, 'the jamb the door hangs on', HINGE_SIDES, add)
    if (kind === 'door') {
      if (!hasSwing) {
        add(swingPath, MISSING, 'Missing which way the door swings.')
      } else if (swing === 'sliding' && hasHinge) {
        add(hingePath, UNKNOWN_FIELD, 'A sliding door hangs on no jamb, so it carries no hinge side.')
      } else if (swing !== null && swing !== 'sliding' && !hasHinge) {
        add(hingePath, MISSING, 'Missing the jamb the door hangs on.')
      }
    } else if (kind !== null) {
      const noun = openingNoun(kind as OpeningKind)
      if (hasSwing) add(swingPath, UNKNOWN_FIELD, `Expected a ${noun} to carry no door fields.`)
      if (hasHinge) add(hingePath, UNKNOWN_FIELD, `Expected a ${noun} to carry no door fields.`)
    }

    checkPredecessorIds(rawOpening.predecessorIds, at, index, scope, add)
    checkDrawingLayerId(rawOpening.drawingLayerId, at, 'the Opening Drawing Layer', index, add)
    checkUnknownFields(rawOpening, at, OPENING_FIELDS, add)
    if (host === null || kind === null || start === null || width === null || width <= 0 || floorId === null) return
    const usable = intervalsOf(floorId).get(host.id)
    if (usable === undefined) return
    const fit = fitOpening(host.line, usable, start, width)
    if (!fit.fits) {
      add(
        childPath(at, 'start'),
        OUT_OF_RANGE,
        fitProblem(
          { label: label ?? 'This Opening', kind: kind as OpeningKind, width },
          host.ref,
          fit,
          (wallId) => walls.get(wallId)?.ref ?? wallId,
        ),
      )
    }
  })
}

/** Every Wall in the collection that read cleanly, by ID, plus the `ref`s already used. */
function validateWalls(raw: unknown, path: string, index: IdIndex, refs: Map<string, string>, scope: ModelScope, add: Add): Map<string, WallShape> {
  const walls = new Map<string, WallShape>()
  const items = checkArray(raw, path, 'the Walls', add)
  if (items === null) return walls
  items.forEach((wall, i) => {
    const shape = validateWall(wall, childPath(path, i), index, refs, scope, add)
    if (shape !== null) walls.set(shape.id, shape)
  })
  return walls
}

/**
 * Every Room of the Existing Model (#67 §1, §2).
 *
 * Three things are refused here that a Room could get wrong without anything else noticing:
 *
 *  - **An outline that is not a shape**, reported by the same geometry rules an Item
 *    Footprint answers to, plus the one-per-Edge rule for the stable Edge IDs — a reference
 *    that names nothing is a reference that will silently point at the wrong Edge later.
 *  - **A Wall face reference that does not hold.** The Edge must exist, be straight, name a
 *    Wall on the Room's own Floor, and actually lie on that face: within 0.01 mm of it and
 *    parallel to it to the same tolerance over its own length. A file that validates is a
 *    file whose "this Edge follows that face" is true, not merely intended.
 *  - **Two Rooms on one Floor enclosing area in common.** A shared edge and a point contact
 *    enclose nothing and are a normal drawing; positive area is a defect in the data and is
 *    refused on the second Room's outline.
 */
function validateRooms(
  raw: unknown,
  path: string,
  index: IdIndex,
  scope: ModelScope,
  walls: Map<string, WallShape>,
  format: DisplayFormat,
  checks: Checks,
  add: Add,
): { room: Room; at: string }[] {
  const items = checkArray(raw, path, 'the Rooms', add)
  const placed: { room: Room; at: string }[] = []
  if (items === null) return placed
  items.forEach((rawRoom, i) => {
    const at = childPath(path, i)
    if (!isRecord(rawRoom)) {
      add(at, WRONG_TYPE, 'Expected a Room.')
      return
    }
    const idPath = childPath(at, 'id')
    const id = checkEntityId(rawRoom.id, idPath, 'the Room ID', add)
    if (id !== null) claimId(id, idPath, 'the Room ID', index, add)

    const floorPath = childPath(at, 'floorId')
    const floorId = checkEntityId(rawRoom.floorId, floorPath, 'the Room Floor ID', add)
    if (floorId !== null && !index.floorIds.has(floorId)) {
      add(floorPath, DANGLING_REFERENCE, `Expected the Room's Floor to be a Floor of this Project — no Floor has ID ${floorId}.`)
    }

    const namePath = childPath(at, 'name')
    const name = checkFilledText(rawRoom.name, namePath, 'the Room name', add)
    if (name !== null && name.length > ROOM_NAME_MAX_LENGTH) {
      add(namePath, OUT_OF_RANGE, `Expected the Room name to be at most ${ROOM_NAME_MAX_LENGTH} characters — it is ${name.length}.`)
    }

    // The outline is validated for every Room, in scope or not: it costs microseconds and it is
    // what the overlap pass below compares against, so a proposed Room is still tested against an
    // Existing one neither this transaction nor its referrers touched (#69 §8).
    const outline = validateRoomOutline(rawRoom.outline, childPath(at, 'outline'), format, add)
    const mine = inScope(checks, rawRoom)
    const wallFaceRefs = mine
      ? validateRoomFaceRefs(rawRoom.wallFaceRefs, childPath(at, 'wallFaceRefs'), outline, index, scope, walls, floorId, add)
      : []
    if (mine) {
      checkPredecessorIds(rawRoom.predecessorIds, at, index, scope, add)
      checkDrawingLayerId(rawRoom.drawingLayerId, at, 'the Room Drawing Layer', index, add)
      checkUnknownFields(rawRoom, at, ROOM_FIELDS, add)
    }
    if (id !== null && floorId !== null && name !== null && outline !== null) {
      placed.push({ room: { id, floorId, name, outline, wallFaceRefs }, at })
    }
  })
  return placed
}

/**
 * One pass per Floor that carries more than one Room: overlap is symmetric, so the pair is
 * reported once, on the outline of the Room that came second.
 *
 * This is a separate function because a Design Option's Rooms are only half the story (#69 §4):
 * a proposed Room that overlaps one the Existing Model already has is a defect of the effective
 * model, and neither pass can see it on its own.
 */
function checkRoomOverlaps(placed: readonly { room: Room; at: string }[], add: Add): void {
  const byFloor = new Map<string, { room: Room; at: string }[]>()
  for (const entry of placed) {
    const list = byFloor.get(entry.room.floorId)
    if (list === undefined) byFloor.set(entry.room.floorId, [entry])
    else list.push(entry)
  }
  for (const list of byFloor.values()) {
    if (list.length < 2) continue
    for (const clash of roomOverlaps(list.map((entry) => entry.room))) {
      const second = list.find((entry) => entry.room.id === clash.second)
      if (second === undefined) continue
      const first = list.find((entry) => entry.room.id === clash.first)
      add(
        childPath(second.at, 'outline'),
        OUT_OF_RANGE,
        `Expected Rooms on one Floor not to overlap — ${first?.room.name ?? clash.first} and ${second.room.name} share ${Math.round(clash.area).toLocaleString('en-US')} mm² of area.`,
      )
    }
  }
}

/** One Room Outline — a preset or a Custom Path — with one stable ID per Edge. */
function validateRoomOutline(raw: unknown, path: string, format: DisplayFormat, add: Add): RoomOutline | null {
  if (raw === undefined) {
    add(path, MISSING, 'Missing the Room Outline.')
    return null
  }
  if (!isRecord(raw)) {
    add(path, WRONG_TYPE, 'Expected the Room Outline.')
    return null
  }
  const kind = checkOneOf(raw.kind, childPath(path, 'kind'), 'the Room Outline shape', FOOTPRINT_KINDS, add)
  const segmentIds = readSegmentIds(raw.segmentIds, childPath(path, 'segmentIds'), add)
  const pathIds = childPath(path, 'segmentIds')
  if (kind === 'preset') {
    const preset = validatePreset(raw.preset, childPath(path, 'preset'), add)
    const centre = readPoint(raw.centre, childPath(path, 'centre'), 'the Room Outline position', add)
    const orientationDeg = checkNumber(raw.orientationDeg, childPath(path, 'orientationDeg'), 'the Room Outline orientation', add)
    checkUnknownFields(raw, path, PRESET_ROOM_OUTLINE_FIELDS, add)
    if (preset === null || centre === null || orientationDeg === null || segmentIds === null) return null
    return finishRoomOutline({ kind: 'preset', preset, centre, orientationDeg, segmentIds }, pathIds, path, format, add)
  }
  if (kind === 'path') {
    const closed = validateClosedPath(raw.path, childPath(path, 'path'), add)
    checkUnknownFields(raw, path, PATH_ROOM_OUTLINE_FIELDS, add)
    if (closed === null || segmentIds === null) return null
    return finishRoomOutline({ kind: 'path', path: closed, segmentIds }, pathIds, path, format, add)
  }
  return null
}

/**
 * The last two checks an outline has to pass: one Edge ID per Edge, and a shape at all.
 *
 * The count is checked before the shape, because a list that is one short means every
 * reference after the gap names the wrong Edge — the more serious of the two, and the one a
 * fillet that added an Edge without adding an ID produces.
 */
function finishRoomOutline(
  outline: RoomOutline,
  idsPath: string,
  path: string,
  format: DisplayFormat,
  add: Add,
): RoomOutline | null {
  const edges = roomSegments(outline).length
  if (outline.segmentIds.length !== edges) {
    add(idsPath, OUT_OF_RANGE, `Expected one Edge ID per Edge of the Room Outline — the shape has ${edges} Edges, the list has ${outline.segmentIds.length}.`)
    return null
  }
  const problems = roomOutlineProblems(outline)
  for (const one of toValidationProblems(problems, path, (problem) => formatGeometryProblem(problem, format))) {
    add(one.path, one.code, one.message)
  }
  return problems.length === 0 ? outline : null
}

/** A list of Edge IDs: each a well-formed ID, none of them the same twice. */
function readSegmentIds(raw: unknown, path: string, add: Add): string[] | null {
  const items = checkArray(raw, path, 'the Room Outline Edge IDs', add)
  if (items === null) return null
  const ids: string[] = []
  const seen = new Set<string>()
  items.forEach((rawId, i) => {
    const at = childPath(path, i)
    const id = checkEntityId(rawId, at, 'a Room Outline Edge ID', add)
    if (id === null) return
    if (seen.has(id)) {
      add(at, DUPLICATE_MEMBER, `Expected each Edge ID of a Room Outline to be unique — ${id} is listed twice.`)
      return
    }
    seen.add(id)
    ids.push(id)
  })
  return ids
}

/** Every Wall face reference of one Room, each checked against the Edge and the face it names. */
function validateRoomFaceRefs(
  raw: unknown,
  path: string,
  outline: RoomOutline | null,
  index: IdIndex,
  scope: ModelScope,
  walls: Map<string, WallShape>,
  floorId: string | null,
  add: Add,
): RoomWallFaceRef[] {
  const items = checkArray(raw, path, 'the Room Wall face references', add)
  if (items === null) return []
  const refs: RoomWallFaceRef[] = []
  const claimed = new Set<string>()
  items.forEach((rawRef, i) => {
    const at = childPath(path, i)
    if (!isRecord(rawRef)) {
      add(at, WRONG_TYPE, 'Expected a Wall face reference.')
      return
    }
    const segmentPath = childPath(at, 'segmentId')
    const wallPath = childPath(at, 'wallId')
    const sidePath = childPath(at, 'side')
    const segmentId = checkEntityId(rawRef.segmentId, segmentPath, 'the referenced Edge ID', add)
    const wallId = checkEntityId(rawRef.wallId, wallPath, 'the referenced Wall ID', add)
    const faceSide = checkOneOf(rawRef.side, sidePath, 'the referenced Wall face', ROOM_FACE_SIDES, add)
    const side = faceSide === null ? null : (faceSide as WallSide)
    checkUnknownFields(rawRef, at, ROOM_FACE_REF_FIELDS, add)
    if (segmentId === null || wallId === null || side === null || outline === null) return

    const segment = roomSegmentOf(outline, segmentId)
    if (segment === null) {
      add(segmentPath, DANGLING_REFERENCE, `Expected the referenced Edge to be an Edge of this Room Outline — no Edge has ID ${segmentId}.`)
      return
    }
    if (segment.segment.kind !== 'line') {
      add(segmentPath, OUT_OF_RANGE, `Expected Edge ${segment.edge} to be straight before it can be referenced to a Wall face — an arc has no single face to lie on.`)
      return
    }
    if (claimed.has(segmentId)) {
      add(segmentPath, DUPLICATE_MEMBER, `Expected at most one Wall face reference per Edge — Edge ${segment.edge} is referenced twice.`)
      return
    }
    claimed.add(segmentId)

    const wall = walls.get(wallId)
    if (wall === undefined) {
      add(
        wallPath,
        DANGLING_REFERENCE,
        missingWallMessage(wallId, index, scope, `Expected the referenced Wall to be a Wall of this Project — no Wall has ID ${wallId}.`),
      )
      return
    }
    if (floorId !== null && wall.floorId !== floorId) {
      add(wallPath, OUT_OF_RANGE, `Expected the referenced Wall ${wall.ref} to stand on the Room's own Floor — it stands on another.`)
      return
    }
    const relation = roomFaceRelation(outline, { segmentId, wallId, side }, wall)
    if (relation === null) return
    const face = `${wall.ref} · ${side === 'left' ? 'left' : 'right'} face`
    if (relation.distance > TOLERANCE_MM) {
      add(at, OUT_OF_RANGE, `Expected Edge ${segment.edge} to lie on ${face} — it is ${relation.distance.toFixed(2)} mm away from it.`)
      return
    }
    if (relation.skew > TOLERANCE_MM) {
      add(at, OUT_OF_RANGE, `Expected Edge ${segment.edge} to run parallel to ${face} — it departs by ${relation.skew.toFixed(2)} mm over its own length.`)
    }
    refs.push({ segmentId, wallId, side })
  })
  return refs
}

/**
 * Every acknowledgement of a warning (#66 §5).
 *
 * Three things are refused here, and each is a way a Project could hold two answers to one
 * question:
 *
 *  - **Duplicate keys.** Two records for the same `(type, subjects, option)` would mean two
 *    notes and two signatures for one warning, and the strip shows one row.
 *  - **Unknown subject IDs.** An acknowledgement whose subject has gone is a record of a
 *    decision about a thing that does not exist. `edit` prunes those inside the same Edit
 *    Transaction as the deletion (#66 §7), so one that arrives in a file was written by
 *    something else.
 *  - **An unknown `designOptionId`.** `null` is the Existing Option; a non-null ID names one
 *    Design Option of this Project (#69 §4). An ID that names nothing is a record of a decision
 *    about a thing that does not exist — the same reason the subject rule below refuses an
 *    unknown subject — and it would also make the key unmatchable, because the engine builds
 *    its key from the Option it is currently deriving.
 *
 * The key itself is `domain`'s `warningKey`, the same function the engine calls: two spellings
 * of one key is a warning that reads `Seen ✓` in one place and open in another.
 */
function validateAcknowledgements(raw: unknown, path: string, index: IdIndex, optionIds: ReadonlySet<string>, add: Add): void {
  const items = checkArray(raw, path, 'the warning acknowledgements', add)
  if (items === null) return
  const keys = new Map<string, string>()
  items.forEach((item, i) => {
    const here = childPath(path, i)
    if (!isRecord(item)) {
      add(here, WRONG_TYPE, 'Expected a warning acknowledgement.')
      return
    }
    const idPath = childPath(here, 'id')
    const id = checkEntityId(item.id, idPath, 'the acknowledgement ID', add)
    if (id !== null) claimId(id, idPath, 'the acknowledgement ID', index, add)
    let ackOption: EntityId | null = null

    const typePath = childPath(here, 'warningType')
    const warningType = checkFilledText(item.warningType, typePath, 'the warning type', add)
    if (warningType !== null && !WARNING_TYPE.test(warningType)) {
      add(typePath, BAD_FORMAT, `Expected the warning type as a lower_snake_case code — "${warningType}" is not one.`)
    }

    const subjectsPath = childPath(here, 'subjectIds')
    const subjects = checkArray(item.subjectIds, subjectsPath, 'the warning subjects', add)
    const ids: string[] = []
    if (subjects !== null) {
      if (subjects.length === 0) {
        add(subjectsPath, OUT_OF_RANGE, 'Expected a warning acknowledgement to name at least one subject.')
      }
      subjects.forEach((subject, j) => {
        const subjectPath = childPath(subjectsPath, j)
        const subjectId = checkEntityId(subject, subjectPath, 'a warning subject ID', add)
        if (subjectId === null) return
        if (!index.first.has(subjectId)) {
          add(subjectPath, DANGLING_REFERENCE, 'Expected a warning subject to be an entity in this Project.')
        }
        if (ids.includes(subjectId)) {
          add(subjectPath, DUPLICATE_ID, 'Expected each warning subject once in one acknowledgement.')
        }
        ids.push(subjectId)
      })
      const sorted = [...ids].sort(compareCodePoints)
      if (ids.some((subjectId, j) => subjectId !== sorted[j])) {
        add(subjectsPath, BAD_FORMAT, 'Expected the warning subject IDs sorted, the way the engine stores them.')
      }
    }

    // `null` is the Existing Option: the warning is acknowledged for the Project as it stands, in
    // every Design Option. A non-null ID names one Option (#69 §4), so it has to name one that
    // exists — an acknowledgement of a warning inside an Option that was deleted is a record of a
    // decision about a thing that does not exist, which is what the subject rule above refuses too.
    const optionPath = childPath(here, 'designOptionId')
    if (item.designOptionId === undefined) {
      add(optionPath, MISSING, 'Missing the Design Option of an acknowledgement — null for the Existing Model.')
    } else if (item.designOptionId !== null) {
      const optionId = checkEntityId(item.designOptionId, optionPath, 'the acknowledgement Design Option ID', add)
      if (optionId !== null) {
        if (optionIds.has(optionId)) ackOption = optionId
        else add(optionPath, DANGLING_REFERENCE, 'Expected the Design Option of an acknowledgement to be a Design Option of this Project.')
      }
    }

    const signature = checkFilledText(item.signature, childPath(here, 'signature'), 'the measurement signature', add)
    if (signature !== null && !/^[0-9a-f]{16}$/.test(signature)) {
      add(
        childPath(here, 'signature'),
        BAD_FORMAT,
        'Expected the measurement signature as the sixteen hex characters `stableHash` writes.',
      )
    }

    const note = checkText(item.note, childPath(here, 'note'), 'the acknowledgement note', add)
    if (note !== null && note.length > ACKNOWLEDGEMENT_NOTE_MAX_LENGTH) {
      add(
        childPath(here, 'note'),
        OUT_OF_RANGE,
        `Expected the acknowledgement note to be at most ${ACKNOWLEDGEMENT_NOTE_MAX_LENGTH} characters.`,
      )
    }

    checkFilledText(item.acknowledgedAt, childPath(here, 'acknowledgedAt'), 'the acknowledgement time', add)
    checkUnknownFields(item, here, ACKNOWLEDGEMENT_FIELDS, add)

    if (warningType !== null && subjects !== null) {
      const key = warningKey(warningType, ids, ackOption)
      const first = keys.get(key)
      if (first !== undefined) {
        add(here, DUPLICATE_ID, `Expected one acknowledgement per warning — ${first} already acknowledges this one.`)
      } else {
        keys.set(key, here)
      }
    }
  })
}

/**
 * The Project's own display settings, for the words around a geometry problem.
 *
 * Validity never depends on this — only the numbers in the message do — so a Project whose
 * preferences are themselves broken is validated at `mm` / 0 dp rather than skipped, and the
 * `preferences` problems are reported by `validatePreferences` in their own right.
 */
function displayFormatOf(value: Rec): DisplayFormat {
  const preferences = isRecord(value.preferences) ? value.preferences : {}
  const unit = DISPLAY_UNITS.includes(preferences.displayUnit as DisplayUnit)
    ? (preferences.displayUnit as DisplayUnit)
    : 'mm'
  const precision = preferences.displayPrecision
  return {
    unit,
    precision: typeof precision === 'number' && Number.isInteger(precision) && precision >= 0 && precision <= 4
      ? precision
      : 0,
  }
}

/**
 * Validate an unknown value as a current-schema {@link Project}.
 *
 * On success the *same object reference* comes back typed as `Project`: nothing is copied, rebuilt
 * or defaulted, so a caller can hand the result straight to `immer` or hash it and get the bytes it
 * was given. On failure every broken invariant is listed, in the order described at the top of this
 * file.
 *
 * With no `checks` the whole document is validated, which is what loading, importing and every test
 * do. `applyIntent` passes a {@link ValidationScope} instead, because a Transaction may not cost a
 * whole re-read of a Project (#69 §8).
 */
export function validateProject(value: unknown, checks: ValidationScope | null = null): ValidateProjectResult {
  // The same reference, kept un-narrowed: validation proves the shape, it never rebuilds
  // the value, so a valid Project comes back as the exact object that was handed in.
  const source: unknown = value
  const problems: ValidationProblem[] = []
  const add: Add = (path, code, message) => {
    problems.push(problem(path, code, message))
  }

  if (!isRecord(value)) {
    add(ROOT_PATH, WRONG_TYPE, 'Expected a Project.')
    return { ok: false, problems }
  }

  const index = indexIds(value)
  const projectId = checkEntityId(value.id, childPath(ROOT_PATH, 'id'), 'the Project ID', add)
  if (projectId !== null) {
    claimId(projectId, childPath(ROOT_PATH, 'id'), 'the Project ID', index, add)
  }
  validateMeta(value.meta, childPath(ROOT_PATH, 'meta'), add)
  validatePreferences(value.preferences, childPath(ROOT_PATH, 'preferences'), add)
  validateFloors(value.floors, childPath(ROOT_PATH, 'floors'), index, add)
  validateViews(value.views, childPath(ROOT_PATH, 'views'), index, add)
  validateDrawingLayers(value.drawingLayers, childPath(ROOT_PATH, 'drawingLayers'), index, add)
  validateItemDesigns(value.itemDesigns, childPath(ROOT_PATH, 'itemDesigns'), index, displayFormatOf(value), checks, add)
  const existing = validateExistingModel(
    value.existingModel,
    childPath(ROOT_PATH, 'existingModel'),
    index,
    displayFormatOf(value),
    checks,
    add,
  )
  // The Existing Model's own Rooms first, so a Project with no Design Options reports exactly the
  // problems it reported before this pass existed, in the same order. Every Room outline is in the
  // pool, scoped pass or not, so an overlap is never missed because one side was untouched.
  checkRoomOverlaps(existing.rooms, add)
  validateDesignOptions(
    value.designOptions,
    childPath(ROOT_PATH, 'designOptions'),
    index,
    displayFormatOf(value),
    existing,
    checks,
    add,
  )
  validateAcknowledgements(value.warningAcknowledgements, childPath(ROOT_PATH, 'warningAcknowledgements'), index, index.optionIds, add)
  checkUnknownFields(value, ROOT_PATH, PROJECT_FIELDS, add)

  return problems.length === 0 ? { ok: true, project: source as Project } : { ok: false, problems }
}

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
import { arcFromThrough, PRESET_KINDS, refLength, refPointAt, toValidationProblems, distance, TOLERANCE_MM } from '../geometry'
import type { ClosedPath, CornerRadii, Preset, Pt, Segment } from '../geometry'
import { ROOT_PATH, childPath, problem, type ValidationProblem } from '../lib'
import { MAX_TREE_DEPTH } from './cabinetPayload'
import { formatGeometryProblem, type DisplayFormat } from './formatGeometryProblem'
import { footprintProblems } from './footprint'
import { nameKey } from './floorNames'
import type { DisplayUnit, ItemFootprint, Project, WallEnd, WallRefLine } from './project'

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
const PROJECT_FIELDS = ['id', 'meta', 'preferences', 'floors', 'views', 'itemDesigns', 'existingModel']
const META_FIELDS = ['name', 'address']
const PREFERENCES_FIELDS = ['displayUnit', 'displayPrecision', 'defaultWallHeight']
const FLOOR_FIELDS = ['id', 'name', 'planImage', 'limits', 'defaultWallHeight']
const FLOOR_LIMITS_FIELDS = ['lowerMm', 'upperMm']
const PLAN_VIEW_FIELDS = ['id', 'kind', 'floorId', 'name', 'isDefault', 'showPlanImage']
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
const EXISTING_MODEL_FIELDS = ['placedItems', 'walls', 'wallJunctions']
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
]
/** The union's four members: a straight line uses three of them, an arc all four (#64 §1). */
const WALL_LINE_FIELDS = ['kind', 'start', 'end', 'through']
const WALL_JUNCTION_FIELDS = ['id', 'floorId', 'ends', 'host']
const WALL_JUNCTION_END_FIELDS = ['wallId', 'end']
const WALL_HOST_FIELDS = ['wallId', 'at']
const PLACED_ITEM_FIELDS = ['id', 'itemDesignId', 'floorId', 'translation', 'rotationDeg', 'baseElevation']
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
}

function indexIds(root: Rec): IdIndex {
  const first = new Map<string, string>()
  const designIds = new Set<string>()
  const floorIds = new Set<string>()
  const claim = (value: unknown, path: string): void => {
    if (typeof value === 'string' && !first.has(value)) first.set(value, path)
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
  if (isRecord(root.existingModel) && Array.isArray(root.existingModel.placedItems)) {
    const items = childPath('existingModel', 'placedItems')
    root.existingModel.placedItems.forEach((item, i) => {
      if (!isRecord(item)) return
      claim(item.id, childPath(childPath(items, i), 'id'))
    })
  }
  if (isRecord(root.existingModel)) {
    const model = root.existingModel
    if (Array.isArray(model.walls)) {
      const walls = childPath('existingModel', 'walls')
      model.walls.forEach((wall, i) => {
        if (isRecord(wall)) claim(wall.id, childPath(childPath(walls, i), 'id'))
      })
    }
    if (Array.isArray(model.wallJunctions)) {
      const junctions = childPath('existingModel', 'wallJunctions')
      model.wallJunctions.forEach((junction, i) => {
        if (isRecord(junction)) claim(junction.id, childPath(childPath(junctions, i), 'id'))
      })
    }
  }

  return { first, designIds, floorIds }
}

/** Rule 5: reported on every occurrence after the first, naming the first path. */
function claimId(id: string, path: string, what: string, index: IdIndex, add: Add): void {
  const first = index.first.get(id)
  if (first !== undefined && first !== path) {
    add(path, DUPLICATE_ID, `Expected ${what} to be unique in this Project — ${first} already uses it.`)
  }
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

function validateItemDesigns(raw: unknown, path: string, index: IdIndex, format: DisplayFormat, add: Add): void {
  const designs = checkArray(raw, path, 'the Item Designs', add)
  if (designs === null) return
  designs.forEach((design, i) => validateItemDesign(design, childPath(path, i), index, format, add))
}

function validatePlacedItem(raw: unknown, path: string, index: IdIndex, add: Add): void {
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
  floorId: string
  line: WallRefLine
}

function validateWall(
  raw: unknown,
  path: string,
  index: IdIndex,
  refs: Map<string, string>,
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
  checkUnknownFields(raw, path, WALL_FIELDS, add)
  if (id === null || floorId === null || line === null) return null
  return { id, floorId, line }
}

/** The Wall ends a Junction holds, kept for the coincidence cross-checks. */
interface JunctionMember {
  wall: WallShape
  end: 'start' | 'end'
}

/** The point of the Wall this member end holds, on the reference line. */
const memberPoint = (member: JunctionMember): Pt => (member.end === 'start' ? member.wall.line.start : member.wall.line.end)

function validateJunctionMember(
  raw: unknown,
  path: string,
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
    add(wallPath, DANGLING_REFERENCE, 'Wall Junction refers to a Wall that is not in this Project.')
    return null
  }
  if (floorId !== null && wall.floorId !== floorId) {
    add(wallPath, DANGLING_REFERENCE, 'Wall Junction joins a Wall that stands on a different Floor from the Junction.')
  }
  const key = `${wallId}\u0000${end}`
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
    add(wallPath, DANGLING_REFERENCE, 'Wall Junction attaches to a Wall that is not in this Project.')
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
  walls: Map<string, WallShape>,
  add: Add,
): void {
  const junctions = checkArray(raw, path, 'the Wall Junctions', add)
  if (junctions === null) return
  // One Wall end, one Junction: the topology a Wall network is built on (#64 §2).
  const taken = new Map<string, string>()
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
        const found = validateJunctionMember(member, childPath(endsPath, j), walls, floorId, taken, add)
        if (found !== null) members.push(found)
      })
    }
    const host = validateJunctionHost(rawJunction.host, childPath(at, 'host'), walls, floorId, add)
    checkUnknownFields(rawJunction, at, WALL_JUNCTION_FIELDS, add)

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
}

function validateExistingModel(raw: unknown, path: string, index: IdIndex, add: Add): void {
  if (raw === undefined) {
    add(path, MISSING, 'Missing the Existing Model.')
    return
  }
  if (!isRecord(raw)) {
    add(path, WRONG_TYPE, 'Expected the Existing Model.')
    return
  }
  const itemsPath = childPath(path, 'placedItems')
  const placedItems = checkArray(raw.placedItems, itemsPath, 'the Existing Model Placed Items', add)
  if (placedItems !== null) {
    placedItems.forEach((item, i) => validatePlacedItem(item, childPath(itemsPath, i), index, add))
  }
  // Walls are validated before their Junctions, which need the Walls' shapes to check that
  // the ends they name exist, stand on their Floor, and actually meet (#64 §2).
  const walls = validateWalls(raw.walls, childPath(path, 'walls'), index, add)
  validateWallJunctions(raw.wallJunctions, childPath(path, 'wallJunctions'), index, walls, add)
  checkUnknownFields(raw, path, EXISTING_MODEL_FIELDS, add)
}

/** Every Wall in the collection that read cleanly, by ID, plus the `ref`s already used. */
function validateWalls(raw: unknown, path: string, index: IdIndex, add: Add): Map<string, WallShape> {
  const walls = new Map<string, WallShape>()
  const refs = new Map<string, string>()
  const items = checkArray(raw, path, 'the Walls', add)
  if (items === null) return walls
  items.forEach((wall, i) => {
    const shape = validateWall(wall, childPath(path, i), index, refs, add)
    if (shape !== null) walls.set(shape.id, shape)
  })
  return walls
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
 * On success the *same object reference* comes back typed as `Project`: nothing is
 * copied, rebuilt or defaulted, so a caller can hand the result straight to `immer` or
 * hash it and get the bytes it was given. On failure every broken invariant is listed,
 * in the order described at the top of this file.
 */
export function validateProject(value: unknown): ValidateProjectResult {
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
  validateItemDesigns(value.itemDesigns, childPath(ROOT_PATH, 'itemDesigns'), index, displayFormatOf(value), add)
  validateExistingModel(value.existingModel, childPath(ROOT_PATH, 'existingModel'), index, add)
  checkUnknownFields(value, ROOT_PATH, PROJECT_FIELDS, add)

  return problems.length === 0 ? { ok: true, project: source as Project } : { ok: false, problems }
}

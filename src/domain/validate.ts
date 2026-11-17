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
import { ROOT_PATH, childPath, problem, type ValidationProblem } from '../lib'
import { MAX_TREE_DEPTH } from './cabinetPayload'
import type { Project } from './project'

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

/** `EntityId` bounds (#42 §3): 1–128 UTF-16 code units, no control characters. */
const ID_MAX_LENGTH = 128

const ASSET_HASH = /^[0-9a-f]{64}$/
const COLOR = /^#[0-9a-f]{6}$/

const DISPLAY_UNITS = ['mm', 'cm', 'm'] as const
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
const FOOTPRINT_KINDS = ['rectangle'] as const
const CABINET_UNITS = ['mm', 'cm', 'in'] as const
const MATERIALS = ['oak', 'walnut', 'white', 'birch', 'mdf'] as const
const SPLIT_AXES = ['horizontal', 'vertical'] as const
const ELEMENT_TYPES = ['void', 'drawer', 'hanging-space', 'microwave'] as const
const SLIDE_TYPES = ['side-mount', 'undermount'] as const
const ACCESSORY_TYPES = ['door', 'drawer-front', 'pull', 'hinge'] as const

// The field lists of §2, one per object level. `unknown-field` is reported against
// anything else the input carries at that level.
const PROJECT_FIELDS = ['id', 'meta', 'preferences', 'floors', 'itemDesigns', 'existingModel']
const META_FIELDS = ['name', 'address']
const PREFERENCES_FIELDS = ['displayUnit', 'displayPrecision']
const FLOOR_FIELDS = ['id', 'name', 'planImage']
const PLAN_IMAGE_FIELDS = ['assetHash', 'mediaType', 'widthPx', 'heightPx', 'pixelsPerMm']
const CABINET_DESIGN_FIELDS = ['id', 'kind', 'name', 'construction']
const GENERIC_DESIGN_FIELDS = [
  'id', 'kind', 'name', 'footprint', 'origin', 'height', 'heightIsTypical', 'color',
  'catalogKey', 'isCustom',
]
const FOOTPRINT_FIELDS = ['kind', 'width', 'depth']
const POINT_FIELDS = ['x', 'y']
const EXISTING_MODEL_FIELDS = ['placedItems']
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

/** A point in millimetres: both coordinates present and finite. */
function checkPoint(value: unknown, path: string, what: string, add: Add): void {
  if (value === undefined) {
    add(path, MISSING, `Missing ${what}.`)
    return
  }
  if (!isRecord(value)) {
    add(path, WRONG_TYPE, `Expected ${what} as a point.`)
    return
  }
  checkNumber(value.x, childPath(path, 'x'), `${what} X`, add)
  checkNumber(value.y, childPath(path, 'y'), `${what} Y`, add)
  checkUnknownFields(value, path, POINT_FIELDS, add)
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
    const key = name.trim().normalize('NFC').toLowerCase()
    const first = names.get(key)
    if (first === undefined) names.set(key, namePath)
    else add(namePath, DUPLICATE_NAME, `Expected a Floor name nobody else uses — ${first} already has this one.`)
  }

  validatePlanImage(raw.planImage, childPath(path, 'planImage'), add)
  checkUnknownFields(raw, path, FLOOR_FIELDS, add)
}

function validateFloors(raw: unknown, path: string, index: IdIndex, add: Add): void {
  const floors = checkArray(raw, path, 'the Floors', add)
  if (floors === null) return
  // A Project with no Floors is valid (#13); the name index belongs to this one Project.
  const names = new Map<string, string>()
  floors.forEach((floor, i) => validateFloor(floor, childPath(path, i), index, names, add))
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

function validateGenericDesign(design: Rec, path: string, add: Add): void {
  const footprintPath = childPath(path, 'footprint')
  if (design.footprint === undefined) {
    add(footprintPath, MISSING, 'Missing the Item Footprint.')
  } else if (!isRecord(design.footprint)) {
    add(footprintPath, WRONG_TYPE, 'Expected the Item Footprint.')
  } else {
    checkOneOf(
      design.footprint.kind,
      childPath(footprintPath, 'kind'),
      'the Item Footprint shape',
      FOOTPRINT_KINDS,
      add,
    )
    checkPositive(design.footprint.width, childPath(footprintPath, 'width'), 'the Item Footprint width', add)
    checkPositive(design.footprint.depth, childPath(footprintPath, 'depth'), 'the Item Footprint depth', add)
    checkUnknownFields(design.footprint, footprintPath, FOOTPRINT_FIELDS, add)
  }

  checkPoint(design.origin, childPath(path, 'origin'), 'the Item Origin', add)
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

function validateItemDesign(raw: unknown, path: string, index: IdIndex, add: Add): void {
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
    validateGenericDesign(raw, path, add)
    checkUnknownFields(raw, path, GENERIC_DESIGN_FIELDS, add)
  }
}

function validateItemDesigns(raw: unknown, path: string, index: IdIndex, add: Add): void {
  const designs = checkArray(raw, path, 'the Item Designs', add)
  if (designs === null) return
  designs.forEach((design, i) => validateItemDesign(design, childPath(path, i), index, add))
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

  checkPoint(raw.translation, childPath(path, 'translation'), 'the Placed Item position', add)
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
  checkUnknownFields(raw, path, EXISTING_MODEL_FIELDS, add)
}

/**
 * Validate an unknown value as a domain v1 {@link Project}.
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
  validateItemDesigns(value.itemDesigns, childPath(ROOT_PATH, 'itemDesigns'), index, add)
  validateExistingModel(value.existingModel, childPath(ROOT_PATH, 'existingModel'), index, add)
  checkUnknownFields(value, ROOT_PATH, PROJECT_FIELDS, add)

  return problems.length === 0 ? { ok: true, project: source as Project } : { ok: false, problems }
}

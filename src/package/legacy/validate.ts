/**
 * The strict legacy validator (#40 §1): pure, no DOM, no randomness, no mutation.
 *
 * The guiding rule is "accept every state the current UI can produce, and reject
 * anything else the app would mis-handle". `fixtures/legacy/` proves the first half;
 * where a captured fixture and a rule disagree, the fixture wins and the rule carries a
 * comment saying so.
 *
 * Unknown extra fields are always kept and never reported — old data carries fields the
 * app stopped writing (node `material` before v2). Rejecting unknown fields belongs to
 * domain v1, not to the legacy reader.
 */
import { isAbsent, isFiniteNumber, isRecord } from './guards'
import { problem, type ValidationProblem } from '../../lib'
import type { LegacyFloorPlanObjectType } from './types'

/** The legacy reader's own depth bound, the same number as `MAX_TREE_DEPTH` in
 * `domain/cabinetPayload`; #40 §4 keeps the two readers independent. */
export const MAX_TREE_DEPTH = 12

/** The root path `validateLegacyPersistedState` reports against, matching the persist envelope. */
const STATE_PATH = 'state'

const MISSING = 'missing-field'
const WRONG_TYPE = 'wrong-type'
const NOT_ONE_OF = 'not-one-of'
const OUT_OF_RANGE = 'out-of-range'
const DUPLICATE_ID = 'duplicate-id'
const EMPTY_LIST = 'empty-list'
const TREE_TOO_DEEP = 'tree-too-deep'
const TREE_CYCLE = 'tree-cycle'
const BAD_CHILDREN = 'bad-children'

const UNITS = ['mm', 'cm', 'in'] as const
const MATERIALS = ['oak', 'walnut', 'white', 'birch', 'mdf'] as const
const SPLIT_AXES = ['horizontal', 'vertical'] as const
const ELEMENT_TYPES = ['void', 'drawer', 'hanging-space', 'microwave'] as const
const SLIDE_TYPES = ['side-mount', 'undermount'] as const
const ACCESSORY_TYPES = ['door', 'drawer-front', 'pull', 'hinge'] as const
const ANNOTATION_TYPES = ['wall-hack', 'tile-zone'] as const
const ROTATIONS = [0, 90, 180, 270] as const
const FLOOR_PLAN_OBJECT_TYPES = [
  'sofa-2', 'sofa-3', 'armchair',
  'bed-single', 'bed-double', 'bed-queen', 'bed-king',
  'fridge', 'washer', 'dryer', 'water-heater', 'robot-vacuum',
  'toilet', 'basin', 'bathtub', 'shower',
  'ceiling-fan', 'light', 'tv', 'curtain-rail',
  'wardrobe', 'kitchen-counter', 'cabinet-unit',
  'custom',
] as const satisfies readonly LegacyFloorPlanObjectType[]

/** Compile-time proof the list above is all 24 literals: a dropped one makes this `false`. */
type UnlistedObjectType = Exclude<LegacyFloorPlanObjectType, (typeof FLOOR_PLAN_OBJECT_TYPES)[number]>
const _everyObjectTypeListed: UnlistedObjectType extends never ? true : false = true
void _everyObjectTypeListed

type Rec = Record<string, unknown>
type Add = (p: ValidationProblem) => void

const child = (base: string, key: string): string => (base ? `${base}.${key}` : key)
const item = (base: string, index: number): string => `${base}[${index}]`

// --- Field checks -------------------------------------------------------------

function checkId(value: unknown, path: string, add: Add): void {
  if (isAbsent(value)) {
    add(problem(path, MISSING, 'Missing an id.'))
  } else if (typeof value !== 'string' || value.length === 0) {
    add(problem(path, WRONG_TYPE, 'Expected an id written as text.'))
  }
}

function checkText(value: unknown, path: string, add: Add): void {
  if (isAbsent(value)) {
    add(problem(path, MISSING, 'Missing text.'))
  } else if (typeof value !== 'string') {
    add(problem(path, WRONG_TYPE, 'Expected text.'))
  }
}

function checkOptionalText(value: unknown, path: string, add: Add): void {
  if (value === undefined) return
  if (typeof value !== 'string') add(problem(path, WRONG_TYPE, 'Expected text.'))
}

function checkOptionalBoolean(value: unknown, path: string, add: Add): void {
  if (value === undefined) return
  if (typeof value !== 'boolean') add(problem(path, WRONG_TYPE, 'Expected yes or no.'))
}

function checkNumber(value: unknown, path: string, add: Add): boolean {
  if (isAbsent(value)) {
    add(problem(path, MISSING, 'Missing a number.'))
    return false
  }
  if (!isFiniteNumber(value)) {
    add(problem(path, WRONG_TYPE, 'Expected a number.'))
    return false
  }
  return true
}

function checkPositive(value: unknown, path: string, add: Add): void {
  if (checkNumber(value, path, add) && (value as number) <= 0) {
    add(problem(path, OUT_OF_RANGE, 'Expected a number greater than 0.'))
  }
}

function checkNotNegative(value: unknown, path: string, add: Add): void {
  if (checkNumber(value, path, add) && (value as number) < 0) {
    add(problem(path, OUT_OF_RANGE, 'Expected a number of 0 or more.'))
  }
}

function checkOneOf(value: unknown, path: string, add: Add, allowed: readonly string[]): void {
  const expected = `Expected one of: ${allowed.join(', ')}.`
  if (isAbsent(value)) {
    add(problem(path, MISSING, expected))
  } else if (typeof value !== 'string' || !allowed.includes(value)) {
    add(problem(path, NOT_ONE_OF, expected))
  }
}

function checkOptionalOneOf(value: unknown, path: string, add: Add, allowed: readonly string[]): void {
  if (value === undefined) return
  checkOneOf(value, path, add, allowed)
}

/** Reports every repeated id in a list of things that carry one. */
function checkUniqueIds(list: unknown[], path: string, add: Add, kind: string): void {
  const seen = new Set<string>()
  list.forEach((raw, i) => {
    if (!isRecord(raw) || typeof raw.id !== 'string' || raw.id.length === 0) return
    if (seen.has(raw.id)) {
      add(problem(child(item(path, i), 'id'), DUPLICATE_ID, `Two ${kind}s use the id "${raw.id}".`))
    }
    seen.add(raw.id)
  })
}

function checkPoint(value: unknown, path: string, add: Add): void {
  if (!isRecord(value)) {
    add(problem(path, WRONG_TYPE, 'Expected a point with an x and a y.'))
    return
  }
  checkNumber(value.x, child(path, 'x'), add)
  checkNumber(value.y, child(path, 'y'), add)
}

// --- Cabinet tree -------------------------------------------------------------

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
 * Iterative on purpose: a stored tree is untrusted input, so recursion depth is not an
 * option. Depth is bounded by `MAX_TREE_DEPTH` (reported once per unit, then descent
 * stops) and identity cycles are caught against the ancestor chain, which also keeps a
 * shared-but-acyclic node legal.
 */
function validateTree(rawRoot: unknown, rootPath: string, add: Add): void {
  if (rawRoot === undefined) {
    add(problem(rootPath, MISSING, 'Missing the cabinet layout.'))
    return
  }
  if (!isRecord(rawRoot)) {
    add(problem(rootPath, WRONG_TYPE, 'Expected the cabinet layout.'))
    return
  }

  let tooDeepReported = false
  const stack: TreeStep[] = [{ node: rawRoot, path: rootPath, depth: 0, ancestors: null }]

  while (stack.length > 0) {
    const step = stack.pop() as TreeStep
    const { node, path, depth, ancestors } = step

    if (depth > MAX_TREE_DEPTH) {
      if (!tooDeepReported) {
        tooDeepReported = true
        add(problem(rootPath, TREE_TOO_DEEP, `A cabinet can be split at most ${MAX_TREE_DEPTH} levels deep.`))
      }
      continue
    }

    checkId(node.id, child(path, 'id'), add)
    checkOptionalOneOf(node.splitAxis, child(path, 'splitAxis'), add, SPLIT_AXES)
    checkOptionalOneOf(node.elementType, child(path, 'elementType'), add, ELEMENT_TYPES)
    checkOptionalText(node.spaceLabel, child(path, 'spaceLabel'), add)
    checkOptionalBoolean(node.locked, child(path, 'locked'), add)

    if (node.splitRatio !== undefined) {
      if (checkNumber(node.splitRatio, child(path, 'splitRatio'), add)) {
        const ratio = node.splitRatio as number
        if (!(ratio > 0 && ratio < 1)) {
          add(problem(child(path, 'splitRatio'), OUT_OF_RANGE, 'Expected a share between 0 and 1.'))
        }
      }
    }
    if (node.fixedSize !== undefined) checkPositive(node.fixedSize, child(path, 'fixedSize'), add)

    if (node.drawerConfig !== undefined) validateDrawerConfig(node.drawerConfig, child(path, 'drawerConfig'), add)
    if (node.dividers !== undefined) validateDividers(node.dividers, child(path, 'dividers'), add)
    if (node.accessories !== undefined) validateAccessories(node.accessories, child(path, 'accessories'), add)

    const children = node.children
    const hasChildren = !isAbsent(children)
    const hasAxis = !isAbsent(node.splitAxis)
    if (!hasChildren) {
      if (hasAxis) {
        add(problem(child(path, 'children'), BAD_CHILDREN, 'A split direction needs exactly two spaces under it.'))
      }
      continue
    }
    if (!Array.isArray(children) || children.length !== 2) {
      add(problem(child(path, 'children'), BAD_CHILDREN, 'A split space needs exactly two spaces under it.'))
      continue
    }
    if (!hasAxis) {
      add(problem(child(path, 'splitAxis'), BAD_CHILDREN, 'A space with two spaces under it needs a split direction.'))
    }

    const here: Ancestors = { node, parent: ancestors }
    children.forEach((rawChild, i) => {
      const childPath = item(child(path, 'children'), i)
      if (!isRecord(rawChild)) {
        add(problem(childPath, BAD_CHILDREN, 'Expected a space here.'))
        return
      }
      if (reachableFrom(here, rawChild)) {
        add(problem(childPath, TREE_CYCLE, 'This space holds itself, so it never ends.'))
        return
      }
      stack.push({ node: rawChild, path: childPath, depth: depth + 1, ancestors: here })
    })
  }
}

function validateDrawerConfig(raw: unknown, path: string, add: Add): void {
  if (!isRecord(raw)) {
    add(problem(path, WRONG_TYPE, 'Expected the drawer runners and reveal.'))
    return
  }
  checkOneOf(raw.slideType, child(path, 'slideType'), add, SLIDE_TYPES)
  checkNotNegative(raw.reveal, child(path, 'reveal'), add)
}

function validateDividers(raw: unknown, path: string, add: Add): void {
  if (!Array.isArray(raw)) {
    add(problem(path, WRONG_TYPE, 'Expected a list of dividers.'))
    return
  }
  raw.forEach((entry, i) => {
    const entryPath = item(path, i)
    if (!isRecord(entry)) {
      add(problem(entryPath, WRONG_TYPE, 'Expected a divider.'))
      return
    }
    checkId(entry.id, child(entryPath, 'id'), add)
    checkOneOf(entry.materialId, child(entryPath, 'materialId'), add, MATERIALS)
  })
}

function validateAccessories(raw: unknown, path: string, add: Add): void {
  if (!Array.isArray(raw)) {
    add(problem(path, WRONG_TYPE, 'Expected a list of accessories.'))
    return
  }
  raw.forEach((entry, i) => {
    const entryPath = item(path, i)
    if (!isRecord(entry)) {
      add(problem(entryPath, WRONG_TYPE, 'Expected an accessory.'))
      return
    }
    checkId(entry.id, child(entryPath, 'id'), add)
    checkOneOf(entry.type, child(entryPath, 'type'), add, ACCESSORY_TYPES)
    checkOptionalText(entry.label, child(entryPath, 'label'), add)
  })
}

// --- Cabinet settings ---------------------------------------------------------

function validateSettings(raw: unknown, path: string, add: Add): void {
  if (raw === undefined) {
    add(problem(path, MISSING, 'Missing the cabinet size and material.'))
    return
  }
  if (!isRecord(raw)) {
    add(problem(path, WRONG_TYPE, 'Expected the cabinet size and material.'))
    return
  }
  checkOneOf(raw.unit, child(path, 'unit'), add, UNITS)
  checkPositive(raw.height, child(path, 'height'), add)
  checkPositive(raw.width, child(path, 'width'), add)
  checkPositive(raw.depth, child(path, 'depth'), add)
  checkPositive(raw.thickness, child(path, 'thickness'), add)
  checkNotNegative(raw.backThickness, child(path, 'backThickness'), add)
  validateToeKick(raw.toeKick, child(path, 'toeKick'), add)
  validateMaterial(raw, path, add)
}

function validateToeKick(raw: unknown, path: string, add: Add): void {
  if (raw === null) return
  if (raw === undefined) {
    add(problem(path, MISSING, 'Missing the toe kick, or null for none.'))
    return
  }
  if (!isRecord(raw)) {
    add(problem(path, WRONG_TYPE, 'Expected a toe kick, or null for none.'))
    return
  }
  checkNotNegative(raw.height, child(path, 'height'), add)
  checkNotNegative(raw.setback, child(path, 'setback'), add)
}

/**
 * `material` from persist v2 on. A Design that never went through the rename — v0/v1
 * data, or a workspace file whose bare Design `upgradeLegacyDesign` only wrapped — still
 * carries `defaultMaterial`, and `fixtures/legacy/workspace/v0-design-shape.buildbox.json`
 * is exactly that file. #40: a fixture that breaks a rule means the rule is wrong, so
 * either key is accepted and a bad value in either is still reported.
 */
function validateMaterial(settings: Rec, path: string, add: Add): void {
  if (settings.material !== undefined) {
    checkOneOf(settings.material, child(path, 'material'), add, MATERIALS)
    return
  }
  if (settings.defaultMaterial !== undefined) {
    checkOneOf(settings.defaultMaterial, child(path, 'defaultMaterial'), add, MATERIALS)
    return
  }
  add(problem(child(path, 'material'), MISSING, 'Missing the cabinet material.'))
}

// --- Units, designs, projects -------------------------------------------------

function validateUnit(raw: unknown, path: string, add: Add): void {
  if (raw === undefined) {
    add(problem(path, MISSING, 'Missing a cabinet.'))
    return
  }
  if (!isRecord(raw)) {
    add(problem(path, WRONG_TYPE, 'Expected a cabinet.'))
    return
  }
  if (raw.type === undefined) {
    add(problem(child(path, 'type'), MISSING, 'Expected a cabinet.'))
  } else if (raw.type !== 'cabinet') {
    add(problem(child(path, 'type'), NOT_ONE_OF, 'Only cabinets are supported.'))
  }
  checkId(raw.id, child(path, 'id'), add)
  checkText(raw.label, child(path, 'label'), add)
  checkNumber(raw.x, child(path, 'x'), add)
  checkNumber(raw.y, child(path, 'y'), add)
  validateSettings(raw.settings, child(path, 'settings'), add)
  validateTree(raw.root, child(path, 'root'), add)
}

function validateDesign(raw: unknown, path: string, add: Add): void {
  if (raw === undefined) {
    add(problem(path, MISSING, 'Missing a project.'))
    return
  }
  if (!isRecord(raw)) {
    add(problem(path, WRONG_TYPE, 'Expected a project.'))
    return
  }
  checkId(raw.id, child(path, 'id'), add)
  checkText(raw.name, child(path, 'name'), add)

  const units = raw.units
  if (units === undefined) {
    add(problem(child(path, 'units'), MISSING, 'Missing the cabinets in this project.'))
    return
  }
  if (!Array.isArray(units)) {
    add(problem(child(path, 'units'), WRONG_TYPE, 'Expected a list of cabinets.'))
    return
  }
  if (units.length === 0) {
    add(problem(child(path, 'units'), EMPTY_LIST, 'A project needs at least one cabinet.'))
  }
  units.forEach((unit, i) => validateUnit(unit, item(child(path, 'units'), i), add))
  checkUniqueIds(units, child(path, 'units'), add, 'cabinet')
}

/** Every project in `value`, reported against `basePath`. All problems, never just the first. */
export function validateLegacyDesigns(value: unknown, basePath: string): ValidationProblem[] {
  const problems: ValidationProblem[] = []
  const add: Add = (p) => { problems.push(p) }

  if (value === undefined) {
    problems.push(problem(basePath, MISSING, 'Missing the list of projects.'))
    return problems
  }
  if (!Array.isArray(value)) {
    problems.push(problem(basePath, WRONG_TYPE, 'Expected a list of projects.'))
    return problems
  }
  if (value.length === 0) {
    problems.push(problem(basePath, EMPTY_LIST, 'Expected at least one project.'))
  }
  value.forEach((design, i) => validateDesign(design, item(basePath, i), add))
  checkUniqueIds(value, basePath, add, 'project')
  return problems
}

// --- Floor plan ---------------------------------------------------------------

function validateList(
  raw: unknown,
  path: string,
  add: Add,
  kind: string,
  entry: (value: unknown, path: string, add: Add) => void,
): void {
  if (raw === undefined) {
    add(problem(path, MISSING, `Missing the list of ${kind}s.`))
    return
  }
  if (!Array.isArray(raw)) {
    add(problem(path, WRONG_TYPE, `Expected a list of ${kind}s.`))
    return
  }
  raw.forEach((value, i) => entry(value, item(path, i), add))
  checkUniqueIds(raw, path, add, kind)
}

function validatePlanImage(raw: unknown, path: string, add: Add): void {
  if (raw === null) return
  if (raw === undefined) {
    add(problem(path, MISSING, 'Missing the plan image, or null for none.'))
    return
  }
  if (!isRecord(raw)) {
    add(problem(path, WRONG_TYPE, 'Expected a plan image, or null for none.'))
    return
  }
  if (typeof raw.dataUrl !== 'string' || !raw.dataUrl.startsWith('data:image/')) {
    add(problem(path, WRONG_TYPE, 'Expected an image stored inside the data.'))
  }
  checkPositive(raw.widthPx, child(path, 'widthPx'), add)
  checkPositive(raw.heightPx, child(path, 'heightPx'), add)
}

function validatePlanObject(raw: unknown, path: string, add: Add): void {
  if (!isRecord(raw)) {
    add(problem(path, WRONG_TYPE, 'Expected something placed on the plan.'))
    return
  }
  checkId(raw.id, child(path, 'id'), add)
  checkOneOf(raw.type, child(path, 'type'), add, FLOOR_PLAN_OBJECT_TYPES)
  checkText(raw.label, child(path, 'label'), add)
  checkNumber(raw.x, child(path, 'x'), add)
  checkNumber(raw.y, child(path, 'y'), add)
  checkPositive(raw.w, child(path, 'w'), add)
  checkPositive(raw.h, child(path, 'h'), add)
  if (raw.rotation === undefined) {
    add(problem(child(path, 'rotation'), MISSING, 'Expected a turn of 0, 90, 180 or 270 degrees.'))
  } else if (!ROTATIONS.includes(raw.rotation as 0 | 90 | 180 | 270)) {
    add(problem(child(path, 'rotation'), NOT_ONE_OF, 'Expected a turn of 0, 90, 180 or 270 degrees.'))
  }
  checkText(raw.color, child(path, 'color'), add)
  checkOptionalBoolean(raw.isCustom, child(path, 'isCustom'), add)
}

function validateAnnotation(raw: unknown, path: string, add: Add): void {
  if (!isRecord(raw)) {
    add(problem(path, WRONG_TYPE, 'Expected an annotation.'))
    return
  }
  checkId(raw.id, child(path, 'id'), add)
  checkOneOf(raw.type, child(path, 'type'), add, ANNOTATION_TYPES)
  checkOptionalText(raw.label, child(path, 'label'), add)

  const points = raw.points
  const pointsPath = child(path, 'points')
  if (!Array.isArray(points)) {
    add(problem(pointsPath, WRONG_TYPE, 'Expected a list of points.'))
    return
  }
  // #40 asked for exactly two points on a tile-zone, but the captured v3 fixture — the
  // input this reader must accept — stores a 4-point tile-zone, and AnnotationLayer
  // renders any annotation with >= 2 points (a zone from its first two). The fixture
  // wins: both kinds need at least two points, more is fine.
  if (points.length < 2) {
    add(problem(pointsPath, EMPTY_LIST, 'Expected at least two points.'))
  }
  points.forEach((point, i) => checkPoint(point, item(pointsPath, i), add))
}

function validateTemplate(raw: unknown, path: string, add: Add): void {
  if (!isRecord(raw)) {
    add(problem(path, WRONG_TYPE, 'Expected a saved shape.'))
    return
  }
  checkId(raw.id, child(path, 'id'), add)
  checkText(raw.label, child(path, 'label'), add)
  checkPositive(raw.defaultW, child(path, 'defaultW'), add)
  checkPositive(raw.defaultH, child(path, 'defaultH'), add)
  checkText(raw.color, child(path, 'color'), add)
}

/** The v3 floor plan, reported against `basePath`. */
export function validateLegacyFloorPlan(value: unknown, basePath: string): ValidationProblem[] {
  const problems: ValidationProblem[] = []
  const add: Add = (p) => { problems.push(p) }

  if (value === undefined) {
    problems.push(problem(basePath, MISSING, 'Missing the floor plan.'))
    return problems
  }
  if (!isRecord(value)) {
    problems.push(problem(basePath, WRONG_TYPE, 'Expected the floor plan.'))
    return problems
  }

  validatePlanImage(value.image, child(basePath, 'image'), add)
  if (value.pixelsPerMm === undefined) {
    problems.push(problem(child(basePath, 'pixelsPerMm'), MISSING, 'Missing the plan scale, or null for none.'))
  } else if (value.pixelsPerMm !== null) {
    checkPositive(value.pixelsPerMm, child(basePath, 'pixelsPerMm'), add)
  }
  validateList(value.objects, child(basePath, 'objects'), add, 'floor plan object', validatePlanObject)
  validateList(value.annotations, child(basePath, 'annotations'), add, 'annotation', validateAnnotation)
  validateList(value.customTemplates, child(basePath, 'customTemplates'), add, 'custom shape', validateTemplate)
  return problems
}

// --- Persisted state ----------------------------------------------------------

/**
 * The v3 state, after `migrateLegacyState`. Paths are rooted at `state`, the key the
 * persist envelope uses, so a problem points straight at what is in storage.
 */
export function validateLegacyPersistedState(value: unknown): ValidationProblem[] {
  const problems: ValidationProblem[] = []

  if (value === undefined) {
    problems.push(problem(STATE_PATH, MISSING, 'Missing the saved data.'))
    return problems
  }
  if (!isRecord(value)) {
    problems.push(problem(STATE_PATH, WRONG_TYPE, 'Expected the saved BuildBox data.'))
    return problems
  }

  problems.push(...validateLegacyDesigns(value.projects, child(STATE_PATH, 'projects')))

  const activeProjectId = value.activeProjectId
  if (activeProjectId !== undefined && activeProjectId !== null) {
    const path = child(STATE_PATH, 'activeProjectId')
    if (typeof activeProjectId !== 'string') {
      problems.push(problem(path, WRONG_TYPE, 'Expected the id of a saved project.'))
    } else {
      const projects = Array.isArray(value.projects) ? value.projects : []
      if (!projects.some((project) => isRecord(project) && project.id === activeProjectId)) {
        problems.push(problem(path, NOT_ONE_OF, 'The open project is not one of the saved projects.'))
      }
    }
  }

  problems.push(...validateLegacyFloorPlan(value.floorPlan, child(STATE_PATH, 'floorPlan')))
  return problems
}

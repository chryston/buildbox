/**
 * The one automatic fix the converter makes: duplicate IDs (#43).
 *
 * Every other problem rejects the `Design` it belongs to; a repeated ID does not, because
 * replacing it cannot change what the data meant — an ID is a name, not a measurement.
 * Each replacement is recorded, so the Migration review can say which names it changed.
 *
 * This runs on the migrated value *before* the validators, which is what lets a legacy
 * `Design` with two units sharing an ID survive the strict legacy validator's own
 * duplicate check and the domain validator's Project-wide namespace.
 *
 * The three namespaces are exactly the ones the domain validator keeps apart (#42 §3):
 * unit IDs inside one `Design`, the feature IDs inside one Item Design (spaces, dividers
 * and accessories share one namespace there), and every ID inside the floor plan.
 *
 * Hostile input is the norm here — this runs before anything has been checked — so every
 * walk is iterative and an identity cycle is skipped the way both validators skip it.
 */
import { isRecord, type UnknownRecord } from './guards'
import type { IdRegeneration, IdRegenerationScope } from './conversion'

/** A `newId` that keeps handing back a name already in use is a caller bug; stop rather than spin. */
const MAX_ID_ATTEMPTS = 1000

/** The node objects on the path to the node being visited, innermost first. */
type Ancestors = { node: UnknownRecord; parent: Ancestors | null }

interface Fixer {
  readonly newId: () => string
  readonly regenerated: IdRegeneration[]
}

/**
 * Unit IDs inside one `Design`, and the feature IDs inside each unit's cabinet tree.
 * `designPath` roots the recorded paths in the value being converted, so a regeneration
 * names the field the user could otherwise have downloaded — `projects[0].units[1].id`.
 */
export function dedupeDesignIds(
  design: UnknownRecord,
  designPath: string,
  newId: () => string,
): IdRegeneration[] {
  const fixer: Fixer = { newId, regenerated: [] }
  const units = Array.isArray(design.units) ? design.units : []
  const taken = new Set<string>()

  units.forEach((rawUnit, unitIndex) => {
    if (!isRecord(rawUnit)) return
    const unitPath = `${designPath}.units[${unitIndex}]`
    replaceDuplicateId(rawUnit, `${unitPath}.id`, 'unit', taken, fixer)
    dedupeFeatureIds(rawUnit.root, `${unitPath}.root`, fixer)
  })

  return fixer.regenerated
}

/** Every ID inside the floor plan — objects, annotations and saved shapes — in one namespace. */
export function dedupeFloorPlanIds(
  floorPlan: unknown,
  basePath: string,
  newId: () => string,
): IdRegeneration[] {
  const fixer: Fixer = { newId, regenerated: [] }
  if (!isRecord(floorPlan)) return fixer.regenerated

  const taken = new Set<string>()
  for (const list of ['objects', 'annotations', 'customTemplates'] as const) {
    const entries = floorPlan[list]
    if (!Array.isArray(entries)) continue
    entries.forEach((entry, index) => {
      if (!isRecord(entry)) return
      replaceDuplicateId(entry, `${basePath}.${list}[${index}].id`, 'floor-plan', taken, fixer)
    })
  }
  return fixer.regenerated
}

/**
 * The feature IDs of one cabinet tree. They share one namespace per Item Design, so a
 * space, a divider and a pull that all happen to be called `x1` are three duplicates of
 * the same name — which is what `validateProject` will insist on next.
 */
function dedupeFeatureIds(
  rawRoot: unknown,
  rootPath: string,
  fixer: Fixer,
): void {
  if (!isRecord(rawRoot)) return

  const taken = new Set<string>()
  const stack: Array<{ node: UnknownRecord; path: string; ancestors: Ancestors | null }> = [
    { node: rawRoot, path: rootPath, ancestors: null },
  ]

  while (stack.length > 0) {
    const { node, path, ancestors } = stack.pop() as {
      node: UnknownRecord
      path: string
      ancestors: Ancestors | null
    }
    replaceDuplicateId(node, `${path}.id`, 'cabinet-node', taken, fixer)
    for (const list of ['dividers', 'accessories'] as const) {
      const entries = node[list]
      if (!Array.isArray(entries)) continue
      entries.forEach((entry, index) => {
        if (!isRecord(entry)) return
        replaceDuplicateId(entry, `${path}.${list}[${index}].id`, 'cabinet-node', taken, fixer)
      })
    }

    const children = node.children
    if (!Array.isArray(children)) continue
    const here: Ancestors = { node, parent: ancestors }
    // Reverse order into a stack, so the first space in the document is the first one
    // visited — the first name heard is the one that keeps it.
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const rawChild = children[index]
      // A child that is one of its own ancestors never ends; the validators report it.
      if (!isRecord(rawChild) || reachable(here, rawChild)) continue
      stack.push({ node: rawChild, path: `${path}.children[${index}]`, ancestors: here })
    }
  }
}

function reachable(ancestors: Ancestors | null, node: UnknownRecord): boolean {
  for (let walk = ancestors; walk !== null; walk = walk.parent) {
    if (walk.node === node) return true
  }
  return false
}

/**
 * Replace `holder.id` when its name is already taken, and record what was done. A holder
 * without a usable ID is left exactly as it is: that is a problem for a validator, not a
 * duplicate to fix.
 */
function replaceDuplicateId(
  holder: UnknownRecord,
  path: string,
  scope: IdRegenerationScope,
  taken: Set<string>,
  fixer: Fixer,
): void {
  const oldId = holder.id
  if (typeof oldId !== 'string') return
  if (!taken.has(oldId)) {
    taken.add(oldId)
    return
  }

  const fresh = freshId(taken, fixer.newId)
  holder.id = fresh
  fixer.regenerated.push({ scope, path, oldId, newId: fresh })
}

function freshId(taken: Set<string>, newId: () => string): string {
  let candidate = newId()
  for (let attempt = 0; attempt < MAX_ID_ATTEMPTS && taken.has(candidate); attempt += 1) {
    candidate = newId()
  }
  taken.add(candidate)
  return candidate
}

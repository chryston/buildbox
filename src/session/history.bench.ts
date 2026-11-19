/**
 * The #48 performance budget: what 200 steps of history cost in retained bytes, measured on
 * `fixtures/domain/v1/reference-project.json` — the largest Project the fixtures carry.
 *
 * #20 §8 caps the undo stack at 200 steps because the alternative is a Project's memory
 * growing without limit while the user works. The cap is only worth having if a step is what
 * it claims to be: the forward and reverse patch of one edit, not a copy of the Project.
 * Two hundred real edits of the reference Project, each recorded as a step, is the
 * measurement that says so.
 *
 * Retained bytes are the heap's high-water difference between two forced collections, with
 * the history held in a module binding across the second one so the collector cannot count
 * its own bookkeeping as freed. `--expose-gc` is what makes the collection possible; the
 * `pure` project passes it to its workers in `vite.config.ts`. Without it the figure below
 * would be whatever the collector happened to leave behind, so the bench says so and declines
 * to fail the run on a number that means nothing.
 */
import { bench, describe } from 'vitest'
import { applyIntent, INTENT_LABELS } from '../edit'
import type { Intent } from '../edit'
import { migrateProject } from '../domain'
import type { Project } from '../domain'
import { createHistory, HISTORY_LIMIT } from './history'
import type { History } from './history'
import type { HistoryEntry } from './types'

const TARGET_RETAINED_BYTES = 25 * 1024 * 1024
const FAIL_ABOVE_BYTES = 50 * 1024 * 1024

const SOURCES = import.meta.glob<string>('/fixtures/domain/v1/reference-project.json', {
  eager: true,
  query: '?raw',
  import: 'default',
})
const raw = Object.values(SOURCES)[0]
if (raw === undefined) throw new Error('fixtures/domain/v1/reference-project.json is missing')
const envelope = JSON.parse(raw) as { domainSchemaVersion: number; project: Project }
if (envelope.domainSchemaVersion !== 1) {
  throw new Error(`unsupported domainSchemaVersion ${String(envelope.domainSchemaVersion)}`)
}
// The fixture is a v1 document and the bench measures the domain as it is now, so the Project
// goes through the same migration opening a Project does — since #56 that is what gives every
// Floor its Plan Views.
let issued = 0
const migrated = migrateProject(envelope.project, envelope.domainSchemaVersion, (count = 1) =>
  Array.from({ length: count }, () => `bench-view-${String(++issued)}`))
if (!migrated.ok) throw new Error(`reference-project.json: ${migrated.error.message}`)
const project = migrated.project

const placed = project.existingModel.placedItems.find(
  (item) => project.itemDesigns.find((design) => design.id === item.itemDesignId)?.kind === 'generic',
)
if (placed === undefined) throw new Error('the reference project has no Placed generic Item')
const movedId = placed.id
const movedX = placed.translation.x
const movedY = placed.translation.y

// A bench file is not a `*.test.ts` file, so it may not reach a module's `testing.ts`
// (#42 §7); these Intents are built the same way, with the label the catalogue gives them.
const NOW = '2026-11-18T00:00:00.000Z'

/** Two hundred distinct edits, alternating between the Plan and the Project's own name. */
function intentAt(index: number): Intent {
  return index % 2 === 0
    ? {
        type: 'plan.movePlacement',
        payload: { placedItemId: movedId, translation: { x: movedX + index * 0.5, y: movedY } },
        label: INTENT_LABELS['plan.movePlacement'],
        ids: [],
        now: NOW,
      }
    : {
        type: 'project.rename',
        payload: { name: `Reference Project ${String(index)}` },
        label: INTENT_LABELS['project.rename'],
        ids: [],
        now: NOW,
      }
}

/** 200 steps of the reference Project, each one a real edit whose patches are recorded. */
function buildHistory(): History {
  const history = createHistory()
  let current = project
  for (let index = 0; index < HISTORY_LIMIT; index += 1) {
    const intent = intentAt(index)
    const applied = applyIntent(current, intent)
    if (!applied.ok) throw new Error(`the bench Intent was refused: ${applied.code}`)
    const entry: HistoryEntry = {
      label: intent.label,
      patches: applied.patches,
      inversePatches: applied.inversePatches,
      locator: applied.affected,
    }
    history.push(entry)
    current = applied.project
  }
  return history
}

interface GcGlobal {
  gc?: () => void
}

/** Force a collection, if the engine was started with `--expose-gc`. */
function collect(): boolean {
  const gc = (globalThis as GcGlobal).gc
  if (typeof gc !== 'function') return false
  gc()
  return true
}

const forced = collect()
collect()
const emptyHeap = process.memoryUsage().heapUsed
/** Held here so the collector keeps every step alive across the second reading. */
const history = buildHistory()
collect()
const retained = Math.max(0, process.memoryUsage().heapUsed - emptyHeap)

const megabytes = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(2)} MB`

console.info(
  `#48 history budget: target ${megabytes(TARGET_RETAINED_BYTES)} retained, fail above ${megabytes(FAIL_ABOVE_BYTES)}\n` +
    `  ${String(HISTORY_LIMIT)} steps of the reference Project: ${megabytes(retained)} retained ` +
    `(${(retained / HISTORY_LIMIT / 1024).toFixed(1)} KiB per step)` +
    (forced ? '' : ' — no --expose-gc, so this is an upper bound and the budget was not enforced'),
)

describe('the history of 200 steps', () => {
  bench('200 history steps', () => {
    buildHistory()
  }, { iterations: 2, time: 0, warmupIterations: 0, warmupTime: 0 })

  bench('undo and redo of one step', () => {
    const back = history.takeUndo()
    if (back === null) throw new Error('a full history offered nothing to undo')
    history.commitUndo(back)
    const forward = history.takeRedo()
    if (forward === null) throw new Error('an undone step offered nothing to redo')
    history.commitRedo(forward)
  }, { iterations: 200, time: 0, warmupIterations: 20, warmupTime: 0 })

  if (forced && retained > FAIL_ABOVE_BYTES) {
    throw new Error(
      `${String(HISTORY_LIMIT)} history steps retain ${megabytes(retained)}, above the ${megabytes(FAIL_ABOVE_BYTES)} limit`,
    )
  }
  if (forced && retained > TARGET_RETAINED_BYTES) {
    console.warn(`over the ${megabytes(TARGET_RETAINED_BYTES)} target: ${megabytes(retained)}`)
  }
})

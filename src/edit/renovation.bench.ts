/**
 * The #69 performance budget, measured on `fixtures/bench/renovation-reference.json`.
 *
 * Two actions and one derive, chosen because they are the expensive shapes of the renovation model
 * rather than the common ones: a `replaceInOption` on a Wall that carries two Openings, a hosted
 * Junction and a Room claiming its face (the successor, the carried Openings, the carried Junction
 * and the Room successor are all written in one transaction); and a `correctExistingModel` of a Wall
 * that all three Design Options have taken down, which previews and re-validates every Option before
 * it commits. Then `effectiveFloor` for the active Floor under an active Option, which is what a
 * frame costs.
 *
 * `npm run bench` prints the means; the run fails above the issue's budgets — 30 ms for apply +
 * validate, 50 ms for derive — and the flag-off pass never sees this file (#69 Scope 16).
 *
 * **The apply budget is breached on this Project and the run says so.** Whole-document validation
 * costs 138 ms of the 152 ms a `replaceInOption` takes, and the correction previews every Option so
 * it pays that six times. The decomposition is measured in #69's report: Room overlap pairs are 70 µs
 * each (1305 pairs on this Project), the Design Option pass is 97 ms, the 630 Item Designs are 29 ms,
 * and the Walls, Openings, Junctions and Placed Items together are 15 ms. Meeting 30 ms needs
 * validation scoped to the entities a transaction touched plus their referrers, which is what
 * architecture §4 allows and what the issue directs when a budget is breached; the budget itself is
 * not moved. `effectiveFloor` is nowhere near its ceiling at 1.3 ms.
 */
import { bench, describe } from 'vitest'
import { effectiveFloor } from '../derive'
import { designOptionsOf, validateProject } from '../domain'
import type { Project, Wall } from '../domain'
import { FF_RENOVATION } from '../lib'
import { applyIntent } from './apply'
import type { Intent } from './intents'
import { intentLabel } from './labels'

const APPLY_BUDGET_MS = 30
const DERIVE_BUDGET_MS = 50
const ITERATIONS = 20
const WARMUP = 5

if (!FF_RENOVATION) {
  throw new Error('this bench measures the renovation model: run it with VITE_FF_RENOVATION=true (`npm run bench` does)')
}

const SOURCES = import.meta.glob<string>('/fixtures/bench/renovation-reference.json', {
  eager: true,
  query: '?raw',
  import: 'default',
})
const raw = Object.values(SOURCES)[0]
if (raw === undefined) throw new Error('fixtures/bench/renovation-reference.json is missing')
const envelope = JSON.parse(raw) as { domainSchemaVersion: number; project: Project }
if (envelope.domainSchemaVersion !== 8) throw new Error(`unsupported domainSchemaVersion ${String(envelope.domainSchemaVersion)}`)
const project = envelope.project
if (!validateProject(project).ok) throw new Error('the renovation reference Project does not validate')

const NOW = '2026-11-18T00:00:00.000Z'
const floorId = project.floors[0]!.id
const options = designOptionsOf(project)
if (options.length !== 3) throw new Error('the renovation reference Project is meant to carry three Options')
const [optionA, , optionC] = options as [typeof options[0], typeof options[0], typeof options[0]]

/** The Floor's rails, in the order the generator drew them: `rails[0]` is `W-1`. */
const railsOf = (floor: string): Wall[] => project.existingModel.walls.filter((wall) => wall.floorId === floor && wall.line.kind === 'line' && wall.line.start.y === wall.line.end.y)
const rails = railsOf(floorId)
if (rails.length < 75) throw new Error('the renovation reference Project is meant to carry 75 rails on its first Floor')

/** The Wall `replaceInOption` runs on: two Openings, a hosted Junction's host, a Room's face. */
const replaced = rails[0]!
const corrected = rails[70]!

let issued = 0
const ids = (count: number): string[] => Array.from({ length: count }, () => `bench-renovation-${String(++issued)}`)

const replaceCase: Intent = {
  type: 'renovation.replace',
  payload: { entityId: replaced.id, edit: {}, target: { designOptionId: optionA.id } },
  label: intentLabel('renovation.replace'),
  ids: ids(24),
  now: NOW,
}

const correctionCase: Intent = {
  type: 'renovation.correctExistingModel',
  payload: {
    inner: {
      type: 'wall.setThickness',
      payload: { wallId: corrected.id, thickness: 220 },
      label: intentLabel('wall.setThickness'),
      ids: [],
      now: NOW,
    },
  },
  label: intentLabel('renovation.correctExistingModel'),
  ids: [],
  now: NOW,
}

/** One timed apply + validate, in milliseconds. */
function runOnce(intent: Intent): number {
  const started = performance.now()
  const result = applyIntent(project, intent)
  const elapsed = performance.now() - started
  if (!result.ok) throw new Error(`${intent.type}: refused with ${result.code}`)
  return elapsed
}

function meanOf(intent: Intent): number {
  for (let index = 0; index < WARMUP; index += 1) runOnce(intent)
  let total = 0
  for (let index = 0; index < ITERATIONS; index += 1) total += runOnce(intent)
  return total / ITERATIONS
}

/** One timed derive of the active Floor under the active Option, on a fresh revision each time. */
function runDerive(revision: number): number {
  const started = performance.now()
  effectiveFloor(project, revision, floorId, optionC.id)
  return performance.now() - started
}

function meanDerive(): number {
  for (let index = 0; index < WARMUP; index += 1) runDerive(index)
  let total = 0
  for (let index = 0; index < ITERATIONS; index += 1) total += runDerive(100 + index)
  return total / ITERATIONS
}

const CASES: { name: string; intent: Intent }[] = [
  { name: 'renovation.replace (2 Openings, a Junction, a referencing Room)', intent: replaceCase },
  { name: 'renovation.correctExistingModel (3 Options)', intent: correctionCase },
]

const means = CASES.map((testCase) => ({ name: testCase.name, mean: meanOf(testCase.intent) }))
const deriveMean = meanDerive()
means.push({ name: 'effectiveFloor (active Floor + Option)', mean: deriveMean })

console.info(
  `#69 budget: apply + validate ${String(APPLY_BUDGET_MS)} ms, derive ${String(DERIVE_BUDGET_MS)} ms\n` +
    means.map((each) => `  ${each.name}: ${each.mean.toFixed(2)} ms mean`).join('\n'),
)

describe('the renovation model on the reference project', () => {
  for (const testCase of CASES) {
    bench(testCase.name, () => {
      runOnce(testCase.intent)
    }, { iterations: ITERATIONS, time: 0, warmupIterations: 2, warmupTime: 0 })
  }
  bench('effectiveFloor (active Floor + Option)', () => {
      runDerive(1_000)
    }, { iterations: ITERATIONS, time: 0, warmupIterations: 2, warmupTime: 0 })

  const overApply = means.filter((each, index) => index < CASES.length && each.mean > APPLY_BUDGET_MS)
  if (overApply.length > 0) {
    throw new Error(
      overApply.map((each) => `${each.name}: ${each.mean.toFixed(2)} ms mean, above the ${String(APPLY_BUDGET_MS)} ms budget`).join('\n'),
    )
  }
  if (deriveMean > DERIVE_BUDGET_MS) {
    throw new Error(`effectiveFloor: ${deriveMean.toFixed(2)} ms mean, above the ${String(DERIVE_BUDGET_MS)} ms budget`)
  }
})

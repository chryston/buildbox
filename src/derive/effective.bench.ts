/**
 * The #60 derive budget: what one Floor costs to read out of the Project when nothing has been
 * derived before.
 *
 * The cache is thrown away between iterations on purpose. A warm cache measures a `Map` lookup,
 * and the number the issue cares about is the cold path — the one a person hits the moment they
 * switch Floor, change a Plan View option, or undo. `npm run bench` prints the mean; the target
 * is 50 ms and the run fails above 100 ms.
 */
import { bench, describe } from 'vitest'
import { migrateProject } from '../domain'
import type { Project } from '../domain'
import { createDeriveCache } from './cache'
import { effectiveFloor } from './effective'

const TARGET_MEAN_MS = 50
const FAIL_ABOVE_MS = 100
const ITERATIONS = 20
const WARMUP = 10

// The same way `src/edit/apply.bench.ts` reads it: the fixture is JSON on disk, and a bench may
// not reach `derive/testing.ts`, which is a test entry point (#42 §7).
const SOURCES = import.meta.glob<string>('/fixtures/domain/v3/reference-project.json', {
  eager: true,
  query: '?raw',
  import: 'default',
})
const raw = Object.values(SOURCES)[0]
if (raw === undefined) throw new Error('fixtures/domain/v3/reference-project.json is missing')
const envelope = JSON.parse(raw) as { domainSchemaVersion: number; project: Project }
// The allocator counts as it issues, and the count lives inside the call: nothing in `derive`
// may hold module-level mutable state, and a bench is in `derive`.
const project = (() => {
  let issued = 0
  const migrated = migrateProject(envelope.project, envelope.domainSchemaVersion, (count = 1) =>
    Array.from({ length: count }, () => `bench-view-${String(++issued)}`))
  if (!migrated.ok) throw new Error(`reference-project.json: ${migrated.error.message}`)
  return migrated.project
})()

const floorId = project.floors[0]?.id
if (floorId === undefined) throw new Error('the reference project has no Floor')

/** One cold derive: a cache nothing has touched, then the Floor the reference project opens on. */
function runOnce(): number {
  const cache = createDeriveCache()
  const started = performance.now()
  const floor = cache.floor(project, 1, floorId, null)
  const elapsed = performance.now() - started
  if (floor.placements.length === 0) throw new Error('the reference Floor derived no placements')
  return elapsed
}

/** The same work without the cache object, so the two numbers can be told apart. */
function runDirect(): number {
  const started = performance.now()
  effectiveFloor(project, 1, floorId, null)
  return performance.now() - started
}

function meanOf(run: () => number): number {
  // The first calls run on unwarmed code: without these discarded passes the number comes out
  // ~40 % high and the budget would be judged on interpreter warm-up, not on the work.
  for (let index = 0; index < WARMUP; index += 1) run()
  let total = 0
  for (let index = 0; index < ITERATIONS; index += 1) total += run()
  return total / ITERATIONS
}

// Measured once, before the reporter's own passes, so the budget check has a number to compare
// against whatever `vitest bench` decides to report.
const cached = meanOf(runOnce)
const direct = meanOf(runDirect)
console.info(
  `#60 derive budget: target ${String(TARGET_MEAN_MS)} ms mean, fail above ${String(FAIL_ABOVE_MS)} ms\n` +
  `  effectiveFloor (cold cache): ${cached.toFixed(2)} ms mean\n` +
  `  effectiveFloor (no cache):   ${direct.toFixed(2)} ms mean`,
)

describe('effectiveFloor on the reference project', () => {
  bench('effectiveFloor (cold cache)', () => {
    runOnce()
  }, { iterations: ITERATIONS, time: 0, warmupIterations: 2, warmupTime: 0 })

  if (direct > FAIL_ABOVE_MS) {
    throw new Error(`effectiveFloor: ${direct.toFixed(2)} ms mean, above the ${String(FAIL_ABOVE_MS)} ms limit`)
  }
  if (direct > TARGET_MEAN_MS) console.warn(`over the ${String(TARGET_MEAN_MS)} ms target: ${direct.toFixed(2)} ms mean`)
})

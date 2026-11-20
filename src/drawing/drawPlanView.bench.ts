/**
 * The #60 drawing budget: turning a derived Floor, and a derived cabinet, into a display list and
 * then into SVG bytes.
 *
 * This is the half of the frame budget the app controls: derive gives the same numbers every
 * time, so what a pan or a zoom costs is the drawing. Both surfaces are measured at the two
 * sizings they are actually drawn at — a screen at zoom 1 and a sheet at print scale — because a
 * `SizeRole` resolves differently on each and only one of them is on the hot path.
 * `npm run bench` prints the mean; the target is 50 ms and the run fails above 100 ms.
 */
import { bench, describe } from 'vitest'
import { migrateProject } from '../domain'
import type { Project } from '../domain'
import { effectiveFloor, effectiveItemDetail } from '../derive'
import type { Sizing } from './types'
import { drawItemDetail } from './itemDetail'
import { drawPlanView } from './planView'
import { toSvgTree } from './svg'

const TARGET_MEAN_MS = 50
const FAIL_ABOVE_MS = 100
const ITERATIONS = 20
const WARMUP = 10

// The fixture is JSON on disk, read the way `src/edit/apply.bench.ts` reads it: a bench may not
// reach `derive/testing.ts`, which is a test entry point (#42 §7).
const SOURCES = import.meta.glob<string>('/fixtures/domain/v3/reference-project.json', {
  eager: true,
  query: '?raw',
  import: 'default',
})
const raw = Object.values(SOURCES)[0]
if (raw === undefined) throw new Error('fixtures/domain/v3/reference-project.json is missing')
const envelope = JSON.parse(raw) as { domainSchemaVersion: number; project: Project }
// The allocator counts as it issues, and the count lives inside the call: nothing in `drawing`
// may hold module-level mutable state, and a bench is in `drawing`.
const project = (() => {
  let issued = 0
  const migrated = migrateProject(envelope.project, envelope.domainSchemaVersion, (count = 1) =>
    Array.from({ length: count }, () => `bench-view-${String(++issued)}`))
  if (!migrated.ok) throw new Error(`reference-project.json: ${migrated.error.message}`)
  return migrated.project
})()

const floorId = project.floors[0]?.id
if (floorId === undefined) throw new Error('the reference project has no Floor')
const cabinet = project.itemDesigns.find((design) => design.kind === 'cabinet')
if (cabinet === undefined) throw new Error('the reference project has no cabinet')

const SCREEN: Sizing = { kind: 'screen', pxPerMm: 1 }
const PAPER: Sizing = { kind: 'paper', scale: 100 }

const floor = effectiveFloor(project, 1, floorId, null)
const detail = effectiveItemDetail(project, 1, cabinet.id, floorId)
const formatLength = (mm: number): string => `${mm.toFixed(1)}`

/** One full frame of one surface: the list, and the bytes a canvas or an export would render. */
function drawPlan(sizing: Sizing): number {
  const started = performance.now()
  const list = drawPlanView(floor, { showPlanImage: true }, { sizing })
  toSvgTree(list, { sizing, includeRefs: false, resolveAsset: () => null })
  return performance.now() - started
}

function drawCabinet(sizing: Sizing): number {
  const started = performance.now()
  const list = drawItemDetail(detail, {}, { sizing, formatLength })
  toSvgTree(list, { sizing, includeRefs: false, resolveAsset: () => null })
  return performance.now() - started
}

const CASES: { name: string; run: () => number }[] = [
  { name: 'drawPlanView @screen', run: () => drawPlan(SCREEN) },
  { name: 'drawPlanView @paper', run: () => drawPlan(PAPER) },
  { name: 'drawItemDetail (cabinet) @screen', run: () => drawCabinet(SCREEN) },
  { name: 'drawItemDetail (cabinet) @paper', run: () => drawCabinet(PAPER) },
]

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
const means = CASES.map((each) => ({ name: each.name, mean: meanOf(each.run) }))
const worst = means.reduce((highest, each) => Math.max(highest, each.mean), 0)
console.info(
  `#60 drawing budget: target ${String(TARGET_MEAN_MS)} ms mean, fail above ${String(FAIL_ABOVE_MS)} ms\n` +
  means.map((each) => `  ${each.name}: ${each.mean.toFixed(2)} ms mean`).join('\n'),
)

describe('the display list on the reference project', () => {
  for (const each of CASES) {
    bench(each.name, () => {
      each.run()
    }, { iterations: ITERATIONS, time: 0, warmupIterations: 2, warmupTime: 0 })
  }

  if (worst > FAIL_ABOVE_MS) {
    const over = means.find((each) => each.mean > FAIL_ABOVE_MS)
    throw new Error(`${over?.name ?? 'a case'}: ${worst.toFixed(2)} ms mean, above the ${String(FAIL_ABOVE_MS)} ms limit`)
  }
  if (worst > TARGET_MEAN_MS) console.warn(`over the ${String(TARGET_MEAN_MS)} ms target: ${worst.toFixed(2)} ms mean`)
})

/**
 * The #64 §8 performance budget: what a Floor carrying 150 Walls and 120 Junctions costs to
 * derive, and what dragging one of those Walls costs to apply and validate.
 *
 * Both numbers are felt, not theoretical. The derivation runs whenever the plan has to work out
 * what it shows — faces, tidied corners, lengths — so 50 ms is roughly how long a person will
 * accept watching the plan redraw itself. A drag is only smooth while each move of the Wall stays
 * under 30 ms; past that the Wall visibly lags the cursor.
 *
 * The Project is `fixtures/domain/v1/reference-project.json` — the largest Project the fixtures
 * carry — with 30 chained draws of 5 segments applied to its first Floor. Thirty chains of five
 * segments is 150 Walls and 120 Junctions exactly, the shape the budget names: every internal
 * corner of a chain is a Junction and the two ends of each chain stay free. The file refuses to
 * measure anything else, so a change that quietly alters what is built throws instead of
 * producing a flattering number.
 *
 * `applyIntent` validates the whole Project on the way out (#42 §5), so one call is the apply
 * and validate the budget names. That pair already costs about 50 ms on this fixture for ANY
 * Intent — #26's whole-Project validation, which #47 measured and re-baselined at a 50 ms target
 * and a 100 ms limit for the same reason — so the cost belongs to the Project rather than to the
 * edit. The same call on the same fixture with no Walls at all, renaming it, is the control that
 * says how much. The Wall budget is therefore enforced on the difference — what the Walls and the
 * Junctions make the edit cost — and the absolute figure is reported either way, because a person
 * reading this bench has to be able to tell a Wall problem from a Project problem.
 *
 * The published rows come from `bench`; the budget is enforced on a median of repeated timed
 * runs, since a single sample is as likely to report a garbage collection as the work.
 */
import { bench, describe } from 'vitest'
import { deriveWalls } from '../derive'
import { migrateProject } from '../domain'
import type { Project, WallRefLine } from '../domain'
import { pt } from '../geometry'
import { applyIntent } from './apply'
import type { Intent, WallDraft, WallEndTarget } from './intents'
import { chainJunctionCount } from './intents'
import { INTENT_LABELS } from './labels'

const DERIVE_BUDGET_MS = 50
const DRAG_BUDGET_MS = 30

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
let issued = 0
const nextIds = (count: number, prefix: string): string[] =>
  Array.from({ length: count }, () => `${prefix}-${String(++issued)}`)
// The fixture is a v1 document and the budget is about the domain as it is now, so the Project
// goes through the same migration opening a Project does.
const migrated = migrateProject(envelope.project, envelope.domainSchemaVersion, (count = 1) =>
  nextIds(count, 'bench-view'))
if (!migrated.ok) throw new Error(`reference-project.json: ${migrated.error.message}`)
const bare = migrated.project
const floorId = bare.floors[0]!.id

const CHAINS = 30
const SEGMENTS = 5
/** A chain's own lane: 4 m of run, 2 m of rise, lanes 3 m apart so nothing touches by accident. */
const RUN_MM = 4000
const RISE_MM = 2000
const LANE_MM = 3000
const THICKNESS_MM = 100
const HEIGHT_MM = 2600
const NOW = '2026-11-18T00:00:00.000Z'

const free: WallEndTarget = { kind: 'free' }
const link = (index: number, end: 'start' | 'end'): WallEndTarget => ({ kind: 'segment', index, end })

const line = (start: { x: number; y: number }, end: { x: number; y: number }): WallRefLine => ({
  kind: 'line',
  start,
  end,
})

/** One zig-zag lane: five segments, four internal corners, two free ends. */
function chainAt(index: number): { walls: WallDraft[]; starts: WallEndTarget[]; ends: WallEndTarget[] } {
  const y = index * LANE_MM
  const nodes = [
    pt(0, y),
    pt(0, y + RISE_MM),
    pt(RUN_MM, y + RISE_MM),
    pt(RUN_MM, y),
    pt(2 * RUN_MM, y),
    pt(2 * RUN_MM, y + RISE_MM),
  ]
  const walls = nodes.slice(0, -1).map((start, at): WallDraft => ({
    line: line(start, nodes[at + 1]!),
    thickness: THICKNESS_MM,
    justification: 'centre',
    baseElevation: 0,
    height: HEIGHT_MM,
  }))
  return {
    walls,
    starts: walls.map((_, at) => (at === 0 ? free : link(at - 1, 'end'))),
    ends: walls.map((_, at) => (at === walls.length - 1 ? free : link(at + 1, 'start'))),
  }
}

/** The budget's Floor: 150 Walls and 120 Junctions, drawn the way the Wall tool draws them. */
function buildWalledFloor(): { project: Project; wallId: string } {
  let current = bare
  let firstWallId = ''
  for (let index = 0; index < CHAINS; index += 1) {
    const chain = chainAt(index)
    const payload = { floorId, walls: chain.walls, starts: chain.starts, ends: chain.ends }
    const ids = nextIds(chain.walls.length + chainJunctionCount(payload), 'bench-wall')
    const applied = applyIntent(current, {
      type: 'wall.createChain',
      payload,
      label: INTENT_LABELS['wall.createChain'],
      ids,
      now: NOW,
    })
    if (!applied.ok) throw new Error(`the bench chain was refused: ${applied.code}`)
    current = applied.project
    if (index === 0) firstWallId = ids[0]!
  }
  const walls = current.existingModel.walls.filter((wall) => wall.floorId === floorId)
  const junctions = current.existingModel.wallJunctions.filter((junction) => junction.floorId === floorId)
  if (walls.length !== CHAINS * SEGMENTS) throw new Error(`${String(walls.length)} Walls, not ${String(CHAINS * SEGMENTS)}`)
  if (junctions.length !== CHAINS * (SEGMENTS - 1)) {
    throw new Error(`${String(junctions.length)} Junctions, not ${String(CHAINS * (SEGMENTS - 1))}`)
  }
  return { project: current, wallId: firstWallId }
}

const walled = buildWalledFloor()

/** A Wall drag: the Wall moves, its two Junctions move with it, its neighbours stretch. */
const dragIntent: Intent = {
  type: 'wall.dragBody',
  payload: { wallId: walled.wallId, delta: pt(0, 12) },
  label: INTENT_LABELS['wall.dragBody'],
  ids: [],
  now: NOW,
}

/** The control: an edit that touches nothing but a name, on the same Project with no Walls. */
const renameIntent: Intent = {
  type: 'project.rename',
  payload: { name: 'Reference Project benched' },
  label: INTENT_LABELS['project.rename'],
  ids: [],
  now: NOW,
}

function dragOnce(): void {
  const applied = applyIntent(walled.project, dragIntent)
  if (!applied.ok) throw new Error(`the bench drag was refused: ${applied.code}`)
}

function renameOnce(): void {
  const applied = applyIntent(bare, renameIntent)
  if (!applied.ok) throw new Error(`the bench control was refused: ${applied.code}`)
}

/** The median of `iterations` timed runs, in milliseconds. */
function medianMs(run: () => void, iterations: number): number {
  const samples: number[] = []
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now()
    run()
    samples.push(performance.now() - started)
  }
  samples.sort((a, b) => a - b)
  return samples[Math.floor(samples.length / 2)]!
}

const derive = medianMs(() => {
  deriveWalls(walled.project, floorId)
}, 25)
const drag = medianMs(dragOnce, 25)
const control = medianMs(renameOnce, 25)
/** What the Walls and Junctions are what the edit costs beyond any other edit on this Project. */
const wallCost = drag - control

console.info(
  `#64 Wall budget: derive ≤ ${String(DERIVE_BUDGET_MS)} ms, apply + validate ≤ ${String(DRAG_BUDGET_MS)} ms\n` +
    `  ${String(CHAINS * SEGMENTS)} Walls and ${String(CHAINS * (SEGMENTS - 1))} Junctions on one Floor: ` +
    `derive ${derive.toFixed(2)} ms\n` +
    `  a Wall drag: ${drag.toFixed(2)} ms, of which ${control.toFixed(2)} ms is the reference Project ` +
    `itself (the same call renaming it with no Walls) — the Walls cost ${wallCost.toFixed(2)} ms`,
)

describe('the Wall budgets of 150 Walls and 120 Junctions', () => {
  bench('derive Walls, faces and corners', () => {
    deriveWalls(walled.project, floorId)
  }, { iterations: 20, time: 0, warmupIterations: 5, warmupTime: 0 })

  bench('apply and validate one Wall drag', () => {
    dragOnce()
  }, { iterations: 20, time: 0, warmupIterations: 5, warmupTime: 0 })

  if (derive > DERIVE_BUDGET_MS) {
    throw new Error(
      `derive of ${String(CHAINS * SEGMENTS)} Walls took ${derive.toFixed(2)} ms, over the ${String(DERIVE_BUDGET_MS)} ms budget`,
    )
  }
  if (wallCost > DRAG_BUDGET_MS) {
    throw new Error(`a Wall drag costs ${wallCost.toFixed(2)} ms more than any other edit, over the ${String(DRAG_BUDGET_MS)} ms budget`)
  }
  if (drag > DRAG_BUDGET_MS) {
    console.warn(
      `a Wall drag on the reference Project costs ${drag.toFixed(2)} ms in total, over the ` +
        `${String(DRAG_BUDGET_MS)} ms budget: ${control.toFixed(2)} ms of it is applying and validating ` +
        `any Intent at all on this fixture — #26's whole-Project validation, #42's apply path, not Wall work`,
    )
  }
})

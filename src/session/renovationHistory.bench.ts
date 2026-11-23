/**
 * What 200 renovation steps cost the undo history (#69 Scope 16).
 *
 * The history keeps the last 100 transactions' patches and inverse patches, so a renovation step is
 * dearer than the ordinary ones this budget was set for: a `replaceInOption` writes a successor
 * Wall, carries its Openings and Junctions into the Option and rewrites the Room that claims the
 * Wall's face; a `correctExistingModel` writes the baseline edit plus one successor per Option that
 * had one. This measures the retained bytes of 200 mixed renovation transactions on
 * `fixtures/bench/renovation-reference.json` against the 25 MB budget.
 *
 * `npm run bench` prints the retained bytes; the run fails above 50 MB, and the mean per step is
 * printed beside it because that is the number that tells you which of the two is growing.
 */
import { bench, describe } from 'vitest'
import { applyIntent, intentLabel } from '../edit'
import type { Intent, IntentType, PayloadOf } from '../edit'
import { designOptionsOf, validateProject } from '../domain'
import type { Project } from '../domain'
import { createHistory } from './history'
import type { HistoryEntry } from './types'

const TARGET_RETAINED_BYTES = 25 * 1024 * 1024
const FAIL_ABOVE_BYTES = 50 * 1024 * 1024
const STEPS = 200
const ITERATIONS = 20
const WARMUP = 5


const SOURCES = import.meta.glob<string>('/fixtures/bench/renovation-reference.json', {
  eager: true,
  query: '?raw',
  import: 'default',
})
const raw = Object.values(SOURCES)[0]
if (raw === undefined) throw new Error('fixtures/bench/renovation-reference.json is missing')
const envelope = JSON.parse(raw) as { domainSchemaVersion: number; project: Project }
const project = envelope.project
if (!validateProject(project).ok) throw new Error('the renovation reference Project does not validate')

const NOW = '2026-11-18T00:00:00.000Z'
const floorId = project.floors[0]!.id
const options = designOptionsOf(project)
const [optionA, optionB, optionC] = options as [typeof options[0], typeof options[0], typeof options[0]]
const rails = project.existingModel.walls.filter((wall) => wall.floorId === floorId && wall.line.start.y === wall.line.end.y)
const rungs = project.existingModel.walls.filter((wall) => wall.floorId === floorId && wall.line.start.x === wall.line.end.x)
// The Options take the first forty rungs down; the steps below work on the rest, which every
// Option still stands on.
const replaceable = rungs.slice(40)
const hostable = replaceable
if (rails.length < 75 || replaceable.length < 20) throw new Error('the renovation reference Project is not the shape this bench measures')

let issued = 0
const ids = (count: number): string[] => Array.from({ length: count }, () => `bench-history-${String(++issued)}`)

const intent = <T extends IntentType>(type: T, payload: PayloadOf<T>, taken: string[]): Intent =>
  ({ type, payload, label: intentLabel(type), ids: taken, now: NOW }) as Intent

/**
 * Six shapes, cycled: replace a rung inside an Option, demolish a window, propose a door through a
 * rung, rename an Option, correct the thickness of a rail, rename another Option. Every step has its
 * own subject or its own name, so none of them is refused.
 */
function stepAt(index: number): Intent {
  const round = Math.floor(index / 6)
  switch (index % 6) {
    case 0: {
      const rung = replaceable[round]!
      return intent('renovation.replace', { entityId: rung.id, edit: {}, target: { designOptionId: optionA.id } }, ids(24))
    }
    case 1: {
      // A window taken out of a standing Wall: a demolition with nothing standing on it.
      const window = project.existingModel.openings[round % 59]!
      return intent('renovation.demolish', { entityId: window.id, target: { designOptionId: optionB.id } }, [])
    }
    case 2: {
      const host = hostable[round % hostable.length]!
      return intent(
        'renovation.placeOpening',
        {
          floorId,
          hostWallId: host.id,
          kind: 'door',
          label: `Door ${String(index + 1)}`,
          start: 200 + (round % 10) * 50,
          width: 900,
          sill: 0,
          head: 2_100,
          swing: 'left',
          hingeSide: 'start',
          target: { designOptionId: optionC.id },
        },
        ids(1),
      )
    }
    case 3:
      return intent('designOption.rename', { optionId: options[index % options.length]!.id, name: `Alternative ${String(index + 1)}` }, [])
    case 4:
      return intent(
        'renovation.correctExistingModel',
        {
          inner: intent('wall.setThickness', { wallId: rails[60 + (round % 10)]!.id, thickness: 150 + (round % 40) }, []),
        },
        [],
      )
    default:
      return intent('designOption.rename', { optionId: options[(index + 1) % options.length]!.id, name: `Variant ${String(index + 1)}` }, [])
  }
}

const STEPS_PLAN: Intent[] = Array.from({ length: STEPS }, (_, index) => stepAt(index))

interface GcGlobal {
  gc?: () => void
}

function collect(): void {
  const g = globalThis as GcGlobal
  if (g.gc !== undefined) {
    g.gc()
    g.gc()
  }
}

const megabytes = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`

/** 200 renovation transactions through the history, returning the history and its retained bytes. */
function runOnce(): { retained: number; applied: number } {
  collect()
  const emptyHeap = process.memoryUsage().heapUsed
  const history = createHistory()
  collect()
  let current = project
  let applied = 0
  for (const each of STEPS_PLAN) {
    const result = applyIntent(current, each)
    if (!result.ok) throw new Error(`${each.type}: refused with ${result.code}`)
    current = result.project
    applied += 1
    history.push({ label: each.label, patches: result.patches, inversePatches: result.inversePatches, locator: result.affected } satisfies HistoryEntry)
  }
  collect()
  return { retained: Math.max(0, process.memoryUsage().heapUsed - emptyHeap), applied }
}

/**
 * The retained bytes are measured once, here, and printed: 200 transactions take half a minute,
 * which is a budget check and not something the bench harness should time repeatedly. The timed row
 * below is one transaction of the same mix, which is the rate that row is good for.
 */
const first = runOnce()
console.info(
  `#69 budget: ${String(STEPS)} renovation steps retain at most ${megabytes(TARGET_RETAINED_BYTES)}\n` +
    `  ${String(first.applied)} steps: ${megabytes(first.retained)} retained ` +
    `(${(first.retained / STEPS / 1024).toFixed(1)} KiB per step)` +
    `${(globalThis as GcGlobal).gc === undefined ? ' (upper bound: no --expose-gc, budget not enforced)' : ''}`,
)

if ((globalThis as GcGlobal).gc !== undefined && first.retained > FAIL_ABOVE_BYTES) {
  throw new Error(`${String(STEPS)} renovation steps retain ${megabytes(first.retained)}, above the ${megabytes(FAIL_ABOVE_BYTES)} limit`)
}
if ((globalThis as GcGlobal).gc !== undefined && first.retained > TARGET_RETAINED_BYTES) {
  console.warn(`${String(STEPS)} renovation steps retain ${megabytes(first.retained)}, above the ${megabytes(TARGET_RETAINED_BYTES)} budget`)
}

describe('200 renovation steps of history on the reference project', () => {
  bench(
    'one renovation transaction',
    () => {
      const result = applyIntent(project, STEPS_PLAN[0]!)
      if (!result.ok) throw new Error(`renovation.replace: refused with ${result.code}`)
    },
    { iterations: ITERATIONS, time: 0, warmupIterations: WARMUP, warmupTime: 0 },
  )
})

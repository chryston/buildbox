/**
 * Renovation work over three Design Options stays whole, whatever order it arrives in
 * (#69 acceptance 8–§12).
 *
 * Each run drives a random sequence of option-scoped commands and Existing Model corrections
 * against the committed scene, now holding three Options. Four things have to hold at every step
 * the handlers accept: the Project is still valid and every Option still reads as a model; one undo
 * of that step returns the bytes it started from; a command aimed at one Option leaves the Existing
 * Model and the other Options byte-for-byte alone; and what a correction said it would do to each
 * Option is exactly what it did.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { currentSchemaOf } from '../../domain/testing'
import type { Patch } from 'immer'
import type { EntityId, Project } from '../../domain'
import { designOptionsOf, validateProject } from '../../domain'
import { effectiveModel } from '../../derive'
import { canonicalJson } from '../../lib'
import { applyIntent, applyPatches, previewIntent, type CorrectionReview, type Intent } from '../index'
import { intent } from '../testing'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures')
const seed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'renovation-36.json'), 'utf8'),
) as { projects: { data: Project }[] }

const FLOOR = 'seed-001'

const COLLECTIONS = ['walls', 'wallJunctions', 'openings', 'rooms', 'placedItems'] as const
type Collection = (typeof COLLECTIONS)[number]

/** Whatever a collection holds, seen only as far as these properties need. */
interface Record_ {
  readonly id: EntityId
  readonly predecessorIds?: EntityId[]
  readonly [key: string]: unknown
}

const recordsIn = (model: object, key: Collection): readonly Record_[] =>
  (model as Record<Collection, readonly Record_[]>)[key]

const bytes = (value: unknown): string => canonicalJson(value)

const quantise = (value: unknown): unknown =>
  typeof value === 'number'
    ? Math.round(value * 100) / 100
    : Array.isArray(value)
      ? value.map(quantise)
      : value !== null && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, quantise(entry)]))
        : value

/** The same measure the correction uses: geometry, with nothing that identifies the record. */
const geometryKey = (entity: Record_): string => {
  const rest: Record<string, unknown> = { ...entity }
  for (const key of ['id', 'ref', 'label', 'name', 'predecessorIds']) delete rest[key]
  return bytes(quantise(rest))
}

/** Every ID a counter has handed out this run; the UI's ID source, one per Project. */
let issued = 0
const ids = (count: number): string[] => Array.from({ length: count }, () => `prop-${String(++issued)}`)

// --- The random work ---------------------------------------------------------

type Inner =
  | { kind: 'thickness'; pick: number; thickness: number }
  | { kind: 'drag'; pick: number; dx: number; dy: number }
  | { kind: 'length'; pick: number; length: number }
  | { kind: 'rename'; pick: number }
  | { kind: 'width'; pick: number; width: number }

type Step =
  | { kind: 'demolish'; pick: number; option: number }
  | { kind: 'replace'; pick: number; thick: boolean; option: number }
  | { kind: 'restore'; pick: number; option: number }
  | { kind: 'opening'; host: number; start: number; option: number }
  | { kind: 'move'; picks: number[]; option: number }
  | { kind: 'correct'; inner: Inner }

// W-6 is the scene's one Wall that stands free of every join, so a correction of it gets through
// often enough for these properties to have something to say about succession.
const wallPick = fc.oneof(fc.nat(), fc.constant(5))

const innerArb = fc.oneof(
  fc.record({ kind: fc.constant('thickness' as const), pick: wallPick, thickness: fc.constantFrom(120, 150, 200) }),
  fc.record({
    kind: fc.constant('drag' as const),
    pick: wallPick,
    dx: fc.constantFrom(-400, -20, 0, 20, 400),
    dy: fc.constantFrom(-400, -20, 0, 20, 400),
  }),
  fc.record({ kind: fc.constant('length' as const), pick: wallPick, length: fc.constantFrom(900, 2000, 3000, 6000) }),
  fc.record({ kind: fc.constant('rename' as const), pick: fc.nat() }),
  fc.record({ kind: fc.constant('width' as const), pick: fc.nat(), width: fc.constantFrom(700, 900, 1200) }),
)

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ kind: fc.constant('demolish' as const), pick: fc.nat(), option: fc.nat() }),
  fc.record({ kind: fc.constant('replace' as const), pick: fc.nat(), thick: fc.boolean(), option: fc.nat() }),
  fc.record({ kind: fc.constant('restore' as const), pick: fc.nat(), option: fc.nat() }),
  fc.record({ kind: fc.constant('opening' as const), host: fc.nat(), start: fc.nat(), option: fc.nat() }),
  fc.record({ kind: fc.constant('move' as const), picks: fc.array(fc.nat(), { minLength: 1, maxLength: 3 }), option: fc.nat() }),
  fc.record({ kind: fc.constant('correct' as const), inner: innerArb }),
)

/** One step that was understood, whether or not the Project let it through. */
interface Turn {
  readonly step: Step
  readonly before: Project
  readonly after: Project
  readonly accepted: boolean
  /** What one undo of this step writes back, when it was accepted. */
  readonly undo: readonly Patch[]
  /** The per-Option lines a correction promised, when this step was one. */
  readonly promised: CorrectionReview | null
}

const poolOf = (source: Project): EntityId[] => [
  ...source.existingModel.walls.map((entry) => entry.id),
  ...source.existingModel.openings.map((entry) => entry.id),
  ...source.existingModel.rooms.map((entry) => entry.id),
  ...source.existingModel.placedItems.map((entry) => entry.id),
]

const pickFrom = <T>(pool: readonly T[], index: number): T | null => (pool.length === 0 ? null : pool[index % pool.length]!)

/** The Intent this step asks for, or null when the scene holds nothing it could point at. */
function build(current: Project, step: Step, optionIds: readonly string[]): Intent | null {
  const optionId = optionIds[step.kind === 'correct' ? 0 : step.option % optionIds.length]!
  if (step.kind === 'correct') {
    const inner = step.inner
    const walls = current.existingModel.walls
    const openings = current.existingModel.openings
    const rooms = current.existingModel.rooms
    if (inner.kind === 'rename') {
      const room = pickFrom(rooms, inner.pick)
      return room === null ? null : intent('room.rename', { roomId: room.id, name: `Room ${String(inner.pick % 97)}` })
    }
    if (inner.kind === 'width') {
      const opening = pickFrom(openings, inner.pick)
      return opening === null ? null : intent('opening.setWidth', { openingId: opening.id, width: inner.width })
    }
    const wall = pickFrom(walls, inner.pick)
    if (wall === null) return null
    if (inner.kind === 'thickness') return intent('wall.setThickness', { wallId: wall.id, thickness: inner.thickness })
    if (inner.kind === 'length') return intent('wall.setLength', { wallId: wall.id, length: inner.length, keepFixed: 'start' })
    return intent('wall.dragBody', { wallId: wall.id, delta: { x: inner.dx, y: inner.dy } })
  }
  const pool = poolOf(current)
  if (step.kind === 'demolish') {
    const entity = pickFrom(pool, step.pick)
    return entity === null ? null : intent('renovation.demolish', { entityId: entity, target: { designOptionId: optionId } })
  }
  if (step.kind === 'replace') {
    const entity = pickFrom(pool, step.pick)
    if (entity === null) return null
    const isWall = current.existingModel.walls.some((entry) => entry.id === entity)
    return intent(
      'renovation.replace',
      { entityId: entity, edit: step.thick && isWall ? { thickness: 150 } : {}, target: { designOptionId: optionId } },
      ids(24),
    )
  }
  if (step.kind === 'restore') {
    const entity = pickFrom(pool, step.pick)
    return entity === null ? null : intent('renovation.restore', { entityId: entity, target: { designOptionId: optionId } })
  }
  if (step.kind === 'opening') {
    const walls = current.existingModel.walls
    const host = pickFrom(walls, step.host)
    if (host === null) return null
    return intent(
      'renovation.placeOpening',
      {
        floorId: FLOOR,
        hostWallId: host.id,
        kind: 'door',
        label: 'Prop door',
        start: step.start % 1200,
        width: 900,
        sill: 0,
        head: 2100,
        swing: 'left',
        hingeSide: 'start',
        target: { designOptionId: optionId },
      },
      ids(1),
    )
  }
  const chosen = step.picks
    .map((index) => pickFrom(poolOf(current), index))
    .filter((id): id is EntityId => id !== null)
  return chosen.length === 0 ? null : intent('renovation.moveToDesignOption', { entityIds: chosen, targetOptionId: optionId })
}

/** A Project with three Options: the reference Project of the issue's budgets. */
function threeOptions(): Project {
  const start = currentSchemaOf(seed.projects[0]!.data, 8)
  const created = applyIntent(start, intent('designOption.create', { name: 'Option C' }, ids(1)))
  if (!created.ok) throw new Error(JSON.stringify(created.problems))
  return created.project
}

function runSequence(steps: readonly Step[]): { start: Project; turns: Turn[] } {
  const start = threeOptions()
  const optionIds = designOptionsOf(start).map((entry) => entry.id)
  const turns: Turn[] = []
  let current = start
  for (const step of steps) {
    const asked = build(current, step, optionIds)
    if (asked === null) continue
    const promised = step.kind === 'correct' ? (previewIntent(current, asked).review as CorrectionReview | null) : null
    const result = applyIntent(current, asked)
    if (!result.ok) {
      turns.push({ step, before: current, after: current, accepted: false, undo: [], promised })
      continue
    }
    turns.push({ step, before: current, after: result.project, accepted: true, undo: result.inversePatches, promised })
    current = result.project
  }
  return { start, turns }
}

const optionBytes = (source: Project, id: string): string => bytes(designOptionsOf(source).find((entry) => entry.id === id))

// --- The four properties -----------------------------------------------------

describe('renovation work across three Design Options (#69)', () => {
  it(
    'keeps the Project valid and every Option readable, however the commands arrive',
    () => {
      fc.assert(
        fc.property(fc.array(stepArb, { minLength: 1, maxLength: 8 }), (steps) => {
          const { turns } = runSequence(steps)
          for (const turn of turns) {
            if (!turn.accepted) {
              // A refusal never leaves a half-written Project behind.
              expect(bytes(turn.after)).toBe(bytes(turn.before))
              continue
            }
            const checked = validateProject(turn.after)
            if (!checked.ok) throw new Error(`${turn.step.kind}: ${JSON.stringify(checked.problems)}`)
            for (const option of designOptionsOf(turn.after)) effectiveModel(turn.after, FLOOR, option.id)
          }
        }),
        { numRuns: 30 },
      )
    },
    120_000,
  )

  it(
    'undoes every accepted step back to the exact bytes it started from',
    () => {
      fc.assert(
        fc.property(fc.array(stepArb, { minLength: 1, maxLength: 8 }), (steps) => {
          const { turns } = runSequence(steps)
          for (const turn of turns) {
            if (!turn.accepted) continue
            const undone = applyPatches(turn.after, turn.undo)
            expect(bytes(undone), turn.step.kind).toBe(bytes(turn.before))
          }
        }),
        { numRuns: 30 },
      )
    },
    120_000,
  )

  it(
    'leaves the Existing Model and the other Options alone for work aimed at one Option',
    () => {
      fc.assert(
        fc.property(fc.array(stepArb, { minLength: 1, maxLength: 8 }), (steps) => {
          const { start, turns } = runSequence(steps)
          const optionIds = designOptionsOf(start).map((entry) => entry.id)
          for (const turn of turns) {
            const { step } = turn
            if (!turn.accepted) continue
            // A correction moves the baseline on purpose; `Move to a Design Option…` re-owns it on
            // purpose. Everything else is a delta inside exactly one Option.
            if (step.kind === 'correct' || step.kind === 'move') continue
            const aimed = optionIds[step.option % optionIds.length]!
            expect(bytes(turn.after.existingModel), step.kind).toBe(bytes(turn.before.existingModel))
            for (const optionId of optionIds) {
              if (optionId === aimed) continue
              expect(optionBytes(turn.after, optionId), `${step.kind} into ${optionId}`).toBe(optionBytes(turn.before, optionId))
            }
          }
        }),
        { numRuns: 30 },
      )
    },
    120_000,
  )

  it(
    'commits a correction exactly as it previewed it, option by option',
    () => {
      fc.assert(
        fc.property(fc.array(stepArb, { minLength: 1, maxLength: 8 }), (steps) => {
          const { turns } = runSequence(steps)
          for (const turn of turns) {
            const { promised } = turn
            if (promised === null) continue
            const blocked = promised.options.some((entry) => entry.blockers.length > 0)
            // A blocker is a refusal, never a partial commit — and nothing else refuses silently.
            expect(turn.accepted, `blocked=${String(blocked)}: ${JSON.stringify(promised.options.map((entry) => entry.blockers))}`).toBe(!blocked)
            if (!turn.accepted) continue

            const subjects = subjectsOf(turn.before, turn.after)
            for (const line of promised.options) {
              const after = designOptionsOf(turn.after).find((entry) => entry.id === line.optionId)!
              const before = designOptionsOf(turn.before).find((entry) => entry.id === line.optionId)!
              // This Option's subject/successor pairs, measured before anything moved.
              const pairs = subjects.flatMap((entry) =>
                recordsIn(before.proposed, entry.collection)
                  .filter((record) => record.predecessorIds?.includes(entry.id) ?? false)
                  .map((record) => ({
                    entry,
                    record,
                    aligned: geometryKey(record) === entry.before,
                    now: recordsIn(after.proposed, entry.collection).find((candidate) => candidate.id === record.id),
                  })),
              )
              const demolished = subjects.filter((entry) => after.demolishedIds.includes(entry.id))
              const still = optionBytes(turn.after, line.optionId) === optionBytes(turn.before, line.optionId)

              switch (line.effect) {
                case 'retains':
                  // This Option held the subject outright and had no work standing in its place.
                  expect(demolished, line.optionId).toEqual([])
                  expect(pairs, line.optionId).toEqual([])
                  expect(still, line.optionId).toBe(true)
                  break
                case 'demolishes':
                  expect(demolished.length > 0, line.optionId).toBe(true)
                  expect(pairs, line.optionId).toEqual([])
                  // Nothing of this Option's own work had to move.
                  expect(still, line.optionId).toBe(true)
                  break
                case 'demolishes; successor stays aligned': {
                  const followed = pairs.filter((pair) => pair.aligned)
                  expect(followed.length > 0, line.optionId).toBe(true)
                  // Each one now stands in the same relation to the corrected baseline as it did to
                  // the old one — and a subject taken down takes its aligned successor with it.
                  for (const pair of followed)
                    expect(pair.now === undefined ? null : geometryKey(pair.now), line.optionId).toBe(pair.entry.after)
                  break
                }
                default: {
                  const kept = pairs.filter((pair) => !pair.aligned)
                  expect(kept.length > 0, line.optionId).toBe(true)
                  // Work the user shaped is left exactly where it was, byte for byte.
                  for (const pair of kept) expect(bytes(pair.now), line.optionId).toBe(bytes(pair.record))
                  break
                }
              }
            }
          }
        }),
        { numRuns: 30 },
      )
    },
    120_000,
  )
})

// --- Reading a committed correction ------------------------------------------

/** One Existing record a correction spent, with its geometry on either side of the commit. */
interface Subject {
  readonly id: EntityId
  readonly collection: Collection
  readonly before: string
  readonly after: string | null
}

/** What the baseline edit touched: every record that moved, appeared, or went away. */
function subjectsOf(before: Project, after: Project): Subject[] {
  const found: Subject[] = []
  for (const collection of COLLECTIONS) {
    const was = new Map(recordsIn(before.existingModel, collection).map((entry) => [entry.id, entry]))
    const now = new Map(recordsIn(after.existingModel, collection).map((entry) => [entry.id, entry]))
    for (const entry of was.values()) {
      const moved = now.get(entry.id)
      if (moved === undefined) found.push({ id: entry.id, collection, before: geometryKey(entry), after: null })
      else if (bytes(moved) !== bytes(entry)) found.push({ id: entry.id, collection, before: geometryKey(entry), after: geometryKey(moved) })
    }
    for (const entry of now.values()) {
      if (!was.has(entry.id)) found.push({ id: entry.id, collection, before: geometryKey(entry), after: geometryKey(entry) })
    }
  }
  return found
}

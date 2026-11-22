/**
 * The explicit Existing Model correction and the guard around it (#69 acceptance 6 and 7).
 *
 * The scene is the committed one — `fixtures/e2e/preview-seed/renovation-36.json` — and the rows are
 * the issue's: W-2 replaced in Option A and demolished in Option B, then W-2 moved 20 mm in the
 * survey. What each Option is told it will see, and what it actually gets when the correction
 * commits, are read from the same bytes, because a preview that disagrees with the write is the
 * failure this whole command exists to avoid.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { DesignOption, Project } from '../../domain'
import { designOptionsOf } from '../../domain'
import { canonicalJson } from '../../lib'
import {
  applyIntent,
  applyPatches,
  previewIntent,
  type CorrectionReview,
  type Intent,
  type MoveToOptionReview,
  type ReplaceEdit,
} from '../index'
import { intent } from '../testing'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures')
const seed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'renovation-36.json'), 'utf8'),
) as { projects: { data: Project }[] }

const FLOOR = 'seed-001'
const W2 = 'seed-wall-003'
const W5 = 'seed-wall-010'
const W6 = 'seed-wall-013'
const WINDOW_3 = 'seed-opening-016'
const BASE_UNIT = 'seed-002'
const A = 'option-a'
const B = 'option-b'

const project = (): Project => structuredClone(seed.projects[0]!.data)

function optionOf(source: Project, id: string): DesignOption {
  const found = designOptionsOf(source).find((entry) => entry.id === id)
  if (found === undefined) throw new Error(`the fixture holds no Design Option ${id}`)
  return found
}

const wall = (source: Project, id: string) => source.existingModel.walls.find((entry) => entry.id === id)
const successor = (source: Project, optionId: string, predecessorId: string) =>
  optionOf(source, optionId).proposed.walls.find((entry) => entry.predecessorIds?.includes(predecessorId) ?? false)!

/** The IDs a `Replace…` spends: one successor plus the records it carries along. */
const ids = (count: number): string[] => Array.from({ length: count }, (_entry, index) => `correct-id-${index}`)

const replaceInOption = (optionId: string, entityId: string, edit: ReplaceEdit, taken = ids(24)) =>
  intent('renovation.replace', { entityId, edit, target: { designOptionId: optionId } }, taken)

const demolishIn = (optionId: string, entityId: string, dependants?: string[]) =>
  intent('renovation.demolish', { entityId, target: { designOptionId: optionId }, ...(dependants === undefined ? {} : { dependants }) })

const doorIn = (optionId: string, hostWallId: string, start: number, label: string, taken: string) =>
  intent(
    'renovation.placeOpening',
    {
      floorId: FLOOR,
      hostWallId,
      kind: 'door',
      label,
      start,
      width: 900,
      sill: 0,
      head: 2100,
      swing: 'left',
      hingeSide: 'start',
      target: { designOptionId: optionId },
    },
    [taken],
  )

/** The correction the issue's rows are stated as: one Existing edit, wrapped. */
const correct = (inner: Intent, taken: string[] = []) => intent('renovation.correctExistingModel', { inner }, taken)

/** W-2 slid 20 mm east, the joins at both its ends following it. */
const moveW2 = () => intent('wall.dragBody', { wallId: W2, delta: { x: 20, y: 0 } })

/** W-6 slid 40 mm south, the one Wall of this scene that stands free of every join. */
const moveW6 = () => intent('wall.dragBody', { wallId: W6, delta: { x: 0, y: 40 } })

const unwrap = <R extends { ok: boolean; problems?: readonly unknown[] }>(result: R): Extract<R, { ok: true }> => {
  if (!result.ok) throw new Error(JSON.stringify(result.problems))
  return result as Extract<R, { ok: true }>
}

/** A Project with W-2 replaced in Option A (identity) and demolished in Option B. */
function splitScene(): Project {
  const before = project()
  const replaced = unwrap(applyIntent(before, replaceInOption(A, W2, {})))
  return unwrap(applyIntent(replaced.project, demolishIn(B, W2))).project
}

describe('the explicit Existing Model correction', () => {
  it('previews one line per Option, in option order, and commits exactly that in one undo', () => {
    const before = splitScene()
    const wrap = correct(moveW2())

    const review = previewIntent(before, wrap).review as CorrectionReview | null
    expect(review).not.toBeNull()
    expect(review!.message).toBe('Correct Existing Model: W-2')
    expect(review!.options.map((entry) => [entry.optionId, entry.optionName, entry.effect])).toEqual([
      [A, 'Option A', 'demolishes; successor stays aligned'],
      [B, 'Option B', 'demolishes'],
    ])

    const applied = unwrap(applyIntent(before, wrap))
    // The survey moved…
    expect(wall(applied.project, W2)!.line.start).toEqual({ x: 9620, y: 600 })
    // …the successor that had W-2's geometry moved with it…
    expect(successor(applied.project, A, W2).line.start).toEqual({ x: 9620, y: 600 })
    // …and the Option that had only demolished W-2 holds the same bytes it held before.
    expect(canonicalJson(optionOf(applied.project, B))).toBe(canonicalJson(optionOf(before, B)))
    // One Edit Transaction: one undo puts every record back, in both containers.
    expect(canonicalJson(applyPatches(applied.project, applied.inversePatches))).toBe(canonicalJson(before))
  })

  it('moves an aligned successor under the work hung on it, and leaves that work where it was', () => {
    const before = project()
    const replaced = unwrap(applyIntent(before, replaceInOption(A, W6, {})))
    const withDoor = unwrap(applyIntent(replaced.project, doorIn(A, successor(replaced.project, A, W6).id, 1500, 'Door 9', 'correct-door-9')))
    const moved = unwrap(applyIntent(withDoor.project, correct(intent('wall.dragBody', { wallId: W6, delta: { x: 0, y: 40 } }))))

    const prime = successor(moved.project, A, W6)
    expect(prime.line.start).toEqual({ x: 5000, y: 4240 })
    // The door cut into the successor rides it, unchanged in itself.
    const door = optionOf(moved.project, A).proposed.openings.find((entry) => entry.id === 'correct-door-9')!
    expect(door.hostWallId).toBe(prime.id)
    expect(door.start).toBe(1500)
    expect(door.width).toBe(900)
    // The copy of `Window 3` the Replace made is still measured along the same Wall it always was.
    const carried = optionOf(moved.project, A).proposed.openings.find((entry) => entry.predecessorIds?.includes(WINDOW_3) ?? false)!
    expect(carried.start).toBe(600)
    expect(canonicalJson(applyPatches(moved.project, moved.inversePatches))).toBe(canonicalJson(withDoor.project))
  })

  it('leaves a successor with geometry of its own alone, and says so', () => {
    const before = project()
    const thickened = unwrap(applyIntent(before, replaceInOption(A, W6, { thickness: 150 })))
    const wrap = correct(intent('wall.dragBody', { wallId: W6, delta: { x: 0, y: 40 } }))

    const review = previewIntent(thickened.project, wrap).review as CorrectionReview | null
    expect(review!.options.find((entry) => entry.optionId === A)!.effect).toBe('demolishes; successor keeps its own geometry')

    const applied = unwrap(applyIntent(thickened.project, wrap))
    expect(wall(applied.project, W6)!.line.start).toEqual({ x: 5000, y: 4240 })
    const prime = successor(applied.project, A, W6)
    expect(prime.line.start).toEqual({ x: 5000, y: 4200 })
    expect(prime.thickness).toBe(150)
  })

  it('refuses a correction that takes down a Wall another Option has built on, naming it', () => {
    const before = project()
    const withDoor = unwrap(applyIntent(before, doorIn(B, W6, 1550, 'Door 9', 'correct-door-9')))
    const wrap = correct(intent('wall.delete', { wallId: W6, openings: [WINDOW_3] }))

    const review = previewIntent(withDoor.project, wrap).review as CorrectionReview | null
    expect(review!.options.find((entry) => entry.optionId === A)!.effect).toBe('retains')
    expect(review!.options.find((entry) => entry.optionId === B)!.blockers.join(' ')).toContain('Door 9')

    const bytes = canonicalJson(withDoor.project)
    const result = applyIntent(withDoor.project, wrap)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('option-blocked')
    expect(result.problems[0]!.message).toContain('Option B')
    expect(result.problems[0]!.message).toContain('Door 9')
    expect(canonicalJson(withDoor.project)).toBe(bytes)
  })

  it('refuses a correction that leaves a proposed door too big for the Wall, naming the Option and the door', () => {
    const before = project()
    const withDoor = unwrap(applyIntent(before, doorIn(B, W6, 1550, 'Door 9', 'correct-door-9')))
    const shorten = correct(intent('wall.setLength', { wallId: W6, length: 2000, keepFixed: 'start' }))

    const review = previewIntent(withDoor.project, shorten).review as CorrectionReview | null
    expect(review!.options.find((entry) => entry.optionId === B)!.blockers.join(' ')).toContain('Door 9')

    const bytes = canonicalJson(withDoor.project)
    const result = applyIntent(withDoor.project, shorten)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('option-blocked')
    expect(result.problems[0]!.message).toContain('Option B')
    expect(result.problems[0]!.message).toContain('Door 9')
    // Nothing changed: the Project the caller handed over is byte-identical to itself.
    expect(canonicalJson(withDoor.project)).toBe(bytes)
  })

  it('refuses to wrap another correction, or a Design Option command', () => {
    const before = splitScene()
    for (const inner of [correct(moveW6()), intent('designOption.rename', { optionId: A, name: 'Option C' })]) {
      const result = applyIntent(before, correct(inner))
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.code).toBe('unknown-target')
    }
    expect(canonicalJson(before)).toBe(canonicalJson(splitScene()))
  })

  it('applies an ordinary Existing edit untouched while the Project holds no options', () => {
    const bare = project()
    bare.designOptions = []
    const applied = unwrap(applyIntent(bare, intent('wall.setThickness', { wallId: W2, thickness: 150 })))
    expect(wall(applied.project, W2)!.thickness).toBe(150)
  })
})

describe('the BaselineCorrectionRequired guard', () => {
  const guarded: Intent[] = [
    intent('wall.setThickness', { wallId: W2, thickness: 150 }),
    intent('wall.dragBody', { wallId: W2, delta: { x: 20, y: 0 } }),
    intent('wall.delete', { wallId: W6, openings: [WINDOW_3] }),
    intent('room.rename', { roomId: 'seed-room-017', name: 'Kitchen 2' }),
    intent('opening.setWidth', { openingId: WINDOW_3, width: 1000 }),
  ]

  it('rejects every unwrapped Existing Model edit while the Project holds an option', () => {
    const before = splitScene()
    const bytes = canonicalJson(before)
    for (const wrapped of guarded) {
      const result = applyIntent(before, wrapped)
      expect(result.ok, wrapped.type).toBe(false)
      if (result.ok) continue
      expect(result.code, wrapped.type).toBe('baseline-correction-required')
    }
    expect(canonicalJson(before)).toBe(bytes)
  })

  it('says the same thing in the preview, so a dialog can show it before anything is tried', () => {
    const before = splitScene()
    const preview = previewIntent(before, intent('wall.setThickness', { wallId: W2, thickness: 150 }))
    expect(preview.rejection).not.toBeNull()
    expect(preview.rejection!.code).toBe('baseline-correction-required')
  })

  it('lets the same edit through wrapped, and leaves the option commands alone', () => {
    const before = splitScene()
    expect(applyIntent(before, correct(intent('wall.setThickness', { wallId: W2, thickness: 150 }))).ok).toBe(true)
    expect(applyIntent(before, intent('designOption.rename', { optionId: A, name: 'Option C' })).ok).toBe(true)
    expect(applyIntent(before, intent('renovation.demolish', { entityId: W2, target: { designOptionId: A } })).ok).toBe(true)
  })
})

describe('Move to a Design Option', () => {
  /** `Move to a Design Option…` is a correction whose inner Intent is the move (#69 §13). */
  const moveTo = (entityIds: string[], targetOptionId: string) =>
    correct(intent('renovation.moveToDesignOption', { entityIds, targetOptionId }))

  it('re-owns a placement, keeping its ID, and says so per option', () => {
    const before = splitScene()
    const wrap = moveTo([BASE_UNIT], B)
    const review = previewIntent(before, wrap).review as MoveToOptionReview | null
    expect(review).not.toBeNull()
    expect(review!.message).toBe('Move 1 item to Option B?')
    expect(review!.moves.map((entry) => entry.id)).toEqual([BASE_UNIT])
    expect(review!.targetOptionId).toBe(B)
    expect(review!.options.map((entry) => [entry.optionId, entry.removesDemolitions.length])).toEqual([
      [A, 0],
      [B, 0],
    ])

    const applied = unwrap(applyIntent(before, wrap))
    expect(applied.project.existingModel.placedItems.some((entry) => entry.id === BASE_UNIT)).toBe(false)
    expect(optionOf(applied.project, B).proposed.placedItems.map((entry) => entry.id)).toEqual([BASE_UNIT])
    // It keeps its ID, so a Comment pinned to it still points at it.
    expect(optionOf(applied.project, B).proposed.placedItems[0]).toEqual({
      ...before.existingModel.placedItems.find((entry) => entry.id === BASE_UNIT)!,
      predecessorIds: [],
    })
    expect(canonicalJson(applyPatches(applied.project, applied.inversePatches))).toBe(canonicalJson(before))
  })

  it('takes the Openings hosted on a moved Wall, hands its joins to the option, and detaches Rooms', () => {
    const before = project()
    const applied = unwrap(applyIntent(before, moveTo([W5], B)))
    const next = applied.project
    const option = optionOf(next, B)

    expect(wall(next, W5)).toBeUndefined()
    expect(option.proposed.walls.map((entry) => entry.id)).toEqual([W5])
    // The two joins it carried are the option's records now, still naming the Walls it left behind.
    expect(option.proposed.wallJunctions.map((entry) => entry.id).sort()).toEqual(['seed-wall-011', 'seed-wall-012'])
    expect(next.existingModel.wallJunctions.some((entry) => entry.id === 'seed-wall-011')).toBe(false)
    expect(option.proposed.wallJunctions[0]!.ends.map((end) => end.wallId)).toContain(W5)
    // The Kitchen’s edge along a Wall that is no longer Existing is detached.
    expect(next.existingModel.rooms.find((entry) => entry.id === 'seed-room-017')!.wallFaceRefs).toEqual([])
    expect(canonicalJson(applyPatches(next, applied.inversePatches))).toBe(canonicalJson(before))
  })

  it('closes the selection over the Openings standing in it', () => {
    const before = project()
    const applied = unwrap(applyIntent(before, moveTo([W6], B)))
    const next = applied.project
    expect(next.existingModel.openings.some((entry) => entry.id === WINDOW_3)).toBe(false)
    expect(optionOf(next, B).proposed.openings.map((entry) => entry.id)).toEqual([WINDOW_3])
    expect(optionOf(next, B).proposed.openings[0]!.hostWallId).toBe(W6)
  })

  it('clears every option’s demolition record naming a moved entity', () => {
    const before = project()
    const demolished = unwrap(applyIntent(before, demolishIn(A, W6, [WINDOW_3])))
    const applied = unwrap(applyIntent(demolished.project, moveTo([W6], B)))
    expect(optionOf(applied.project, A).demolishedIds).toEqual([])
    expect(optionOf(applied.project, B).demolishedIds).toEqual([])
  })

  it('refuses while another option holds a successor of what is being moved, naming it', () => {
    const before = project()
    const replaced = unwrap(applyIntent(before, replaceInOption(B, W6, {})))
    const bytes = canonicalJson(replaced.project)
    const result = applyIntent(replaced.project, moveTo([W6], A))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('option-blocked')
    expect(result.problems[0]!.message).toBe('Restore W-6 in Option B first.')
    expect(canonicalJson(replaced.project)).toBe(bytes)
  })

  it('refuses a target that is not a Design Option, an empty selection, and the bare inner Intent', () => {
    const before = splitScene()
    const cases: Intent[] = [
      moveTo([W6], 'option-c'),
      moveTo([], B),
      intent('renovation.moveToDesignOption', { entityIds: [W6], targetOptionId: B }),
    ]
    for (const wrap of cases) {
      const result = applyIntent(before, wrap)
      expect(result.ok).toBe(false)
      if (result.ok) continue
      expect(result.code).toBe('unknown-target')
    }
  })
})

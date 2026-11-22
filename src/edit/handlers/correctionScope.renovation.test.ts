/**
 * The per-Option blocker check reads a scope, not the whole model (#69 §8, §12). This is the proof
 * that the scoped answer is the whole answer: for every Option of the committed scene, and for one
 * hand-built case per way a correction can break an Option — a Door that no longer fits, work
 * standing on a Wall that came down, a Room Edge that lost the face it rides, an aligned successor
 * that follows the move — the Option is blocked exactly when a full validation of its effective
 * model reports a problem about a record the Option owns or a record the correction moved.
 *
 * The reference side deliberately knows nothing about scoping: it merges the Option by hand and
 * reads every record it can.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { DesignOption, Project } from '../../domain'
import { designOptionsOf, validateProject } from '../../domain'
import { applyIntent, previewIntent, type CorrectionReview, type Intent, type ReplaceEdit } from '../index'
import { intent } from '../testing'
import { effectiveView } from './support'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures')
const seed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'renovation-36.json'), 'utf8'),
) as { projects: { data: Project }[] }

const W1 = 'seed-wall-002'
const W2 = 'seed-wall-003'
const W6 = 'seed-wall-013'
const WINDOW_3 = 'seed-opening-016'
const A = 'option-a'
const B = 'option-b'

const project = (): Project => structuredClone(seed.projects[0]!.data)

const ids = (count: number): string[] => Array.from({ length: count }, (_entry, index) => `scope-id-${index}`)

const replaceInOption = (optionId: string, entityId: string, edit: ReplaceEdit, taken = ids(24)) =>
  intent('renovation.replace', { entityId, edit, target: { designOptionId: optionId } }, taken)

const doorIn = (optionId: string, hostWallId: string, start: number, taken: string): Intent =>
  intent(
    'renovation.placeOpening',
    {
      floorId: 'seed-001',
      hostWallId,
      kind: 'door',
      label: 'Door 9',
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

const unwrap = <R extends { ok: boolean; code?: string }>(result: R): Extract<R, { ok: true }> => {
  if (!result.ok) throw new Error(`refused: ${result.code}`)
  return result as Extract<R, { ok: true }>
}

/** The merged model with every `predecessorIds` gone: the plain shape the validator takes. */
function plainAll(source: Project): Project {
  const stripped = <T extends { predecessorIds?: string[] }>(entity: T): T => {
    if (entity.predecessorIds === undefined) return entity
    const rest: Record<string, unknown> = { ...entity }
    delete rest.predecessorIds
    return rest as T
  }
  const model = source.existingModel
  return {
    ...source,
    designOptions: [],
    existingModel: {
      ...model,
      walls: model.walls.map(stripped),
      wallJunctions: model.wallJunctions.map(stripped),
      openings: model.openings.map(stripped),
      rooms: model.rooms.map(stripped),
      placedItems: model.placedItems.map(stripped),
    },
  }
}

/** Every problem a full read of one Option's effective model finds, with nothing scoped away. */
function wholeModelProblems(source: Project, optionId: string): readonly string[] {
  const result = validateProject(plainAll(effectiveView(source, null, optionId)))
  return result.ok ? [] : result.problems.map((problem) => `${problem.path}: ${problem.message}`)
}

/** The Options the correction reports as blocked, read from the preview the UI would show. */
function blockedOptions(source: Project, inner: Intent): Set<string> {
  const review = previewIntent(source, intent('renovation.correctExistingModel', { inner }))
    .review as CorrectionReview | null
  if (review === null) throw new Error('the correction had nothing to preview')
  return new Set(review.options.filter((entry) => entry.blockers.length > 0).map((entry) => entry.optionId))
}

/**
 * The agreement, for one scene and one wrapped edit. Each Option's effective model is read whole —
 * every record of it, no scope — before the correction and after it, and the Option is blocked
 * exactly when the correction is what made the whole read fail. The scene itself has to start clean,
 * or the comparison would prove nothing. A correction that commits has already moved each aligned
 * successor, so the read after it is made against the Project it wrote, which is the state the
 * per-Option check weighed.
 */
function agrees(scene: Project, inner: Intent, label: string): void {
  for (const option of designOptionsOf(scene)) {
    expect(wholeModelProblems(scene, option.id), `${label}: ${option.id} was broken before the correction`).toEqual([])
  }
  const blocked = blockedOptions(scene, inner)
  const applied = applyIntent(scene, intent('renovation.correctExistingModel', { inner }))
  expect(applied.ok, `${label}: the commit did not agree with the preview`).toBe(blocked.size === 0)
  const after = applied.ok
    ? applied.project
    : {
        ...unwrap(applyIntent({ ...scene, designOptions: [] }, inner)).project,
        designOptions: structuredClone(designOptionsOf(scene)) as DesignOption[],
      }
  for (const option of designOptionsOf(after)) {
    const problems = wholeModelProblems(after, option.id)
    expect(blocked.has(option.id), `${label} — ${option.id}: ${problems.join('; ')}`).toBe(problems.length > 0)
  }
}

describe('the scoped per-Option blocker check against a full read of the model (#69 §8, §12)', () => {
  it('agrees on the committed scene, corrected in the ways the scene survives', () => {
    agrees(project(), intent('wall.setThickness', { wallId: W2, thickness: 150 }), 'thickness of W-2')
    agrees(project(), intent('wall.dragBody', { wallId: W6, delta: { x: 0, y: 40 } }), 'W-6 slid free')
  })

  it('agrees when a correction shrinks the Wall a proposed Door stands in', () => {
    const scene = unwrap(applyIntent(project(), doorIn(B, W6, 1550, 'scope-door-9'))).project
    agrees(scene, intent('wall.setLength', { wallId: W6, length: 2000, keepFixed: 'start' }), 'door no longer fits')
  })

  it('agrees when a correction takes down a Wall a proposed Door stands in', () => {
    const scene = unwrap(applyIntent(project(), doorIn(B, W6, 1550, 'scope-door-9'))).project
    agrees(scene, intent('wall.delete', { wallId: W6, openings: [WINDOW_3] }), 'door stands on nothing')
  })

  it('agrees when a correction slides a Wall out from under a proposed Room', () => {
    const ridden = project().existingModel.rooms.find((entry) => entry.wallFaceRefs.length > 0)!.id
    const scene = unwrap(applyIntent(project(), replaceInOption(A, ridden, {}))).project
    const host = scene.existingModel.rooms.find((entry) => entry.id === ridden)!.wallFaceRefs[0]!.wallId
    agrees(scene, intent('wall.dragBody', { wallId: host, delta: { x: 20, y: 0 } }), 'room edge off its face')
  })

  it('agrees when the Option holds an aligned successor that follows the move', () => {
    const scene = unwrap(applyIntent(project(), replaceInOption(A, W2, {}))).project
    agrees(scene, intent('wall.dragBody', { wallId: W2, delta: { x: 20, y: 0 } }), 'successor follows')
  })

  it('agrees when the correction moves a Wall next to one the Option has copied', () => {
    // The successor of W-2 is not itself corrected here, but it stands where W-2 stood in this
    // Option's model, and W-2 is read because it names the corrected Wall. A pass that only strips
    // provenance from the records it means to read leaves that copy looking like a Wall the Existing
    // Model invented, which is a blocker the Option did not earn.
    const scene = unwrap(applyIntent(project(), replaceInOption(A, W2, {}))).project
    agrees(scene, intent('wall.setThickness', { wallId: W1, thickness: 150 }), 'neighbour corrected')
  })
})

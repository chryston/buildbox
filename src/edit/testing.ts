/**
 * Shared ground for the three Intent test files (#47 criteria 3–5).
 *
 * Two rules make these tests worth running. IDs come from a counter, never `nanoid`, so a
 * failure names the ID that was spent (#42 §3); and every applied Intent is checked both
 * ways — forward through its patches and back through its inverses — because #48 will
 * store the patches and nothing else.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect } from 'vitest'
import { migrateProject } from '../domain'
import type { Project } from '../domain'
import { canonicalJson } from '../lib'
import { applyIntent, applyPatches } from './apply'
import { CREATE_PROJECT_ID_COUNT, createProject } from './create'
import { intentLabel } from './labels'
import type { Applied, Intent, IntentType, PayloadOf, Rejection, RejectionCode } from './intents'

/** The clock every test Intent carries. Nothing here reads a real one. */
export const NOW = '2026-11-18T09:00:00.000Z'

/** The caller's ID allocator: `ids(2)` is the next two IDs, in order. */
export function idSource(prefix: string): (count?: number) => string[] {
  let issued = 0
  return (count = 1) => Array.from({ length: count }, () => `${prefix}-${++issued}`)
}

/** One Intent, labelled as the catalogue labels it, carrying the IDs it will spend. */
export function intent<T extends IntentType>(type: T, payload: PayloadOf<T>, taken: string[] = []): Intent<T> {
  return { type, label: intentLabel(type), payload, ids: taken, now: NOW }
}

/** `fixtures/domain/v1/project-basic.json`: two Floors, a cabinet placed twice, a template. */
export function basicProject(): Project {
  const url = new URL('../../fixtures/domain/v1/project-basic.json', import.meta.url)
  const envelope = JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as Record<string, unknown>
  const result = migrateProject(envelope.project, envelope.domainSchemaVersion as number, idSource('view'))
  if (!result.ok) throw new Error(`project-basic.json: ${result.error.message}`)
  return result.project
}

/** The Project "New Project" makes, with the IDs `createProject` spends. */
export function newProject(name = 'Kitchen'): Project {
  return createProject({ ids: idSource('new')(CREATE_PROJECT_ID_COUNT), now: NOW, name })
}

/** A Project whose one cabinet has a shelf, so tree Intents have a space to point at. */
export function splitProject(): { project: Project; rootId: string; childIds: string[] } {
  const project = newProject()
  const rootId = cabinetOf(project).construction.root.id
  const childIds = idSource('shelf')(2)
  const result = applyIntent(project, intent('cabinet.addShelf', { itemDesignId: designId(project), nodeId: rootId }, childIds))
  if (!result.ok) throw new Error(`the shelf that sets up these tests was refused: ${result.code}`)
  return { project: result.project, rootId, childIds }
}

/** The first cabinet Item Design, which every test Project here has exactly one of. */
export function cabinetOf(project: Project) {
  const design = project.itemDesigns.find((candidate) => candidate.kind === 'cabinet')
  if (design === undefined || design.kind !== 'cabinet') throw new Error('this test Project holds no cabinet')
  return design
}

export function designId(project: Project): string {
  return cabinetOf(project).id
}

/** The first generic Placed Item on the Project, and the Floor it stands on. */
export function firstPlacement(project: Project) {
  const placed = project.existingModel.placedItems[0]
  if (placed === undefined) throw new Error('this test Project places nothing')
  return placed
}

export function expectApplied(project: Project, next: Intent): Applied {
  const result = applyIntent(project, next)
  if (!result.ok) {
    throw new Error(`${next.type} was refused with ${result.code}: ${JSON.stringify(result.problems)}`)
  }
  return result
}

/** A refusal, with criterion 3's checks: no patches, a code, and a problem that says why. */
export function expectRejection(project: Project, next: Intent, code: RejectionCode): Rejection {
  const result = applyIntent(project, next)
  if (result.ok) throw new Error(`${next.type} applied; expected a ${code} rejection`)
  expect(result, 'a Rejection never carries patches').not.toHaveProperty('patches')
  expect(result.code).toBe(code)
  expect(result.problems.length, 'a Rejection names at least one problem').toBeGreaterThan(0)
  return result
}

/**
 * Criterion 2: the patches rebuild the result from the input, and the inverse patches
 * rebuild the input from the result — canonically equal, not merely equal in the fields a
 * test happened to look at.
 */
export function expectRoundTrip(project: Project, next: Intent): Applied {
  const result = expectApplied(project, next)
  expect(canonicalJson(applyPatches(result.project, result.inversePatches))).toBe(canonicalJson(project))
  expect(canonicalJson(applyPatches(project, result.patches))).toBe(canonicalJson(result.project))
  return result
}

/** Criterion 5: the same Project and Intent give byte-identical results and patches. */
export function expectDeterministic(project: Project, next: Intent): void {
  const first = expectApplied(project, next)
  const second = expectApplied(project, next)
  expect(canonicalJson(first.project)).toBe(canonicalJson(second.project))
  expect(canonicalJson(first.patches)).toBe(canonicalJson(second.patches))
  expect(canonicalJson(first.inversePatches)).toBe(canonicalJson(second.inversePatches))
}

/** Criterion 3: hand the handler a deep-frozen Project, so a stray write throws. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

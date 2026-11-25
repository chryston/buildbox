/**
 * Nothing comes off an Anchor without being asked about (#82 criterion 11).
 *
 * The rule the whole feature exists for: an operation that takes away what a Comment or an Annotation
 * points at either reports that note or leaves it still pointing at something. It is stated here as a
 * property rather than a case, because the failure mode is a specific one nobody would think to write a
 * test for — a note that quietly disappears inside a handler that was never taught about notes, or one
 * left pointing at an id that no longer exists, which the reader sees as a note that stopped opening.
 *
 * The inputs are the shipped Notes scene crossed with every removal the scene can take and every answer
 * the review offers. The scene is used rather than a random Project because the property is only
 * interesting where notes actually hang off things, and the shipped scene is the one artifact guaranteed
 * to hold each Anchor kind with distinct ids; a random Project mostly has no notes at all, and the
 * property would pass by vacuity.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { Annotation, Comment, Project } from '../domain'
import { migrateProject, validateProject } from '../domain'
import { applyIntent, previewIntent } from './apply'
import type { Intent, NotesChoice, NotesDependencyRow, NotesResolution, NotesTargetRef } from './index'
import { intent, NOW } from './testing'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')

function scene(): Project {
  const text = readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'notes-review-scene.json'), 'utf8')
  const envelope = JSON.parse(text) as { projects: { data: Project; schemaVersion: number }[] }
  const record = envelope.projects[0]!
  const migrated = migrateProject(record.data, record.schemaVersion, () => [])
  if (!migrated.ok) throw new Error(`the shipped Notes scene no longer migrates: ${migrated.error.message}`)
  return migrated.project as Project
}

const PROJECT = scene()

/** Every removal the scene can take, whether or not it happens to be about a note. */
const REMOVALS: readonly Intent[] = [
  ...PROJECT.existingModel.placedItems.map((item) => intent('plan.removeObject', { placedItemId: item.id })),
  ...PROJECT.existingModel.walls.map((wall) => intent('wall.delete', { wallId: wall.id })),
  ...PROJECT.existingModel.openings.map((opening) => intent('opening.delete', { openingId: opening.id })),
  ...PROJECT.views.map((view) => intent('elevationView.delete', { viewId: view.id })),
].map((next) => ({ ...next, now: NOW }) as Intent)

/** The notes the Project holds, keyed by the id the report uses. */
function notesOf(project: Project): Map<string, Comment | Annotation> {
  const notes = new Map<string, Comment | Annotation>()
  for (const comment of project.comments) notes.set(`comment-${comment.reference}`, comment)
  for (const mark of project.annotations) notes.set(`annotation-${mark.reference}`, mark)
  return notes
}

/** A row answered at random, from the choices and targets the review itself offered. */
function resolutionFor(row: NotesDependencyRow, choiceAt: number, targetAt: number): NotesResolution {
  const choice: NotesChoice = row.choices[choiceAt % row.choices.length]!
  const target: NotesTargetRef | undefined =
    choice === 'reanchor' ? row.targets[targetAt % Math.max(row.targets.length, 1)] : undefined
  return {
    dependentId: row.dependentId,
    choice,
    ...(target !== undefined ? { targetRef: target } : {}),
    expectedAnchor: row.fingerprint,
  } as NotesResolution
}

describe('no note is detached without being reported (#82 criterion 11)', () => {
  it('answers every removal with the review it shows, and never leaves a note dangling or unasked', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: REMOVALS.length - 1 }),
        fc.nat({ max: 999 }),
        fc.nat({ max: 999 }),
        (removalAt, choiceSeed, targetSeed) => {
          const base = REMOVALS[removalAt]!
          const { notes, rejection } = previewIntent(PROJECT, base)
          // A removal the edit layer refuses for its own reasons (#70 baselines, last-floor rules) shows
          // no review and changes nothing, so it cannot detach anything either.
          if (rejection !== null) return true
          const rows = notes?.rows ?? []

          const resolutions: NotesResolution[] = rows.map((row, index) =>
            resolutionFor(row, choiceSeed + index, targetSeed + index * 7),
          )
          const next = { ...base, notesResolutions: resolutions } as Intent
          const result = applyIntent(PROJECT, next)
          if (!result.ok) return true

          const after = result.project
          const before = notesOf(PROJECT)
          const remaining = notesOf(after)

          // Nothing vanishes that the review did not list, and nothing it listed survives a Delete.
          for (const [id, note] of before) {
            const row = rows.find((entry) => entry.dependentId === id)
            const deleted = row !== undefined && resolutions.find((entry) => entry.dependentId === id)?.choice === 'delete'
            if (row === undefined) {
              const kept = remaining.get(id)
              expect(kept, `${base.type} removed ${id} without reporting it`).toBeDefined()
              // Not reported means not so much as moved: the note the reader wrote is the note that
              // comes back, field for field.
              expect(kept).toEqual(note)
            } else {
              expect(remaining.has(id), `${id} was answered ${deleted ? 'delete' : 'keep'} and went missing anyway`).toBe(!deleted)
            }
          }

          // And what is left still resolves: a dangling Anchor is a validation error, so a clean
          // Project is exactly the statement "every note still opens".
          const problems = validateProject(after)
          expect(problems.ok, problems.ok ? '' : problems.problems.map((problem) => `${problem.path}: ${problem.message}`).join('\n')).toBe(true)
          return true
        },
      ),
      { numRuns: 200 },
    )
  })

  it('reports every note the removal actually detaches, so no row is missing from the question', () => {
    fc.assert(
      fc.property(fc.nat({ max: REMOVALS.length - 1 }), (removalAt) => {
        const base = REMOVALS[removalAt]!
        const { notes, rejection } = previewIntent(PROJECT, base)
        if (rejection !== null) return true
        const result = applyIntent(PROJECT, base)
        // Unanswered, the review blocks: the refusal is the point, and it must not half-apply.
        if (notes !== null) {
          expect(result.ok).toBe(false)
          if (result.ok) return false
          return true
        }
        if (!result.ok) return true
        // With nothing to ask, every note that existed is still there and still resolves.
        const remaining = notesOf(result.project)
        for (const id of notesOf(PROJECT).keys()) expect(remaining.has(id), `${id} disappeared with no review`).toBe(true)
        const problems = validateProject(result.project)
        expect(problems.ok, problems.ok ? '' : problems.problems.map((problem) => `${problem.path}: ${problem.message}`).join('\n')).toBe(true)
        return true
      }),
      { numRuns: REMOVALS.length },
    )
  })
})

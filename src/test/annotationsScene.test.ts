/**
 * The shipped Annotations scene validates (#81 §12).
 *
 * The e2e smoke and the screenshot frames both open `fixtures/e2e/preview-seed/annotations-scene.json`
 * directly, so the day the generator drifts the browser tests would fail in a dozen places at once.
 * This holds the committed bytes to the one claim they exist for: the scene is a valid v16 Project,
 * it carries one Annotation of each of the five types, and the reference counter sits ahead of every
 * number in use. A scene that did not validate would make the app refuse every Intent on it as
 * `invalid-project` — the Annotations would list but never be writable, invisibly.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ANNOTATION_TYPES, validateProject } from '../domain'
import type { Project } from '../domain'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const seed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'annotations-scene.json'), 'utf8'),
) as { projects: { schemaVersion: number; data: Project }[] }

const project = (): Project => structuredClone(seed.projects[0]!.data)

describe('the shipped Annotations scene (#81 §12)', () => {
  it('is a valid v16 Project', () => {
    expect(seed.projects[0]!.schemaVersion).toBe(16)
    const checked = validateProject(project())
    if (!checked.ok) expect.fail(checked.problems.map((p) => `${p.path}: ${p.message}`).join('; '))
    expect(checked.ok).toBe(true)
  })

  it('carries one Annotation of each type, with the counter ahead of every reference', () => {
    const scene = project()
    expect(scene.annotations.map((annotation) => annotation.type).sort()).toEqual([...ANNOTATION_TYPES].sort())
    const highest = Math.max(...scene.annotations.map((annotation) => Number(annotation.reference.slice(2))))
    expect(scene.annotationReferenceCounter).toBeGreaterThan(highest)
  })

  it('gives the Reference Marker a target that is not its own view', () => {
    const marker = project().annotations.find((annotation) => annotation.type === 'reference_marker')
    expect(marker).toBeDefined()
    expect(marker?.targetViewId).toBeDefined()
    expect(marker?.targetViewId).not.toBe(marker?.viewId)
  })
})

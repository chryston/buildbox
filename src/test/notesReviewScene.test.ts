/**
 * The Notes dependency-review scene validates (#82 fixture), and so does every other shipped preview
 * seed.
 *
 * The e2e smoke and the screenshot frames open these files directly, and the app refuses every Intent
 * on a Project that does not validate — as `invalid-project`, in the console, with nothing on screen to
 * say why a review never opens. So the committed bytes are held to the one claim they exist for: each
 * scene migrates and validates, and the Notes scene holds the relationships its criteria are written
 * against. A fixture that quietly stopped validating would make criteria 2 to 10 fail as "no review
 * appeared", which reads like a missing feature and is not one.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { migrateProject, validateProject } from '../domain'
import type { Project } from '../domain'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const seedsRoot = join(fixturesRoot, 'e2e', 'preview-seed')

type Envelope = { projects: { schemaVersion: number; data: unknown }[] }

const read = (file: string): Envelope =>
  JSON.parse(readFileSync(join(seedsRoot, file), 'utf8')) as Envelope

/** The scene as the app would hold it today: migrated by the chain the app runs, then validated. */
const opened = (file: string): Project => {
  const envelope = read(file)
  const record = envelope.projects[0]!
  const migrated = migrateProject(record.data, record.schemaVersion, () => [])
  if (!migrated.ok) expect.fail(`${file}: migrating failed — ${migrated.error.message}`)
  return migrated.project as Project
}

const scene = (): Project => opened('notes-review-scene.json')

describe('the shipped preview seeds (#82 pitfall: an invalid scene refuses every Intent)', () => {
  // Only the seeds the app opens as Projects it can write to are swept. The older ones exist to be
  // old — they are what the migration chain and the import path are tested against, and `migrateProject`
  // refuses a version it does not migrate from by design.
  it('migrate and validate, every one of them', () => {
    for (const file of readdirSync(seedsRoot).filter((name) => name.endsWith('.json'))) {
      const envelope = read(file)
      const record = envelope.projects[0]
      if (record === undefined || record.schemaVersion < 15) continue
      const migrated = migrateProject(record.data, record.schemaVersion, () => [])
      if (!migrated.ok) {
        expect.fail(`${file}: migrating failed — ${migrated.error.message}`)
      }
      const checked = validateProject(migrated.project as Project)
      if (!checked.ok) {
        expect.fail(`${file}: ${checked.problems.map((p) => `${p.path}: ${p.message}`).join('; ')}`)
      }
    }
  })
})

describe('the Notes review scene (#82 fixture)', () => {
  it('is a valid v16 Project carrying eight Comments and four Annotations', () => {
    expect(read('notes-review-scene.json').projects[0]!.schemaVersion).toBe(16)
    const project = scene()
    expect(project.comments).toHaveLength(8)
    expect(project.annotations).toHaveLength(4)
    // The counters sit one ahead, so "the fourth Comment" and "one the app just made" differ.
    expect(project.commentReferenceCounter).toBe(9)
    expect(project.annotationReferenceCounter).toBe(5)
  })

  it('places Base 600 twice, and anchors C-004 to the placement that gets deleted (criteria 2 to 4)', () => {
    const project = scene()
    const design = project.itemDesigns.find((item) => item.name === 'Base 600')
    expect(design).toBeDefined()
    const bases = project.existingModel.placedItems.filter((item) => item.itemDesignId === design!.id)
    expect(bases.map((item) => item.id)).toEqual(['seed-item-028', 'seed-item-029'])
    const note = project.comments.find((item) => item.reference === 'C-004')
    expect(note?.anchor).toEqual({ kind: 'entity', entityId: 'seed-item-029' })
    expect(note?.status).toBe('open')
  })

  it('keeps C-005 Resolved on W-3, which the Wall review must list anyway (criterion 5)', () => {
    const project = scene()
    const wall = project.existingModel.walls[2]!
    const note = project.comments.find((item) => item.reference === 'C-005')
    expect(note?.anchor).toEqual({ kind: 'entity', entityId: wall.id })
    expect(note?.status).toBe('resolved')
    expect(note?.resolvedAt).toBeDefined()
  })

  it('anchors A-002 to the same W-3 that C-005 speaks for (criterion 6)', () => {
    const project = scene()
    const wall = project.existingModel.walls[2]!
    const leader = project.annotations.find((item) => item.reference === 'A-002')
    expect(leader?.type).toBe('leader')
    expect(leader?.endpoint).toEqual({ anchor: { kind: 'entity', entityId: wall.id } })
  })

  it('draws A-004 in the Elevation View and points it at the Base 600 Item Detail (criterion 7)', () => {
    const project = scene()
    const elevation = project.elevationViews?.[0]
    expect(elevation?.name).toBe('Kitchen · North Elevation')
    const marker = project.annotations.find((item) => item.reference === 'A-004')
    expect(marker?.type).toBe('reference_marker')
    expect(marker?.viewId).toBe(elevation!.id)
    // An Item Detail View is addressed by the design whose detail it is — its only stable ID.
    expect(marker?.targetViewId).toBe(project.itemDesigns.find((item) => item.name === 'Base 600')!.id)
  })

  it('puts the Island that C-007 speaks for inside Option B, with A-003 scoped to it (criterion 9)', () => {
    const project = scene()
    expect((project.designOptions ?? []).find((item) => item.id === 'option-b')?.proposed.placedItems.map((item) => item.id)).toContain('optb-island')
    const note = project.comments.find((item) => item.reference === 'C-007')
    expect(note?.anchor).toEqual({ kind: 'entity', entityId: 'optb-island' })
    expect(project.annotations.find((item) => item.reference === 'A-003')?.scope).toBe('option-b')
    // The Island is Option B's alone, so deleting the Option is what strands both notes.
    expect(project.existingModel.placedItems.some((item) => item.id === 'optb-island')).toBe(false)
  })

  it('anchors C-008 to a second Floor that can be deleted (criterion 10)', () => {
    const project = scene()
    const levelTwo = project.floors.find((floor) => floor.name === 'Level 2')
    expect(levelTwo).toBeDefined()
    const note = project.comments.find((item) => item.reference === 'C-008')
    expect(note?.anchor).toEqual({ kind: 'floor', floorId: levelTwo!.id })
  })
})

/**
 * The renovation-views scene fixture (#70 criterion 7).
 *
 * `fixtures/e2e/preview-seed/renovation-views.json` is the scene the four Renovation Displays are
 * tested against, and `fixtures/domain/v10/renovation-views.json` is the same Project as a domain
 * golden. This holds the committed bytes — not the generator's in-memory Project — to the issue's
 * scene, and then reads each of the four Displays off it, because criterion 7 is a sentence about
 * what a Display *draws*, and the only honest place to read that is the derived display model the
 * canvas is given.
 *
 * With Option A active:
 *
 *   Existing    W-2 and `Base 600 #1` stand; nothing the Option owns is drawn
 *   Demolition  W-2 and `Base 600 #1` are drawn as demolitions; still no proposed work
 *   Proposed    both are gone; `Base 600 #1′` is drawn as proposed
 *   Combined    all three at once, and the five Walls Option A leaves standing still stand
 *
 * Option B is the other half of the scene: it replaces W-2 with `W-2′` on W-2's own footprint, so
 * the two Options disagree about one Wall and each one's model is untouched by the other's.
 *
 * The Island is the one record in the fixture that no Intent drew — no shipped Intent creates a
 * Placed Item owned by an Option — and `scripts/make-renovation-views-seed.ts` says so where it
 * writes it. What this file cares about is that the validator accepts it and the four Displays treat
 * it like any other piece of an Option's own work.
 *
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { currentSchemaOf } from '../domain/testing'
import { displayModel, effectiveModel } from '../derive'
import { validateProject } from '../domain'
import type { Project, RenovationDisplay } from '../domain'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const seed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'renovation-views.json'), 'utf8'),
) as {
  dbName: string
  projects: { id: string; revision: number; schemaVersion: number; data: Project }[]
}

const project = currentSchemaOf(seed.projects[0]!.data, seed.projects[0]!.schemaVersion)
const floorId = project.floors[0]!.id
const model = project.existingModel
const wallByRef = (ref: string) => model.walls.find((wall) => wall.ref === ref)!
const base600 = project.itemDesigns.find((design) => design.name === 'Base 600')!
const baseItem = model.placedItems.find((placed) => placed.itemDesignId === base600.id)!
const options = project.designOptions ?? []
const optionA = options.find((option) => option.name === 'Option A · Open kitchen')!
const optionB = options.find((option) => option.name === 'Option B · Widened opening')!

/** What one Display draws of one Option, as `id → state` over the Walls and Placed Items. */
const drawn = (optionId: string | null, display: RenovationDisplay) => {
  const shown = displayModel(effectiveModel(project, floorId, optionId), display)
  return {
    walls: Object.fromEntries(shown.walls.map((row) => [row.entity.id, row.renovationState])),
    items: Object.fromEntries(shown.placedItems.map((row) => [row.entity.id, row.renovationState])),
  }
}

describe('the renovation-views scene (#70 criterion 7)', () => {
  it('validates, and carries the two Options the issue names', () => {
    expect(validateProject(project).ok).toBe(true)
    expect(options.map((option) => option.name)).toEqual([optionA.name, optionB.name])
    expect(model.walls.map((wall) => wall.ref)).toEqual(['W-1', 'W-2', 'W-3', 'W-4', 'W-5', 'W-6'])
  })

  it('holds Option A as the demolition of W-2 and the replacement of `Base 600 #1`', () => {
    expect([...optionA.demolishedIds].sort()).toEqual([wallByRef('W-2').id, baseItem.id].sort())
    expect(optionA.proposed.walls).toEqual([])
    expect(optionA.proposed.placedItems).toHaveLength(2)
    const successor = optionA.proposed.placedItems[0]!
    expect(successor.predecessorIds).toEqual([baseItem.id])
    expect(successor.translation.x).toBe(baseItem.translation.x + 900)
    expect(successor.itemDesignId).toBe(baseItem.itemDesignId)
    // The Island is new work: no predecessor, its own design, standing in the Kitchen.
    const island = optionA.proposed.placedItems[1]!
    expect(island.predecessorIds).toEqual([])
    expect(island.itemDesignId).toBe(project.itemDesigns.find((design) => design.name === 'Kitchen island')!.id)
    expect(island.translation).toEqual({ x: 1800, y: 4200 })
    expect(model.placedItems.some((placed) => placed.id === island.id)).toBe(false)
  })

  it('holds Option B as W-2′ on W-2’s own footprint', () => {
    expect(optionB.demolishedIds).toEqual([wallByRef('W-2').id])
    expect(optionB.proposed.placedItems).toEqual([])
    expect(optionB.proposed.walls).toHaveLength(1)
    const successor = optionB.proposed.walls[0]!
    expect(successor.predecessorIds).toEqual([wallByRef('W-2').id])
    expect(successor.line).toEqual(wallByRef('W-2').line)
    expect(successor.thickness).toBe(wallByRef('W-2').thickness)
  })

  it('draws the four Displays of Option A exactly as criterion 7 says', () => {
    const w2 = wallByRef('W-2').id
    const successor = optionA.proposed.placedItems[0]!.id
    const island = optionA.proposed.placedItems[1]!.id

    const existing = drawn(optionA.id, 'existing')
    expect(existing.walls[w2]).toBe('existing')
    expect(existing.items[baseItem.id]).toBe('existing')
    // Nothing the Option owns is drawn, in any Display, with the Existing Display aimed at the
    // Option that owns it.
    expect(successor in existing.items).toBe(false)
    expect(island in existing.items).toBe(false)

    const demolition = drawn(optionA.id, 'demolition')
    expect(demolition.walls[w2]).toBe('demolition')
    expect(demolition.items[baseItem.id]).toBe('demolition')
    expect(successor in demolition.items).toBe(false)
    expect(island in demolition.items).toBe(false)
    // The Demolition display draws no proposed thing at all, of any kind.
    expect(Object.values(demolition.walls)).not.toContain('proposed')
    expect(Object.values(demolition.items)).not.toContain('proposed')

    const proposed = drawn(optionA.id, 'proposed')
    expect(w2 in proposed.walls).toBe(false)
    expect(baseItem.id in proposed.items).toBe(false)
    expect(proposed.items[successor]).toBe('proposed')
    expect(proposed.items[island]).toBe('proposed')

    const combined = drawn(optionA.id, 'combined')
    expect(combined.walls[w2]).toBe('demolition')
    expect(combined.items[baseItem.id]).toBe('demolition')
    expect(combined.items[successor]).toBe('proposed')
    expect(combined.items[island]).toBe('proposed')
    // The five Walls Option A leaves standing still stand, in every Display.
    for (const display of ['existing', 'demolition', 'proposed', 'combined'] as const) {
      const standing = Object.entries(drawn(optionA.id, display).walls).filter(([id]) => id !== w2)
      expect(standing, display).toHaveLength(5)
      expect(standing.every(([, state]) => state === 'existing'), display).toBe(true)
    }
  })

  it('draws Option B as the same Wall replaced, and leaves Option A out of it', () => {
    const w2 = wallByRef('W-2').id
    const successor = optionB.proposed.walls[0]!.id

    expect(drawn(optionB.id, 'existing').walls[w2]).toBe('existing')
    const proposed = drawn(optionB.id, 'proposed')
    expect(w2 in proposed.walls).toBe(false)
    expect(proposed.walls[successor]).toBe('proposed')
    const combined = drawn(optionB.id, 'combined')
    expect(combined.walls[w2]).toBe('demolition')
    expect(combined.walls[successor]).toBe('proposed')
    // Option A's kitchen work is nowhere in Option B's model, and the other way round.
    expect(drawn(optionB.id, 'combined').items[baseItem.id]).toBe('existing')
    expect(Object.values(drawn(optionB.id, 'combined').items)).not.toContain('proposed')
    expect(Object.keys(drawn(optionA.id, 'combined').walls)).not.toContain(successor)
  })

  it('draws nothing an Option owns when no Option is chosen, in every Display', () => {
    for (const display of ['existing', 'demolition', 'proposed', 'combined'] as const) {
      const states = Object.values(drawn(null, display).walls).concat(Object.values(drawn(null, display).items))
      expect(states.every((state) => state === 'existing'), display).toBe(true)
    }
  })

  it('carries the saved views the Displays are named by', () => {
    const views = project.views.filter((view) => view.floorId === floorId)
    expect(views.map((view) => view.name)).toEqual([
      'Floor 1',
      'Option A · Proposed',
      'Option A · Demolition',
      'Option B · Combined',
    ])
    const named = (name: string) => views.find((view) => view.name === name)!
    expect(named('Floor 1').designOptionId).toBeUndefined()
    expect(named('Floor 1').renovationDisplay).toBeUndefined()
    expect(named('Option A · Proposed').designOptionId).toBe(optionA.id)
    expect(named('Option A · Proposed').renovationDisplay).toBe('proposed')
    expect(named('Option A · Demolition').designOptionId).toBe(optionA.id)
    expect(named('Option A · Demolition').renovationDisplay).toBe('demolition')
    expect(named('Option B · Combined').designOptionId).toBe(optionB.id)
    expect(named('Option B · Combined').renovationDisplay).toBe('combined')
  })

  it('is the same Project as the v13 domain golden', () => {
    const golden = JSON.parse(
      readFileSync(join(fixturesRoot, 'domain', 'v13', 'renovation-views.json'), 'utf8'),
    ) as { domainSchemaVersion: number; project: Project }
    expect(golden.domainSchemaVersion).toBe(13)
    expect(validateProject(golden.project).ok).toBe(true)
    expect(golden.project).toEqual(project)
  })
})

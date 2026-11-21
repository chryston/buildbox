/**
 * A placed element keeps its own numbers (#63 criterion 5).
 *
 * A preset is a starting point, and it stops being one the moment something downstream
 * re-reads it: a flat whose walls were placed at 100 mm has to stay a 100 mm flat when the
 * pack is corrected, widened to a second edition, or replaced by a resale pack. So a preset
 * is resolved once, by the tool that places the element, and what the Project keeps is
 * millimetres — the same reason a Placed Item stores a translation rather than a formula.
 *
 * The test is the shape of that claim. It builds a Project the way a Wall tool's Intent
 * builder will (#64): read a row of the pack, put its numbers in the Item Design. Then it
 * swaps in a pack whose every value is ten times as large and derives the same Project
 * again. Byte-identical output is the whole criterion — had any part of the pipeline kept a
 * live link to the pack, the swap would show up in the bytes. The last case is the guard
 * against a vacuous pass: the same builder over the swapped pack does produce different
 * bytes, so the equality above says the numbers were fixed at build time and nowhere later.
 *
 * This file is the one under `src/domain` that imports `derive`, and it is a test file: the
 * pack itself still reaches nothing but `domain` and `lib`, which `purity.test.ts` reads.
 */
import { describe, expect, it } from 'vitest'
import { effectiveFloor, effectiveItemDetail } from '../../derive'
import { canonicalJson } from '../../lib'
import {
  getPresetPack,
  rectangleFootprint,
  validateProject,
  type GenericItemDesign,
  type PresetPack,
  type Project,
} from '../index'

const PACK_ID = 'hdb-bto-typical'

/** One wall row of a pack, read as the number a Wall tool needs. */
function thicknessOf(pack: PresetPack, entryId: string): number {
  const row = pack.entries.find((entry) => entry.id === entryId)
  if (row?.kind !== 'wall') throw new Error(`the pack has no wall row ${entryId}`)
  return row.values.thickness
}

/** The ceiling row of a pack, read as the height a Wall tool needs. */
function ceilingOf(pack: PresetPack): number {
  const row = pack.entries.find((entry) => entry.id === 'height.ceiling')
  if (row?.kind !== 'height') throw new Error('the pack has no height.ceiling row')
  return row.values.height
}

/** One door row of a pack, read as the opening a Door tool needs. */
function openingOf(pack: PresetPack, entryId: string): { width: number; height: number } {
  const row = pack.entries.find((entry) => entry.id === entryId)
  if (row?.kind !== 'door') throw new Error(`the pack has no door row ${entryId}`)
  return { width: row.values.width, height: row.values.height }
}

/**
 * What an Intent builder writes after resolving the pack: a wall of the pack's thickness to
 * the pack's ceiling height, and a bedroom door of the pack's opening in that wall.
 */
function projectBuiltFrom(pack: PresetPack): Project {
  const thickness = thicknessOf(pack, 'wall.internal')
  const ceiling = ceilingOf(pack)
  const door = openingOf(pack, 'door.bedroom')
  const wall: GenericItemDesign = {
    id: 'design-wall',
    kind: 'generic',
    name: 'Wall',
    footprint: rectangleFootprint(4000, thickness),
    origin: { x: 2000, y: thickness / 2 },
    height: ceiling,
    heightIsTypical: false,
    color: '#b4b4b4',
  }
  const doorDesign: GenericItemDesign = {
    id: 'design-door',
    kind: 'generic',
    name: 'Door',
    footprint: rectangleFootprint(door.width, thickness),
    origin: { x: door.width / 2, y: thickness / 2 },
    height: door.height,
    heightIsTypical: false,
    color: '#8b5a2b',
  }
  return {
    id: 'project-1',
    meta: { name: 'Flat' },
    preferences: { displayUnit: 'mm', displayPrecision: 0, defaultWallHeight: 2600 },
    floors: [{ id: 'floor-1', name: 'Home', planImage: null }],
    views: [{ id: 'view-1', kind: 'plan', floorId: 'floor-1', name: 'Home', isDefault: true, showPlanImage: false }],
    itemDesigns: [wall, doorDesign],
    existingModel: {
      walls: [],
      wallJunctions: [],
      openings: [],
      rooms: [],
      placedItems: [
        {
          id: 'placed-wall',
          itemDesignId: 'design-wall',
          floorId: 'floor-1',
          translation: { x: 0, y: 0 },
          rotationDeg: 0,
          baseElevation: 0,
        },
        {
          id: 'placed-door',
          itemDesignId: 'design-door',
          floorId: 'floor-1',
          translation: { x: 600, y: 0 },
          rotationDeg: 0,
          baseElevation: 0,
        },
      ],
    },
    warningAcknowledgements: [],
  }
}

function scale(values: Record<string, number>): void {
  for (const field of Object.keys(values)) values[field] *= 10
}

/** The same pack saying something else: every millimetre ten times as large. */
function inflated(pack: PresetPack): PresetPack {
  const other = structuredClone(pack)
  for (const entry of other.entries) {
    scale(entry.values)
    for (const alternative of entry.alternatives) scale(alternative.values)
  }
  return other
}

const shipped = (): PresetPack => getPresetPack(PACK_ID)

describe('a placed element', () => {
  it('is a Project the validator accepts', () => {
    const checked = validateProject(projectBuiltFrom(shipped()))
    expect(checked.ok, checked.ok ? '' : checked.problems.map((p) => `${p.path} ${p.message}`).join('; ')).toBe(
      true,
    )
  })

  it('keeps the millimetres it was placed with when the pack changes', () => {
    const project = projectBuiltFrom(shipped())
    const before = canonicalJson(project)
    const floorBefore = canonicalJson(effectiveFloor(project, 1, 'floor-1', null))
    const detailBefore = canonicalJson(effectiveItemDetail(project, 1, 'design-door'))

    const swapped = inflated(shipped())
    expect(thicknessOf(swapped, 'wall.internal')).toBe(1000)
    expect(ceilingOf(swapped)).toBe(26000)

    expect(canonicalJson(project)).toBe(before)
    expect(canonicalJson(effectiveFloor(project, 1, 'floor-1', null))).toBe(floorBefore)
    expect(canonicalJson(effectiveItemDetail(project, 1, 'design-door'))).toBe(detailBefore)
  })

  it('keeps the numbers themselves, not a copy of the same object', () => {
    const project = projectBuiltFrom(shipped())
    const wall = project.itemDesigns.find((design) => design.id === 'design-wall')
    const door = project.itemDesigns.find((design) => design.id === 'design-door')
    expect(wall?.kind === 'generic' && wall.height).toBe(2600)
    expect(door?.kind === 'generic' && door.height).toBe(2100)
    expect(door?.kind === 'generic' && door.footprint.kind === 'preset' && door.footprint.preset).toEqual({
      kind: 'rectangle',
      width: 900,
      depth: 100,
    })
  })

  it('names no pack, row or alternative anywhere in its bytes', () => {
    const bytes = canonicalJson(projectBuiltFrom(shipped()))
    const ids = shipped().entries.flatMap((entry) => [entry.id, ...entry.alternatives.map((alt) => alt.id)])
    expect(ids.length).toBeGreaterThan(15)
    for (const id of [PACK_ID, ...ids]) expect(bytes, `the Project carries ${id}`).not.toContain(id)
  })

  it('would have been a different Project had the pack been read again', () => {
    const before = canonicalJson(projectBuiltFrom(shipped()))
    expect(canonicalJson(projectBuiltFrom(inflated(shipped())))).not.toBe(before)
  })
})

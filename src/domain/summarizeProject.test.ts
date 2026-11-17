/**
 * The Library's derived view of a Project (#45 criterion 6): the counts, the Plan Image
 * hash, the outline rects, and the two properties the Library depends on — the same input
 * always gives the same output, and a Project is never mutated on its way through.
 */
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { canonicalJson } from '../lib'
import { arbProject } from './testing'
import {
  MAX_OUTLINE_RECTS,
  referencedAssetHashes,
  summarizeProject,
  type GenericItemDesign,
  type PlacedItem,
  type Project,
} from './index'

const PLAN_IMAGE_HASH = 'a'.repeat(64)
const OTHER_PLAN_IMAGE_HASH = 'b'.repeat(64)

function genericDesign(id: string, name: string, width: number, depth: number, originX: number, originY: number): GenericItemDesign {
  return {
    id,
    kind: 'generic',
    name,
    footprint: { kind: 'rectangle', width, depth },
    origin: { x: originX, y: originY },
    height: 900,
    heightIsTypical: false,
    color: '#3366cc',
  }
}

function placed(id: string, itemDesignId: string, x: number, y: number, rotationDeg: number, floorId = 'floor-0'): PlacedItem {
  return { id, itemDesignId, floorId, translation: { x, y }, rotationDeg, baseElevation: 0 }
}

/** One Floor with a Plan Image, two centred-origin designs and four Placed Items (#45 criterion 6). */
function projectWithFourPlacements(): Project {
  return {
    id: 'project-1',
    meta: { name: 'Maple Street Kitchen', address: '412 Maple Street' },
    preferences: { displayUnit: 'mm', displayPrecision: 0 },
    floors: [
      {
        id: 'floor-0',
        name: 'Floor 1',
        planImage: {
          assetHash: PLAN_IMAGE_HASH,
          mediaType: 'image/png',
          widthPx: 1024,
          heightPx: 768,
          pixelsPerMm: 0.25,
        },
      },
    ],
    itemDesigns: [
      genericDesign('design-0', 'King Bed', 1820, 1980, 910, 990),
      genericDesign('design-1', 'Runner Rug', 2400, 800, 1200, 400),
    ],
    existingModel: {
      placedItems: [
        placed('place-0', 'design-0', 1200, 400, 0),
        placed('place-1', 'design-1', 2400, 900, 90),
        placed('place-2', 'design-0', 5000, 400, 180),
        placed('place-3', 'design-1', 5000, 3000, 45),
      ],
    },
  }
}

/** The same Project with a second Floor, so siloing can be shown. */
function projectWithTwoFloors(): Project {
  const project = projectWithFourPlacements()
  project.floors.push({
    id: 'floor-1',
    name: 'Floor 2',
    planImage: {
      assetHash: OTHER_PLAN_IMAGE_HASH,
      mediaType: 'image/jpeg',
      widthPx: 512,
      heightPx: 512,
      pixelsPerMm: null,
    },
  })
  project.existingModel.placedItems.push(placed('place-4', 'design-0', 100, 100, 0, 'floor-1'))
  return project
}

describe('summarizeProject (#45 criterion 6)', () => {
  it('summarises one Floor, four Placed Items and a Plan Image', () => {
    const summary = summarizeProject(projectWithFourPlacements())

    expect(summary.floorCount).toBe(1)
    expect(summary.designOptionCount).toBe(0)
    expect(summary.itemCount).toBe(4)
    expect(summary.previewAssetHash).toBe(PLAN_IMAGE_HASH)
    expect(summary.previewOutline.rects).toHaveLength(4)
  })

  it('puts each placement at its Item Origin with the design footprint and rotation', () => {
    const { rects } = summarizeProject(projectWithFourPlacements()).previewOutline
    // Both designs are centred on their Item Origin, so rotation never moves a centre.
    expect(rects).toEqual([
      [1200, 400, 1820, 1980, 0],
      [2400, 900, 2400, 800, 90],
      [5000, 400, 1820, 1980, 180],
      [5000, 3000, 2400, 800, 45],
    ])
  })

  it('frames the rotated footprints', () => {
    const { bounds } = summarizeProject(projectWithFourPlacements()).previewOutline
    // x: the bed's left edge at 1200 − 910; y: the same bed's top at 400 − 990;
    // the 45° rug reaches furthest right and down, by (1200 + 400) · √2⁄2.
    const diagonal = Math.round((1200 + 400) * Math.SQRT1_2 * 1000) / 1000
    expect(bounds).toEqual([290, -590, 5000 + diagonal, 3000 + diagonal])
  })

  it('is pure: the same input twice gives the same output and the input is untouched', () => {
    const project = projectWithTwoFloors()
    const before = canonicalJson(project)

    const first = summarizeProject(project)
    const second = summarizeProject(project)

    expect(second).toEqual(first)
    expect(canonicalJson(second)).toBe(canonicalJson(first))
    expect(canonicalJson(project)).toBe(before)
  })

  it('reads a frozen Project', () => {
    const project = projectWithFourPlacements()
    Object.freeze(project)
    Object.freeze(project.floors)
    Object.freeze(project.existingModel.placedItems)
    for (const item of project.existingModel.placedItems) Object.freeze(item)

    expect(summarizeProject(project).previewOutline.rects).toHaveLength(4)
  })

  it('counts every Floor’s items but draws only the first Floor', () => {
    const summary = summarizeProject(projectWithTwoFloors())
    expect(summary.floorCount).toBe(2)
    expect(summary.itemCount).toBe(5)
    expect(summary.previewOutline.rects).toHaveLength(4)
    // The preview is the first Floor's, whatever the later Floors hold.
    expect(summary.previewAssetHash).toBe(PLAN_IMAGE_HASH)
  })

  it('draws nothing when the first Floor has no placements', () => {
    const project = projectWithTwoFloors()
    project.existingModel.placedItems = project.existingModel.placedItems.filter((item) => item.floorId !== 'floor-0')
    const summary = summarizeProject(project)
    expect(summary.itemCount).toBe(1)
    expect(summary.previewOutline).toEqual({ bounds: [0, 0, 0, 0], rects: [] })
  })

  it('reports no preview for an uncalibrated or missing Plan Image', () => {
    const project = projectWithFourPlacements()
    project.floors[0]!.planImage = null
    expect(summarizeProject(project).previewAssetHash).toBeNull()
    expect(summarizeProject(project).previewOutline.rects).toHaveLength(4)
  })

  it('skips a placement whose Item Design is missing', () => {
    const project = projectWithFourPlacements()
    project.existingModel.placedItems.push(placed('place-4', 'design-gone', 800, 800, 0))
    const summary = summarizeProject(project)
    expect(summary.itemCount).toBe(5)
    expect(summary.previewOutline.rects).toHaveLength(4)
  })

  it('carries at most 200 rects while counting every item', () => {
    const project = projectWithFourPlacements()
    project.existingModel.placedItems = Array.from({ length: MAX_OUTLINE_RECTS + 5 }, (_unused, index) =>
      placed(`place-${index}`, 'design-1', index * 100, index * 100, 0),
    )
    const summary = summarizeProject(project)
    expect(summary.itemCount).toBe(MAX_OUTLINE_RECTS + 5)
    expect(summary.previewOutline.rects).toHaveLength(MAX_OUTLINE_RECTS)
    expect(summary.previewOutline.rects[0]).toEqual([0, 0, 2400, 800, 0])
    expect(summary.previewOutline.rects[MAX_OUTLINE_RECTS - 1]).toEqual([19900, 19900, 2400, 800, 0])
  })

  it('holds for every generated Project: pure, finite, capped, and non-mutating', () => {
    fc.assert(
      fc.property(arbProject(), (project) => {
        const before = canonicalJson(project)
        const first = summarizeProject(project)
        const second = summarizeProject(project)

        expect(canonicalJson(second)).toBe(canonicalJson(first))
        expect(canonicalJson(project)).toBe(before)
        expect(first.designOptionCount).toBe(0)
        expect(first.floorCount).toBe(project.floors.length)
        expect(first.itemCount).toBe(project.existingModel.placedItems.length)
        expect(first.previewOutline.rects.length).toBeLessThanOrEqual(MAX_OUTLINE_RECTS)
        expect(first.previewOutline.rects.every((rect) => rect.every(Number.isFinite))).toBe(true)
        expect(first.previewOutline.bounds.every(Number.isFinite)).toBe(true)
        // The bounds are the frame of the rects, so every centre lies inside it.
        const [minX, minY, maxX, maxY] = first.previewOutline.bounds
        for (const [centreX, centreY] of first.previewOutline.rects) {
          expect(centreX).toBeGreaterThanOrEqual(minX)
          expect(centreX).toBeLessThanOrEqual(maxX)
          expect(centreY).toBeGreaterThanOrEqual(minY)
          expect(centreY).toBeLessThanOrEqual(maxY)
        }
      }),
      { numRuns: 100 },
    )
  })
})

describe('referencedAssetHashes (#45, the mark phase of #46)', () => {
  it('collects every Floor’s Plan Image once', () => {
    expect([...referencedAssetHashes(projectWithFourPlacements())]).toEqual([PLAN_IMAGE_HASH])
    expect([...referencedAssetHashes(projectWithTwoFloors())].sort()).toEqual([PLAN_IMAGE_HASH, OTHER_PLAN_IMAGE_HASH].sort())
  })

  it('is empty when no Floor has a Plan Image', () => {
    const project = projectWithTwoFloors()
    for (const floor of project.floors) floor.planImage = null
    expect(referencedAssetHashes(project).size).toBe(0)
  })

  it('counts a hash shared by two Floors once', () => {
    const project = projectWithTwoFloors()
    project.floors[1]!.planImage = { ...project.floors[1]!.planImage!, assetHash: PLAN_IMAGE_HASH }
    expect([...referencedAssetHashes(project)]).toEqual([PLAN_IMAGE_HASH])
  })

  it('never mutates the Project', () => {
    const project = projectWithTwoFloors()
    const before = canonicalJson(project)
    referencedAssetHashes(project)
    expect(canonicalJson(project)).toBe(before)
  })
})

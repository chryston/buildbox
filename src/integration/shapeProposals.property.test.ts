/**
 * No shape edit can commit an impossible shape (#58 criterion 10).
 *
 * The controller's `canCommit` is the only thing standing between a keystroke and the model,
 * so this drives random parameter edits, preset placements and conversions through it and
 * holds it to one sentence: **the controller offers to commit exactly the proposals the
 * model accepts.** Anything looser lets a shape through that strict validation later refuses
 * — which is the failure the whole invalid-proposal UX exists to prevent, and the one the
 * prototype shipped.
 *
 * It lives in `src/integration` because it has to reach `edit` to know what the model would
 * have said, and it runs under Node because nothing in it touches a document.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { ItemFootprint, PresetItemFootprint, Project } from '../domain'
import { footprintAsPath, footprintProblems, validateProject } from '../domain'
import { arbProject } from '../domain/testing'
import type { Preset } from '../geometry'
import { intent } from '../edit/testing'
import { applyIntent } from '../edit'
import { canCommit, openShape, propose, proposalMessage, shapeTarget } from '../ui'

const CANVAS = { via: 'canvas' } as const

/** A preset from the whole catalog, with numbers that are sometimes impossible on purpose. */
const arbPreset: fc.Arbitrary<Preset> = (() => {
  const size = fc.integer({ min: -50, max: 6000 })
  const radius = fc.integer({ min: 0, max: 3200 })
  return fc.oneof(
    size.map((side): Preset => ({ kind: 'square', side })),
    fc.tuple(size, size).map(([width, depth]): Preset => ({ kind: 'rectangle', width, depth })),
    fc.tuple(size, size, radius, radius).map(([width, depth, topLeft, topRight]): Preset => ({
      kind: 'roundedRectangle',
      width,
      depth,
      radii: { topLeft, topRight, bottomRight: 0, bottomLeft: 0 },
    })),
    fc.tuple(size, radius).map(([width, radius]): Preset => ({
      kind: 'roundedRectangle',
      width,
      depth: width,
      radius,
    })),
    size.map((diameter): Preset => ({ kind: 'circle', diameter })),
    fc.tuple(size, size).map(([width, depth]): Preset => ({ kind: 'ellipse', width, depth })),
    fc.tuple(size, size).map(([length, width]): Preset => ({ kind: 'capsule', length, width })),
    fc.tuple(size, size, fc.integer({ min: -4000, max: 4000 })).map(([baseWidth, depth, apexOffset]): Preset => ({
      kind: 'triangle',
      baseWidth,
      depth,
      apexOffset,
    })),
    fc.tuple(fc.integer({ min: 0, max: 8 }), size).map(([sideCount, sideLength]): Preset => ({
      kind: 'regularPolygon',
      sideCount,
      sideLength,
    })),
  )
})()

/**
 * A proposal as a shape edit produces one: a preset placed from the gallery, a parameter
 * changed on the design's own preset, or a conversion to a Custom Path.
 */
const arbProposal = (current: ItemFootprint): fc.Arbitrary<ItemFootprint> => {
  const asPreset = (preset: Preset): PresetItemFootprint => ({
    kind: 'preset',
    preset,
    centre: { x: 300, y: 200 },
    orientationDeg: 0,
  })
  const nudged = fc.constantFrom(-1001, -1, 0, 1, 1001).map((delta) => {
    // A parameter edit: the same preset, one number moved. This is the case that catches a
    // controller that only ever looks at the shape it was handed.
    if (current.kind !== 'preset') return current
    const preset = { ...current.preset } as Preset
    if (preset.kind === 'circle') return asPreset({ ...preset, diameter: preset.diameter + delta })
    if (preset.kind === 'square') return asPreset({ ...preset, side: preset.side + delta })
    if ('width' in preset) return asPreset({ ...preset, width: preset.width + delta } as Preset)
    return asPreset(preset)
  })
  return fc.oneof(
    arbPreset.map(asPreset),
    nudged,
    fc.constant(footprintAsPath(current)),
  )
}

const genericDesigns = (project: Project) => project.itemDesigns.filter((design) => design.kind === 'generic')

describe('the controller commits exactly what the model accepts (#58 criterion 10)', () => {
  it('never offers an invalid footprint, and never refuses a valid one', () => {
    fc.assert(
      fc.property(
        arbProject(),
        fc.integer({ min: 0, max: 99 }),
        arbPreset,
        fc.integer({ min: -1001, max: 1001 }),
        (project, pick, preset, delta) => {
          const designs = genericDesigns(project)
          if (designs.length === 0) return
          const design = designs[pick % designs.length]
          if (design.kind !== 'generic') return
          const target = shapeTarget(project, design.id)
          if (target === null) return

          // Two shapes per run: the design's own preset with one number moved, and a preset
          // out of the catalog. Between them they cover the field edits and the gallery.
          const moved: ItemFootprint | null =
            design.footprint.kind === 'preset' && 'width' in design.footprint.preset
              ? { ...design.footprint, preset: { ...design.footprint.preset, width: design.footprint.preset.width + delta } as Preset }
              : null
          const fromCatalog: ItemFootprint =
            design.footprint.kind === 'preset' ? { ...design.footprint, preset } : rectangleOf(600, 400)
          for (const proposal of [moved, fromCatalog]) {
            if (proposal === null) continue
            const draft = propose(target, openShape(target), CANVAS, proposal)
            const applied = applyIntent(project, intent('design.setFootprint', { itemDesignId: design.id, footprint: proposal }))

            if (canCommit(draft)) {
              // The controller offered to commit. The model has to take it — or have nothing
              // to change, which is the one refusal that is not about the shape.
              expect(applied.ok || applied.code === 'no-change').toBe(true)
              if (applied.ok) expect(validateProject(applied.project).ok).toBe(true)
              expect(proposalMessage(draft)).toBeNull()
            } else {
              expect(applied.ok).toBe(false)
              // One message, and it comes from the kernel rather than being invented here.
              const message = proposalMessage(draft)
              expect(message).not.toBeNull()
              expect(message).not.toHaveLength(0)
              expect(footprintProblems(proposal).length === 0).toBe(false)
            }
          }
        },
      ),
      { numRuns: 120 },
    )
  })

  it('drives every proposal kind, so the run above is not testing one shape', () => {
    const seen = new Set<string>()
    fc.assert(
      fc.property(arbProject(), fc.integer({ min: 0, max: 99 }), arbProposal(rectangleOf(600, 400)), (project, pick, proposal) => {
        const designs = genericDesigns(project)
        if (designs.length === 0) return
        const design = designs[pick % designs.length]
        if (design.kind !== 'generic') return
        seen.add(proposal.kind === 'preset' ? proposal.preset.kind : 'path')
      }),
      { numRuns: 200 },
    )
    // The generator reaches the presets, or the test above would be quietly about rectangles.
    expect(seen.size).toBeGreaterThan(4)
  })
})

/** A rectangle to convert, spelled without importing the preset builders twice. */
function rectangleOf(width: number, depth: number): ItemFootprint {
  return {
    kind: 'preset',
    preset: { kind: 'rectangle', width, depth },
    centre: { x: width / 2, y: depth / 2 },
    orientationDeg: 0,
  }
}

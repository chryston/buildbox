/**
 * Two things that must hold for every drawing, not for the ones someone thought to write a test for
 * (#61 criterion 15, and the fit block's promise).
 *
 * `fast-check` generates the inputs; the assertions are the ones a user would notice breaking —
 * the same recipe run twice gives the same bytes, and a sheet that says it fits really does.
 */
import { readFileSync } from 'node:fs'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { basicProject } from '../derive/testing'
import type { Rect } from '../derive'
import { fitCheck, pngSize, sheetOf } from './fit'
import { exportFiles } from './index'
import type { ExportDeps, Recipe } from './types'

const depsFor = (instant: Date): ExportDeps => ({
  clock: {
    now: () => instant.toISOString(),
    localDate: () => instant.toISOString().slice(0, 10),
  },
  buildboxVersion: '0.0.0-test',
  font: {
    bytes: new Uint8Array(
      readFileSync(new URL('../assets/fonts/NotoSans-Latin1.ttf', import.meta.url)),
    ),
  },
  assets: async () => null,
})

const project = basicProject()
const planViewIds = project.views.filter((one) => one.kind === 'plan').map((one) => one.id)
const designIds = project.itemDesigns.map((one) => one.id)

/** A recipe the dialog could have produced, minus PNG: this project has no canvas to rasterise on. */
const recipeArb: fc.Arbitrary<Recipe> = fc.record({
  viewCount: fc.integer({ min: 1, max: 3 }),
  useItemDetail: fc.boolean(),
  format: fc.constantFrom('svg' as const, 'pdf' as const),
  pageSize: fc.constantFrom('A4' as const, 'A3' as const),
  orientation: fc.constantFrom('auto' as const, 'portrait' as const, 'landscape' as const),
  scale: fc.oneof(
    fc.constant('fit' as const),
    fc.constantFrom(10 as const, 20 as const, 50 as const, 100 as const),
  ),
  titleBlock: fc.boolean(),
  grid: fc.boolean(),
  unit: fc.constantFrom('mm' as const, 'cm' as const, 'm' as const),
  precision: fc.integer({ min: 0, max: 2 }),
}).map((one) => ({
  views: Array.from({ length: one.viewCount }, (_, index) =>
    one.useItemDetail && index % 2 === 1
      ? { kind: 'item-detail' as const, itemDesignId: designIds[index % designIds.length]! }
      : { kind: 'plan' as const, viewId: planViewIds[index % planViewIds.length]! },
  ),
  format: one.format,
  pageSize: one.pageSize,
  orientation: one.orientation,
  scale: one.scale,
  pngLongEdge: 2048,
  titleBlock: one.titleBlock,
  grid: one.grid,
  unit: one.unit,
  precision: one.precision,
}))

describe('the export module under generated inputs', () => {
  it('writes the same bytes for the same recipe, however the clock reads', async () => {
    await fc.assert(
      fc.asyncProperty(
        recipeArb,
        fc.date({ min: new Date('2020-01-01T00:00:00.000Z'), max: new Date('2038-01-01T00:00:00.000Z') }),
        async (recipe, instant) => {
          const snapshot = { project, revision: 7 }
          const deps = depsFor(instant)
          const first = await exportFiles(snapshot, recipe, deps)
          const second = await exportFiles(snapshot, recipe, deps)
          expect(second.ok).toBe(first.ok)
          if (!first.ok || !second.ok) return
          expect(second.kind).toBe(first.kind)
          if (first.kind === 'single' && second.kind === 'single') {
            expect(second.file.name).toBe(first.file.name)
            expect(Buffer.from(second.file.bytes).equals(Buffer.from(first.file.bytes))).toBe(true)
          }
        },
      ),
      { numRuns: 24 },
    )
  })

  it('never writes a timestamp that is not the one it was given', async () => {
    // The clock is the only thing allowed to move between two runs, so the only bytes allowed to
    // differ are the ones that carry it.
    await fc.assert(
      fc.asyncProperty(recipeArb, async (recipe) => {
        const snapshot = { project, revision: 7 }
        const morning = await exportFiles(snapshot, recipe, depsFor(new Date('2026-03-04T09:30:00.000Z')))
        const evening = await exportFiles(snapshot, recipe, depsFor(new Date('2026-03-04T21:45:00.000Z')))
        if (!morning.ok || evening.ok !== true || morning.kind !== 'single' || evening.kind !== 'single') return
        expect(evening.file.name).toBe(morning.file.name)
        if (recipe.format !== 'svg') return
        const strip = (bytes: Uint8Array): string =>
          new TextDecoder()
            .decode(bytes)
            .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/g, '<instant>')
            .replace(/\d{4}-\d{2}-\d{2}/g, '<date>')
        expect(strip(evening.file.bytes)).toBe(strip(morning.file.bytes))
      }),
      { numRuns: 12 },
    )
  })
})

describe('the fit check under generated drawings', () => {
  const boundsArb: fc.Arbitrary<Rect> = fc
    .record({
      x: fc.double({ min: -50_000, max: 50_000, noNaN: true }),
      y: fc.double({ min: -50_000, max: 50_000, noNaN: true }),
      w: fc.double({ min: 0, max: 40_000, noNaN: true }),
      h: fc.double({ min: 0, max: 40_000, noNaN: true }),
    })
    .filter((one) => Number.isFinite(one.x + one.y + one.w + one.h))

  it('says "fits" only when the scaled drawing is inside the printable area', () => {
    fc.assert(
      fc.property(
        boundsArb,
        fc.constantFrom('A4' as const, 'A3' as const),
        fc.constantFrom('portrait' as const, 'landscape' as const),
        fc.oneof(fc.constant('fit' as const), fc.constantFrom(10, 20, 50, 100)),
        (bounds, page, orientation, scale) => {
          const result = fitCheck(bounds, page, orientation, scale)
          if (scale === 'fit') {
            // `fit` is chosen from the drawing, so it always fits — and never needs a suggestion.
            expect(result.fits).toBe(true)
            expect(result.suggestions).toEqual([])
            return
          }
          // The check is made against the sheet with its title block reserved, because that is the
          // sheet the dialog will almost certainly print.
          const content = sheetOf(page, orientation, { titleBlock: true }).content
          expect(result.fits).toBe(
            bounds.w / scale <= content.w + 1e-9 && bounds.h / scale <= content.h + 1e-9,
          )
        },
      ),
      { numRuns: 400 },
    )
  })

  it('offers a way to fit whenever it refuses', () => {
    fc.assert(
      fc.property(
        boundsArb,
        fc.constantFrom('A4' as const, 'A3' as const),
        fc.constantFrom('portrait' as const, 'landscape' as const),
        fc.constantFrom(10, 20, 50, 100),
        (bounds, page, orientation, scale) => {
          const result = fitCheck(bounds, page, orientation, scale)
          if (result.fits) return
          expect(result.suggestions.length).toBeGreaterThan(0)
          for (const one of result.suggestions) {
            if (one.scale === 'fit') continue
            const content = sheetOf(one.page, one.orientation, { titleBlock: true }).content
            expect(bounds.w / one.scale).toBeLessThanOrEqual(content.w + 1e-9)
            expect(bounds.h / one.scale).toBeLessThanOrEqual(content.h + 1e-9)
          }
        },
      ),
      { numRuns: 400 },
    )
  })
})

describe('the PNG size under generated sheets', () => {
  it('never asks for more pixels than a PNG can hold (#61 criterion 3)', () => {
    // Whatever the sheet's shape, the long edge is the size that was chosen and the total stays
    // inside the ceiling a browser will still decode. A 100 m wall on A4 is not a special case.
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 500_000, noNaN: true }),
        fc.double({ min: 1, max: 500_000, noNaN: true }),
        fc.constantFrom(2048, 4096),
        (widthMm, heightMm, longEdge) => {
          const size = pngSize(widthMm, heightMm, longEdge)
          expect(Math.max(size.widthPx, size.heightPx)).toBe(longEdge)
          expect(size.widthPx * size.heightPx).toBeLessThanOrEqual(16_777_216)
        },
      ),
      { numRuns: 500 },
    )
  })
})

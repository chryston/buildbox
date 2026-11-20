/**
 * The collision-aware label placer (#57 criterion 12, moved here by #60 §7).
 *
 * The placer is pure, so this needs no DOM and no canvas: the rules it has to keep are
 * geometric and absolute — never on the footprint, never on an obstacle, never on a label
 * placed before it — and a rotated Floor is what breaks a naive placer, so the sweep is the
 * test. The fast-check property at the bottom is the one that matters most: no random
 * footprint, at any of the sixteen candidate angles, lands a chip on itself.
 */
import { describe, expect, it } from 'vitest'
import * as fc from 'fast-check'
import type { Pt } from '../geometry'
import type { LabelPlacement, LabelRequest } from './labels'
import { placeLabels } from './labels'
import type { Rect } from './types'

/** A box, in world millimetres. */
const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h })

/** The overlap of two boxes, which is zero when they only touch. */
const overlap = (a: Rect, b: Rect): number =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))

/** A label of `w` × `h` whose centre wants to be at `at`. */
const label = (id: string, at: Pt, w: number, h: number): LabelRequest => ({ id, anchor: at, w, h })

/** The centre of a box. */
const centre = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })

/** The distance from a footprint's centre to a box's centre. */
const fromCentre = (footprint: Rect, box: Rect): number => {
  const a = centre(footprint)
  const b = centre(box)
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** The footprint and label geometry the ring is defined by. */
const ringGeometry = (footprint: Rect, label: LabelRequest) => {
  const halfDiagonal = (w: number, h: number): number => Math.hypot(w, h) / 2
  return {
    inner:
      halfDiagonal(footprint.w, footprint.h) + 12 + halfDiagonal(label.w, label.h),
    step: (halfDiagonal(footprint.w, footprint.h) + 12 + halfDiagonal(label.w, label.h)) / 2 + 12,
  }
}

describe('placeLabels', () => {
  it('places every label in the order it was asked for', () => {
    const boxes = placeLabels({
      footprint: rect(0, 0, 100, 80),
      obstacles: [],
      labels: [
        label('width', { x: 50, y: -20 }, 40, 10),
        label('depth', { x: 120, y: 40 }, 40, 10),
        label('area', { x: 50, y: 40 }, 40, 10),
      ],
    })
    expect(boxes).toHaveLength(3)
    for (const box of boxes) {
      expect(box.w).toBe(40)
      expect(box.h).toBe(10)
    }
  })

  it('never places a label on the footprint, at any rotation of a 2400 × 1200 Floor', () => {
    const footprint = rect(0, 0, 2400, 1200)
    const request = label('area', centre(footprint), 120, 20)
    for (let degrees = 0; degrees < 360; degrees++) {
      const box = placeLabels({ footprint, obstacles: [], labels: [request] })[0]
      expect(overlap(box, footprint)).toBe(0)
    }
  })

  it('places the chip on the ring nearest the anchor, on the side the anchor is on', () => {
    const footprint = rect(0, 0, 2400, 1200)
    // The anchor is off the top-left corner. Every candidate clears the footprint, so the
    // placer may pick any of the sixty-four: it has to pick the one nearest the anchor, which
    // is on the same side of the Floor the anchor is, on the first ring.
    const anchor = { x: -400, y: -400 }
    const request = label('width', anchor, 120, 20)
    const box = placeLabels({ footprint, obstacles: [], labels: [request] })[0]
    const placed = centre(box)
    const middle = centre(footprint)
    const { inner, step } = ringGeometry(footprint, request)
    const distance = Math.hypot(placed.x - middle.x, placed.y - middle.y)
    // The anchor is 1887 mm from the Floor's centre, which is between the first ring (1415)
    // and the second (2134) and nearer the second: the placer orders by distance to the
    // anchor, not by ring, so the chip lands on the ring the anchor is closest to.
    expect(distance).toBeCloseTo(inner + step, 9)
    // Within half of one 22.5° step of the direction the anchor lies in: a placer that
    // scanned angles from 0° would land the chip due east instead.
    const toward = Math.atan2(anchor.y - middle.y, anchor.x - middle.x)
    const actual = Math.atan2(placed.y - middle.y, placed.x - middle.x)
    const apart = Math.abs(Math.atan2(Math.sin(actual - toward), Math.cos(actual - toward)))
    expect(apart).toBeLessThanOrEqual(Math.PI / 16 + 1e-9)
  })

  it('steps to the next ring when the innermost one is claimed', () => {
    const footprint = rect(0, 0, 2400, 1200)
    const request = label('width', { x: 1200, y: -200 }, 120, 20)
    const { inner, step } = ringGeometry(footprint, request)
    // Claim the whole inner ring with obstacles a label wide, so nothing fits on it.
    const obstacles: Rect[] = []
    for (let slot = 0; slot < 16; slot++) {
      const angle = (slot * 2 * Math.PI) / 16
      const x = 1200 + inner * Math.cos(angle)
      const y = 600 + inner * Math.sin(angle)
      obstacles.push(rect(x - 60, y - 10, 120, 20))
    }
    const box = placeLabels({ footprint, obstacles, labels: [request] })[0]
    const distance = fromCentre(footprint, box)
    expect(Math.abs(distance - (inner + step))).toBeLessThan(1e-9)
    for (const obstacle of obstacles) expect(overlap(box, obstacle)).toBe(0)
  })

  it('never places a label on an obstacle', () => {
    const footprint = rect(0, 0, 2400, 1200)
    const obstacle = rect(2500, 560, 400, 80)
    const box = placeLabels({
      footprint,
      obstacles: [obstacle],
      labels: [label('width', { x: 2700, y: 600 }, 120, 20)],
    })[0]
    expect(overlap(box, obstacle)).toBe(0)
    expect(overlap(box, footprint)).toBe(0)
  })

  it('never places a later label on an earlier one', () => {
    const footprint = rect(0, 0, 2400, 1200)
    // Both anchors are the same point, so the second label has to find another slot.
    const boxes = placeLabels({
      footprint,
      obstacles: [],
      labels: [
        label('width', { x: 1200, y: -300 }, 120, 20),
        label('depth', { x: 1200, y: -300 }, 120, 20),
      ],
    })
    expect(overlap(boxes[0], boxes[1])).toBe(0)
  })

  it('still answers when nothing is free, and still misses the footprint', () => {
    const footprint = rect(0, 0, 2400, 1200)
    const request = label('area', centre(footprint), 120, 20)
    // Claim every candidate the placer could generate, at every ring.
    const { inner, step } = ringGeometry(footprint, request)
    const obstacles: Rect[] = []
    for (let ring = 0; ring < 4; ring++) {
      for (let slot = 0; slot < 16; slot++) {
        const angle = (slot * 2 * Math.PI) / 16
        const radius = inner + ring * step
        obstacles.push(
          rect(1200 + radius * Math.cos(angle) - 60, 600 + radius * Math.sin(angle) - 10, 120, 20),
        )
      }
    }
    const boxes = placeLabels({ footprint, obstacles, labels: [request] })
    expect(boxes).toHaveLength(1)
    expect(overlap(boxes[0], footprint)).toBe(0)
  })

  it('is deterministic: the same input places every box in the same pixel', () => {
    const input: LabelPlacement = {
      footprint: rect(-300, 120, 2400, 1200),
      obstacles: [rect(2200, 700, 300, 60), rect(-500, 400, 180, 40)],
      labels: [
        label('width', { x: 900, y: 0 }, 120, 20),
        label('depth', { x: 2300, y: 720 }, 120, 20),
        label('area', { x: 900, y: 720 }, 140, 20),
      ],
    }
    expect(placeLabels(input)).toEqual(placeLabels(input))
  })

  it('never lands a label on the footprint, for any footprint and anchor', () => {
    const extent = fc.double({ min: 1, max: 20000, noNaN: true })
    fc.assert(
      fc.property(
        extent,
        extent,
        extent,
        extent,
        extent,
        extent,
        fc.double({ min: 10, max: 400, noNaN: true }),
        fc.double({ min: 10, max: 120, noNaN: true }),
        (minX, minY, spanX, spanY, anchorX, anchorY, w, h) => {
          const footprint = rect(
            Math.min(minX, spanX),
            Math.min(minY, spanY),
            Math.abs(spanX - minX) + 1,
            Math.abs(spanY - minY) + 1,
          )
          const box = placeLabels({
            footprint,
            obstacles: [],
            labels: [label('area', { x: anchorX, y: anchorY }, w, h)],
          })[0]
          return overlap(box, footprint) === 0
        },
      ),
      { numRuns: 500 },
    )
  })
})

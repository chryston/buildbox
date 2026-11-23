/**
 * The collision-aware label placer (#57 criterion 12, moved here by #60 §7; #74 §3).
 *
 * The placer is pure, so this needs no DOM and no canvas: the rules it has to keep are geometric
 * and absolute — never on the entity it labels, never on an obstacle, never on a label placed
 * before it — and a rotated Floor is what breaks a naive placer, so the sweep is the test. The
 * fast-check property at the bottom is the one that matters most: no random entity, at any of the
 * sixteen candidate angles, lands a chip on itself.
 *
 * #74 §3 added the two answers a caller has to be able to tell apart: a label that moved, and a
 * label that had nowhere to go and is therefore not drawn at all.
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

/** A label of `w` × `h` whose centre wants to be at `at`, naming `entity`. */
const label = (id: string, at: Pt, w: number, h: number, entity: Rect): LabelRequest =>
  ({ id, anchor: at, w, h, entity })

/** The one box of a frame that has room, or a failure — these frames all have room. */
const placed = (input: LabelPlacement): Rect => {
  const box = placeLabels(input)[0]
  if (box === null) throw new Error('nowhere to put a label that had room')
  return box
}

/** The centre of a box. */
const centre = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })

/** The distance from an entity's centre to a box's centre. */
const fromCentre = (entity: Rect, box: Rect): number => {
  const a = centre(entity)
  const b = centre(box)
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** The entity and label geometry the ring is defined by. */
const ringGeometry = (entity: Rect, label: LabelRequest) => {
  const halfDiagonal = (w: number, h: number): number => Math.hypot(w, h) / 2
  return {
    inner:
      halfDiagonal(entity.w, entity.h) + 12 + halfDiagonal(label.w, label.h),
    step: (halfDiagonal(entity.w, entity.h) + 12 + halfDiagonal(label.w, label.h)) / 2 + 12,
  }
}

describe('placeLabels', () => {
  it('places every label in the order it was asked for', () => {
    const boxes = placeLabels({
      obstacles: [],
      labels: [
        label('width', { x: 50, y: -20 }, 40, 10, rect(0, 0, 100, 80)),
        label('depth', { x: 120, y: 40 }, 40, 10, rect(0, 0, 100, 80)),
        label('area', { x: 50, y: 40 }, 40, 10, rect(0, 0, 100, 80)),
      ],
    })
    expect(boxes).toHaveLength(3)
    for (const box of boxes) {
      expect(box?.w).toBe(40)
      expect(box?.h).toBe(10)
    }
  })

  it('never places a label on the entity, at any rotation of a 2400 × 1200 Floor', () => {
    const entity = rect(0, 0, 2400, 1200)
    const request = label('area', centre(entity), 120, 20, entity)
    for (let degrees = 0; degrees < 360; degrees++) {
      const box = placed({ obstacles: [], labels: [request] })
      expect(overlap(box, entity)).toBe(0)
    }
  })

  it('places the chip on the ring nearest the anchor, on the side the anchor is on', () => {
    const entity = rect(0, 0, 2400, 1200)
    // The anchor is off the top-left corner. Every candidate clears the entity, so the
    // placer may pick any of the sixty-four: it has to pick the one nearest the anchor, which
    // is on the same side of the Floor the anchor is, on the first ring.
    const anchor = { x: -400, y: -400 }
    const request = label('width', anchor, 120, 20, entity)
    const box = placed({ obstacles: [], labels: [request] })
    const at = centre(box)
    const middle = centre(entity)
    const { inner, step } = ringGeometry(entity, request)
    const distance = Math.hypot(at.x - middle.x, at.y - middle.y)
    // The anchor is 1887 mm from the Floor's centre, which is between the first ring (1415)
    // and the second (2134) and nearer the second: the placer orders by distance to the
    // anchor, not by ring, so the chip lands on the ring the anchor is closest to.
    expect(distance).toBeCloseTo(inner + step, 9)
    // Within half of one 22.5° step of the direction the anchor lies in: a placer that
    // scanned angles from 0° would land the chip due east instead.
    const toward = Math.atan2(anchor.y - middle.y, anchor.x - middle.x)
    const actual = Math.atan2(at.y - middle.y, at.x - middle.x)
    const apart = Math.abs(Math.atan2(Math.sin(actual - toward), Math.cos(actual - toward)))
    expect(apart).toBeLessThanOrEqual(Math.PI / 16 + 1e-9)
  })

  it('steps to the next ring when the innermost one is claimed', () => {
    const entity = rect(0, 0, 2400, 1200)
    const request = label('width', { x: 1200, y: -200 }, 120, 20, entity)
    const { inner, step } = ringGeometry(entity, request)
    // Claim the whole inner ring with obstacles a label wide, so nothing fits on it.
    const obstacles: Rect[] = []
    for (let slot = 0; slot < 16; slot++) {
      const angle = (slot * 2 * Math.PI) / 16
      const x = 1200 + inner * Math.cos(angle)
      const y = 600 + inner * Math.sin(angle)
      obstacles.push(rect(x - 60, y - 10, 120, 20))
    }
    const box = placed({ obstacles, labels: [request] })
    const distance = fromCentre(entity, box)
    expect(Math.abs(distance - (inner + step))).toBeLessThan(1e-9)
    for (const obstacle of obstacles) expect(overlap(box, obstacle)).toBe(0)
  })

  it('never places a label on an obstacle', () => {
    const entity = rect(0, 0, 2400, 1200)
    const obstacle = rect(2500, 560, 400, 80)
    const box = placed({
      obstacles: [obstacle],
      labels: [label('width', { x: 2700, y: 600 }, 120, 20, entity)],
    })
    expect(overlap(box, obstacle)).toBe(0)
    expect(overlap(box, entity)).toBe(0)
  })

  it('never places a later label on an earlier one', () => {
    const entity = rect(0, 0, 2400, 1200)
    // Both anchors are the same point, so the second label has to find another slot.
    const boxes = placeLabels({
      obstacles: [],
      labels: [
        label('width', { x: 1200, y: -300 }, 120, 20, entity),
        label('depth', { x: 1200, y: -300 }, 120, 20, entity),
      ],
    })
    expect(overlap(boxes[0]!, boxes[1]!)).toBe(0)
  })

  it('clears each label\'s own entity rather than one shared box', () => {
    // Two cabinets side by side: each name rings around its own box, so neither is confined to
    // a ring drawn around the pair — which is what one shared footprint used to mean.
    const left = rect(0, 0, 600, 600)
    const right = rect(700, 0, 600, 600)
    const boxes = placeLabels({
      obstacles: [],
      labels: [
        label('a', centre(left), 120, 20, left),
        label('b', centre(right), 120, 20, right),
      ],
    })
    expect(overlap(boxes[0]!, left)).toBe(0)
    expect(overlap(boxes[1]!, right)).toBe(0)
    expect(overlap(boxes[0]!, boxes[1]!)).toBe(0)
  })

  it('keeps an at-home label on its entity while the box is free', () => {
    const entity = rect(0, 0, 600, 600)
    const request = { ...label('a', centre(entity), 120, 20, entity), atHome: true }
    const box = placed({ obstacles: [], labels: [request] })
    // The default position is the thing itself: an Item's name sits on the Item.
    expect(box).toEqual(rect(centre(entity).x - 60, centre(entity).y - 10, 120, 20))
    expect(overlap(box, entity)).toBeGreaterThan(0)
  })

  it('moves an at-home label to the face of its entity when the box is taken', () => {
    const entity = rect(0, 0, 600, 600)
    const home = rect(240, 290, 120, 20)
    const request = { ...label('a', centre(entity), 120, 20, entity), atHome: true }
    const boxes = placeLabels({ obstacles: [], labels: [request, request] })
    // #74 §3: the default position is given up to the name already there, and the later one moves
    // to the next candidate along its own entity — the face of it, not the ring a whole diagonal
    // out, which would leave a metre of blank floor between a word and what it means.
    expect(boxes[0]).toEqual(home)
    expect(boxes[1]).toEqual(rect(240, 612, 120, 20))
    expect(overlap(boxes[1]!, entity)).toBe(0)
  })

  it('omits a label when nothing is free', () => {
    const entity = rect(0, 0, 2400, 1200)
    const request = label('area', centre(entity), 120, 20, entity)
    // Claim every candidate the placer could generate, at every ring.
    const { inner, step } = ringGeometry(entity, request)
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
    // #74 §3: a name written over another name reads as neither, so it is left out and shown
    // on hover instead — the caller is told which ones, and draws nothing for them.
    expect(placeLabels({ obstacles, labels: [request] })).toEqual([null])
  })

  it('is deterministic: the same input places every box in the same pixel', () => {
    const input: LabelPlacement = {
      obstacles: [rect(2200, 700, 300, 60), rect(-500, 400, 180, 40)],
      labels: [
        label('width', { x: 900, y: 0 }, 120, 20, rect(-300, 120, 2400, 1200)),
        label('depth', { x: 2300, y: 720 }, 120, 20, rect(-300, 120, 2400, 1200)),
        label('area', { x: 900, y: 720 }, 140, 20, rect(-300, 120, 2400, 1200)),
      ],
    }
    expect(placeLabels(input)).toEqual(placeLabels(input))
  })

  it('never lands a label on the entity, for any entity and anchor', () => {
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
          const entity = rect(
            Math.min(minX, spanX),
            Math.min(minY, spanY),
            Math.abs(spanX - minX) + 1,
            Math.abs(spanY - minY) + 1,
          )
          const box = placeLabels({
            obstacles: [],
            labels: [label('area', { x: anchorX, y: anchorY }, w, h, entity)],
          })[0]
          // An omitted label is drawn nowhere, so it cannot be on the entity either.
          return box === null || overlap(box, entity) === 0
        },
      ),
      { numRuns: 500 },
    )
  })
})

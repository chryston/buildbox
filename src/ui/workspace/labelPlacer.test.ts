/**
 * What #57 criterion 12 promises about the Plan View's chips: whatever angle the Floor is
 * turned to, the `Floor bounds` text sits beside the Floor and not on it, clear of the
 * dimension texts and of the other chips.
 *
 * The rotations below are walked with plain arithmetic rather than by importing `geometry`,
 * both because `ui` may not reach that module and because a second, independent way of
 * getting the rotated box is what makes the placer's own assumptions visible.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { LabelPlacement, LabelRequest, Point, Rect } from './labelPlacer'
import { placeLabels } from './labelPlacer'

// --- The maths, restated ------------------------------------------------------

/** The area two boxes share; zero when they only touch, which is allowed. */
const overlapArea = (a: Rect, b: Rect): number =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))

const centre = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)

/** The same box grown `by` millimetres on every side. */
const inflate = (r: Rect, by: number): Rect => ({
  x: r.x - by,
  y: r.y - by,
  w: r.w + 2 * by,
  h: r.h + 2 * by,
})

/** The axis-aligned box that covers a `w × h` rectangle turned `deg` about its centre. */
const rotatedAabb = (c: Point, w: number, h: number, deg: number): Rect => {
  const rad = (deg * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  const halfW = (w * cos + h * sin) / 2
  const halfH = (w * sin + h * cos) / 2
  return { x: c.x - halfW, y: c.y - halfH, w: halfW * 2, h: halfH * 2 }
}

// --- The candidate ring, restated --------------------------------------------

/** Slots per ring and rings per label, as #57 documents them. */
const SLOTS = 16
const RINGS = 4

/** The box a `w × h` label takes in slot `slot` of `radius`. */
const slotBox = (c: Point, radius: number, slot: number, w: number, h: number): Rect => {
  const angle = (slot * 2 * Math.PI) / SLOTS
  return { x: c.x + radius * Math.cos(angle) - w / 2, y: c.y + radius * Math.sin(angle) - h / 2, w, h }
}

/**
 * Where the rings sit, pinned from the placer's own answers rather than repeated as
 * constants: a label anchored at the footprint's centre is equidistant from a whole ring, so
 * it takes slot 0 of the innermost one, and with that ring claimed it takes slot 0 of the
 * next. Those two radii are the sequence every other candidate comes from.
 */
function ringGeometry(footprint: Rect, label: LabelRequest): { inner: number; step: number } {
  const c = centre(footprint)
  const centred: LabelRequest = { ...label, anchor: c }
  const [probe] = placeLabels({ footprint, obstacles: [], labels: [centred] })
  const inner = distance(centre(probe), c)
  const claimed = Array.from({ length: SLOTS }, (_, slot) => slotBox(c, inner, slot, label.w, label.h))
  const [next] = placeLabels({ footprint, obstacles: claimed, labels: [centred] })
  return { inner, step: distance(centre(next), c) - inner }
}

/** Every candidate the strategy offers one label, nearest its anchor first. */
function candidates(footprint: Rect, label: LabelRequest): Rect[] {
  const c = centre(footprint)
  const { inner, step } = ringGeometry(footprint, label)
  const all: { box: Rect; slot: number; radius: number }[] = []
  for (let ring = 0; ring < RINGS; ring++) {
    const radius = inner + ring * step
    for (let slot = 0; slot < SLOTS; slot++) {
      all.push({ box: slotBox(c, radius, slot, label.w, label.h), slot, radius })
    }
  }
  return all
    .sort(
      (a, b) =>
        distance(centre(a.box), label.anchor) - distance(centre(b.box), label.anchor) ||
        a.slot - b.slot ||
        a.radius - b.radius,
    )
    .map((candidate) => candidate.box)
}

/** The box the placer owes one label: the nearest candidate nothing else has claimed. */
function nearestFree(footprint: Rect, obstacles: readonly Rect[], label: LabelRequest): Rect {
  const free = candidates(footprint, label).find(
    (box) => overlapArea(box, footprint) === 0 && obstacles.every((o) => overlapArea(box, o) === 0),
  )
  if (free === undefined) throw new Error('the ring offered no free candidate')
  return free
}

/** Two boxes in one place, allowing for the last of the float dust on the radius. */
function expectSamePlacement(actual: Rect, expected: Rect): void {
  expect(centre(actual).x).toBeCloseTo(centre(expected).x, 6)
  expect(centre(actual).y).toBeCloseTo(centre(expected).y, 6)
  expect([actual.w, actual.h]).toEqual([expected.w, expected.h])
}

// --- The basics ---------------------------------------------------------------

describe('placeLabels', () => {
  it('places nothing when there is nothing to place', () => {
    expect(placeLabels({ footprint: { x: 0, y: 0, w: 600, h: 400 }, obstacles: [], labels: [] })).toEqual([])
  })

  it('keeps one box per label, at the size it was asked for', () => {
    const boxes = placeLabels({
      footprint: { x: 1000, y: 1000, w: 600, h: 400 },
      obstacles: [],
      labels: [
        { id: 'width', anchor: { x: 1300, y: 1200 }, w: 90, h: 20 },
        { id: 'depth', anchor: { x: 1300, y: 1200 }, w: 70, h: 24 },
      ],
    })
    expect(boxes).toHaveLength(2)
    expect(boxes.map((b) => [b.w, b.h])).toEqual([[90, 20], [70, 24]])
  })

  it('takes the nearest free candidate, and only the next one when it is claimed', () => {
    const footprint: Rect = { x: 1000, y: 1000, w: 600, h: 400 }
    const chip: LabelRequest = { id: 'floor-bounds', anchor: { x: 1420, y: 1130 }, w: 90, h: 20 }
    const input: LabelPlacement = { footprint, obstacles: [], labels: [chip] }

    const [first] = placeLabels(input)
    expectSamePlacement(first, nearestFree(footprint, [], chip))
    expect(overlapArea(first, footprint)).toBe(0)

    // Claim that box and the label moves outward rather than staying put or overlapping.
    const blocked = inflate(first, 1)
    const [second] = placeLabels({ ...input, obstacles: [blocked] })
    expectSamePlacement(second, nearestFree(footprint, [blocked], chip))
    expect(overlapArea(second, blocked)).toBe(0)
    expect(distance(centre(second), chip.anchor)).toBeGreaterThan(distance(centre(first), chip.anchor))

    // An anchor far from the Floor pulls the chip out to the ring that can reach it.
    const far: LabelRequest = { ...chip, anchor: { x: 2300, y: 1200 } }
    const [outward] = placeLabels({ ...input, labels: [far] })
    expectSamePlacement(outward, nearestFree(footprint, [], far))
    expect(distance(centre(outward), centre(footprint))).toBeGreaterThan(distance(centre(first), centre(footprint)))
  })

  it('never lets two labels share area', () => {
    const footprint: Rect = { x: 500, y: 400, w: 600, h: 400 }
    const anchor = { x: 800, y: 600 }
    const [width, depth] = placeLabels({
      footprint,
      obstacles: [],
      labels: [
        { id: 'width', anchor, w: 90, h: 20 },
        { id: 'depth', anchor, w: 90, h: 20 },
      ],
    })
    expect(overlapArea(width, depth)).toBe(0)
    expect(overlapArea(width, footprint)).toBe(0)
    expect(overlapArea(depth, footprint)).toBe(0)
  })

  it('still clears the footprint when every candidate is buried in an obstacle', () => {
    const footprint: Rect = { x: 0, y: 0, w: 600, h: 400 }
    // No candidate can be free, so the least-intruding one is returned instead of nothing.
    const everywhere: Rect = { x: -10_000, y: -10_000, w: 40_000, h: 40_000 }
    const [box] = placeLabels({
      footprint,
      obstacles: [everywhere],
      labels: [{ id: 'floor-bounds', anchor: { x: 300, y: 200 }, w: 90, h: 20 }],
    })
    expect(overlapArea(box, footprint)).toBe(0)
    // The fallback really was taken: a free candidate would have zero overlap here.
    expect(overlapArea(box, everywhere)).toBeGreaterThan(0)
  })
})

// --- #57 criterion 12: every rotation ----------------------------------------

describe('placeLabels at every rotation (#57 criterion 12)', () => {
  const CENTRE: Point = { x: 2000, y: 1700 }
  const chip = { id: 'floor-bounds', anchor: CENTRE, w: 90, h: 20 }
  const depth = { id: 'depth', anchor: CENTRE, w: 70, h: 20 }

  it('keeps the Floor bounds chip off the Floor, the dimension text and the other chip', () => {
    for (let deg = 0; deg < 360; deg++) {
      const footprint = rotatedAabb(CENTRE, 600, 400, deg)
      // The width dimension text rides under the rotated box, so it turns with the Floor.
      const obstacle: Rect = { x: CENTRE.x - 60, y: footprint.y + footprint.h + 30, w: 120, h: 18 }
      const [box, other] = placeLabels({ footprint, obstacles: [obstacle], labels: [chip, depth] })

      expect(overlapArea(box, footprint), `chip covers the Floor at ${deg}°`).toBe(0)
      expect(overlapArea(box, obstacle), `chip covers the dimension text at ${deg}°`).toBe(0)
      expect(overlapArea(box, other), `the two chips overlap at ${deg}°`).toBe(0)
      expect(overlapArea(other, footprint), `the second chip covers the Floor at ${deg}°`).toBe(0)
      expect(overlapArea(other, obstacle), `the second chip covers the text at ${deg}°`).toBe(0)
    }
  })

  it('answers the same way twice, so a redraw does not jitter', () => {
    const footprint = rotatedAabb(CENTRE, 600, 400, 37)
    const obstacle: Rect = { x: 1940, y: 1930, w: 120, h: 18 }
    const input: LabelPlacement = { footprint, obstacles: [obstacle], labels: [chip, depth] }
    expect(placeLabels(input)).toEqual(placeLabels(input))
  })
})

// --- The one guarantee that never bends --------------------------------------

const arbRect = fc.record({
  x: fc.integer({ min: -5000, max: 5000 }),
  y: fc.integer({ min: -5000, max: 5000 }),
  w: fc.integer({ min: 0, max: 4000 }),
  h: fc.integer({ min: 0, max: 4000 }),
})

const arbLabel = fc.record({
  id: fc.string({ minLength: 1, maxLength: 8 }),
  anchor: fc.record({ x: fc.integer({ min: -5000, max: 5000 }), y: fc.integer({ min: -5000, max: 5000 }) }),
  w: fc.integer({ min: 1, max: 400 }),
  h: fc.integer({ min: 1, max: 120 }),
})

describe('placeLabels footprint rule', () => {
  it('never returns a box that covers the footprint, however crowded', () => {
    fc.assert(
      fc.property(
        fc.record({
          footprint: arbRect,
          obstacles: fc.array(arbRect, { maxLength: 6 }),
          labels: fc.array(arbLabel, { maxLength: 5 }),
        }),
        (input: LabelPlacement) => {
          const boxes = placeLabels(input)
          expect(boxes).toHaveLength(input.labels.length)
          for (const box of boxes) expect(overlapArea(box, input.footprint)).toBe(0)
        },
      ),
      { numRuns: 500 },
    )
  })
})

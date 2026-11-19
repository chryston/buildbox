/**
 * The draft-path state machine (#59 §1, behaviours 9–11).
 *
 * The numbers here are the ones the issue pins: the three-point arc through
 * (0,0), (1000,−1000) and (0,200) is the major-arc case D9 refuses to clamp, the
 * half-ellipse is the two-click default, and the self-crossing fixture is the draft that
 * must read as judgeable-but-invalid rather than as nothing at all.
 */
import { describe, expect, it } from 'vitest'
import type { Pt } from '../../../derive'
import { pt } from '../../../derive'
import {
  beginClose,
  clickDraft,
  closeDraft,
  draftChip,
  draftEnd,
  draftIsJudgeable,
  draftLoop,
  draftPreviewSegments,
  draftSegments,
  placedCount,
  startDraft,
  undoPoint,
  withCursor,
  withTool,
  withTypedLength,
} from './draftPath'

/** Where a point sits off the circle: zero when it lies exactly on it. */
const offCircle = (p: Pt, center: Pt, radius: number): number =>
  Math.abs(Math.hypot(p.x - center.x, p.y - center.y) - radius)

/** Where two straight segments cross, or `null` when they miss. */
const lineCross = (a: Pt, b: Pt, c: Pt, d: Pt): Pt | null => {
  const r = { x: b.x - a.x, y: b.y - a.y }
  const s = { x: d.x - c.x, y: d.y - c.y }
  const denom = r.x * s.y - r.y * s.x
  if (denom === 0) return null
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denom
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / denom
  if (t < 0 || t > 1 || u < 0 || u > 1) return null
  return pt(a.x + t * r.x, a.y + t * r.y)
}

/** An arc draft after both clicks: end point then bulge. */
const arcDraft = (start: Pt, end: Pt, bulge: Pt) =>
  clickDraft(clickDraft(startDraft('arc', start), end), bulge)

describe('the line tool (behaviour 9)', () => {
  it('places a vertex on every click and counts the start as one point', () => {
    let draft = startDraft('line', pt(0, 0))
    expect(placedCount(draft)).toBe(1)
    draft = clickDraft(draft, pt(2000, 0))
    draft = clickDraft(draft, pt(2000, 1200))
    expect(placedCount(draft)).toBe(3)
    expect(draftSegments(draft)).toEqual([
      { kind: 'line', to: pt(2000, 0) },
      { kind: 'line', to: pt(2000, 1200) },
    ])
  })

  it('clears the typed length when a click lands the segment it belonged to', () => {
    let draft = withTypedLength(withCursor(startDraft('line', pt(0, 0)), pt(500, 0)), 400)
    draft = clickDraft(draft, pt(400, 0))
    expect(draft.typedLength).toBeNull()
  })
})

describe('the arc tool (behaviour 10, D9)', () => {
  it('solves the circle through start, bulge and end, keeping the major arc (criterion 1)', () => {
    const draft = arcDraft(pt(0, 0), pt(0, 200), pt(1000, -1000))
    const segments = draftSegments(draft)
    expect(segments).toHaveLength(1)
    const segment = segments[0]
    expect(segment.kind).toBe('arc')
    if (segment.kind !== 'arc') return
    expect(segment.center.x).toBeCloseTo(1100, 6)
    expect(segment.center.y).toBeCloseTo(100, 6)
    const radius = Math.hypot(segment.center.x, segment.center.y)
    expect(radius).toBeCloseTo(1104.536, 3)
    expect(Math.abs(segment.sweepDeg)).toBeGreaterThan(180)
    // The issue pins 349.62 to 0.01; the exact solve gives 349.6111.
    expect(Math.abs(Math.abs(segment.sweepDeg) - 349.62)).toBeLessThan(0.01)
    // All three points lie on the circle the arc claims.
    for (const p of [pt(0, 0), pt(1000, -1000), pt(0, 200)])
      expect(offCircle(p, segment.center, radius)).toBeLessThan(1e-6)
  })

  it('holds the end point as a waiting vertex until the bulge click lands', () => {
    const waiting = clickDraft(startDraft('arc', pt(0, 0)), pt(0, 200))
    // An arc with no bulge is a gesture, not an Edge yet.
    expect(draftSegments(waiting)).toEqual([])
    // Before the bulge lands the preview draws the arc through the pointer (criterion 1's
    // fixture with the pointer standing in for the bulge).
    const preview = draftPreviewSegments(withCursor(waiting, pt(1000, -1000)))
    expect(preview).toHaveLength(1)
    expect(preview[0].kind).toBe('arc')
  })

  it('keeps earlier arcs when a later vertex takes the shared bulge slot', () => {
    let draft = arcDraft(pt(0, 0), pt(0, 200), pt(1000, -1000))
    draft = withTool(draft, 'line')
    draft = clickDraft(draft, pt(3000, 400)) // starts the next segment
    const segments = draftSegments(draft)
    expect(segments).toHaveLength(2)
    expect(segments[0].kind).toBe('arc')
    expect(segments[1]).toEqual({ kind: 'line', to: pt(3000, 400) })
  })
})

describe('the elliptical arc tool (behaviour 11, D9)', () => {
  it('makes the chord one axis and the bulge offset the other (criterion 2)', () => {
    const draft = clickDraft(clickDraft(startDraft('ellipticalArc', pt(0, 0)), pt(2100, 0)), pt(1050, -630))
    const [segment] = draftSegments(draft)
    expect(segment.kind).toBe('ellipticalArc')
    if (segment.kind !== 'ellipticalArc') return
    expect(segment.rx).toBe(1050)
    expect(segment.ry).toBe(630)
    expect(segment.rotationDeg).toBe(0)
    expect(segment.sweepDeg).toBe(180)
  })

  it('turns the other way when the bulge hangs below the chord', () => {
    const draft = clickDraft(clickDraft(startDraft('ellipticalArc', pt(0, 0)), pt(2100, 0)), pt(1050, 630))
    const [segment] = draftSegments(draft)
    if (segment.kind !== 'ellipticalArc') throw new Error('expected an elliptical arc')
    expect(segment.sweepDeg).toBe(-180)
  })
})

describe('the chip numbers (criterion 3)', () => {
  it('reads length and direction of the rubber band', () => {
    const chip = draftChip(withCursor(startDraft('line', pt(0, 0)), pt(2000, 0)))
    expect(chip).not.toBeNull()
    expect(chip?.lengthMm).toBe(2000)
    expect(chip?.directionDeg).toBe(0)
    expect(chip?.arcLengthMm).toBeNull()
    const diagonal = draftChip(withCursor(startDraft('line', pt(0, 0)), pt(2000, 2000)))
    expect(diagonal?.directionDeg).toBeCloseTo(45, 10)
  })

  it('has nothing to show before the pointer has moved and nothing is placed', () => {
    expect(draftChip(startDraft('line', pt(0, 0)))).toBeNull()
    expect(draftEnd(startDraft('line', pt(0, 0)))).toBeNull()
  })
})

describe('the typed length (criterion 4)', () => {
  it('lands exactly on the typed distance along the pointer direction', () => {
    let draft = clickDraft(startDraft('line', pt(0, 0)), pt(2000, 0))
    draft = withCursor(draft, pt(2000, 900))
    draft = withTypedLength(draft, 1500)
    expect(draftEnd(draft)).toEqual(pt(2000, 1500))
    // The typed length never moves a placed point.
    expect(draft.placed[0].to).toEqual(pt(2000, 0))
  })
})

describe('judging a draft (criterion 5)', () => {
  /** The self-crossing fixture: (0,0)→(2000,2000)→(2000,0)→(0,2000). */
  const crossing = () =>
    [pt(2000, 2000), pt(2000, 0), pt(0, 2000)].reduce(
      (draft, at) => clickDraft(draft, at),
      startDraft('line', pt(0, 0)),
    )

  it('closes the fixture into four Edges whose first and third cross', () => {
    const loop = draftLoop(crossing())
    expect(loop.segments).toHaveLength(4)
    const first = loop.segments[0]
    const third = loop.segments[2]
    if (first.kind !== 'line' || third.kind !== 'line') throw new Error('expected straight Edges')
    expect(lineCross(loop.start, first.to, pt(2000, 0), third.to)).toEqual(pt(1000, 1000))
    expect(draftIsJudgeable(crossing())).toBe(true)
  })

  it('is not judgeable with one placed vertex: a two-Edge loop is not a shape yet', () => {
    const draft = clickDraft(startDraft('line', pt(0, 0)), pt(2000, 0))
    expect(draftIsJudgeable(draft)).toBe(false)
    expect(draftIsJudgeable(startDraft('line', pt(0, 0)))).toBe(false)
  })
})

describe('undo and close (criterion 6)', () => {
  it('removes the last vertex, and reports nothing left once only the start remains', () => {
    let draft = clickDraft(clickDraft(startDraft('line', pt(0, 0)), pt(2000, 0)), pt(2000, 1200))
    draft = undoPoint(draft) ?? draft
    expect(draft.placed).toEqual([{ to: pt(2000, 0), kind: 'line' }])
    const oneLeft = undoPoint(draft)
    expect(oneLeft?.placed).toEqual([])
    expect(oneLeft === null ? null : undoPoint(oneLeft)).toBeNull()
  })

  it('closes straight with a line and through the bulge with an arc', () => {
    const draft = beginClose(
      [pt(2000, 0), pt(2000, 1200), pt(0, 1200)].reduce(
        (d, at) => clickDraft(d, at),
        startDraft('line', pt(0, 0)),
      ),
    )
    expect(draft.pendingClose).toBe(true)
    const straight = closeDraft(draft, 'line')
    expect(straight.segments).toHaveLength(4)
    expect(straight.segments[3]).toEqual({ kind: 'line', to: pt(0, 0) })
    const curved = closeDraft(draft, 'arc', pt(-500, 600))
    const closing = curved.segments[3]
    if (closing.kind !== 'arc') throw new Error('expected an arc closing Edge')
    expect(closing.to).toEqual(pt(0, 0))
  })
})

describe('switching tools mid-draft (criterion 7)', () => {
  it('changes only the tool: earlier Edges keep their kinds', () => {
    let draft = clickDraft(startDraft('line', pt(0, 0)), pt(2000, 0))
    draft = withTool(draft, 'arc')
    expect(draft.tool).toBe('arc')
    expect(draft.placed).toEqual([{ to: pt(2000, 0), kind: 'line' }])
    draft = clickDraft(draft, pt(2000, 1200)) // the arc's end point
    draft = clickDraft(draft, pt(2600, 600)) // and its bulge
    const segments = draftSegments(draft)
    expect(segments[0]).toEqual({ kind: 'line', to: pt(2000, 0) })
    expect(segments[1].kind).toBe('arc')
  })
})

describe('the chip for curves (criterion 8)', () => {
  it('reads R and arc length for the major arc', () => {
    const draft = arcDraft(pt(0, 0), pt(0, 200), pt(1000, -1000))
    const chip = draftChip(draft)
    const segment = draftSegments(draft)[0]
    if (segment.kind !== 'arc' || chip?.radiusMm == null || chip.arcLengthMm == null)
      throw new Error('expected an arc chip')
    expect(chip.kind).toBe('arc')
    expect(chip.lengthMm).toBeCloseTo(200, 9) // the chord, not the arc
    expect(chip.radiusMm).toBeCloseTo(1104.536, 3)
    // Arc length is radius × |sweep| in radians — ≈ 6739.73 for this fixture.
    expect(chip.arcLengthMm).toBeCloseTo(chip.radiusMm * Math.abs(segment.sweepDeg) * (Math.PI / 180), 6)
    expect(chip.arcLengthMm).toBeCloseTo(6739.7, 0)
  })

  it('reads the semi-axes and the half-ellipse length', () => {
    const draft = clickDraft(clickDraft(startDraft('ellipticalArc', pt(0, 0)), pt(2100, 0)), pt(1050, -630))
    const chip = draftChip(draft)
    expect(chip?.rx).toBe(1050)
    expect(chip?.ry).toBe(630)
    // Half the perimeter of the 1050 × 630 ellipse, Ramanujan to better than 0.1%.
    const a = 1050
    const b = 630
    const h = ((a - b) / (a + b)) ** 2
    const half = (Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)))) / 2
    expect(chip?.arcLengthMm).not.toBeNull()
    expect(Math.abs((chip?.arcLengthMm ?? 0) - half)).toBeLessThan(0.001 * half)
  })
})

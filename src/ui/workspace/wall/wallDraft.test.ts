/**
 * The Wall draft machine (#64 §12, criteria 4, 5): what the clicks mean, what the chips say, and
 * what `Finish` sends.
 *
 * Three things are worth the assertions. The join indicator is the only place a Junction is
 * decided, so a click near a Wall must still make nothing; the chips are the only numbers shown
 * while drawing, and they must never name a side or a centreline (D6); and `Arc from last` has to
 * leave the previous segment in the direction it was already going, which is the whole promise.
 */
import { describe, expect, it } from 'vitest'
import type { Pt } from '../../../derive'
import { pt } from '../../../derive'
import {
  FREE_TARGET,
  canFinish,
  circleThrough,
  draftChip,
  draftHeadingDeg,
  draftSegments,
  joinLabel,
  placePoint,
  startWallDraft,
  toChainPayload,
  undoPoint,
  withTypedLength,
  withWallCursor,
  withWallTool,
} from './wallDraft'
import type { WallSnapTarget } from './wallDraft'

const at = (x: number, y: number): Pt => ({ x, y })
/** The point of a 1,500 mm circle halfway between (-1,500, 0) and (0, 1,500). */
const quarter = pt(-1500 / Math.SQRT2, 1500 / Math.SQRT2)
const num = (mm: number): string => Math.round(mm).toLocaleString('en-GB')
const endTarget = (ref: string, end: 'start' | 'end' = 'end'): WallSnapTarget => ({
  kind: 'end',
  wallId: `wall-${ref}`,
  ref,
  end,
})
const faceTarget = (ref: string): WallSnapTarget => ({ kind: 'face', wallId: `wall-${ref}`, ref })

/** Click through a list of points, each with the target under it. */
const draw = (first: Pt, ...clicks: { at: Pt; target?: WallSnapTarget }[]): ReturnType<typeof startWallDraft> => {
  let draft = startWallDraft(first)
  for (const click of clicks) {
    const aimed = withWallCursor(draft, click.at, click.target ?? FREE_TARGET)
    const next = placePoint(aimed)
    expect(next).not.toBeNull()
    draft = next!
  }
  return draft
}

describe('the draft', () => {
  it('starts with one point and nothing to finish', () => {
    const draft = startWallDraft(at(0, 0))
    expect(draft.nodes).toHaveLength(1)
    expect(draftSegments(draft)).toHaveLength(0)
    expect(canFinish(draft)).toBe(false)
  })

  it('draws a rubber band to the pointer without placing anything', () => {
    const draft = withWallCursor(startWallDraft(at(0, 0)), at(2000, 0))
    expect(draftSegments(draft)).toHaveLength(1)
    expect(canFinish(draft)).toBe(false)
    expect(draft.nodes).toHaveLength(1)
  })

  it('places each click and keeps the chain in order', () => {
    const draft = draw(at(0, 0), { at: at(2000, 0) }, { at: at(2000, 1500) })
    const segments = draftSegments(draft)
    expect(segments).toHaveLength(2)
    expect(segments[0]!.end).toEqual(at(2000, 0))
    expect(segments[1]!.end).toEqual(at(2000, 1500))
    expect(canFinish(draft)).toBe(true)
  })

  it('puts a typed length down exactly, along the direction being drawn', () => {
    const aimed = withWallCursor(startWallDraft(at(0, 0)), at(900, 0))
    const placed = placePoint(withTypedLength(aimed, 2000))!
    expect(placed.nodes[1]!.at).toEqual(at(2000, 0))
  })

  it('undoes the last click and keeps the start point', () => {
    const draft = draw(at(0, 0), { at: at(2000, 0) }, { at: at(2000, 1500) })
    expect(draftSegments(undoPoint(draft))).toHaveLength(1)
    expect(undoPoint(startWallDraft(at(0, 0))).nodes).toHaveLength(1)
  })
})

describe('the join indicator', () => {
  it('names the end it would join, in the words the issue prescribes', () => {
    expect(joinLabel(endTarget('W-3'))).toBe('Join to end of W-3')
    expect(joinLabel(faceTarget('W-3'))).toBe('Attach to W-3')
  })

  it('says nothing when the pointer is over bare canvas', () => {
    expect(joinLabel(FREE_TARGET)).toBeNull()
  })

  it('never names a side, a letter, or a centreline (D6)', () => {
    for (const label of [joinLabel(endTarget('W-1')), joinLabel(faceTarget('W-1'))] as const) {
      expect(label).not.toMatch(/\bL\b|\bR\b|\bleft\b|\bright\b|centreline|centerline/i)
    }
  })

  it('is the only thing that decides a Junction: a near miss stays free', () => {
    const payload = toChainPayload(draw(at(0, 0), { at: at(999, 0) }), 'floor-1', defaults)!
    expect(payload.starts[0]).toEqual({ kind: 'free' })
    expect(payload.ends[0]).toEqual({ kind: 'free' })
  })
})

const defaults = { thickness: 100, justification: 'centre' as const, baseElevation: 0, height: 2600 }

describe('the chips', () => {
  it('gives a line its length and direction', () => {
    const segment = draftSegments(draw(at(0, 0), { at: at(0, 2000) }))[0]!
    expect(draftChip(segment, num, 'mm')).toBe('2,000 mm · 90°')
  })

  it('gives an arc its radius and its arc length, never a side', () => {
    const draft = withWallTool(startWallDraft(at(-1500, 0), 'arc'), 'arc')
    const withEnd = placePoint(withWallCursor(draft, at(0, 1500)))!
    const curved = placePoint(withWallCursor(withEnd, quarter))!
    const segment = draftSegments(curved)[0]!
    expect(segment.through).not.toBeNull()
    expect(draftChip(segment, num, 'mm')).toBe('R 1,500 mm · 2,356 mm')
  })
})

describe('the circle through three points', () => {
  it('recovers the centre, radius and sweep of a quarter turn', () => {
    const curve = circleThrough(at(-1500, 0), quarter, at(0, 1500))!
    expect(curve.center.x).toBeCloseTo(0, 6)
    expect(curve.center.y).toBeCloseTo(0, 6)
    expect(curve.radius).toBeCloseTo(1500, 3)
    // Angles grow clockwise on screen, and this quarter turn goes the other way.
    expect((curve.sweep * 180) / Math.PI).toBeCloseTo(-90, 3)
  })

  it('is null for three collinear points, which are a line', () => {
    expect(circleThrough(at(0, 0), at(1000, 0), at(2000, 0))).toBeNull()
  })
})

describe('Arc from last', () => {
  it('leaves the previous segment in the direction it was already going', () => {
    const straight = draw(at(0, 0), { at: at(1000, 0) })
    expect(draftHeadingDeg(straight)).toBeCloseTo(0, 9)
    const placed = placePoint(withWallCursor(withWallTool(straight, 'arcFromLast'), at(2000, 1000)))!
    const segment = draftSegments(placed)[1]!
    expect(segment.through).not.toBeNull()
    const curve = circleThrough(segment.start, segment.through!, segment.end)!
    const radial = Math.atan2(segment.start.y - curve.center.y, segment.start.x - curve.center.x)
    const tangent = radial + (curve.sweep >= 0 ? Math.PI / 2 : -Math.PI / 2)
    expect(((tangent * 180) / Math.PI + 360) % 360).toBeCloseTo(0, 6)
  })
})

describe('the committed chain', () => {
  it('joins its own segments at every interior point (#64 §8)', () => {
    const payload = toChainPayload(draw(at(0, 0), { at: at(2000, 0) }, { at: at(2000, 1500) }), 'floor-1', defaults)!
    expect(payload.walls).toHaveLength(2)
    expect(payload.starts).toEqual([{ kind: 'free' }, { kind: 'segment', index: 0, end: 'end' }])
    expect(payload.ends).toEqual([{ kind: 'segment', index: 1, end: 'start' }, { kind: 'free' }])
  })

  it('gives both ends of a snapped interior point the same target', () => {
    const payload = toChainPayload(
      draw(at(0, 0), { at: at(2000, 0), target: endTarget('W-1') }, { at: at(2000, 1500) }),
      'floor-1',
      defaults,
    )!
    expect(payload.ends[0]).toEqual({ kind: 'wall', wallId: 'wall-W-1', end: 'end' })
    expect(payload.starts[1]).toEqual({ kind: 'wall', wallId: 'wall-W-1', end: 'end' })
    // The chain's own join is not invented where a real Junction was named.
    expect(payload.starts.concat(payload.ends).some((target) => target.kind === 'segment')).toBe(false)
    expect(payload.ends[1]).toEqual({ kind: 'free' })
  })

  it('attaches to a face without joining an end', () => {
    const payload = toChainPayload(draw(at(0, 0), { at: at(2000, 0), target: faceTarget('W-2') }), 'floor-1', defaults)!
    expect(payload.ends[0]).toEqual({ kind: 'host', wallId: 'wall-W-2' })
  })

  it('carries the tool options down to every Wall', () => {
    const payload = toChainPayload(draw(at(0, 0), { at: at(2000, 0) }), 'floor-1', {
      thickness: 150,
      justification: 'left',
      baseElevation: 40,
      height: 2400,
    })!
    expect(payload.walls[0]).toMatchObject({ thickness: 150, justification: 'left', baseElevation: 40, height: 2400 })
  })

  it('refuses to send an empty chain', () => {
    expect(toChainPayload(startWallDraft(at(0, 0)), 'floor-1', defaults)).toBeNull()
  })
})

/**
 * What a Room draft means before it is a Room (#67 behaviours 4, 7, 17).
 *
 * Two questions are answered here and nowhere else: what shape the clicks so far describe, and
 * what that shape would do to the Rooms already on the Floor. The second is the one the acceptance
 * text quotes — the same sentence the Intent refuses with, computed from the same domain check,
 * so the bar can never promise a placement the commit would reject.
 */
import { describe, expect, it } from 'vitest'
import type { ClosedPath } from '../../../derive'
import type { Room } from '../../../domain'
import { clickDraft, startDraft } from '../shape/draftPath'
import {
  roomDraftLoop,
  roomDraftOutline,
  roomOutlineShapePath,
  roomOverlapPreview,
  shelterName,
  shelterOutline,
  shelterPackName,
  shelterSize,
} from './roomDraft'

/** A rectangle walked anticlockwise from its bottom-left corner. */
const rect = (x0: number, y0: number, x1: number, y1: number): ClosedPath => ({
  start: { x: x0, y: y0 },
  segments: [
    { kind: 'line', to: { x: x1, y: y0 } },
    { kind: 'line', to: { x: x1, y: y1 } },
    { kind: 'line', to: { x: x0, y: y1 } },
    { kind: 'line', to: { x: x0, y: y0 } },
  ],
})

const kitchen: Room = {
  id: 'room-kitchen',
  floorId: 'floor-main',
  name: 'Kitchen',
  outline: { kind: 'path', path: rect(0, 0, 4000, 3000), segmentIds: ['e1', 'e2', 'e3', 'e4'] },
  wallFaceRefs: [],
}

const bedroom: Room = {
  id: 'room-bedroom',
  floorId: 'floor-main',
  name: 'Bedroom',
  outline: { kind: 'path', path: rect(4000, 0, 7000, 3000), segmentIds: ['e5', 'e6', 'e7', 'e8'] },
  wallFaceRefs: [],
}

/** A draft of the given corners: the first is the start, the rest are clicks. */
const draftOf = (...corners: readonly { x: number; y: number }[]) => {
  const [first, ...rest] = corners
  return rest.reduce((draft, at) => clickDraft(draft, at), startDraft('line', first!))
}

describe('the loop a draft describes', () => {
  it('is nothing until the shape can be judged', () => {
    // One point and one Edge are not a Room, and reporting them as an invalid one would paint the
    // canvas red on the first click.
    expect(roomDraftLoop(draftOf({ x: 0, y: 0 }))).toBeNull()
    expect(roomDraftLoop(draftOf({ x: 0, y: 0 }, { x: 4000, y: 0 }))).toBeNull()
    expect(roomDraftOutline(draftOf({ x: 0, y: 0 }, { x: 4000, y: 0 }))).toBeNull()
  })

  it('closes the loop the clicks walked', () => {
    const draft = draftOf({ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 })
    const outline = roomDraftOutline(draft)
    expect(outline).not.toBeNull()
    expect(roomOutlineShapePath(outline!)).toEqual(rect(0, 0, 4000, 3000))
  })
})

describe('the overlap a proposal would create', () => {
  it('is clean when nothing is being drawn', () => {
    expect(roomOverlapPreview(null, null, [kitchen])).toEqual({ blocked: false, regions: [], message: null })
  })

  it('names the other Room and the area it shares', () => {
    // A strip 4000 × 105 across the Kitchen's lower part: 0.42 m² of its floor.
    const draft = draftOf({ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 105 }, { x: 0, y: 105 })
    const preview = roomOverlapPreview(null, roomDraftOutline(draft), [kitchen, bedroom])
    expect(preview.blocked).toBe(true)
    expect(preview.message).toBe('Overlaps Kitchen by 0.42 m².')
    expect(preview.regions).toHaveLength(1)
  })

  it('takes the first Room it overlaps, in the order the Floor holds them', () => {
    const draft = draftOf({ x: 3000, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 3000 }, { x: 3000, y: 3000 })
    const preview = roomOverlapPreview(null, roomDraftOutline(draft), [kitchen, bedroom])
    expect(preview.message).toBe('Overlaps Kitchen by 3.00 m².')
    // The same proposal checked against the other Room alone names that one instead.
    expect(roomOverlapPreview(null, roomDraftOutline(draft), [bedroom]).message)
      .toBe('Overlaps Bedroom by 3.00 m².')
  })

  it('is clean where two Rooms share an edge', () => {
    // A Room drawn below the Kitchen, sharing its whole lower edge: tiling a Floor edge to edge is
    // the normal drawing, and a shared boundary has no area, so nothing is blocked and painted.
    const draft = draftOf({ x: 0, y: -2000 }, { x: 4000, y: -2000 }, { x: 4000, y: 0 }, { x: 0, y: 0 })
    expect(roomOverlapPreview(null, roomDraftOutline(draft), [kitchen, bedroom])).toEqual({
      blocked: false,
      regions: [],
      message: null,
    })
  })

  it('never compares a Room being edited with itself', () => {
    // Restating the Kitchen's own Outline changes nothing about the Kitchen, even though the
    // proposal covers it exactly.
    const outline = roomDraftOutline(draftOf({ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }))
    expect(roomOverlapPreview('room-kitchen', outline, [kitchen, bedroom]).blocked).toBe(false)
    // The same outline drawn as a new Room, with nothing selected, is the overlap it always was.
    expect(roomOverlapPreview(null, outline, [kitchen, bedroom]).blocked).toBe(true)
  })
})

describe('the household shelter', () => {
  it('is the pack\'s own entry, in the pack\'s own words', () => {
    expect(shelterPackName()).toBe('HDB BTO (typical)')
    expect(shelterName()).toBe('Household shelter')
    expect(shelterSize()).toEqual({ width: 1450, depth: 1950 })
  })

  it('stands centred on the click, at its fixed internal size', () => {
    const outline = shelterOutline({ x: 1000, y: 1000 }, 0)
    expect(roomOutlineShapePath(outline)).toEqual(rect(275, 25, 1725, 1975))
  })

  it('is blocked by the same sentence as a drawn Room', () => {
    const preview = roomOverlapPreview(null, shelterOutline({ x: 2000, y: 1500 }, 0), [kitchen])
    expect(preview.blocked).toBe(true)
    expect(preview.message).toMatch(/^Overlaps Kitchen by \d+\.\d\d m²\.$/)
  })
})

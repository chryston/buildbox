/**
 * The Openings a Wall carries when that Wall is edited (#65 §6, §7).
 *
 * The rule under test is that an Opening is stored along its host, so every host edit that
 * keeps the Wall keeps its Openings untouched — no re-projection, no drift — and every host
 * edit that would leave one of them sticking out of the Wall is refused whole, in a sentence
 * that names the Opening rather than a coordinate. Deleting the host is the one edit that
 * takes the Openings with it, and only after the review has been answered.
 */
import { describe, expect, it } from 'vitest'
import type { Opening, Project, Wall, WallRefLine } from '../../domain'
import { pt } from '../../geometry'
import type { PayloadOf } from '../intents'
import { applyIntent, previewIntent } from '../index'
import {
  deepFreeze,
  expectApplied,
  expectRejection,
  expectRoundTrip,
  idSource,
  intent,
  newProject,
} from '../testing'

const line = (x1: number, y1: number, x2: number, y2: number): WallRefLine => ({
  kind: 'line',
  start: pt(x1, y1),
  end: pt(x2, y2),
})

const source = idSource('host')
const floorIdOf = (project: Project): string => project.floors[0]!.id

function draw(project: Project, walls: readonly WallRefLine[]): { project: Project; ids: string[] } {
  const payload = {
    floorId: floorIdOf(project),
    walls: walls.map((l) => ({ line: l, thickness: 100, justification: 'centre' as const, baseElevation: 0, height: 2600 })),
    starts: walls.map((_, index) => (index === 0 ? { kind: 'free' as const } : { kind: 'segment' as const, index: index - 1, end: 'end' as const })),
    ends: walls.map((_, index) => (index + 1 < walls.length ? { kind: 'segment' as const, index: index + 1, end: 'start' as const } : { kind: 'free' as const })),
  }
  const ids = source(walls.length + (walls.length > 1 ? 1 : 0))
  const applied = expectApplied(project, intent('wall.createChain', payload, ids))
  return { project: applied.project, ids: ids.slice(0, walls.length) }
}

function place(project: Project, hostWall: Wall, over: Omit<PayloadOf<'opening.create'>, 'floorId' | 'hostWallId'>): Project {
  return expectApplied(project, intent('opening.create', { ...over, floorId: hostWall.floorId, hostWallId: hostWall.id }, source(1))).project
}

const openingsOf = (project: Project): Opening[] => project.existingModel.openings
const wallOf = (project: Project, id: string): Wall => project.existingModel.walls.find((wall) => wall.id === id)!

/**
 * `W-1`, 6 000 mm along x, with `Door 1` at 1 800 (900 wide) and `Window 2` at 4 000
 * (1 200 wide) — the shape criterion 6 counts on.
 */
function withTwo(): { project: Project; wall: Wall; door: Opening; window: Opening } {
  const drawn = draw(newProject(), [line(0, 0, 6000, 0)])
  const wall = wallOf(drawn.project, drawn.ids[0]!)
  const withDoor = place(drawn.project, wall, {
    kind: 'door',
    label: 'Door 1',
    start: 1800,
    width: 900,
    sill: 0,
    head: 2100,
    swing: 'left',
    hingeSide: 'start',
  })
  const withWindow = place(withDoor, wall, {
    kind: 'window',
    label: 'Window 2',
    start: 4000,
    width: 1200,
    sill: 1050,
    head: 2300,
  })
  return { project: withWindow, wall, door: openingsOf(withWindow)[0]!, window: openingsOf(withWindow)[1]! }
}

describe('a Wall that moves takes its Openings with it', () => {
  it('moves the whole Wall by drag and leaves both starts exactly as they were', () => {
    const { project, wall } = withTwo()
    const before = openingsOf(project)
    const applied = expectRoundTrip(project, intent('wall.dragBody', { wallId: wall.id, delta: pt(500, 0) }))
    const after = openingsOf(applied.project)
    expect(after).toEqual(before)
    expect(wallOf(applied.project, wall.id).line.start).toEqual(pt(500, 0))
    // One undo step: the drag is one Intent, so the two Openings are not two more steps.
    expect(applied.patches.length).toBeGreaterThan(0)
  })

  it('follows a dragged free end, a rotated Wall and a thicker Wall without touching either', () => {
    const { project, wall } = withTwo()
    const before = openingsOf(project)
    const end = expectApplied(project, intent('wall.dragEndpoint', { wallId: wall.id, end: 'end', to: pt(7000, 0) })).project
    expect(openingsOf(end)).toEqual(before)
    const turned = expectApplied(end, intent('wall.setDirection', { wallId: wall.id, directionDeg: 30 })).project
    expect(openingsOf(turned)).toEqual(before)
    const thicker = expectApplied(turned, intent('wall.setThickness', { wallId: wall.id, thickness: 200 })).project
    expect(openingsOf(thicker)).toEqual(before)
  })

  it('refuses a shortening that leaves a window past the end, naming the window', () => {
    const { project, wall } = withTwo()
    const next = intent('wall.setLength', { wallId: wall.id, length: 5000, keepFixed: 'start' })
    const rejection = expectRejection(project, next, 'opening-blocked')
    expect(rejection.problems[0]!.message).toBe('Window 2 would run past the end of W-1. Move or narrow it first.')
    expect(applyIntent(deepFreeze(project), next)).toEqual(rejection)
  })

  it('refuses a drag of the free end that swallows the same window', () => {
    const { project, wall } = withTwo()
    const rejection = expectRejection(project, intent('wall.dragEndpoint', { wallId: wall.id, end: 'end', to: pt(4500, 0) }), 'opening-blocked')
    expect(rejection.problems[0]!.message).toContain('Window 2')
  })

  it('lets a shortening that keeps both of them', () => {
    const { project, wall } = withTwo()
    const applied = expectApplied(project, intent('wall.setLength', { wallId: wall.id, length: 5200, keepFixed: 'start' }))
    expect(openingsOf(applied.project)).toEqual(openingsOf(project))
  })
})

describe('splitting a Wall that has Openings', () => {
  it('moves an Opening past the seam onto the new piece, measured from the seam', () => {
    const { project, wall } = withTwo()
    const applied = expectRoundTrip(project, intent('wall.split', { wallId: wall.id, at: 1000 }, source(2)))
    const pieces = applied.project.existingModel.walls
    expect(pieces).toHaveLength(2)
    const [first, second] = [wallOf(applied.project, wall.id), wallOf(applied.project, pieces.find((piece) => piece.id !== wall.id)!.id)]
    // The kept piece is the back half of the original, so both Openings are on the new one.
    expect(openingsOf(applied.project).map((opening) => [opening.hostWallId === wall.id, opening.start])).toEqual([
      [false, 800],
      [false, 3000],
    ])
    expect(first).toBeDefined()
    expect(second).toBeDefined()
  })

  it('leaves an Opening behind when it lies before the seam', () => {
    const drawn = draw(newProject(), [line(0, 0, 6000, 0)])
    const wall = wallOf(drawn.project, drawn.ids[0]!)
    const project = place(drawn.project, wall, { kind: 'door', label: 'Door 1', start: 500, width: 900, sill: 0, head: 2100, swing: 'left', hingeSide: 'start' })
    const applied = expectApplied(project, intent('wall.split', { wallId: wall.id, at: 2000 }, source(2)))
    const kept = openingsOf(applied.project)
    expect(kept).toHaveLength(1)
    expect(kept[0]).toMatchObject({ hostWallId: wall.id, start: 500 })
  })

  it('refuses a split inside an Opening, naming it', () => {
    const { project, wall } = withTwo()
    const rejection = expectRejection(project, intent('wall.split', { wallId: wall.id, at: 2000 }, source(2)), 'split-blocked')
    expect(rejection.problems[0]!.message).toBe('The split point is inside Door 1.')
  })

  it('refuses a split inside the other Opening too', () => {
    const { project, wall } = withTwo()
    const rejection = expectRejection(project, intent('wall.split', { wallId: wall.id, at: 4500 }, source(2)), 'split-blocked')
    expect(rejection.problems[0]!.message).toBe('The split point is inside Window 2.')
  })
})

describe('merging two Walls that have Openings', () => {
  it('rehosts the Opening onto the kept Wall, measured from the kept end', () => {
    const drawn = draw(newProject(), [line(0, 0, 3000, 0), line(3000, 0, 6000, 0)])
    const [first, second] = [wallOf(drawn.project, drawn.ids[0]!), wallOf(drawn.project, drawn.ids[1]!)]
    const project = place(drawn.project, second, { kind: 'door', label: 'Door 1', start: 500, width: 900, sill: 0, head: 2100, swing: 'left', hingeSide: 'start' })
    const applied = expectRoundTrip(project, intent('wall.merge', { wallIds: [first.id, second.id] }))
    const kept = openingsOf(applied.project)
    expect(kept).toHaveLength(1)
    expect(kept[0]).toMatchObject({ hostWallId: first.id, start: 3500 })
    expect(applied.project.existingModel.walls).toHaveLength(1)
  })
})

describe('deleting the host Wall (#65 §7)', () => {
  it('previews a review that lists both Openings', () => {
    const { project, wall, door, window } = withTwo()
    const { review, rejection } = previewIntent(project, intent('wall.delete', { wallId: wall.id }))
    // The preview carries both halves the dialog needs: the list to show, and the reason the
    // Intent cannot be applied as it stands — the answer is what turns it into a delete.
    expect(rejection?.code).toBe('has-dependants')
    if (review === null) throw new Error('a Wall with Openings previews no review')
    expect(review).toEqual({
      kind: 'delete-wall',
      wallId: wall.id,
      wallRef: 'W-1',
      openings: [
        { id: door.id, kind: 'door', label: 'Door 1', text: 'Door 1 · door' },
        { id: window.id, kind: 'window', label: 'Window 2', text: 'Window 2 · window' },
      ],
      message: 'Delete W-1 and its 2 openings?',
    })
  })

  it('previews no review for a Wall with nothing cut into it', () => {
    const drawn = draw(newProject(), [line(0, 0, 3000, 0)])
    expect(previewIntent(drawn.project, intent('wall.delete', { wallId: drawn.ids[0]! })).review).toBeNull()
  })

  it('refuses the delete until the review is answered, changing nothing', () => {
    const { project, wall } = withTwo()
    const rejection = expectRejection(project, intent('wall.delete', { wallId: wall.id }), 'has-dependants')
    expect(rejection.problems[0]!.message).toBe(
      'W-1 has 2 openings in it. Deleting the wall deletes them too — nothing here does that for you.',
    )
  })

  it('deletes all three in one step when the review is confirmed, and undo brings all three back', () => {
    const { project, wall, door, window } = withTwo()
    const applied = expectRoundTrip(
      deepFreeze(project),
      intent('wall.delete', { wallId: wall.id, openings: [door.id, window.id] }),
    )
    expect(applied.project.existingModel.walls).toEqual([])
    expect(applied.project.existingModel.openings).toEqual([])
  })

  it('refuses a stale answer, when an Opening appeared after the preview', () => {
    const { project, wall, door, window } = withTwo()
    const stale = intent('wall.delete', { wallId: wall.id, openings: [door.id, window.id] })
    const withThird = place(project, wall, { kind: 'window', label: 'Window 3', start: 5400, width: 400, sill: 1050, head: 2300 })
    const rejection = expectRejection(withThird, stale, 'dependency-changed')
    expect(rejection.problems[0]!.message).toBe('W-1 does not have the same openings as when you asked. Check the list again.')
  })

  it('deletes a Wall whose Openings were removed one by one, with no review at all', () => {
    const { project, wall, door, window } = withTwo()
    const cleared = expectApplied(expectApplied(project, intent('opening.delete', { openingId: door.id })).project, intent('opening.delete', { openingId: window.id })).project
    expect(previewIntent(cleared, intent('wall.delete', { wallId: wall.id })).review).toBeNull()
    expectApplied(cleared, intent('wall.delete', { wallId: wall.id }))
  })
})

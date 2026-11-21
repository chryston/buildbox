/**
 * The Room family (#67 §4, §7, §11–§13, §17).
 *
 * The spine of these tests is one Wall with one Room standing on its face: the Room's first
 * Edge lies exactly on `W-1`'s right face, so every message names `Kitchen edge 1` and every
 * propagation is a distance that can be read off the outline. Each test says which of the two
 * — the Wall or the Room — moved, because that is the whole claim a reference makes.
 */
import { describe, expect, it } from 'vitest'
import type { Project, Room, WallRefLine } from '../../domain'
import type { ClosedPath, Pt } from '../../geometry'
import { pt } from '../../geometry'
import type { WallDraft, WallEndTarget } from '../intents'
import { expectApplied, expectRejection, expectRoundTrip, idSource, intent, newProject } from '../testing'

const line = (x1: number, y1: number, x2: number, y2: number): WallRefLine => ({
  kind: 'line',
  start: pt(x1, y1),
  end: pt(x2, y2),
})

const draft = (l: WallRefLine, thickness = 100): WallDraft => ({
  line: l,
  thickness,
  justification: 'centre',
  baseElevation: 0,
  height: 2600,
})

const free: WallEndTarget = { kind: 'free' }

const floorIdOf = (project: Project): string => project.floors[0]!.id
const roomOf = (project: Project, roomId: string): Room => {
  const room = project.existingModel.rooms.find((candidate) => candidate.id === roomId)
  if (room === undefined) throw new Error(`no room ${roomId}`)
  return room
}
const wallOf = (project: Project, index = 0): string => {
  const wall = project.existingModel.walls[index]
  if (wall === undefined) throw new Error('no wall')
  return wall.id
}

/** A closed rectangle, its first Edge running left to right along `y = top`. */
const rect = (left: number, top: number, right: number, bottom: number): ClosedPath => ({
  start: pt(left, top),
  segments: [
    { kind: 'line', to: pt(right, top) },
    { kind: 'line', to: pt(right, bottom) },
    { kind: 'line', to: pt(left, bottom) },
    { kind: 'line', to: pt(left, top) },
  ],
})

const source = idSource('room')

/** `W-1` from (0,0) to (4000,0), 100 mm thick and centred: its right face is the line y = 50. */
function walled(): Project {
  const project = newProject()
  const applied = expectApplied(
    project,
    intent('wall.createChain', { floorId: floorIdOf(project), walls: [draft(line(0, 0, 4000, 0))], starts: [free], ends: [free] }, source(1)),
  )
  return applied.project
}

/** Kitchen: 4000 × 2000 with edge 1 lying on `W-1`'s right face at y = 50. */
function attached(): { project: Project; roomId: string; wallId: string; edgeId: string } {
  const project = walled()
  const wallId = wallOf(project)
  const [roomId, ...edges] = source(5)
  const applied = expectApplied(
    project,
    intent('room.create', { floorId: floorIdOf(project), outline: { kind: 'path', path: rect(0, 50, 4000, 2050) }, name: 'Kitchen' }, [roomId, ...edges]),
  )
  const withRoom = expectApplied(
    applied.project,
    intent('room.attachFace', { roomId, segmentId: edges[0]!, wallId, side: 'right' }),
  ).project
  return { project: withRoom, roomId, wallId, edgeId: edges[0]! }
}

describe('room.create', () => {
  it('draws a Room and names it Room 1 when the caller does not', () => {
    const project = walled()
    const ids = source(5)
    const next = expectRoundTrip(project, intent('room.create', { floorId: floorIdOf(project), outline: { kind: 'path', path: rect(4200, 0, 8200, 2000) } }, ids))
    const room = next.project.existingModel.rooms[0]!
    expect(room.name).toBe('Room 1')
    expect(room.wallFaceRefs).toEqual([])
    expect(room.outline.kind).toBe('path')
  })

  it('refuses a Room that overlaps one already drawn, and says by how much', () => {
    const { project, roomId } = attached()
    expect(roomId).toBeTruthy()
    const ids = source(5)
    const rejection = expectRejection(
      project,
      intent('room.create', { floorId: floorIdOf(project), outline: { kind: 'path', path: rect(2000, 500, 6000, 2500) }, name: 'Hall' }, ids),
      'room-blocked',
    )
    expect(rejection.problems[0]!.message).toBe('Overlaps Kitchen by 3.10 m².')
  })
})

describe('room.rename', () => {
  it('renames a Room and comes back again', () => {
    const { project, roomId } = attached()
    const next = expectRoundTrip(project, intent('room.rename', { roomId, name: 'Utility' }))
    expect(roomOf(next.project, roomId).name).toBe('Utility')
    expectRejection(next.project, intent('room.rename', { roomId, name: 'Utility' }), 'no-change')
  })
})

describe('room.setOutline', () => {
  it('restates an outline that keeps every referenced Edge on its face', () => {
    const { project, roomId, edgeId } = attached()
    // The caller keeps the Edge IDs it already has, which is what lets the reference survive.
    const kept = roomOf(project, roomId).outline.segmentIds
    const next = expectRoundTrip(
      project,
      intent('room.setOutline', { roomId, outline: { kind: 'path', path: rect(0, 50, 4000, 3050) } }, [...kept]),
    )
    expect(roomOf(next.project, roomId).outline.segmentIds).toContain(edgeId)
    expect(next.project.existingModel.rooms[0]!.wallFaceRefs).toHaveLength(1)
  })

  it('refuses an outline that moves a referenced Edge off the face it is attached to', () => {
    const { project, roomId } = attached()
    const kept = [...roomOf(project, roomId).outline.segmentIds]
    const rejection = expectRejection(
      project,
      intent('room.setOutline', { roomId, outline: { kind: 'path', path: rect(0, 400, 4000, 2400) } }, kept),
      'room-blocked',
    )
    expect(rejection.problems[0]!.message).toContain('is attached to W-1')
    expect(wallOf(project)).toBeTruthy()
  })
})

describe('room.attachFace', () => {
  it('records the face and slides the Edge onto it', () => {
    const { project, roomId, wallId, edgeId } = attached()
    const room = roomOf(project, roomId)
    expect(room.wallFaceRefs).toEqual([{ segmentId: edgeId, wallId, side: 'right' }])
    expect(room.outline.kind === 'path' && room.outline.path.segments[0]!.to).toEqual(pt(4000, 50))
  })

  it('refuses a face that is not parallel to the Edge', () => {
    const { project, roomId, wallId } = attached()
    const edge = roomOf(project, roomId).outline.segmentIds[1]!
    const rejection = expectRejection(project, intent('room.attachFace', { roomId, segmentId: edge, wallId, side: 'right' }), 'room-blocked')
    expect(rejection.problems[0]!.message).toBe('Kitchen edge 2 is not parallel to W-1, so it cannot lie on that face.')
  })

  it('says nothing has changed when the Edge already lies on that face', () => {
    const { project, roomId, wallId, edgeId } = attached()
    expectRejection(project, intent('room.attachFace', { roomId, segmentId: edgeId, wallId, side: 'right' }), 'no-change')
  })
})

describe('room.detachFace', () => {
  it('drops the reference and leaves the geometry where it was', () => {
    const { project, roomId, edgeId } = attached()
    const before = roomOf(project, roomId).outline
    const next = expectRoundTrip(project, intent('room.detachFace', { roomId, segmentId: edgeId }))
    expect(roomOf(next.project, roomId).wallFaceRefs).toEqual([])
    expect(roomOf(next.project, roomId).outline).toEqual(before)
    expectRejection(next.project, intent('room.detachFace', { roomId, segmentId: edgeId }), 'no-change')
  })
})

describe('a Wall edit that a referenced Room edge follows', () => {
  const topEdge = (project: Project, roomId: string): Pt | null => {
    const room = roomOf(project, roomId)
    if (room.outline.kind !== 'path') return null
    const at = room.outline.path.start
    return pt(Math.round(at.x * 1e6) / 1e6, Math.round(at.y * 1e6) / 1e6)
  }

  it('slides the Edge when the Wall gets thicker', () => {
    const { project, roomId, wallId } = attached()
    const next = expectRoundTrip(project, intent('wall.setThickness', { wallId, thickness: 200 }))
    expect(topEdge(next.project, roomId)).toEqual(pt(0, 100))
  })

  it('slides the Edge when the Wall is dragged sideways', () => {
    const { project, roomId, wallId } = attached()
    const next = expectApplied(project, intent('wall.dragBody', { wallId, delta: pt(0, 300) }))
    expect(topEdge(next.project, roomId)).toEqual(pt(0, 350))
  })

  it('refuses a Wall edit that turns the face the Edge lies on', () => {
    const { project, wallId } = attached()
    const rejection = expectRejection(project, intent('wall.setDirection', { wallId, directionDeg: 90 }), 'room-blocked')
    expect(rejection.problems[0]!.message).toBe('W-1 is referenced by Kitchen edge 1.')
  })

  it('refuses to delete a Wall a Room is standing on', () => {
    const { project, wallId } = attached()
    const rejection = expectRejection(project, intent('wall.delete', { wallId }), 'room-blocked')
    expect(rejection.problems[0]!.message).toBe(
      'W-1 is referenced by Kitchen edge 1. Detach, reattach, or remove the Room delta first.',
    )
  })

  it('refuses a move that would push the Room into its neighbour, and names the neighbour', () => {
    const { project, roomId, wallId } = attached()
    const [hallId, ...hallEdges] = source(5)
    const withHall = expectApplied(
      project,
      intent('room.create', { floorId: floorIdOf(project), outline: { kind: 'path', path: rect(0, -2000, 4000, -50) }, name: 'Hall' }, [hallId, ...hallEdges]),
    ).project
    const rejection = expectRejection(withHall, intent('wall.dragBody', { wallId, delta: pt(0, -1100) }), 'room-blocked')
    expect(rejection.problems[0]!.message).toBe("Kitchen edge 1 can't follow this change: it would overlap Hall.")
    expect(roomId).toBeTruthy()
  })
})

describe('room.placeShelter', () => {
  it('places the pack entry as Room, four Walls, four junctions and one door', () => {
    const project = walled()
    const ids = source(14)
    const next = expectRoundTrip(
      project,
      intent('room.placeShelter', { floorId: floorIdOf(project), centre: pt(10000, 10000), orientationDeg: 0 }, ids),
    )
    const model = next.project.existingModel
    const room = model.rooms.find((candidate) => candidate.id === ids[0])!
    expect(room.name).toBe('Room 1')
    expect(room.wallFaceRefs).toHaveLength(4)
    expect(model.walls).toHaveLength(5)
    expect(model.openings).toHaveLength(1)
    const door = model.openings[0]!
    expect(door).toMatchObject({ kind: 'door', label: 'Door 1', width: 700, sill: 0, head: 1900 })
    // The interior is 1450 × 1950 and every Wall stands half a thickness outside it.
    const shelter = model.walls.slice(1)
    expect(shelter.every((wall) => wall.thickness === 250)).toBe(true)
    expect(shelter.map((wall) => wall.ref)).toEqual(['W-2', 'W-3', 'W-4', 'W-5'])
    expect(model.wallJunctions.filter((junction) => junction.ends.length === 2)).toHaveLength(4)
  })

  it('refuses a shelter that would overlap a Room already drawn', () => {
    const { project } = attached()
    const rejection = expectRejection(
      project,
      intent('room.placeShelter', { floorId: floorIdOf(project), centre: pt(2000, 1000), orientationDeg: 0 }, source(14)),
      'room-blocked',
    )
    expect(rejection.problems[0]!.message).toContain('Overlaps Kitchen by')
  })
})

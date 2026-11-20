/**
 * The Wall derivation of one Floor (#64 §6, §7): faces keyed `(wallId, side)`, corners named
 * after the Walls that meet, lengths along the reference line, and the snap engine's view of the
 * same geometry with no reference-line point anywhere in it.
 */
import { describe, expect, it } from 'vitest'
import type { Project, Wall, WallJunction } from '../domain'
import type { SnapCandidate, SnapKind } from '../geometry'
import { pt, refLength } from '../geometry'
import { createDeriveCache } from './cache'
import { snapCandidates } from './snapCandidates'
import { domainFixture } from './testing'
import { deriveWalls } from './walls'

/** The committed v4 Floor with two joins: a mixed-thickness L and an arc meeting a line. */
const wallsProject = (): Project => domainFixture('v4/walls.json')

/** The basic Project with its Walls and Junctions replaced wholesale. */
const projectWith = (walls: readonly Wall[], junctions: readonly WallJunction[]): Project => {
  const base = domainFixture('v4/project-basic.json')
  return { ...base, existingModel: { ...base.existingModel, walls: [...walls], wallJunctions: [...junctions] } }
}

const lineWall = (id: string, ref: string, start: { x: number; y: number }, end: { x: number; y: number }): Wall => ({
  id,
  ref,
  floorId: 'floor-main',
  line: { kind: 'line', start, end },
  thickness: 100,
  justification: 'centre',
  baseElevation: 0,
  height: 2600,
})

const join = (id: string, ends: readonly { wallId: string; end: 'start' | 'end' }[]): WallJunction => ({
  id,
  floorId: 'floor-main',
  ends: ends.map((member) => ({ ...member })),
})

const offered = (project: Project): SnapCandidate[] => {
  const derived = deriveWalls(project, 'floor-main')
  return snapCandidates({
    geometry: [],
    walls: derived.snapSources,
    cursor: pt(2000, 0),
    gridSpacingMm: 0,
    angleIncrementDeg: 0,
    enabled: new Set<SnapKind>(['wallFace']),
  })
}

const atPoint = (found: readonly SnapCandidate[], x: number, y: number): boolean =>
  found.some((candidate) => Math.abs(candidate.point.x - x) < 0.001 && Math.abs(candidate.point.y - y) < 0.001)

describe('deriveWalls', () => {
  it('derives both faces of every Wall of the Floor, keyed by (wallId, side)', () => {
    const derived = deriveWalls(wallsProject(), 'floor-main')
    expect(derived.walls.map((wall) => wall.ref)).toEqual(['W-1', 'W-2', 'W-3'])
    expect(derived.faces).toHaveLength(6)
    expect(derived.faces.map((face) => face.key)).toEqual([
      'wall-1/left',
      'wall-1/right',
      'wall-2/left',
      'wall-2/right',
      'wall-3/left',
      'wall-3/right',
    ])
    for (const face of derived.faces) {
      expect(face.segment.kind === 'line' || face.segment.kind === 'arc').toBe(true)
      expect(derived.byId.get(face.wallId)?.ref).toBeDefined()
    }
  })

  it('measures each Wall along its reference line, never along a face', () => {
    const project = wallsProject()
    const derived = deriveWalls(project, 'floor-main')
    const stored = project.existingModel.walls
    for (const wall of derived.walls) {
      const line = stored.find((candidate) => candidate.id === wall.id)!.line
      expect(wall.length).toBeCloseTo(refLength(line), 9)
    }
    expect(derived.byId.get('wall-1')!.length).toBeCloseTo(4000, 9)
    expect(derived.byId.get('wall-2')!.length).toBeCloseTo(2700, 9)
    // The arc is longer than the chord its ends span.
    expect(derived.byId.get('wall-3')!.length).toBeGreaterThan(2000)
  })

  it('names a joined corner after both Walls and a free end after one (#64 §7)', () => {
    const derived = deriveWalls(wallsProject(), 'floor-main')
    const labels = derived.corners.map((corner) => corner.label)
    expect(labels).toContain('Corner of W-1 and W-2')
    expect(labels).toContain('Corner of W-1 and W-3')
    expect(labels).toContain('End of W-2')
    expect(labels).toContain('End of W-3')
    // Each corner is emitted once, and names the Walls that meet there.
    expect(new Set(derived.corners.map((c) => `${c.point.x}:${c.point.y}`)).size).toBe(derived.corners.length)
    for (const corner of derived.corners) {
      expect(corner.wallIds.length).toBe(corner.label.startsWith('End of') ? 1 : 2)
    }
    for (const corner of derived.corners) expect(corner.label).not.toMatch(/left|right/i)
  })

  it('emits no corner where a run-through pair carries straight across', () => {
    const project = projectWith(
      [lineWall('a', 'W-1', pt(0, 0), pt(3000, 0)), lineWall('b', 'W-2', pt(3000, 0), pt(6000, 0))],
      [join('j1', [{ wallId: 'a', end: 'end' }, { wallId: 'b', end: 'start' }])],
    )
    const derived = deriveWalls(project, 'floor-main')
    // Four free-end corners of one continuous 6000 mm band, and nothing at the meeting point.
    expect(derived.corners.map((corner) => corner.label).sort()).toEqual([
      'End of W-1',
      'End of W-1',
      'End of W-2',
      'End of W-2',
    ])
    expect(atPoint(offered(project), 3000, 0)).toBe(false)
    expect(derived.walls.every((wall) => wall.capStart || wall.capEnd)).toBe(true)
  })

  it('offers faces and face corners, and never a reference-line point (#64 criterion 5)', () => {
    const found = offered(wallsProject())
    expect(found.length).toBeGreaterThan(0)
    // W-1's reference line runs along y = 0: no endpoint, midpoint or projection of it is offered.
    expect(atPoint(found, 0, 0)).toBe(false)
    expect(atPoint(found, 4000, 0)).toBe(false)
    expect(atPoint(found, 2000, 0)).toBe(false)
    expect(found.some((c) => Math.abs(c.point.y) < 0.001 && c.point.x > 0 && c.point.x < 4000)).toBe(false)
    // The outer corner of the L is there, offset from the reference-line endpoint it replaced.
    const outer = found.filter((c) => c.label === 'Corner of W-1 and W-2')
    expect(outer.length).toBeGreaterThan(0)
    for (const corner of outer) {
      const offset = Math.hypot(corner.point.x - 4000, corner.point.y)
      expect(offset).toBeGreaterThan(0.01)
      expect(offset).toBeLessThanOrEqual(150)
    }
  })

  it('hands the snap engine one source per Wall, labelled W-n · face', () => {
    const derived = deriveWalls(wallsProject(), 'floor-main')
    expect(derived.snapSources.map((source) => source.label)).toEqual(['W-1 · face', 'W-2 · face', 'W-3 · face'])
    for (const source of derived.snapSources) expect(source.faces).toHaveLength(2)
    // Every corner a Wall offers is one of the Floor's corners, with the same label.
    for (const source of derived.snapSources) {
      for (const corner of source.corners) {
        expect(derived.corners.some((c) => c.label === corner.label && c.point.x === corner.point.x)).toBe(true)
      }
    }
  })

  it('derives nothing for a Floor with no Walls', () => {
    const derived = deriveWalls(wallsProject(), 'floor-mezz')
    expect(derived).toMatchObject({ walls: [], faces: [], corners: [], snapSources: [] })
    expect(derived.byId.size).toBe(0)
  })

  it('is deterministic: the same Project gives the same answer twice', () => {
    const project = wallsProject()
    expect(deriveWalls(project, 'floor-main')).toEqual(deriveWalls(project, 'floor-main'))
  })

  it('is memoised by (revision, floorId, optionId) through the derive cache', () => {
    const project = wallsProject()
    const cache = createDeriveCache()
    const first = cache.walls(project, 1, 'floor-main', null)
    expect(cache.walls(project, 1, 'floor-main', null)).toBe(first)
    expect(cache.walls(project, 1, 'floor-mezz', null)).not.toBe(first)
    // A new revision of the same Floor replaces its own entry rather than joining it.
    const next = cache.walls(project, 2, 'floor-main', null)
    expect(next).not.toBe(first)
    expect(next.walls.map((wall) => wall.ref)).toEqual(['W-1', 'W-2', 'W-3'])
  })

  it('derives a Floor of 150 Walls and 149 junctions without dropping a face', () => {
    const walls: Wall[] = []
    const junctions: WallJunction[] = []
    for (let i = 0; i < 150; i += 1) {
      const x = i * 1000
      walls.push(lineWall(`w${i}`, `W-${i + 1}`, pt(x, i % 2 === 0 ? 0 : 5000), pt(x + 1000, i % 2 === 0 ? 5000 : 0)))
      if (i > 0) junctions.push(join(`j${i}`, [{ wallId: `w${i - 1}`, end: 'end' }, { wallId: `w${i}`, end: 'start' }]))
    }
    const derived = deriveWalls(projectWith(walls, junctions), 'floor-main')
    expect(derived.walls).toHaveLength(150)
    expect(derived.faces).toHaveLength(300)
    expect(derived.corners.length).toBeGreaterThan(0)
    // Every corner of a dense Floor is named after Walls that exist on it.
    const refs = new Set(derived.walls.map((wall) => wall.ref))
    for (const corner of derived.corners) {
      for (const ref of corner.label.replace(/Corner of |End of /g, '').split(/, | and /)) expect(refs.has(ref)).toBe(true)
    }
  })
})

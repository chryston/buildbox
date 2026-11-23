/**
 * The Rooms scene fixture (#67 criterion 11).
 *
 * `fixtures/e2e/preview-seed/odd-shape-30.json` is what the browser specs open, and a fixture that
 * drifted from the issue would quietly make their assertions mean nothing. So this holds the
 * committed file — not the generator's in-memory Project, but the bytes the app loads — to the
 * scene as specified: one Floor; Walls W-1…W-5; a Kitchen as an L-shaped Custom Path; a Bedroom
 * from the Rectangle preset; `Base 600` (600 × 400) with two Placed Items.
 *
 * The assertion the fixture exists to make is the one the prototype failed: **every Room Edge that
 * runs along a Wall lies exactly on that Wall's Room-side face** (the prototype floated Rooms
 * 150–200 mm inside the faces). It is checked through `roomFaceCandidates`, the same derive the
 * face picker renders, at a 1 mm reach: an attached Edge must be offered its own face 0 mm away,
 * standing on it. The Bedroom cannot hold a reference — a preset Edge cannot be attached — so its
 * two face Edges are checked as evaluated geometry instead.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { currentSchemaOf } from '../domain/testing'
import { roomSegments, validateProject } from '../domain'
import type { Project } from '../domain'
import { deriveRooms, deriveWalls, roomFaceCandidates } from '../derive'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const seed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'odd-shape-30.json'), 'utf8'),
) as {
  dbName: string
  projects: { id: string; revision: number; schemaVersion: number; data: Project }[]
}

const project = currentSchemaOf(seed.projects[0]!.data, seed.projects[0]!.schemaVersion)
const floorId = project.floors[0]!.id
const walls = deriveWalls(project, floorId)
const rooms = project.existingModel.rooms
const kitchen = rooms.find((room) => room.name === 'Kitchen')!
const bedroom = rooms.find((room) => room.name === 'Bedroom')!
const derived = deriveRooms(project, floorId)

describe('the odd-shape-30 scene (#67 criterion 11)', () => {
  it('is one Floor with five Walls, W-1 to W-5, and it validates', () => {
    expect(validateProject(project).ok).toBe(true)
    expect(project.floors).toHaveLength(1)
    expect(project.existingModel.walls.map((wall) => wall.ref)).toEqual(['W-1', 'W-2', 'W-3', 'W-4', 'W-5'])
  })

  it('holds the Kitchen as an L-shaped Custom Path and the Bedroom as the Rectangle preset', () => {
    expect(rooms.map((room) => room.name)).toEqual(['Kitchen', 'Bedroom'])
    expect(kitchen.outline.kind).toBe('path')
    expect(roomSegments(kitchen.outline)).toHaveLength(6)
    expect(bedroom.outline.kind).toBe('preset')
    if (bedroom.outline.kind === 'preset') {
      expect(bedroom.outline.preset).toEqual({ kind: 'rectangle', width: 3500, depth: 3300 })
      expect(bedroom.outline.orientationDeg).toBe(0)
    }
    // The L: six Edges, and its bounds are the faces it stands on.
    const box = roomSegments(kitchen.outline).reduce(
      (acc, segment) => ({
        minX: Math.min(acc.minX, segment.from.x),
        minY: Math.min(acc.minY, segment.from.y),
        maxX: Math.max(acc.maxX, segment.from.x),
        maxY: Math.max(acc.maxY, segment.from.y),
      }),
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    )
    expect(box).toEqual({ minX: 700, minY: 700, maxX: 3950, maxY: 4600 })
  })

  it('leaves no Room Edge floating off the Wall face it runs along', () => {
    // Three of the Kitchen's six Edges claim a face, and each lies on it to within tolerance.
    expect(kitchen.wallFaceRefs).toHaveLength(3)
    for (const reference of kitchen.wallFaceRefs) {
      const ref = project.existingModel.walls.find((wall) => wall.id === reference.wallId)!.ref
      const offered = roomFaceCandidates(kitchen, reference.segmentId, walls, rooms, 1)
      const match = offered.find((each) => each.wallRef === ref && each.side === reference.side)
      expect(match, `edge ${reference.segmentId} does not lie on ${ref}'s ${reference.side} face`).toBeDefined()
      expect(match!.distanceMm).toBeLessThanOrEqual(0.01)
      expect(match!.onFace).toBe(true)
    }
    // The Bedroom is a preset, and a preset Edge holds no reference — the picker says
    // `Convert to Custom Path to attach this edge` rather than offering one.
    expect(bedroom.wallFaceRefs).toHaveLength(0)
    const path = derived.rooms.find((room) => room.id === bedroom.id)!.path
    const ys = [path.start.y, ...path.segments.map((segment) => segment.to.y)]
    const xs = [path.start.x, ...path.segments.map((segment) => segment.to.x)]
    // Its top Edge on W-1's Room-side face (y = 700) and its right Edge on W-2's (x = 9,500).
    expect(Math.min(...ys)).toBe(700)
    expect(Math.max(...xs)).toBe(9500)
  })

  it('carries Base 600 at 600 × 400 with two Placed Items, one in the Kitchen and one across it', () => {
    const design = project.itemDesigns.filter((each) => each.name === 'Base 600')
    expect(design).toHaveLength(1)
    expect(design[0]!.kind).toBe('generic')
    if (design[0]!.kind !== 'generic') return
    expect(design[0]!.footprint).toEqual({
      kind: 'preset',
      preset: { kind: 'rectangle', width: 600, depth: 400 },
      centre: { x: 0, y: 0 },
      orientationDeg: 0,
    })
    // The Item Origin sits at the footprint centre, so a placement's `translation` is the point
    // the footprint stands on — which is what puts the second Item across the Kitchen's Edge.
    expect(design[0]!.origin).toEqual({ x: 0, y: 0 })
    const placed = project.existingModel.placedItems.filter((each) => each.itemDesignId === design[0]!.id)
    expect(placed).toHaveLength(2)
    const relations = placed
      .map((each) => derived.membership.get(each.id)?.find((row) => row.roomName === 'Kitchen')?.relation)
      .sort()
    expect(relations).toEqual(['crosses', 'inside'])
  })

  it('keeps the two Rooms apart, because a positive-area overlap could never have committed', () => {
    const kitchenPath = derived.rooms.find((room) => room.id === kitchen.id)!.path
    const bedroomPath = derived.rooms.find((room) => room.id === bedroom.id)!.path
    const kitchenXs = [kitchenPath.start.x, ...kitchenPath.segments.map((s) => s.to.x)]
    const bedroomXs = [bedroomPath.start.x, ...bedroomPath.segments.map((s) => s.to.x)]
    expect(Math.max(...kitchenXs)).toBeLessThan(Math.min(...bedroomXs))
  })
})

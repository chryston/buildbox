/**
 * The renovation scene fixture (#69 criterion 1).
 *
 * `fixtures/e2e/preview-seed/renovation-36.json` is what the browser specs open and what every
 * test of a renovation edit starts from, so this holds the committed bytes — not the generator's
 * in-memory Project — to the scene as the issue specifies it: one Floor; Walls W-1…W-6; `Door 1`
 * and `Window 2` through W-3; `Window 3` through W-6; a Kitchen referencing W-5; `Base 600`
 * (600 × 400) with one Placed Item; and two Design Options, `Option A` and `Option B`, that hold
 * nothing at all.
 *
 * The last of those is the assertion the fixture exists to make. Every row of the issue's
 * renovation-edit table reads "…in Option A, and Option B is unchanged", which is only a sentence
 * with content if the starting state has both Options standing empty beside the Existing Model.
 * The same Project is committed as `fixtures/domain/v10/renovation.json`, the domain golden of the
 * step, and the two are checked to be the same Project — the file the app loads and the file the
 * migrator is tested against cannot be allowed to drift apart.
 *
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { currentSchemaOf } from '../domain/testing'
import { roomSegments, validateProject } from '../domain'
import type { Project } from '../domain'
import { deriveRooms, deriveWalls, effectiveModel, roomFaceCandidates } from '../derive'

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures')
const seed = JSON.parse(
  readFileSync(join(fixturesRoot, 'e2e', 'preview-seed', 'renovation-36.json'), 'utf8'),
) as {
  dbName: string
  projects: { id: string; revision: number; schemaVersion: number; data: Project }[]
}

const project = currentSchemaOf(seed.projects[0]!.data, seed.projects[0]!.schemaVersion)
const floorId = project.floors[0]!.id
const model = project.existingModel
const walls = deriveWalls(project, floorId)
const wallByRef = (ref: string) => model.walls.find((wall) => wall.ref === ref)!
const openingByLabel = (label: string) => model.openings.find((opening) => opening.label === label)!
const kitchen = model.rooms.find((room) => room.name === 'Kitchen')!
const bedroom = model.rooms.find((room) => room.name === 'Bedroom')!
const base600 = project.itemDesigns.find((design) => design.name === 'Base 600')!
const baseItems = model.placedItems.filter((placed) => placed.itemDesignId === base600.id)
const options = project.designOptions ?? []

/** The face candidates the picker would list for one Edge of one Room, at a 1 mm reach. */
const facesOf = (roomId: string, segmentId: string) =>
  roomFaceCandidates(
    model.rooms.find((room) => room.id === roomId)!,
    segmentId,
    walls,
    model.rooms.filter((room) => room.floorId === floorId),
    1,
  )

describe('the renovation-36 scene (#69 criterion 1)', () => {
  it('is one Floor with six Walls, W-1 to W-6, and it validates', () => {
    expect(validateProject(project).ok).toBe(true)
    expect(project.floors).toHaveLength(1)
    expect(model.walls.map((wall) => wall.ref)).toEqual(['W-1', 'W-2', 'W-3', 'W-4', 'W-5', 'W-6'])
    expect(walls.walls).toHaveLength(6)
  })

  it('is stored as a v8 Project, and the Library row says so', () => {
    expect(seed.projects[0]!.schemaVersion).toBe(8)
    expect(options.map((option) => option.name)).toEqual(['Option A', 'Option B'])
    // The other Project in the seed is the legacy Library row every scene seed carries. It owns no
    // Option, which is the state #69 §2 promises behaves exactly as in S7.
    const other = seed.projects[1]!.data
    expect(other.designOptions ?? []).toEqual([])
  })

  it('puts Door 1 and Window 2 through W-3 and Window 3 through W-6', () => {
    const w3 = wallByRef('W-3')
    const w6 = wallByRef('W-6')
    expect(openingByLabel('Door 1').hostWallId).toBe(w3.id)
    expect(openingByLabel('Window 2').hostWallId).toBe(w3.id)
    expect(openingByLabel('Window 3').hostWallId).toBe(w6.id)
    // The issue's own numbers: a 900 door, and two windows that leave W-3's other spans standing.
    expect(openingByLabel('Door 1')).toMatchObject({ kind: 'door', start: 800, width: 900, sill: 0 })
    expect(openingByLabel('Window 2')).toMatchObject({ kind: 'window', start: 3200, width: 1200, sill: 900 })
    expect(openingByLabel('Window 3')).toMatchObject({ kind: 'window', width: 900 })
    // Nothing is demolished and nothing is proposed: the Existing Model is the whole of the model.
    expect(model.walls.every((wall) => wall.predecessorIds === undefined)).toBe(true)
  })

  it('has room for the edits the issue makes: a 900 door on W-2 and a knock-through on W-4', () => {
    // `Cut a door` puts a 900 door on W-2 and `knockThrough` takes 600–1,800 of W-4, so both Walls
    // have to be longer than that with their Openings' clear spans in mind.
    expect(walls.byId.get(wallByRef('W-2').id)!.length).toBeGreaterThanOrEqual(6000)
    expect(walls.byId.get(wallByRef('W-4').id)!.length).toBeGreaterThanOrEqual(1800)
    // W-6 carries no Opening of its own kind beyond one window, so `Remove whole wall` has a
    // dependency review with exactly one thing in it.
    expect(model.openings.filter((opening) => opening.hostWallId === wallByRef('W-6').id)).toHaveLength(1)
  })

  it('references W-5 from the Kitchen, standing on its face', () => {
    expect(kitchen.outline.kind).toBe('path')
    expect(kitchen.wallFaceRefs).toHaveLength(1)
    const reference = kitchen.wallFaceRefs[0]!
    expect(reference.wallId).toBe(wallByRef('W-5').id)
    // The reference is real: the same derive the face picker renders offers that face at 0 mm.
    const offered = facesOf(kitchen.id, reference.segmentId).find((face) => face.wallId === reference.wallId)
    expect(offered?.onFace).toBe(true)
    expect(offered?.distanceMm).toBeCloseTo(0, 6)
    expect(offered?.side).toBe(reference.side)
  })

  it('holds the Bedroom as a preset clear of the Kitchen', () => {
    expect(bedroom.outline.kind).toBe('preset')
    expect(bedroom.wallFaceRefs).toHaveLength(0)
    // Clear of it, so a Kitchen successor that grows eastward has something to be refused against
    // (#69 criterion 4) — and the two Rooms are the only Rooms on this Floor.
    expect(model.rooms.map((room) => room.name)).toEqual(['Kitchen', 'Bedroom'])
    expect(deriveRooms(project, floorId).rooms.map((room) => room.name)).toEqual(['Kitchen', 'Bedroom'])
    const kitchenEdges = roomSegments(kitchen.outline)
    const bedroomEdges = roomSegments(bedroom.outline)
    const maxX = (edges: typeof kitchenEdges) =>
      Math.max(...edges.map((edge) => Math.max(edge.from.x, edge.segment.kind === 'line' ? edge.segment.to.x : edge.from.x)))
    const minX = (edges: typeof kitchenEdges) =>
      Math.min(...edges.map((edge) => Math.min(edge.from.x, edge.segment.kind === 'line' ? edge.segment.to.x : edge.from.x)))
    expect(minX(bedroomEdges)).toBeGreaterThan(maxX(kitchenEdges))
  })

  it('places Base 600 once, inside the Kitchen', () => {
    if (base600.kind !== 'generic' || base600.footprint.kind !== 'preset')
      throw new Error('Base 600 is not a generic Item Design with a preset footprint')
    expect(base600.footprint.preset).toEqual({ kind: 'rectangle', width: 600, depth: 400 })
    expect(baseItems).toHaveLength(1)
    const membership = deriveRooms(project, floorId).membership.get(baseItems[0]!.id) ?? []
    expect(membership.map((row) => `${row.roomName}=${row.relation}`)).toEqual(['Kitchen=inside'])
  })

  it('offers both Options empty, so every edit starts from the Existing Model', () => {
    for (const option of options) {
      expect(option.demolishedIds).toEqual([])
      expect(option.proposed).toEqual({ walls: [], wallJunctions: [], openings: [], rooms: [], beams: [], skirting: [], services: [], placedItems: [] })
      const effective = effectiveModel(project, floorId, option.id)
      expect(effective.standingWalls).toEqual(model.walls.filter((wall) => wall.floorId === floorId))
      expect(effective.walls.every((row) => row.renovationState === 'existing')).toBe(true)
      expect(effective.openings.every((row) => row.renovationState === 'existing')).toBe(true)
      expect(effective.rooms.every((row) => row.renovationState === 'existing')).toBe(true)
      expect(effective.placedItems.every((row) => row.renovationState === 'existing')).toBe(true)
    }
  })

  it('is the same Project as the v14 domain golden', () => {
    const golden = JSON.parse(
      readFileSync(join(fixturesRoot, 'domain', 'v14', 'renovation.json'), 'utf8'),
    ) as { domainSchemaVersion: number; project: Project }
    expect(golden.domainSchemaVersion).toBe(14)
    expect(validateProject(golden.project).ok).toBe(true)
    expect(golden.project).toEqual(project)
  })
})

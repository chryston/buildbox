/**
 * Generate `fixtures/bench/renovation-reference.json` (#69 Scope 16).
 *
 * The Project `npm run bench` measures the renovation budgets on: the S4 reference Project
 * (`fixtures/domain/v1/reference-project.json`, three Floors and 200 Placed Items on each) with the
 * Walls, Openings and Rooms that §8's shape always said would be added when the capabilities
 * arrived — 150 Walls, 60 Openings and 30 Rooms per Floor — plus three Design Options, each holding
 * 45 demolition records and 70 proposed entities.
 *
 * The shape is a ladder per Floor: 75 long rails 4,000 mm apart, 74 short rungs whose start is
 * hosted on a rail (so the Project carries hosted Junctions, which is what a renovation edit has to
 * carry along) and one free stub. Windows sit on the first 59 rails; the first rail of every Floor
 * carries a second window and a Room whose Edge is claimed from its face, because those are the
 * records `replaceInOption` has to follow. Rooms are 8,000 × 3,800 cells standing on consecutive
 * rails, so 30 of them never overlap.
 *
 * The Existing Model's bulk is written as records rather than drawn through Intents — 1,290 Walls,
 * Openings and Rooms would take a minute of full-project validation per Floor to draw, and the
 * point of this file is the shape, not the provenance. The three referencing Rooms are the
 * exception: they arrive through `room.create` and `room.attachFace`, so the face claim is the
 * derive's own answer and not this script's arithmetic. Everything is checked with `validateProject`
 * before a byte is written.
 *
 * It runs only with the flag on, because the Project it writes carries Design Options:
 *
 *   VITE_FF_RENOVATION=true npx vite-node scripts/make-renovation-reference.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyIntent, INTENT_LABELS } from '../src/edit'
import type { Intent, IntentType, PayloadOf } from '../src/edit'
import { deriveWalls, roomFaceCandidates } from '../src/derive'
import { migrateProject, validateProject } from '../src/domain'
import type { DesignOption, Opening, Project, Room, Wall, WallJunction } from '../src/domain'
import { designOptionsOf } from '../src/domain'
import { pt } from '../src/geometry'
import { canonicalJson, FF_RENOVATION } from '../src/lib'
import type { RoomOutlineShape } from '../src/edit'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = resolve(repoRoot, 'fixtures/domain/v1/reference-project.json')
const OUT = resolve(repoRoot, 'fixtures/bench/renovation-reference.json')

if (!FF_RENOVATION) throw new Error('run me with VITE_FF_RENOVATION=true: the Project I write carries Design Options')

const RAILS = 75
const RAIL_GAP = 4_000
const RAIL_LENGTH = 60_000
const RUNG_AT = 8_000
const RUNG_LENGTH = 3_000
const THICKNESS = 200
const HEIGHT = 2_600
const ROOM_WIDTH = 8_000
const ROOM_DEPTH = 3_800
const WINDOWS = 59
const ROOMS = 30
const DEMOLISHED_RAILS = 5
const DEMOLISHED_RUNGS = 40
const PROPOSED_WALLS = 60
const PROPOSED_OPENINGS = 10
const OPTION_NAMES = ['Option A', 'Option B', 'Option C']
const NOW = '2026-11-18T00:00:00.000Z'

let issued = 0
const newId = (kind: string): string => `${kind}-${String(++issued).padStart(4, '0')}`
const ids = (count: number): string[] => Array.from({ length: count }, () => newId('id'))

const envelope = JSON.parse(readFileSync(SOURCE, 'utf8')) as { domainSchemaVersion: number; project: Project }
const migrated = migrateProject(envelope.project, envelope.domainSchemaVersion, ids)
if (!migrated.ok) throw new Error(`reference-project.json: ${migrated.error.message}`)

/** `W-<n>` runs across the whole Project, proposed records included, which is what the app mints. */
let refCount = 0
const nextRef = (): string => `W-${String(++refCount)}`
let openingCount = 0

const walls: Wall[] = []
const wallJunctions: WallJunction[] = []
const openings: Opening[] = []
const rooms: Room[] = []

const addWall = (floorId: string, x1: number, y1: number, x2: number, y2: number): Wall => {
  const record: Wall = {
    id: newId('wall'),
    ref: nextRef(),
    floorId,
    line: { kind: 'line', start: pt(x1, y1), end: pt(x2, y2) },
    thickness: THICKNESS,
    justification: 'centre',
    baseElevation: 0,
    height: HEIGHT,
  }
  walls.push(record)
  return record
}

const addWindow = (host: Wall, start: number, width: number): Opening => {
  const record: Opening = {
    id: newId('opening'),
    floorId: host.floorId,
    hostWallId: host.id,
    kind: 'window',
    label: `Window ${String(++openingCount)}`,
    start,
    width,
    sill: 900,
    head: 2_100,
  }
  openings.push(record)
  return record
}

/** A rectangular cell as a Custom Path; the caller mints the Edge IDs it needs. */
function cellOutline(x: number, y: number): RoomOutlineShape {
  const corners = [pt(x, y), pt(x + ROOM_WIDTH, y), pt(x + ROOM_WIDTH, y + ROOM_DEPTH), pt(x, y + ROOM_DEPTH)]
  return {
    kind: 'path',
    path: {
      start: corners[0]!,
      segments: [...corners.slice(1), corners[0]!].map((to) => ({ kind: 'line' as const, to })),
    },
  }
}

const cellEdges = (): string[] => [newId('edge'), newId('edge'), newId('edge'), newId('edge')]

const railsByFloor: Wall[][] = []
const rungsByFloor: Wall[][] = []

migrated.project.floors.forEach((floor, fi) => {
  const x0 = 1_000_000 + fi * 200_000
  const y0 = 1_000_000
  const rails: Wall[] = []
  const rungs: Wall[] = []
  for (let index = 0; index < RAILS; index += 1) rails.push(addWall(floor.id, x0, y0 + index * RAIL_GAP, x0 + RAIL_LENGTH, y0 + index * RAIL_GAP))
  // A rung's start is hosted on its rail: the join a renovation edit has to carry.
  for (let index = 1; index < RAILS; index += 1) {
    const rung = addWall(floor.id, x0 + RUNG_AT, y0 + index * RAIL_GAP, x0 + RUNG_AT, y0 + index * RAIL_GAP + RUNG_LENGTH)
    rungs.push(rung)
    wallJunctions.push({
      id: newId('junction'),
      floorId: floor.id,
      ends: [{ wallId: rung.id, end: 'start' }],
      host: { wallId: rails[index]!.id, at: RUNG_AT },
    })
  }
  addWall(floor.id, x0 + 50_000, y0 + RAILS * RAIL_GAP, x0 + 52_000, y0 + RAILS * RAIL_GAP)
  for (let index = 0; index < WINDOWS; index += 1) addWindow(rails[index]!, 20_000, 1_200)
  // The Wall `replaceInOption` runs on: two Openings and, below, a Room that claims its face.
  addWindow(rails[0]!, 24_000, 1_200)
  // 29 cells; the 30th, on the first rail, is drawn by `room.create` below so its face claim is
  // the derive's. A cell stands on the − side of its rail, 100 mm off the reference line.
  for (let index = 1; index < ROOMS; index += 1) {
    const y = y0 + index * RAIL_GAP - THICKNESS / 2
    rooms.push({
      id: newId('room'),
      floorId: floor.id,
      name: `Room ${String(fi + 1)}-${String(index + 1)}`,
      outline: { ...cellOutline(x0 + 30_000, y - ROOM_DEPTH), segmentIds: cellEdges() },
      wallFaceRefs: [],
    })
  }
  railsByFloor.push(rails)
  rungsByFloor.push(rungs)
})

let project: Project = {
  ...migrated.project,
  existingModel: {
    ...migrated.project.existingModel,
    walls,
    wallJunctions,
    openings,
    rooms,
  },
}

const run = <T extends IntentType>(type: T, payload: PayloadOf<T>, taken: string[]): Project => {
  const intent: Intent = { type, payload, label: INTENT_LABELS[type], ids: taken, now: NOW } as Intent
  const applied = applyIntent(project, intent)
  if (!applied.ok) throw new Error(`${type} was refused: ${applied.code}`)
  project = applied.project
  return project
}

// The referencing Room: drawn, then claimed from the rail's face the same way the face picker does.
project.floors.forEach((floor, fi) => {
  const rail = railsByFloor[fi]![0]!
  const y = 1_000_000 - THICKNESS / 2
  const taken = ids(1 + 4)
  run('room.create', { floorId: floor.id, outline: cellOutline(1_000_000 + fi * 200_000 + 30_000, y - ROOM_DEPTH), name: `Room ${String(fi + 1)}-1` }, taken)
  const roomId = taken[0]!
  // Edge 3 is the one at the greater y: the Edge standing on the rail's face.
  const edgeId = taken[3]!
  const candidates = roomFaceCandidates(
    project.existingModel.rooms.find((each) => each.id === roomId)!,
    edgeId,
    deriveWalls(project, floor.id),
    project.existingModel.rooms.filter((each) => each.floorId === floor.id),
    1,
  )
  const face = candidates.find((candidate) => candidate.wallId === rail.id)
  if (face === undefined) throw new Error(`no face of ${rail.ref} offers the Room's Edge`)
  run('room.attachFace', { roomId, segmentId: edgeId, wallId: rail.id, side: face.side }, [])
})

// Three Options over the same demolition: five rails with nothing on them and the 40 rungs hosted
// on the first forty rails, replaced by 60 proposed Walls (five of them successors of those rails)
// carrying 10 proposed windows.
const designOptions: DesignOption[] = OPTION_NAMES.map((name, oi) => {
  const demolishedIds = [
    ...railsByFloor.flatMap((rails) => rails.slice(RAILS - DEMOLISHED_RAILS).map((rail) => rail.id)),
    ...rungsByFloor.flatMap((rungs) => rungs.slice(0, DEMOLISHED_RUNGS).map((rung) => rung.id)),
  ]
  const proposedWalls: Wall[] = []
  const proposedOpenings: Opening[] = []
  migrated.project.floors.forEach((floor, fi) => {
    const x0 = 1_000_000 + fi * 200_000
    const y0 = 1_000_000 + 400_000 + oi * 40_000
    for (let index = 0; index < PROPOSED_WALLS / 3; index += 1) {
      const predecessor = fi === 0 && index < DEMOLISHED_RAILS ? [demolishedIds[index]!] : []
      const record: Wall = {
        id: newId('wall'),
        ref: nextRef(),
        floorId: floor.id,
        line: { kind: 'line', start: pt(x0, y0 + index * RAIL_GAP), end: pt(x0 + 20_000, y0 + index * RAIL_GAP) },
        thickness: THICKNESS,
        justification: 'centre',
        baseElevation: 0,
        height: HEIGHT,
        predecessorIds: predecessor,
      }
      proposedWalls.push(record)
      if (index < PROPOSED_OPENINGS / 3) {
        proposedOpenings.push({
          id: newId('opening'),
          floorId: floor.id,
          hostWallId: record.id,
          kind: 'window',
          label: `Window ${String(++openingCount)}`,
          start: 5_000,
          width: 1_200,
          sill: 900,
          head: 2_100,
          predecessorIds: [],
        })
      }
    }
  })
  return { id: newId('option'), name, proposed: { walls: proposedWalls, wallJunctions: [], openings: proposedOpenings, rooms: [], placedItems: [] }, demolishedIds: [...demolishedIds].sort() }
})

project = { ...project, designOptions }

const checked = validateProject(project)
if (!checked.ok) throw new Error(`the reference Project is invalid:\n${checked.problems.slice(0, 12).map((problem) => `  ${problem.path} ${problem.code}: ${problem.message}`).join('\n')}`)

const counts = (option: DesignOption): string =>
  `${String(option.demolishedIds.length)} demolitions, ${String(
    option.proposed.walls.length + option.proposed.openings.length + option.proposed.rooms.length + option.proposed.placedItems.length + option.proposed.wallJunctions.length,
  )} proposed`

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `${canonicalJson({ domainSchemaVersion: 8, project })}\n`)

console.log(
  `make-renovation-reference: ${OUT}\n` +
    `  ${String(project.floors.length)} Floors, ${String(walls.length)} Walls, ${String(openings.length)} Openings, ` +
    `${String(project.existingModel.rooms.length)} Rooms, ${String(wallJunctions.length)} Junctions, ` +
    `${String(project.existingModel.placedItems.length)} Placed Items\n` +
    `  ${designOptionsOf(project).map((option) => `${option.name}: ${counts(option)}`).join('; ')}`,
)

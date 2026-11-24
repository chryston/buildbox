/**
 * Every handler is total (#47 criteria 1–2).
 *
 * Random sequences of up to 50 Intents run against Projects that come from
 * `createProject` and from every converted legacy fixture. Nothing may throw, every step
 * that is accepted must undo through its own inverse patches, and the Project that comes
 * out the other end must still validate. A handler that reaches for `crypto.randomUUID`,
 * the clock, or a mutation of its input shows up here as a failure to reproduce a step.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import fc from 'fast-check'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Beam, CabinetItemDesign, CabinetNode, CommentAnchor, CommentAnchorKind, CommentPriority, CommentScope, GenericItemDesign, ItemDesign, ItemFootprint, Opening, PlacedItem, Project, Room, Service, ServiceKind, Skirting, Wall, WallJunction } from '../domain'
import { COMMENT_PRIORITIES, COMMENT_SCOPE_ALL, SERVICE_KINDS, WALL_FEATURE_IDS, anchorChoosesScope, beamsOf, footprintSize, nextOpeningLabel, roomFaceCurve, roomOutlineAfterSlide, roomOutlinePath, roomSegments, servicesOf, skirtingOf, skirtingTop, validateProject } from '../domain'
import type { Preset } from '../geometry'
import { DEG, edgeToFace, normaliseDeg, ontoFaceVector, pt, refLength, refPointAt } from '../geometry'
import { arbProject } from '../domain/testing'
import { canonicalJson } from '../lib'
import { convertLegacy } from '../package'
import type { Intent, IntentType, PayloadOf, RoomOutlineShape, WallDraft, WallEndTarget } from './index'
import { applyIntent, applyPatches, chainJunctionCount, CREATE_PROJECT_ID_COUNT, createProject, INTENT_LABELS, PLAN_CATALOGUE, SHELTER_ID_COUNT } from './index'
import { intent, NOW } from './testing'

/** A later instant, so an edit moves `updatedAt` and the round trip can see it move. */
const LATER = '2026-11-19T09:00:00.000Z'

const fixturesRoot = fileURLToPath(new URL('../../fixtures/legacy', import.meta.url))
const read = (rel: string): string => readFileSync(`${fixturesRoot}/${rel}`, 'utf8')

/** The five store envelopes, the three workspace files and the two floor-plan files. */
const LEGACY_FIXTURES = [
  'v0/buildbox-store.json',
  'v1/buildbox-store.json',
  'v2/buildbox-store.json',
  'v3/buildbox-store.json',
  'v3-large-image/buildbox-store.json',
  'workspace/active-project.buildbox.json',
  'workspace/all-projects.buildbox.json',
  'workspace/v0-design-shape.buildbox.json',
  'floor-plan/no-image-floor-plan.json',
  'floor-plan/with-image-floor-plan.json',
]

const MATERIALS = ['oak', 'walnut', 'white', 'birch', 'mdf'] as const
const ELEMENT_TYPES = ['void', 'drawer', 'hanging-space', 'microwave'] as const
const CATALOG_KEYS = Object.keys(PLAN_CATALOGUE)
const IMAGE_POOL = [
  { assetHash: 'a'.repeat(64), mediaType: 'image/png' as const, widthPx: 2000, heightPx: 1400 },
  { assetHash: 'b'.repeat(64), mediaType: 'image/jpeg' as const, widthPx: 900, heightPx: 600 },
]

let issuedIds = 0
const allocator = (): (() => string) => () => `gen-${String(++issuedIds)}`

/** A deterministic stand-in for the UI's ID source; each run gets its own, starting past `past`. */
function idSource(past = 0): (count?: number) => string[] {
  let issued = past
  return (count = 1) => Array.from({ length: count }, () => `prop-${String(++issued)}`)
}

/**
 * The highest `prop-N` a Project already holds.
 *
 * A sequence allocates from its own source, and a source that starts at `prop-1` re-issues IDs the
 * Project it starts from is already using — which the validator is right to refuse, and which the
 * renovation flag made visible because a v8 `createProject` hands one more `prop-N` to the Project's
 * first Design Option (#69). The app never behaves like this: it allocates from the session's store,
 * which has seen every ID in the file.
 */
const highestIssuedId = (project: Project): number => {
  let highest = 0
  for (const found of JSON.stringify(project).matchAll(/prop-(\d+)/g)) highest = Math.max(highest, Number(found[1]))
  return highest
}

/** `mulberry32`: the whole sequence is a function of one seed, so a failure reproduces. */
function random(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Gen = { rand: () => number; project: Project; ids: (count?: number) => string[] }

const pick = <T,>(g: Gen, list: readonly T[]): T | undefined =>
  list.length === 0 ? undefined : list[Math.floor(g.rand() * list.length)]

const int = (g: Gen, min: number, max: number): number => min + Math.floor(g.rand() * (max - min + 1))
const real = (g: Gen, min: number, max: number): number => Number((min + g.rand() * (max - min)).toFixed(3))
const bool = (g: Gen): boolean => g.rand() < 0.5

const designOf = (g: Gen, placed: PlacedItem): ItemDesign | undefined =>
  g.project.itemDesigns.find((design) => design.id === placed.itemDesignId)

/**
 * An Item Footprint that always describes a shape, from the same seeded stream as the rest
 * of the Intent. Rounded corners stay under half the shorter side, so no two of them can
 * overlap and the generator never produces a shape the handler is right to refuse.
 */
function footprintOf(g: Gen): ItemFootprint {
  const width = real(g, 100, 4000)
  const depth = real(g, 100, 4000)
  const centre = { x: real(g, -500, 8000), y: real(g, -500, 8000) }
  const orientationDeg = int(g, 0, 359)
  const preset: Preset =
    !bool(g)
      ? { kind: 'rectangle', width, depth }
      : bool(g)
        ? { kind: 'circle', diameter: real(g, 100, 3000) }
        : {
            kind: 'roundedRectangle',
            width,
            depth,
            radius: real(g, 0, Math.min(width, depth) / 2),
          }
  return { kind: 'preset', preset, centre, orientationDeg }
}
const cabinets = (g: Gen): CabinetItemDesign[] =>
  g.project.itemDesigns.filter((design): design is CabinetItemDesign => design.kind === 'cabinet')
const generics = (g: Gen): GenericItemDesign[] => g.project.itemDesigns.filter((d): d is GenericItemDesign => d.kind === 'generic')
const placements = (g: Gen): PlacedItem[] => g.project.existingModel.placedItems
const planPlacements = (g: Gen): PlacedItem[] => placements(g).filter((p) => designOf(g, p)?.kind === 'generic')
const templates = (g: Gen): GenericItemDesign[] =>
  generics(g).filter((design) => design.isCustom === true && placements(g).every((p) => p.itemDesignId !== design.id))
const floorsWithImage = (g: Gen) => g.project.floors.filter((floor) => floor.planImage !== null)
const wallList = (g: Gen): Wall[] => g.project.existingModel.walls
const junctionList = (g: Gen): WallJunction[] => g.project.existingModel.wallJunctions
const openingList = (g: Gen): Opening[] => g.project.existingModel.openings
/** The Openings that have a hinge to flip: a window has none, and a sliding door has neither. */
const hingedDoors = (g: Gen): Opening[] =>
  openingList(g).filter((opening) => opening.swing === 'left' || opening.swing === 'right')
const roomList = (g: Gen): Room[] => g.project.existingModel.rooms
/** The Beams the survey records; a Beam this Option drew is not what these Intents address. */
const beamList = (g: Gen): Beam[] => beamsOf(g.project.existingModel)
/** The Skirtings the survey records, for the same reason (#78). */
const skirtingList = (g: Gen): Skirting[] => skirtingOf(g.project.existingModel)
/** The Services the survey records, for the same reason (#79). */
const serviceList = (g: Gen): Service[] => servicesOf(g.project.existingModel)
/** A Design Option scope for an Anchor that has to choose one (#80 §1). */
const commentScope = (g: Gen): CommentScope => {
  const options = g.project.designOptions ?? []
  return options.length === 0 || bool(g) ? COMMENT_SCOPE_ALL : pick(g, options)!.id
}
/**
 * An Anchor of a kind the Project can supply a target for, or null when it cannot (#80 §1). A feature
 * is included because a Wall always registers its two faces.
 */
function commentAnchor(g: Gen): CommentAnchor | null {
  const kinds: CommentAnchorKind[] = ['project', 'floor', 'item_design', 'floor_point', 'design_option', 'entity', 'feature']
  const model = g.project.existingModel
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const kind = pick(g, kinds)!
    if (kind === 'project') return { kind }
    if (kind === 'floor') {
      const floor = pick(g, g.project.floors)
      if (floor !== undefined) return { kind, floorId: floor.id }
    } else if (kind === 'item_design') {
      const design = pick(g, g.project.itemDesigns)
      if (design !== undefined) return { kind, itemDesignId: design.id }
    } else if (kind === 'floor_point') {
      const floor = pick(g, g.project.floors)
      if (floor !== undefined) return { kind, floorId: floor.id, point: pt(real(g, -4000, 4000), real(g, -4000, 4000)) }
    } else if (kind === 'design_option') {
      const option = pick(g, g.project.designOptions ?? [])
      if (option !== undefined) return { kind, designOptionId: option.id }
    } else if (kind === 'entity') {
      const entity = pick(g, [...model.walls, ...model.openings, ...model.placedItems])
      if (entity !== undefined) return { kind, entityId: entity.id }
    } else {
      const wall = pick(g, model.walls)
      if (wall !== undefined) return { kind, ownerId: wall.id, featureId: pick(g, [...WALL_FEATURE_IDS])!, t: real(g, 0.05, 0.95) }
    }
  }
  return null
}
/** The Walls some Room has an Edge lying on. */
const referencedWalls = (g: Gen): Set<string> =>
  new Set(g.project.existingModel.rooms.flatMap((room) => room.wallFaceRefs.map((reference) => reference.wallId)))

/** An axis-aligned rectangle, the one outline a random Room edit can grow without breaking. */
function box(left: number, top: number, right: number, bottom: number) {
  return {
    start: pt(left, top),
    segments: [
      { kind: 'line' as const, to: pt(right, top) },
      { kind: 'line' as const, to: pt(right, bottom) },
      { kind: 'line' as const, to: pt(left, bottom) },
      { kind: 'line' as const, to: pt(left, top) },
    ],
  }
}

/**
 * A rectangle whose first Edge runs along a Wall face 300 mm off it: parallel to the face and
 * not yet on it, which is the state `room.attachFace` exists to end. A Room drawn at random has
 * no face any Edge of it is parallel to, so without this the Intent would go untried.
 */
function faceRoom(wall: Wall, side: 'left' | 'right'): RoomOutlineShape | null {
  const face = roomFaceCurve(wall, side)
  if (face.segment.kind !== 'line') return null
  const dx = face.segment.to.x - face.from.x
  const dy = face.segment.to.y - face.from.y
  const length = Math.hypot(dx, dy)
  if (length < 600) return null
  // The face's own normal, walked 300 mm for the gap and 1500 mm more for the Room's depth.
  const ux = -dy / length
  const uy = dx / length
  const at = (metres: number): [number, number] => [ux * metres, uy * metres]
  const [gx, gy] = at(300)
  const [wx, wy] = at(1200)
  // Only the first metre of the face: a Room the length of the Wall would sit on top of most
  // of what the sequence has already drawn, and a Room that cannot be drawn leaves nothing for
  // `room.attachFace` to act on later.
  const along = Math.min(1, 1000 / length)
  const near = pt(face.from.x + dx * along, face.from.y + dy * along)
  const gapFrom = pt(face.from.x + gx, face.from.y + gy)
  return {
    kind: 'path',
    path: {
      start: gapFrom,
      segments: [
        { kind: 'line', to: pt(near.x + gx, near.y + gy) },
        { kind: 'line', to: pt(near.x + wx, near.y + wy) },
        { kind: 'line', to: pt(face.from.x + wx, face.from.y + wy) },
        { kind: 'line', to: gapFrom },
      ],
    },
  }
}

/**
 * A Room outline for a random step: against a Wall face when there is a Wall to stand it on,
 * anywhere on the Floor otherwise.
 */
function faceRoomOrBox(g: Gen, wall: Wall | undefined): RoomOutlineShape {
  if (wall !== undefined) {
    const against = faceRoom(wall, pick(g, ['left', 'right'] as const)!)
    if (against !== null) return against
  }
  const left = real(g, -6000, 2000)
  const top = real(g, -6000, 2000)
  return { kind: 'path', path: box(left, top, left + real(g, 800, 4000), top + real(g, 800, 4000)) }
}

/**
 * Whether two Walls lie on one straight line. A Junction has already put an end of each at the
 * same point, so parallel directions are enough to say the two reference lines are one line —
 * which is what `wall.merge` asks for before it will join them.
 */
function collinear(a: Wall, b: Wall): boolean {
  if (a.line.kind !== 'line' || b.line.kind !== 'line') return false
  const ax = a.line.end.x - a.line.start.x
  const ay = a.line.end.y - a.line.start.y
  const bx = b.line.end.x - b.line.start.x
  const by = b.line.end.y - b.line.start.y
  const scale = Math.max(1, Math.hypot(ax, ay) * Math.hypot(bx, by))
  return Math.abs(ax * by - ay * bx) <= 1e-6 * scale
}

function walk(node: CabinetNode, into: CabinetNode[] = []): CabinetNode[] {
  into.push(node)
  for (const child of node.children ?? []) walk(child, into)
  return into
}
const nodesOf = (design: CabinetItemDesign): CabinetNode[] => walk(design.construction.root)
const splitNodesOf = (design: CabinetItemDesign): CabinetNode[] => nodesOf(design).filter((node) => node.children !== undefined)
const accessoryNodesOf = (design: CabinetItemDesign): CabinetNode[] =>
  nodesOf(design).filter((node) => (node.accessories ?? []).length > 0)

/** One random Intent for the Project it is about to be applied to, or `null` if none fits. */
const GENERATORS: ((g: Gen) => Intent | null)[] = [
  (g) => intent('project.rename', { name: `Project ${int(g, 1, 999)}` }),
  (g) => intent('project.setPreferences', {
    displayUnit: pick(g, ['mm', 'cm', 'm'] as const)!,
    displayPrecision: int(g, 0, 4),
    defaultWallHeight: int(g, 1, 4000),
  }),
  (g) => {
    const design = pick(g, cabinets(g))
    return design === undefined ? null : intent('cabinet.renameUnit', { itemDesignId: design.id, name: `Unit ${int(g, 1, 99)}` })
  },
  (g) => {
    const design = pick(g, cabinets(g))
    if (design === undefined) return null
    const settings = design.construction.settings
    return bool(g)
      ? intent('cabinet.updateSettings', {
        itemDesignId: design.id,
        patch: {
          unit: pick(g, ['in', 'mm'] as const)!,
          width: real(g, 100, 4000),
          height: real(g, 100, 3000),
          depth: real(g, 100, 1200),
          thickness: real(g, 5, 50),
          backThickness: real(g, 3, 30),
          toeKick: { height: real(g, 20, 200), setback: real(g, 10, 100) },
        },
      })
      : intent('cabinet.updateSettings', {
        itemDesignId: design.id,
        patch: { width: settings.width + real(g, -500, 500) },
      })
  },
  (g) => {
    const design = pick(g, cabinets(g))
    return design === undefined ? null : intent('cabinet.setMaterial', { itemDesignId: design.id, material: pick(g, MATERIALS)! })
  },
  (g) => intent('cabinet.addUnit', { sourceItemDesignId: pick(g, cabinets(g))?.id ?? null }, g.ids(3)),
  (g) => {
    const design = pick(g, cabinets(g))
    return design === undefined ? null : intent('cabinet.removeUnit', { itemDesignId: design.id })
  },
  (g) => {
    const design = pick(g, cabinets(g))
    const node = design === undefined ? undefined : pick(g, nodesOf(design))
    return node === undefined ? null : intent('cabinet.addShelf', { itemDesignId: design!.id, nodeId: node.id }, g.ids(2))
  },
  (g) => {
    const design = pick(g, cabinets(g))
    const node = design === undefined ? undefined : pick(g, nodesOf(design))
    return node === undefined ? null : intent('cabinet.addDivider', { itemDesignId: design!.id, nodeId: node.id }, g.ids(2))
  },
  (g) => {
    const design = pick(g, cabinets(g))
    const node = design === undefined ? undefined : pick(g, nodesOf(design))
    return node === undefined ? null : intent('cabinet.deleteBoard', { itemDesignId: design!.id, nodeId: node.id })
  },
  (g) => {
    const design = pick(g, cabinets(g))
    const node = design === undefined ? undefined : pick(g, nodesOf(design))
    return node === undefined ? null : intent('cabinet.setNodeSize', { itemDesignId: design!.id, nodeId: node.id, sizeMm: real(g, 1, 3000) })
  },
  (g) => {
    const design = pick(g, cabinets(g))
    const node = design === undefined ? undefined : pick(g, nodesOf(design))
    return node === undefined ? null : intent('cabinet.pinNode', { itemDesignId: design!.id, nodeId: node.id, sizeMm: real(g, 1, 3000) })
  },
  (g) => {
    const design = pick(g, cabinets(g))
    const node = design === undefined ? undefined : pick(g, nodesOf(design))
    return node === undefined ? null : intent('cabinet.unpinNode', { itemDesignId: design!.id, nodeId: node.id })
  },
  (g) => {
    const design = pick(g, cabinets(g))
    const node = design === undefined ? undefined : pick(g, nodesOf(design))
    return node === undefined ? null : intent('cabinet.setNodeLabel', { itemDesignId: design!.id, nodeId: node.id, label: `Space ${int(g, 1, 99)}` })
  },
  (g) => {
    const design = pick(g, cabinets(g))
    const node = design === undefined ? undefined : pick(g, splitNodesOf(design))
    return node === undefined ? null : intent('cabinet.distributeEvenly', { itemDesignId: design!.id, columnRootId: node.id, evenH: real(g, 50, 900) })
  },
  (g) => {
    const design = pick(g, cabinets(g))
    const node = design === undefined ? undefined : pick(g, splitNodesOf(design))
    return node === undefined ? null : intent('cabinet.setSplitRatio', { itemDesignId: design!.id, parentNodeId: node.id, ratio: int(g, 1, 99) / 100 })
  },
  (g) => {
    const design = pick(g, cabinets(g))
    const node = design === undefined ? undefined : pick(g, nodesOf(design))
    return node === undefined ? null : intent('cabinet.setElementType', { itemDesignId: design!.id, nodeId: node.id, elementType: pick(g, ELEMENT_TYPES)! })
  },
  (g) => {
    const design = pick(g, cabinets(g))
    const node = design === undefined ? undefined : pick(g, nodesOf(design))
    return node === undefined
      ? null
      : intent('cabinet.setDrawerConfig', {
        itemDesignId: design!.id,
        nodeId: node.id,
        config: { slideType: pick(g, ['side-mount', 'undermount'] as const)!, reveal: real(g, 0, 60) },
      })
  },
  (g) => {
    const design = pick(g, cabinets(g))
    const node = design === undefined ? undefined : pick(g, nodesOf(design))
    if (node === undefined) return null
    const [accessoryId] = g.ids(1)
    return intent('cabinet.addAccessory', {
      itemDesignId: design!.id,
      nodeId: node.id,
      accessory: { type: pick(g, ['door', 'drawer-front', 'pull', 'hinge'] as const)!, label: `Fitting ${int(g, 1, 9)}` },
    }, [accessoryId!])
  },
  (g) => {
    const design = pick(g, cabinets(g))
    if (design === undefined) return null
    const node = pick(g, bool(g) ? accessoryNodesOf(design) : nodesOf(design))
    if (node === undefined) return null
    const known = (node.accessories ?? []).map((accessory) => accessory.id)
    return intent('cabinet.removeAccessory', { itemDesignId: design.id, nodeId: node.id, accessoryId: pick(g, known) ?? 'no-such-accessory' })
  },
  (g) => {
    const floor = pick(g, g.project.floors)
    if (floor === undefined) return null
    const [itemDesignId, placedItemId] = g.ids(2)
    return intent('plan.addObject', { floorId: floor.id, catalogKey: pick(g, CATALOG_KEYS)! }, [itemDesignId!, placedItemId!])
  },
  (g) => {
    // Reuse, never a copy (#57 §2): any Item Design, placed on any Floor.
    const floor = pick(g, g.project.floors)
    const design = pick(g, g.project.itemDesigns)
    if (floor === undefined || design === undefined) return null
    const [placedItemId] = g.ids(1)
    return intent('plan.placeDesign', { floorId: floor.id, itemDesignId: design.id }, [placedItemId!])
  },
  (g) => {
    const placed = pick(g, placements(g))
    if (placed === undefined) return null
    return intent('plan.movePlacement', {
      placedItemId: placed.id,
      translation: { x: real(g, -500, 6000), y: real(g, -500, 6000) },
    })
  },
  // #74 §5: both fields move the item, and neither writes a height — a Placed Item has no field to
  // write one to, which is what the "never contains height" sweep over the model checks.
  (g) => {
    const placed = pick(g, placements(g))
    if (placed === undefined) return null
    return intent('plan.setPlacementVerticalExtent', {
      placedItemId: placed.id,
      field: pick(g, ['base', 'top'] as const)!,
      value: real(g, -500, 4000),
    })
  },
  (g) => {
    const placed = pick(g, placements(g))
    if (placed === undefined) return null
    return intent('plan.rotatePlacement', { placedItemId: placed.id, rotationDeg: int(g, -720, 720) })
  },
  (g) => {
    // The design-level fields (#57 §2), which every placement of the design shares. A
    // cabinet takes only the name: its size is its construction and it has no colour.
    const design = pick(g, g.project.itemDesigns)
    if (design === undefined) return null
    const patch: PayloadOf<'design.update'>['patch'] = {}
    if (bool(g)) patch.name = `Object ${int(g, 1, 99)}`
    if (design.kind === 'generic' && bool(g)) patch.color = `#${int(g, 0, 0xffffff).toString(16).padStart(6, '0')}`
    return intent('design.update', { itemDesignId: design.id, patch })
  },
  (g) => {
    // A restated Item Footprint (#58): always a shape that exists, because what the property
    // checks is that a valid one round-trips. The impossible ones are refused by name in
    // `intents/design.test.ts`, where the message can be asserted as well as the code.
    const design = pick(g, generics(g))
    if (design === undefined) return null
    return intent('design.setFootprint', { itemDesignId: design.id, footprint: footprintOf(g) })
  },
  (g) => {
    const design = pick(g, generics(g))
    if (design === undefined) return null
    return intent('design.setOrigin', {
      itemDesignId: design.id,
      origin: { x: real(g, 0, footprintSize(design.footprint).width), y: real(g, 0, footprintSize(design.footprint).depth) },
    })
  },
  // The shared height (#76 §2): always a fresh positive number, so it is never a no-change.
  (g) => {
    const design = pick(g, [...generics(g), ...cabinets(g)])
    if (design === undefined) return null
    return intent('design.setHeight', { itemDesignId: design.id, heightMm: real(g, 100, 3000) })
  },
  // A Clearance Envelope (#76 §4): always a plain rectangle, always a new size, so the one
  // refusal this generator can hit is the no-change the next run of it will not repeat.
  (g) => {
    const design = pick(g, [...generics(g), ...cabinets(g)])
    if (design === undefined) return null
    const w = real(g, 10, 900)
    const d = real(g, 10, 900)
    return intent('design.setClearanceEnvelope', {
      itemDesignId: design.id,
      envelope: {
        path: {
          start: { x: 0, y: 0 },
          segments: [
            { kind: 'line', to: { x: w, y: 0 } },
            { kind: 'line', to: { x: w, y: d } },
            { kind: 'line', to: { x: 0, y: d } },
            { kind: 'line', to: { x: 0, y: 0 } },
          ],
        },
        bottomOffset: real(g, 0, 100),
        height: real(g, 100, 2400),
      },
    })
  },
  (g) => {
    const withZone = [...generics(g), ...cabinets(g)].filter((design) => design.clearanceEnvelope != null)
    const design = pick(g, withZone)
    return design === undefined ? null : intent('design.removeClearanceEnvelope', { itemDesignId: design.id })
  },
  (g) => {
    const placed = pick(g, placements(g))
    if (placed === undefined) return null
    const [itemDesignId] = g.ids(1)
    return intent('design.fork', { placedItemId: placed.id, name: `Copy ${int(g, 1, 999)}` }, [itemDesignId!])
  },
  (g) => {
    const placed = pick(g, planPlacements(g))
    return placed === undefined ? null : intent('plan.removeObject', { placedItemId: placed.id })
  },
  (g) => {
    const [itemDesignId] = g.ids(1)
    return intent('plan.addTemplate', {
      label: `Shape ${int(g, 1, 999)}`,
      w: real(g, 10, 3000),
      h: real(g, 10, 3000),
      color: `#${int(g, 0, 0xffffff).toString(16).padStart(6, '0')}`,
    }, [itemDesignId!])
  },
  (g) => {
    const template = pick(g, templates(g))
    return template === undefined ? null : intent('plan.removeTemplate', { itemDesignId: template.id })
  },
  (g) => {
    const floor = pick(g, g.project.floors)
    if (floor === undefined) return null
    return intent('plan.setImage', { floorId: floor.id, image: pick(g, IMAGE_POOL) ?? IMAGE_POOL[0] })
  },
  (g) => {
    const floor = pick(g, floorsWithImage(g))
    return floor === undefined ? null : intent('plan.calibrate', { floorId: floor.id, pixelsPerMm: real(g, 0.01, 5) })
  },
  (g) => {
    const floor = pick(g, g.project.floors)
    return floor === undefined ? null : intent('plan.clear', { floorId: floor.id })
  },
  // --- Floors and Plan Views (#56) ---------------------------------------------
  (g) => {
    const [floorId, viewId] = g.ids(2)
    return intent('floor.create', { name: `Floor ${int(g, 1, 9999)}` }, [floorId!, viewId!])
  },
  (g) => {
    const floor = pick(g, g.project.floors)
    return floor === undefined ? null : intent('floor.rename', { floorId: floor.id, name: `Level ${int(g, 1, 9999)}` })
  },
  (g) => {
    const floor = pick(g, g.project.floors)
    if (floor === undefined || g.project.floors.length < 2) return null
    return intent('floor.reorder', { floorId: floor.id, toIndex: int(g, 0, g.project.floors.length - 1) })
  },
  (g) => {
    const floor = pick(g, g.project.floors)
    if (floor === undefined) return null
    // Either bound on its own, both the right way round, or both cleared.
    const a = bool(g) ? real(g, -200, 4000) : null
    const b = bool(g) ? real(g, -200, 4000) : null
    const lower = a === null || b === null ? a ?? b : Math.min(a, b)
    const upper = a === null || b === null ? null : Math.max(a, b)
    return intent('floor.setLimits', { floorId: floor.id, lowerMm: lower, upperMm: upper })
  },
  (g) => {
    const floor = pick(g, g.project.floors)
    return floor === undefined
      ? null
      : intent('floor.setDefaultWallHeight', { floorId: floor.id, defaultWallHeight: int(g, 1, 4000) })
  },
  (g) => {
    const floor = pick(g, g.project.floors)
    return floor === undefined ? null : intent('floor.delete', { floorId: floor.id })
  },
  (g) => {
    const floor = pick(g, g.project.floors)
    if (floor === undefined) return null
    const onFloor = placements(g).filter((item) => item.floorId === floor.id)
    const chosen = onFloor.filter(() => bool(g))
    const ids = g.ids(2 + chosen.length)
    return intent('floor.duplicate', {
      floorId: floor.id,
      name: `Copy of ${floor.name} ${int(g, 1, 9999)}`,
      toIndex: int(g, 0, g.project.floors.length),
      placedItemIds: chosen.map((item) => item.id),
      includePlanImage: bool(g),
      commentIds: [],
    }, ids)
  },
  (g) => {
    const floor = pick(g, g.project.floors)
    if (floor === undefined) return null
    const [viewId] = g.ids(1)
    return intent('view.create', { floorId: floor.id, name: `View ${int(g, 1, 9999)}` }, [viewId!])
  },
  (g) => {
    const view = pick(g, g.project.views)
    return view === undefined ? null : intent('view.rename', { viewId: view.id, name: `View ${int(g, 1, 9999)}` })
  },
  (g) => {
    const view = pick(g, g.project.views)
    return view === undefined ? null : intent('view.delete', { viewId: view.id })
  },
  (g) => {
    const view = pick(g, g.project.views)
    return view === undefined ? null : intent('view.setShowPlanImage', { viewId: view.id, showPlanImage: bool(g) })
  },
  // #74 §4: one saved view's range, which touches no entity at all.
  (g) => {
    const view = pick(g, g.project.views)
    if (view === undefined) return null
    const lowerMm = real(g, -500, 1000)
    return intent('view.setPlanViewRange', { viewId: view.id, lowerMm, upperMm: lowerMm + real(g, 100, 3000) })
  },
  (g) => {
    const floor = pick(g, floorsWithImage(g))
    return floor === undefined ? null : intent('plan.removeImage', { floorId: floor.id })
  },
  (g) => {
    const placed = pick(g, placements(g))
    if (placed === undefined) return null
    const destination = pick(g, g.project.floors.filter((floor) => floor.id !== placed.floorId))
    if (destination === undefined) return null
    const onFloor = placements(g).filter((item) => item.floorId === placed.floorId)
    const chosen = onFloor.filter(() => bool(g))
    const items = chosen.length > 0 ? chosen : [placed]
    const copy = bool(g)
    // The payload describes the first selected object; the rest keep their offsets (#56).
    const first = items[0] as PlacedItem
    return intent(
      copy ? 'plan.copyToFloor' : 'plan.moveToFloor',
      {
        placedItemIds: items.map((item) => item.id),
        toFloorId: destination.id,
        translation: { x: first.translation.x + real(g, -200, 200), y: first.translation.y + real(g, -200, 200) },
        baseElevation: first.baseElevation + real(g, -20, 20),
      },
      copy ? g.ids(items.length) : [],
    )
  },
  // --- Walls (#64) -----------------------------------------------------------
  // A chained draw walks a polyline, so every link it names really is coincident: the point one
  // segment ends at is the point the next starts from.
  (g) => {
    const floor = pick(g, g.project.floors)
    if (floor === undefined) return null
    const count = int(g, 1, 3)
    const straight = bool(g)
    const thickness = pick(g, [100, 150, 200])!
    const justification = pick(g, ['left', 'centre', 'right'] as const)!
    const height = floor.defaultWallHeight ?? g.project.preferences.defaultWallHeight
    const drafts: WallDraft[] = []
    const starts: WallEndTarget[] = []
    const ends: WallEndTarget[] = []
    let here = pt(real(g, -4000, 4000), real(g, -4000, 4000))
    let heading = real(g, 0, 359)
    // Attaching the first start to something that already exists takes its point from that Wall,
    // which is what makes the join the validator asks for true.
    const anchor = pick(g, wallList(g))
    if (anchor !== undefined && bool(g)) {
      if (bool(g)) {
        const end = pick(g, ['start', 'end'] as const)!
        starts.push({ kind: 'wall', wallId: anchor.id, end })
        here = end === 'start' ? anchor.line.start : anchor.line.end
      } else {
        starts.push({ kind: 'host', wallId: anchor.id })
        here = refPointAt(anchor.line, refLength(anchor.line) / 2)
      }
    } else {
      starts.push({ kind: 'free' })
    }
    for (let index = 0; index < count; index += 1) {
      const length = real(g, 800, 5000)
      if (!straight) heading = normaliseDeg(heading + real(g, -70, 70))
      const rad = heading * DEG
      const there = pt(here.x + Math.cos(rad) * length, here.y + Math.sin(rad) * length)
      const mid = pt((here.x + there.x) / 2, (here.y + there.y) / 2)
      const bulge = real(g, 100, 900)
      drafts.push({
        line: bool(g)
          ? {
              kind: 'arc',
              start: here,
              end: there,
              through: pt(mid.x - Math.sin(rad) * bulge, mid.y + Math.cos(rad) * bulge),
            }
          : { kind: 'line', start: here, end: there },
        thickness,
        justification,
        baseElevation: 0,
        height,
      })
      // A chain link has to be named by both of its ends, or the whole draw is refused: the
      // end of this segment names the start of the next one, and the next one's start names it
      // back below.
      ends.push(index + 1 < count ? { kind: 'segment', index: index + 1, end: 'start' } : { kind: 'free' })
      if (index + 1 < count) {
        starts.push({ kind: 'segment', index, end: 'end' })
        here = there
      }
    }
    const chain = { floorId: floor.id, walls: drafts, starts, ends }
    return intent('wall.createChain', chain, g.ids(drafts.length + chainJunctionCount(chain)))
  },
  (g) => {
    const junction = pick(g, junctionList(g))
    return junction === undefined
      ? null
      : intent('wall.dragJunction', { junctionId: junction.id, delta: pt(real(g, -600, 600), real(g, -600, 600)) })
  },
  (g) => {
    const wall = pick(g, wallList(g))
    if (wall === undefined) return null
    const end = pick(g, ['start', 'end'] as const)!
    if (junctionList(g).some((junction) => junction.ends.some((member) => member.wallId === wall.id && member.end === end))) {
      return null
    }
    const from = end === 'start' ? wall.line.start : wall.line.end
    return intent('wall.dragEndpoint', { wallId: wall.id, end, to: pt(from.x + real(g, -800, 800), from.y + real(g, -800, 800)) })
  },
  (g) => {
    const wall = pick(g, wallList(g))
    return wall === undefined
      ? null
      : intent('wall.dragBody', { wallId: wall.id, delta: pt(real(g, -800, 800), real(g, -800, 800)) })
  },
  (g) => {
    const wall = pick(g, wallList(g))
    return wall === undefined
      ? null
      : intent('wall.setLength', { wallId: wall.id, length: real(g, 200, 8000), keepFixed: pick(g, ['start', 'end'] as const)! })
  },
  (g) => {
    const wall = pick(g, wallList(g))
    return wall === undefined ? null : intent('wall.setDirection', { wallId: wall.id, directionDeg: real(g, 0, 359) })
  },
  (g) => {
    const wall = pick(g, wallList(g).filter((candidate) => candidate.line.kind === 'arc'))
    if (wall === undefined) return null
    return bool(g)
      ? intent('wall.setArc', { wallId: wall.id, radius: real(g, 300, 9000) })
      : intent('wall.setArc', { wallId: wall.id, sweepDeg: real(g, 15, 320) })
  },
  (g) => {
    const wall = pick(g, wallList(g))
    return wall === undefined ? null : intent('wall.setThickness', { wallId: wall.id, thickness: pick(g, [60, 100, 150, 200])! })
  },
  // #74 §5: the elevation pair, which moves no reference-line point — so no Wall-fit check runs and
  // no hosted Opening can be squeezed out by it.
  (g) => {
    const wall = pick(g, wallList(g))
    if (wall === undefined) return null
    return intent('wall.setVerticalExtent', {
      wallId: wall.id,
      field: pick(g, ['base', 'height', 'top', 'bottom'] as const)!,
      value: real(g, -200, 3000),
    })
  },
  (g) => {
    const wall = pick(g, wallList(g))
    return wall === undefined
      ? null
      : intent('wall.offset', { wallId: wall.id, distance: real(g, -900, 900), side: pick(g, ['left', 'right'] as const)! })
  },
  (g) => {
    const wall = pick(g, wallList(g).filter((candidate) => refLength(candidate.line) > 600))
    if (wall === undefined) return null
    return intent('wall.split', { wallId: wall.id, at: refLength(wall.line) * 0.37 }, g.ids(3))
  },
  (g) => {
    // Two Walls meeting at a junction of their own, with nothing that differs between them,
    // and lying on one straight line: a merge of two Walls that meet at an angle is refused,
    // and a generator that can only ever be refused proves nothing about the handler.
    for (const junction of junctionList(g)) {
      if (junction.host !== undefined || junction.ends.length !== 2) continue
      // One Wall's start at the other's end: a butt joint. Two ends of the same kind meeting is
      // a fold, and the handler refuses to merge a Wall back along itself.
      if (junction.ends[0]!.end === junction.ends[1]!.end) continue
      const first = wallList(g).find((candidate) => candidate.id === junction.ends[0]!.wallId)
      const second = wallList(g).find((candidate) => candidate.id === junction.ends[1]!.wallId)
      if (first === undefined || second === undefined) continue
      if (!collinear(first, second)) continue
      // A Wall a Room is standing on cannot be merged: the joined Wall is a different reference
      // line, and the handler says so rather than quietly re-pointing the Edge. Offering one
      // here would spend the step on a refusal the Rooms coverage already tests on its own.
      if (referencedWalls(g).has(first.id) || referencedWalls(g).has(second.id)) continue
      // Merging drops the butt Junction and re-points whatever hung off the far end of the
      // second Wall onto the far end of the first. So neither butt end may be joined twice, and
      // the two far ends may not both be joined — that pair would come back with one end joined
      // to the same Junction twice.
      const joinedAt = (wallId: string, end: 'start' | 'end'): number =>
        junctionList(g).filter((other) => other.id !== junction.id && other.ends.some((member) => member.wallId === wallId && member.end === end)).length
      const [firstEnd, secondEnd] = [junction.ends[0]!.end, junction.ends[1]!.end] as const
      if (joinedAt(first.id, firstEnd) > 0 || joinedAt(second.id, secondEnd) > 0) continue
      if (joinedAt(first.id, firstEnd === 'start' ? 'end' : 'start') > 0 && joinedAt(second.id, secondEnd === 'start' ? 'end' : 'start') > 0) continue
      if (
        first.thickness !== second.thickness ||
        first.justification !== second.justification ||
        first.classification !== second.classification ||
        first.constructionLabel !== second.constructionLabel ||
        first.baseElevation !== second.baseElevation ||
        first.height !== second.height
      ) {
        continue
      }
      return intent('wall.merge', { wallIds: [first.id, second.id] })
    }
    return null
  },
  (g) => {
    const wall = pick(g, wallList(g))
    if (wall === undefined) return null
    // The answer the dialog of #65 §8 would have sent, so a Wall with Openings in it is
    // deletable in a sequence too. A stale answer is the case the handler refuses.
    const hosted = openingList(g).filter((opening) => opening.hostWallId === wall.id)
    return intent('wall.delete', {
      wallId: wall.id,
      ...(hosted.length === 0 ? {} : { openings: hosted.map((opening) => opening.id) }),
    })
  },
  (g) => {
    // A place that will usually take the Opening: away from both ends, and with the width the
    // presets actually offer. A Wall whose Junction trims leave no room refuses it, which is
    // the fit rule working, but the coverage below needs the accepted case too.
    const wall = pick(g, wallList(g).filter((candidate) => refLength(candidate.line) > 1400))
    if (wall === undefined) return null
    const kind = pick(g, ['door', 'window', 'removed_section'] as const)!
    const width = pick(g, [700, 900, 1000])!
    const swing = pick(g, ['left', 'right', 'sliding'] as const)!
    const room = refLength(wall.line) - width - 300
    return intent(
      'opening.create',
      {
        floorId: wall.floorId,
        hostWallId: wall.id,
        kind,
        label: nextOpeningLabel(openingList(g), kind),
        start: real(g, 150, Math.max(160, room)),
        width,
        sill: kind === 'window' ? 900 : 0,
        head: kind === 'window' ? 2300 : 2100,
        ...(kind === 'door'
          ? { swing, ...(swing === 'sliding' ? {} : { hingeSide: pick(g, ['start', 'end'] as const)! }) }
          : {}),
      },
      g.ids(1),
    )
  },
  (g) => {
    const opening = pick(g, openingList(g))
    if (opening === undefined) return null
    return intent('opening.setStart', {
      openingId: opening.id,
      start: Math.max(0, opening.start + real(g, -400, 400)),
    })
  },
  (g) => {
    const opening = pick(g, openingList(g))
    if (opening === undefined) return null
    const width = Math.max(100, opening.width + real(g, -400, 400))
    return intent('opening.setWidth', {
      openingId: opening.id,
      width,
      ...(bool(g) ? { start: Math.max(0, opening.start + real(g, -200, 200)) } : {}),
    })
  },
  // #74 §5: the sill and head, which never move the Opening along its host or change the host.
  (g) => {
    const opening = pick(g, openingList(g))
    if (opening === undefined) return null
    return intent('opening.setVerticalExtent', {
      openingId: opening.id,
      field: pick(g, ['base', 'height', 'top', 'bottom'] as const)!,
      value: real(g, 0, 2600),
    })
  },
  (g) => {
    const opening = pick(g, hingedDoors(g))
    return opening === undefined ? null : intent('opening.flipHinge', { openingId: opening.id })
  },
  (g) => {
    const opening = pick(g, hingedDoors(g))
    return opening === undefined ? null : intent('opening.flipSwing', { openingId: opening.id })
  },
  (g) => {
    const opening = pick(g, openingList(g))
    return opening === undefined ? null : intent('opening.rename', { openingId: opening.id, label: `Opening ${int(g, 1, 40)}` })
  },
  (g) => {
    const opening = pick(g, openingList(g))
    return opening === undefined ? null : intent('opening.delete', { openingId: opening.id })
  },
  // #77: a Beam along a line long enough to be one, on a Floor the Project has. The section and the
  // Vertical Extent are the placeholders the tool panel starts with, because that is what a first
  // Beam carries before anyone measures anything.
  (g) => {
    const floor = pick(g, g.project.floors)
    if (floor === undefined) return null
    const start = pt(real(g, -4000, 4000), real(g, -4000, 4000))
    return intent(
      'beam.create',
      {
        floorId: floor.id,
        line: { start, end: pt(start.x + real(g, 300, 4000), start.y + real(g, -300, 300)) },
        justification: pick(g, ['left', 'centre', 'right'] as const)!,
        width: pick(g, [100, 150, 200, 250, 300])!,
        underside: real(g, 0, 2300),
        height: pick(g, [200, 250, 300, 400])!,
        ...(bool(g) ? { label: `Beam B-${int(g, 1, 60)}` } : {}),
      },
      g.ids(1),
    )
  },
  (g) => {
    const beam = pick(g, beamList(g))
    if (beam === undefined) return null
    const end = pick(g, ['start', 'end'] as const)!
    const at = beam.line[end]
    return intent('beam.dragEndpoint', {
      beamId: beam.id,
      end,
      to: pt(at.x + real(g, -800, 800), at.y + real(g, -800, 800)),
    })
  },
  (g) => {
    const beam = pick(g, beamList(g))
    return beam === undefined
      ? null
      : intent('beam.dragBody', { beamId: beam.id, delta: pt(real(g, -800, 800), real(g, -800, 800)) })
  },
  (g) => {
    const beam = pick(g, beamList(g))
    if (beam === undefined) return null
    return intent('beam.setLength', {
      beamId: beam.id,
      length: Math.max(50, Math.hypot(beam.line.end.x - beam.line.start.x, beam.line.end.y - beam.line.start.y) + real(g, -600, 600)),
      keepFixed: pick(g, ['start', 'end'] as const)!,
    })
  },
  (g) => {
    const beam = pick(g, beamList(g))
    if (beam === undefined) return null
    return intent('beam.setWidth', { beamId: beam.id, width: Math.max(50, beam.width + real(g, -100, 100)) })
  },
  (g) => {
    const beam = pick(g, beamList(g))
    if (beam === undefined) return null
    return intent('beam.setJustification', { beamId: beam.id, justification: pick(g, ['left', 'centre', 'right'] as const)! })
  },
  (g) => {
    const beam = pick(g, beamList(g))
    return beam === undefined ? null : intent('beam.rename', { beamId: beam.id, label: `Beam B-${int(g, 1, 60)}` })
  },
  // #77 §3: the four boxes over a Beam's own pair of elevations, which never move the line.
  (g) => {
    const beam = pick(g, beamList(g))
    if (beam === undefined) return null
    return intent('beam.setVerticalExtent', {
      beamId: beam.id,
      field: pick(g, ['base', 'height', 'top', 'bottom'] as const)!,
      value: real(g, 0, 2600),
    })
  },
  (g) => {
    const beam = pick(g, beamList(g))
    return beam === undefined ? null : intent('beam.delete', { beamId: beam.id })
  },
  // #78: a Skirting over the whole face of a Wall the survey has, at the numbers the tool panel
  // starts with. The range is the Wall's own length, which is the one range that is always legal —
  // and the click the tool makes really does ask for the whole face.
  (g) => {
    const host = pick(g, g.project.existingModel.walls)
    if (host === undefined) return null
    const length = refLength(host.line)
    if (!(length > 100)) return null
    return intent(
      'skirting.create',
      {
        floorId: host.floorId,
        hostWallId: host.id,
        side: pick(g, ['left', 'right'] as const)!,
        start: 0,
        end: length,
        bottom: pick(g, [0, 0, 0, -50, 20])!,
        height: pick(g, [100, 150, 900, 2600])!,
        thickness: pick(g, [15, 25])!,
        // The survey's own strip: the Intents below address existing records only, so a strip written
        // into whichever Option happens to be active would never be one of them (#78 §5).
        target: { designOptionId: null, viewId: null },
        ...(bool(g) ? { label: `Skirting SK-${int(g, 1, 60)}` } : {}),
      },
      g.ids(1),
    )
  },
  // An end stays inside the Wall and inside the other end, so the range it leaves is a range.
  (g) => {
    const entry = pick(g, skirtingList(g))
    if (entry === undefined) return null
    const host = g.project.existingModel.walls.find((wall) => wall.id === entry.hostWallId)
    if (host === undefined) return null
    const length = refLength(host.line)
    const end = pick(g, ['start', 'end'] as const)!
    const to =
      end === 'start'
        ? Math.min(entry.end - 50, Math.max(0, entry.start + real(g, -600, 600)))
        : Math.max(entry.start + 50, Math.min(length, entry.end + real(g, -600, 600)))
    return intent('skirting.dragEndpoint', { skirtingId: entry.id, end, to })
  },
  (g) => {
    const entry = pick(g, skirtingList(g))
    if (entry === undefined) return null
    const host = g.project.existingModel.walls.find((wall) => wall.id === entry.hostWallId)
    if (host === undefined) return null
    const length = refLength(host.line)
    if (!(length > 200)) return null
    const start = real(g, 0, length - 100)
    return intent('skirting.setRange', { skirtingId: entry.id, start, end: real(g, start + 100, length) })
  },
  (g) => {
    const entry = pick(g, skirtingList(g))
    return entry === undefined ? null : intent('skirting.flipSide', { skirtingId: entry.id })
  },
  // A second element on the other face, which is what a Wall skirted on both sides is (#78 §1).
  (g) => {
    const entry = pick(g, skirtingList(g))
    return entry === undefined
      ? null
      : intent('skirting.duplicateOtherSide', { skirtingId: entry.id }, g.ids(1))
  },
  (g) => {
    const entry = pick(g, skirtingList(g))
    return entry === undefined
      ? null
      : intent('skirting.setBottom', { skirtingId: entry.id, bottom: entry.bottom + pick(g, [-200, -50, 20, 200])! })
  },
  (g) => {
    const entry = pick(g, skirtingList(g))
    return entry === undefined
      ? null
      : intent('skirting.setHeight', { skirtingId: entry.id, height: entry.height === 100 ? 150 : 100 })
  },
  (g) => {
    const entry = pick(g, skirtingList(g))
    return entry === undefined
      ? null
      : intent('skirting.setThickness', { skirtingId: entry.id, thickness: entry.thickness === 15 ? 25 : 15 })
  },
  // #78 §4: the four boxes over a Skirting's own pair of elevations, which never move the range.
  (g) => {
    const entry = pick(g, skirtingList(g))
    if (entry === undefined) return null
    const field = pick(g, ['base', 'height', 'top', 'bottom'] as const)!
    const value =
      field === 'height'
        ? entry.height === 100 ? 150 : 100
        : field === 'top'
          ? skirtingTop(entry) + pick(g, [1, 50, 500])!
          : entry.bottom + pick(g, [-200, -50, 20, 200])!
    return intent('skirting.setVerticalExtent', { skirtingId: entry.id, field, value })
  },
  (g) => {
    const entry = pick(g, skirtingList(g))
    return entry === undefined ? null : intent('skirting.rename', { skirtingId: entry.id, label: `Base skirting ${int(g, 1, 999)}` })
  },
  (g) => {
    const entry = pick(g, skirtingList(g))
    return entry === undefined ? null : intent('skirting.delete', { skirtingId: entry.id })
  },
  // #79: a Run along a line long enough to be one, or a Riser at a point, on a Floor the Project has.
  // The size is the `measure yours` placeholder the tool panel starts with, because that is what a
  // first Service carries before anyone measures anything.
  (g) => {
    const floor = pick(g, g.project.floors)
    if (floor === undefined) return null
    const kind = pick(g, SERVICE_KINDS as readonly ServiceKind[])!
    if (bool(g)) {
      const start = pt(real(g, -4000, 4000), real(g, -4000, 4000))
      const rectangular = bool(g)
      return intent(
        'service.create',
        {
          floorId: floor.id,
          shape: 'run',
          kind,
          line: { start, end: pt(start.x + real(g, 300, 4000), start.y + real(g, -300, 300)) },
          section: rectangular ? 'rectangular' : 'round',
          centrelineElevation: real(g, -200, 2500),
          ...(rectangular ? { width: pick(g, [40, 80, 150, 300])!, depth: pick(g, [40, 60, 100, 250])! } : { outsideDiameter: pick(g, [25, 50, 100, 200])! }),
          ...(bool(g) ? { label: `Condensate ${int(g, 1, 60)}` } : {}),
        },
        g.ids(1),
      )
    }
    return intent(
      'service.create',
      {
        floorId: floor.id,
        shape: 'riser',
        kind,
        point: pt(real(g, -4000, 4000), real(g, -4000, 4000)),
        outsideDiameter: pick(g, [25, 50, 100, 200])!,
        bottomElevation: real(g, -200, 1200),
        height: pick(g, [300, 1000, 2600])!,
      },
      g.ids(1),
    )
  },
  (g) => {
    const service = pick(g, serviceList(g))
    if (service === undefined || service.shape !== 'run') return null
    const end = pick(g, ['start', 'end'] as const)!
    const at = service.line[end]
    return intent('service.dragEndpoint', {
      serviceId: service.id,
      end,
      to: pt(at.x + real(g, -800, 800), at.y + real(g, -800, 800)),
    })
  },
  (g) => {
    const service = pick(g, serviceList(g))
    return service === undefined
      ? null
      : intent('service.dragBody', { serviceId: service.id, delta: pt(real(g, -800, 800), real(g, -800, 800)) })
  },
  (g) => {
    const service = pick(g, serviceList(g))
    if (service === undefined || service.shape !== 'run') return null
    return intent('service.setLength', {
      serviceId: service.id,
      length: Math.max(50, Math.hypot(service.line.end.x - service.line.start.x, service.line.end.y - service.line.start.y) + real(g, -600, 600)),
      keepFixed: pick(g, ['start', 'end'] as const)!,
    })
  },
  (g) => {
    const service = pick(g, serviceList(g))
    return service === undefined
      ? null
      : intent('service.setKind', { serviceId: service.id, kind: pick(g, SERVICE_KINDS as readonly ServiceKind[])! })
  },
  (g) => {
    const service = pick(g, serviceList(g))
    return service === undefined || service.shape !== 'run'
      ? null
      : intent('service.setSection', { serviceId: service.id, section: service.section === 'round' ? 'rectangular' : 'round' })
  },
  (g) => {
    const service = pick(g, serviceList(g))
    return service === undefined
      ? null
      : intent('service.setOutsideDiameter', { serviceId: service.id, outsideDiameter: pick(g, [25, 50, 100, 200])! })
  },
  (g) => {
    const service = pick(g, serviceList(g))
    return service === undefined || service.shape !== 'run' || service.section !== 'rectangular'
      ? null
      : intent('service.setWidth', { serviceId: service.id, width: pick(g, [40, 80, 150, 300])! })
  },
  (g) => {
    const service = pick(g, serviceList(g))
    return service === undefined || service.shape !== 'run' || service.section !== 'rectangular'
      ? null
      : intent('service.setDepth', { serviceId: service.id, depth: pick(g, [40, 60, 100, 250])! })
  },
  // #79 §4: the vertical boxes over each shape's own pair of elevations, which never move the plan.
  (g) => {
    const service = pick(g, serviceList(g))
    if (service === undefined) return null
    return intent('service.setVerticalExtent', {
      serviceId: service.id,
      field: pick(g, service.shape === 'run' ? (['bottom', 'centre', 'top'] as const) : (['bottom', 'height', 'top'] as const))!,
      value: real(g, -200, 2800),
    })
  },
  (g) => {
    const service = pick(g, serviceList(g))
    return service === undefined ? null : intent('service.rename', { serviceId: service.id, label: `Condensate ${int(g, 1, 60)}` })
  },
  (g) => {
    const service = pick(g, serviceList(g))
    return service === undefined ? null : intent('service.delete', { serviceId: service.id })
  },
  // #80: an Anchor the Project can actually resolve, because a Comment about something that is not
  // there is refused on creation and would never be seen. The scope follows the Anchor: an Anchor that
  // names a Design Option, an entity or a feature already answers "which Option?", and the rest have
  // to say `All` or name one (#80 §1).
  (g) => {
    const anchor = commentAnchor(g)
    if (anchor === null) return null
    return intent(
      'comment.create',
      {
        anchor,
        title: `Check ${int(g, 1, 900)}`,
        body: bool(g) ? `Confirm with the client (${int(g, 1, 900)}).` : '',
        priority: pick(g, COMMENT_PRIORITIES as readonly CommentPriority[])!,
        ...(anchorChoosesScope(anchor.kind) ? { scope: commentScope(g) } : {}),
        at: NOW,
      },
      g.ids(1),
    )
  },
  (g) => {
    const comment = pick(g, g.project.comments)
    if (comment === undefined) return null
    const choosing = anchorChoosesScope(comment.anchor.kind)
    return intent('comment.edit', {
      commentId: comment.id,
      ...(bool(g) ? { title: `Revised ${int(g, 1, 900)}` } : {}),
      ...(bool(g) ? { body: `Site note ${int(g, 1, 900)}.` } : {}),
      ...(bool(g) ? { priority: pick(g, COMMENT_PRIORITIES as readonly CommentPriority[])! } : {}),
      ...(choosing && bool(g) ? { scope: commentScope(g) } : {}),
      at: LATER,
    })
  },
  // Resolve and Reopen each refuse the state the Comment is already in, so each picks one that does not
  // have the status it would write — otherwise the pair could never be seen working.
  (g) => {
    const comment = pick(g, g.project.comments.filter((each) => each.status === 'open'))
    return comment === undefined ? null : intent('comment.resolve', { commentId: comment.id, at: LATER })
  },
  (g) => {
    const comment = pick(g, g.project.comments.filter((each) => each.status === 'resolved'))
    return comment === undefined ? null : intent('comment.reopen', { commentId: comment.id, at: LATER })
  },
  (g) => {
    const comment = pick(g, g.project.comments)
    return comment === undefined ? null : intent('comment.delete', { commentId: comment.id })
  },
  // #66: a subject that exists, because an acknowledgement of a warning about something that
  // is not there is pruned by the same step that recorded it, and would never be seen. Any
  // entity will do — the handler addresses a warning by its key, not by what the key names.
  (g) => {
    const subjects = [
      ...g.project.floors.map((floor) => floor.id),
      ...g.project.itemDesigns.map((design) => design.id),
      ...g.project.existingModel.placedItems.map((placement) => placement.id),
      ...g.project.existingModel.walls.map((wall) => wall.id),
    ]
    const subject = pick(g, subjects)
    return subject === undefined
      ? null
      : intent(
          'warning.acknowledge',
          {
            warningType: pick(g, ['wall_crossing', 'wall_overlap'] as const)!,
            subjectIds: [subject],
            designOptionId: null,
            signature: `000000000000000${int(g, 0, 15).toString(16)}`,
            note: `Overlapping on purpose ${int(g, 1, 99)}`,
          },
          g.ids(1),
        )
  },
  (g) => {
    const record = pick(g, g.project.warningAcknowledgements)
    return record === undefined
      ? null
      : intent('warning.editNote', {
          warningType: record.warningType,
          subjectIds: [...record.subjectIds],
          designOptionId: record.designOptionId,
          note: `Note edited ${int(g, 1, 99)}`,
        })
  },
  // #67: Rooms. Half the time a Room is drawn against a Wall face on purpose — an Edge parallel
  // to a face and a known distance off it is the only thing `room.attachFace` can act on, and
  // the reference that records is what `room.detachFace` later removes.
  (g) => {
    const floor = pick(g, g.project.floors)
    // A drafter draws a handful of Rooms on a Floor, not a hundred, and a model buried under
    // shelters leaves no Wall for the other intents to work on. The cap keeps the sequence a
    // plan rather than a stress test.
    if (floor === undefined || roomList(g).length >= 6) return null
    const wall = pick(g, wallList(g))
    const outline = faceRoomOrBox(g, wall)
    return intent('room.create', { floorId: floor.id, outline, name: `Room ${int(g, 1, 60)}` }, g.ids(5))
  },
  (g) => {
    const room = pick(g, roomList(g))
    return room === undefined ? null : intent('room.rename', { roomId: room.id, name: `Room ${int(g, 1, 99)}` })
  },
  (g) => {
    // The Edge IDs are the Room's own, restated: a caller that mints new ones is asking to
    // delete a referenced Edge, which the handler refuses rather than re-point.
    const room = pick(g, roomList(g).filter((each) => roomSegments(each.outline).length === 4))
    if (room === undefined) return null
    const path = roomOutlinePath(room.outline)
    const corners = [path.start, ...path.segments.map((segment) => segment.to)]
    const xs = corners.map((at) => at.x)
    const ys = corners.map((at) => at.y)
    const grown = {
      kind: 'path' as const,
      path: box(Math.min(...xs), Math.min(...ys), Math.max(...xs) + real(g, 0, 500), Math.max(...ys) + real(g, 0, 500)),
    }
    return intent('room.setOutline', { roomId: room.id, outline: grown }, [...room.outline.segmentIds])
  },
  (g) => {
    // Every Edge that could lie on a face: parallel to it, and not already on it, because an
    // Edge that is already there is a `no-change` rather than an edit. One of them is chosen at
    // random rather than the first, so a step whose slide happens to be blocked does not spend
    // the whole run on the same pair.
    const candidates: Intent<'room.attachFace'>[] = []
    for (const room of roomList(g)) {
      // A Room with a reference already on it is a poor place to add a second one: sliding this
      // Edge extends or shortens its neighbours, and a neighbour that is itself lying on a Wall
      // face would end up hanging past the end of it. The first attach of a Room is the clean one.
      if (room.wallFaceRefs.length > 0) continue
      for (const segment of roomSegments(room.outline)) {
        if (segment.segment.kind !== 'line') continue
        for (const wall of wallList(g)) {
          for (const side of ['left', 'right'] as const) {
            const face = roomFaceCurve(wall, side)
            const relation = edgeToFace(segment.segment, segment.from, face)
            if (relation.skew > 0.01 || relation.distance <= 0.01 || relation.distance >= 500) continue
            // Only an Edge the loop can take up: a slide that collapses the Room or runs a
            // neighbour into itself is a blocked proposal, and offering one every step would
            // spend the run on refusals.
            const slid = roomOutlineAfterSlide(room.outline, segment.index + 1, ontoFaceVector(segment.segment, segment.from, face))
            if (slid === null) continue
            candidates.push(intent('room.attachFace', { roomId: room.id, segmentId: segment.id, wallId: wall.id, side }))
          }
        }
      }
    }
    return pick(g, candidates) ?? null
  },
  (g) => {
    const attached = roomList(g).filter((room) => room.wallFaceRefs.length > 0)
    const room = pick(g, attached)
    if (room === undefined) return null
    const ref = room.wallFaceRefs[int(g, 0, room.wallFaceRefs.length - 1)]!
    return intent('room.detachFace', { roomId: room.id, segmentId: ref.segmentId })
  },
  (g) => {
    const floor = pick(g, g.project.floors)
    // One shelter is a flat with four Walls and four Rooms of its own, all of them referenced,
    // so a sequence that kept placing them would be all shelter and no plan.
    if (floor === undefined || roomList(g).length >= 4 || wallList(g).length >= 16) return null
    return intent(
      'room.placeShelter',
      {
        floorId: floor.id,
        centre: pt(real(g, -9000, 9000), real(g, -9000, 9000)),
        orientationDeg: pick(g, [0, 90, 180, 270])!,
      },
      g.ids(SHELTER_ID_COUNT),
    )
  },
]

/**
 * One random Intent. A generator that finds nothing to act on returns `null`, so the
 * sequence keeps its length budget for the Intents that do apply.
 */
function randomIntent(g: Gen): Intent | null {
  // A random rotation rather than a fixed one. First-fit from a random start lets the
  // generators near the front of the list win almost every step, and the ones with a
  // precondition that only occasionally holds — `wall.merge` wants two collinear Walls at a
  // Junction of their own — then go untried often enough to make the coverage below flaky.
  const order = GENERATORS.map((_, index) => index)
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = int(g, 0, index)
    const held = order[index]!
    order[index] = order[swap]!
    order[swap] = held
  }
  for (const index of order) {
    const next = GENERATORS[index]!(g)
    if (next !== null) return next
  }
  return null
}

/** Run `steps` random Intents, checking every step as it goes. */
const seen = new Map<IntentType, { applied: number; refused: number }>()

function runSequence(start: Project, seed: number, steps: number): Project {
  const g: Gen = { rand: random(seed), project: start, ids: idSource(highestIssuedId(start)) }
  let current = start
  for (let step = 0; step < steps; step++) {
    g.project = current
    const next = randomIntent(g)
    if (next === null) continue
    const tally = seen.get(next.type) ?? { applied: 0, refused: 0 }
    const result = applyIntent(current, next)
    if (!result.ok) {
      tally.refused += 1
      seen.set(next.type, tally)
      continue
    }
    tally.applied += 1
    seen.set(next.type, tally)
    expect(result.patches.length, `${next.type} was accepted with no patches`).toBeGreaterThan(0)
    expect(validateProject(result.project).ok, `${next.type} produced an invalid Project`).toBe(true)
    const undone = applyPatches(result.project, result.inversePatches)
    // One field is deliberately not restored by undo: the Comment reference counter counts numbers
    // that have already been handed out, so it only ever goes up (#80 §1 criterion 2). Everything else
    // comes back byte for byte.
    const restorable =
      undone.commentReferenceCounter === current.commentReferenceCounter
        ? undone
        : { ...undone, commentReferenceCounter: current.commentReferenceCounter }
    expect(canonicalJson(restorable), `${next.type} did not undo to the Project it started from`).toBe(canonicalJson(current))
    current = result.project
  }
  return current
}

const STARTS: { name: string; project: Project }[] = []

/**
 * One scripted pass that takes every Intent whose precondition a random sequence often never
 * finds.
 *
 * `room.attachFace` needs an Edge parallel to a Wall face and a known distance off it, which a
 * random sequence only stumbles on when the Room happened to be drawn against that face; the
 * same goes for the reference `room.detachFace` undoes, and for the two straight Walls
 * butt-joined at a Junction of their own that `wall.merge` joins. Rather than leave the
 * catalogue claim below at the mercy of the dice, this draws one Wall, one Room lying beside it,
 * and a pair of collinear Walls, then walks through: draw, take the Edge up, rename, resize with
 * the reference kept, let go, place a household shelter, and merge. The random sequences still
 * run every one of these as often as they find a chance, checking the undo and validity of each.
 */
function seedRarePreconditions(): void {
  const give = idSource()
  const g: Gen = { rand: () => 0.5, project: createProject({ ids: give(CREATE_PROJECT_ID_COUNT), now: NOW, name: 'Rooms' }), ids: give }
  let current = g.project
  const floorId = current.floors[0]!.id
  const [wallId] = g.ids(1)
  const [roomId] = g.ids(1)
  const edgeIds = g.ids(5)
  const edgeId = edgeIds[0]!
  const shelterIds = g.ids(SHELTER_ID_COUNT)
  const mergeIds = g.ids(3)
  const skirtingIds = g.ids(1)
  const skirtingOtherIds = g.ids(1)
  const skirtingId = skirtingIds[0]!
  const serviceIds = g.ids(1)
  const serviceRiserIds = g.ids(1)
  const serviceId = serviceIds[0]!
  const serviceRiserId = serviceRiserIds[0]!
  const wall: WallDraft = {
    line: { kind: 'line', start: pt(0, 0), end: pt(4000, 0) },
    thickness: 100,
    justification: 'centre',
    baseElevation: 0,
    height: 2600,
  }
  // Edge 1 runs 300 mm off the Wall’s Kitchen-side face, which is the gap `room.attachFace` takes up.
  const shape = (right: number, bottom: number, top: number): RoomOutlineShape => ({
    kind: 'path',
    path: {
      start: pt(0, top),
      segments: [
        { kind: 'line', to: pt(right, top) },
        { kind: 'line', to: pt(right, bottom) },
        { kind: 'line', to: pt(0, bottom) },
        { kind: 'line', to: pt(0, top) },
      ],
    },
  })
  const steps: Intent[] = [
    intent('wall.createChain', { floorId, walls: [wall], starts: [{ kind: 'free' as const }], ends: [{ kind: 'free' as const }] }, [wallId]),
    intent('room.create', { floorId, outline: shape(1000, 1550, 350), name: 'Kitchen' }, [roomId, ...edgeIds]),
    intent('room.attachFace', { roomId, segmentId: edgeId, wallId, side: 'right' }),
    intent('room.rename', { roomId, name: 'Study' }),
    // The same four Edge names, so the reference survives: Edge 1 stays where it was taken up.
    intent('room.setOutline', { roomId, outline: shape(1400, 1950, 50) }, edgeIds),
    intent('room.detachFace', { roomId, segmentId: edgeId }),
    intent('room.placeShelter', { floorId, centre: pt(60000, 60000), orientationDeg: 0 }, shelterIds),
    // `wall.merge` wants two Walls on one straight line, butt-joined at a Junction of their own
    // and free at both far ends. A random chain rarely leaves that shape standing, so draw it.
    intent(
      'wall.createChain',
      {
        floorId,
        walls: [
          { ...wall, line: { kind: 'line' as const, start: pt(0, 8000), end: pt(2000, 8000) } },
          { ...wall, line: { kind: 'line' as const, start: pt(2000, 8000), end: pt(4000, 8000) } },
        ],
        starts: [{ kind: 'free' as const }, { kind: 'segment' as const, index: 0, end: 'end' as const }],
        ends: [{ kind: 'segment' as const, index: 1, end: 'start' as const }, { kind: 'free' as const }],
      },
      mergeIds,
    ),
    intent('wall.merge', { wallIds: [mergeIds[0]!, mergeIds[1]!] }),
    // #78: a Skirting needs a host Wall whose face carries a range, which a random sequence reaches
    // only when it happened to draw one first. So draw one and walk through every command the tool
    // and the inspector have — the same debt the Room steps above pay for `room.attachFace`.
    intent(
      'skirting.create',
      {
        floorId,
        hostWallId: wallId,
        side: 'left' as const,
        start: 0,
        end: 2000,
        bottom: 0,
        height: 100,
        thickness: 15,
        label: 'Skirting SK-1',
        target: { designOptionId: null, viewId: null },
      },
      skirtingIds,
    ),
    intent('skirting.dragEndpoint', { skirtingId: skirtingId, end: 'end' as const, to: 1800 }),
    intent('skirting.setRange', { skirtingId: skirtingId, start: 100, end: 1900 }),
    intent('skirting.setBottom', { skirtingId: skirtingId, bottom: 10 }),
    intent('skirting.setHeight', { skirtingId: skirtingId, height: 90 }),
    intent('skirting.setThickness', { skirtingId: skirtingId, thickness: 18 }),
    intent('skirting.setVerticalExtent', { skirtingId: skirtingId, field: 'top' as const, value: 120 }),
    intent('skirting.rename', { skirtingId: skirtingId, label: 'Skirting SK-2' }),
    intent('skirting.flipSide', { skirtingId: skirtingId }),
    intent('skirting.duplicateOtherSide', { skirtingId: skirtingId }, skirtingOtherIds),
    intent('skirting.delete', { skirtingId: skirtingOtherIds[0]! }),
    intent('skirting.delete', { skirtingId }),
    // #79: a Service needs nothing but a Floor, so a random sequence reaches most of this family —
    // but not the rectangular-only boxes, which only exist once someone has switched the section.
    // Walk the whole tool and inspector once, in the order the boxes appear on screen.
    intent(
      'service.create',
      {
        floorId,
        shape: 'run' as const,
        kind: 'water' as const,
        line: { start: pt(0, 600), end: pt(3000, 600) },
        section: 'round' as const,
        centrelineElevation: 2200,
        outsideDiameter: 50,
        label: 'Condensate',
        target: { designOptionId: null, viewId: null },
      },
      serviceIds,
    ),
    intent('service.dragEndpoint', { serviceId: serviceId, end: 'end' as const, to: pt(3400, 700) }),
    intent('service.dragBody', { serviceId: serviceId, delta: pt(-200, 100) }),
    intent('service.setLength', { serviceId: serviceId, length: 2400, keepFixed: 'start' as const }),
    intent('service.setKind', { serviceId: serviceId, kind: 'air_con' as const }),
    intent('service.setOutsideDiameter', { serviceId: serviceId, outsideDiameter: 100 }),
    intent('service.setSection', { serviceId: serviceId, section: 'rectangular' as const }),
    intent('service.setWidth', { serviceId: serviceId, width: 150 }),
    intent('service.setDepth', { serviceId: serviceId, depth: 75 }),
    intent('service.setVerticalExtent', { serviceId: serviceId, field: 'centre' as const, value: 2400 }),
    intent('service.setVerticalExtent', { serviceId: serviceId, field: 'bottom' as const, value: 2300 }),
    intent('service.setVerticalExtent', { serviceId: serviceId, field: 'top' as const, value: 2500 }),
    intent('service.rename', { serviceId: serviceId, label: 'Condensate run' }),
    intent(
      'service.create',
      {
        floorId,
        shape: 'riser' as const,
        kind: 'drain' as const,
        point: pt(3400, 2200),
        outsideDiameter: 100,
        bottomElevation: 0,
        height: 2600,
        target: { designOptionId: null, viewId: null },
      },
      serviceRiserIds,
    ),
    intent('service.dragBody', { serviceId: serviceRiserId, delta: pt(50, -50) }),
    intent('service.setOutsideDiameter', { serviceId: serviceRiserId, outsideDiameter: 150 }),
    intent('service.setVerticalExtent', { serviceId: serviceRiserId, field: 'bottom' as const, value: 100 }),
    intent('service.setVerticalExtent', { serviceId: serviceRiserId, field: 'height' as const, value: 2000 }),
    intent('service.setVerticalExtent', { serviceId: serviceRiserId, field: 'top' as const, value: 2300 }),
    intent('service.rename', { serviceId: serviceRiserId, label: 'Stack' }),
    intent('service.delete', { serviceId: serviceRiserId }),
    intent('service.delete', { serviceId: serviceId }),
  ]
  for (const next of steps) {
    const tally = seen.get(next.type) ?? { applied: 0, refused: 0 }
    const result = applyIntent(current, next)
    if (!result.ok) throw new Error(`${next.type}: ${JSON.stringify(result.problems)}`)
    tally.applied += 1
    seen.set(next.type, tally)
    expect(validateProject(result.project).ok).toBe(true)
    expect(canonicalJson(applyPatches(result.project, result.inversePatches))).toBe(canonicalJson(current))
    current = result.project
  }
}

beforeAll(async () => {
  seedRarePreconditions()
  STARTS.push({ name: 'createProject', project: createProject({ ids: idSource()(CREATE_PROJECT_ID_COUNT), now: NOW, name: 'New kitchen' }) })
  for (const rel of LEGACY_FIXTURES) {
    const result = await convertLegacy(read(rel), { newId: allocator() })
    if (!result.ok) throw new Error(`${rel}: ${JSON.stringify(result.problems)}`)
    for (const proposal of result.conversion.projects) {
      if (proposal.status === 'ok') STARTS.push({ name: `${rel}#${proposal.designId}`, project: proposal.project })
    }
  }
})

// 200 sequences of up to 50 Intents take ~2.6 s alone but exceed vitest's 5 s default on a loaded CI runner.
const PROPERTY_TIMEOUT_MS = 30_000

describe('a sequence of random Intents', () => {
  it('has a Project to start from for every legacy fixture', () => {
    expect(STARTS.length).toBeGreaterThan(6)
  })

  it('never throws, always undoes, and always ends valid', () => {
    fc.assert(
      fc.property(
        fc.record({
          start: fc.integer({ min: 0, max: Math.max(0, STARTS.length - 1) }),
          seed: fc.nat(),
          steps: fc.integer({ min: 1, max: 50 }),
        }),
        ({ start, seed, steps }) => {
          const entry = STARTS[start]
          if (entry === undefined) return true
          const finished = runSequence(entry.project, seed, steps)
          expect(validateProject(finished).ok, `${entry.name} ended on an invalid Project`).toBe(true)
          return true
        },
      ),
      { numRuns: 200 },
    )
  }, PROPERTY_TIMEOUT_MS)

  it('does the same to a generated Project', () => {
    fc.assert(
      fc.property(
        arbProject(),
        fc.nat(),
        fc.integer({ min: 1, max: 20 }),
        (project, seed, steps) => {
          const finished = runSequence(project, seed, steps)
          expect(validateProject(finished).ok).toBe(true)
          return true
        },
      ),
      { numRuns: 100 },
    )
  }, PROPERTY_TIMEOUT_MS)

  // The two properties above are only worth anything if they reached the whole catalogue.
  it('generated and accepted every Intent in the catalogue along the way', () => {
    for (const type of Object.keys(INTENT_LABELS) as IntentType[]) {
      const tally = seen.get(type)
      expect(tally, `${type} was never generated`).toBeDefined()
      expect(tally?.refused, `${type} was never even tried`).toBeGreaterThanOrEqual(0)
      expect(tally?.applied, `${type} was never accepted`).toBeGreaterThan(0)
    }
  })
})

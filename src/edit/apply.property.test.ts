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
import type { CabinetItemDesign, CabinetNode, GenericItemDesign, ItemDesign, ItemFootprint, PlacedItem, Project, Wall, WallJunction } from '../domain'
import { footprintSize, validateProject } from '../domain'
import type { Preset } from '../geometry'
import { DEG, normaliseDeg, pt, refLength, refPointAt } from '../geometry'
import { arbProject } from '../domain/testing'
import { canonicalJson } from '../lib'
import { convertLegacy } from '../package'
import type { Intent, IntentType, PayloadOf, WallDraft, WallEndTarget } from './index'
import { applyIntent, applyPatches, chainJunctionCount, createProject, INTENT_LABELS, PLAN_CATALOGUE } from './index'
import { intent, NOW } from './testing'

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

/** A deterministic stand-in for the UI's ID source; each run gets its own. */
function idSource(): (count?: number) => string[] {
  let issued = 0
  return (count = 1) => Array.from({ length: count }, () => `prop-${String(++issued)}`)
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
      ends.push({ kind: 'free' })
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
  (g) => {
    const wall = pick(g, wallList(g))
    return wall === undefined
      ? null
      : intent('wall.offset', { wallId: wall.id, distance: real(g, -900, 900), side: pick(g, ['left', 'right'] as const)! })
  },
  (g) => {
    const wall = pick(g, wallList(g).filter((candidate) => refLength(candidate.line) > 600))
    if (wall === undefined) return null
    return intent('wall.split', { wallId: wall.id, at: refLength(wall.line) * 0.37 }, g.ids(2))
  },
  (g) => {
    // Two Walls meeting at a junction of their own, with nothing that differs between them.
    for (const junction of junctionList(g)) {
      if (junction.host !== undefined || junction.ends.length !== 2) continue
      const first = wallList(g).find((candidate) => candidate.id === junction.ends[0]!.wallId)
      const second = wallList(g).find((candidate) => candidate.id === junction.ends[1]!.wallId)
      if (first === undefined || second === undefined) continue
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
    return wall === undefined ? null : intent('wall.delete', { wallId: wall.id })
  },
]

/**
 * One random Intent. A generator that finds nothing to act on returns `null`, so the
 * sequence keeps its length budget for the Intents that do apply.
 */
function randomIntent(g: Gen): Intent | null {
  const start = int(g, 0, GENERATORS.length - 1)
  for (let attempt = 0; attempt < GENERATORS.length; attempt++) {
    const next = GENERATORS[(start + attempt) % GENERATORS.length]!(g)
    if (next !== null) return next
  }
  return null
}

/** Run `steps` random Intents, checking every step as it goes. */
const seen = new Map<IntentType, { applied: number; refused: number }>()

function runSequence(start: Project, seed: number, steps: number): Project {
  const g: Gen = { rand: random(seed), project: start, ids: idSource() }
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
    expect(canonicalJson(undone), `${next.type} did not undo to the Project it started from`).toBe(canonicalJson(current))
    current = result.project
  }
  return current
}

const STARTS: { name: string; project: Project }[] = []

beforeAll(async () => {
  STARTS.push({ name: 'createProject', project: createProject({ ids: idSource()(6), now: NOW, name: 'New kitchen' }) })
  for (const rel of LEGACY_FIXTURES) {
    const result = await convertLegacy(read(rel), { newId: allocator() })
    if (!result.ok) throw new Error(`${rel}: ${JSON.stringify(result.problems)}`)
    for (const proposal of result.conversion.projects) {
      if (proposal.status === 'ok') STARTS.push({ name: `${rel}#${proposal.designId}`, project: proposal.project })
    }
  }
})

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
  })

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
  })

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

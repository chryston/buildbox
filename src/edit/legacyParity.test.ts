/**
 * Legacy parity (#47 criterion 4).
 *
 * Each action in the issue's catalogue table runs twice: once on the legacy fixture
 * through the store that is still in production, once on the converted Project through
 * `applyIntent`. The two results are then projected the way the app draws them —
 * `cabinetSceneUnits` + `computeSceneLayout` for cabinets, the legacy rectangle corners
 * for floor-plan objects — and compared to within 0.01 mm.
 *
 * The converter copies legacy unit, node and object IDs (#43 §3), so both sides can be
 * addressed by the same ID. Only the IDs an Intent introduces are new, and the rows below
 * drop them: the contract is the geometry, not the name.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { computeSceneLayout, type CabinetSceneUnit, type SceneLayout } from '../cabinet'
import { cabinetSceneUnits } from '../derive'
import type { CabinetMaterialId, CabinetNode, ElementType, GlobalSettings, Project } from '../domain'
import { sha256Hex } from '../lib'
import {
  convertLegacy,
  floorPlanAsProject,
  migrateLegacyState,
  type LegacyFloorPlanContent,
  type LegacyFloorPlanConversion,
} from '../package'
import { useStore } from '../store/store'
import type { CustomTemplate, FloorPlanData, FloorPlanImage, FloorPlanObject } from '../types'
import type { Intent } from './index'
import { applyIntent, INTENT_LABELS, PLAN_CATALOGUE } from './index'
import { intent } from './testing'

const fixturesRoot = fileURLToPath(new URL('../../fixtures/legacy', import.meta.url))
const read = (rel: string): string => readFileSync(join(fixturesRoot, rel), 'utf8')

const STORE_FIXTURES = ['v0', 'v1', 'v2', 'v3', 'v3-large-image'].map((name) => `${name}/buildbox-store.json`)
const LAYOUT_TOLERANCE = 0.01

let issued = 0
const newIds = (count: number): string[] => Array.from({ length: count }, () => `parity-${String(++issued)}`)

/**
 * A fresh ID source for one pass over one fixture. The legacy migrator and the converter
 * both mint IDs for values the file left out; giving each pass the same deterministic
 * sequence is what lets the two sides address the same unit (#43 §3).
 */
const freshIds = (): (() => string) => {
  let taken = 0
  return () => `parity-${String(++taken).padStart(8, '0')}`
}

// --- The legacy store, driven from Node --------------------------------------

// The store persists on every `set` through `guardedStorage`, which reaches for
// `localStorage`; the `pure` project runs in Node and has none, so it gets an in-memory one.
const saved = new Map<string, string>()
const memoryStorage: Storage = {
  getItem: (key: string) => saved.get(key) ?? null,
  setItem: (key: string, value: string) => saved.set(key, value),
  removeItem: (key: string) => saved.delete(key),
  clear: () => saved.clear(),
  key: (index: number) => [...saved.keys()][index] ?? null,
  get length() {
    return saved.size
  },
}

// Set before any test runs: the store writes through it on every action, and the
// `action coverage` block reads the state the persist middleware left behind.
globalThis.localStorage = memoryStorage
afterAll(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage
})

/** A legacy `Design` as the store holds it: the unit list is what the scene is built from. */
type LegacyDesign = { id: string; material?: CabinetMaterialId; units?: unknown[] }
type LegacyState = { projects: LegacyDesign[]; activeProjectId: string | null; floorPlan: FloorPlanData | null }

function legacyState(rel: string): LegacyState {
  const envelope = JSON.parse(read(rel)) as { state: unknown; version: number }
  const migrated = migrateLegacyState(envelope.state, envelope.version, freshIds())
  if (typeof migrated !== 'object' || migrated === null) throw new Error(`${rel}: nothing to migrate`)
  const state: unknown = migrated
  if (!isLegacyState(state)) throw new Error(`${rel}: the migrated state has no projects`)
  return state
}

function isLegacyState(state: unknown): state is LegacyState {
  if (typeof state !== 'object' || state === null || !('projects' in state)) return false
  const { projects } = state
  return Array.isArray(projects)
}

async function converted(rel: string, designId: string): Promise<Project> {
  const result = await convertLegacy(read(rel), { newId: freshIds() })
  if (!result.ok) throw new Error(`${rel}: ${JSON.stringify(result.problems)}`)
  const proposal = result.conversion.projects.find((each) => each.designId === designId)
  if (proposal === undefined || proposal.status !== 'ok') throw new Error(`${rel}: nothing to convert for ${designId}`)
  return proposal.project
}

async function planProject(rel: string): Promise<{ project: Project; floorId: string } | null> {
  const result = await convertLegacy(read(rel), { newId: freshIds() })
  if (!result.ok) throw new Error(`${rel}: ${JSON.stringify(result.problems)}`)
  const content = planContent(result.conversion.floorPlan)
  if (content === null) return null
  const attached = floorPlanAsProject(content, {
    projectId: 'parity-plan',
    name: 'Floor plan',
    floorId: 'parity-floor',
    newId: freshIds(),
  })
  if (!attached.ok) throw new Error(`${rel}: ${JSON.stringify(attached.problems)}`)
  return { project: attached.project, floorId: 'parity-floor' }
}

function planContent(plan: LegacyFloorPlanConversion | null): LegacyFloorPlanContent | null {
  return plan === null || plan.status !== 'ok' ? null : plan.content
}

function seedStore(state: LegacyState, designId: string | null, unitId: string | null): void {
  useStore.setState({
    projects: structuredClone(state.projects) as never,
    activeProjectId: designId,
    activeUnitId: unitId,
    floorPlan: structuredClone(state.floorPlan) as never,
  })
}

/** The store's active Project, as `computeSceneLayout` wants it. */
function legacyUnits(): CabinetSceneUnit[] {
  const state = useStore.getState()
  const design = state.projects.find((each) => each.id === state.activeProjectId) as LegacyDesign | undefined
  // `Design.units` is the legacy unit list; `CabinetSceneUnit` is the same value read by
  // the layout engine, which is what #20 §13.4 compares.
  return (design?.units ?? []) as unknown as CabinetSceneUnit[]
}

function legacyFloorPlan(): FloorPlanData {
  const { floorPlan } = useStore.getState()
  if (floorPlan === null) throw new Error('no floor plan on the store')
  return floorPlan
}

// --- Geometry, without the names --------------------------------------------

type Row = (string | number)[]

/**
 * The scene as an ordered list of rows. IDs are left out on purpose: a shelf the Intent
 * names `parity-7` and the store names `Ab3dE9fG` is the same shelf.
 */
function geometryRows(layout: SceneLayout): Row[] {
  return layout.units.flatMap((unit): Row[] => [
    ['unit', unit.x, unit.y, unit.w, unit.h],
    ...unit.panels.map((panel): Row => [`panel ${panel.role}`, panel.x, panel.y, panel.w, panel.h]),
    ...unit.voids.map((space): Row => [`void ${space.elementType}`, space.x, space.y, space.w, space.h]),
    ...unit.dividers.map((divider): Row => ['divider', divider.x, divider.y, divider.w, divider.h]),
  ])
}

function expectRows(actual: Row[], expected: Row[], label: string): void {
  expect(actual.length, `${label}: ${String(actual.length)} rows against ${String(expected.length)}`).toBe(expected.length)
  actual.forEach((row, index) => {
    const want = expected[index]
    if (want === undefined) throw new Error(`${label}: no row ${String(index)}`)
    expect(row.length, `${label}: row ${String(index)} has the wrong width`).toBe(want.length)
    row.forEach((cell, column) => {
      const wanted = want[column]
      if (typeof cell === 'number' && typeof wanted === 'number') {
        const message = `${label}: row ${String(index)} cell ${String(column)} is ${String(cell)}, wanted ${String(wanted)}`
        expect(Math.abs(cell - wanted), message).toBeLessThanOrEqual(LAYOUT_TOLERANCE)
      } else {
        expect(cell, `${label}: row ${String(index)} cell ${String(column)}`).toBe(wanted)
      }
    })
  })
}

/** The legacy `rotate(deg, cx, cy)` of a rectangle's four corners. */
function corners(x: number, y: number, w: number, h: number, rotation: number): Row[] {
  const radians = (rotation * Math.PI) / 180
  const cx = x + w / 2
  const cy = y + h / 2
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py]): Row => {
    const dx = px - cx
    const dy = py - cy
    return [cx + dx * Math.cos(radians) - dy * Math.sin(radians), cy + dx * Math.sin(radians) + dy * Math.cos(radians)]
  })
}

/** The same four corners, read back out of a Placed Item. */
function placedCorners(project: Project, placedItemId: string): Row[] {
  const placement = project.existingModel.placedItems.find((item) => item.id === placedItemId)
  const design = placement === undefined ? undefined : project.itemDesigns.find((item) => item.id === placement.itemDesignId)
  if (placement === undefined || design === undefined || design.kind !== 'generic') throw new Error(`no Placed Item ${placedItemId}`)
  const { width, depth } = design.footprint
  return corners(placement.translation.x - width / 2, placement.translation.y - depth / 2, width, depth, placement.rotationDeg)
}

// --- The cabinet actions, both ways ------------------------------------------

type Target = 'root' | 'child' | 'leaf' | 'split'

function spaces(root: CabinetNode): CabinetNode[] {
  return [root, ...(root.children ?? []).flatMap(spaces)]
}

function findSpace(root: CabinetNode, target: Target): CabinetNode | undefined {
  const all = spaces(root)
  const leaf = (node: CabinetNode): boolean => node.children === undefined && node.elementType !== 'drawer'
  if (target === 'root') return all[0]
  if (target === 'child') return all.find((node) => node.id !== root.id && leaf(node))
  if (target === 'leaf') return all.find(leaf)
  return all.find((node) => node.children !== undefined)
}

function spaceId(root: CabinetNode, target: Target): string {
  const found = findSpace(root, target)
  if (found === undefined) throw new Error(`no ${target} space in this unit`)
  return found.id
}

/** A material the unit does not already carry, so the action is not a no-op. */
function otherMaterial(current: CabinetMaterialId): CabinetMaterialId {
  return current === 'walnut' ? 'oak' : 'walnut'
}

type Step = { legacy: () => void; intent: Intent }
type Case = {
  name: string
  needs?: 'split' | 'second-unit'
  /** A material no side carries yet, so `setCabinetMaterial` is never a no-op. */
  steps: (material: CabinetMaterialId) => Step[]
}

/** The material the converted Project gives this unit. */
function designMaterial(project: Project, itemDesignId: string): CabinetMaterialId {
  const design = project.itemDesigns.find((each) => each.id === itemDesignId)
  if (design === undefined || design.kind !== 'cabinet') throw new Error(`no cabinet design ${itemDesignId}`)
  return design.construction.settings.material
}

function cabinetCases(unitId: string, root: CabinetNode): Case[] {
  const node = (target: Target): string => spaceId(root, target)
  const settings = (patch: Partial<GlobalSettings>): Step[] => [
    { legacy: () => useStore.getState().updateSettings(patch), intent: intent('cabinet.updateSettings', { itemDesignId: unitId, patch }) },
  ]
  const split = (type: 'cabinet.addShelf' | 'cabinet.addDivider', target: Target): Step[] => {
    const nodeId = node(target)
    return [{
      legacy: () => (type === 'cabinet.addShelf' ? useStore.getState().addShelf(nodeId) : useStore.getState().addDivider(nodeId)),
      intent: intent(type, { itemDesignId: unitId, nodeId }, newIds(2)),
    }]
  }
  return [
    { name: 'updateSettings', steps: () => settings({ width: 1000 }) },
    { name: 'updateSettings (depth and height)', steps: () => settings({ depth: 700, height: 900 }) },
    { name: 'updateSettings (thickness)', steps: () => settings({ thickness: 25 }) },
    { name: 'setCabinetMaterial', steps: (material) => [{
      legacy: () => useStore.getState().setCabinetMaterial(material),
      intent: intent('cabinet.setMaterial', { itemDesignId: unitId, material }),
    }] },
    { name: 'renameUnit', steps: () => [{
      legacy: () => useStore.getState().renameUnit(unitId, 'Bench unit'),
      intent: intent('cabinet.renameUnit', { itemDesignId: unitId, name: 'Bench unit' }),
    }] },
    { name: 'addShelf', needs: 'split', steps: () => split('cabinet.addShelf', 'leaf') },
    { name: 'addDivider', needs: 'split', steps: () => split('cabinet.addDivider', 'leaf') },
    { name: 'deleteBoard', needs: 'split', steps: () => [{
      legacy: () => useStore.getState().deleteBoard(node('child')),
      intent: intent('cabinet.deleteBoard', { itemDesignId: unitId, nodeId: node('child') }),
    }] },
    { name: 'setNodeSize', needs: 'split', steps: () => [{
      legacy: () => useStore.getState().setNodeSize(node('leaf'), 200),
      intent: intent('cabinet.setNodeSize', { itemDesignId: unitId, nodeId: node('leaf'), sizeMm: 200 }),
    }] },
    { name: 'pinNode', needs: 'split', steps: () => [{
      legacy: () => useStore.getState().pinNode(node('leaf'), 150),
      intent: intent('cabinet.pinNode', { itemDesignId: unitId, nodeId: node('leaf'), sizeMm: 150 }),
    }] },
    { name: 'pinNode then unpinNode', needs: 'split', steps: () => {
      const nodeId = node('leaf')
      return [
        { legacy: () => useStore.getState().pinNode(nodeId, 150), intent: intent('cabinet.pinNode', { itemDesignId: unitId, nodeId, sizeMm: 150 }) },
        { legacy: () => useStore.getState().unpinNode(nodeId), intent: intent('cabinet.unpinNode', { itemDesignId: unitId, nodeId }) },
      ]
    } },
    { name: 'setNodeLabel', steps: () => [{
      legacy: () => useStore.getState().setNodeLabel(node('root'), 'Bread pull-out'),
      intent: intent('cabinet.setNodeLabel', { itemDesignId: unitId, nodeId: node('root'), label: 'Bread pull-out' }),
    }] },
    { name: 'distributeEvenly', needs: 'split', steps: () => [{
      legacy: () => useStore.getState().distributeEvenly(node('root'), 200),
      intent: intent('cabinet.distributeEvenly', { itemDesignId: unitId, columnRootId: node('root'), evenH: 200 }),
    }] },
    { name: 'setElementType', steps: () => [{
      legacy: () => useStore.getState().setElementType(node('root'), 'drawer' satisfies ElementType),
      intent: intent('cabinet.setElementType', { itemDesignId: unitId, nodeId: node('root'), elementType: 'drawer' }),
    }] },
    { name: 'setDrawerConfig', steps: () => [{
      legacy: () => useStore.getState().setDrawerConfig(node('root'), { slideType: 'undermount', reveal: 12 }),
      intent: intent('cabinet.setDrawerConfig', { itemDesignId: unitId, nodeId: node('root'), config: { slideType: 'undermount', reveal: 12 } }),
    }] },
    { name: 'commitDrag', needs: 'split', steps: () => [{
      legacy: () => useStore.getState().commitDrag(node('root'), 0.3),
      intent: intent('cabinet.setSplitRatio', { itemDesignId: unitId, parentNodeId: node('root'), ratio: 0.3 }),
    }] },
    { name: 'addAccessory then removeAccessory', steps: () => {
      const nodeId = node('root')
      const accessoryId = newIds(1)[0]!
      const legacyAccessoryId = `legacy-${accessoryId}`
      const accessory = { type: 'door' as const, label: 'Recessed' }
      return [
        {
          legacy: () => useStore.getState().addAccessory(nodeId, { ...accessory, id: legacyAccessoryId }),
          intent: intent('cabinet.addAccessory', { itemDesignId: unitId, nodeId, accessory }, [accessoryId]),
        },
        {
          legacy: () => useStore.getState().removeAccessory(nodeId, legacyAccessoryId),
          intent: intent('cabinet.removeAccessory', { itemDesignId: unitId, nodeId, accessoryId }),
        },
      ]
    } },
    { name: 'addUnit', steps: () => [{
      legacy: () => useStore.getState().addUnit(),
      intent: intent('cabinet.addUnit', { sourceItemDesignId: unitId }, newIds(3)),
    }] },
    { name: 'removeUnit', needs: 'second-unit', steps: () => [{
      legacy: () => useStore.getState().removeUnit(otherUnitId(unitId)),
      intent: intent('cabinet.removeUnit', { itemDesignId: otherUnitId(unitId) }),
    }] },
  ]
}

/** The unit `removeUnit` takes away: the second one the Project holds. */
function otherUnitId(unitId: string): string {
  const other = legacyUnits().find((unit) => unit.id !== unitId)
  if (other === undefined) throw new Error('this unit is the only one')
  return other.id
}

const cabinetFixtures = STORE_FIXTURES.flatMap((fixture) => {
  const state = legacyState(fixture)
  return state.projects.flatMap((design) => {
    const units = (design.units ?? []) as { id: string; root?: CabinetNode }[]
    const first = units.find((unit) => unit.root !== undefined)
    return first === undefined || first.root === undefined
      ? []
      : [{
          fixture,
          designId: design.id,
          unitId: first.id,
          root: first.root,
          unitCount: units.length,
        }]
  })
})

describe.each(cabinetFixtures)('cabinet store parity: $fixture / $unitId', ({ fixture, designId, unitId, root, unitCount }) => {
  for (const testCase of cabinetCases(unitId, root)) {
    it(`${testCase.name} leaves the same scene as the store`, async () => {
      if (testCase.needs === 'split' && findSpace(root, 'split') === undefined) return
      if (testCase.needs === 'second-unit' && unitCount < 2) return

      const state = legacyState(fixture)
      const project = await converted(fixture, designId)
      const floor = project.floors[0]
      if (floor === undefined) throw new Error(`${fixture}: no Floor`)

      seedStore(state, designId, unitId)
      const steps = testCase.steps(otherMaterial(designMaterial(project, unitId)))
      for (const step of steps) step.legacy()
      const legacyLayout = computeSceneLayout(legacyUnits(), null)

      let current = project
      for (const step of steps) {
        const result = applyIntent(current, step.intent)
        if (!result.ok) throw new Error(`${testCase.name}: ${step.intent.type} was refused with ${result.code}`)
        current = result.project
      }
      const layout = computeSceneLayout(cabinetSceneUnits(current, floor.id), null)

      expectRows(geometryRows(layout), geometryRows(legacyLayout), `${fixture} ${unitId} ${testCase.name}`)
    })
  }
})

// --- The floor-plan actions, both ways ---------------------------------------

const FRIDGE = PLAN_CATALOGUE.fridge ?? { label: 'Fridge', w: 600, h: 650, height: 900, base: 0, color: '#10b981' }

/** The rectangle the plan cases add, at the catalogue's own size for `fridge`. */
const PLAN_OBJECT: FloorPlanObject = {
  id: 'parity-object',
  type: 'fridge',
  label: FRIDGE.label,
  x: 100,
  y: 100,
  w: FRIDGE.w,
  h: FRIDGE.h,
  rotation: 0,
  color: FRIDGE.color,
}

const PLAN_TEMPLATE: CustomTemplate = { id: 'parity-template', label: 'Bay', defaultW: 1200, defaultH: 400, color: '#123456' }

const PLAN_IMAGE: FloorPlanImage = { dataUrl: 'data:image/png;base64,iVBORw0KGgo=', widthPx: 1000, heightPx: 800 }

type PlanStep = { legacy: () => void | Promise<void>; intent: (floorId: string) => Promise<Intent> | Intent }
type PlanCase = {
  name: string
  /** The object or template the case acts on, seeded on both sides first. */
  seed?: 'object' | 'template'
  needsImage?: boolean
  /** The Intent that puts the seed on the Project side. */
  seedIntent?: (floorId: string) => Intent
  act: PlanStep
  domain: (project: Project, floorId: string) => Row[]
  legacy: () => Row[]
}

/** The floor-plan objects still standing, as corners. */
function legacyObjectCorners(id: string): Row[] {
  const object = legacyFloorPlan().objects.find((each) => each.id === id)
  return object === undefined ? [['gone']] : corners(object.x, object.y, object.w, object.h, object.rotation)
}

/** The generic Placed Items of one Floor: what `plan.clear` is allowed to take away. */
function genericPlacements(project: Project, floorId: string): Row[] {
  return project.existingModel.placedItems
    .filter((item) => item.floorId === floorId)
    .filter((item) => project.itemDesigns.find((design) => design.id === item.itemDesignId)?.kind === 'generic')
    .map((item): Row => [item.id])
}

const planCases: PlanCase[] = [
  {
    name: 'addFloorPlanObject',
    act: {
      legacy: () => useStore.getState().addFloorPlanObject({ ...PLAN_OBJECT }),
      intent: (floorId) => {
        const [itemDesignId] = newIds(1)
        // The Placed Item takes the legacy object's ID, which is the one the converter
        // would have handed out, so both sides name the same rectangle.
        return intent('plan.addObject', { floorId, catalogKey: 'fridge' }, [itemDesignId, PLAN_OBJECT.id])
      },
    },
    domain: (project) => placedCorners(project, PLAN_OBJECT.id),
    legacy: () => legacyObjectCorners(PLAN_OBJECT.id),
  },
  {
    name: 'updateFloorPlanObject',
    seed: 'object',
    seedIntent: (floorId) => intent('plan.addObject', { floorId, catalogKey: 'fridge' }, [newIds(1)[0]!, PLAN_OBJECT.id]),
    act: {
      legacy: () => useStore.getState().updateFloorPlanObject(PLAN_OBJECT.id, { x: 900, y: 400, rotation: 90 }),
      intent: () => intent('plan.updateObject', { placedItemId: PLAN_OBJECT.id, patch: { x: 900, y: 400, rotation: 90 } }),
    },
    domain: (project) => placedCorners(project, PLAN_OBJECT.id),
    legacy: () => legacyObjectCorners(PLAN_OBJECT.id),
  },
  {
    name: 'removeFloorPlanObject',
    seed: 'object',
    seedIntent: (floorId) => intent('plan.addObject', { floorId, catalogKey: 'fridge' }, [newIds(1)[0]!, PLAN_OBJECT.id]),
    act: {
      legacy: () => useStore.getState().removeFloorPlanObject(PLAN_OBJECT.id),
      intent: () => intent('plan.removeObject', { placedItemId: PLAN_OBJECT.id }),
    },
    domain: (project) => (project.existingModel.placedItems.some((item) => item.id === PLAN_OBJECT.id) ? [['there']] : [['gone']]),
    legacy: () => (legacyFloorPlan().objects.some((object) => object.id === PLAN_OBJECT.id) ? [['there']] : [['gone']]),
  },
  {
    name: 'addCustomTemplate',
    act: {
      legacy: () => useStore.getState().addCustomTemplate({ ...PLAN_TEMPLATE }),
      intent: () => intent('plan.addTemplate', {
        label: PLAN_TEMPLATE.label,
        w: PLAN_TEMPLATE.defaultW,
        h: PLAN_TEMPLATE.defaultH,
        color: PLAN_TEMPLATE.color,
      }, [PLAN_TEMPLATE.id]),
    },
    domain: (project) => templateRows(project.itemDesigns.find((design) => design.id === PLAN_TEMPLATE.id)),
    legacy: () => templateRowsLegacy(legacyFloorPlan().customTemplates.find((template) => template.id === PLAN_TEMPLATE.id)),
  },
  {
    name: 'removeCustomTemplate',
    seed: 'template',
    seedIntent: () => intent('plan.addTemplate', {
      label: PLAN_TEMPLATE.label,
      w: PLAN_TEMPLATE.defaultW,
      h: PLAN_TEMPLATE.defaultH,
      color: PLAN_TEMPLATE.color,
    }, [PLAN_TEMPLATE.id]),
    act: {
      legacy: () => useStore.getState().removeCustomTemplate(PLAN_TEMPLATE.id),
      intent: () => intent('plan.removeTemplate', { itemDesignId: PLAN_TEMPLATE.id }),
    },
    domain: (project) => (project.itemDesigns.some((design) => design.id === PLAN_TEMPLATE.id) ? [['there']] : [['gone']]),
    legacy: () => (legacyFloorPlan().customTemplates.some((template) => template.id === PLAN_TEMPLATE.id) ? [['there']] : [['gone']]),
  },
  {
    name: 'setFloorPlanScale',
    needsImage: true,
    act: {
      legacy: () => useStore.getState().setFloorPlanScale(0.4),
      intent: (floorId) => intent('plan.calibrate', { floorId, pixelsPerMm: 0.4 }),
    },
    domain: (project, floorId) => [[project.floors.find((floor) => floor.id === floorId)?.planImage?.pixelsPerMm ?? -1]],
    legacy: () => [[legacyFloorPlan().pixelsPerMm ?? -1]],
  },
  {
    name: 'setFloorPlanImage',
    act: {
      legacy: () => useStore.getState().setFloorPlanImage({ ...PLAN_IMAGE }),
      intent: async (floorId) => intent('plan.setImage', {
        floorId,
        image: {
          assetHash: await sha256Hex(new TextEncoder().encode(PLAN_IMAGE.dataUrl)),
          mediaType: 'image/png',
          widthPx: PLAN_IMAGE.widthPx,
          heightPx: PLAN_IMAGE.heightPx,
        },
        clearExisting: false,
      }),
    },
    domain: (project, floorId) => {
      const image = project.floors.find((floor) => floor.id === floorId)?.planImage
      return image === null || image === undefined ? [['none']] : [[image.widthPx, image.heightPx, image.pixelsPerMm ?? -1]]
    },
    legacy: () => {
      const { image, pixelsPerMm } = legacyFloorPlan()
      return image === null ? [['none']] : [[image.widthPx, image.heightPx, pixelsPerMm ?? -1]]
    },
  },
  {
    name: 'clearFloorPlan',
    seed: 'object',
    seedIntent: (floorId) => intent('plan.addObject', { floorId, catalogKey: 'fridge' }, [newIds(1)[0]!, PLAN_OBJECT.id]),
    act: {
      legacy: () => useStore.getState().clearFloorPlan(),
      intent: (floorId) => intent('plan.clear', { floorId }),
    },
    domain: (project, floorId) => genericPlacements(project, floorId),
    legacy: () => legacyFloorPlan().objects.map((object): Row => [object.id]),
  },
]

function templateRows(design: Project['itemDesigns'][number] | undefined): Row[] {
  if (design === undefined || design.kind !== 'generic') return [['gone']]
  return [[design.name, design.footprint.width, design.footprint.depth, design.color, design.isCustom === true ? 1 : 0]]
}

function templateRowsLegacy(template: CustomTemplate | undefined): Row[] {
  return template === undefined ? [['gone']] : [[template.label, template.defaultW, template.defaultH, template.color, 1]]
}

describe.each(STORE_FIXTURES)('floor-plan store parity: %s', (fixture) => {
  for (const planCase of planCases) {
    it(`${planCase.name} leaves the same floor plan as the store`, async () => {
      const state = legacyState(fixture)
      if (state.floorPlan === null) return
      const attached = await planProject(fixture)
      if (attached === null) return
      const { project, floorId } = attached
      if (planCase.needsImage === true && project.floors.find((floor) => floor.id === floorId)?.planImage === null) return

      seedStore(state, state.activeProjectId, null)
      if (planCase.seed === 'object') useStore.getState().addFloorPlanObject({ ...PLAN_OBJECT })
      if (planCase.seed === 'template') useStore.getState().addCustomTemplate({ ...PLAN_TEMPLATE })

      let source = project
      if (planCase.seedIntent !== undefined) {
        const seeded = applyIntent(source, planCase.seedIntent(floorId))
        if (!seeded.ok) throw new Error(`${planCase.name}: seeding was refused with ${seeded.code}`)
        source = seeded.project
      }

      await planCase.act.legacy()
      const legacyRows = planCase.legacy()

      const applied = await applyIntent(source, await planCase.act.intent(floorId))
      if (!applied.ok) throw new Error(`${planCase.name}: refused with ${applied.code}`)
      expectRows(planCase.domain(applied.project, floorId), legacyRows, `${fixture} ${planCase.name}`)
    })
  }
})

// --- Criterion 4's meta-test -------------------------------------------------

/** The store actions that are not Intents, and why (#47 "Not Intents"). */
const NOT_INTENTS: Record<string, true> = {
  createProject: true,
  deleteProject: true,
  setActiveProject: true,
  setActiveUnit: true,
  setSelectedId: true,
  setSnapGrid: true,
  selectFloorPlanObject: true,
  importWorkspace: true,
  addAnnotation: true,
  removeAnnotation: true,
  persist: true,
}

/** `StoreState` action name → the Intent that replaced it, as the issue's table states it. */
const ACTION_TO_INTENT: Record<string, string> = {
  renameProject: 'project.rename',
  updateSettings: 'cabinet.updateSettings',
  updateUnitSettings: 'cabinet.updateSettings',
  setCabinetMaterial: 'cabinet.setMaterial',
  addUnit: 'cabinet.addUnit',
  removeUnit: 'cabinet.removeUnit',
  renameUnit: 'cabinet.renameUnit',
  addShelf: 'cabinet.addShelf',
  addDivider: 'cabinet.addDivider',
  deleteBoard: 'cabinet.deleteBoard',
  setNodeSize: 'cabinet.setNodeSize',
  pinNode: 'cabinet.pinNode',
  unpinNode: 'cabinet.unpinNode',
  unlockNode: 'cabinet.unpinNode',
  setNodeLabel: 'cabinet.setNodeLabel',
  distributeEvenly: 'cabinet.distributeEvenly',
  setElementType: 'cabinet.setElementType',
  setDrawerConfig: 'cabinet.setDrawerConfig',
  commitDrag: 'cabinet.setSplitRatio',
  addAccessory: 'cabinet.addAccessory',
  removeAccessory: 'cabinet.removeAccessory',
  addFloorPlanObject: 'plan.addObject',
  updateFloorPlanObject: 'plan.updateObject',
  removeFloorPlanObject: 'plan.removeObject',
  addCustomTemplate: 'plan.addTemplate',
  removeCustomTemplate: 'plan.removeTemplate',
  setFloorPlanImage: 'plan.setImage',
  setFloorPlanScale: 'plan.calibrate',
  clearFloorPlan: 'plan.clear',
}

/** The catalogue rows no single store action names: the template fork and the two labels. */
const EXTRA_INTENTS = ['plan.addFromTemplate']

function storeActions(): string[] {
  const state = useStore.getState() as unknown as Record<string, unknown>
  return Object.keys(state).filter((key) => typeof state[key] === 'function')
}

describe('action coverage', () => {
  it('every store action is an Intent or is listed as not one', () => {
    const actions = storeActions()
    expect(actions.length).toBeGreaterThan(20)
    const unexplained = actions.filter((action) => !(action in ACTION_TO_INTENT) && !(action in NOT_INTENTS))
    expect(unexplained, `these store actions have no Intent: ${unexplained.join(', ')}`).toEqual([])
  })

  it('maps only actions the store really has', () => {
    const actions = new Set(storeActions())
    const stale = Object.keys(ACTION_TO_INTENT).filter((action) => !actions.has(action))
    expect(stale, `these mapped actions no longer exist: ${stale.join(', ')}`).toEqual([])
  })

  it('names only Intents that exist, each with a label', () => {
    const labels = INTENT_LABELS as Record<string, string>
    for (const type of [...Object.values(ACTION_TO_INTENT), ...EXTRA_INTENTS]) {
      expect(labels[type], `no label for ${type}`).toBeTruthy()
    }
    // The catalogue has no Intent the table does not account for.
    expect(Object.keys(labels).sort()).toEqual([...new Set([...Object.values(ACTION_TO_INTENT), ...EXTRA_INTENTS])].sort())
  })
})

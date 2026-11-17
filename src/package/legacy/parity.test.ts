/**
 * Parity, the reason #43 has to be exact (#20 §13.4, §13.5, §15.2):
 *
 * 1. every converted cabinet reproduces `computeSceneLayout` within 0.01 mm;
 * 2. every converted floor-plan object reproduces its legacy rectangle's four corners
 *    within 0.01 mm;
 * 3. the Cut List from converted Item Designs equals the legacy Cut List at 0.001 mm.
 *
 * The legacy side is built here by running the frozen migrators the same way the converter
 * does, from the same allocator sequence, so both sides name the same units.
 *
 * Countertop parity is recorded as not applicable: no countertop code exists to be wrong
 * (#20 §15.2), and `computeCutListForUnits` answers nothing for a non-cabinet unit.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { computeCutListForUnits, computeSceneLayout, type CabinetSceneUnit, type CutListEntry, type SceneLayout } from '../../cabinet'
import { cabinetSceneUnits } from '../../derive'
import type { CabinetNode, Project } from '../../domain'
import {
  convertLegacy,
  migrateLegacyState,
  upgradeLegacyDesign,
  type LegacyCabinetNode,
  type LegacyConversion,
  type LegacyDesign,
  type LegacyFloorPlanConversion,
  type LegacyFloorPlanObject,
} from '../index'

const fixturesRoot = fileURLToPath(new URL('../../../fixtures/legacy', import.meta.url))
const read = (rel: string): string => readFileSync(join(fixturesRoot, rel), 'utf8')
const listed = (dir: string, suffix: string): string[] =>
  readdirSync(join(fixturesRoot, dir)).filter((name) => name.endsWith(suffix)).sort().map((name) => `${dir}/${name}`)

const STORE_FIXTURES = ['v0', 'v1', 'v2', 'v3', 'v3-large-image'].map((name) => `${name}/buildbox-store.json`)

/** Fixtures holding cabinets, in the vocabulary `computeSceneLayout` speaks. */
const CABINET_FIXTURES = [...STORE_FIXTURES, ...listed('workspace', '.buildbox.json')]
/** Fixtures holding floor-plan objects. */
const PLAN_FIXTURES = [...STORE_FIXTURES, ...listed('floor-plan', '.json'), 'edge-cases/floor-plan-sketches.json']

const allocator = (): (() => string) => {
  let issued = 0
  return () => `gen-${++issued}`
}

const LAYOUT_TOLERANCE = 0.01
const CUT_TOLERANCE = 0.001

// --- Reading the legacy side --------------------------------------------------

/** A JSON object, or null. The fixtures are validated by `src/test/legacyFixtures.test.ts`. */
function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/**
 * The Designs as v3 sees them, migrated with a fresh allocator. The converter does the same
 * first, from the same sequence, so the unit IDs the v0→v1 migrator invents are the same ones.
 */
function legacyDesigns(rel: string): LegacyDesign[] {
  const source = record(JSON.parse(read(rel)))
  if (source === null) throw new Error(`${rel}: not an object`)

  // A workspace file already holds `projects`; the store keeps them under `state`.
  if (Array.isArray(source.projects)) {
    return source.projects.map((design) => upgradeLegacyDesign(design, allocator())) as LegacyDesign[]
  }
  const state = record(source.state)
  if (state === null || !Array.isArray(state.projects)) return []

  const version = typeof source.version === 'number' ? source.version : 3
  const migrated = record(migrateLegacyState(state, version, allocator()))
  const projects = migrated === null || !Array.isArray(migrated.projects) ? [] : migrated.projects
  return projects as LegacyDesign[]
}

/** The floor-plan objects as stored, wherever this kind of source keeps them. */
function legacyObjects(rel: string): LegacyFloorPlanObject[] {
  const source = record(JSON.parse(read(rel)))
  if (source === null) throw new Error(`${rel}: not an object`)
  if (Array.isArray(source.objects)) return source.objects as LegacyFloorPlanObject[]

  const state = record(source.state)
  const plan = state === null ? null : record(state.floorPlan)
  const objects = plan === null || !Array.isArray(plan.objects) ? [] : plan.objects
  return objects as LegacyFloorPlanObject[]
}

async function conversion(rel: string): Promise<LegacyConversion> {
  const result = await convertLegacy(read(rel), { newId: allocator() })
  if (!result.ok) throw new Error(`${rel}: ${JSON.stringify(result.problems)}`)
  return result.conversion
}

function projectOf(source: LegacyConversion, designId: string): Project {
  const proposal = source.projects.find((each) => each.designId === designId)
  if (proposal === undefined || proposal.status !== 'ok') throw new Error(`no Project for ${designId}`)
  return proposal.project
}

function planOf(source: LegacyConversion, rel: string): LegacyFloorPlanConversion {
  const plan = source.floorPlan
  if (plan === null || plan.status !== 'ok') throw new Error(`${rel}: ${JSON.stringify(plan)}`)
  return plan
}

/**
 * The retired node-level `material` goes nowhere in v1 (#20 §3), so it is dropped from the
 * legacy tree before comparing trees — the only difference the converter is allowed to make.
 */
function withoutMaterial(node: LegacyCabinetNode): CabinetNode {
  const { material, children, ...rest } = node
  // `material` is the retired node-level field; the converter is not allowed to carry it.
  void material
  return {
    ...rest,
    ...(children === undefined ? {} : { children: children.map((child) => withoutMaterial(child)) }),
  } as CabinetNode
}

// --- Comparing at a stated tolerance ------------------------------------------

type Row = [key: string, ...values: number[]]

function expectRows(actual: Row[], expected: Row[], tolerance: number): void {
  expect(actual.map((row) => row[0])).toEqual(expected.map((row) => row[0]))
  for (const [index, row] of expected.entries()) {
    const other = actual[index]
    if (other === undefined) throw new Error(`missing row ${row[0]}`)
    for (let at = 1; at < row.length; at += 1) {
      const want = row[at] as number
      const got = other[at] as number
      expect(Math.abs(got - want) <= tolerance, `${row[0]} value ${at}: ${got} vs ${want}`).toBe(true)
    }
  }
}

/** Every rectangle the scene draws, keyed by what it is, plus the unit frame itself. */
function sceneRows(layout: SceneLayout): Row[] {
  return layout.units.flatMap((unit): Row[] => [
    [`unit ${unit.unitId}`, unit.x, unit.y, unit.w, unit.h],
    ...unit.panels.map((panel): Row => [`panel ${panel.id} ${panel.role}`, panel.x, panel.y, panel.w, panel.h]),
    ...unit.voids.map((space): Row => [`void ${space.nodeId} ${space.elementType}`, space.x, space.y, space.w, space.h]),
    ...unit.dividers.map((divider): Row => [`divider ${divider.nodeId}`, divider.x, divider.y, divider.w, divider.h]),
  ])
}

/** Rows as an unordered multiset: the Cut List groups, so row order is not the contract. */
function cutRows(entries: CutListEntry[]): Row[] {
  return entries
    .map((entry): Row => [
      [entry.unitId, entry.unitLabel, entry.label, entry.material, entry.qty, entry.notes ?? ''].join('|'),
      ...[entry.width, entry.height, entry.depth].sort((a, b) => a - b),
    ])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
}

// --- Criteria 1 and 3: cabinets ------------------------------------------------

const cabinetCases = CABINET_FIXTURES.flatMap((fixture) =>
  legacyDesigns(fixture).map((design) => ({ fixture, designId: design.id, design })))

describe.each(cabinetCases)('cabinet parity: $fixture / $designId', ({ fixture, design }) => {
  it('reproduces the scene layout and the Cut List', async () => {
    const converted = await conversion(fixture)
    const project = projectOf(converted, design.id)
    const [floor] = project.floors
    if (floor === undefined) throw new Error(`${fixture}: expected a Floor`)

    const legacyUnits: CabinetSceneUnit[] = design.units
    const units = cabinetSceneUnits(project, floor.id)

    // The inverse projection rebuilds the unit list the legacy editor drew.
    expect(units.map((unit) => unit.id)).toEqual(legacyUnits.map((unit) => unit.id))
    expect(units.map((unit) => unit.label)).toEqual(legacyUnits.map((unit) => unit.label))
    expectRows(
      units.map((unit): Row => [`unit ${unit.id}`, unit.x, unit.y]),
      legacyUnits.map((unit): Row => [`unit ${unit.id}`, unit.x, unit.y]),
      LAYOUT_TOLERANCE,
    )
    units.forEach((unit, index) => {
      const legacy = legacyUnits[index]
      if (legacy === undefined) throw new Error(`${fixture}: missing unit ${unit.id}`)
      expect(unit.settings).toEqual(legacy.settings)
      expect(unit.root).toEqual(withoutMaterial(legacy.root))
    })

    // Criterion 1: the same scene, to within 0.01 mm, over-constrained nodes included.
    const legacyLayout = computeSceneLayout(legacyUnits, null)
    const layout = computeSceneLayout(units, null)
    expectRows(sceneRows(layout), sceneRows(legacyLayout), LAYOUT_TOLERANCE)
    expect(layout.units.map((unit) => unit.overConstrainedIds))
      .toEqual(legacyLayout.units.map((unit) => unit.overConstrainedIds))

    // Criterion 3: the same Cut List, as a multiset, to within 0.001 mm.
    expectRows(
      cutRows(computeCutListForUnits(units)),
      cutRows(computeCutListForUnits(legacyUnits)),
      CUT_TOLERANCE,
    )
  })
})

// --- Criterion 2: floor-plan objects -------------------------------------------

/** SVG `rotate(deg)` in a +Y-down frame — the one turn convention legacy and domain share. */
function rotate(dx: number, dy: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180
  return [dx * Math.cos(rad) - dy * Math.sin(rad), dx * Math.sin(rad) + dy * Math.cos(rad)]
}

/** The four corners of a `w`×`h` rectangle whose top-left is `(x, y)`, turned about its centre. */
function corners(x: number, y: number, w: number, h: number, deg: number): Row[] {
  const cx = x + w / 2
  const cy = y + h / 2
  return [[0, 0], [w, 0], [w, h], [0, h]].map(([dx, dy], index): Row => {
    const [rx, ry] = rotate(dx - w / 2, dy - h / 2, deg)
    return [`corner ${index}`, cx + rx, cy + ry]
  })
}

const sorted = (rows: Row[]): Row[] => [...rows].sort((a, b) => (a[0] < b[0] ? -1 : 1))

describe.each(PLAN_FIXTURES)('floor-plan parity: %s', (fixture) => {
  it('reproduces every object rectangle', async () => {
    const objects = legacyObjects(fixture)
    const plan = planOf(await conversion(fixture), fixture)
    if (plan.status !== 'ok') throw new Error(`${fixture}: no floor plan`)

    expect(plan.content.placements).toHaveLength(objects.length)
    for (const object of objects) {
      const placement = plan.content.placements.find((each) => each.id === object.id)
      const design = plan.content.itemDesigns.find((each) => each.id === placement?.itemDesignId)
      if (placement === undefined || design === undefined || design.kind !== 'generic') {
        throw new Error(`${fixture}: no Placed Item for ${object.id}`)
      }
      const footprint = design.footprint
      if (footprint.kind !== 'rectangle') throw new Error(`${fixture}: ${object.id} is not a rectangle`)

      // The degrees are copied, not converted: 0/90/180/270 mean the same turn in v1.
      expect(placement.rotationDeg).toBe(object.rotation)
      expect(footprint.width).toBe(object.w)
      expect(footprint.depth).toBe(object.h)
      expect(design.origin).toEqual({ x: object.w / 2, y: object.h / 2 })

      // The domain transform is `translation + R(rotationDeg) · (p − origin)`. With the
      // origin at the centre and the translation at the legacy centre it is the legacy
      // `rotate(rotation, cx, cy)` of the same four corners.
      const placed = corners(
        placement.translation.x - object.w / 2,
        placement.translation.y - object.h / 2,
        object.w,
        object.h,
        object.rotation,
      )
      const legacy = corners(object.x, object.y, object.w, object.h, object.rotation)
      expectRows(sorted(placed), sorted(legacy), LAYOUT_TOLERANCE)
    }
  })
})

/**
 * One test per row of the #20 §3 mapping table (#43). Each test quotes its row in the
 * name, so a failing test says which row moved.
 */
import { describe, expect, it } from 'vitest'
import { convertLegacy, type LegacyConversionResult } from '../index'
import type { GenericItemDesign, Project } from '../../domain'
import type { LegacyFloorPlanObjectType } from './types'

/** IDs in a known order: a test that sees `new-2` knows exactly what it was for. */
const seq = (): (() => string) => {
  let issued = 0
  return () => `new-${++issued}`
}

const SETTINGS = {
  unit: 'mm',
  height: 800,
  width: 600,
  depth: 500,
  thickness: 18,
  backThickness: 6,
  toeKick: { height: 100, setback: 50 },
  material: 'walnut',
}

const unit = (over: Record<string, unknown> = {}): unknown => ({
  type: 'cabinet',
  id: 'unit-1',
  label: 'Base Unit',
  x: 120,
  y: 60,
  settings: SETTINGS,
  root: { id: 'root-1', elementType: 'void', spaceLabel: 'Open' },
  ...over,
})

const design = (over: Record<string, unknown> = {}): unknown => ({
  id: 'proj-1',
  name: 'Kitchen Wall',
  units: [unit()],
  ...over,
})

const EMPTY_PLAN = { image: null, pixelsPerMm: null, objects: [], annotations: [], customTemplates: [] }

/** A v3 store envelope: the shape every other version migrates to. */
const storeFile = (projects: unknown[], activeProjectId: string | null = null): string =>
  JSON.stringify({ state: { projects, activeProjectId, floorPlan: EMPTY_PLAN }, version: 3 })

const planFile = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({ ...EMPTY_PLAN, ...over })

const planObject = (over: Record<string, unknown> = {}): unknown => ({
  id: 'fp-sofa',
  type: 'sofa-3',
  label: 'Fabric sofa',
  x: 100,
  y: 200,
  w: 2200,
  h: 900,
  rotation: 90,
  color: '#8d6e63',
  ...over,
})

const convert = async (raw: string): Promise<LegacyConversionResult> =>
  convertLegacy(raw, { newId: seq() })

/** The one Project of a one-Design source, or the problems that stopped it. */
const onlyProject = async (raw: string): Promise<Project> => {
  const result = await convert(raw)
  if (!result.ok) throw new Error(JSON.stringify(result.problems))
  const [proposal] = result.conversion.projects
  if (proposal === undefined || proposal.status !== 'ok') throw new Error(JSON.stringify(proposal))
  return proposal.project
}

const onlyFloorPlan = async (raw: string) => {
  const result = await convert(raw)
  if (!result.ok) throw new Error(JSON.stringify(result.problems))
  const plan = result.conversion.floorPlan
  if (plan === null || plan.status !== 'ok') throw new Error(JSON.stringify(plan))
  return plan
}

describe('Design → Project', () => {
  it('carries the id, the name, the v1 defaults, one Floor named "Floor 1" and nothing else', async () => {
    const project = await onlyProject(storeFile([design()]))

    expect(Object.keys(project).sort()).toEqual(['existingModel', 'floors', 'id', 'itemDesigns', 'meta', 'preferences'])
    expect(project.id).toBe('proj-1')
    expect(project.meta).toEqual({ name: 'Kitchen Wall' })
    expect(project.preferences).toEqual({ displayUnit: 'mm', displayPrecision: 0 })
    expect(project.floors).toEqual([{ id: 'new-1', name: 'Floor 1', planImage: null }])
  })

  it('maps each unit to a cabinet Item Design with its settings copied byte-for-byte', async () => {
    const project = await onlyProject(storeFile([design({
      units: [unit({ settings: { ...SETTINGS, unit: 'in', material: 'oak' } })],
    })]))

    expect(project.itemDesigns).toEqual([
      {
        id: 'unit-1',
        kind: 'cabinet',
        name: 'Base Unit',
        construction: {
          settings: { ...SETTINGS, unit: 'in', material: 'oak' },
          root: { id: 'root-1', elementType: 'void', spaceLabel: 'Open' },
        },
      },
    ])
  })

  it('places each unit with a new id, the centre translation, no turn, and y as base elevation', async () => {
    const project = await onlyProject(storeFile([design({
      units: [unit({ x: 120, y: 60 }), unit({ id: 'unit-2', label: 'Tall Unit', x: 800, y: 150 })],
    })]))

    expect(project.existingModel.placedItems).toEqual([
      {
        id: 'new-2',
        itemDesignId: 'unit-1',
        floorId: 'new-1',
        // 120 + 600/2 and 500/2: the front sits on plan Y = 0, so depth/2 is the centre.
        translation: { x: 420, y: 250 },
        rotationDeg: 0,
        baseElevation: 60,
      },
      {
        id: 'new-3',
        itemDesignId: 'unit-2',
        floorId: 'new-1',
        translation: { x: 1100, y: 250 },
        rotationDeg: 0,
        baseElevation: 150,
      },
    ])
  })

  it('drops the retired node-level material and keeps every space below it', async () => {
    const root = {
      id: 'root-1',
      material: 'oak',
      splitAxis: 'vertical',
      splitRatio: 0.5,
      children: [
        { id: 'a', elementType: 'void', material: 'walnut' },
        { id: 'b', elementType: 'hanging-space' },
      ],
    }
    const project = await onlyProject(storeFile([design({ units: [unit({ root })] })]))

    const [cabinet] = project.itemDesigns
    if (cabinet === undefined || cabinet.kind !== 'cabinet') throw new Error('expected a cabinet')
    expect(cabinet.construction.root).toEqual({
      id: 'root-1',
      splitAxis: 'vertical',
      splitRatio: 0.5,
      children: [{ id: 'a', elementType: 'void' }, { id: 'b', elementType: 'hanging-space' }],
    })
  })

  it('puts the active Design first and keeps legacy order after it', async () => {
    const result = await convert(storeFile(
      [design({ id: 'proj-a' }), design({ id: 'proj-b' }), design({ id: 'proj-c' })],
      'proj-c',
    ))
    if (!result.ok) throw new Error(JSON.stringify(result.problems))

    expect(result.conversion.projects.map((proposal) => proposal.designId))
      .toEqual(['proj-c', 'proj-a', 'proj-b'])
  })
})

describe('FloorPlanObject → generic Item Design and placement', () => {
  it('makes one generic Item Design per object, with a new id and its centre as origin', async () => {
    const plan = await onlyFloorPlan(planFile({ objects: [planObject()] }))

    expect(plan.content.itemDesigns).toEqual([
      {
        id: 'new-1',
        kind: 'generic',
        name: 'Fabric sofa',
        footprint: { kind: 'rectangle', width: 2200, depth: 900 },
        origin: { x: 1100, y: 450 },
        height: 850,
        heightIsTypical: true,
        color: '#8d6e63',
        catalogKey: 'sofa-3',
      },
    ])
  })

  it('keeps isCustom only when the object carried one', async () => {
    const plain = await onlyFloorPlan(planFile({ objects: [planObject()] }))
    const custom = await onlyFloorPlan(planFile({ objects: [planObject({ isCustom: true })] }))

    expect('isCustom' in (plain.content.itemDesigns[0] as object)).toBe(false)
    expect((custom.content.itemDesigns[0] as GenericItemDesign).isCustom).toBe(true)
  })

  it('keeps the legacy object id on the placement and turns about the centre', async () => {
    const plan = await onlyFloorPlan(planFile({ objects: [planObject()] }))

    expect(plan.content.placements).toEqual([
      {
        id: 'fp-sofa',
        itemDesignId: 'new-1',
        translation: { x: 1200, y: 650 },
        rotationDeg: 90,
        baseElevation: 0,
      },
    ])
  })

  it('lifts a wall-hung object onto its base elevation', async () => {
    const plan = await onlyFloorPlan(planFile({ objects: [planObject({ id: 'fp-fan', type: 'ceiling-fan' })] }))

    expect(plan.content.placements[0]?.baseElevation).toBe(2300)
  })

  it.each([
    ['sofa-2', 850, 0],
    ['sofa-3', 850, 0],
    ['armchair', 850, 0],
    ['bed-single', 500, 0],
    ['bed-double', 500, 0],
    ['bed-queen', 500, 0],
    ['bed-king', 500, 0],
    ['fridge', 1800, 0],
    ['washer', 850, 0],
    ['dryer', 850, 0],
    ['water-heater', 500, 1800],
    ['robot-vacuum', 100, 0],
    ['toilet', 750, 0],
    ['basin', 200, 650],
    ['bathtub', 550, 0],
    ['shower', 2100, 0],
    ['ceiling-fan', 300, 2300],
    ['light', 150, 2450],
    ['tv', 700, 900],
    ['curtain-rail', 100, 2400],
    ['wardrobe', 2400, 0],
    ['kitchen-counter', 900, 0],
    ['cabinet-unit', 900, 0],
    ['custom', 900, 0],
  ] as Array<[LegacyFloorPlanObjectType, number, number]>)('gives a %s its typical height and base', async (type, height, base) => {
    const plan = await onlyFloorPlan(planFile({ objects: [planObject({ type })] }))
    const [itemDesign] = plan.content.itemDesigns
    const [placement] = plan.content.placements

    expect(itemDesign).toMatchObject({ kind: 'generic', height, heightIsTypical: true, catalogKey: type })
    expect(placement?.baseElevation).toBe(base)
  })
})

describe('CustomTemplate → generic Item Design', () => {
  it('keeps the template id, its default size, isCustom, and gives it no placements', async () => {
    const plan = await onlyFloorPlan(planFile({
      customTemplates: [{ id: 'tpl-island', label: 'Island', defaultW: 1200, defaultH: 800, color: '#f0a202' }],
    }))

    expect(plan.content.itemDesigns).toEqual([
      {
        id: 'tpl-island',
        kind: 'generic',
        name: 'Island',
        footprint: { kind: 'rectangle', width: 1200, depth: 800 },
        origin: { x: 600, y: 400 },
        height: 900,
        heightIsTypical: true,
        color: '#f0a202',
        isCustom: true,
      },
    ])
    expect(plan.content.placements).toEqual([])
  })
})

describe('floor plan image → Plan Image', () => {
  // 'Mam=' is the PNG magic number's first three bytes, enough to be real base64.
  const dataUrl = 'data:image/png;base64,iVBORw0KGgo='

  it('hashes the decoded bytes and keeps the size, the media type and the scale', async () => {
    const plan = await onlyFloorPlan(planFile({
      image: { dataUrl, widthPx: 256, heightPx: 192 },
      pixelsPerMm: 0.25,
    }))

    expect(plan.content.planImage).toEqual({
      assetHash: await sha('iVBORw0KGgo='),
      mediaType: 'image/png',
      widthPx: 256,
      heightPx: 192,
      pixelsPerMm: 0.25,
    })
  })

  it('reports an uncalibrated plan as a null scale, and never rescales the objects', async () => {
    const plan = await onlyFloorPlan(planFile({ image: { dataUrl, widthPx: 100, heightPx: 80 }, objects: [planObject()] }))

    expect(plan.content.planImage?.pixelsPerMm).toBeNull()
    expect(plan.content.placements[0]?.translation).toEqual({ x: 1200, y: 650 })
  })

  it('keeps a media type the domain does not know, rather than guessing png', async () => {
    const plan = await onlyFloorPlan(planFile({
      image: { dataUrl: 'data:image/tiff;base64,iVBORw0KGgo=', widthPx: 10, heightPx: 10 },
    }))

    expect(plan.content.planImage?.mediaType).toBe('image/tiff')
  })

  it('hands the decoded bytes back once per distinct image', async () => {
    const result = await convert(planFile({ image: { dataUrl, widthPx: 8, heightPx: 8 } }))
    if (!result.ok) throw new Error(JSON.stringify(result.problems))

    expect(result.conversion.assets).toHaveLength(1)
    const [asset] = result.conversion.assets
    expect(asset?.mediaType).toBe('image/png')
    expect(asset?.sha256).toBe(await sha('iVBORw0KGgo='))
    expect([...(asset?.bytes ?? [])]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  })

  it('rejects a data URL that is not base64, and only the floor plan with it', async () => {
    const result = await convert(planFile({
      image: { dataUrl: 'data:image/png;base64,not base64!', widthPx: 8, heightPx: 8 },
      objects: [planObject()],
    }))
    if (!result.ok || result.conversion.floorPlan?.status !== 'rejected') throw new Error(JSON.stringify(result))

    expect(result.conversion.floorPlan.problems).toEqual([
      { path: 'image.dataUrl', code: 'bad-data-url', message: 'Expected the image encoded as base64.' },
    ])
  })
})

describe('annotations', () => {
  it('discards both sketch kinds and counts them', async () => {
    const plan = await onlyFloorPlan(planFile({
      annotations: [
        { id: 'a-1', type: 'wall-hack', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
        { id: 'a-2', type: 'tile-zone', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] },
        { id: 'a-3', type: 'tile-zone', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
      ],
    }))

    expect(plan.discarded).toEqual({ wallHack: 1, tileZone: 2 })
    expect(plan.content.itemDesigns).toEqual([])
    expect(plan.content.placements).toEqual([])
  })
})

/** The reference hash, so the test states the row rather than a constant nobody trusts. */
async function sha(body: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(Buffer.from(body, 'base64')))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

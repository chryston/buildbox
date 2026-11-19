/**
 * Test support for the `.buildbox` codec (#44): the Project the golden fixture is built
 * from, and the meta the fixture was written with. Importable from `*.test.ts` only
 * (`eslint.config.js` boundaries), and never from `app`.
 */
import { rectangleFootprint } from '../domain'
import type { CabinetNode, EntityId, GlobalSettings, Project } from '../domain'

/**
 * The IDs `stageImport` hands a domain migration that has to name something new — the
 * default Plan View of every Floor in a v1 file (#56). Sequential and prefixed, so a test
 * that reads a migrated Project can say which ID came from where.
 */
export function allocateIds(prefix = 'migrated'): (count: number) => EntityId[] {
  let issued = 0
  return (count: number) => Array.from({ length: count }, () => `${prefix}-${(issued += 1)}`)
}

/** The fixture is written as if by BuildBox 0.0.0 at the epoch, so it never changes. */
export const FIXTURE_EXPORTED_AT = '2026-01-01T00:00:00.000Z'
export const FIXTURE_BUILD = { exportedAt: FIXTURE_EXPORTED_AT, buildboxVersion: '0.0.0', preview: false } as const

/**
 * The SHA-256 of `fixtures/package/v1/assets/<this>.png`, which is the Plan Image of
 * `floor-0`. `fixtures.test.ts` re-reads the committed bytes and proves this still holds.
 */
export const FIXTURE_PLAN_IMAGE_HASH = 'e4a90d35369f2894e94e86cab4153ac6a44ab48dc6665ccd68e3b95f7a33ae66'

const SETTINGS: GlobalSettings = {
  unit: 'mm',
  height: 850,
  width: 600,
  depth: 560,
  thickness: 18,
  backThickness: 6,
  toeKick: { height: 100, setback: 50 },
  material: 'walnut',
}

const SPLIT_ROOT: CabinetNode = {
  id: 'node-root',
  splitAxis: 'horizontal',
  splitRatio: 0.6,
  children: [
    { id: 'node-left', drawerConfig: { slideType: 'undermount', reveal: 20 } },
    { id: 'node-right', locked: true, fixedSize: 300, elementType: 'hanging-space' },
  ],
}

const TALL_ROOT: CabinetNode = {
  id: 'tall-root',
  splitAxis: 'vertical',
  splitRatio: 0.45,
  children: [
    { id: 'tall-top', elementType: 'hanging-space', locked: true },
    {
      id: 'tall-bottom',
      elementType: 'drawer',
      drawerConfig: { slideType: 'side-mount', reveal: 18 },
      dividers: [{ id: 'tall-divider', materialId: 'walnut' }],
    },
  ],
}

/**
 * The fixture Project: two cabinet Item Designs, three generic Item Designs, two Floors
 * (the first carrying the Plan Image) and four Placed Items — enough of the schema that a
 * golden file catches a change to any part of the record.
 */
export function fixtureProject(): Project {
  return {
    id: 'project-0',
    meta: { name: 'Maple Street Kitchen', address: '412 Maple Street' },
    preferences: { displayUnit: 'cm', displayPrecision: 1 },
    floors: [
      {
        id: 'floor-0',
        name: 'Floor 1',
        planImage: {
          assetHash: FIXTURE_PLAN_IMAGE_HASH,
          mediaType: 'image/png',
          widthPx: 256,
          heightPx: 256,
          pixelsPerMm: 0.5,
        },
      },
      { id: 'floor-1', name: 'Mezzanine', planImage: null },
    ],
    views: [
      { id: 'view-0', kind: 'plan', floorId: 'floor-0', name: 'Floor 1', isDefault: true, showPlanImage: true },
      { id: 'view-1', kind: 'plan', floorId: 'floor-1', name: 'Mezzanine', isDefault: true, showPlanImage: true },
    ],
    itemDesigns: [
      { id: 'design-0', kind: 'cabinet', name: 'Base Cabinet', construction: { settings: SETTINGS, root: SPLIT_ROOT } },
      { id: 'design-1', kind: 'cabinet', name: 'Tall Larder', construction: { settings: SETTINGS, root: TALL_ROOT } },
      {
        id: 'design-2',
        kind: 'generic',
        name: 'King Bed',
        footprint: rectangleFootprint(1820, 1980),
        origin: { x: 910, y: 990 },
        height: 500,
        heightIsTypical: true,
        color: '#8b5a2b',
        catalogKey: 'bed-king',
      },
      {
        id: 'design-3',
        kind: 'generic',
        name: 'Pendant Light',
        footprint: rectangleFootprint(320, 320),
        origin: { x: 160, y: 160 },
        height: 220,
        heightIsTypical: false,
        color: '#2f4858',
        isCustom: true,
      },
      {
        id: 'design-4',
        kind: 'generic',
        name: 'Runner Rug',
        footprint: rectangleFootprint(2400, 800),
        origin: { x: 1200, y: 400 },
        height: 12,
        heightIsTypical: false,
        color: '#c9ada7',
      },
    ],
    existingModel: {
      placedItems: [
        {
          id: 'place-0',
          itemDesignId: 'design-0',
          floorId: 'floor-0',
          translation: { x: 1200, y: 0 },
          rotationDeg: 90,
          baseElevation: 0,
        },
        {
          id: 'place-1',
          itemDesignId: 'design-1',
          floorId: 'floor-0',
          translation: { x: 2400, y: 600 },
          rotationDeg: 0,
          baseElevation: 0,
        },
        {
          id: 'place-2',
          itemDesignId: 'design-2',
          floorId: 'floor-1',
          translation: { x: 400, y: 300 },
          rotationDeg: 180,
          baseElevation: 2800,
        },
        {
          id: 'place-3',
          itemDesignId: 'design-4',
          floorId: 'floor-0',
          translation: { x: 900, y: 1500 },
          rotationDeg: 270,
          baseElevation: 0,
        },
      ],
    },
  }
}

/**
 * The same fixture as the v1 and v2 golden files store it: an Item Footprint was a kind, a
 * width and a depth until v3 restated it as a preset (#58).
 *
 * Those two files hold the bytes they were written from and are never edited, so the record
 * they are compared against has to be the one a v2 BuildBox wrote — not the one this build
 * reads them into. It is a serialised record rather than a `Project`, because this build's
 * `Project` no longer describes it.
 */
export function legacyFixtureRecord(): unknown {
  const project = fixtureProject()
  return {
    ...project,
    itemDesigns: project.itemDesigns.map((design) =>
      design.kind === 'generic' && design.footprint.kind === 'preset' && design.footprint.preset.kind === 'rectangle'
        ? { ...design, footprint: legacyFootprint(design.footprint.preset.width, design.footprint.preset.depth) }
        : design,
    ),
  }
}

/** An Item Footprint as the pre-v3 files wrote it. */
function legacyFootprint(width: number, depth: number): { kind: 'rectangle'; width: number; depth: number } {
  return { kind: 'rectangle', width, depth }
}

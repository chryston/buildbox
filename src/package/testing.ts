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
    preferences: { displayUnit: 'cm', displayPrecision: 1, defaultWallHeight: 2600 },
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
      walls: [],
      wallJunctions: [],
      openings: [],
      rooms: [],
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
    warningAcknowledgements: [],
  }
}

/**
 * The same Project with one Wall and one door cut into it (#65): the record
 * `fixtures/package/v5/openings.buildbox` was written from. The v4 fixture beside it stays a
 * Project with no Walls at all, which is the whole step in one comparison — this one carries
 * an Opening rather than only the collection that holds it.
 */
export function openingsFixtureProject(): Project {
  const project = fixtureProject()
  return {
    ...project,
    existingModel: {
      ...project.existingModel,
      walls: [
        {
          id: 'wall-1',
          ref: 'W-1',
          floorId: 'floor-0',
          line: { kind: 'line', start: { x: 0, y: 0 }, end: { x: 4000, y: 0 } },
          thickness: 100,
          justification: 'centre',
          baseElevation: 0,
          height: 2600,
        },
      ],
      openings: [
        {
          id: 'opening-1',
          floorId: 'floor-0',
          hostWallId: 'wall-1',
          kind: 'door',
          label: 'Door 1',
          // 1200 along a 4000 mm Wall with no Junctions: the usable interval is the whole
          // reference line, so this is the plainest Opening a fixture can hold.
          start: 1200,
          width: 900,
          sill: 0,
          head: 2100,
          swing: 'left',
          hingeSide: 'start',
        },
      ],
    },
  }
}

/**
 * The same Project as the v6 golden file (#66): a second Wall crossing the first, and one
 * acknowledgement of the warning they make together.
 *
 * The signature is the one this BuildBox computes for that crossing, written down rather
 * than recomputed. A golden file whose contents are derived from the live engine on every run
 * would certify anything the engine started to produce; a literal is what makes the day the
 * signature algorithm changes show up as a reopened warning rather than as silence.
 */
export function acknowledgementsFixtureProject(): Project {
  const project = openingsFixtureProject()
  return {
    ...project,
    existingModel: {
      ...project.existingModel,
      walls: [
        ...project.existingModel.walls,
        {
          id: 'wall-2',
          ref: 'W-2',
          floorId: 'floor-0',
          line: { kind: 'line', start: { x: 2000, y: -500 }, end: { x: 2000, y: 500 } },
          thickness: 100,
          justification: 'centre',
          baseElevation: 0,
          height: 2600,
        },
      ],
    },
    warningAcknowledgements: [
      {
        id: 'acknowledgement-1',
        warningType: 'wall_crossing',
        subjectIds: ['wall-1', 'wall-2'],
        designOptionId: null,
        signature: '8db57272e5b2adb2',
        note: 'A flue passes through here; the crossing is intended.',
        acknowledgedAt: FIXTURE_EXPORTED_AT,
      },
    ],
  }
}

/**
 * The same Project as the v7 golden file (#67): two Rooms on the Floor the Walls stand on,
 * one drawn as a Rectangle and one as a Custom Path, each with one Edge referenced to the
 * face of `W-1` it lies on.
 *
 * The two outlines share no area — they meet the two faces of the same Wall from opposite
 * sides — which is the pair a fixture has to hold: a reference that is true, and the rule
 * that a Room may touch another Room without overlapping it.
 */
export function roomsFixtureProject(): Project {
  const project = acknowledgementsFixtureProject()
  return {
    ...project,
    existingModel: {
      ...project.existingModel,
      rooms: [
        {
          id: 'room-1',
          floorId: 'floor-0',
          name: 'Living',
          outline: {
            kind: 'preset',
            preset: { kind: 'rectangle', width: 4000, depth: 2000 },
            centre: { x: 2000, y: -1050 },
            orientationDeg: 0,
            segmentIds: ['edge-living-1', 'edge-living-2', 'edge-living-3', 'edge-living-4'],
          },
          // Edge 3 is the side along y = −50, which is W-1's left face.
          wallFaceRefs: [{ segmentId: 'edge-living-3', wallId: 'wall-1', side: 'left' }],
        },
        {
          id: 'room-2',
          floorId: 'floor-0',
          name: 'Study',
          outline: {
            kind: 'path',
            path: {
              start: { x: 100, y: 50 },
              segments: [
                { kind: 'line', to: { x: 1900, y: 50 } },
                { kind: 'line', to: { x: 1900, y: 550 } },
                { kind: 'line', to: { x: 100, y: 550 } },
                { kind: 'line', to: { x: 100, y: 50 } },
              ],
            },
            segmentIds: ['edge-study-1', 'edge-study-2', 'edge-study-3', 'edge-study-4'],
          },
          // Edge 1 is the side along y = +50, which is W-1's right face.
          wallFaceRefs: [{ segmentId: 'edge-study-1', wallId: 'wall-1', side: 'right' }],
        },
      ],
    },
  }
}

/**
 * The record the v8 file was written from: the v7 Project plus the container that step added.
 *
 * The Option carries no work of its own. A golden fixture is bytes this build must reproduce exactly
 * and a flag-off build must refuse on purpose, and what v8 adds is the container — `designOptions`,
 * which a Project written before #69 does not have at all — not any particular demolition inside it
 * (#69 §1). The scene with real Options in it is `fixtures/e2e/preview-seed/renovation-36.json`.
 */
export function renovationFixtureProject(): Project {
  const project = roomsFixtureProject()
  return {
    ...project,
    designOptions: [
      {
        id: 'option-1',
        name: 'Open plan',
        proposed: { placedItems: [], walls: [], wallJunctions: [], openings: [], rooms: [] },
        demolishedIds: [],
      },
    ],
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
  const preferences: Record<string, unknown> = { ...project.preferences }
  delete preferences.defaultWallHeight
  const record: Record<string, unknown> = {
    ...project,
    // Both files predate Walls (#64): neither the default height nor the two collections is
    // in the bytes they were written from, so the record stops at the Placed Items.
    preferences,
    existingModel: { placedItems: project.existingModel.placedItems },
    itemDesigns: project.itemDesigns.map((design) =>
      design.kind === 'generic' && design.footprint.kind === 'preset' && design.footprint.preset.kind === 'rectangle'
        ? { ...design, footprint: legacyFootprint(design.footprint.preset.width, design.footprint.preset.depth) }
        : design,
    ),
  }
  // Warning Acknowledgements (#66) postdate both files, so the record carries none — not even
  // an empty list, which a v2 BuildBox had no word for.
  delete record.warningAcknowledgements
  return record
}

/** An Item Footprint as the pre-v3 files wrote it. */
function legacyFootprint(width: number, depth: number): { kind: 'rectangle'; width: number; depth: number } {
  return { kind: 'rectangle', width, depth }
}

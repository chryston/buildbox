/**
 * Test support for the `.buildbox` codec (#44): the Project the golden fixture is built
 * from, and the meta the fixture was written with. Importable from `*.test.ts` only
 * (`eslint.config.js` boundaries), and never from `app`.
 */
import { DEFAULT_DRAWING_LAYERS, NEW_LAYER_COLOR, rectangleFootprint, UNLAYERED_LAYER_KEY } from '../domain'
import type { CabinetNode, DrawingLayer, EntityId, GlobalSettings, PlacedItem, PlanView, Project } from '../domain'

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
      // The record these fixtures were written from is a v2 one: a Plan View of that schema had no
      // range, and the file keeps the bytes it was written from, so the array is the shape it had.
      { id: 'view-0', kind: 'plan', floorId: 'floor-0', name: 'Floor 1', isDefault: true, showPlanImage: true },
      { id: 'view-1', kind: 'plan', floorId: 'floor-1', name: 'Mezzanine', isDefault: true, showPlanImage: true },
    ] as unknown as PlanView[],
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
      beams: [],
      skirting: [],
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
 * The record the v8 file was written from: the v7 Project plus everything the eighth schema added.
 *
 * #73 criterion 14 decides the shape, so that one file is the whole feature in bytes: two Design
 * Options, one of which replaces an Existing Placed Item — it demolishes `place-1` and proposes
 * `place-4` in its place — and one of which only demolishes a Wall; the three default Drawing
 * Layers plus one a person made, with the model's content filed on them the way the step files it;
 * and two saved views, one that says nothing about any layer and one that overrides visibility,
 * editability, colour, the layer order, the Active Layer and snapping to hidden content, and looks
 * at the world through an Option. A golden fixture is bytes this build must reproduce exactly and an
 * older build must refuse on purpose, so every field the bump added appears here and none is empty
 * by accident.
 */
export function renovationFixtureProject(): Project {
  const project = roomsFixtureProject()
  const [structure, services, furniture] = DEFAULT_DRAWING_LAYERS.map((layer, index) => ({
    id: `layer-${String(index + 1)}`,
    name: layer.name,
    color: layer.color,
  }))
  // A layer the user made, holding one Placed Item: proof that a Project's layers are not the three
  // it started with, and that a view can hide a layer the migrator never invented.
  const finishes: DrawingLayer = { id: 'layer-4', name: 'Finishes', color: NEW_LAYER_COLOR }
  const filed = <T extends { id: string }>(entries: readonly T[], layerId: string): T[] =>
    entries.map((entry) => ({ ...entry, drawingLayerId: layerId }))
  const placed = project.existingModel.placedItems.map((item, index) => ({
    ...item,
    drawingLayerId: index === project.existingModel.placedItems.length - 1 ? finishes.id : furniture!.id,
  }))
  const demolished = project.existingModel.placedItems[1]!
  const replacement: PlacedItem = {
    ...demolished,
    id: 'place-4',
    drawingLayerId: furniture!.id,
    // The lineage the Display reads: this item is not new work beside the old one, it is what the
    // old one became, which is the difference between a replace and a demolition (#70 §4).
    predecessorIds: [demolished.id],
    translation: { x: demolished.translation.x + 400, y: demolished.translation.y },
  }
  return {
    ...project,
    drawingLayers: [structure!, services!, furniture!, finishes],
    existingModel: {
      ...project.existingModel,
      placedItems: placed,
      walls: filed(project.existingModel.walls, structure!.id),
      openings: filed(project.existingModel.openings, structure!.id),
      rooms: filed(project.existingModel.rooms, structure!.id),
    },
    designOptions: [
      {
        id: 'option-1',
        name: 'Open plan',
        proposed: { placedItems: [replacement], walls: [], wallJunctions: [], openings: [], rooms: [], beams: [], skirting: [] },
        demolishedIds: [demolished.id],
      },
      {
        id: 'option-2',
        name: 'Store wall',
        proposed: { placedItems: [], walls: [], wallJunctions: [], openings: [], rooms: [], beams: [], skirting: [] },
        demolishedIds: ['wall-2'],
      },
    ],
    views: project.views.map((view): PlanView =>
      view.id === 'view-0'
        ? {
            ...view,
            designOptionId: null,
            renovationDisplay: 'existing' as const,
            layerSettings: {},
            layerOrder: null,
            activeLayerId: structure!.id,
            snapToHiddenContent: false,
          }
        : {
            ...view,
            designOptionId: 'option-1',
            renovationDisplay: 'combined' as const,
            layerSettings: {
              [finishes.id]: { visible: false, selectable: false, editable: false, color: '#3f7fa6' },
              [furniture!.id]: { visible: true, selectable: true, editable: false },
              [UNLAYERED_LAYER_KEY]: { visible: false, selectable: false, editable: false },
            },
            layerOrder: [finishes.id, furniture!.id, services!.id, structure!.id, UNLAYERED_LAYER_KEY],
            activeLayerId: finishes.id,
            snapToHiddenContent: true,
          },
    ),
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

/**
 * The renovation fixture at the ninth schema (#74), with each Plan View's Vertical Range spelled out.
 *
 * The plain view keeps the range its Floor implies — from the Floor structural level up to just
 * below the ceiling — and the Option view has been pulled down to counter height, which is what the
 * field is for: the same world, drawn from a shorter stick. This is the Backup this build writes, so
 * the two ranges are the bytes the round-trip is judged against, and the pair shows that a range
 * belongs to the view and not to the Project.
 */
export function planRangeFixtureProject(): Project {
  const project = renovationFixtureProject()
  const [plain, option] = project.views
  return {
    ...project,
    views: [
      { ...plain!, planViewRange: { lowerMm: 0, upperMm: 2600 } },
      { ...option!, planViewRange: { lowerMm: 900, upperMm: 1200 } },
    ],
  }
}

/**
 * The renovation fixture at the tenth schema (#75), with two Elevation Views on its one Floor.
 *
 * One view line runs due along the room — the ordinary case, a view of the wall the run of base
 * cabinets stands against — and the other is laid at an angle, which is what the record has to be
 * able to hold: a view line is two points and a side, not an axis. Neither carries a saved Design
 * Option, a Renovation Display or a Layer setting, so the bytes also prove that every one of the
 * settings an Elevation View shares with a Plan View stays absent when nobody has set it.
 */
export function elevationFixtureProject(): Project {
  const project = planRangeFixtureProject()
  const floorId = project.views[0]!.floorId
  return {
    ...project,
    elevationViews: [
      {
        id: 'view-elevation-sink' as EntityId,
        kind: 'elevation',
        floorId,
        name: 'Sink elevation',
        line: { start: { x: 600, y: 1400 }, end: { x: 2600, y: 1400 } },
        side: 'left',
        depth: 2000,
      },
      {
        id: 'view-elevation-corner' as EntityId,
        kind: 'elevation',
        floorId,
        name: 'Corner at an angle',
        line: { start: { x: 0, y: 0 }, end: { x: 3200, y: 2400 } },
        side: 'right',
        depth: 1500,
      },
    ],
  }
}

/**
 * The renovation fixture at the eleventh schema (#76), with one Clearance Envelope on the Base
 * Cabinet design: a 600 × 300 mm zone off its front edge, rising the design's own 850 mm from each
 * placement's Base — the shape the zone-off-edge builder draws, spelled out as stored bytes.
 *
 * The envelope belongs to the design, so every placement of the Base Cabinet carries it, and the
 * round-trip of a Project that holds one is judged against these bytes.
 */
export function clearanceFixtureProject(): Project {
  const project = elevationFixtureProject()
  return {
    ...project,
    itemDesigns: project.itemDesigns.map((design) =>
      design.id === ('design-0' as EntityId)
        ? {
            ...design,
            clearanceEnvelope: {
              path: {
                start: { x: 0, y: 560 },
                segments: [
                  { kind: 'line', to: { x: 600, y: 560 } },
                  { kind: 'line', to: { x: 600, y: 860 } },
                  { kind: 'line', to: { x: 0, y: 860 } },
                  { kind: 'line', to: { x: 0, y: 560 } },
                ],
              },
              bottomOffset: 0,
              height: 850,
            },
          }
        : design,
    ),
  }
}

/**
 * The renovation fixture at the twelfth schema (#77), with one Beam: 3 000 mm long across the
 * Kitchen, 200 mm wide on its centre line, 300 mm deep with its Top at the 2600 mm ceiling line, so
 * its Underside sits at 2300 mm — the shape the Beam tool draws, spelled out as stored bytes.
 *
 * The Beam stands on the same Floor as the Cabinets the Clearance Envelope suite measures, so the
 * round-trip of a Project that holds one, and every warning that reads it, are judged against these
 * bytes.
 */
export function beamsFixtureProject(): Project {
  const project = clearanceFixtureProject()
  return {
    ...project,
    existingModel: {
      ...project.existingModel,
      beams: [
        {
          id: 'beam-1' as EntityId,
          floorId: 'floor-0' as EntityId,
          line: { start: { x: 600, y: 2400 }, end: { x: 3600, y: 2400 } },
          justification: 'centre',
          width: 200,
          underside: 2300,
          height: 300,
          label: 'Beam B-1',
        },
      ],
    },
  }
}

/**
 * The renovation fixture at the thirteenth schema (#78), with one Skirting: 100 mm of it runs
 * against the Kitchen wall W-1 from its start to its end, 100 mm tall and 15 mm thick, standing on
 * the Floor Datum — the shape the Skirting tool draws, spelled out as stored bytes.
 *
 * It names the Wall it is drawn against and the side of that Wall it stands off, and it stores no
 * outline: the body, the gaps the door in W-1 leaves in it and the lengths read from it are all
 * worked out from these numbers and the Wall's own tidied face.
 */
export function skirtingFixtureProject(): Project {
  const project = beamsFixtureProject()
  return {
    ...project,
    existingModel: {
      ...project.existingModel,
      skirting: [
        {
          id: 'skirting-1' as EntityId,
          floorId: 'floor-0' as EntityId,
          hostWallId: 'wall-1' as EntityId,
          side: 'left',
          start: 0,
          end: 4000,
          bottom: 0,
          height: 100,
          thickness: 15,
          label: 'Skirting SK-1',
        },
      ],
    },
  }
}

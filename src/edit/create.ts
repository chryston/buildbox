/**
 * The Project "New Project" starts with (#47).
 *
 * It mirrors the legacy `defaultDesign()`: one Floor with the default Plan View that shows
 * it (#56), one cabinet with the legacy default settings and a single void space, placed at
 * the legacy origin. Like every other write it takes its IDs from the caller — here all six
 * at once, in the order below — so a Project created in two tabs is still two different
 * Projects and a replayed one is the same.
 */
import type { DrawingLayer, PlanView, Project } from '../domain'
import { DEFAULT_DRAWING_LAYERS, DEFAULT_WALL_HEIGHT_MM, defaultPlanViewRange } from '../domain'
import { LEGACY_DEFAULT_SETTINGS } from './defaults'
import { spendIds } from './handlers/support'

/** How many pre-allocated IDs a New Project spends: three more once the layers exist (#71 §1). */
export const CREATE_PROJECT_ID_COUNT = 9

export interface CreateProjectArgs {
  /**
   * `[projectId, floorId, viewId, itemDesignId, placedItemId, rootNodeId]`, plus the three starting
   * Drawing Layers: `[structureLayerId, servicesLayerId, furnitureLayerId]`.
   */
  ids: string[]
  /**
   * ISO timestamp read by the caller, for the uniform Intent shape. A v1 Project stores no
   * timestamp of its own — the Asset Repository and the Library own the dates (#20 §5).
   */
  now: string
  name: string
}

/** The default Project, already strictly valid (#42 §5). */
export function createProject({ ids, name }: CreateProjectArgs): Project {
  const [projectId, floorId, viewId, itemDesignId, placedItemId, rootNodeId, ...layerIds] = spendIds(
    ids,
    CREATE_PROJECT_ID_COUNT,
    'createProject',
  )
  const settings = { ...LEGACY_DEFAULT_SETTINGS }
  // The three layers a new Project starts with (#71 §1), back to front, and the one of them new
  // Walls, Openings and Rooms are created on. Flag-off this is nothing at all: no array, no view
  // fields, the same bytes this build has always written.
  const layers: DrawingLayer[] = DEFAULT_DRAWING_LAYERS.map((layer, index) => ({ id: layerIds[index]!, name: layer.name, color: layer.color }))
  const structureId = layers.find((layer) => layer.name === 'Structure')?.id ?? null
  const furnitureId = layers.find((layer) => layer.name === 'Furniture')?.id ?? null
  const view: PlanView = {
    id: viewId,
    kind: 'plan',
    floorId,
    name: 'Floor 1',
    isDefault: true,
    showPlanImage: true,
    // A Floor with no limits of its own, so the whole storey as BuildBox assumes it (#74 behaviour 4).
    planViewRange: defaultPlanViewRange(undefined),
    layerSettings: {},
    layerOrder: null,
    activeLayerId: structureId,
    snapToHiddenContent: false,
  }
  return {
    id: projectId,
    meta: { name },
    preferences: { displayUnit: 'mm', displayPrecision: 0, defaultWallHeight: DEFAULT_WALL_HEIGHT_MM },
    floors: [{ id: floorId, name: 'Floor 1', planImage: null }],
    views: [view],
    ...(layers === null ? {} : { drawingLayers: layers }),
    itemDesigns: [
      {
        id: itemDesignId,
        kind: 'cabinet',
        name: 'Unit 1',
        construction: { settings, root: { id: rootNodeId, elementType: 'void' } },
      },
    ],
    // Legacy `x = 0, y = 0` is the unit's top-left corner on the Floor Datum; the
    // placement records where its Item Origin sits (#43 §3).
    existingModel: {
      placedItems: [
        {
          id: placedItemId,
          itemDesignId,
          floorId,
          translation: { x: settings.width / 2, y: settings.depth / 2 },
          rotationDeg: 0,
          baseElevation: 0,
          // The cabinet the Project comes with is furniture (#71 §1).
          drawingLayerId: furnitureId,
        },
      ],
      // A new Project has no Walls yet; the collections exist so the shape is the same one
      // every later Wall is written into (#64 §1). Openings come with #65 the same way.
      walls: [],
      wallJunctions: [],
      openings: [],
      rooms: [],
    },
    // A new Project has no warnings yet, and so none acknowledged: the collection exists so
    // the shape is the one every later acknowledgement is written into (#66 §5).
    warningAcknowledgements: [],
  }
}

/**
 * The Project "New Project" starts with (#47).
 *
 * It mirrors the legacy `defaultDesign()`: one Floor with the default Plan View that shows
 * it (#56), one cabinet with the legacy default settings and a single void space, placed at
 * the legacy origin. Like every other write it takes its IDs from the caller — here all six
 * at once, in the order below — so a Project created in two tabs is still two different
 * Projects and a replayed one is the same.
 */
import type { Project } from '../domain'
import { DEFAULT_WALL_HEIGHT_MM } from '../domain'
import { LEGACY_DEFAULT_SETTINGS } from './defaults'
import { spendIds } from './handlers/support'

export interface CreateProjectArgs {
  /** `[projectId, floorId, viewId, itemDesignId, placedItemId, rootNodeId]`. */
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
  const [projectId, floorId, viewId, itemDesignId, placedItemId, rootNodeId] = spendIds(ids, 6, 'createProject')
  const settings = { ...LEGACY_DEFAULT_SETTINGS }
  return {
    id: projectId,
    meta: { name },
    preferences: { displayUnit: 'mm', displayPrecision: 0, defaultWallHeight: DEFAULT_WALL_HEIGHT_MM },
    floors: [{ id: floorId, name: 'Floor 1', planImage: null }],
    views: [{ id: viewId, kind: 'plan', floorId, name: 'Floor 1', isDefault: true, showPlanImage: true }],
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
        },
      ],
      // A new Project has no Walls yet; the collections exist so the shape is the same one
      // every later Wall is written into (#64 §1). Openings come with #65 the same way.
      walls: [],
      wallJunctions: [],
      openings: [],
    },
    // A new Project has no warnings yet, and so none acknowledged: the collection exists so
    // the shape is the one every later acknowledgement is written into (#66 §5).
    warningAcknowledgements: [],
  }
}

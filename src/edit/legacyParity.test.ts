/**
 * The Intent catalogue (#47 criterion 4, kept alive by #53).
 *
 * Until the legacy store shipped out, this file ran every action twice — once through the
 * store, once through `applyIntent` — and compared the geometry. The store is gone, so the
 * comparison went with it: there is no second engine left to be at parity with, and a
 * test-local copy of the deleted mutations would be the shim #14 and #20 §1 forbid.
 *
 * What still has teeth is the catalogue itself: the table below is the legacy action list as
 * #47 recorded it, and every Intent it names must exist and carry an undo label. A rename or
 * a dropped Intent breaks here before it breaks the History menu (#66 scans the same labels).
 *
 * Converter fidelity — legacy bytes to Project — is `package/legacy`'s own parity suite and
 * `src/test/legacyMigration.test.ts`, both of which read the committed fixtures directly.
 */
import { describe, expect, it } from 'vitest'
import { INTENT_LABELS } from './index'

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
  updateFloorPlanObject: 'plan.movePlacement',
  removeFloorPlanObject: 'plan.removeObject',
  addCustomTemplate: 'plan.addTemplate',
  removeCustomTemplate: 'plan.removeTemplate',
  setFloorPlanImage: 'plan.setImage',
  setFloorPlanScale: 'plan.calibrate',
  clearFloorPlan: 'plan.clear',
}

/**
 * The legacy actions that became something other than an Intent: Project and selection
 * switching belong to the Library and the UI session, and the annotations had no editor.
 */
const NOT_INTENTS: readonly string[] = [
  'createProject',
  'deleteProject',
  'setActiveProject',
  'setActiveUnit',
  'setSelectedId',
  'setSnapGrid',
  'selectFloorPlanObject',
  'importWorkspace',
  'addAnnotation',
  'removeAnnotation',
  'persist',
]

/**
 * The catalogue rows no single store action names: the template fork, #55's preference
 * write, and the whole Floor and Plan View half of #56 — the legacy app had exactly one
 * Floor and one way of looking at it, so there was no action there to map.
 */
const EXTRA_INTENTS = [
  // #57: placing reuses an Item Design instead of forking it, and the legacy
  // `updateFloorPlanObject` — one action for position, size, turn, name and colour — split
  // into the placement half and the design half the inspector now keeps apart.
  'plan.placeDesign',
  'plan.rotatePlacement',
  'design.update',
  'design.setOrigin',
  'design.fork',
  'project.setPreferences',
  // #64 §16: the default Wall height is set from a dialog field, never by a key.
  'floor.setDefaultWallHeight',
  'plan.removeImage',
  'plan.copyToFloor',
  'plan.moveToFloor',
  'floor.create',
  'floor.rename',
  'floor.reorder',
  'floor.setLimits',
  'floor.delete',
  'floor.duplicate',
  'view.create',
  'view.rename',
  'view.delete',
  'view.setShowPlanImage',
  // #74 §4, §5: the vertical half of the model. The legacy app had no elevation on anything — every
  // Wall stood on the floor at the storey height — so there was no action to move, edit or raise.
  'plan.setPlacementVerticalExtent',
  'wall.setVerticalExtent',
  'opening.setVerticalExtent',
  'view.setPlanViewRange',
  // #58: the Item Design editor restates a footprint wholesale; no legacy action did.
  'design.setFootprint',
  // #64: Walls have no legacy equivalent at all — the old store kept no wall geometry — so the
  // whole family is new rather than a split of an action.
  'wall.createChain',
  'wall.dragJunction',
  'wall.dragEndpoint',
  'wall.dragBody',
  'wall.setLength',
  'wall.setDirection',
  'wall.setArc',
  'wall.setThickness',
  'wall.offset',
  'wall.split',
  'wall.merge',
  'wall.delete',
  // #65: the legacy app had no Openings at all — a door was a gap drawn by hand — so there
  // is no store action any of these maps to.
  'opening.create',
  'opening.setStart',
  'opening.setWidth',
  'opening.flipHinge',
  'opening.flipSwing',
  'opening.rename',
  'opening.delete',
  // #66: the legacy app had no warnings at all — an overlap was something the drafter found
  // by eye on the printed plan — so there is no store action either of these maps to.
  'warning.acknowledge',
  'warning.editNote',
  // #67: the legacy app had no Rooms at all — a room was an empty area between Walls the
  // drafter labelled by hand — so there is no store action any of these maps to.
  'room.create',
  'room.rename',
  'room.setOutline',
  'room.attachFace',
  'room.detachFace',
  'room.placeShelter',
]

describe('action coverage', () => {
  it('names only Intents that exist, each with a label', () => {
    const labels = INTENT_LABELS as Record<string, string>
    for (const type of [...Object.values(ACTION_TO_INTENT), ...EXTRA_INTENTS]) {
      expect(labels[type], `no label for ${type}`).toBeTruthy()
    }
    // The catalogue has no Intent the table does not account for.
    expect(Object.keys(labels).sort()).toEqual(
      [...new Set([...Object.values(ACTION_TO_INTENT), ...EXTRA_INTENTS])].sort(),
    )
  })

  it('accounts for every legacy action as an Intent or as something else', () => {
    const mapped = new Set(Object.keys(ACTION_TO_INTENT))
    const unexplained = NOT_INTENTS.filter((action) => mapped.has(action))
    expect(unexplained, `these are both mapped and listed as not Intents: ${unexplained.join(', ')}`).toEqual([])
    expect(mapped.size + NOT_INTENTS.length).toBeGreaterThan(20)
  })
})

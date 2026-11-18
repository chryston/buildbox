/**
 * The cabinet family (#47 criteria 3–5): every tree edit, every unit edit, and the six
 * rejections the issue names.
 *
 * Each test states the effect it expects in the Project — not in a mock — because the
 * point of #47 is that an Intent is now the only way in: if the Project does not say the
 * space got a shelf, the shelf did not happen.
 */
import { describe, expect, it } from 'vitest'
import type { CabinetNode, Project } from '../../domain'
import { canonicalJson } from '../../lib'
import { applyIntent } from '../apply'
import { INTENT_ID_ORDER } from '../intents'
import {
  basicProject,
  cabinetOf,
  deepFreeze,
  designId,
  expectDeterministic,
  expectRejection,
  expectRoundTrip,
  firstPlacement,
  idSource,
  intent,
  newProject,
  splitProject,
} from '../testing'

/** The node a test wants, by ID, wherever it sits in the first cabinet's tree. */
function nodeOf(project: Project, nodeId: string): CabinetNode {
  const walk = (node: CabinetNode): CabinetNode | null =>
    node.id === nodeId ? node : (node.children ?? []).reduce<CabinetNode | null>((found, child) => found ?? walk(child), null)
  const found = walk(cabinetOf(project).construction.root)
  if (found === null) throw new Error(`no node ${nodeId} in this test Project`)
  return found
}

describe('cabinet.addShelf and cabinet.addDivider', () => {
  it('splits a space and spends exactly the IDs the Intent carries', () => {
    const project = newProject()
    const rootId = cabinetOf(project).construction.root.id
    const ids = idSource('shelf')(2)
    const result = expectRoundTrip(project, intent('cabinet.addShelf', { itemDesignId: designId(project), nodeId: rootId }, ids))

    const root = cabinetOf(result.project).construction.root
    expect(root.splitAxis).toBe('horizontal')
    expect(root.children?.map((child) => child.id)).toEqual(ids)
    expect(root.children?.every((child) => child.elementType === 'void')).toBe(true)
    expect(result.affected).toEqual({
      floorId: firstPlacement(project).floorId,
      viewId: null, view: 'cabinet',
      itemDesignIds: [designId(project)],
      placedItemIds: [firstPlacement(project).id],
    })
    expectDeterministic(project, intent('cabinet.addShelf', { itemDesignId: designId(project), nodeId: rootId }, ids))
  })

  it('splits a space vertically, and splits a child of an existing shelf', () => {
    const { project, childIds } = splitProject()
    const ids = idSource('divider')(2)
    const result = expectRoundTrip(project, intent('cabinet.addDivider', { itemDesignId: designId(project), nodeId: childIds[0]! }, ids))

    const split = nodeOf(result.project, childIds[0]!)
    expect(split.splitAxis).toBe('vertical')
    expect(split.children?.map((child) => child.id)).toEqual(ids)
    // The other space is untouched, byte for byte.
    expect(canonicalJson(nodeOf(result.project, childIds[1]!))).toBe(canonicalJson(nodeOf(project, childIds[1]!)))
  })

  it('refuses to invent IDs it was not given', () => {
    const project = deepFreeze(newProject())
    const rootId = cabinetOf(project).construction.root.id
    expectRejection(project, intent('cabinet.addShelf', { itemDesignId: designId(project), nodeId: rootId }, []), 'missing-ids')
    expectRejection(
      project,
      intent('cabinet.addShelf', { itemDesignId: designId(project), nodeId: rootId }, idSource('short')(1)),
      'missing-ids',
    )
  })

  it('leaves no generated ID behind', () => {
    const project = newProject()
    const rootId = cabinetOf(project).construction.root.id
    const ids = idSource('shelf')(2)
    const result = applyIntent(project, intent('cabinet.addShelf', { itemDesignId: designId(project), nodeId: rootId }, ids))
    if (!result.ok) throw new Error('the shelf was refused')
    // `nanoid(8)` is 21 URL-safe characters; every node ID here is shorter and prefixed.
    const ids2 = JSON.stringify(result.project).match(/"(?:[A-Za-z0-9_-]{21})"/g) ?? []
    expect(ids2).toEqual([])
    expect(JSON.stringify(result.project)).toContain(ids[0]!)
  })

  it('refuses a space that is already split, or does not exist', () => {
    const { project, rootId, childIds } = deepFreeze(splitProject())
    expectRejection(
      project,
      intent('cabinet.addShelf', { itemDesignId: designId(project), nodeId: rootId }, idSource('x')(2)),
      'invalid-tree',
    )
    expectRejection(
      project,
      intent('cabinet.addShelf', { itemDesignId: designId(project), nodeId: 'gone' }, idSource('x')(2)),
      'unknown-target',
    )
    expect(childIds.length).toBe(2)
  })
})

describe('cabinet.deleteBoard', () => {
  it('collapses the split a board belongs to', () => {
    const { project, rootId, childIds } = splitProject()
    const result = expectRoundTrip(project, intent('cabinet.deleteBoard', { itemDesignId: designId(project), nodeId: childIds[0]! }))
    expect(result.project).not.toBe(project)
    expect(nodeOf(result.project, rootId)).toEqual({ id: rootId, elementType: 'void' })
  })

  it('refuses to delete the outer frame, which is what the legacy store did', () => {
    const { project, rootId } = deepFreeze(splitProject())
    expectRejection(project, intent('cabinet.deleteBoard', { itemDesignId: designId(project), nodeId: rootId }), 'no-change')
  })
})

describe('the size and label of one space', () => {
  it('cabinet.setNodeSize pins a size to a space', () => {
    const { project, childIds } = splitProject()
    const result = expectRoundTrip(project, intent('cabinet.setNodeSize', { itemDesignId: designId(project), nodeId: childIds[0]!, sizeMm: 240 }))
    expect(nodeOf(result.project, childIds[0]!).fixedSize).toBe(240)
  })

  it('cabinet.pinNode locks a space at a size', () => {
    const { project, childIds } = splitProject()
    const result = expectRoundTrip(project, intent('cabinet.pinNode', { itemDesignId: designId(project), nodeId: childIds[0]!, sizeMm: 300 }))
    expect(nodeOf(result.project, childIds[0]!).locked).toBe(true)
    expect(nodeOf(result.project, childIds[0]!).fixedSize).toBe(300)
  })

  it('cabinet.setNodeLabel names a space', () => {
    const { project, childIds } = splitProject()
    const result = expectRoundTrip(project, intent('cabinet.setNodeLabel', { itemDesignId: designId(project), nodeId: childIds[1]!, label: 'Bread bin' }))
    expect(nodeOf(result.project, childIds[1]!).spaceLabel).toBe('Bread bin')
  })

  it('cabinet.setSplitRatio moves a divider', () => {
    const { project, rootId } = splitProject()
    const result = expectRoundTrip(project, intent('cabinet.setSplitRatio', { itemDesignId: designId(project), parentNodeId: rootId, ratio: 0.25 }))
    expect(nodeOf(result.project, rootId).splitRatio).toBe(0.25)
  })

  it('cabinet.distributeEvenly evens a column', () => {
    const { project, rootId, childIds } = splitProject()
    const nested = idSource('nest')(2)
    const split = applyIntent(project, intent('cabinet.addShelf', { itemDesignId: designId(project), nodeId: childIds[0]! }, nested))
    if (!split.ok) throw new Error('the nested shelf was refused')
    const pinned = applyIntent(split.project, intent('cabinet.pinNode', { itemDesignId: designId(project), nodeId: rootId, sizeMm: 999 }))
    if (!pinned.ok) throw new Error('the pin was refused')

    const result = expectRoundTrip(pinned.project, intent('cabinet.distributeEvenly', { itemDesignId: designId(project), columnRootId: rootId, evenH: 200 }))
    // Every space in the column is 200 mm tall, so a column of two spaces is 200 + 200 + 18
    // of shelf against the 200 mm space beside it.
    expect(nodeOf(result.project, rootId).splitRatio).toBeCloseTo(418 / 618, 12)
    expect(nodeOf(result.project, childIds[0]!).splitRatio).toBeCloseTo(0.5, 12)
    // Evening a column unlocks it: the pin is gone, and with it the size it carried.
    expect(nodeOf(result.project, rootId).locked).toBe(false)
    expect(nodeOf(result.project, rootId).fixedSize).toBeUndefined()
  })

  it('cabinet.unpinNode unlocks a space that was pinned', () => {
    const { project, childIds } = splitProject()
    const pinned = applyIntent(project, intent('cabinet.pinNode', { itemDesignId: designId(project), nodeId: childIds[0]!, sizeMm: 300 }))
    if (!pinned.ok) throw new Error('the pin was refused')
    const result = expectRoundTrip(pinned.project, intent('cabinet.unpinNode', { itemDesignId: designId(project), nodeId: childIds[0]! }))
    expect(nodeOf(result.project, childIds[0]!).locked).toBe(false)
    expect(nodeOf(result.project, childIds[0]!).fixedSize).toBeUndefined()
  })

  it('cabinet.setNodeLabel clears a label with whitespace, as the legacy store did', () => {
    const { project, childIds } = splitProject()
    const labelled = applyIntent(project, intent('cabinet.setNodeLabel', { itemDesignId: designId(project), nodeId: childIds[0]!, label: 'Spice rack' }))
    if (!labelled.ok) throw new Error('the label was refused')
    const result = expectRoundTrip(labelled.project, intent('cabinet.setNodeLabel', { itemDesignId: designId(project), nodeId: childIds[0]!, label: '   ' }))
    expect(nodeOf(result.project, childIds[0]!).spaceLabel).toBeUndefined()
  })
})

describe('the kind and fittings of one space', () => {
  it('cabinet.setElementType makes a space a drawer, with the legacy default config', () => {
    const { project, childIds } = splitProject()
    const result = expectRoundTrip(project, intent('cabinet.setElementType', { itemDesignId: designId(project), nodeId: childIds[0]!, elementType: 'drawer' }))
    expect(nodeOf(result.project, childIds[0]!).elementType).toBe('drawer')
    expect(nodeOf(result.project, childIds[0]!).drawerConfig).toEqual({ slideType: 'side-mount', reveal: 3 })
  })

  it('cabinet.setDrawerConfig changes the runners of a drawer', () => {
    const { project, childIds } = splitProject()
    const drawer = applyIntent(project, intent('cabinet.setElementType', { itemDesignId: designId(project), nodeId: childIds[1]!, elementType: 'drawer' }))
    if (!drawer.ok) throw new Error('the drawer was refused')
    const result = expectRoundTrip(drawer.project, intent('cabinet.setDrawerConfig', {
      itemDesignId: designId(project),
      nodeId: childIds[1]!,
      config: { slideType: 'undermount', reveal: 5 },
    }))
    expect(nodeOf(result.project, childIds[1]!).drawerConfig).toEqual({ slideType: 'undermount', reveal: 5 })
  })

  it('cabinet.addAccessory and cabinet.removeAccessory spend and free an ID', () => {
    const { project, childIds } = splitProject()
    const accessoryId = idSource('acc')(1)[0]!
    const added = expectRoundTrip(project, intent('cabinet.addAccessory', {
      itemDesignId: designId(project),
      nodeId: childIds[0]!,
      accessory: { type: 'door', label: 'Recessed' },
    }, [accessoryId]))
    expect(nodeOf(added.project, childIds[0]!).accessories).toEqual([{ id: accessoryId, type: 'door', label: 'Recessed' }])

    const removed = expectRoundTrip(added.project, intent('cabinet.removeAccessory', {
      itemDesignId: designId(project),
      nodeId: childIds[0]!,
      accessoryId,
    }))
    // The space is empty again; `cabinet` leaves the empty list, as the legacy store did.
    expect(nodeOf(removed.project, childIds[0]!).accessories ?? []).toEqual([])
  })

  it('refuses to remove an accessory that is not there', () => {
    const { project, childIds } = deepFreeze(splitProject())
    expectRejection(
      project,
      intent('cabinet.removeAccessory', { itemDesignId: designId(project), nodeId: childIds[0]!, accessoryId: 'nope' }),
      'unknown-target',
    )
  })
})

describe('cabinet.updateSettings and cabinet.setMaterial', () => {
  it('resizes the unit and shifts every placement that shares it', () => {
    const applied = expectRoundTrip(basicProject(), intent('cabinet.updateSettings', {
      itemDesignId: 'design-base-cabinet',
      patch: { width: 36 },
    }))
    const project = applied.project
    const shared = project.existingModel.placedItems.filter((placed) => placed.itemDesignId === 'design-base-cabinet')
    expect(shared.length).toBe(2)
    // 24 → 36: each placement's centre moves by half the difference, so the left edge holds.
    expect(shared.map((placed) => placed.translation.x)).toEqual([1206, 2406])
    expect(cabinetOf(project).construction.settings.width).toBe(36)
    expect(project.itemDesigns.length).toBe(4)
    expect(applied.affected).toEqual({
      floorId: 'floor-main',
      viewId: null, view: 'cabinet',
      itemDesignIds: ['design-base-cabinet'],
      placedItemIds: ['place-base-left', 'place-base-right'],
    })
  })

  it('refuses a size the domain will not accept', () => {
    const project = deepFreeze(newProject())
    expectRejection(project, intent('cabinet.updateSettings', { itemDesignId: designId(project), patch: { width: 0 } }), 'invalid-project')
    expectRejection(project, intent('cabinet.updateSettings', { itemDesignId: designId(project), patch: { width: -10 } }), 'invalid-project')
  })

  it('cabinet.setMaterial changes the sheet material', () => {
    const project = newProject()
    const result = expectRoundTrip(project, intent('cabinet.setMaterial', { itemDesignId: designId(project), material: 'walnut' }))
    expect(cabinetOf(result.project).construction.settings.material).toBe('walnut')
    expect(cabinetOf(result.project).construction.settings.width).toBe(600)
  })
})

describe('unit management', () => {
  it('cabinet.addUnit places a new unit right of the rightmost one', () => {
    const project = newProject()
    const [itemDesignId, placedItemId, rootNodeId] = idSource('unit')(3)
    const result = expectRoundTrip(project, intent('cabinet.addUnit', { sourceItemDesignId: null }, [itemDesignId, placedItemId, rootNodeId]))

    const added = result.project.itemDesigns.find((design) => design.id === itemDesignId)
    expect(added).toMatchObject({ kind: 'cabinet', name: 'Unit 2', construction: { root: { id: rootNodeId, elementType: 'void' } } })
    const placed = result.project.existingModel.placedItems.find((candidate) => candidate.id === placedItemId)
    // The only unit stands with its right edge at 600; the new one starts 20 mm later.
    expect(placed).toMatchObject({ itemDesignId, floorId: project.floors[0]!.id, translation: { x: 920, y: 250 }, baseElevation: 0 })
    expect(result.affected).toEqual({
      floorId: project.floors[0]!.id,
      viewId: null, view: 'cabinet',
      itemDesignIds: [itemDesignId],
      placedItemIds: [placedItemId],
    })
    expect(INTENT_ID_ORDER['cabinet.addUnit']).toEqual(['itemDesignId', 'placedItemId', 'rootNodeId'])
  })

  it('cabinet.addUnit copies the settings of the unit it is told to copy', () => {
    const project = newProject()
    const wide = applyIntent(project, intent('cabinet.updateSettings', { itemDesignId: designId(project), patch: { width: 1000 } }))
    if (!wide.ok) throw new Error('the resize was refused')
    const [itemDesignId, placedItemId, rootNodeId] = idSource('unit')(3)
    const result = applyIntent(wide.project, intent('cabinet.addUnit', { sourceItemDesignId: designId(project) }, [itemDesignId, placedItemId, rootNodeId]))
    if (!result.ok) throw new Error('the unit was refused')
    expect(result.project.itemDesigns[1]).toMatchObject({
      id: itemDesignId,
      kind: 'cabinet',
      construction: { settings: { width: 1000, material: 'oak' }, root: { elementType: 'void' } },
    })
    // The copy stands 20 mm right of the 1000 mm unit it was born from.
    expect(result.project.existingModel.placedItems[1]!.translation.x).toBe(1520)
  })

  it('cabinet.renameUnit renames the unit', () => {
    const project = newProject()
    const result = expectRoundTrip(project, intent('cabinet.renameUnit', { itemDesignId: designId(project), name: 'Sink base' }))
    expect(cabinetOf(result.project).name).toBe('Sink base')
  })

  it('cabinet.removeUnit takes the unit and its placements with it', () => {
    const project = newProject()
    const two = applyIntent(project, intent('cabinet.addUnit', { sourceItemDesignId: null }, idSource('unit')(3)))
    if (!two.ok) throw new Error('the second unit was refused')
    const second = two.project.itemDesigns[1]!
    const result = expectRoundTrip(two.project, intent('cabinet.removeUnit', { itemDesignId: second.id }))
    expect(result.project.itemDesigns.map((design) => design.id)).toEqual([designId(project)])
    expect(result.project.existingModel.placedItems.map((placed) => placed.itemDesignId)).toEqual([designId(project)])
  })

  it('refuses to remove the last unit, as the legacy store did', () => {
    const project = deepFreeze(newProject())
    expectRejection(project, intent('cabinet.removeUnit', { itemDesignId: designId(project) }), 'last-unit')
  })
})

describe('the rejections that must never reach the Project', () => {
  it('refuses a split ratio the domain will not hold', () => {
    const { project, rootId } = deepFreeze(splitProject())
    for (const ratio of [0, 1, -0.5, 1.5]) {
      expectRejection(project, intent('cabinet.setSplitRatio', { itemDesignId: designId(project), parentNodeId: rootId, ratio }), 'invalid-project')
    }
  })

  it('refuses an Item Design that is not a cabinet', () => {
    const project = newProject()
    const generic = applyIntent(project, intent('plan.addObject', { floorId: project.floors[0]!.id, catalogKey: 'bed-king' }, idSource('g')(2)))
    if (!generic.ok) throw new Error('the plan object was refused')
    const genericId = generic.project.itemDesigns[1]!.id
    expectRejection(generic.project, intent('cabinet.setNodeLabel', { itemDesignId: genericId, nodeId: 'x', label: 'Hi' }), 'unknown-target')
    expectRejection(generic.project, intent('cabinet.removeUnit', { itemDesignId: genericId }), 'unknown-target')
  })

  it('leaves the input Project untouched when it refuses', () => {
    const project = deepFreeze(newProject())
    const before = canonicalJson(project)
    expectRejection(project, intent('cabinet.removeUnit', { itemDesignId: designId(project) }), 'last-unit')
    expectRejection(project, intent('cabinet.setNodeSize', { itemDesignId: designId(project), nodeId: 'nope', sizeMm: 100 }), 'unknown-target')
    expect(canonicalJson(project)).toBe(before)
  })
})


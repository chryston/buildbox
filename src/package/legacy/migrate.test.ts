// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { migrateLegacyState, upgradeLegacyDesign } from './migrate'

/**
 * The characterisation snapshots (#40 §7): the v0, v1 and v2 fixtures run through the
 * migration with an id generator that always answers the same thing, so the bytes the
 * store would have written are part of the test. They were taken against the `migrate`
 * body in `store.ts` before it moved, and again after; both runs produced these bytes.
 */
const envelope = (version: number): { state: unknown; version: number } =>
  JSON.parse(readFileSync(`fixtures/legacy/v${version}/buildbox-store.json`, 'utf8'))

const migrateFixture = (version: number): string =>
  JSON.stringify(migrateLegacyState(envelope(version).state, version, () => 'unit-fixed-id'))

describe('migrateLegacyState', () => {
  it('turns the v0 fixture into the state the store would have written', () => {
    expect(migrateFixture(0)).toMatchInlineSnapshot(`"{"projects":[{"id":"proj-kitchen-base","name":"Kitchen Base","units":[{"type":"cabinet","id":"unit-fixed-id","label":"Unit 1","settings":{"unit":"mm","height":800,"width":600,"depth":500,"thickness":18,"backThickness":6,"toeKick":{"height":100,"setback":50},"material":"walnut"},"root":{"id":"unit-kitchen-base-root","splitAxis":"horizontal","splitRatio":0.72,"children":[{"id":"unit-kitchen-base-upper","splitAxis":"vertical","splitRatio":0.55,"children":[{"id":"unit-kitchen-base-drawers","elementType":"drawer","drawerConfig":{"slideType":"side-mount","reveal":2},"fixedSize":180,"locked":true,"spaceLabel":"Side-mount drawers","accessories":[{"id":"unit-kitchen-base-acc-front","type":"drawer-front","label":"Drawer front"}]},{"id":"unit-kitchen-base-open","splitAxis":"vertical","splitRatio":0.5,"children":[{"id":"unit-kitchen-base-hanging","elementType":"hanging-space","spaceLabel":"Hanging rail","dividers":[{"id":"unit-kitchen-base-div-1","materialId":"walnut"}]},{"id":"unit-kitchen-base-shelf","elementType":"void","spaceLabel":"Open shelf","material":"walnut","accessories":[{"id":"unit-kitchen-base-acc-door","type":"door","label":"Left door"},{"id":"unit-kitchen-base-acc-pull","type":"pull","label":"Knob"}]}]}]},{"id":"unit-kitchen-base-lower","splitAxis":"horizontal","splitRatio":0.45,"children":[{"id":"unit-kitchen-base-microwave","elementType":"microwave","spaceLabel":"Microwave bay"},{"id":"unit-kitchen-base-undermount","elementType":"drawer","drawerConfig":{"slideType":"undermount","reveal":3},"spaceLabel":"Undermount drawers","dividers":[{"id":"unit-kitchen-base-div-2","materialId":"birch"}]}]}]},"x":0,"y":0}]},{"id":"proj-kitchen-tall","name":"Kitchen Tall","units":[{"type":"cabinet","id":"unit-fixed-id","label":"Unit 1","settings":{"unit":"cm","height":2100,"width":600,"depth":560,"thickness":18,"backThickness":6,"toeKick":{"height":100,"setback":50},"material":"white"},"root":{"id":"unit-kitchen-tall-root","splitAxis":"horizontal","splitRatio":0.72,"children":[{"id":"unit-kitchen-tall-upper","splitAxis":"vertical","splitRatio":0.55,"children":[{"id":"unit-kitchen-tall-drawers","elementType":"drawer","drawerConfig":{"slideType":"side-mount","reveal":2},"fixedSize":180,"locked":true,"spaceLabel":"Side-mount drawers","accessories":[{"id":"unit-kitchen-tall-acc-front","type":"drawer-front","label":"Drawer front"}]},{"id":"unit-kitchen-tall-open","splitAxis":"vertical","splitRatio":0.5,"children":[{"id":"unit-kitchen-tall-hanging","elementType":"hanging-space","spaceLabel":"Hanging rail","dividers":[{"id":"unit-kitchen-tall-div-1","materialId":"walnut"}]},{"id":"unit-kitchen-tall-shelf","elementType":"void","spaceLabel":"Open shelf","material":"walnut","accessories":[{"id":"unit-kitchen-tall-acc-door","type":"door","label":"Left door"},{"id":"unit-kitchen-tall-acc-pull","type":"pull","label":"Knob"}]}]}]},{"id":"unit-kitchen-tall-lower","splitAxis":"horizontal","splitRatio":0.45,"children":[{"id":"unit-kitchen-tall-microwave","elementType":"microwave","spaceLabel":"Microwave bay"},{"id":"unit-kitchen-tall-undermount","elementType":"drawer","drawerConfig":{"slideType":"undermount","reveal":3},"spaceLabel":"Undermount drawers","dividers":[{"id":"unit-kitchen-tall-div-2","materialId":"birch"}]}]}]},"x":0,"y":0}]},{"id":"proj-bath-vanity","name":"Bathroom Vanity","units":[{"type":"cabinet","id":"unit-fixed-id","label":"Unit 1","settings":{"unit":"in","height":34,"width":42,"depth":22,"thickness":18,"backThickness":6,"toeKick":null,"material":"oak"},"root":{"id":"unit-bath-vanity-root","splitAxis":"horizontal","splitRatio":0.72,"children":[{"id":"unit-bath-vanity-upper","splitAxis":"vertical","splitRatio":0.55,"children":[{"id":"unit-bath-vanity-drawers","elementType":"drawer","drawerConfig":{"slideType":"side-mount","reveal":2},"fixedSize":180,"locked":true,"spaceLabel":"Side-mount drawers","accessories":[{"id":"unit-bath-vanity-acc-front","type":"drawer-front","label":"Drawer front"}]},{"id":"unit-bath-vanity-open","splitAxis":"vertical","splitRatio":0.5,"children":[{"id":"unit-bath-vanity-hanging","elementType":"hanging-space","spaceLabel":"Hanging rail","dividers":[{"id":"unit-bath-vanity-div-1","materialId":"walnut"}]},{"id":"unit-bath-vanity-shelf","elementType":"void","spaceLabel":"Open shelf","material":"walnut","accessories":[{"id":"unit-bath-vanity-acc-door","type":"door","label":"Left door"},{"id":"unit-bath-vanity-acc-pull","type":"pull","label":"Knob"}]}]}]},{"id":"unit-bath-vanity-lower","splitAxis":"horizontal","splitRatio":0.45,"children":[{"id":"unit-bath-vanity-microwave","elementType":"microwave","spaceLabel":"Microwave bay"},{"id":"unit-bath-vanity-undermount","elementType":"drawer","drawerConfig":{"slideType":"undermount","reveal":3},"spaceLabel":"Undermount drawers","dividers":[{"id":"unit-bath-vanity-div-2","materialId":"birch"}]}]}]},"x":0,"y":0}]}],"activeProjectId":"proj-kitchen-base","floorPlan":{"image":null,"pixelsPerMm":null,"objects":[],"annotations":[],"customTemplates":[]}}"`)
  })

  it('renames the material field of the v1 fixture', () => {
    expect(migrateFixture(1)).toMatchInlineSnapshot(`"{"projects":[{"id":"proj-kitchen-wall","name":"Kitchen Wall","units":[{"type":"cabinet","id":"unit-kitchen-base","label":"Base Unit","x":0,"y":0,"settings":{"unit":"mm","height":800,"width":600,"depth":500,"thickness":18,"backThickness":6,"toeKick":{"height":100,"setback":50},"material":"walnut"},"root":{"id":"unit-kitchen-base-root","splitAxis":"horizontal","splitRatio":0.72,"children":[{"id":"unit-kitchen-base-upper","splitAxis":"vertical","splitRatio":0.55,"children":[{"id":"unit-kitchen-base-drawers","elementType":"drawer","drawerConfig":{"slideType":"side-mount","reveal":2},"fixedSize":180,"locked":true,"spaceLabel":"Side-mount drawers","accessories":[{"id":"unit-kitchen-base-acc-front","type":"drawer-front","label":"Drawer front"}]},{"id":"unit-kitchen-base-open","splitAxis":"vertical","splitRatio":0.5,"children":[{"id":"unit-kitchen-base-hanging","elementType":"hanging-space","spaceLabel":"Hanging rail","dividers":[{"id":"unit-kitchen-base-div-1","materialId":"walnut"}]},{"id":"unit-kitchen-base-shelf","elementType":"void","spaceLabel":"Open shelf","accessories":[{"id":"unit-kitchen-base-acc-door","type":"door","label":"Left door"},{"id":"unit-kitchen-base-acc-pull","type":"pull","label":"Knob"}]}]}]},{"id":"unit-kitchen-base-lower","splitAxis":"horizontal","splitRatio":0.45,"children":[{"id":"unit-kitchen-base-microwave","elementType":"microwave","spaceLabel":"Microwave bay"},{"id":"unit-kitchen-base-undermount","elementType":"drawer","drawerConfig":{"slideType":"undermount","reveal":3},"spaceLabel":"Undermount drawers","dividers":[{"id":"unit-kitchen-base-div-2","materialId":"birch"}]}]}]}},{"type":"cabinet","id":"unit-kitchen-tall","label":"Tall Unit","x":700,"y":0,"settings":{"unit":"cm","height":2100,"width":600,"depth":560,"thickness":18,"backThickness":6,"toeKick":{"height":100,"setback":50},"material":"white"},"root":{"id":"unit-kitchen-tall-root","splitAxis":"horizontal","splitRatio":0.72,"children":[{"id":"unit-kitchen-tall-upper","splitAxis":"vertical","splitRatio":0.55,"children":[{"id":"unit-kitchen-tall-drawers","elementType":"drawer","drawerConfig":{"slideType":"side-mount","reveal":2},"fixedSize":180,"locked":true,"spaceLabel":"Side-mount drawers","accessories":[{"id":"unit-kitchen-tall-acc-front","type":"drawer-front","label":"Drawer front"}]},{"id":"unit-kitchen-tall-open","splitAxis":"vertical","splitRatio":0.5,"children":[{"id":"unit-kitchen-tall-hanging","elementType":"hanging-space","spaceLabel":"Hanging rail","dividers":[{"id":"unit-kitchen-tall-div-1","materialId":"walnut"}]},{"id":"unit-kitchen-tall-shelf","elementType":"void","spaceLabel":"Open shelf","accessories":[{"id":"unit-kitchen-tall-acc-door","type":"door","label":"Left door"},{"id":"unit-kitchen-tall-acc-pull","type":"pull","label":"Knob"}]}]}]},{"id":"unit-kitchen-tall-lower","splitAxis":"horizontal","splitRatio":0.45,"children":[{"id":"unit-kitchen-tall-microwave","elementType":"microwave","spaceLabel":"Microwave bay"},{"id":"unit-kitchen-tall-undermount","elementType":"drawer","drawerConfig":{"slideType":"undermount","reveal":3},"spaceLabel":"Undermount drawers","dividers":[{"id":"unit-kitchen-tall-div-2","materialId":"birch"}]}]}]}}]},{"id":"proj-bath-vanity","name":"Bathroom Vanity","units":[{"type":"cabinet","id":"unit-bath-vanity","label":"Vanity","x":0,"y":0,"settings":{"unit":"in","height":34,"width":42,"depth":22,"thickness":18,"backThickness":6,"toeKick":null,"material":"oak"},"root":{"id":"unit-bath-vanity-root","splitAxis":"horizontal","splitRatio":0.72,"children":[{"id":"unit-bath-vanity-upper","splitAxis":"vertical","splitRatio":0.55,"children":[{"id":"unit-bath-vanity-drawers","elementType":"drawer","drawerConfig":{"slideType":"side-mount","reveal":2},"fixedSize":180,"locked":true,"spaceLabel":"Side-mount drawers","accessories":[{"id":"unit-bath-vanity-acc-front","type":"drawer-front","label":"Drawer front"}]},{"id":"unit-bath-vanity-open","splitAxis":"vertical","splitRatio":0.5,"children":[{"id":"unit-bath-vanity-hanging","elementType":"hanging-space","spaceLabel":"Hanging rail","dividers":[{"id":"unit-bath-vanity-div-1","materialId":"walnut"}]},{"id":"unit-bath-vanity-shelf","elementType":"void","spaceLabel":"Open shelf","accessories":[{"id":"unit-bath-vanity-acc-door","type":"door","label":"Left door"},{"id":"unit-bath-vanity-acc-pull","type":"pull","label":"Knob"}]}]}]},{"id":"unit-bath-vanity-lower","splitAxis":"horizontal","splitRatio":0.45,"children":[{"id":"unit-bath-vanity-microwave","elementType":"microwave","spaceLabel":"Microwave bay"},{"id":"unit-bath-vanity-undermount","elementType":"drawer","drawerConfig":{"slideType":"undermount","reveal":3},"spaceLabel":"Undermount drawers","dividers":[{"id":"unit-bath-vanity-div-2","materialId":"birch"}]}]}]}}]}],"activeProjectId":"proj-kitchen-wall","floorPlan":{"image":null,"pixelsPerMm":null,"objects":[],"annotations":[],"customTemplates":[]}}"`)
  })

  it('adds the floor plan to the v2 fixture', () => {
    expect(migrateFixture(2)).toMatchInlineSnapshot(`"{"projects":[{"id":"proj-kitchen-wall","name":"Kitchen Wall","units":[{"type":"cabinet","id":"unit-kitchen-base","label":"Base Unit","x":0,"y":0,"settings":{"unit":"mm","height":800,"width":600,"depth":500,"thickness":18,"backThickness":6,"toeKick":{"height":100,"setback":50},"material":"walnut"},"root":{"id":"unit-kitchen-base-root","splitAxis":"horizontal","splitRatio":0.72,"children":[{"id":"unit-kitchen-base-upper","splitAxis":"vertical","splitRatio":0.55,"children":[{"id":"unit-kitchen-base-drawers","elementType":"drawer","drawerConfig":{"slideType":"side-mount","reveal":2},"fixedSize":180,"locked":true,"spaceLabel":"Side-mount drawers","accessories":[{"id":"unit-kitchen-base-acc-front","type":"drawer-front","label":"Drawer front"}]},{"id":"unit-kitchen-base-open","splitAxis":"vertical","splitRatio":0.5,"children":[{"id":"unit-kitchen-base-hanging","elementType":"hanging-space","spaceLabel":"Hanging rail","dividers":[{"id":"unit-kitchen-base-div-1","materialId":"walnut"}]},{"id":"unit-kitchen-base-shelf","elementType":"void","spaceLabel":"Open shelf","accessories":[{"id":"unit-kitchen-base-acc-door","type":"door","label":"Left door"},{"id":"unit-kitchen-base-acc-pull","type":"pull","label":"Knob"}]}]}]},{"id":"unit-kitchen-base-lower","splitAxis":"horizontal","splitRatio":0.45,"children":[{"id":"unit-kitchen-base-microwave","elementType":"microwave","spaceLabel":"Microwave bay"},{"id":"unit-kitchen-base-undermount","elementType":"drawer","drawerConfig":{"slideType":"undermount","reveal":3},"spaceLabel":"Undermount drawers","dividers":[{"id":"unit-kitchen-base-div-2","materialId":"birch"}]}]}]}},{"type":"cabinet","id":"unit-kitchen-tall","label":"Tall Unit","x":700,"y":0,"settings":{"unit":"cm","height":2100,"width":600,"depth":560,"thickness":18,"backThickness":6,"toeKick":{"height":100,"setback":50},"material":"white"},"root":{"id":"unit-kitchen-tall-root","splitAxis":"horizontal","splitRatio":0.72,"children":[{"id":"unit-kitchen-tall-upper","splitAxis":"vertical","splitRatio":0.55,"children":[{"id":"unit-kitchen-tall-drawers","elementType":"drawer","drawerConfig":{"slideType":"side-mount","reveal":2},"fixedSize":180,"locked":true,"spaceLabel":"Side-mount drawers","accessories":[{"id":"unit-kitchen-tall-acc-front","type":"drawer-front","label":"Drawer front"}]},{"id":"unit-kitchen-tall-open","splitAxis":"vertical","splitRatio":0.5,"children":[{"id":"unit-kitchen-tall-hanging","elementType":"hanging-space","spaceLabel":"Hanging rail","dividers":[{"id":"unit-kitchen-tall-div-1","materialId":"walnut"}]},{"id":"unit-kitchen-tall-shelf","elementType":"void","spaceLabel":"Open shelf","accessories":[{"id":"unit-kitchen-tall-acc-door","type":"door","label":"Left door"},{"id":"unit-kitchen-tall-acc-pull","type":"pull","label":"Knob"}]}]}]},{"id":"unit-kitchen-tall-lower","splitAxis":"horizontal","splitRatio":0.45,"children":[{"id":"unit-kitchen-tall-microwave","elementType":"microwave","spaceLabel":"Microwave bay"},{"id":"unit-kitchen-tall-undermount","elementType":"drawer","drawerConfig":{"slideType":"undermount","reveal":3},"spaceLabel":"Undermount drawers","dividers":[{"id":"unit-kitchen-tall-div-2","materialId":"birch"}]}]}]}}]},{"id":"proj-bath-vanity","name":"Bathroom Vanity","units":[{"type":"cabinet","id":"unit-bath-vanity","label":"Vanity","x":0,"y":0,"settings":{"unit":"in","height":34,"width":42,"depth":22,"thickness":18,"backThickness":6,"toeKick":null,"material":"oak"},"root":{"id":"unit-bath-vanity-root","splitAxis":"horizontal","splitRatio":0.72,"children":[{"id":"unit-bath-vanity-upper","splitAxis":"vertical","splitRatio":0.55,"children":[{"id":"unit-bath-vanity-drawers","elementType":"drawer","drawerConfig":{"slideType":"side-mount","reveal":2},"fixedSize":180,"locked":true,"spaceLabel":"Side-mount drawers","accessories":[{"id":"unit-bath-vanity-acc-front","type":"drawer-front","label":"Drawer front"}]},{"id":"unit-bath-vanity-open","splitAxis":"vertical","splitRatio":0.5,"children":[{"id":"unit-bath-vanity-hanging","elementType":"hanging-space","spaceLabel":"Hanging rail","dividers":[{"id":"unit-bath-vanity-div-1","materialId":"walnut"}]},{"id":"unit-bath-vanity-shelf","elementType":"void","spaceLabel":"Open shelf","accessories":[{"id":"unit-bath-vanity-acc-door","type":"door","label":"Left door"},{"id":"unit-bath-vanity-acc-pull","type":"pull","label":"Knob"}]}]}]},{"id":"unit-bath-vanity-lower","splitAxis":"horizontal","splitRatio":0.45,"children":[{"id":"unit-bath-vanity-microwave","elementType":"microwave","spaceLabel":"Microwave bay"},{"id":"unit-bath-vanity-undermount","elementType":"drawer","drawerConfig":{"slideType":"undermount","reveal":3},"spaceLabel":"Undermount drawers","dividers":[{"id":"unit-bath-vanity-div-2","materialId":"birch"}]}]}]}}]}],"activeProjectId":"proj-kitchen-wall","floorPlan":{"image":null,"pixelsPerMm":null,"objects":[],"annotations":[],"customTemplates":[]}}"`)
  })

  it('leaves a v3 state as it found it', () => {
    const { state } = envelope(3)
    expect(migrateLegacyState(state, 3, () => 'unit-fixed-id')).toEqual(state)
  })

  it('never changes the value it was handed', () => {
    for (const version of [0, 1, 2, 3]) {
      const { state } = envelope(version)
      const before = JSON.stringify(state)
      migrateLegacyState(state, version, () => 'unit-fixed-id')
      expect(JSON.stringify(state)).toBe(before)
    }
  })

  it('gives the same bytes twice for the same ids', () => {
    expect(migrateFixture(0)).toBe(migrateFixture(0))
  })

  it('keeps only the project fields the v0 upgrade knows, as the store did', () => {
    const migrated = migrateLegacyState({
      projects: [{ id: 'p1', name: 'A', root: { id: 'r', fixedSize: 100 }, globalSettings: { unit: 'mm' }, sketch: 'gone' }],
      activeProjectId: 'p1',
      lastUsedTool: 'gone-too',
    }, 0, () => 'unit-fixed-id') as Record<string, unknown>
    expect(Object.keys(migrated)).toEqual(['projects', 'activeProjectId', 'floorPlan'])
    expect(Object.keys(migrated.projects as unknown[])).toHaveLength(1)
    expect(migrated.projects).toEqual([{
      id: 'p1',
      name: 'A',
      units: [{
        type: 'cabinet',
        id: 'unit-fixed-id',
        label: 'Unit 1',
        settings: { unit: 'mm' },
        root: { id: 'r', fixedSize: 100 },
        x: 0,
        y: 0,
      }],
    }])
  })

  it('back-fills a floor plan that has no saved shapes', () => {
    const migrated = migrateLegacyState({
      projects: [],
      activeProjectId: null,
      floorPlan: { image: null, pixelsPerMm: null, objects: [], annotations: [] },
    }, 2, () => 'x') as { floorPlan: Record<string, unknown> }
    expect(migrated.floorPlan.customTemplates).toEqual([])
  })

  it('replaces a floor plan shape that is there but null', () => {
    const migrated = migrateLegacyState({
      projects: [],
      floorPlan: { image: null, pixelsPerMm: null, objects: [], annotations: [], customTemplates: null },
    }, 2, () => 'x') as { floorPlan: Record<string, unknown> }
    expect(migrated.floorPlan.customTemplates).toEqual([])
  })

  it('adds nothing to a state that already has a floor plan', () => {
    const migrated = migrateLegacyState({
      projects: [],
      floorPlan: { image: null, pixelsPerMm: null, objects: [], annotations: [], customTemplates: [] },
    }, 3, () => 'x') as Record<string, unknown>
    expect(Object.keys(migrated)).toEqual(['projects', 'floorPlan'])
  })

  it('survives a value no version of the app could have written', () => {
    const garbage: unknown[] = [
      null,
      undefined,
      'state',
      42,
      [],
      { projects: 'nope' },
      { projects: [null, 7] },
      { projects: [{ units: 'nope' }] },
      { projects: [{ units: [{ settings: 'nope' }] }] },
      { projects: [{ units: [{ settings: null }] }] },
      { floorPlan: 'nope' },
      { floorPlan: null },
      { floorPlan: 'nope', customTemplates: 1 },
    ]
    for (const version of [0, 1, 2, 3]) {
      for (const value of garbage) {
        expect(() => migrateLegacyState(value, version, () => 'x')).not.toThrow()
      }
    }
  })

  it('hands back a value that is not an object at all', () => {
    expect(migrateLegacyState(null, 0, () => 'x')).toBe(null)
    expect(migrateLegacyState('state', 3, () => 'x')).toBe('state')
  })
})

describe('upgradeLegacyDesign', () => {
  const root = { id: 'r', fixedSize: 100 }
  const globalSettings = { unit: 'mm', height: 720, width: 600, depth: 560, thickness: 18, backThickness: 12, toeKick: null, defaultMaterial: 'oak' }

  it('wraps a v0 design in the one unit the import used to build', () => {
    expect(upgradeLegacyDesign({ id: 'p1', name: 'A', root, globalSettings }, () => 'unit-fixed-id'))
      .toMatchInlineSnapshot(`
        {
          "globalSettings": {
            "backThickness": 12,
            "defaultMaterial": "oak",
            "depth": 560,
            "height": 720,
            "thickness": 18,
            "toeKick": null,
            "unit": "mm",
            "width": 600,
          },
          "id": "p1",
          "name": "A",
          "root": {
            "fixedSize": 100,
            "id": "r",
          },
          "units": [
            {
              "id": "unit-fixed-id",
              "label": "Unit 1",
              "root": {
                "fixedSize": 100,
                "id": "r",
              },
              "settings": {
                "backThickness": 12,
                "depth": 560,
                "height": 720,
                "material": "oak",
                "thickness": 18,
                "toeKick": null,
                "unit": "mm",
                "width": 600,
              },
              "type": "cabinet",
              "x": 0,
              "y": 0,
            },
          ],
        }
      `)
  })

  it('renames the pre-v2 material key so the canvas can read it', () => {
    // The exact shape, `defaultMaterial` included, is pinned in read.test.ts.
    expect(upgradeLegacyDesign({ id: 'p1', name: 'A', root, globalSettings }, () => 'u1'))
      .toMatchObject({ units: [{ settings: { material: 'oak' } }] })
  })

  it('leaves a design that already has units alone', () => {
    const design = { id: 'p1', name: 'A', units: [], root, globalSettings }
    expect(upgradeLegacyDesign(design, () => 'x')).toBe(design)
  })

  it('leaves a design with no root or no settings alone, and says nothing about it', () => {
    const noRoot = { id: 'p1', name: 'A', globalSettings }
    const noSettings = { id: 'p1', name: 'A', root }
    expect(upgradeLegacyDesign(noRoot, () => 'x')).toBe(noRoot)
    expect(upgradeLegacyDesign(noSettings, () => 'x')).toBe(noSettings)
  })

  it('leaves a value that is not an object alone', () => {
    expect(upgradeLegacyDesign(null, () => 'x')).toBe(null)
    expect(upgradeLegacyDesign('design', () => 'x')).toBe('design')
  })

  it('never changes the design it was handed', () => {
    const design = { id: 'p1', name: 'A', root, globalSettings }
    const before = JSON.stringify(design)
    upgradeLegacyDesign(design, () => 'unit-fixed-id')
    expect(JSON.stringify(design)).toBe(before)
  })

  it('leaves the design\'s own globalSettings alone and renames only the unit copy', () => {
    const upgraded = upgradeLegacyDesign({ id: 'p1', name: 'A', root, globalSettings }, () => 'unit-fixed-id') as {
      globalSettings: Record<string, unknown>
      units: Array<{ settings: Record<string, unknown> }>
    }
    expect(upgraded.globalSettings).toBe(globalSettings)
    expect(Object.keys(upgraded.units[0].settings).sort())
      .toEqual(['backThickness', 'depth', 'height', 'material', 'thickness', 'toeKick', 'unit', 'width'])
    expect(upgraded.units[0].settings.material).toBe('oak')
  })
})

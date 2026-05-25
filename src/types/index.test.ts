import type { CabinetUnit, CabinetSceneUnit, Design, SceneLayout, UnitLayoutResult, UIState, CutListEntry } from './index'

it('CabinetUnit has id, label, type, settings, root, x, y', () => {
  const unit: CabinetSceneUnit = {
    type: 'cabinet',
    id: 'u1',
    label: 'Base',
    settings: { unit: 'mm', height: 800, width: 600, depth: 500, thickness: 18, backThickness: 6, toeKick: null, defaultMaterial: 'oak' },
    root: { id: 'r1', elementType: 'void' },
    x: 0,
    y: 0,
  }
  expect(unit.type).toBe('cabinet')
})

it('Design has units array and no root/globalSettings', () => {
  const d: Design = { id: 'd1', name: 'Test', units: [] }
  expect(d.units).toEqual([])
})

it('UIState has activeUnitId', () => {
  const ui: UIState = { selectedId: null, snapGrid: 5, activeUnitId: null }
  expect(ui.activeUnitId).toBeNull()
})

it('CutListEntry has unitId and unitLabel', () => {
  const e: CutListEntry = {
    label: 'Side panel', qty: 2, width: 800, height: 500, depth: 18,
    material: 'oak', unitId: 'u1', unitLabel: 'Base Left',
  }
  expect(e.unitLabel).toBe('Base Left')
})

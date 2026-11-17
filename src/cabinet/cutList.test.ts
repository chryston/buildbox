import { describe, it, expect } from 'vitest'
import { computeCutListForUnits } from './cutList'
import type { CabinetSceneUnit } from './types'

function bareUnit(): CabinetSceneUnit {
  return {
    type: 'cabinet', id: 'u1', label: 'Base', x: 0, y: 0,
    settings: {
      unit: 'mm', height: 800, width: 600, depth: 500,
      thickness: 18, backThickness: 6, toeKick: null, material: 'oak',
    },
    root: { id: 'root' },
  }
}

describe('computeCutListForUnits – bare cabinet', () => {
  it('produces 2 side panels, 1 top, 1 bottom', () => {
    const entries = computeCutListForUnits([bareUnit()])
    const labels = entries.map(e => e.label)
    expect(labels).toContain('Top panel')
    expect(labels).toContain('Bottom panel')
    const sides = entries.filter(e => e.label === 'Side panel')
    expect(sides[0].qty).toBe(2)
  })

  it('side panels are height  depth', () => {
    const entries = computeCutListForUnits([bareUnit()])
    const side = entries.find(e => e.label === 'Side panel')!
    expect(side.width).toBe(800)
    expect(side.height).toBe(500)
    expect(side.depth).toBe(18)
  })

  it('top/bottom panels are (width - 2×thickness) × depth', () => {
    const entries = computeCutListForUnits([bareUnit()])
    const top = entries.find(e => e.label === 'Top panel')!
    expect(top.width).toBe(564)
    expect(top.height).toBe(500)
  })
})

describe('computeCutListForUnits – with shelf', () => {
  it('adds 1 shelf entry', () => {
    const unit = bareUnit()
    unit.root = {
      id: 'root',
      splitAxis: 'horizontal',
      children: [{ id: 'a' }, { id: 'b' }],
    }
    const entries = computeCutListForUnits([unit])
    const shelves = entries.filter(e => e.label === 'Shelf')
    expect(shelves[0].qty).toBe(1)
    expect(shelves[0].width).toBe(564)
  })
})

describe('computeCutListForUnits – with toe-kick', () => {
  it('adds toe-kick board to cut list', () => {
    const unit = bareUnit()
    unit.settings.toeKick = { height: 100, setback: 20 }
    const entries = computeCutListForUnits([unit])
    const tk = entries.find(e => e.label === 'Toe-kick board')
    expect(tk).toBeDefined()
    expect(tk!.width).toBe(600 - 2 * 20)
    expect(tk!.height).toBe(100)
  })
})

describe('computeCutListForUnits – with back panel', () => {
  it('includes a back panel entry', () => {
    const entries = computeCutListForUnits([bareUnit()])
    const back = entries.find(e => e.label === 'Back panel')
    expect(back).toBeDefined()
    expect(back!.width).toBe(600 - 2 * 18)
    expect(back!.height).toBe(800 - 2 * 18)
  })
})

describe('computeCutListForUnits – mixed-height vertical dividers', () => {
  it('produces separate entries for dividers of different heights', () => {
    const unit = bareUnit()
    unit.root = {
      id: 'root',
      splitAxis: 'horizontal',
      splitRatio: 0.5,
      children: [
        {
          id: 'top',
          splitAxis: 'vertical',
          children: [{ id: 'tl' }, { id: 'tr' }],
        },
        {
          id: 'bot',
          splitAxis: 'vertical',
          children: [{ id: 'bl' }, { id: 'br' }],
        },
      ],
    }
    const entries = computeCutListForUnits([unit])
    const dividers = entries.filter(e => e.label === 'Divider')
    const totalQty = dividers.reduce((sum, entry) => sum + entry.qty, 0)
    expect(totalQty).toBe(2)
  })

  it('produces two entries for dividers at different spans', () => {
    const unit = bareUnit()
    unit.root = {
      id: 'root',
      splitAxis: 'horizontal',
      splitRatio: 0.5,
      children: [
        {
          id: 'top',
          splitAxis: 'vertical',
          dividers: [{ id: 'd1', materialId: 'oak' }],
          children: [{ id: 'tl' }, { id: 'tr' }],
        },
        {
          id: 'bot',
          splitAxis: 'vertical',
          dividers: [{ id: 'd2', materialId: 'walnut' }],
          children: [{ id: 'bl' }, { id: 'br' }],
        },
      ],
    }
    const entries = computeCutListForUnits([unit])
    const dividers = entries.filter(e => e.label === 'Divider')
    expect(dividers.length).toBe(2)
  })
})

describe('computeCutListForUnits – drawer box', () => {
  it('adds drawer box dimensions for side-mount drawer', () => {
    const unit = bareUnit()
    unit.root = {
      id: 'root',
      elementType: 'drawer',
      drawerConfig: { slideType: 'side-mount', reveal: 3 },
    }
    const entries = computeCutListForUnits([unit])
    const drawerBox = entries.find(e => e.label === 'Drawer box (side-mount)')
    expect(drawerBox).toBeDefined()
  })
})

describe('computeCutListForUnits – accessories', () => {
  it('adds door and drawer front entries from void accessories', () => {
    const unit = bareUnit()
    unit.root = {
      id: 'root',
      splitAxis: 'vertical',
      children: [
        { id: 'left', accessories: [{ id: 'a1', type: 'door' }] },
        { id: 'right', accessories: [{ id: 'a2', type: 'drawer-front' }] },
      ],
    }

    const entries = computeCutListForUnits([unit])

    expect(entries.find(e => e.label === 'Door panel')?.qty).toBe(1)
    expect(entries.find(e => e.label === 'Drawer front')?.qty).toBe(1)
  })
})

describe('computeCutListForUnits – door accessories', () => {
  it('produces separate entries for doors of different heights', () => {
    const unit = bareUnit()
    unit.root = {
      id: 'root',
      splitAxis: 'horizontal',
      splitRatio: 0.4,
      children: [
        { id: 'top', accessories: [{ id: 'a1', type: 'door' }] },
        { id: 'bot', accessories: [{ id: 'a2', type: 'door' }] },
      ],
    }

    const entries = computeCutListForUnits([unit])
    const doors = entries.filter(e => e.label === 'Door panel')
    expect(doors.length).toBe(2)
    const totalQty = doors.reduce((sum, entry) => sum + entry.qty, 0)
    expect(totalQty).toBe(2)
  })
})

function makeUnit(id: string, label: string, widthOverride?: number): CabinetSceneUnit {
  return {
    type: 'cabinet', id, label, x: 0, y: 0,
    settings: {
      unit: 'mm', height: 800, width: widthOverride ?? 600, depth: 500,
      thickness: 18, backThickness: 6, toeKick: null, material: 'oak',
    },
    root: { id: `${id}-root`, elementType: 'void' },
  }
}

describe('computeCutListForUnits', () => {
  it('tags every entry with unitId and unitLabel', () => {
    const unit = makeUnit('u1', 'Base Left')
    const entries = computeCutListForUnits([unit])
    expect(entries.every(e => e.unitId === 'u1')).toBe(true)
    expect(entries.every(e => e.unitLabel === 'Base Left')).toBe(true)
  })

  it('two units produce entries for each unit', () => {
    const u1 = makeUnit('u1', 'Left', 600)
    const u2 = makeUnit('u2', 'Right', 900)
    const entries = computeCutListForUnits([u1, u2])
    const u1Entries = entries.filter(e => e.unitId === 'u1')
    const u2Entries = entries.filter(e => e.unitId === 'u2')
    expect(u1Entries.length).toBeGreaterThan(0)
    expect(u2Entries.length).toBeGreaterThan(0)
    expect(u1Entries.find(e => e.label === 'Side panel')!.unitId).toBe('u1')
    expect(u2Entries.find(e => e.label === 'Side panel')!.unitId).toBe('u2')
  })

  it('identical cabinets still produce separate entries with distinct unitIds', () => {
    const u1 = makeUnit('u1', 'A', 600)
    const u2 = makeUnit('u2', 'B', 600)
    const entries = computeCutListForUnits([u1, u2])
    expect(new Set(entries.map(e => e.unitId)).size).toBe(2)
  })
})

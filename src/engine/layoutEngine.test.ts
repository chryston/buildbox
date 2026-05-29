import { describe, it, expect } from 'vitest'
import { computeLayout, computeSceneLayout } from './layoutEngine'
import type { CabinetSceneUnit, Design, CabinetNode, GlobalSettings } from '../types'

function makeDesign(root: CabinetNode, settingsOverride?: Partial<GlobalSettings>): Design {
  const unitId = 'u1'
  return {
    id: 'd1', name: 'Test',
    units: [{
      type: 'cabinet', id: unitId, label: 'Unit 1', x: 0, y: 0,
      settings: { unit: 'mm', height: 800, width: 600, depth: 500, thickness: 18, backThickness: 6, toeKick: null, material: 'oak', ...settingsOverride },
      root,
    }],
  }
}

function makeUnit(id: string, label: string, x: number, overrides: Partial<GlobalSettings> = {}): CabinetSceneUnit {
  return {
    type: 'cabinet',
    id,
    label,
    x,
    y: 0,
    settings: {
      unit: 'mm', height: 800, width: 600, depth: 500,
      thickness: 18, backThickness: 6, toeKick: null, material: 'oak',
      ...overrides,
    },
    root: { id: `${id}-root`, elementType: 'void' },
  }
}

describe('computeLayout – bare cabinet (no splits)', () => {
  it('produces 4 outer panels', () => {
    const result = computeLayout(makeDesign({ id: 'root' }))
    const roles = result.panels.map(p => p.role)
    expect(roles).toContain('top')
    expect(roles).toContain('bottom')
    expect(roles).toContain('left')
    expect(roles).toContain('right')
  })

  it('produces 1 void spanning inner dimensions', () => {
    const result = computeLayout(makeDesign({ id: 'root' }))
    expect(result.voids).toHaveLength(1)
    const v = result.voids[0]
    expect(v.w).toBe(564)
    expect(v.h).toBe(764)
  })
})

describe('computeLayout – one shelf', () => {
  const root: CabinetNode = {
    id: 'root',
    splitAxis: 'horizontal',
    children: [
      { id: 'top-void' },
      { id: 'bot-void' },
    ],
  }

  it('produces 2 voids of equal height after accounting for shelf thickness', () => {
    const result = computeLayout(makeDesign(root))
    expect(result.voids).toHaveLength(2)
    result.voids.forEach(v => expect(v.h).toBe(373))
  })

  it('produces 1 shelf divider', () => {
    const result = computeLayout(makeDesign(root))
    const shelves = result.dividers.filter(d => d.axis === 'horizontal')
    expect(shelves).toHaveLength(1)
    expect(shelves[0].h).toBe(18)
  })

  it('tracks the split parent id on the divider', () => {
    const result = computeLayout(makeDesign(root))
    const shelves = result.dividers.filter(d => d.axis === 'horizontal')
    expect(shelves[0]).toMatchObject({ parentId: 'root' })
  })
})

describe('computeLayout – locked void', () => {
  const root: CabinetNode = {
    id: 'root',
    splitAxis: 'horizontal',
    children: [
      { id: 'top-void', fixedSize: 200, locked: true },
      { id: 'bot-void' },
    ],
  }

  it('top void gets exactly 200mm, bottom absorbs the rest', () => {
    const result = computeLayout(makeDesign(root))
    const top = result.voids.find(v => v.nodeId === 'top-void')!
    const bot = result.voids.find(v => v.nodeId === 'bot-void')!
    expect(top.h).toBe(200)
    expect(bot.h).toBe(546)
  })
})

describe('computeLayout – over-constrained', () => {
  const root: CabinetNode = {
    id: 'root',
    splitAxis: 'horizontal',
    children: [
      { id: 'a', fixedSize: 500, locked: true },
      { id: 'b', fixedSize: 400, locked: true },
    ],
  }

  it('marks both nodes as overConstrained when sizes exceed available space', () => {
    const result = computeLayout(makeDesign(root))
    expect(result.overConstrainedIds).toContain('a')
    expect(result.overConstrainedIds).toContain('b')
  })
})

describe('computeLayout – both locked, both fit', () => {
  const root: CabinetNode = {
    id: 'root',
    splitAxis: 'horizontal',
    children: [
      { id: 'a', fixedSize: 300, locked: true },
      { id: 'b', fixedSize: 400, locked: true },
    ],
  }

  it('each void gets its exact fixedSize when combined sizes fit', () => {
    const result = computeLayout(makeDesign(root))
    const a = result.voids.find(v => v.nodeId === 'a')!
    const b = result.voids.find(v => v.nodeId === 'b')!
    expect(a.h).toBe(300)
    expect(b.h).toBe(400)
    expect(result.overConstrainedIds).toHaveLength(0)
  })
})

describe('computeLayout – toe-kick', () => {
  it('subtracts toe-kick height from inner height and adds toe-kick panel', () => {
    const design = makeDesign({ id: 'root' }, { toeKick: { height: 100, setback: 20 } })
    const result = computeLayout(design)
    const tk = result.panels.find(p => p.role === 'toe-kick-board')
    expect(tk).toBeDefined()
    expect(tk!.h).toBe(100)
    expect(result.voids[0].h).toBe(664)
  })
})

describe('computeSceneLayout', () => {
  it('single unit produces one UnitLayoutResult with kind cabinet', () => {
    const unit = makeUnit('u1', 'Base', 0)
    const scene = computeSceneLayout([unit], 'u1')
    expect(scene.units).toHaveLength(1)
    expect(scene.units[0].kind).toBe('cabinet')
    expect(scene.units[0].unitId).toBe('u1')
    expect(scene.units[0].isActive).toBe(true)
  })

  it('two units both appear in SceneLayout', () => {
    const u1 = makeUnit('u1', 'Base Left', 0)
    const u2 = makeUnit('u2', 'Base Right', 700)
    const scene = computeSceneLayout([u1, u2], 'u1')
    expect(scene.units).toHaveLength(2)
    expect(scene.units[1].x).toBe(700)
    expect(scene.units[1].isActive).toBe(false)
  })

  it('bounding box encompasses both units', () => {
    const u1 = makeUnit('u1', 'L', 0, { width: 600, height: 800 })
    const u2 = makeUnit('u2', 'R', 700, { width: 500, height: 900 })
    const scene = computeSceneLayout([u1, u2], null)
    expect(scene.boundingBox.x).toBe(0)
    expect(scene.boundingBox.y).toBe(0)
    expect(scene.boundingBox.w).toBe(1200)   // 700 + 500
    expect(scene.boundingBox.h).toBe(900)    // max height
  })

  it('UnitLayoutResult.panels are in unit-local coordinates', () => {
    const unit = makeUnit('u1', 'Base', 50)  // offset x=50
    const scene = computeSceneLayout([unit], 'u1')
    const result = scene.units[0]
    // left panel should start at x=0 in unit-local coords (not 50)
    const leftPanel = result.panels.find(p => p.role === 'left')!
    expect(leftPanel.x).toBe(0)
  })
})

import { computeUnitLayout } from './layoutEngine'

function makeSettings(overrides: Partial<GlobalSettings> = {}): GlobalSettings {
  return { unit: 'mm', height: 800, width: 600, depth: 500, thickness: 18, backThickness: 6, toeKick: null, material: 'oak', ...overrides }
}

describe('LayoutVoid control node IDs', () => {
  it('root void has no control node IDs', () => {
    const settings = makeSettings()
    const root: CabinetNode = { id: 'root', elementType: 'void' }
    const layout = computeUnitLayout(settings, root)
    const v = layout.voids[0]
    expect(v.heightControlNodeId).toBeUndefined()
    expect(v.widthControlNodeId).toBeUndefined()
    expect(v.columnRootId).toBeUndefined()
  })

  it('direct child of h-split has heightControlNodeId=self and columnRootId=parent', () => {
    const settings = makeSettings()
    const root: CabinetNode = {
      id: 'root', splitAxis: 'horizontal', splitRatio: 0.5,
      children: [{ id: 'a', elementType: 'void' }, { id: 'b', elementType: 'void' }],
    }
    const layout = computeUnitLayout(settings, root)
    const va = layout.voids.find(v => v.nodeId === 'a')!
    expect(va.heightControlNodeId).toBe('a')
    expect(va.columnRootId).toBe('root')
    expect(va.widthControlNodeId).toBeUndefined()
  })

  it('grandchild through v-split: heightControlNodeId=v-split child, columnRootId=undefined', () => {
    const settings = makeSettings()
    const root: CabinetNode = {
      id: 'root', splitAxis: 'horizontal', splitRatio: 0.5,
      children: [
        { id: 'a', elementType: 'void' },
        { id: 'b', splitAxis: 'vertical', splitRatio: 0.5,
          children: [{ id: 'c', elementType: 'void' }, { id: 'd', elementType: 'void' }] }
      ]
    }
    const layout = computeUnitLayout(settings, root)
    const vc = layout.voids.find(v => v.nodeId === 'c')!
    expect(vc.heightControlNodeId).toBe('b')
    expect(vc.columnRootId).toBeUndefined()
    expect(vc.widthControlNodeId).toBe('c')
  })

  it('nested h-split: columnRootId stays the outermost h-split in the v-scope', () => {
    const settings = makeSettings()
    const root: CabinetNode = {
      id: 'root', splitAxis: 'horizontal', splitRatio: 0.5,
      children: [
        { id: 'a', elementType: 'void' },
        { id: 'b', splitAxis: 'horizontal', splitRatio: 0.5,
          children: [{ id: 'c', elementType: 'void' }, { id: 'd', elementType: 'void' }] }
      ]
    }
    const layout = computeUnitLayout(settings, root)
    expect(layout.voids.find(v => v.nodeId === 'a')?.columnRootId).toBe('root')
    expect(layout.voids.find(v => v.nodeId === 'c')?.columnRootId).toBe('root')
    expect(layout.voids.find(v => v.nodeId === 'd')?.columnRootId).toBe('root')
  })

  it('spaceLabel forwarded from CabinetNode', () => {
    const settings = makeSettings()
    const root: CabinetNode = { id: 'root', elementType: 'void', spaceLabel: 'Books' }
    const layout = computeUnitLayout(settings, root)
    expect(layout.voids[0].spaceLabel).toBe('Books')
  })
})

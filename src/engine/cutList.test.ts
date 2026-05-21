import { describe, it, expect } from 'vitest'
import { computeCutList } from './cutList'
import type { Design } from '../types'

function bareDesign(): Design {
  return {
    id: 'd1', name: 'Test',
    root: { id: 'root' },
    globalSettings: {
      unit: 'mm', height: 800, width: 600, depth: 500,
      thickness: 18, backThickness: 6, toeKick: null, defaultMaterial: 'oak',
    },
  }
}

describe('computeCutList – bare cabinet', () => {
  it('produces 2 side panels, 1 top, 1 bottom', () => {
    const entries = computeCutList(bareDesign())
    const labels = entries.map(e => e.label)
    expect(labels).toContain('Top panel')
    expect(labels).toContain('Bottom panel')
    const sides = entries.filter(e => e.label === 'Side panel')
    expect(sides[0].qty).toBe(2)
  })

  it('side panels are height  depth', () => {
    const entries = computeCutList(bareDesign())
    const side = entries.find(e => e.label === 'Side panel')!
    expect(side.width).toBe(800)
    expect(side.height).toBe(500)
    expect(side.depth).toBe(18)
  })

  it('top/bottom panels are (width - 2×thickness) × depth', () => {
    const entries = computeCutList(bareDesign())
    const top = entries.find(e => e.label === 'Top panel')!
    expect(top.width).toBe(564)
    expect(top.height).toBe(500)
  })
})

describe('computeCutList – with shelf', () => {
  it('adds 1 shelf entry', () => {
    const design = bareDesign()
    design.root = {
      id: 'root',
      splitAxis: 'horizontal',
      children: [{ id: 'a' }, { id: 'b' }],
    }
    const entries = computeCutList(design)
    const shelves = entries.filter(e => e.label === 'Shelf')
    expect(shelves[0].qty).toBe(1)
    expect(shelves[0].width).toBe(564)
  })
})

describe('computeCutList – with toe-kick', () => {
  it('adds toe-kick board to cut list', () => {
    const design = bareDesign()
    design.globalSettings.toeKick = { height: 100, setback: 20 }
    const entries = computeCutList(design)
    const tk = entries.find(e => e.label === 'Toe-kick board')
    expect(tk).toBeDefined()
    expect(tk!.width).toBe(600 - 2 * 20)
    expect(tk!.height).toBe(100)
  })
})

describe('computeCutList – with back panel', () => {
  it('includes a back panel entry', () => {
    const entries = computeCutList(bareDesign())
    const back = entries.find(e => e.label === 'Back panel')
    expect(back).toBeDefined()
    expect(back!.width).toBe(600 - 2 * 18)
    expect(back!.height).toBe(800 - 2 * 18)
  })
})

describe('computeCutList – mixed-height vertical dividers', () => {
  it('produces separate entries for dividers of different heights', () => {
    const design = bareDesign()
    design.root = {
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
    const entries = computeCutList(design)
    const dividers = entries.filter(e => e.label === 'Divider')
    const totalQty = dividers.reduce((sum, entry) => sum + entry.qty, 0)
    expect(totalQty).toBe(2)
  })

  it('produces two entries for dividers at different spans', () => {
    const design = bareDesign()
    design.root = {
      id: 'root',
      splitAxis: 'horizontal',
      splitRatio: 0.5,
      children: [
        {
          id: 'top',
          splitAxis: 'vertical',
          material: 'oak',
          children: [{ id: 'tl' }, { id: 'tr' }],
        },
        {
          id: 'bot',
          splitAxis: 'vertical',
          material: 'walnut',
          children: [{ id: 'bl' }, { id: 'br' }],
        },
      ],
    }
    const entries = computeCutList(design)
    const dividers = entries.filter(e => e.label === 'Divider')
    expect(dividers.length).toBe(2)
  })
})

describe('computeCutList – drawer box', () => {
  it('adds drawer box dimensions for side-mount drawer', () => {
    const design = bareDesign()
    design.root = {
      id: 'root',
      elementType: 'drawer',
      drawerConfig: { slideType: 'side-mount', reveal: 3 },
    }
    const entries = computeCutList(design)
    const drawerBox = entries.find(e => e.label === 'Drawer box (side-mount)')
    expect(drawerBox).toBeDefined()
  })
})

describe('computeCutList – accessories', () => {
  it('adds door and drawer front entries from void accessories', () => {
    const design = bareDesign()
    design.root = {
      id: 'root',
      splitAxis: 'vertical',
      children: [
        { id: 'left', accessories: [{ id: 'a1', type: 'door' }] },
        { id: 'right', accessories: [{ id: 'a2', type: 'drawer-front' }] },
      ],
    }

    const entries = computeCutList(design)

    expect(entries.find(e => e.label === 'Door panel')?.qty).toBe(1)
    expect(entries.find(e => e.label === 'Drawer front')?.qty).toBe(1)
  })
})

describe('computeCutList – door accessories', () => {
  it('produces separate entries for doors of different heights', () => {
    const design = bareDesign()
    design.root = {
      id: 'root',
      splitAxis: 'horizontal',
      splitRatio: 0.4,
      children: [
        { id: 'top', accessories: [{ id: 'a1', type: 'door' }] },
        { id: 'bot', accessories: [{ id: 'a2', type: 'door' }] },
      ],
    }

    const entries = computeCutList(design)
    const doors = entries.filter(e => e.label === 'Door panel')
    expect(doors.length).toBe(2)
    const totalQty = doors.reduce((sum, entry) => sum + entry.qty, 0)
    expect(totalQty).toBe(2)
  })
})

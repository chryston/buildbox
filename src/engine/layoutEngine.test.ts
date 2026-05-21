import { describe, it, expect } from 'vitest'
import { computeLayout } from './layoutEngine'
import type { Design, CabinetNode } from '../types'

function makeDesign(root: CabinetNode): Design {
  return {
    id: 'd1',
    name: 'Test',
    root,
    globalSettings: {
      unit: 'mm', height: 800, width: 600, depth: 500,
      thickness: 18, backThickness: 6, toeKick: null, defaultMaterial: 'oak',
    },
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

describe('computeLayout – toe-kick', () => {
  it('subtracts toe-kick height from inner height and adds toe-kick panel', () => {
    const design = makeDesign({ id: 'root' })
    design.globalSettings.toeKick = { height: 100, setback: 20 }
    const result = computeLayout(design)
    const tk = result.panels.find(p => p.role === 'toe-kick-board')
    expect(tk).toBeDefined()
    expect(tk!.h).toBe(100)
    expect(result.voids[0].h).toBe(664)
  })
})

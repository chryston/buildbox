import { describe, it, expect } from 'vitest'
import {
  addShelf,
  addDivider,
  deleteBoard,
  findNode,
  setDrawerConfig,
  setElementType,
  setNodeSize,
  setSplitRatio,
  pinNode,
  unpinNode,
  setNodeLabel,
  distributeEvenly,
} from './treeMutations'
import type { CabinetNode, DrawerConfig } from '../types'

const leaf = (): CabinetNode => ({ id: 'root' })

describe('addShelf', () => {
  it('splits a leaf node horizontally into 2 equal children', () => {
    const next = addShelf(leaf(), 'root')
    expect(next.splitAxis).toBe('horizontal')
    expect(next.children).toHaveLength(2)
    expect(next.children![0].splitAxis).toBeUndefined()
    expect(next.children![1].splitAxis).toBeUndefined()
  })

  it('splits a nested void by id', () => {
    const root: CabinetNode = {
      id: 'root',
      splitAxis: 'horizontal',
      children: [{ id: 'top' }, { id: 'bot' }],
    }
    const next = addShelf(root, 'top')
    expect(next.children![0].splitAxis).toBe('horizontal')
    expect(next.children![0].children).toHaveLength(2)
  })

  it('throws when id not found', () => {
    expect(() => addShelf(leaf(), 'missing')).toThrow()
  })

  it('throws when the target node is already split', () => {
    const root: CabinetNode = {
      id: 'root',
      splitAxis: 'horizontal',
      children: [{ id: 'a' }, { id: 'b' }],
    }

    expect(() => addShelf(root, 'root')).toThrow()
  })
})

describe('addDivider', () => {
  it('splits a leaf node vertically', () => {
    const next = addDivider(leaf(), 'root')
    expect(next.splitAxis).toBe('vertical')
  })
})

describe('deleteBoard', () => {
  it('returns a fresh void with parent id', () => {
    const root: CabinetNode = {
      id: 'root',
      splitAxis: 'horizontal',
      children: [{ id: 'a' }, { id: 'b' }],
    }
    const next = deleteBoard(root, 'a')
    expect(next.splitAxis).toBeUndefined()
    expect(next.children).toBeUndefined()
    expect(next.elementType).toBe('void')
    expect(next.locked).toBeFalsy()
    expect(next.fixedSize).toBeUndefined()
  })

  it('throws when trying to delete root itself', () => {
    expect(() => deleteBoard(leaf(), 'root')).toThrow()
  })
})

describe('setNodeSize', () => {
  it('sets fixedSize but does NOT set locked', () => {
    const root: CabinetNode = {
      id: 'root',
      splitAxis: 'horizontal',
      children: [{ id: 'a' }, { id: 'b' }],
    }
    const next = setNodeSize(root, 'a', 200)
    expect(next.children![0].fixedSize).toBe(200)
    expect(next.children![0].locked).toBeFalsy()
  })
})

describe('unlockNode backward compat', () => {
  it('clears locked and fixedSize on the target node', () => {
    const root: CabinetNode = {
      id: 'root',
      splitAxis: 'horizontal',
      children: [{ id: 'a', fixedSize: 200, locked: true }, { id: 'b' }],
    }
    const next = unpinNode(root, 'a')
    expect(next.children![0].locked).toBeFalsy()
    expect(next.children![0].fixedSize).toBeUndefined()
  })
})

describe('splitNode guards', () => {
  it('throws when splitting a drawer node', () => {
    const root: CabinetNode = { id: 'root', elementType: 'drawer' }
    expect(() => addShelf(root, 'root')).toThrow('Cannot split a drawer void')
  })
})

describe('other mutations', () => {
  it('sets splitRatio on the target node', () => {
    const root: CabinetNode = {
      id: 'root',
      splitAxis: 'horizontal',
      children: [{ id: 'a' }, { id: 'b' }],
    }

    const ratioNext = setSplitRatio(root, 'root', 0.25)
    expect(ratioNext.splitRatio).toBe(0.25)
  })
})

describe('setElementType', () => {
  it('sets elementType on target node', () => {
    const root: CabinetNode = { id: 'root' }
    const next = setElementType(root, 'root', 'drawer')
    expect(next.elementType).toBe('drawer')
    expect(next.drawerConfig).toEqual({ slideType: 'side-mount', reveal: 3 })
  })

  it('preserves an existing drawerConfig when setting drawer element type', () => {
    const root: CabinetNode = {
      id: 'root',
      drawerConfig: { slideType: 'undermount', reveal: 5 },
    }

    const next = setElementType(root, 'root', 'drawer')

    expect(next.drawerConfig).toEqual({ slideType: 'undermount', reveal: 5 })
  })
})

describe('setDrawerConfig', () => {
  it('sets drawerConfig on target node', () => {
    const root: CabinetNode = { id: 'root' }
    const config: DrawerConfig = { slideType: 'undermount', reveal: 3 }
    const next = setDrawerConfig(root, 'root', config)
    expect(next.drawerConfig).toEqual(config)
  })
})

describe('findNode', () => {
  it('finds a node by id', () => {
    const root: CabinetNode = {
      id: 'root',
      splitAxis: 'horizontal',
      children: [{ id: 'a' }, { id: 'b' }],
    }

    expect(findNode(root, 'a')?.id).toBe('a')
    expect(findNode(root, 'missing')).toBeNull()
  })
})

describe('pinNode / unpinNode', () => {
  it('pinNode sets both fixedSize and locked', () => {
    const root: CabinetNode = { id: 'root', splitAxis: 'horizontal', splitRatio: 0.5,
      children: [{ id: 'a', elementType: 'void' }, { id: 'b', elementType: 'void' }] }
    const next = pinNode(root, 'a', 300)
    expect(findNode(next, 'a')).toMatchObject({ fixedSize: 300, locked: true })
  })

  it('unpinNode clears both fixedSize and locked', () => {
    const root: CabinetNode = { id: 'root', splitAxis: 'horizontal', splitRatio: 0.5,
      children: [{ id: 'a', elementType: 'void', fixedSize: 300, locked: true }, { id: 'b', elementType: 'void' }] }
    const next = unpinNode(root, 'a')
    const a = findNode(next, 'a')
    expect(a?.locked).toBeFalsy()
    expect(a?.fixedSize).toBeUndefined()
  })
})

describe('setNodeLabel', () => {
  it('sets spaceLabel on the target node', () => {
    const root: CabinetNode = { id: 'root', splitAxis: 'horizontal', splitRatio: 0.5,
      children: [{ id: 'a', elementType: 'void' }, { id: 'b', elementType: 'void' }] }
    const next = setNodeLabel(root, 'a', 'Pots')
    expect(findNode(next, 'a')?.spaceLabel).toBe('Pots')
  })

  it('clears label when empty string passed', () => {
    const root: CabinetNode = { id: 'root', splitAxis: 'horizontal', splitRatio: 0.5,
      children: [{ id: 'a', elementType: 'void', spaceLabel: 'Pots' }, { id: 'b', elementType: 'void' }] }
    const next = setNodeLabel(root, 'a', '')
    expect(findNode(next, 'a')?.spaceLabel).toBeUndefined()
  })
})

describe('splitNode clears spaceLabel and fixedSize/locked', () => {
  it('clears spaceLabel when a labeled void is split', () => {
    const root: CabinetNode = { id: 'root', elementType: 'void', spaceLabel: 'Books' }
    const next = addShelf(root, 'root')
    expect(next.spaceLabel).toBeUndefined()
  })

  it('clears fixedSize and locked when a pinned void is split (prevents constraint leakage)', () => {
    const root: CabinetNode = { id: 'root', elementType: 'void', fixedSize: 300, locked: true }
    const next = addShelf(root, 'root')
    expect(next.fixedSize).toBeUndefined()
    expect(next.locked).toBeFalsy()
  })
})

describe('distributeEvenly', () => {
  it('sets equal splitRatios so all column leaves get the same rendered height', () => {
    const root: CabinetNode = {
      id: 'root', splitAxis: 'horizontal',
      children: [
        { id: 'a', elementType: 'void', fixedSize: 400, locked: true },
        { id: 'b', splitAxis: 'horizontal',
          children: [
            { id: 'c', elementType: 'void' },
            { id: 'd', elementType: 'void', fixedSize: 100 },
          ]
        }
      ]
    }
    const thickness = 18
    const evenH = 300
    const next = distributeEvenly(root, 'root', evenH, thickness)
    expect(findNode(next, 'a')).toMatchObject({ fixedSize: undefined, locked: false })
    expect(findNode(next, 'd')).toMatchObject({ fixedSize: undefined, locked: false })
    // subtreeH(a)=300, subtreeH(b)=300+18+300=618, available=918
    expect(next.splitRatio).toBeCloseTo(300 / 918, 5)
    // b's splitRatio: subtreeH(c)=300, subtreeH(d)=300, available=600 → 0.5
    expect(findNode(next, 'b')?.splitRatio).toBeCloseTo(0.5, 5)
  })

  it('does not touch nodes under vertical splits', () => {
    const root: CabinetNode = {
      id: 'root', splitAxis: 'horizontal',
      children: [
        { id: 'a', elementType: 'void' },
        { id: 'b', splitAxis: 'vertical',
          children: [
            { id: 'c', elementType: 'void', fixedSize: 999, locked: true },
            { id: 'd', elementType: 'void', fixedSize: 999 },
          ]
        }
      ]
    }
    const next = distributeEvenly(root, 'root', 300, 18)
    // b is v-split, treated as single leaf; its children are NOT touched
    expect(findNode(next, 'c')?.fixedSize).toBe(999)
    expect(findNode(next, 'd')?.fixedSize).toBe(999)
    expect(findNode(next, 'c')?.locked).toBe(true)
  })
})

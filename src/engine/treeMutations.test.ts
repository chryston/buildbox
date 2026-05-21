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
  setLocked,
  setMaterial,
  unlockNode,
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
  it('sets fixedSize and locked: true on the target node', () => {
    const root: CabinetNode = {
      id: 'root',
      splitAxis: 'horizontal',
      children: [{ id: 'a' }, { id: 'b' }],
    }
    const next = setNodeSize(root, 'a', 200)
    expect(next.children![0].fixedSize).toBe(200)
    expect(next.children![0].locked).toBe(true)
  })
})

describe('unlockNode', () => {
  it('clears locked and fixedSize on the target node', () => {
    const root: CabinetNode = {
      id: 'root',
      splitAxis: 'horizontal',
      children: [{ id: 'a', fixedSize: 200, locked: true }, { id: 'b' }],
    }
    const next = unlockNode(root, 'a')
    expect(next.children![0].locked).toBe(false)
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

  it('sets locked and material on the target node', () => {
    const root: CabinetNode = {
      id: 'root',
      splitAxis: 'horizontal',
      children: [{ id: 'a' }, { id: 'b' }],
    }

    const lockedNext = setLocked(root, 'a', true)
    expect(lockedNext.children![0].locked).toBe(true)

    const materialNext = setMaterial(root, 'b', 'oak')
    expect(materialNext.children![1].material).toBe('oak')
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

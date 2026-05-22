import { describe, it, expect } from 'vitest'
import { addAccessory, removeAccessory, getAccessories } from './accessories'
import type { CabinetNode } from '../types'

const leaf: CabinetNode = { id: 'v1' }

describe('accessories engine', () => {
  it('adds an accessory to a node', () => {
    const updated = addAccessory(leaf, 'v1', { id: 'a1', type: 'door' })
    expect(updated.accessories).toHaveLength(1)
    expect(updated.accessories![0].type).toBe('door')
  })

  it('removes an accessory by id', () => {
    const withAcc = addAccessory(leaf, 'v1', { id: 'a1', type: 'door' })
    const withoutAcc = removeAccessory(withAcc, 'v1', 'a1')
    expect(withoutAcc.accessories).toHaveLength(0)
  })

  it('getAccessories returns empty array for node with no accessories', () => {
    expect(getAccessories(leaf)).toEqual([])
  })

  it('does not mutate original node', () => {
    addAccessory(leaf, 'v1', { id: 'a1', type: 'door' })
    expect(leaf.accessories).toBeUndefined()
  })
})

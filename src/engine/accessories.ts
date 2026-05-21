import type { Accessory, CabinetNode } from '../types'
import { mapNode } from './treeMutations'

export function addAccessory(root: CabinetNode, nodeId: string, accessory: Accessory): CabinetNode {
  return mapNode(root, (node) => {
    if (node.id !== nodeId) return node
    return { ...node, accessories: [...(node.accessories ?? []), accessory] }
  })
}

export function removeAccessory(root: CabinetNode, nodeId: string, accessoryId: string): CabinetNode {
  return mapNode(root, (node) => {
    if (node.id !== nodeId) return node
    return { ...node, accessories: (node.accessories ?? []).filter((a) => a.id !== accessoryId) }
  })
}

export function getAccessories(node: CabinetNode): Accessory[] {
  return node.accessories ?? []
}

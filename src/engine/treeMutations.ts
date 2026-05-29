import { nanoid } from 'nanoid'

import type {
  CabinetNode,
  DrawerConfig,
  ElementType,
  SplitAxis,
} from '../types'

export function addShelf(root: CabinetNode, targetId: string): CabinetNode {
  return splitNode(root, targetId, 'horizontal')
}

export function addDivider(root: CabinetNode, targetId: string): CabinetNode {
  return splitNode(root, targetId, 'vertical')
}

export function deleteBoard(root: CabinetNode, childId: string): CabinetNode {
  if (root.id === childId) throw new Error('Cannot delete root node')

  return mapNode(root, (node) => {
    if (!node.children) return node

    const hasChild = node.children.some((child) => child.id === childId)
    if (!hasChild) return node

    return { id: node.id, elementType: 'void' as ElementType }
  })
}

export function setNodeSize(root: CabinetNode, targetId: string, size: number): CabinetNode {
  return mapNode(root, (node) =>
    node.id === targetId ? { ...node, fixedSize: size } : node,
  )
}

export function pinNode(root: CabinetNode, targetId: string, sizeMm: number): CabinetNode {
  return mapNode(root, (node) =>
    node.id === targetId ? { ...node, fixedSize: sizeMm, locked: true } : node,
  )
}

export function unpinNode(root: CabinetNode, targetId: string): CabinetNode {
  return mapNode(root, (node) =>
    node.id === targetId ? { ...node, locked: false, fixedSize: undefined } : node,
  )
}

export function setNodeLabel(root: CabinetNode, targetId: string, label: string): CabinetNode {
  return mapNode(root, (node) =>
    node.id === targetId
      ? { ...node, spaceLabel: label.trim() || undefined }
      : node,
  )
}

export function distributeEvenly(
  root: CabinetNode,
  columnRootId: string,
  evenH: number,
  thickness: number,
): CabinetNode {
  return mapNode(root, (node) => {
    if (node.id !== columnRootId) return node
    return setColumnSplitRatios(node, evenH, thickness)
  })
}

function subtreeH(node: CabinetNode, evenH: number, t: number): number {
  if (!node.splitAxis || node.splitAxis === 'vertical') return evenH
  return subtreeH(node.children![0], evenH, t) + t + subtreeH(node.children![1], evenH, t)
}

function setColumnSplitRatios(node: CabinetNode, evenH: number, thickness: number): CabinetNode {
  const cleared: CabinetNode = { ...node, fixedSize: undefined, locked: false }

  if (!node.splitAxis || node.splitAxis === 'vertical') {
    return cleared
  }

  const [childA, childB] = node.children!
  const leftH = subtreeH(childA, evenH, thickness)
  const rightH = subtreeH(childB, evenH, thickness)
  const available = leftH + rightH

  return {
    ...cleared,
    splitRatio: available > 0 ? leftH / available : 0.5,
    children: [
      setColumnSplitRatios(childA, evenH, thickness),
      setColumnSplitRatios(childB, evenH, thickness),
    ],
  }
}

// Kept for backward compat with store callers
export const unlockNode = unpinNode

export function setSplitRatio(root: CabinetNode, nodeId: string, ratio: number): CabinetNode {
  return mapNode(root, (node) => (node.id === nodeId ? { ...node, splitRatio: ratio } : node))
}

export function setElementType(root: CabinetNode, id: string, elementType: ElementType): CabinetNode {
  return mapNode(root, (node) => {
    if (node.id !== id) return node

    const patch: Partial<CabinetNode> = { elementType }
    if (elementType === 'drawer' && !node.drawerConfig) {
      patch.drawerConfig = { slideType: 'side-mount', reveal: 3 }
    }

    return { ...node, ...patch }
  })
}

export function setDrawerConfig(root: CabinetNode, id: string, cfg: DrawerConfig): CabinetNode {
  return mapNode(root, (node) => (node.id === id ? { ...node, drawerConfig: cfg } : node))
}

export function mapNode(node: CabinetNode, fn: (n: CabinetNode) => CabinetNode): CabinetNode {
  const mapped = fn(node)
  if (!mapped.children) return mapped

  return {
    ...mapped,
    children: [mapNode(mapped.children[0], fn), mapNode(mapped.children[1], fn)],
  }
}

export function findNode(root: CabinetNode, id: string): CabinetNode | null {
  if (root.id === id) return root
  if (!root.children) return null

  for (const child of root.children) {
    const found = findNode(child, id)
    if (found) return found
  }

  return null
}

export const MAX_TREE_DEPTH = 12

function treeDepth(root: CabinetNode, targetId: string, depth = 0): number {
  if (root.id === targetId) return depth
  if (!root.children) return -1

  for (const child of root.children) {
    const childDepth = treeDepth(child, targetId, depth + 1)
    if (childDepth !== -1) return childDepth
  }

  return -1
}

function splitNode(root: CabinetNode, targetId: string, axis: SplitAxis): CabinetNode {
  let found = false

  const result = mapNode(root, (node) => {
    if (node.id !== targetId) return node
    if (node.splitAxis) throw new Error(`Node ${targetId} is already split`)
    if (node.elementType === 'drawer') throw new Error('Cannot split a drawer void')

    const depth = treeDepth(root, targetId)
    if (depth >= MAX_TREE_DEPTH) throw new Error('Max tree depth reached')

    found = true
    return {
      ...node,
      splitAxis: axis,
      spaceLabel: undefined,
      fixedSize: undefined,
      locked: false,
      children: [
        { id: nanoid(8), elementType: 'void' as ElementType },
        { id: nanoid(8), elementType: 'void' as ElementType },
      ],
    }
  })

  if (!found) throw new Error(`Node ${targetId} not found`)
  return result
}

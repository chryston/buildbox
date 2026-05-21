import type {
  CabinetNode,
  Design,
  LayoutDivider,
  LayoutPanel,
  LayoutResult,
  LayoutVoid,
  MaterialId,
  SplitAxis,
} from '../types'

const MIN_SECTION_SIZE = 50

export function computeLayout(design: Design): LayoutResult {
  const { globalSettings: gs, root } = design
  const thickness = gs.thickness
  const toeKickHeight = gs.toeKick?.height ?? 0

  const panels = buildOuterPanels(gs)
  const voids: LayoutVoid[] = []
  const dividers: LayoutDivider[] = []
  const overConstrainedIds: string[] = []

  const innerX = thickness
  const innerY = thickness
  const innerW = gs.width - (2 * thickness)
  const innerH = gs.height - (2 * thickness) - toeKickHeight

  if (gs.toeKick) {
    panels.push({
      id: 'toe-kick-board',
      role: 'toe-kick-board',
      x: gs.toeKick.setback,
      y: gs.height - thickness - toeKickHeight,
      w: gs.width - (2 * gs.toeKick.setback),
      h: toeKickHeight,
      material: gs.defaultMaterial,
    })
  }

  layoutNode(root, innerX, innerY, innerW, innerH, gs.defaultMaterial, undefined)

  return {
    panels,
    voids,
    dividers,
    overConstrainedIds,
  }

  function layoutNode(
    node: CabinetNode,
    x: number,
    y: number,
    w: number,
    h: number,
    inheritedMaterial: MaterialId,
    parentSplitAxis: SplitAxis | undefined,
  ): void {
    const material = node.material ?? inheritedMaterial

    if (!node.splitAxis || !node.children) {
      voids.push({
        nodeId: node.id,
        x,
        y,
        w,
        h,
        parentSplitAxis,
        elementType: node.elementType ?? 'void',
        drawerConfig: node.drawerConfig,
        material,
        accessories: node.accessories ?? [],
      })
      return
    }

    const axis = node.splitAxis
    const available = axis === 'horizontal' ? h - thickness : w - thickness
    const [childA, childB] = node.children
    const [sizeA, sizeB, overConstrained] = distributeTwo(childA, childB, available, node)

    if (overConstrained) {
      if (childA.locked) overConstrainedIds.push(childA.id)
      if (childB.locked) overConstrainedIds.push(childB.id)
    }

    const dividerConfig = node.dividers?.[0]
    const dividerMaterial = dividerConfig?.materialId ?? material

    if (axis === 'horizontal') {
      layoutNode(childA, x, y, w, sizeA, material, axis)

      const dividerY = y + sizeA
      dividers.push({
        nodeId: `${childA.id}-shelf`,
        parentId: node.id,
        childAId: childA.id,
        childBId: childB.id,
        x,
        y: dividerY,
        w,
        h: thickness,
        axis,
        material: dividerMaterial,
        dividerId: dividerConfig?.id,
        childABounds: { x, y, w, h: sizeA },
        childBBounds: { x, y: dividerY + thickness, w, h: sizeB },
      })

      layoutNode(childB, x, dividerY + thickness, w, sizeB, material, axis)
      return
    }

    layoutNode(childA, x, y, sizeA, h, material, axis)

    const dividerX = x + sizeA
    dividers.push({
      nodeId: `${childA.id}-divider`,
      parentId: node.id,
      childAId: childA.id,
      childBId: childB.id,
      x: dividerX,
      y,
      w: thickness,
      h,
      axis,
      material: dividerMaterial,
      dividerId: dividerConfig?.id,
      childABounds: { x, y, w: sizeA, h },
      childBBounds: { x: dividerX + thickness, y, w: sizeB, h },
    })

    layoutNode(childB, dividerX + thickness, y, sizeB, h, material, axis)
  }
}

function distributeTwo(
  childA: CabinetNode,
  childB: CabinetNode,
  available: number,
  parent?: CabinetNode,
): [number, number, boolean] {
  const children = [childA, childB] as const
  const lockedFlags = children.map((child) => child.locked === true && child.fixedSize != null)
  const lockedTotal = children.reduce((total, child, index) => (
    total + (lockedFlags[index] ? child.fixedSize ?? 0 : 0)
  ), 0)

  if (lockedTotal > available) {
    if (lockedTotal === 0) {
      return [0, 0, false]
    }

    return [
      lockedFlags[0] ? (childA.fixedSize ?? 0) * (available / lockedTotal) : 0,
      lockedFlags[1] ? (childB.fixedSize ?? 0) * (available / lockedTotal) : 0,
      true,
    ]
  }

  if (lockedFlags[0] && lockedFlags[1]) {
    return [childA.fixedSize ?? 0, childB.fixedSize ?? 0, false]
  }

  if (lockedFlags[0] && !lockedFlags[1]) {
    return [childA.fixedSize ?? 0, Math.max(available - (childA.fixedSize ?? 0), 0), false]
  }

  if (lockedFlags[1] && !lockedFlags[0]) {
    return [Math.max(available - (childB.fixedSize ?? 0), 0), childB.fixedSize ?? 0, false]
  }

  const flexibleChildren = children.filter((_, index) => !lockedFlags[index])
  const flexibleFixedChildren = flexibleChildren.filter((child) => child.fixedSize != null)
  const freeChildren = flexibleChildren.filter((child) => child.fixedSize == null)

  if (flexibleFixedChildren.length === 2) {
    const totalFixed = flexibleFixedChildren.reduce((sum, child) => sum + (child.fixedSize ?? 0), 0)
    if (totalFixed > 0) {
      const sizeA = available * ((childA.fixedSize ?? 0) / totalFixed)
      return [sizeA, available - sizeA, false]
    }
  }

  if (parent?.splitRatio != null && !Number.isNaN(parent.splitRatio)) {
    const sizeA = Math.round(available * parent.splitRatio)
    return [sizeA, available - sizeA, false]
  }

  if (flexibleFixedChildren.length === 1 && freeChildren.length === 1) {
    const preferred = flexibleFixedChildren[0].fixedSize ?? 0
    const constrainedPreferred = Math.min(preferred, Math.max(available - MIN_SECTION_SIZE, 0))

    if (childA.fixedSize != null) {
      return [constrainedPreferred, available - constrainedPreferred, false]
    }

    return [available - constrainedPreferred, constrainedPreferred, false]
  }

  const half = Math.floor(available / 2)
  return [half, available - half, false]
}

function buildOuterPanels(gs: {
  width: number
  height: number
  thickness: number
  defaultMaterial: MaterialId
}): LayoutPanel[] {
  const thickness = gs.thickness

  return [
    {
      id: 'top',
      role: 'top',
      x: 0,
      y: 0,
      w: gs.width,
      h: thickness,
      material: gs.defaultMaterial,
    },
    {
      id: 'bottom',
      role: 'bottom',
      x: 0,
      y: gs.height - thickness,
      w: gs.width,
      h: thickness,
      material: gs.defaultMaterial,
    },
    {
      id: 'left',
      role: 'left',
      x: 0,
      y: thickness,
      w: thickness,
      h: gs.height - (2 * thickness),
      material: gs.defaultMaterial,
    },
    {
      id: 'right',
      role: 'right',
      x: gs.width - thickness,
      y: thickness,
      w: thickness,
      h: gs.height - (2 * thickness),
      material: gs.defaultMaterial,
    },
  ]
}

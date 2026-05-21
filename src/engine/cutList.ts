import type { CutListEntry, Design, MaterialId } from '../types'
import { computeLayout } from './layoutEngine'

const DRAWER_BOX_TOP_CLEARANCE_MM = 12

export function computeCutList(design: Design): CutListEntry[] {
  const gs = design.globalSettings
  const t = gs.thickness
  const layout = computeLayout(design)
  const entries: CutListEntry[] = []

  entries.push({
    label: 'Side panel',
    qty: 2,
    width: gs.height,
    height: gs.depth,
    depth: t,
    material: gs.defaultMaterial,
  })

  entries.push({
    label: 'Top panel',
    qty: 1,
    width: gs.width - 2 * t,
    height: gs.depth,
    depth: t,
    material: gs.defaultMaterial,
  })

  entries.push({
    label: 'Bottom panel',
    qty: 1,
    width: gs.width - 2 * t,
    height: gs.depth,
    depth: t,
    material: gs.defaultMaterial,
  })

  const backThickness = gs.backThickness ?? 6
  entries.push({
    label: 'Back panel',
    qty: 1,
    width: gs.width - 2 * t,
    height: gs.height - 2 * t,
    depth: backThickness,
    material: gs.defaultMaterial,
    notes: `${backThickness}mm ply back`,
  })

  if (gs.toeKick) {
    entries.push({
      label: 'Toe-kick board',
      qty: 1,
      width: gs.width - 2 * gs.toeKick.setback,
      height: gs.toeKick.height,
      depth: t,
      material: gs.defaultMaterial,
    })
  }

  const shelves = layout.dividers.filter((divider) => divider.axis === 'horizontal')
  const shelfGroups = new Map<string, { qty: number, w: number, mat: MaterialId }>()

  for (const shelf of shelves) {
    const key = `${Math.round(shelf.w)}×${shelf.material}`
    const group = shelfGroups.get(key) ?? { qty: 0, w: shelf.w, mat: shelf.material }
    shelfGroups.set(key, { ...group, qty: group.qty + 1 })
  }

  for (const group of shelfGroups.values()) {
    entries.push({
      label: 'Shelf',
      qty: group.qty,
      width: group.w,
      height: gs.depth,
      depth: t,
      material: group.mat,
    })
  }

  const verticalDividers = layout.dividers.filter((divider) => divider.axis === 'vertical')
  const dividerGroups = new Map<string, { qty: number, h: number, mat: MaterialId }>()

  for (const divider of verticalDividers) {
    const key = `${Math.round(divider.h)}×${divider.material}`
    const group = dividerGroups.get(key) ?? { qty: 0, h: divider.h, mat: divider.material }
    dividerGroups.set(key, { ...group, qty: group.qty + 1 })
  }

  for (const group of dividerGroups.values()) {
    entries.push({
      label: 'Divider',
      qty: group.qty,
      width: group.h,
      height: gs.depth,
      depth: t,
      material: group.mat,
    })
  }

  layout.voids
    .filter((voidEntry) => voidEntry.elementType === 'drawer' && voidEntry.drawerConfig)
    .forEach((voidEntry) => {
      const cfg = voidEntry.drawerConfig!
      const sideClearance = cfg.slideType === 'side-mount' ? 25 : 0
      const faceH = voidEntry.h - cfg.reveal
      const boxH = faceH - DRAWER_BOX_TOP_CLEARANCE_MM
      const boxW = voidEntry.w - 2 * sideClearance
      const boxD = gs.depth - t

      entries.push({
        label: `Drawer box (${cfg.slideType})`,
        qty: 1,
        width: boxW,
        height: boxH,
        depth: boxD,
        material: voidEntry.material,
        notes: `Face: ${voidEntry.w}×${faceH}mm`,
      })
    })

  return entries
}

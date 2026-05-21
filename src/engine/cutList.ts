import type { CutListEntry, Design, MaterialId } from '../types'
import { computeLayout } from './layoutEngine'

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
  if (verticalDividers.length > 0) {
    entries.push({
      label: 'Divider',
      qty: verticalDividers.length,
      width: verticalDividers[0].h,
      height: gs.depth,
      depth: t,
      material: verticalDividers[0].material,
    })
  }

  layout.voids
    .filter((voidEntry) => voidEntry.elementType === 'drawer' && voidEntry.drawerConfig)
    .forEach((voidEntry) => {
      const cfg = voidEntry.drawerConfig!
      const sideClearance = cfg.slideType === 'side-mount' ? 25 : 0
      const faceH = voidEntry.h - cfg.reveal
      const boxH = faceH - 12
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

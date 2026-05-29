import type { CabinetUnit, CabinetSceneUnit, CutListEntry, Design, MaterialId } from '../types'
import { computeUnitLayout } from './layoutEngine'

const DRAWER_BOX_TOP_CLEARANCE_MM = 12

// Backward-compat shim
export function computeCutList(design: Design): CutListEntry[] {
  return computeCutListForUnits(design.units)
}

// IMPORTANT: use the type discriminant, NOT `as CabinetSceneUnit`. This makes Phase C
// extension safe — TypeScript will error if a CountertopSceneUnit is passed without handling.
export function computeCutListForUnits(units: CabinetUnit[]): CutListEntry[] {
  return units.flatMap(unit => {
    if (unit.type === 'cabinet') return computeCutListForUnit(unit)
    return []  // Phase C: add countertop handling here
  })
}

function computeCutListForUnit(unit: CabinetSceneUnit): CutListEntry[] {
  const gs = unit.settings
  const t = gs.thickness
  // computeUnitLayout takes (settings, root) directly — no Design shim needed
  const layout = computeUnitLayout(gs, unit.root)
  const raw: Omit<CutListEntry, 'unitId' | 'unitLabel'>[] = []

  raw.push({ label: 'Side panel', qty: 2, width: gs.height, height: gs.depth, depth: t, material: gs.material ?? (gs as any).defaultMaterial ?? 'oak' })
  raw.push({ label: 'Top panel', qty: 1, width: gs.width - 2 * t, height: gs.depth, depth: t, material: gs.material ?? (gs as any).defaultMaterial ?? 'oak' })
  raw.push({ label: 'Bottom panel', qty: 1, width: gs.width - 2 * t, height: gs.depth, depth: t, material: gs.material ?? (gs as any).defaultMaterial ?? 'oak' })

  const backThickness = gs.backThickness ?? 6
  raw.push({ label: 'Back panel', qty: 1, width: gs.width - 2 * t, height: gs.height - 2 * t, depth: backThickness, material: gs.material ?? (gs as any).defaultMaterial ?? 'oak', notes: `${backThickness}mm ply back` })

  if (gs.toeKick) {
    raw.push({ label: 'Toe-kick board', qty: 1, width: gs.width - 2 * gs.toeKick.setback, height: gs.toeKick.height, depth: t, material: gs.material ?? (gs as any).defaultMaterial ?? 'oak' })
  }

  const shelves = layout.dividers.filter(d => d.axis === 'horizontal')
  const shelfGroups = new Map<string, { qty: number, w: number, mat: MaterialId }>()
  for (const shelf of shelves) {
    const key = `${Math.round(shelf.w)}×${shelf.material}`
    const group = shelfGroups.get(key) ?? { qty: 0, w: shelf.w, mat: shelf.material }
    shelfGroups.set(key, { ...group, qty: group.qty + 1 })
  }
  for (const group of shelfGroups.values()) {
    raw.push({ label: 'Shelf', qty: group.qty, width: group.w, height: gs.depth, depth: t, material: group.mat })
  }

  const verticalDividers = layout.dividers.filter(d => d.axis === 'vertical')
  const dividerGroups = new Map<string, { qty: number, h: number, mat: MaterialId }>()
  for (const divider of verticalDividers) {
    const key = `${Math.round(divider.h)}×${divider.material}`
    const group = dividerGroups.get(key) ?? { qty: 0, h: divider.h, mat: divider.material }
    dividerGroups.set(key, { ...group, qty: group.qty + 1 })
  }
  for (const group of dividerGroups.values()) {
    raw.push({ label: 'Divider', qty: group.qty, width: group.h, height: gs.depth, depth: t, material: group.mat })
  }

  layout.voids
    .filter(v => v.elementType === 'drawer' && v.drawerConfig)
    .forEach(v => {
      const cfg = v.drawerConfig!
      const sideClearance = cfg.slideType === 'side-mount' ? 25 : 0
      const faceH = v.h - cfg.reveal
      const boxH = faceH - DRAWER_BOX_TOP_CLEARANCE_MM
      const boxW = v.w - 2 * sideClearance
      raw.push({ label: `Drawer box (${cfg.slideType})`, qty: 1, width: boxW, height: boxH, depth: gs.depth - t, material: v.material, notes: `Face: ${v.w}×${faceH}mm` })
    })

  const doorGroups = new Map<string, { qty: number, w: number, h: number, mat: MaterialId }>()
  for (const v of layout.voids) {
    if (v.accessories.some(a => a.type === 'door')) {
      const key = `${Math.round(v.w)}×${Math.round(v.h)}×${v.material}`
      const group = doorGroups.get(key) ?? { qty: 0, w: v.w, h: v.h, mat: v.material }
      doorGroups.set(key, { ...group, qty: group.qty + 1 })
    }
  }
  for (const group of doorGroups.values()) {
    raw.push({ label: 'Door panel', qty: group.qty, width: group.w, height: group.h, depth: t, material: group.mat, notes: 'full overlay' })
  }

  const drawerFrontGroups = new Map<string, { qty: number, w: number, h: number, mat: MaterialId }>()
  for (const v of layout.voids) {
    if (v.accessories.some(a => a.type === 'drawer-front')) {
      const key = `${Math.round(v.w)}×${Math.round(v.h)}×${v.material}`
      const group = drawerFrontGroups.get(key) ?? { qty: 0, w: v.w, h: v.h, mat: v.material }
      drawerFrontGroups.set(key, { ...group, qty: group.qty + 1 })
    }
  }
  for (const group of drawerFrontGroups.values()) {
    raw.push({ label: 'Drawer front', qty: group.qty, width: group.w, height: group.h, depth: t, material: group.mat })
  }
  // 'pull' and 'hinge' accessories are hardware (purchased, not cut) — no cut list entry

  return raw.map(entry => ({ ...entry, unitId: unit.id, unitLabel: unit.label }))
}

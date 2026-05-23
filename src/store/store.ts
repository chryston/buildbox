import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { shallow } from 'zustand/shallow'
import { temporal } from 'zundo'
import { nanoid } from 'nanoid'
import type { Accessory, CabinetSceneUnit, Design, GlobalSettings, MaterialId, DrawerConfig, UIState, ElementType } from '../types'
import { addShelf, addDivider, deleteBoard as deleteBoardFn, setNodeSize, setLocked, setMaterial, setSplitRatio, unlockNode, setElementType as treeMutSetElementType, setDrawerConfig as treeMutSetDrawerConfig } from '../engine/treeMutations'
import { addAccessory as addAccessoryFn, removeAccessory as removeAccessoryFn } from '../engine/accessories'

interface PersistedState {
  projects: Design[]
  activeProjectId: string | null
}

type ActiveUnitState = PersistedState & { activeUnitId: string | null }

interface StoreState extends PersistedState, UIState {
  // project management
  createProject: () => void
  deleteProject: (id: string) => void
  renameProject: (id: string, name: string) => void
  setActiveProject: (id: string) => void

  // global settings (patches active unit's settings)
  updateSettings: (patch: Partial<GlobalSettings>) => void

  // unit management
  addUnit: () => void
  removeUnit: (unitId: string) => void
  setActiveUnit: (unitId: string) => void
  renameUnit: (unitId: string, label: string) => void
  updateUnitSettings: (unitId: string, patch: Partial<GlobalSettings>) => void

  // tree mutations
  addShelf: (nodeId: string) => void
  addDivider: (nodeId: string) => void
  deleteBoard: (nodeId: string) => void
  setNodeSize: (nodeId: string, sizeMm: number) => void
  unlockNode: (nodeId: string) => void
  setLocked: (nodeId: string, locked: boolean) => void
  setMaterial: (nodeId: string, material: MaterialId) => void
  setElementType: (nodeId: string, et: ElementType) => void
  setDrawerConfig: (nodeId: string, config: DrawerConfig) => void
  commitDrag: (parentNodeId: string, ratio: number) => void
  addAccessory: (nodeId: string, accessory: Accessory) => void
  removeAccessory: (nodeId: string, accessoryId: string) => void
  importWorkspace: (incoming: Design[], mode: 'replace' | 'merge') => void

  // UI (not persisted)
  setSelectedId: (id: string | null) => void
  setSnapGrid: (mm: number) => void
}

function defaultDesign(): Design {
  const unitId = nanoid(8)
  return {
    id: nanoid(),
    name: 'Cabinet 1',
    units: [{
      type: 'cabinet',
      id: unitId,
      label: 'Unit 1',
      settings: {
        unit: 'mm',
        height: 800,
        width: 600,
        depth: 500,
        thickness: 18,
        backThickness: 6,
        toeKick: null,
        defaultMaterial: 'oak',
      },
      root: { id: nanoid(8), elementType: 'void' },
      x: 0,
      y: 0,
    }],
  }
}

function activeDesign(state: ActiveUnitState): Design | undefined {
  return state.projects.find((p) => p.id === state.activeProjectId)
}

function findActiveUnit(state: ActiveUnitState): CabinetSceneUnit | null {
  const design = activeDesign(state)
  const unit = design?.units.find(u => u.id === state.activeUnitId)
  return (unit?.type === 'cabinet' ? unit : null) ?? null
}

function mutateActiveUnit(
  state: ActiveUnitState,
  fn: (unit: CabinetSceneUnit) => CabinetSceneUnit,
): void {
  const proj = activeDesign(state)
  if (!proj) return
  const idx = proj.units.findIndex(u => u.id === state.activeUnitId)
  if (idx === -1) return
  const unit = proj.units[idx]
  if (unit.type !== 'cabinet') return
  proj.units[idx] = fn(unit as CabinetSceneUnit)
}

const _initialDesign = defaultDesign()
const partializeProjectState = (state: PersistedState) => ({
  projects: state.projects,
  activeProjectId: state.activeProjectId,
})

export const useStore = create<StoreState>()(
  temporal(
    persist(
      immer((set) => ({
        projects: [_initialDesign],
        activeProjectId: _initialDesign.id,

        // UI state (not persisted, not in temporal history)
        selectedId: null,
        snapGrid: 5,
        activeUnitId: _initialDesign.units[0]?.id ?? null,

        createProject: () => set(s => {
          const d = defaultDesign()
          d.name = `Cabinet ${s.projects.length + 1}`
          s.projects.push(d)
          s.activeProjectId = d.id
          s.activeUnitId = d.units[0]?.id ?? null
        }),

        deleteProject: (id) => set(s => {
          if (s.projects.length <= 1) return
          s.projects = s.projects.filter(p => p.id !== id)
          if (s.activeProjectId === id) {
            s.activeProjectId = s.projects[0]?.id ?? null
            s.activeUnitId = s.projects[0]?.units[0]?.id ?? null
          }
        }),

        renameProject: (id, name) => set(s => {
          const p = s.projects.find(proj => proj.id === id)
          if (p) p.name = name
        }),

        setActiveProject: (id) => set(s => {
          s.activeProjectId = id
          const proj = s.projects.find(p => p.id === id)
          s.activeUnitId = proj?.units[0]?.id ?? null
        }),

        updateSettings: (patch) => set(s => {
          const unit = findActiveUnit(s)
          if (unit) Object.assign(unit.settings, patch)
        }),

        addUnit: () => set(s => {
          const proj = activeDesign(s)
          if (!proj) return
          const rightmost = proj.units.reduce((max, u) => {
            const w = u.type === 'cabinet' ? u.settings.width : 0
            return Math.max(max, u.x + w)
          }, 0)
          const newUnitId = nanoid(8)
          const activeUnit = proj.units.find(u => u.id === s.activeUnitId)
          const baseSettings = activeUnit?.type === 'cabinet'
            ? activeUnit.settings
            : proj.units[0]?.type === 'cabinet' ? proj.units[0].settings : null
          const newUnit: CabinetSceneUnit = {
            type: 'cabinet',
            id: newUnitId,
            label: `Unit ${proj.units.length + 1}`,
            settings: baseSettings
              ? { ...baseSettings }
              : { unit: 'mm', height: 800, width: 600, depth: 500, thickness: 18, backThickness: 6, toeKick: null, defaultMaterial: 'oak' },
            root: { id: nanoid(8), elementType: 'void' },
            x: rightmost + 20,
            y: 0,
          }
          proj.units.push(newUnit)
          s.activeUnitId = newUnitId
        }),

        removeUnit: (unitId) => set(s => {
          const proj = activeDesign(s)
          if (!proj || proj.units.length <= 1) return
          if (s.activeUnitId === unitId) {
            const remaining = proj.units.filter(u => u.id !== unitId)
            s.activeUnitId = remaining[0]?.id ?? null
          }
          proj.units = proj.units.filter(u => u.id !== unitId)
        }),

        setActiveUnit: (unitId) => set(s => {
          s.activeUnitId = unitId
        }),

        renameUnit: (unitId, label) => set(s => {
          const proj = activeDesign(s)
          const unit = proj?.units.find(u => u.id === unitId)
          if (unit) unit.label = label
        }),

        updateUnitSettings: (unitId, patch) => set(s => {
          const proj = activeDesign(s)
          if (!proj) return
          const unit = proj.units.find(u => u.id === unitId)
          if (unit?.type === 'cabinet') Object.assign(unit.settings, patch)
        }),

        addShelf: (nodeId) => set(s => {
          mutateActiveUnit(s, u => ({ ...u, root: addShelf(u.root, nodeId) }))
        }),

        addDivider: (nodeId) => set(s => {
          mutateActiveUnit(s, u => ({ ...u, root: addDivider(u.root, nodeId) }))
        }),

        deleteBoard: (nodeId) => set(s => {
          const unit = findActiveUnit(s)
          if (!unit || unit.root.id === nodeId) return  // cannot delete root
          mutateActiveUnit(s, u => ({ ...u, root: deleteBoardFn(u.root, nodeId) }))
          if (s.selectedId === nodeId) s.selectedId = null
        }),

        setNodeSize: (nodeId, sizeMm) => set(s => {
          mutateActiveUnit(s, u => ({ ...u, root: setNodeSize(u.root, nodeId, sizeMm) }))
        }),

        unlockNode: (nodeId) => set(s => {
          mutateActiveUnit(s, u => ({ ...u, root: unlockNode(u.root, nodeId) }))
        }),

        setLocked: (nodeId, locked) => set(s => {
          mutateActiveUnit(s, u => ({ ...u, root: setLocked(u.root, nodeId, locked) }))
        }),

        setMaterial: (nodeId, material) => set(s => {
          mutateActiveUnit(s, u => ({ ...u, root: setMaterial(u.root, nodeId, material) }))
        }),

        setElementType: (nodeId, et) => set((s) => {
          mutateActiveUnit(s, u => ({ ...u, root: treeMutSetElementType(u.root, nodeId, et) }))
        }),

        setDrawerConfig: (nodeId, config) => set((s) => {
          mutateActiveUnit(s, u => ({ ...u, root: treeMutSetDrawerConfig(u.root, nodeId, config) }))
        }),

        // commitDrag: sets splitRatio on the parent node for proportional distribution
        commitDrag: (parentNodeId, ratio) => set(s => {
          mutateActiveUnit(s, u => ({ ...u, root: setSplitRatio(u.root, parentNodeId, ratio) }))
        }),

        addAccessory: (nodeId, accessory) => set((s) => {
          const unit = findActiveUnit(s)
          if (!unit) return
          mutateActiveUnit(s, u => ({ ...u, root: addAccessoryFn(u.root, nodeId, accessory) }))
        }),

        removeAccessory: (nodeId, accessoryId) => set((s) => {
          const unit = findActiveUnit(s)
          if (!unit) return
          mutateActiveUnit(s, u => ({ ...u, root: removeAccessoryFn(u.root, nodeId, accessoryId) }))
        }),

        importWorkspace: (incoming, mode) => {
          if (mode === 'replace') {
            set((s) => {
              s.projects = incoming
              s.activeProjectId = incoming[0]?.id ?? null
              s.activeUnitId = incoming[0]?.units[0]?.id ?? null
              s.selectedId = null
            })
            useStore.temporal.getState().clear()
          } else {
            set((s) => {
              const remapped = incoming.map((p) => ({ ...p, id: nanoid() }))
              s.projects.push(...remapped)
            })
          }
        },

        setSelectedId: (id) => set(s => { s.selectedId = id }),
        setSnapGrid: (mm) => set(s => { s.snapGrid = mm }),
      })),
      {
        name: 'buildbox-store',
        partialize: partializeProjectState,
        version: 1,
        migrate: (persisted: unknown, fromVersion: number) => {
          if (fromVersion === 0) {
            const old = persisted as {
              projects: Array<{ id: string; name: string; root: import('../types').CabinetNode; globalSettings: GlobalSettings }>
              activeProjectId: string | null
            }
            return {
              projects: old.projects.map(d => ({
                id: d.id,
                name: d.name,
                units: [{
                  type: 'cabinet' as const,
                  id: nanoid(8),
                  label: 'Unit 1',
                  settings: d.globalSettings,
                  root: d.root,
                  x: 0,
                  y: 0,
                }],
              })),
              activeProjectId: old.activeProjectId,
            }
          }
          return persisted
        },
        onRehydrateStorage: () => (state, error) => {
          if (!error && state) {
            useStore.temporal.getState().clear()
          }
        },
      },
    ),
    {
      partialize: partializeProjectState,
      equality: shallow,
    },
  ),
)

// Access temporal state: useStore.temporal.getState() or useStore.temporal.subscribe(...)
// Example in components: const { undo, redo } = useStore.temporal.getState()

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { shallow } from 'zustand/shallow'
import { temporal } from 'zundo'
import { nanoid } from 'nanoid'
import type { Design, GlobalSettings, MaterialId, DrawerConfig, UIState, ElementType } from '../types'
import { addShelf, addDivider, deleteBoard, setNodeSize, setLocked, setMaterial, setSplitRatio, unlockNode, setElementType as treeMutSetElementType, setDrawerConfig as treeMutSetDrawerConfig } from '../engine/treeMutations'

interface PersistedState {
  projects: Design[]
  activeProjectId: string | null
}

interface StoreState extends PersistedState, UIState {
  // project management
  createProject: () => void
  deleteProject: (id: string) => void
  renameProject: (id: string, name: string) => void
  setActiveProject: (id: string) => void

  // global settings
  updateSettings: (patch: Partial<GlobalSettings>) => void

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
  // NOTE: addAccessory / removeAccessory added in Task 17

  // UI (not persisted)
  setSelectedId: (id: string | null) => void
  setSnapGrid: (mm: number) => void
}

function defaultDesign(): Design {
  return {
    id: nanoid(),
    name: 'Cabinet 1',
    root: { id: nanoid(8), elementType: 'void' },
    globalSettings: {
      unit: 'mm',
      height: 800,
      width: 600,
      depth: 500,
      thickness: 18,
      backThickness: 6,
      toeKick: null,
      defaultMaterial: 'oak',
    },
  }
}

function activeDesign(state: PersistedState): Design | undefined {
  return state.projects.find((p) => p.id === state.activeProjectId)
}

function mutateRoot(state: PersistedState, fn: (d: Design) => Design): void {
  const idx = state.projects.findIndex((p) => p.id === state.activeProjectId)
  if (idx === -1) return
  state.projects[idx] = fn(state.projects[idx])
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

        createProject: () => set(s => {
          const d = defaultDesign()
          d.name = `Cabinet ${s.projects.length + 1}`
          s.projects.push(d)
          s.activeProjectId = d.id
        }),

        deleteProject: (id) => set(s => {
          s.projects = s.projects.filter(p => p.id !== id)
          if (s.activeProjectId === id) {
            s.activeProjectId = s.projects[0]?.id ?? null
          }
        }),

        renameProject: (id, name) => set(s => {
          const p = s.projects.find(proj => proj.id === id)
          if (p) p.name = name
        }),

        setActiveProject: (id) => set(s => { s.activeProjectId = id }),

        updateSettings: (patch) => set(s => {
          const d = activeDesign(s)
          if (d) Object.assign(d.globalSettings, patch)
        }),

        addShelf: (nodeId) => set(s => {
          mutateRoot(s, d => ({ ...d, root: addShelf(d.root, nodeId) }))
        }),

        addDivider: (nodeId) => set(s => {
          mutateRoot(s, d => ({ ...d, root: addDivider(d.root, nodeId) }))
        }),

        deleteBoard: (nodeId) => set(s => {
          mutateRoot(s, d => ({ ...d, root: deleteBoard(d.root, nodeId) }))
          s.selectedId = null
        }),

        setNodeSize: (nodeId, sizeMm) => set(s => {
          mutateRoot(s, d => ({ ...d, root: setNodeSize(d.root, nodeId, sizeMm) }))
        }),

        unlockNode: (nodeId) => set(s => {
          mutateRoot(s, d => ({ ...d, root: unlockNode(d.root, nodeId) }))
        }),

        setLocked: (nodeId, locked) => set(s => {
          mutateRoot(s, d => ({ ...d, root: setLocked(d.root, nodeId, locked) }))
        }),

        setMaterial: (nodeId, material) => set(s => {
          mutateRoot(s, d => ({ ...d, root: setMaterial(d.root, nodeId, material) }))
        }),

        setElementType: (nodeId, et) => set((s) => {
          mutateRoot(s, (d) => ({ ...d, root: treeMutSetElementType(d.root, nodeId, et) }))
        }),

        setDrawerConfig: (nodeId, config) => set((s) => {
          mutateRoot(s, (d) => ({ ...d, root: treeMutSetDrawerConfig(d.root, nodeId, config) }))
        }),

        // commitDrag: sets splitRatio on the parent node for proportional distribution
        commitDrag: (parentNodeId, ratio) => set(s => {
          mutateRoot(s, d => ({
            ...d,
            root: setSplitRatio(d.root, parentNodeId, ratio),
          }))
        }),

        setSelectedId: (id) => set(s => { s.selectedId = id }),
        setSnapGrid: (mm) => set(s => { s.snapGrid = mm }),

        // NOTE: addAccessory / removeAccessory added in Task 17
      })),
      {
        name: 'buildbox-store',
        partialize: partializeProjectState,
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

/**
 * The Floor workspace's own UI state (#55) — tool, selection, drag preview, viewports,
 * rail drawer. Like `uiStore` before it, none of this is Project data or history: undo
 * must never move a viewport or change a selection. It is a module singleton because
 * there is one workspace on screen at a time, and it lives beside the legacy store
 * rather than inside it so the Plan View can grow without touching the cabinet chrome.
 */
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { useShallow } from 'zustand/react/shallow'
import type { Viewport } from './viewport'

export type WorkspaceTool = 'select' | 'pan'

/** The live drag: the Item being moved and where its top-left is going, in mm. */
export interface ItemDragPreview {
  readonly id: string
  readonly x: number
  readonly y: number
}

export interface WorkspaceState {
  activeTool: WorkspaceTool
  /** The selected Placed Item, or `null`. Selection is UI state, never Project data. */
  selection: string | null
  dragPreview: ItemDragPreview | null
  /** The last viewport per view key, in memory for this tab; the cache persists it. */
  viewports: Record<string, Viewport>
  /** View keys whose device-local cache entry has already been read this session. */
  hydrated: Record<string, boolean>
  /** The rail as a drawer below 1024 px (#55 criterion 4). */
  railOpen: boolean
  /**
   * The Floor the Plan View is open on (#56). A pointer, not an owner: it selects which
   * Floor's entities are drawn, and nothing else in the app holds a Floor (#25).
   */
  activeFloorId: string | null
  /** The last Plan View used on each Floor, keyed by Floor id (#56). */
  activeViewByFloor: Record<string, string>
  /** Whether this Project's open Floor and views have been read from the cache yet. */
  activeHydrated: boolean
}

export interface WorkspaceActions {
  setTool(tool: WorkspaceTool): void
  select(id: string | null): void
  setDragPreview(preview: ItemDragPreview | null): void
  setViewport(viewKey: string, viewport: Viewport): void
  markHydrated(viewKey: string): void
  setRailOpen(open: boolean): void
  /** Open a Floor, remembering it as the last view used on it. */
  setActiveFloor(floorId: string | null, viewId: string | null): void
  /** The view the person picked inside the Floor already open. */
  setActiveView(floorId: string, viewId: string): void
  /** The cache's answer for this Project: which Floor was open, and the views on each. */
  hydrateActive(floorId: string | null, viewsByFloor: Record<string, string>): void
  /** Another Project opened: its placements are not this one's to select. */
  reset(): void
}

export type WorkspaceSnapshot = WorkspaceState & WorkspaceActions

const INITIAL: WorkspaceState = {
  activeTool: 'select',
  selection: null,
  dragPreview: null,
  viewports: {},
  hydrated: {},
  railOpen: false,
  activeFloorId: null,
  activeViewByFloor: {},
  activeHydrated: false,
}

export const workspaceStore = createStore<WorkspaceSnapshot>()((set) => ({
  ...INITIAL,
  setTool: (activeTool) => set({ activeTool }),
  select: (selection) => set({ selection }),
  setDragPreview: (dragPreview) => set({ dragPreview }),
  setViewport: (viewKey, viewport) =>
    set((state) => ({ viewports: { ...state.viewports, [viewKey]: viewport } })),
  markHydrated: (viewKey) =>
    set((state) => ({ hydrated: { ...state.hydrated, [viewKey]: true } })),
  setRailOpen: (railOpen) => set({ railOpen }),
  setActiveFloor: (activeFloorId, viewId) =>
    set((state) => ({
      activeFloorId,
      selection: null,
      activeViewByFloor:
        activeFloorId === null || viewId === null
          ? state.activeViewByFloor
          : { ...state.activeViewByFloor, [activeFloorId]: viewId },
    })),
  setActiveView: (floorId, viewId) =>
    set((state) => ({
      selection: null,
      activeViewByFloor: { ...state.activeViewByFloor, [floorId]: viewId },
    })),
  hydrateActive: (activeFloorId, viewsByFloor) =>
    set((state) => ({
      activeFloorId: state.activeFloorId ?? activeFloorId,
      activeViewByFloor: { ...viewsByFloor, ...state.activeViewByFloor },
      activeHydrated: true,
    })),
  reset: () => set({ ...INITIAL }),
}))

export function useWorkspace<T>(selector: (state: WorkspaceSnapshot) => T): T {
  return useStore(workspaceStore, useShallow(selector))
}

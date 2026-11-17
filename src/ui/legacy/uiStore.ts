/**
 * The UI state that is not project data (#49, #20 §10).
 *
 * Which module is showing, which tool is armed, the floor-plan drag preview. None of it
 * belongs in a Project — a Project records what the user designed, not which tab they were
 * looking at — and none of it belongs in the session's history, because undo must not switch
 * modules. The flag-off bindings read the same fields out of the legacy store instead, so
 * that turning the flag off leaves the old app byte for byte.
 *
 * It is a module singleton because there is exactly one legacy view on screen at a time.
 */
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { useShallow } from 'zustand/react/shallow'
import type { AnnotationType, AppModule } from '../../types'
import type { PlanObjectPatch } from '../legacy/bindings'

/** The live preview of a floor-plan drag: the object being moved and where it is going. */
export interface DragPreview {
  readonly id: string
  readonly patch: PlanObjectPatch
}

export interface UiState {
  activeModule: AppModule
  /** The cabinet the sidebar edits: an Item Design id, or `null` for the first one. */
  activeItemDesignId: string | null
  selectedNodeId: string | null
  snapGrid: number
  floorPlanSelectedId: string | null
  tool: AnnotationType | null
  dragPreview: DragPreview | null
}

export interface UiActions {
  setActiveModule(module: AppModule): void
  setActiveItemDesign(id: string | null): void
  selectNode(id: string | null): void
  setSnapGrid(grid: number): void
  selectFloorPlanObject(id: string | null): void
  setTool(tool: AnnotationType): void
  setDragPreview(preview: DragPreview | null): void
  reset(): void
}

export type UiSnapshot = UiState & UiActions

const INITIAL: UiState = {
  activeModule: 'cabinet',
  activeItemDesignId: null,
  selectedNodeId: null,
  snapGrid: 5,
  floorPlanSelectedId: null,
  tool: 'wall-hack',
  dragPreview: null,
}

export function createUiStore() {
  return createStore<UiState & UiActions>()((set) => ({
    ...INITIAL,
    setActiveModule: (activeModule) => set({ activeModule }),
    setActiveItemDesign: (activeItemDesignId) => set({ activeItemDesignId }),
    selectNode: (selectedNodeId) => set({ selectedNodeId }),
    setSnapGrid: (snapGrid) => set({ snapGrid }),
    selectFloorPlanObject: (floorPlanSelectedId) => set({ floorPlanSelectedId }),
    setTool: (tool) => set({ tool }),
    setDragPreview: (dragPreview) => set({ dragPreview }),
    reset: () => set({ ...INITIAL }),
  }))
}

export const uiStore = createUiStore()

/**
 * One selector against the UI store, shallow-compared so an inline selection of several
 * fields does not re-render on every keystroke.
 */
export function useUi<T>(select: (state: UiSnapshot) => T): T {
  return useStore(uiStore, useShallow(select))
}

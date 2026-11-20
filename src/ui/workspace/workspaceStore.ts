/**
 * The Floor workspace's own UI state (#55, #57) — tool, selection, drag preview, angle snap,
 * the pending design preview, Item Detail, viewports, rail drawer. Like `uiStore` before it,
 * none of this is Project data or history: undo must never move a viewport, change a
 * selection, or undo a navigation. It is a module singleton because there is one workspace on
 * screen at a time, and it lives beside the legacy store rather than inside it so the Plan
 * View can grow without touching the cabinet chrome.
 */
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { useShallow } from 'zustand/react/shallow'
import { enabledSnapKinds } from '../../derive'
import type { SnapKind } from '../../derive'
import type { ItemFootprint, Point2 } from '../../domain'
import type { ShapeDraft } from './shape/proposal'
import type { Viewport } from './viewport'

/**
 * The tools the toolbar registry knows about (#55, #59).
 *
 * The three drawing tools are registered here because the registry is the one place that
 * says which tools measure geometry and must therefore wait for a calibrated Floor (#56).
 * The Floor workspace does not offer them yet — a Custom Path has no Room target until #67 —
 * so only the Item Design editor renders them, and they are still gated by the same rule.
 */
export type WorkspaceTool = 'select' | 'pan' | 'wall' | 'line' | 'arc' | 'ellipticalArc'

/**
 * The live drag: the Item being moved and where its Item Origin is going, in Floor
 * millimetres. The Origin rather than the top-left, because the Origin is what a placement
 * owns (#57) — the drawn box is derived from it, so a preview that carried a corner would
 * have to redo that derivation to draw the same box the model describes.
 */
export interface ItemDragPreview {
  readonly id: string
  readonly x: number
  readonly y: number
}

/** One angle-snap setting (#57). #59 exposes these in `Snaps ▾`; there is only this state. */
export interface AngleSnap {
  readonly enabled: boolean
  readonly incrementDeg: number
}

/**
 * The eight `Snaps ▾` rows that are a plain on/off, named by the row that edits them.
 *
 * `angle` is absent because it carries an increment as well as a switch, and it is the one
 * piece of snapping #57 already had — the rotate handle reads the very same value.
 */
export type SnapToggle =
  | 'grid'
  | 'endpoints'
  | 'centres'
  | 'intersections'
  | 'wallFaces'
  | 'axis'
  | 'perpendicular'
  | 'tangent'

/**
 * The nine object-snap rows (#59 §5, behaviours 22–25).
 *
 * This is **UI-session state**: device-local, never undoable, never in a Backup and never in
 * the Project (#20 §7, #26). A snap writes coordinates and leaves no relationship behind, so
 * what is switched on today cannot change what a shape drawn last week means tomorrow.
 */
export interface SnapSettings {
  grid: boolean
  /** 10 / 50 / 100 / 500 mm; 100 is the default the issue sets. */
  gridSpacingMm: number
  endpoints: boolean
  centres: boolean
  intersections: boolean
  /** Enabled from the start, but it yields nothing until #64 gives Walls faces (#59 §5). */
  wallFaces: boolean
  axis: boolean
  angle: AngleSnap
  perpendicular: boolean
  tangent: boolean
}

/**
 * What is selected in the Edges tab (#59 §3, §4).
 *
 * An edge opens its editor; a vertex opens `Corner radius`. They are mutually exclusive
 * because the two editors answer different questions about the same corner, and a row that
 * was both would have to show both.
 */
export type ShapeSelection = { readonly edge: number } | { readonly vertex: number } | null

/**
 * The kinds the nine rows currently switch on, for `resolveSnap` (#59 §5).
 *
 * The one place the rows are translated into kinds, so the Item Design editor and the Floor
 * canvas cannot drift into honouring different subsets of the same panel. `Angle` carries an
 * increment as well as a switch; only the switch decides whether the kind is offered.
 */
export const enabledKindsOf = (settings: SnapSettings): Set<SnapKind> =>
  enabledSnapKinds({
    grid: settings.grid,
    endpoints: settings.endpoints,
    centres: settings.centres,
    intersections: settings.intersections,
    wallFaces: settings.wallFaces,
    axis: settings.axis,
    angle: settings.angle.enabled,
    perpendicular: settings.perpendicular,
    tangent: settings.tangent,
  })

/**
 * A design edit awaiting `Apply` (D3). The values are the ones about to be written to the
 * Item Design; the canvas draws them on every placement of that design on the current Floor
 * so the person sees the blast radius before committing. Nothing here has touched the
 * Project: `Apply` dispatches the Intent, `Cancel` and Esc drop this and change nothing.
 */
export interface DesignEditPreview {
  readonly itemDesignId: string
  /** The pending Item Origin, footprint-local millimetres. Footprints do not move. */
  readonly origin: Point2 | null
  /** The pending Item Design name, for a rename that reaches every placement. */
  readonly name: string | null
  /** The pending Item Footprint, for a shape change that reaches every placement (#58). */
  readonly footprint: ItemFootprint | null
  /** The pending colour, for a colour preview. */
  readonly color: string | null
}

/** Where Item Detail was opened from, so `← Back` returns to exactly that (#57). */
export interface ItemDetailReturn {
  readonly floorId: string
  readonly viewId: string | null
  readonly placedItemId: string
}

/** The Item Detail View being read: an Item Design, and the way back to it. */
export interface ItemDetailState {
  readonly itemDesignId: string
  readonly from: ItemDetailReturn
}

/** Which of Item Detail's three rail tabs is open (#58 §3). */
export type ShapeTab = 'shape' | 'edges' | 'measurements'

/**
 * The shape editor's transient draft (#58 §Notes).
 *
 * A proposal is UI-session state and nothing else: it is never in the Project snapshot, never
 * in history, and never survives leaving Item Detail. Keyed by Item Design so a second design
 * opened without leaving the page cannot inherit the first one's half-typed shape.
 */
export interface ShapeDraftState {
  readonly itemDesignId: string
  readonly draft: ShapeDraft
}

export interface WorkspaceState {
  activeTool: WorkspaceTool
  /** The selected Placed Item, or `null`. Selection is UI state, never Project data. */
  selection: string | null
  /**
   * The selected Wall (#64 §15), or `null`. A separate slot rather than one union because
   * every existing reader of `selection` means a Placed Item, and a Wall is a different kind
   * of thing to draw handles on and a different kind of thing to inspect.
   */
  wallSelection: string | null
  dragPreview: ItemDragPreview | null
  /** The nine `Snaps ▾` rows (#59 §5); `angle` is the same state the rotate handle reads (#57). */
  snapSettings: SnapSettings
  /** What the Edges tab has selected: one Edge, one vertex, or nothing (#59 §3, §4). */
  shapeSelection: ShapeSelection
  /**
   * The design edit awaiting `Apply` (D3), or `null`. One at a time: a second choice
   * replaces the pending one rather than stacking previews.
   */
  designPreview: DesignEditPreview | null
  /**
   * `Pick on canvas` is armed: the next click on the selected placement sets the Item Origin
   * preview rather than selecting anything (#57 §5).
   */
  pickingOrigin: boolean
  /** The Item Detail View on screen, or `null` for the Floor workspace (#57 §6). */
  itemDetail: ItemDetailState | null
  /** The shape editor's proposal, or `null` while nothing is being drafted (#58 §6). */
  shapeDraft: ShapeDraftState | null
  /** Item Detail's open rail tab (#58 §3). */
  shapeTab: ShapeTab
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
  /** Select a Wall (#64 §15); selecting one drops the Placed Item selection and vice versa. */
  selectWall(id: string | null): void
  setDragPreview(preview: ItemDragPreview | null): void
  setAngleSnap(enabled: boolean, incrementDeg?: number): void
  /** One `Snaps ▾` checkbox (#59 §5). UI-session state, never undoable (#26). */
  setSnapEnabled(toggle: SnapToggle, enabled: boolean): void
  /** The `Grid` row's spacing select: 10 / 50 / 100 / 500 mm. */
  setGridSpacing(spacingMm: number): void
  /** What the Edges tab has selected. Choosing an Edge drops the vertex and the other way about. */
  setShapeSelection(selection: ShapeSelection): void
  /** Arm or disarm `Pick on canvas`; arming drops any other pending preview. */
  setPickingOrigin(picking: boolean): void
  /** The pending design edit, or `null` to drop it. */
  setDesignPreview(preview: DesignEditPreview | null): void
  /** Open the Item Detail View of one Item Design. Navigation, never history (#26). */
  openItemDetail(itemDesignId: string, from: ItemDetailReturn): void
  /** Back to the Floor, the view and the Placed Item Item Detail came from. */
  closeItemDetail(): void
  /** Put a shape proposal on screen for one Item Design; `null` discards it (#58 §6). */
  setShapeDraft(itemDesignId: string, draft: ShapeDraft | null): void
  /** Item Detail's rail tab. Navigation, never history (#26). */
  setShapeTab(shapeTab: ShapeTab): void
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
  wallSelection: null,
  dragPreview: null,
  snapSettings: {
    // All nine are on by default (#59 §5). `wallFaces` is on but silent until #64 gives it
    // a source, which is what lets #64 add a candidate source without touching this UI.
    grid: true,
    gridSpacingMm: 100,
    endpoints: true,
    centres: true,
    intersections: true,
    wallFaces: true,
    axis: true,
    angle: { enabled: true, incrementDeg: 15 },
    perpendicular: true,
    tangent: true,
  },
  shapeSelection: null,
  designPreview: null,
  pickingOrigin: false,
  itemDetail: null,
  shapeDraft: null,
  shapeTab: 'shape',
  viewports: {},
  hydrated: {},
  railOpen: false,
  activeFloorId: null,
  activeViewByFloor: {},
  activeHydrated: false,
}

/**
 * The part of a Floor/view move that touches the selection: nothing selected and nothing
 * proposed when the pair being opened is not the one already open, and nothing at all when it
 * is. A proposal belongs to the thing it was made on, so it goes wherever the selection goes —
 * criterion 9's "selecting something else" arrives here too when that something else is on
 * another Floor.
 */
function movedAway(
  state: WorkspaceSnapshot,
  floorId: string | null,
  viewsByFloor: Record<string, string>,
): { selection: null; wallSelection: null; shapeDraft: null; shapeSelection: null } | Record<string, never> {
  if (floorId === null || floorId !== state.activeFloorId) {
    return { selection: null, wallSelection: null, shapeDraft: null, shapeSelection: null }
  }
  return viewsByFloor[floorId] === state.activeViewByFloor[floorId]
    ? {}
    : { selection: null, wallSelection: null, shapeDraft: null, shapeSelection: null }
}

export const workspaceStore = createStore<WorkspaceSnapshot>()((set) => ({
  ...INITIAL,
  setTool: (activeTool) => set({ activeTool }),
  // A proposal is about the thing selected, so a new selection ends it (#58 criterion 9). It is
  // discarded rather than kept out of sight: coming back to the design must show the shape it
  // has, not a half-typed one that a later Apply could write.
  select: (selection) => set({ selection, wallSelection: null, shapeDraft: null, shapeSelection: null }),
  selectWall: (wallSelection) => set({ wallSelection, selection: null, shapeDraft: null, shapeSelection: null }),
  setDragPreview: (dragPreview) => set({ dragPreview }),
  setAngleSnap: (enabled, incrementDeg) =>
    set((state) => ({
      snapSettings: {
        ...state.snapSettings,
        angle: {
          enabled,
          incrementDeg: incrementDeg ?? state.snapSettings.angle.incrementDeg,
        },
      },
    })),
  setSnapEnabled: (toggle, enabled) =>
    set((state) => {
      const snapSettings: SnapSettings = { ...state.snapSettings }
      snapSettings[toggle] = enabled
      return { snapSettings }
    }),
  setGridSpacing: (gridSpacingMm) =>
    set((state) => ({ snapSettings: { ...state.snapSettings, gridSpacingMm } })),
  setShapeSelection: (shapeSelection) => set({ shapeSelection }),
  // Arming the pick drops a pending size or colour preview: one edit is in flight at a time,
  // and `Apply` would otherwise write the outline the person has stopped looking at.
  setPickingOrigin: (pickingOrigin) =>
    set(pickingOrigin ? { pickingOrigin, designPreview: null } : { pickingOrigin }),
  setDesignPreview: (designPreview) => set({ designPreview }),
  openItemDetail: (itemDesignId, from) => set({ itemDetail: { itemDesignId, from } }),
  // Leaving Item Detail takes the draft with it: a proposal is not something to come back to,
  // and a shape that failed validation must not be waiting on the next design opened.
  closeItemDetail: () => set({ itemDetail: null, shapeDraft: null, shapeSelection: null }),
  setShapeDraft: (itemDesignId, draft) =>
    set({ shapeDraft: draft === null ? null : { itemDesignId, draft } }),
  setShapeTab: (shapeTab) => set({ shapeTab }),
  setViewport: (viewKey, viewport) =>
    set((state) => ({ viewports: { ...state.viewports, [viewKey]: viewport } })),
  markHydrated: (viewKey) =>
    set((state) => ({ hydrated: { ...state.hydrated, [viewKey]: true } })),
  setRailOpen: (railOpen) => set({ railOpen }),
  // A selection belongs to the Floor and Plan View it was made on, so moving to another pair
  // drops it. Arriving back at the pair already open keeps it: undo and redo navigate to the
  // very item they touched (#26), and a selection that vanished on Undo could not be edited
  // back to what it was.
  setActiveFloor: (activeFloorId, viewId) =>
    set((state) => {
      const activeViewByFloor =
        activeFloorId === null || viewId === null
          ? state.activeViewByFloor
          : { ...state.activeViewByFloor, [activeFloorId]: viewId }
      return {
        activeFloorId,
        activeViewByFloor,
        ...movedAway(state, activeFloorId, activeViewByFloor),
      }
    }),
  setActiveView: (floorId, viewId) =>
    set((state) => ({
      activeViewByFloor: { ...state.activeViewByFloor, [floorId]: viewId },
      ...movedAway(state, state.activeFloorId, { ...state.activeViewByFloor, [floorId]: viewId }),
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

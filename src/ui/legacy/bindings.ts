/**
 * The one seam between the legacy views and whatever holds their state (#49, #20 §10).
 *
 * Seven components used to read the global store directly. They now read this interface out
 * of React context, and nothing else. Two implementations satisfy it: `storeBindings` wraps
 * today's Zustand store and is what the flag-off app installs, `sessionBindings` is built on
 * a Project session and exists only in the flagged chunk. Because neither is imported by the
 * components, the flagged graph never pulls in the legacy store — and the legacy store's
 * `persist` middleware never touches `buildbox-store` in a flag-on build (#49 criterion 8).
 *
 * **A capability this app does not have is an absent callback, not a boolean.** #49 hides the
 * workspace-JSON controls and the sketch tools under the flag; the components render those
 * controls when the callback is there, so the deviation is one fact in one place rather than
 * a flag check in three.
 */
import { createContext, useContext } from 'react'
import type { CabinetUnit } from '../../cabinet'
import type {
  AccessoryType,
  PlanImageMediaType,
  CabinetMaterialId,
  DrawerConfig,
  ElementType,
  GlobalSettings,
} from '../../domain'
import type {
  Annotation,
  AnnotationType,
  AppModule,
  CustomTemplate,
  Design,
  FloorPlanData,
  FloorPlanObject,
  FloorPlanObjectType,
} from '../../types'

/** What a floor-plan edit changes about one placed object. `x`/`y` are top-left, Plan Space. */
export type PlanObjectPatch = Omit<Partial<FloorPlanObject>, 'id'>

/** One tab in the project bar: the legacy view needs nothing more from a Project. */
export interface ProjectTab {
  readonly id: string
  readonly name: string
}

/** The toolbar's save status (#14). `null` where there is no save state to be truthful about. */
export interface SaveStatusText {
  readonly text: string
  /** `Save failed` is the one red state (#49 deviation 3). */
  readonly failed: boolean
}

/**
 * An uploaded Plan Image, ready to become the Floor's Plan Image.
 *
 * `src` is what the `<img>` shows immediately. `asset` is present only where there is an
 * Asset Store to write to: the legacy path has no hash and no bytes to keep, and #49 does
 * not retrofit one.
 */
export interface PreparedPlanImage {
  readonly src: string
  readonly widthPx: number
  readonly heightPx: number
  readonly asset: PlanImageAsset | null
}

/** The bytes an Asset Store would keep: the same picture, keyed by its own hash. */
export interface PlanImageAsset {
  readonly bytes: Blob
  readonly sha256: string
  readonly mediaType: PlanImageMediaType
  readonly widthPx: number
  readonly heightPx: number
}

/** An upload that could not be used, in the words the floor plan has always used. */
export type PlanImageRead = { readonly image: PreparedPlanImage } | { readonly message: string }

/** A whole workspace, as the toolbar's Export writes it and its Import reads it back. */
export interface WorkspaceJson {
  readonly projects: Design[]
  readonly activeProjectId: string | null
}

/** The workspace JSON the toolbar exports and imports (#49 deviation 2). */
export interface LegacyWorkspace extends WorkspaceJson {
  onImport(incoming: WorkspaceJson, mode: 'replace' | 'merge'): void
}

export interface LegacyBindings {
  // ---------------------------------------------------------------- the project
  readonly projects: ProjectTab[]
  readonly activeProjectId: string | null
  readonly activeProjectName: string
  selectProject(id: string): void
  createProject(): void
  deleteProject(id: string): void
  /**
   * The workspace JSON the toolbar exports and imports. Absent under the flag: the format
   * that reads a whole workspace at once is #50's, and the toolbar draws neither control
   * without it (#49 deviation 2).
   */
  readonly workspace?: LegacyWorkspace
  readonly saveStatus: SaveStatusText | null
  /**
   * Reopen the Save failed dialog from the red status (#51 §2, criterion 10).
   *
   * The dialog belongs to the composition, not to the editor, and the legacy store has no session
   * that can fail — so this is absent rather than a no-op, and a status with nowhere to go stays
   * the plain text it always was.
   */
  readonly reopenSaveFailure?: () => void

  // ---------------------------------------------------------------- history
  readonly canUndo: boolean
  readonly canRedo: boolean
  undo(): void
  redo(): void

  // ---------------------------------------------------------------- cabinet view
  readonly units: CabinetUnit[]
  readonly activeItemDesignId: string | null
  setActiveItemDesign(id: string | null): void
  readonly selectedNodeId: string | null
  selectNode(id: string | null): void
  readonly snapGrid: number
  updateUnitSettings(itemDesignId: string, patch: Partial<GlobalSettings>): void
  setCabinetMaterial(material: CabinetMaterialId): void
  addUnit(): void
  removeUnit(itemDesignId: string): void
  renameUnit(itemDesignId: string, name: string): void
  addShelf(nodeId: string): void
  addDivider(nodeId: string): void
  deleteBoard(nodeId: string): void
  setNodeSize(nodeId: string, sizeMm: number): void
  pinNode(nodeId: string, sizeMm: number): void
  unpinNode(nodeId: string): void
  unlockNode(nodeId: string): void
  setNodeLabel(nodeId: string, label: string): void
  distributeEvenly(columnRootId: string, evenH: number): void
  setElementType(nodeId: string, elementType: ElementType): void
  setDrawerConfig(nodeId: string, config: DrawerConfig): void
  addAccessory(nodeId: string, type: AccessoryType): void
  removeAccessory(nodeId: string, accessoryId: string): void
  /** One proportional drag, committed once on pointer-up (#26). */
  commitDrag(parentNodeId: string, ratio: number): void

  // ---------------------------------------------------------------- floor-plan view
  readonly floorPlan: FloorPlanData
  readonly floorPlanSelectedId: string | null
  selectFloorPlanObject(id: string | null): void
  addFloorPlanObject(catalogKey: FloorPlanObjectType): void
  addFloorPlanFromTemplate(templateId: string): void
  addCustomTemplate(template: Omit<CustomTemplate, 'id'>): void
  /** A discrete edit: one step in history (#26). */
  updateFloorPlanObject(id: string, patch: PlanObjectPatch): void
  /** A live drag step: transient, never a history entry on its own (#26). */
  dragFloorPlanObject(id: string, patch: PlanObjectPatch): void
  /** Pointer-up: turns the live preview into the one edit the drag was. */
  endFloorPlanDrag(id: string): void
  removeFloorPlanObject(id: string): void
  setFloorPlanScale(pixelsPerMm: number): void
  clearFloorPlan(): void
  /** Absent under the flag: domain v1 has no home for sketch annotations (#49 deviation 1). */
  addAnnotation?: (annotation: Annotation) => void
  /** What the file input accepts; #49 deviation 4 narrows it to PNG, JPEG and WebP. */
  readonly planImageAccept: string
  readPlanImage(file: File): Promise<PlanImageRead>
  setPlanImage(image: PreparedPlanImage, options: { clearExisting: boolean }): void

  // ---------------------------------------------------------------- tool
  readonly tool: AnnotationType | null
  setTool(tool: AnnotationType | null): void
  readonly activeModule: AppModule
  setActiveModule(module: AppModule): void
}

export const LegacyBindingsContext = createContext<LegacyBindings | null>(null)

/**
 * The bindings the view is running on.
 *
 * A missing provider is a wiring bug: the flagged app has no fallback, because falling back
 * to the legacy store there would silently write `buildbox-store` again.
 */
export function useLegacyBindings(): LegacyBindings {
  const bindings = useContext(LegacyBindingsContext)
  if (bindings === null) throw new Error('LegacyBindings is missing: render this inside <LegacyViewRoot>')
  return bindings
}

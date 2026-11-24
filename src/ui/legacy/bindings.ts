/**
 * The one seam between the legacy views and the Project session that holds their state
 * (#49, #20 §10).
 *
 * The remaining legacy components read this interface out of React context, and nothing
 * else. Its only implementation is `sessionBindings`, built on a Project session: the
 * legacy Zustand store went with the S4 cutover, so nothing in this graph can write
 * `buildbox-store` any more (#53 criterion 1).
 *
 * The floor-plan half of this interface left with #55: the Plan View is now the Floor
 * workspace (`src/ui/workspace`), which talks to the session directly and never through
 * here.
 */
import { createContext, useContext } from 'react'
import type { CabinetUnit } from '../../cabinet'
import type {
  AccessoryType,
  CabinetMaterialId,
  CommentAnchor,
  DrawerConfig,
  ElementType,
  GlobalSettings,
} from '../../domain'

/** The toolbar's save status (#14). `null` where there is no save state to be truthful about. */
export interface SaveStatusText {
  readonly text: string
  /** `Save failed` is the one red state (#49 deviation 3). */
  readonly failed: boolean
}

export interface LegacyBindings {
  // ---------------------------------------------------------------- the project
  readonly activeProjectName: string
  /**
   * Back to the Project Library, which is where another Project is chosen (#53). The editor
   * has no Project switcher of its own: a session holds one Project's locks and undo stack,
   * so switching means leaving this one.
   */
  returnToProjects(): void
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
  /**
   * A Comment anchored where the person clicked in the cabinet editor (#80 §12): a node makes a
   * feature Comment about that node, empty canvas makes one about the Item Design as a whole.
   */
  createComment(anchor: CommentAnchor): void
  setNodeLabel(nodeId: string, label: string): void
  distributeEvenly(columnRootId: string, evenH: number): void
  setElementType(nodeId: string, elementType: ElementType): void
  setDrawerConfig(nodeId: string, config: DrawerConfig): void
  addAccessory(nodeId: string, type: AccessoryType): void
  removeAccessory(nodeId: string, accessoryId: string): void
  /** One proportional drag, committed once on pointer-up (#26). */
  commitDrag(parentNodeId: string, ratio: number): void
}

export const LegacyBindingsContext = createContext<LegacyBindings | null>(null)

/**
 * The bindings the view is running on.
 *
 * A missing provider is a wiring bug: there is no fallback, because the app has no other
 * place its state could come from.
 */
export function useLegacyBindings(): LegacyBindings {
  const bindings = useContext(LegacyBindingsContext)
  if (bindings === null) throw new Error('LegacyBindings is missing: render this inside <LegacyViewRoot>')
  return bindings
}

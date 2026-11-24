/**
 * `LegacyBindings` over a Project session (#49).
 *
 * Every callback here builds one Intent and dispatches it — nothing else writes. That is what
 * makes the flagged app's history, persistence and multi-tab rules fall out for free: one
 * drag is one Intent, so it is one undo step and one commit; a refused Intent changes
 * nothing; a second tab is refused by the session's lock rather than by a check added here.
 *
 * Two things the legacy components did themselves move *in* here, because a session does not
 * mint ids or labels for a caller:
 *
 * - **Ids and labels** come from `IntentBuilder`, which `app` implements from the `edit`
 *   catalogue. The view says which Intent it wants and what happened; it never spells out a
 *   label or guesses how many ids that Intent needs (#20 §2 keeps `edit` values out of `ui`).
 * - **Selection** lives in the UI store, not the Project: switching Projects leaves an empty
 *   history and nothing selected, because a Project's document never held either.
 *
 * The floor-plan half left with #55: the Plan View is the Floor workspace
 * (`src/ui/workspace`), which builds its own Intents against the same session.
 */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { CabinetMaterialId, DrawerConfig, ElementType, EntityId, GlobalSettings, PlanView, Project } from '../../domain'
import type { CopySet, DependencyReview, Intent, IntentType, PayloadOf } from '../../edit'
import type { ProjectSession, SaveState, SessionAsset } from '../../session'
import { useProject, useProjectSelector, useSession } from './useProject'
import { STRINGS } from '..'
import { useUi } from './uiStore'
import type { LegacyBindings } from './bindings'
import { projectUnits } from './projectView'

/**
 * An Intent, fully formed. `app` builds it: the label table and the per-Intent id order are
 * `edit`'s, and only `app` may read them as values.
 */
export interface IntentBuilder {
  /**
   * The transaction the caller wants on the record. `label` overrides the catalogue's default — the
   * undo tooltip reads that string — for the few Intents whose default cannot name what was chosen:
   * `Set Design Option: Option A · Open kitchen` and `Set Renovation Display: Combined` (#70 §2).
   * The words are `ui/strings` copy and the name is Project data, so only the caller can compose
   * them; every other caller leaves `label` out and gets `intentLabel(type)`.
   */
  build<T extends IntentType>(type: T, payload: PayloadOf<T>, label?: string): Intent
  /**
   * What an Intent would take with it, without applying it (#65 §8). The delete of a Wall with
   * Openings has to be answered before it runs, and the answer is the same report the Intent
   * itself consults — so the question is asked of `app`, which is the only place `edit`'s values
   * may be read.
   */
  preview(project: Project, intent: Intent): { review: DependencyReview | null }
  /**
   * What one Intent would make of the Project, without committing it, with the Design Options set
   * aside (#70 §7a): the workspace asks it what an edit of an Existing entity would have done to the
   * record, so a successor can carry the geometry the person was dragging toward. `null` when the
   * edit does not land. Nothing is written.
   */
  evaluate(project: Project, intent: Intent): Project | null
  /**
   * The Copy Set of `selection` as this saved view draws it (#72 §4) — the snapshot `Copy` hands the
   * tab's clipboard, and the reason a copy writes nothing: no Intent runs, no revision moves.
   * `captureCopySet` is an `edit` value, so it is read here, where `edit` may be read. `null` when
   * the selection brings nothing across.
   */
  capture(project: Project, view: PlanView, selection: readonly EntityId[]): CopySet | null
}

/** The object-URL cache behind a Plan Image: `urlFor` is `null` until the bytes have been read. */
export interface AssetUrlSource {
  subscribe(listener: () => void): () => void
  urlFor(sha256: string): string | null
  load(sha256: string): void
  put(sha256: string, bytes: Blob): void
}

/** The browser services the session view cannot build for itself. */
export interface SessionViewServices {
  readonly intent: IntentBuilder
  readonly assetUrls: AssetUrlSource
  /** The current instant in ISO-8601 UTC, from the app's one clock (#80 §3). */
  readonly now: () => string
}

/** What only the root that renders the view can do: move it, and open the dialogs above it. */
export interface SessionHost {
  /** Back to the Project Library, which owns the choice of which Project to open next (#53). */
  returnToProjects(): void
  /**
   * The person clicked the red `Save failed` status, or tried to leave a Project whose unsaved
   * work is holding this tab (#51 §2). Both are answered by the same dialog, which the root owns.
   */
  showSaveFailure(): void
}

/** The words under the undo button (#14, #49 deviation 3). */
function saveStatusOf(save: SaveState | null): LegacyBindings['saveStatus'] {
  if (save === null) return null
  if (save.kind === 'saving') return { text: STRINGS.saving, failed: false }
  if (save.kind === 'failed') return { text: STRINGS.saveStatusFailed, failed: true }
  return { text: STRINGS.savedLocally(new Date(save.at).toLocaleTimeString()), failed: false }
}

export function useSessionBindings(services: SessionViewServices, host: SessionHost): LegacyBindings {
  const session = useSession()
  const { project } = useProject()
  const save = useSaveStatus(session)
  const units = useProjectSelector(projectUnits)

  const activeItemDesignId = useUi((state) => state.activeItemDesignId)
  const selectedNodeId = useUi((state) => state.selectedNodeId)
  const snapGrid = useUi((state) => state.snapGrid)
  const setActiveItemDesign = useUi((state) => state.setActiveItemDesign)
  const selectNode = useUi((state) => state.selectNode)

  // The cabinet view shows a Design by id and falls back to the first one when nothing is
  // selected; the session holds no such pointer, so the projection decides it (#49).
  const itemDesignId = units.find((unit) => unit.id === activeItemDesignId)?.id ?? units[0]?.id ?? null

  // Opening another Project makes its first cabinet the active one, as `setActiveProject`
  // did. The first Project of a launch starts with none: today's store rehydrates with an
  // `activeUnitId` that matches no saved cabinet, so no outline is drawn until one is clicked.
  // The scene's pixels depend on it (#49 criterion 1).
  const shownSessionId = useRef(session.id)
  useEffect(() => {
    if (shownSessionId.current === session.id) return
    shownSessionId.current = session.id
    setActiveItemDesign(units[0]?.id ?? null)
  }, [session.id, units, setActiveItemDesign])

  const dispatch = useCallback(
    (intent: Intent, newAssets?: readonly SessionAsset[]) => {
      const result = newAssets === undefined
        ? session.dispatch(intent)
        : session.dispatch(intent, { newAssets })
      // Every number these components send is clamped before it gets here, so a refusal
      // means the view and the handlers disagree. Say so rather than drop it silently.
      if (!result.ok) console.warn(`BuildBox refused "${intent.label}": ${result.code}`)
    },
    [session],
  )

  const send = useMemo(() => <T extends IntentType>(type: T, payload: PayloadOf<T>): void => {
    dispatch(services.intent.build(type, payload))
  }, [dispatch, services])

  /**
   * A cabinet edit against whichever cabinet the sidebar is showing. With no cabinet at all
   * there is nothing to name in the Intent, and the legacy store simply did nothing either.
   */
  const onUnit = useMemo(() => <T extends IntentType>(
    type: T,
    payload: (itemDesignId: string) => PayloadOf<T>,
  ): void => {
    if (itemDesignId === null) return
    dispatch(services.intent.build(type, payload(itemDesignId)))
  }, [dispatch, services, itemDesignId])

  const history = session.getSnapshot().history

  return useMemo<LegacyBindings>(() => ({
    activeProjectName: project.meta.name,
    returnToProjects: host.returnToProjects,
    saveStatus: save,
    reopenSaveFailure: () => host.showSaveFailure(),

    canUndo: history.canUndo,
    canRedo: history.canRedo,
    undo: () => session.undo(),
    redo: () => session.redo(),

    units,
    // What was chosen, not the fallback: the scene outlines only a cabinet that was picked.
    activeItemDesignId,
    setActiveItemDesign,
    selectedNodeId,
    selectNode,
    snapGrid,
    updateUnitSettings: (id, patch: Partial<GlobalSettings>) => send('cabinet.updateSettings', {
      itemDesignId: id,
      patch,
    }),
    setCabinetMaterial: (material: CabinetMaterialId) => onUnit('cabinet.setMaterial', (id) => ({
      itemDesignId: id,
      material,
    })),
    addUnit: () => {
      send('cabinet.addUnit', { sourceItemDesignId: itemDesignId })
      const added = projectUnits(session.getSnapshot().project)
      if (added.length > 0) setActiveItemDesign(added[added.length - 1].id)
    },
    removeUnit: (id) => send('cabinet.removeUnit', { itemDesignId: id }),
    renameUnit: (id, name) => send('cabinet.renameUnit', { itemDesignId: id, name }),
    addShelf: (nodeId) => onUnit('cabinet.addShelf', (itemDesignId) => ({ itemDesignId, nodeId })),
    addDivider: (nodeId) => onUnit('cabinet.addDivider', (itemDesignId) => ({ itemDesignId, nodeId })),
    deleteBoard: (nodeId) => {
      onUnit('cabinet.deleteBoard', (itemDesignId) => ({ itemDesignId, nodeId }))
      if (selectedNodeId === nodeId) selectNode(null)
    },
    setNodeSize: (nodeId, sizeMm) => onUnit('cabinet.setNodeSize', (itemDesignId) => ({
      itemDesignId,
      nodeId,
      sizeMm,
    })),
    pinNode: (nodeId, sizeMm) => onUnit('cabinet.pinNode', (itemDesignId) => ({
      itemDesignId,
      nodeId,
      sizeMm,
    })),
    unpinNode: (nodeId) => onUnit('cabinet.unpinNode', (itemDesignId) => ({ itemDesignId, nodeId })),
    // The legacy store's `unlockNode` was `unpinNode` under another name; domain v1 has the one.
    unlockNode: (nodeId) => onUnit('cabinet.unpinNode', (itemDesignId) => ({ itemDesignId, nodeId })),
    // A note about the cabinet on screen. The title starts empty on purpose: §10 requires a Title
    // before the note can be saved, and a made-up one would let an empty note through the door.
    createComment: (anchor) => {
      send('comment.create', { anchor, title: '', body: '', priority: 'normal', at: services.now() })
    },
    setNodeLabel: (nodeId, label) => onUnit('cabinet.setNodeLabel', (itemDesignId) => ({
      itemDesignId,
      nodeId,
      label,
    })),
    distributeEvenly: (columnRootId, evenH) => onUnit('cabinet.distributeEvenly', (itemDesignId) => ({
      itemDesignId,
      columnRootId,
      evenH,
    })),
    setElementType: (nodeId, elementType: ElementType) => onUnit('cabinet.setElementType', (itemDesignId) => ({
      itemDesignId,
      nodeId,
      elementType,
    })),
    setDrawerConfig: (nodeId, config: DrawerConfig) => onUnit('cabinet.setDrawerConfig', (itemDesignId) => ({
      itemDesignId,
      nodeId,
      config,
    })),
    addAccessory: (nodeId, type) => onUnit('cabinet.addAccessory', (itemDesignId) => ({
      itemDesignId,
      nodeId,
      accessory: { type },
    })),
    removeAccessory: (nodeId, accessoryId) => onUnit('cabinet.removeAccessory', (itemDesignId) => ({
      itemDesignId,
      nodeId,
      accessoryId,
    })),
    commitDrag: (parentNodeId, ratio) => onUnit('cabinet.setSplitRatio', (itemDesignId) => ({
      itemDesignId,
      parentNodeId,
      ratio,
    })),
  }), [
    session,
    host,
    project,
    save,
    history,
    units,
    activeItemDesignId,
    itemDesignId,
    setActiveItemDesign,
    selectedNodeId,
    selectNode,
    snapGrid,
    dispatch,
    send,
    onUnit,
    services,
  ])
}

/** The save state, subscribed on its own: it moves on every write, not only on every edit. */
function useSaveStatus(session: ProjectSession): LegacyBindings['saveStatus'] {
  const subscribe = useCallback((listener: () => void) => session.subscribe(listener), [session])
  const cache = useRef<{ key: string; value: LegacyBindings['saveStatus'] } | null>(null)
  const getSnapshot = useCallback(() => {
    const save = session.getSnapshot().save
    const key = save === null ? 'none' : save.kind === 'saved' ? `saved:${save.at}` : save.kind
    if (cache.current !== null && cache.current.key === key) return cache.current.value
    const value = saveStatusOf(save)
    cache.current = { key, value }
    return value
  }, [session])
  return useSyncExternalStore(subscribe, getSnapshot)
}

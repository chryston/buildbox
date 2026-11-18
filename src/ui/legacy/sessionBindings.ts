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
 */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { CabinetMaterialId, DrawerConfig, ElementType, GlobalSettings, Project } from '../../domain'
import type { Intent, IntentType, Locator, PayloadOf } from '../../edit'
import type { ProjectSession, SaveState, SessionAsset } from '../../session'
import type { FloorPlanData, FloorPlanObjectType } from '../../types'
import { useProject, useProjectSelector, useSession } from './useProject'
import { uiStore, useUi } from './uiStore'
import type { DragPreview } from './uiStore'
import type { LegacyBindings, PlanImageAsset, PlanImageRead } from './bindings'
import { firstFloorId, projectFloorPlan, projectUnits } from './projectView'

/**
 * An Intent, fully formed. `app` builds it: the label table and the per-Intent id order are
 * `edit`'s, and only `app` may read them as values.
 */
export interface IntentBuilder {
  build<T extends IntentType>(type: T, payload: PayloadOf<T>): Intent
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
  readPlanImage(file: File): Promise<PlanImageRead>
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

/** #49 deviation 4: the flagged file input names the three formats a Plan Image may be. */
export const PLAN_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp'

/** The last placement on this Floor: the one a just-committed add has made. */
function lastPlacedId(project: Project, floorId: string): string | null {
  const { placedItems } = project.existingModel
  for (let index = placedItems.length - 1; index >= 0; index -= 1) {
    if (placedItems[index].floorId === floorId) return placedItems[index].id
  }
  return null
}

/**
 * The live drag, overlaid on the Floor's objects. The pointer has moved and the Intent has
 * not: today's store wrote on every pointer move, so a preview the view did not follow would
 * read as a frozen canvas (#49).
 */
function withDragPreview(plan: FloorPlanData, preview: DragPreview | null): FloorPlanData {
  if (preview === null) return plan
  return {
    ...plan,
    objects: plan.objects.map((object) => (object.id === preview.id ? { ...object, ...preview.patch } : object)),
  }
}

/** The words under the undo button (#14, #49 deviation 3). */
function saveStatusOf(save: SaveState | null): LegacyBindings['saveStatus'] {
  if (save === null) return null
  if (save.kind === 'saving') return { text: 'Saving…', failed: false }
  if (save.kind === 'failed') return { text: 'Save failed', failed: true }
  return { text: `Saved locally ${new Date(save.at).toLocaleTimeString()}`, failed: false }
}

/** The same `SessionAsset` the Asset Store will keep, from the bytes one upload produced. */
function sessionAsset(asset: PlanImageAsset): SessionAsset {
  return {
    sha256: asset.sha256,
    bytes: asset.bytes,
    mediaType: asset.mediaType,
    widthPx: asset.widthPx,
    heightPx: asset.heightPx,
  }
}

export function useSessionBindings(services: SessionViewServices, host: SessionHost): LegacyBindings {
  const session = useSession()
  const { project } = useProject()
  const save = useSaveStatus(session)
  const units = useProjectSelector(projectUnits)

  const assetHash = project.floors[0]?.planImage?.assetHash ?? null
  const imageSrc = useAssetUrl(services, assetHash)
  const baseFloorPlan = useProjectSelector((current) => projectFloorPlan(current, imageSrc))

  const activeItemDesignId = useUi((state) => state.activeItemDesignId)
  const selectedNodeId = useUi((state) => state.selectedNodeId)
  const snapGrid = useUi((state) => state.snapGrid)
  const floorPlanSelectedId = useUi((state) => state.floorPlanSelectedId)
  const tool = useUi((state) => state.tool)
  const dragPreview = useUi((state) => state.dragPreview)
  const activeModule = useUi((state) => state.activeModule)
  const setActiveItemDesign = useUi((state) => state.setActiveItemDesign)
  const selectNode = useUi((state) => state.selectNode)
  const selectFloorPlanObject = useUi((state) => state.selectFloorPlanObject)
  const setTool = useUi((state) => state.setTool)
  const setDragPreview = useUi((state) => state.setDragPreview)
  const setActiveModule = useUi((state) => state.setActiveModule)

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
  const floorPlan = useMemo(() => withDragPreview(baseFloorPlan, dragPreview), [baseFloorPlan, dragPreview])

  // Undo and redo name the Floor and view their Intent landed on; #14's session publishes
  // that as navigation, and the legacy view's only notion of it is which tab is showing.
  useEffect(() => session.onNavigate((locator: Locator) => {
    setActiveModule(locator.view === 'plan' ? 'floorplan' : 'cabinet')
    if (locator.view === 'plan') selectFloorPlanObject(locator.placedItemIds[0] ?? null)
  }), [session, setActiveModule, selectFloorPlanObject])

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
  const floorId = firstFloorId(project)

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

    floorPlan,
    floorPlanSelectedId,
    selectFloorPlanObject,
    addFloorPlanObject: (catalogKey: FloorPlanObjectType) => {
      if (floorId === null) return
      send('plan.addObject', { floorId, catalogKey })
      selectFloorPlanObject(lastPlacedId(session.getSnapshot().project, floorId))
    },
    addFloorPlanFromTemplate: (templateId) => {
      if (floorId === null) return
      send('plan.addFromTemplate', { floorId, templateItemDesignId: templateId })
      selectFloorPlanObject(lastPlacedId(session.getSnapshot().project, floorId))
    },
    addCustomTemplate: (template) => send('plan.addTemplate', {
      label: template.label,
      w: template.defaultW,
      h: template.defaultH,
      color: template.color,
    }),
    updateFloorPlanObject: (id, patch) => send('plan.updateObject', { placedItemId: id, patch }),
    // A drag is transient until the pointer comes up: one Intent then, so one undo step (#26).
    dragFloorPlanObject: (id, patch) => setDragPreview({ id, patch }),
    endFloorPlanDrag: (id) => {
      // The pointer-up listener belongs to the render that began the drag, so the preview is
      // read from the store: this closure's `dragPreview` is the one from before it moved.
      const preview = uiStore.getState().dragPreview
      setDragPreview(null)
      if (preview === null || preview.id !== id) return
      send('plan.updateObject', { placedItemId: id, patch: preview.patch })
    },
    removeFloorPlanObject: (id) => {
      send('plan.removeObject', { placedItemId: id })
      if (floorPlanSelectedId === id) selectFloorPlanObject(null)
    },
    setFloorPlanScale: (pixelsPerMm) => {
      if (floorId !== null) send('plan.calibrate', { floorId, pixelsPerMm })
    },
    clearFloorPlan: () => {
      if (floorId !== null) send('plan.clear', { floorId })
    },
    // Sketch annotations have no home in domain v1 (#49 deviation 1): no callback, no tools.
    planImageAccept: PLAN_IMAGE_ACCEPT,
    readPlanImage: (file) => services.readPlanImage(file),
    setPlanImage: (image, { clearExisting }) => {
      const asset: PlanImageAsset | null = image.asset
      // The flagged reader always returns bytes; only the legacy reader hands back `null`.
      if (asset === null || floorId === null) return
      services.assetUrls.put(asset.sha256, asset.bytes)
      dispatch(
        services.intent.build('plan.setImage', {
          floorId,
          image: {
            assetHash: asset.sha256,
            mediaType: asset.mediaType,
            widthPx: asset.widthPx,
            heightPx: asset.heightPx,
          },
          clearExisting,
        }),
        [sessionAsset(asset)],
      )
    },

    tool,
    setTool,
    activeModule,
    setActiveModule,
  }), [
    session,
    host,
    project,
    save,
    history,
    units,
    floorPlan,
    floorId,
    activeItemDesignId,
    itemDesignId,
    setActiveItemDesign,
    selectedNodeId,
    selectNode,
    snapGrid,
    floorPlanSelectedId,
    selectFloorPlanObject,
    tool,
    setTool,
    setDragPreview,
    activeModule,
    setActiveModule,
    dispatch,
    send,
    onUnit,
    services,
    host,
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

/** The object URL of the current Plan Image, `null` until the cache has read the bytes. */
function useAssetUrl(services: SessionViewServices, sha256: string | null): string | null {
  const { assetUrls } = services
  const subscribe = useCallback((listener: () => void) => assetUrls.subscribe(listener), [assetUrls])
  const getSnapshot = useCallback(
    () => (sha256 === null ? null : assetUrls.urlFor(sha256)),
    [assetUrls, sha256],
  )
  useEffect(() => {
    if (sha256 !== null) assetUrls.load(sha256)
  }, [assetUrls, sha256])
  return useSyncExternalStore(subscribe, getSnapshot)
}

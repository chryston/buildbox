/**
 * The Floor workspace (#55, #56): the production Plan View and the chrome the issues
 * prescribe — header (`← Projects`, name, save status, Undo/Redo, Project settings), one
 * fixed-height toolbar, a left rail of view card above selection inspector, the canvas, and
 * slots for the draft bar and warning strip.
 *
 * Every write is one Intent through the session, exactly as the flagged floor plan wrote
 * since #49: a drag is one `plan.updateObject` at the end of the gesture, an upload is one
 * `plan.setImage` with its Asset, a calibration is one `plan.calibrate`, a Floor rename is
 * one `floor.rename`. The viewport and which Floor and view are open are the one thing that
 * bypasses the session — device-local view state, never history (#20 §4) — and they go
 * through the `ViewportCache` port instead.
 *
 * The Floor and Plan View the workspace is looking at are pointers into the Project, never
 * owners of it (#25): every selector below takes the Floor id, so nothing drawn, snapped or
 * selected can cross a Floor boundary.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { originCandidates as originCandidatePoints } from '../../derive'
import type { Point2, Project } from '../../domain'
import { summarizeFloorDependencies } from '../../domain'
import type { SessionAsset } from '../../session'
import type { IntentType, PayloadOf } from '../../edit'
import {
  usePlanImageSrc,
  useSaveStatus,
  useWorkspaceDispatch,
  useWorkspaceProject,
  useWorkspaceRoot,
} from './WorkspaceRoot'
import type { PreparedPlanImage } from './WorkspaceRoot'
import {
  decodeActiveViews,
  encodeActiveViews,
  itemLibrary,
  planImageForView,
  planItemsForFloor,
  planViewKey,
  planViewsForFloor,
  placedOrigin,
  resolvePlanView,
} from './planModel'
import { CALIBRATION_REQUIRED_HINT, WORKSPACE_TOOLS, floorNeedsCalibration, toolIsGated } from './toolbarRegistry'
import { fitViewport } from './viewport'
import type { Viewport } from './viewport'
import { useWorkspace, workspaceStore } from './workspaceStore'
import { WorkspaceShell } from './WorkspaceShell'
import { ToolbarMenu, ToolbarMenuItem, WorkspaceToolbar } from './WorkspaceToolbar'
import type { ToolbarGroup } from './WorkspaceToolbar'
import { PlanViewCanvas } from './PlanViewCanvas'
import { SavedViewCard } from './SavedViewCard'
import { SelectionInspector } from './SelectionInspector'
import type { DesignEdit } from './SelectionInspector'
import { quarterTurn } from './rotateHandle'
import { ProjectSettingsDialog } from './ProjectSettingsDialog'
import { ForkDesignDialog, NewItemDialog } from './ItemDialogs'
import { ManageFloorsDialog } from './ManageFloorsDialog'
import { DeleteFloorDialog } from './DeleteFloorDialog'
import { DuplicateFloorDialog } from './DuplicateFloorDialog'
import type { DuplicateFloorInput } from './DuplicateFloorDialog'
import { TransferToFloorDialog } from './TransferToFloorDialog'
import type { TransferTarget } from './TransferToFloorDialog'
import { CalibrationOverlay } from './CalibrationOverlay'
import { ScaleCalibrationModal } from './ScaleCalibrationModal'
import { downloadSvg } from './exportSvg'

/** The package's per-file limit (#6): the largest Plan Image a file may be. */
const MAX_PLAN_IMAGE_BYTES = 50 * 1024 * 1024

/** The last placement on this Floor: the one a just-committed add has made. */
function lastPlacedId(project: Project, floorId: string): string | null {
  const { placedItems } = project.existingModel
  for (let index = placedItems.length - 1; index >= 0; index -= 1) {
    if (placedItems[index].floorId === floorId) return placedItems[index].id
  }
  return null
}

/** Below 1024 px the rail is a drawer and the toolbar gains `View & selection`. */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => window.matchMedia('(max-width: 1023.98px)').matches,
  )
  useEffect(() => {
    const query = window.matchMedia('(max-width: 1023.98px)')
    const onChange = (): void => setNarrow(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return narrow
}

export function FloorWorkspace(): ReactNode {
  const { session, services, host } = useWorkspaceRoot()
  const project = useWorkspaceProject(session)
  const dispatch = useWorkspaceDispatch()
  const save = useSaveStatus(session)
  const history = session.getSnapshot().history

  // Which Floor and Plan View are open: device-local view state, resolved against the live
  // Project so a Floor deleted underneath the pointer falls back instead of blanking.
  const storedFloorId = useWorkspace((state) => state.activeFloorId)
  const viewsByFloor = useWorkspace((state) => state.activeViewByFloor)
  const activeHydrated = useWorkspace((state) => state.activeHydrated)
  const floorId = project.floors.some((each) => each.id === storedFloorId)
    ? storedFloorId
    : project.floors[0]?.id ?? null
  const floor = project.floors.find((entry) => entry.id === floorId) ?? null
  const views = planViewsForFloor(project, floorId)
  const view = resolvePlanView(project, floorId, floorId === null ? null : viewsByFloor[floorId] ?? null)
  const planImage = floor?.planImage ?? null
  const imageSrc = usePlanImageSrc(services.assetUrls, planImage?.assetHash ?? null)
  const image = planImageForView(project, view, imageSrc)
  const items = planItemsForFloor(project, floorId)
  const library = itemLibrary(project)

  const tool = useWorkspace((state) => state.activeTool)
  const setTool = useWorkspace((state) => state.setTool)
  const selection = useWorkspace((state) => state.selection)
  const select = useWorkspace((state) => state.select)
  const dragPreview = useWorkspace((state) => state.dragPreview)
  const setDragPreview = useWorkspace((state) => state.setDragPreview)
  const angleSnap = useWorkspace((state) => state.snapSettings.angle)
  const designPreview = useWorkspace((state) => state.designPreview)
  const setDesignPreview = useWorkspace((state) => state.setDesignPreview)
  const pickingOrigin = useWorkspace((state) => state.pickingOrigin)
  const setPickingOrigin = useWorkspace((state) => state.setPickingOrigin)
  const openItemDetail = useWorkspace((state) => state.openItemDetail)
  const viewKey = view === null ? null : planViewKey(view)
  const viewport = useWorkspace((state) => (viewKey === null ? undefined : state.viewports[viewKey]))
  const hydrated = useWorkspace((state) => (viewKey === null ? true : state.hydrated[viewKey] === true))
  const railOpen = useWorkspace((state) => state.railOpen)
  const setRailOpen = useWorkspace((state) => state.setRailOpen)

  const hostRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [isCalibrating, setIsCalibrating] = useState(false)
  const [pendingDistancePx, setPendingDistancePx] = useState<number | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [manageFloorsOpen, setManageFloorsOpen] = useState(false)
  const [deleteFloorId, setDeleteFloorId] = useState<string | null>(null)
  const [duplicateFloorId, setDuplicateFloorId] = useState<string | null>(null)
  const [transferOpen, setTransferOpen] = useState(false)
  const [newItemOpen, setNewItemOpen] = useState(false)
  const [forkOpen, setForkOpen] = useState(false)

  const narrow = useNarrow()
  const uncalibrated = floorNeedsCalibration(planImage)

  // Another Project opened: its placements, Floors and open view are not this one's. The store
  // was already emptied when its Project was opened (`WorkspaceProvider` owns that), so arriving
  // here from Item Detail — which unmounts this view and mounts it again — keeps the Placed Item
  // the back link navigated to (#57 §6).
  useEffect(() => {
    let live = true
    void services.viewportCache.readActive().then((active) => {
      if (!live) return
      workspaceStore.getState().hydrateActive(
        active?.floorId ?? null,
        decodeActiveViews(session.getSnapshot().project, active?.viewsByFloor ?? {}),
      )
    })
    return () => {
      live = false
    }
  }, [session.id, services])

  // …and the open pair goes back the way it came: one record per Project, device-local.
  useEffect(() => {
    if (!activeHydrated) return
    services.viewportCache.writeActive({ floorId, viewsByFloor: encodeActiveViews(project, viewsByFloor) })
  }, [activeHydrated, floorId, viewsByFloor, project, services])

  // Undo and redo navigate to what they touched (#26): the Floor and view the edit was about.
  // An Edit Transaction that touched no Floor — a Project preference — leaves the pointer
  // where it was rather than blanking the Plan View, and arriving back at the pair already on
  // screen is the common case, so it changes nothing at all: the Placed Item the transaction
  // was about stays selected, which is what lets it be edited back.
  useEffect(() => {
    const openFloorId = floorId
    const openViewId = view?.id ?? null
    return session.onNavigate((locator) => {
      if (locator.floorId === null) return
      if (locator.floorId === openFloorId && (locator.viewId === null || locator.viewId === openViewId)) return
      workspaceStore.getState().setActiveFloor(locator.floorId, locator.viewId)
    })
  }, [session, floorId, view?.id])

  const setViewport = useCallback((next: Viewport) => {
    if (viewKey === null) return
    workspaceStore.getState().setViewport(viewKey, next)
    services.viewportCache.write(viewKey, next)
  }, [viewKey, services])

  // The cache answers once per view key; no entry leaves `Fit` to the canvas.
  useEffect(() => {
    if (viewKey === null || hydrated) return
    let live = true
    void services.viewportCache.read(viewKey).then((cached) => {
      if (!live) return
      if (cached !== undefined) workspaceStore.getState().setViewport(viewKey, cached)
      workspaceStore.getState().markHydrated(viewKey)
    })
    return () => {
      live = false
    }
  }, [viewKey, hydrated, services])

  const fit = (): void => {
    const el = hostRef.current
    if (el === null) return
    const { width, height } = el.getBoundingClientRect()
    if (width <= 0 || height <= 0) return
    setViewport(fitViewport(width, height, image?.widthMm ?? 800, image?.heightMm ?? 600))
  }

  const send = <T extends IntentType>(type: T, payload: PayloadOf<T>): void => {
    dispatch(services.intent.build(type, payload))
  }

  const selected = items.find((item) => item.id === selection) ?? null
  const selectedDesign = selected === null
    ? null
    : project.itemDesigns.find((design) => design.id === selected.designId) ?? null

  /** Where the Item Origin stands: what a drag and `Position X` / `Position Y` both mean. */
  const setPosition = (x: number, y: number): void => {
    if (selection === null) return
    send('plan.movePlacement', { placedItemId: selection, translation: { x, y } })
  }

  /** One turn about the Item Origin; the handler normalises to `[0, 360)`. */
  const setRotation = (rotationDeg: number): void => {
    if (selection === null) return
    send('plan.rotatePlacement', { placedItemId: selection, rotationDeg })
  }

  /**
   * An Item Design edit is shared, so more than one placement opens the preview (D3) and
   * nothing is written until `Apply`. With one placement there is nothing to preview.
   */
  const editDesign = (edit: DesignEdit): void => {
    if (selected === null) return
    if (selected.placementCount <= 1) {
      send('design.update', { itemDesignId: selected.designId, patch: edit })
      return
    }
    setDesignPreview({
      itemDesignId: selected.designId,
      origin: designPreview?.origin ?? null,
      name: edit.name ?? designPreview?.name ?? null,
      width: edit.width ?? designPreview?.width ?? null,
      depth: edit.depth ?? designPreview?.depth ?? null,
      color: edit.color ?? designPreview?.color ?? null,
    })
  }

  /** An Item Origin choice always previews: the footprints stay put, the markers move. */
  const previewOrigin = (origin: Point2): void => {
    if (selected === null) return
    setDesignPreview({
      itemDesignId: selected.designId,
      origin,
      name: null,
      width: null,
      depth: null,
      color: null,
    })
    setPickingOrigin(false)
  }

  const applyPreview = (): void => {
    if (designPreview === null) return
    const { itemDesignId, origin, name, width, depth, color } = designPreview
    setDesignPreview(null)
    setPickingOrigin(false)
    if (origin !== null) {
      send('design.setOrigin', { itemDesignId, origin })
      return
    }
    send('design.update', {
      itemDesignId,
      patch: {
        ...(name === null ? {} : { name }),
        ...(width === null ? {} : { width }),
        ...(depth === null ? {} : { depth }),
        ...(color === null ? {} : { color }),
      },
    })
  }

  const cancelPreview = (): void => {
    setDesignPreview(null)
    setPickingOrigin(false)
  }

  /** `Fork design…`: the placement gets its own deep copy and the selection follows it. */
  const forkDesign = (name: string): void => {
    if (selected === null) return
    const originalDesignId = selected.designId
    send('design.fork', { placedItemId: selected.id, name })
    setForkOpen(false)
    const next = session.getSnapshot().project
    const design = next.itemDesigns.find((candidate) => candidate.id !== originalDesignId && candidate.name === name)
    const placed = next.existingModel.placedItems.find((placement) => placement.itemDesignId === design?.id)
    select(placed?.id ?? null)
  }

  const openDetail = (): void => {
    if (selected === null || floorId === null || view === null) return
    openItemDetail(selected.designId, { floorId, viewId: view.id, placedItemId: selected.id })
  }

  const addObject = (catalogKey: string): void => {
    if (floorId === null) return
    send('plan.addObject', { floorId, catalogKey })
    select(lastPlacedId(session.getSnapshot().project, floorId))
  }

  /** Placing a design from the library is reuse: the same design, one more placement. */
  const placeDesign = (itemDesignId: string): void => {
    if (floorId === null) return
    send('plan.placeDesign', { floorId, itemDesignId })
    select(lastPlacedId(session.getSnapshot().project, floorId))
  }

  /** `New item…` authors a design nobody has placed, then places this one copy. */
  const addItemDesign = (label: string, w: number, h: number, color: string): void => {
    if (floorId === null) return
    send('plan.addTemplate', { label, w, h, color })
    setNewItemOpen(false)
    select(lastPlacedId(session.getSnapshot().project, floorId))
  }

  // `[` and `]` turn the selected Placed Item a quarter turn about its Item Origin, and
  // Escape backs out of a pending design preview or a disarmed `Pick on canvas` (#57 §4).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (designPreview === null && !pickingOrigin) return
        event.preventDefault()
        setDesignPreview(null)
        setPickingOrigin(false)
        return
      }
      const target = event.target as HTMLElement | null
      if (target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (selected === null) return
      if (event.key === '[') send('plan.rotatePlacement', { placedItemId: selected.id, rotationDeg: quarterTurn(selected.rotationDeg, -1) })
      if (event.key === ']') send('plan.rotatePlacement', { placedItemId: selected.id, rotationDeg: quarterTurn(selected.rotationDeg, 1) })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selected, designPreview, pickingOrigin, setDesignPreview, setPickingOrigin, send])

  const commitImage = (prepared: PreparedPlanImage): void => {
    const asset = prepared.asset
    if (asset === null || floorId === null) return
    services.assetUrls.put(asset.sha256, asset.bytes)
    const sessionAsset: SessionAsset = {
      sha256: asset.sha256,
      bytes: asset.bytes,
      mediaType: asset.mediaType,
      widthPx: asset.widthPx,
      heightPx: asset.heightPx,
    }
    dispatch(
      services.intent.build('plan.setImage', {
        floorId,
        image: {
          assetHash: asset.sha256,
          mediaType: asset.mediaType,
          widthPx: asset.widthPx,
          heightPx: asset.heightPx,
        },
      }),
      [sessionAsset],
    )
  }

  const onFile = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (file === undefined) return
    setUploadError(null)
    if (!file.type.startsWith('image/')) {
      setUploadError('Please choose a valid image file.')
      input.value = ''
      return
    }
    if (file.size > MAX_PLAN_IMAGE_BYTES) {
      setUploadError('A Plan Image can be at most 50 MB.')
      input.value = ''
      return
    }
    const read = await services.readPlanImage(file)
    input.value = ''
    if ('message' in read) {
      setUploadError("This file couldn't be read as an image")
      return
    }
    // A new picture never clears the objects drawn over it (#56): the upload is the upload.
    // Replacing one resets the scale, because the old one described different pixels.
    commitImage(read.image)
  }

  const handleExportSvg = (): void => {
    select(null)
    setTimeout(() => {
      const svg = svgRef.current
      if (svg === null) return
      const rect = svg.getBoundingClientRect()
      svg.setAttribute('width', String(Math.round(rect.width)))
      svg.setAttribute('height', String(Math.round(rect.height)))
      downloadSvg(svg, 'floor-plan')
      svg.removeAttribute('width')
      svg.removeAttribute('height')
    }, 50)
  }

  const openFloor = (nextFloorId: string): void => {
    const next = resolvePlanView(project, nextFloorId, viewsByFloor[nextFloorId] ?? null)
    workspaceStore.getState().setActiveFloor(nextFloorId, next?.id ?? null)
  }

  const openView = (viewId: string): void => {
    if (floorId === null) return
    workspaceStore.getState().setActiveView(floorId, viewId)
  }

  const addPlanView = (name: string): void => {
    if (floorId === null) return
    send('view.create', { floorId, name })
    const created = session.getSnapshot().project.views.find(
      (candidate) => candidate.floorId === floorId && candidate.name === name.trim(),
    )
    if (created !== undefined) workspaceStore.getState().setActiveView(floorId, created.id)
  }

  const addFloor = (): void => {
    send('floor.create', {})
    const floors = session.getSnapshot().project.floors
    const created = floors[floors.length - 1]
    if (created !== undefined) {
      const createdView = session.getSnapshot().project.views.find(
        (candidate) => candidate.floorId === created.id && candidate.isDefault,
      )
      workspaceStore.getState().setActiveFloor(created.id, createdView?.id ?? null)
    }
  }

  const duplicateFloor = (input: DuplicateFloorInput): void => {
    if (duplicateFloorId === null) return
    send('floor.duplicate', { floorId: duplicateFloorId, ...input })
    setDuplicateFloorId(null)
    const after = session.getSnapshot().project
    const created = after.floors.find((candidate) => candidate.name === input.name)
    if (created !== undefined) {
      const createdView = after.views.find((candidate) => candidate.floorId === created.id && candidate.isDefault)
      workspaceStore.getState().setActiveFloor(created.id, createdView?.id ?? null)
    }
  }

  const deleteFloor = (targetId: string): void => {
    const index = project.floors.findIndex((candidate) => candidate.id === targetId)
    send('floor.delete', { floorId: targetId })
    setDeleteFloorId(null)
    setManageFloorsOpen(false)
    // The Floor is gone, so the pointer has to move somewhere that exists: the neighbour the
    // deleted Floor sat next to, which is the one the person was reading past.
    const remaining = session.getSnapshot().project.floors
    const next = remaining[Math.min(Math.max(index, 0), remaining.length - 1)] ?? null
    workspaceStore.getState().setActiveFloor(
      next?.id ?? null,
      next === null ? null : resolvePlanView(session.getSnapshot().project, next.id, null)?.id ?? null,
    )
  }

  /** The delete dialog's `Show`: open the thing that is leaning on this Floor. */
  const showDependant = (kindId: string): void => {
    if (deleteFloorId === null) return
    const target = session.getSnapshot().project
    if (kindId === 'planViews') {
      const named = target.views.find((candidate) => candidate.floorId === deleteFloorId && !candidate.isDefault)
      workspaceStore.getState().setActiveFloor(deleteFloorId, named?.id ?? null)
    } else {
      const fallback = resolvePlanView(target, deleteFloorId, null)
      workspaceStore.getState().setActiveFloor(deleteFloorId, fallback?.id ?? null)
      if (kindId === 'placedItems') {
        const first = target.existingModel.placedItems.find((item) => item.floorId === deleteFloorId)
        select(first?.id ?? null)
      }
    }
    setDeleteFloorId(null)
    setManageFloorsOpen(false)
  }

  const transfer = (mode: 'copy' | 'move', target: TransferTarget): void => {
    if (selection === null) return
    send(mode === 'copy' ? 'plan.copyToFloor' : 'plan.moveToFloor', {
      placedItemIds: [selection],
      toFloorId: target.floorId,
      translation: { x: target.x, y: target.y },
      baseElevation: target.baseElevation,
    })
    setTransferOpen(false)
    select(null)
    const after = session.getSnapshot().project
    workspaceStore.getState().setActiveFloor(
      target.floorId,
      resolvePlanView(after, target.floorId, null)?.id ?? null,
    )
  }

  const groups: ToolbarGroup[] = [
    {
      id: 'tools',
      width: 132,
      label: 'Tools',
      content: (
        <>
          {WORKSPACE_TOOLS.map((definition) => {
            const gated = toolIsGated(definition, planImage)
            return (
              <button
                key={definition.id}
                type="button"
                data-testid={definition.testId}
                aria-pressed={tool === definition.id ? 'true' : 'false'}
                title={gated ? CALIBRATION_REQUIRED_HINT : undefined}
                className="bb-workspace-tool-button"
                disabled={gated}
                onClick={() => setTool(definition.id)}
              >
                {definition.label}
              </button>
            )
          })}
        </>
      ),
    },
    {
      id: 'add',
      width: 112,
      label: 'Add item',
      content: (
        <ToolbarMenu label="Add item" testId="add-item-menu">
          {/* Three sections (#57 §3): what this Project already has, the shipped catalogue,
              and the one way to author a shape of your own. */}
          <div className="bb-workspace-menu-heading">In this Project</div>
          {library.length === 0 && (
            <div className="bb-workspace-library-item" data-testid="library-empty">Nothing here yet</div>
          )}
          {library.map((entry) => (
            <button
              key={entry.itemDesignId}
              type="button"
              className="bb-workspace-library-item"
              data-testid={`add-design-${entry.itemDesignId}`}
              onClick={() => placeDesign(entry.itemDesignId)}
            >
              <span className="bb-workspace-library-swatch" style={{ background: entry.color }} />
              <span className="bb-workspace-library-name">{entry.label}</span>
              <span className="bb-workspace-library-meta">
                {entry.isCabinet ? 'Cabinet' : `${Math.round(entry.width)} × ${Math.round(entry.depth)}`}
              </span>
              <span className="bb-workspace-library-meta" data-testid={`library-count-${entry.itemDesignId}`}>
                {entry.placementCount}
              </span>
            </button>
          ))}
          <div className="bb-workspace-menu-heading">Catalog</div>
          {services.planCatalogue.map((option) => (
            <ToolbarMenuItem
              key={option.key}
              label={option.label}
              testId={`add-${option.key}`}
              onSelect={() => addObject(option.key)}
            />
          ))}
          <ToolbarMenuItem label="New item…" testId="add-new-item" onSelect={() => setNewItemOpen(true)} />
        </ToolbarMenu>
      ),
    },
    {
      id: 'plan-image',
      width: 132,
      label: 'Plan Image',
      content: (
        <ToolbarMenu label="Plan Image" testId="plan-image-menu">
          <ToolbarMenuItem
            label="Upload…"
            testId="upload-image"
            disabled={planImage !== null}
            onSelect={() => fileInputRef.current?.click()}
          />
          <ToolbarMenuItem
            label="Replace…"
            testId="replace-image"
            disabled={planImage === null}
            onSelect={() => fileInputRef.current?.click()}
          />
          <ToolbarMenuItem
            label="Remove"
            testId="remove-plan-image"
            disabled={planImage === null}
            onSelect={() => {
              if (floorId !== null) send('plan.removeImage', { floorId })
            }}
          />
          <ToolbarMenuItem
            label="Calibrate…"
            testId="calibrate-scale"
            disabled={planImage === null}
            onSelect={() => setIsCalibrating(true)}
          />
        </ToolbarMenu>
      ),
    },
    {
      id: 'export',
      width: 112,
      label: 'Export',
      content: (
        <button
          type="button"
          data-testid="export-svg"
          className="bb-workspace-tool-button"
          onClick={handleExportSvg}
        >
          Export SVG
        </button>
      ),
    },
  ]
  if (narrow) {
    groups.push({
      id: 'rail',
      width: 156,
      label: 'View & selection',
      content: (
        <button
          type="button"
          data-testid="rail-toggle"
          aria-pressed={railOpen ? 'true' : 'false'}
          className="bb-workspace-tool-button"
          onClick={() => setRailOpen(!railOpen)}
        >
          View &amp; selection
        </button>
      ),
    })
  }

  const deleteFloorTarget = project.floors.find((candidate) => candidate.id === deleteFloorId) ?? null
  const origin = placedOrigin(project, selection)

  return (
    <>
      <WorkspaceShell
        railOpen={railOpen}
        canvasHostRef={hostRef}
        header={
          <>
            <button
              type="button"
              data-testid="return-to-projects"
              className="bb-workspace-tool-button"
              onClick={host.returnToProjects}
            >
              ← Projects
            </button>
            <span className="bb-workspace-project-name">{project.meta.name}</span>
            <span className="bb-workspace-spacer" />
            {save !== null && (
              // The legacy shape the S4 specs assert: a `role="status"` span whose failed
              // state is a button, because the dialog is the answer to the red words.
              <span
                role="status"
                data-testid="save-status"
                data-failed={save.failed ? 'true' : 'false'}
                className="bb-workspace-save-status"
              >
                {save.failed ? (
                  <button type="button" onClick={host.showSaveFailure}>
                    {save.text}
                  </button>
                ) : (
                  save.text
                )}
              </span>
            )}
            <button
              type="button"
              data-testid="undo-button"
              aria-label="Undo"
              disabled={!history.canUndo}
              className="bb-workspace-tool-button"
              onClick={() => session.undo()}
            >
              Undo
            </button>
            <button
              type="button"
              data-testid="redo-button"
              aria-label="Redo"
              disabled={!history.canRedo}
              className="bb-workspace-tool-button"
              onClick={() => session.redo()}
            >
              Redo
            </button>
            <button
              type="button"
              data-testid="project-settings"
              className="bb-workspace-tool-button"
              onClick={() => setSettingsOpen(true)}
            >
              Project settings
            </button>
          </>
        }
        toolbar={<WorkspaceToolbar groups={groups} />}
        viewCard={
          <SavedViewCard
            project={project}
            floor={floor}
            views={views}
            view={view}
            planImage={planImage}
            unit={project.preferences.displayUnit}
            precision={project.preferences.displayPrecision}
            onFloor={openFloor}
            onView={openView}
            onAddPlanView={addPlanView}
            onManageFloors={() => setManageFloorsOpen(true)}
            onShowPlanImage={(showPlanImage) => {
              if (view !== null) send('view.setShowPlanImage', { viewId: view.id, showPlanImage })
            }}
            onCalibrate={() => setIsCalibrating(true)}
            onFit={fit}
          />
        }
        inspector={
          <SelectionInspector
            item={selected}
            design={selectedDesign}
            unit={project.preferences.displayUnit}
            precision={project.preferences.displayPrecision}
            canTransfer={selected !== null && project.floors.length > 1}
            preview={designPreview}
            pickingOrigin={pickingOrigin}
            onSetPosition={setPosition}
            onSetRotation={setRotation}
            onEditDesign={editDesign}
            onPreviewOrigin={previewOrigin}
            onApplyPreview={applyPreview}
            onCancelPreview={cancelPreview}
            onTogglePick={() => setPickingOrigin(!pickingOrigin)}
            onFork={() => setForkOpen(true)}
            onOpenDetail={openDetail}
            onTransfer={() => setTransferOpen(true)}
            onDelete={() => {
              if (selection === null) return
              send('plan.removeObject', { placedItemId: selection })
              select(null)
            }}
          />
        }
        canvas={
          <>
            <PlanViewCanvas
              hostRef={hostRef}
              svgRef={svgRef}
              items={items}
              image={image}
              viewport={viewport ?? null}
              onViewport={setViewport}
              tool={tool}
              selection={selection}
              onSelect={select}
              dragPreview={dragPreview}
              onDragPreview={setDragPreview}
              onMoveItem={(id, x, y) => send('plan.movePlacement', { placedItemId: id, translation: { x, y } })}
              onRotateItem={(id, rotationDeg) => send('plan.rotatePlacement', { placedItemId: id, rotationDeg })}
              designPreview={designPreview}
              pickingOrigin={pickingOrigin}
              originCandidates={selectedDesign === null ? [] : originCandidatePoints(selectedDesign)}
              onPickOrigin={previewOrigin}
              unit={project.preferences.displayUnit}
              precision={project.preferences.displayPrecision}
              angleSnap={angleSnap}
              overlay={isCalibrating ? (
                <CalibrationOverlay
                  zoom={viewport?.zoom ?? 1}
                  pixelsPerMm={planImage?.pixelsPerMm ?? null}
                  onMeasured={(distancePx) => {
                    setIsCalibrating(false)
                    setPendingDistancePx(distancePx)
                  }}
                />
              ) : undefined}
            />
            <input
              ref={fileInputRef}
              data-testid="plan-image-input"
              type="file"
              accept={services.planImageAccept}
              style={{ display: 'none' }}
              onChange={(event) => void onFile(event)}
            />
          </>
        }
        warningStrip={uploadError !== null ? (
          <span data-testid="upload-error" data-tone="error">{uploadError}</span>
        ) : uncalibrated ? (
          <span data-testid="uncalibrated-hint">
            {CALIBRATION_REQUIRED_HINT}
            <button
              type="button"
              data-testid="calibrate-now"
              className="bb-workspace-tool-button"
              onClick={() => setIsCalibrating(true)}
            >
              Calibrate now
            </button>
          </span>
        ) : null}
      />
      {pendingDistancePx !== null && floorId !== null && (
        <ScaleCalibrationModal
          distancePx={pendingDistancePx}
          unit={project.preferences.displayUnit}
          precision={project.preferences.displayPrecision}
          onConfirm={(pixelsPerMm) => {
            send('plan.calibrate', { floorId, pixelsPerMm })
            setPendingDistancePx(null)
          }}
          onClose={() => setPendingDistancePx(null)}
        />
      )}
      {settingsOpen && (
        <ProjectSettingsDialog
          unit={project.preferences.displayUnit}
          precision={project.preferences.displayPrecision}
          onSave={(displayUnit, displayPrecision) => {
            send('project.setPreferences', { displayUnit, displayPrecision })
            setSettingsOpen(false)
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {manageFloorsOpen && (
        <ManageFloorsDialog
          project={project}
          activeFloorId={floorId}
          unit={project.preferences.displayUnit}
          precision={project.preferences.displayPrecision}
          onRename={(targetId, name) => send('floor.rename', { floorId: targetId, name })}
          onReorder={(targetId, toIndex) => send('floor.reorder', { floorId: targetId, toIndex })}
          onSetLimits={(targetId, lowerMm, upperMm) => send('floor.setLimits', { floorId: targetId, lowerMm, upperMm })}
          onAddFloor={addFloor}
          onDuplicate={(targetId) => setDuplicateFloorId(targetId)}
          onDelete={(targetId) => setDeleteFloorId(targetId)}
          onClose={() => setManageFloorsOpen(false)}
        />
      )}
      {deleteFloorTarget !== null && (
        <DeleteFloorDialog
          floor={deleteFloorTarget}
          rows={summarizeFloorDependencies(project, deleteFloorTarget.id)}
          onShow={showDependant}
          onDelete={() => deleteFloor(deleteFloorTarget.id)}
          onClose={() => setDeleteFloorId(null)}
        />
      )}
      {duplicateFloorId !== null && (
        <DuplicateFloorDialog
          project={project}
          sourceFloorId={duplicateFloorId}
          onConfirm={duplicateFloor}
          onClose={() => setDuplicateFloorId(null)}
        />
      )}
      {transferOpen && origin !== null && floor !== null && (
        <TransferToFloorDialog
          floors={project.floors}
          fromFloorName={floor.name}
          initial={origin}
          unit={project.preferences.displayUnit}
          precision={project.preferences.displayPrecision}
          onCopy={(target) => transfer('copy', target)}
          onMove={(target) => transfer('move', target)}
          onClose={() => setTransferOpen(false)}
        />
      )}
      {newItemOpen && (
        <NewItemDialog
          onConfirm={addItemDesign}
          onClose={() => setNewItemOpen(false)}
        />
      )}
      {forkOpen && selected !== null && (
        <ForkDesignDialog
          designName={selected.label}
          taken={project.itemDesigns.map((design) => design.name)}
          onConfirm={forkDesign}
          onClose={() => setForkOpen(false)}
        />
      )}
    </>
  )
}

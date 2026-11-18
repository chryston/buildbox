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
import type { Project } from '../../domain'
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
  customTemplates,
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
import type { PlanObjectPatch } from './SelectionInspector'
import { ProjectSettingsDialog } from './ProjectSettingsDialog'
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
  const templates = customTemplates(project)

  const tool = useWorkspace((state) => state.activeTool)
  const setTool = useWorkspace((state) => state.setTool)
  const selection = useWorkspace((state) => state.selection)
  const select = useWorkspace((state) => state.select)
  const dragPreview = useWorkspace((state) => state.dragPreview)
  const setDragPreview = useWorkspace((state) => state.setDragPreview)
  const viewKey = view === null ? null : planViewKey(view.id)
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

  const narrow = useNarrow()
  const uncalibrated = floorNeedsCalibration(planImage)

  // Another Project opened: its placements, Floors and open view are not this one's.
  useEffect(() => {
    workspaceStore.getState().reset()
    let live = true
    void services.viewportCache.readActive().then((active) => {
      if (!live) return
      workspaceStore.getState().hydrateActive(active?.floorId ?? null, active?.viewsByFloor ?? {})
    })
    return () => {
      live = false
    }
  }, [session.id, services])

  // …and the open pair goes back the way it came: one record per Project, device-local.
  useEffect(() => {
    if (!activeHydrated) return
    services.viewportCache.writeActive({ floorId, viewsByFloor })
  }, [activeHydrated, floorId, viewsByFloor, services])

  // Undo and redo navigate to what they touched (#26): the Floor and view the edit was about.
  useEffect(() => {
    const setActive = workspaceStore.getState().setActiveFloor
    return session.onNavigate((locator) => {
      setActive(locator.floorId, locator.viewId)
    })
  }, [session])

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

  const update = (patch: PlanObjectPatch): void => {
    if (selection === null) return
    send('plan.updateObject', { placedItemId: selection, patch })
  }

  const addObject = (catalogKey: string): void => {
    if (floorId === null) return
    send('plan.addObject', { floorId, catalogKey })
    select(lastPlacedId(session.getSnapshot().project, floorId))
  }

  const addTemplate = (templateItemDesignId: string): void => {
    if (floorId === null) return
    send('plan.addFromTemplate', { floorId, templateItemDesignId })
    select(lastPlacedId(session.getSnapshot().project, floorId))
  }

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
          {services.planCatalogue.map((option) => (
            <ToolbarMenuItem
              key={option.key}
              label={option.label}
              testId={`add-${option.key}`}
              onSelect={() => addObject(option.key)}
            />
          ))}
          {templates.length > 0 && <div className="bb-workspace-menu-heading">Custom</div>}
          {templates.map((template) => (
            <ToolbarMenuItem
              key={template.itemDesignId}
              label={template.label}
              testId={`add-template-${template.itemDesignId}`}
              onSelect={() => addTemplate(template.itemDesignId)}
            />
          ))}
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
            unit={project.preferences.displayUnit}
            precision={project.preferences.displayPrecision}
            canTransfer={selected !== null && project.floors.length > 1}
            onUpdate={update}
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
              onMoveItem={(id, x, y) => send('plan.updateObject', { placedItemId: id, patch: { x, y } })}
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
    </>
  )
}

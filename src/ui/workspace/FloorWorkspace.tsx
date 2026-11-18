/**
 * The Floor workspace (#55): the production Plan View and the chrome the issue
 * prescribes — header (`← Projects`, name, save status, Undo/Redo, Project settings),
 * one fixed-height toolbar, a left rail of view card above selection inspector, the
 * canvas, and slots for the draft bar and warning strip.
 *
 * Every write is one Intent through the session, exactly as the flagged floor plan
 * wrote since #49: a drag is one `plan.updateObject` at the end of the gesture, an
 * upload is one `plan.setImage` with its Asset, a calibration is one `plan.calibrate`.
 * The viewport is the one thing that bypasses the session — device-local view state,
 * never history (#20 §4) — and it goes through the `ViewportCache` port instead.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Project } from '../../domain'
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
import { customTemplates, firstFloorId, planImageForFloor, planItemsForFloor, planViewKey } from './planModel'
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
import { CalibrationOverlay } from './CalibrationOverlay'
import { ScaleCalibrationModal } from './ScaleCalibrationModal'
import { downloadSvg } from './exportSvg'

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

  const floorId = firstFloorId(project)
  const floor = project.floors.find((entry) => entry.id === floorId) ?? null
  const planImage = floor?.planImage ?? null
  const imageSrc = usePlanImageSrc(services.assetUrls, planImage?.assetHash ?? null)
  const image = planImageForFloor(project, floorId, imageSrc)
  const items = planItemsForFloor(project, floorId)
  const templates = customTemplates(project)

  const tool = useWorkspace((state) => state.activeTool)
  const setTool = useWorkspace((state) => state.setTool)
  const selection = useWorkspace((state) => state.selection)
  const select = useWorkspace((state) => state.select)
  const dragPreview = useWorkspace((state) => state.dragPreview)
  const setDragPreview = useWorkspace((state) => state.setDragPreview)
  const viewport = useWorkspace((state) =>
    floorId === null ? undefined : state.viewports[planViewKey(floorId)])
  const hydrated = useWorkspace((state) =>
    floorId === null ? true : state.hydrated[planViewKey(floorId)] === true)
  const railOpen = useWorkspace((state) => state.railOpen)
  const setRailOpen = useWorkspace((state) => state.setRailOpen)

  const hostRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [isCalibrating, setIsCalibrating] = useState(false)
  const [pendingDistancePx, setPendingDistancePx] = useState<number | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [pendingImage, setPendingImage] = useState<PreparedPlanImage | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const narrow = useNarrow()
  const viewKey = floorId === null ? null : planViewKey(floorId)

  // Another Project opened: its placements are not this one's to select.
  useEffect(() => {
    workspaceStore.getState().reset()
  }, [session.id])

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

  const commitImage = (prepared: PreparedPlanImage, clearExisting: boolean): void => {
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
        clearExisting,
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
    const read = await services.readPlanImage(file)
    input.value = ''
    if ('message' in read) {
      setUploadError(read.message)
      return
    }
    if (items.length > 0) setPendingImage(read.image)
    else commitImage(read.image, false)
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

  const groups: ToolbarGroup[] = [
    {
      id: 'tools',
      width: 132,
      label: 'Tools',
      content: (
        <>
          <button
            type="button"
            data-testid="tool-select"
            aria-pressed={tool === 'select' ? 'true' : 'false'}
            className="bb-workspace-tool-button"
            onClick={() => setTool('select')}
          >
            Select
          </button>
          <button
            type="button"
            data-testid="tool-pan"
            aria-pressed={tool === 'pan' ? 'true' : 'false'}
            className="bb-workspace-tool-button"
            onClick={() => setTool('pan')}
          >
            Pan
          </button>
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
            label="Upload Image"
            testId="upload-image"
            onSelect={() => fileInputRef.current?.click()}
          />
          <ToolbarMenuItem
            label="Calibrate Scale"
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

  const uncalibratedHint = planImage !== null && planImage.pixelsPerMm === null

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
        viewCard={<SavedViewCard floorName={floor?.name ?? null} onFit={fit} />}
        inspector={
          <SelectionInspector
            item={selected}
            unit={project.preferences.displayUnit}
            precision={project.preferences.displayPrecision}
            onUpdate={update}
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
        draftBar={pendingImage === null ? null : (
          <>
            <span>Uploading a new image will clear all placed objects. Continue?</span>
            <button
              type="button"
              data-testid="confirm-image-upload"
              className="bb-workspace-tool-button"
              onClick={() => {
                commitImage(pendingImage, true)
                setPendingImage(null)
              }}
            >
              Yes, clear and upload
            </button>
            <button
              type="button"
              data-testid="cancel-image-upload"
              className="bb-workspace-tool-button"
              onClick={() => setPendingImage(null)}
            >
              Cancel
            </button>
          </>
        )}
        warningStrip={uploadError !== null ? (
          <span data-testid="upload-error" data-tone="error">{uploadError}</span>
        ) : uncalibratedHint ? (
          <span data-testid="uncalibrated-hint">
            Image uploaded. Calibrate scale before trusting dimensions or exports.
          </span>
        ) : null}
      />
      {pendingDistancePx !== null && floorId !== null && (
        <ScaleCalibrationModal
          distancePx={pendingDistancePx}
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
    </>
  )
}

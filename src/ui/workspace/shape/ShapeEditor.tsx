/**
 * The Item Detail shape editor (#58 §3): toolbar, rail, canvas, draft bar.
 *
 * It is laid out like the Floor workspace — a fixed-height toolbar, a left rail, a canvas host
 * with a draft bar pinned to its top edge — but it is not `WorkspaceShell`. That shell's slots
 * are Floor slots: a view card and a selection inspector have no meaning for an Item Design on
 * its own, and it renders `data-testid="floor-workspace"`, which would be a lie on a page that
 * is not the Floor. Sharing the tokens and the density is the right amount of reuse; sharing
 * the layout would mean one of them growing the other's exceptions.
 *
 * Everything that could make a bad shape reaches the controller here and nowhere else. This
 * component never calls `dispatch` for a shape it has not been told is acceptable, and it owns
 * no proposal state of its own — the draft lives in the workspace store, so the canvas, the
 * rail and the draft bar are three readings of one value.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { designFootprintSize, footprintAsPath, PRESET_NAMES, rectangleFootprint } from '../../../domain'
import type { ItemDesign, ItemFootprint } from '../../../domain'
import type { PresetKind } from '../../../derive'
import { designOutline } from '../../../derive'
import { formatMm } from '../displayUnits'
import { useWorkspaceDispatch, useWorkspaceProject, useWorkspaceRoot } from '../WorkspaceRoot'
import { ToolbarMenu } from '../WorkspaceToolbar'
import { useWorkspace, workspaceStore } from '../workspaceStore'
import type { ShapeTab as ShapeTabName } from '../workspaceStore'
import {
  canCommit,
  discard,
  ghostFootprint,
  markerPoint,
  markedField,
  needsPreview,
  openShape,
  propose,
  proposalMessage,
  shownFootprint,
} from './proposal'
import type { ShapeDraft, ShapeGesture } from './proposal'
import { shapeTarget } from './shapeTarget'
import { placementDefaults, placementFootprint } from './placement'
import type { DragBox, PlacementGesture } from './placement'
import type { ShapeFieldId } from './parameters'
import { ShapesGallery } from './ShapesGallery'
import { ShapeTab } from './ShapeTab'
import { EdgesTab } from './EdgesTab'
import { MeasurementsTab } from './MeasurementsTab'
import { ConvertDialog } from './ConvertDialog'
import { FootprintCanvas } from './FootprintCanvas'
import './shape.css'

export interface ShapeEditorProps {
  readonly itemDesignId: string
  readonly design: ItemDesign
  /**
   * `editor` is the Item Design editor: the tool row, the rail and a canvas of its own.
   * `inspector` is the same three tabs with no canvas, for a host that already has a drawing
   * to look at — a cabinet's Item Detail, whose canvas is the cabinet editor, and from #59 the
   * Floor selection inspector's read-only tabs. Nothing else about the editor changes, which is
   * the point: one set of tabs, one set of labels, one controller behind both.
   */
  readonly layout?: 'editor' | 'inspector'
}

const TABS: readonly { id: ShapeTabName; label: string }[] = [
  { id: 'shape', label: 'Shape' },
  { id: 'edges', label: 'Edges' },
  { id: 'measurements', label: 'Measurements' },
]

/** What Item Detail says about a cabinet's size, in the one place both readings of it live. */
export const CABINET_SHAPE_NOTE = 'Size comes from the cabinet construction'

const IDLE = (footprint: ItemFootprint): ShapeDraft => ({ proposal: { state: 'idle' }, lastValid: footprint })

export function ShapeEditor(props: ShapeEditorProps): ReactNode {
  const { itemDesignId, design, layout = 'editor' } = props
  const { session, services } = useWorkspaceRoot()
  const project = useWorkspaceProject(session)
  const dispatch = useWorkspaceDispatch()
  const tab = useWorkspace((state) => state.shapeTab)
  const draftState = useWorkspace((state) => state.shapeDraft)
  const [convertOpen, setConvertOpen] = useState(false)

  // A cabinet's Item Footprint, height and Item Origin are derived from its construction
  // (#42 §2), so there is nothing to edit and no target to propose against. The tab still
  // renders, read-only, with the derived size in it — the size is real, only the editing is
  // not available.
  const isCabinet = design.kind === 'cabinet'
  const derived = isCabinet ? designFootprintSize(design) : null
  const committed: ItemFootprint = design.kind === 'generic'
    ? design.footprint
    : rectangleFootprint(derived?.width ?? 0, derived?.depth ?? 0)
  const target = isCabinet ? null : shapeTarget(project, itemDesignId)
  const draft: ShapeDraft | null = target === null
    ? null
    : draftState?.itemDesignId === itemDesignId
      ? draftState.draft
      : openShape(target)

  const shown = shownFootprint(draft ?? IDLE(committed), committed)
  const invalid = draft !== null && draft.proposal.state === 'invalid'
  const message = draft === null ? null : proposalMessage(draft)
  const field = draft === null ? null : markedField(draft)
  const marker = draft === null ? null : markerPoint(draft)
  const ghost = draft === null ? null : ghostFootprint(draft)
  const format = { unit: project.preferences.displayUnit, precision: project.preferences.displayPrecision }

  /** Write the footprint. Only ever reached with a proposal the controller accepted. */
  const commit = (footprint: ItemFootprint): void => {
    dispatch(services.intent.build('design.setFootprint', { itemDesignId, footprint }))
    workspaceStore.getState().setShapeDraft(itemDesignId, null)
  }

  /**
   * Put a footprint on screen. `final` is what separates a keystroke from an Enter or a blur:
   * only a final gesture on a design with one placement is allowed to reach the model, and
   * only when the controller says the shape is acceptable.
   */
  const gesture = (footprint: ItemFootprint, touched: ShapeFieldId | null, final: boolean): void => {
    if (target === null || draft === null) return
    const from: ShapeGesture = touched === null ? { via: 'canvas' } : { via: 'field', field: touched }
    const next = propose(target, draft, from, footprint)
    if (final && next.proposal.state === 'valid' && !needsPreview(target)) {
      commit(footprint)
      return
    }
    workspaceStore.getState().setShapeDraft(itemDesignId, next)
  }

  const dropDraft = (): void => {
    if (draft !== null) workspaceStore.getState().setShapeDraft(itemDesignId, discard(draft))
  }

  /**
   * The preset waiting to be placed, and the box being dragged for it.
   *
   * Both are local, and both are gone the moment the gesture ends: a shape that has been picked
   * out of the gallery but not drawn yet is not a proposal, and putting it in the workspace
   * store would mean a reload could find a half-placed Rectangle on screen.
   */
  const [placing, setPlacing] = useState<PresetKind | null>(null)
  const [drag, setDrag] = useState<DragBox | null>(null)

  const stopPlacing = (): void => {
    setPlacing(null)
    setDrag(null)
  }

  /** A number in the Project's display unit, for the chips and for the status line. */
  const num = (mm: number): string => formatMm(mm, format.unit, format.precision)

  const defaults = placementDefaults(design.kind === 'generic' ? design.footprint : null)

  const place = (gestureFromCanvas: PlacementGesture): void => {
    if (placing === null) return
    stopPlacing()
    gesture(placementFootprint(placing, gestureFromCanvas, defaults), null, true)
  }

  /**
   * Esc, wherever the focus is: it stops a placement, and it discards a proposal.
   *
   * One key for both because they are the same answer to the same question — "put back what was
   * there". Criterion 9's "selecting something else" is the same transition from the other end,
   * and lives in the workspace store's selection, not here.
   */
  useEffect(() => {
    const proposalUp = draft !== null && draft.proposal.state !== 'idle'
    if (placing === null && !proposalUp) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      stopPlacing()
      dropDraft()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  })

  const applyDraft = (): void => {
    if (draft === null || draft.proposal.state !== 'valid') return
    commit(draft.proposal.footprint)
  }

  const convert = (): void => {
    setConvertOpen(false)
    commit(footprintAsPath(shown))
  }

  const inspector = layout === 'inspector'

  return (
    <div className="bb-shape-editor" data-testid="shape-editor" data-layout={layout}>
      {!inspector && (
        <div className="bb-shape-toolbar" data-testid="shape-toolbar">
          <div className="bb-workspace-toolbar-group">
            <ToolbarMenu label="Shapes" testId="shapes-menu" disabled={isCabinet}>
              <ShapesGallery
                current={shown.kind === 'preset' ? shown.preset.kind : null}
                onPick={(kind: PresetKind) => setPlacing(kind)}
              />
            </ToolbarMenu>
          </div>
          {placing !== null && (
            <p className="bb-shape-placing" data-testid="shape-placing">
              {`Placing ${PRESET_NAMES[placing]} — drag a box, or click for ${num(defaults.size.width)} × ${num(defaults.size.depth)} ${format.unit}`}
              <button
                type="button"
                data-testid="shape-placing-cancel"
                className="bb-workspace-secondary-button"
                onClick={stopPlacing}
              >
                Cancel
              </button>
            </p>
          )}
        </div>
      )}

      <div className="bb-shape-body">
        <div className="bb-shape-rail" data-testid="shape-rail">
          {isCabinet && (
            <p className="bb-shape-rail-note" data-testid="shape-editor-note">{CABINET_SHAPE_NOTE}</p>
          )}
          <div className="bb-shape-tabs" role="tablist" aria-label="Item Footprint">
            {TABS.map((each) => (
              <button
                key={each.id}
                type="button"
                role="tab"
                id={`shape-tab-${each.id}`}
                aria-controls="shape-panel"
                aria-selected={tab === each.id ? 'true' : 'false'}
                data-testid={`shape-tab-${each.id}`}
                data-active={tab === each.id ? 'true' : 'false'}
                className="bb-shape-tab-button"
                onClick={() => workspaceStore.getState().setShapeTab(each.id)}
              >
                {each.label}
              </button>
            ))}
          </div>

          <div className="bb-shape-panel" id="shape-panel" role="tabpanel" aria-labelledby={`shape-tab-${tab}`}>
            {tab === 'shape' && (
              <ShapeTab
                footprint={shown}
                format={format}
                invalidField={field}
                invalidMessage={field === null ? null : message}
                readOnly={isCabinet}
                onGesture={gesture}
                onDiscard={dropDraft}
                onConvert={() => setConvertOpen(true)}
              />
            )}
            {tab === 'edges' && <EdgesTab path={designOutline(design)} format={format} />}
            {tab === 'measurements' && (
              <MeasurementsTab footprint={shown} format={format} boundsLabel="Bounds" />
            )}
          </div>
        </div>

        {!inspector && (
          <div className="bb-shape-canvas-host" data-testid="shape-canvas-host">
            <FootprintCanvas
              footprint={shown}
              ghost={ghost}
              marker={marker}
              origin={design.kind === 'cabinet' ? { x: 0, y: 0 } : design.origin}
              invalid={invalid}
              placing={placing}
              drag={drag}
              frameShape={committed}
              chipLabels={drag === null
                ? { width: '', depth: '' }
                : { width: `W ${num(drag.maxX - drag.minX)}`, depth: `D ${num(drag.maxY - drag.minY)}` }}
              onDrag={setDrag}
              onGesture={place}
            />
            {draft !== null && draft.proposal.state !== 'idle' && (
              <div
                className="bb-shape-draft-bar"
                data-invalid={invalid ? 'true' : 'false'}
                data-testid="shape-draft-bar"
                role="status"
              >
                {/* One message only: a field edit shows its sentence under the field, so the bar
                    stays quiet for it and speaks only for a gesture that has no field. */}
                {invalid
                  ? field === null && <span data-testid="shape-problem-message">{message}</span>
                  : <span data-testid="shape-draft-affects">Affects {target?.placementCount ?? 0} placements</span>}
                <button
                  type="button"
                  data-testid="shape-apply"
                  className="bb-workspace-primary-button"
                  disabled={!canCommit(draft)}
                  onClick={applyDraft}
                >
                  Apply
                </button>
                <button
                  type="button"
                  data-testid="shape-cancel"
                  className="bb-workspace-secondary-button"
                  onClick={dropDraft}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {convertOpen && shown.kind === 'preset' && (
        <ConvertDialog
          designName={design.name}
          preset={shown.preset}
          onConvert={convert}
          onCancel={() => setConvertOpen(false)}
        />
      )}
    </div>
  )
}

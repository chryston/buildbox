/**
 * The Item Detail View (#57 §6): one Item Design read on its own, with no Floor around it.
 *
 * This is the only way into the cabinet editor. The `Cabinet ⇄ Floor Plan` switcher is gone, so
 * the editor appears in this view's main slot — passed in as `children`, because the cabinet
 * chrome belongs to the composition above this module and not to the Plan View's. A generic
 * Item Design gets the shape editor in the same slot (#58): its own component, because a
 * cabinet's body is built elsewhere and knows about construction, which a shape does not.
 *
 * Navigation only: nothing here dispatches an Intent (#26). `← Back` and the `Placements` list
 * both move the Floor and Plan View pointers and reselect one Placed Item.
 */
import { useState, type ReactNode } from 'react'
import { useWorkspaceProject, useWorkspaceRoot } from './WorkspaceRoot'
import { itemLibrary, planViewsForFloor, placementGroups } from './planModel'
import { ShapeEditor } from './shape/ShapeEditor'
import { ClearanceEnvelopeSection } from './ClearanceEnvelopeSection'
import { useWorkspace, workspaceStore } from './workspaceStore'
import { STRINGS } from '../strings'
import { ExportDialog } from './export/ExportDialog'

export interface ItemDetailViewProps {
  /** The Item Design on screen — the one `Open Item Detail` was pressed for. */
  readonly itemDesignId: string
  /** The cabinet editor, when this Item Design is a cabinet. */
  readonly children?: ReactNode
}

/**
 * Leave Item Detail for a Placed Item. The order is the whole gesture: a selection belongs to
 * the Floor and Plan View it was made on, so moving after selecting would drop what was chosen.
 */
function gotoPlacement(floorId: string, viewId: string | null, placedItemId: string): void {
  const store = workspaceStore.getState()
  store.closeItemDetail()
  store.setActiveFloor(floorId, viewId)
  store.select(placedItemId)
}

export function ItemDetailView({ itemDesignId, children }: ItemDetailViewProps) {
  const { session, services } = useWorkspaceRoot()
  const project = useWorkspaceProject(session)
  const [isExporting, setIsExporting] = useState(false)
  const detail = useWorkspace((state) => state.itemDetail)
  const entry = itemLibrary(project).find((each) => each.itemDesignId === itemDesignId) ?? null
  const design = project.itemDesigns.find((each) => each.id === itemDesignId) ?? null
  const groups = placementGroups(project, itemDesignId)
  // The cabinet editor is passed in; a generic Item Design has no editor of its own and gets
  // the shape editor instead. `null` counts as absent, which is what the caller passes.
  const hasEditor = children !== null && children !== undefined
  const from = detail?.from ?? null
  const fromFloor = from === null
    ? null
    : project.floors.find((each) => each.id === from.floorId) ?? null

  return (
    <div className="bb-item-detail" data-testid="item-detail-view">
      <header className="bb-item-detail-header">
        <button
          type="button"
          className="bb-item-detail-back"
          data-testid="item-detail-back"
          disabled={from === null || fromFloor === null}
          onClick={() => {
            if (from === null) return
            gotoPlacement(from.floorId, from.viewId, from.placedItemId)
          }}
        >
          {`← Back to ${entry?.label ?? ''} on ${fromFloor?.name ?? ''}`}
        </button>
        <span className="bb-item-detail-title" data-testid="item-detail-title">
          {entry?.label ?? ''}
        </span>
        <button
          type="button"
          className="bb-item-detail-export"
          data-testid="export-open"
          disabled={design === null}
          onClick={() => {
            setIsExporting(true)
          }}
        >
          {STRINGS.exportAction}
        </button>
      </header>
      {isExporting && (
        <ExportDialog
          origin={{ kind: 'item-detail', itemDesignId }}
          unit={project.preferences.displayUnit}
          precision={project.preferences.displayPrecision}
          unsavedChanges={session.getSnapshot().save.kind !== 'saved'}
          port={services.exportDrawings}
          onClose={() => {
            setIsExporting(false)
          }}
        />
      )}
      <div className="bb-item-detail-body">
        <nav
          className="bb-item-detail-placements"
          aria-label={STRINGS.placements}
          data-testid="item-detail-placements"
        >
          <h2>{STRINGS.placements}</h2>
          {groups.length === 0 && <p className="bb-item-detail-empty">{STRINGS.notPlaced}</p>}
          {groups.map((group) => {
            const viewId = planViewsForFloor(project, group.floorId)[0]?.id ?? null
            return (
              <section key={group.floorId} data-testid={`placement-group-${group.floorId}`}>
                <h3>{group.floorName}</h3>
                <ul>
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="bb-item-detail-row"
                        data-testid={`placement-row-${item.id}`}
                        onClick={() => gotoPlacement(group.floorId, viewId, item.id)}
                      >
                        {item.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </nav>
        <div className="bb-item-detail-main">
          {/* A cabinet's Item Footprint is derived from its construction, so its Shape tab is
              read-only — but it is still the answer to "how big is this", and it is the same
              three tabs with the same labels as any other Item Design (#58 criterion 18). The
              cabinet editor owns the drawing, so these tabs come without a canvas, and they are
              the inspector: left of the drawing, as on any other Item Design (#58 criterion 17). */}
          {hasEditor && design !== null && (
            <ShapeEditor itemDesignId={itemDesignId} design={design} layout="inspector" />
          )}
          {/* The Clearance Envelope group, in Item Detail too (#76 §4) — a cabinet's envelope is
              editable here even though its footprint is not. */}
          {design !== null && (
            <ClearanceEnvelopeSection itemDesignId={itemDesignId} design={design} />
          )}
          {children ?? (design === null ? null : (
            <ShapeEditor itemDesignId={itemDesignId} design={design} />
          ))}
        </div>
      </div>
    </div>
  )
}
